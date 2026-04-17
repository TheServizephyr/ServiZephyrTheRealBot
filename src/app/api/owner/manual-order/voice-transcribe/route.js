import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';
const DEFAULT_OPENAI_AUDIO_MODEL = process.env.OPENAI_AUDIO_FALLBACK_MODEL || 'whisper-1';

function coerceText(value = '') {
    return String(value || '').trim();
}

function normalizeDeepgramModel(value = '') {
    const normalized = coerceText(value)
        .toLowerCase()
        .replace(/[_\s]+/g, '-');

    if (!normalized) return 'nova-3';
    if (normalized === 'nova3') return 'nova-3';
    if (normalized === 'nova2') return 'nova-2';
    if (normalized === 'nova-3-general') return 'nova-3';
    if (normalized === 'nova-2-general') return 'nova-2';
    return normalized;
}

function normalizeTranscriptForFallback(value = '') {
    return coerceText(value).replace(/\s+/g, ' ');
}

function extractDeepgramResult(payload = {}) {
    const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] || {};
    const transcript = normalizeTranscriptForFallback(alternative?.transcript);
    const words = Array.isArray(alternative?.words) ? alternative.words : [];
    const wordConfidences = words
        .map((word) => Number(word?.confidence))
        .filter((confidence) => Number.isFinite(confidence) && confidence >= 0);
    const averageWordConfidence = wordConfidences.length > 0
        ? wordConfidences.reduce((sum, confidence) => sum + confidence, 0) / wordConfidences.length
        : null;

    return {
        transcript,
        words,
        confidence: averageWordConfidence ?? (Number(alternative?.confidence || 0) || 0),
    };
}

function shouldUseOpenAiFallback(result = {}) {
    const transcript = normalizeTranscriptForFallback(result?.transcript);
    if (!transcript) return true;

    const tokenCount = transcript.split(/\s+/).filter(Boolean).length;
    if (tokenCount === 0) return true;
    if (result.confidence < 0.7) return true;
    if (tokenCount === 1 && result.confidence < 0.8) return true;
    return false;
}

async function transcribeWithDeepgram(audioBuffer, contentType) {
    const apiKey = coerceText(process.env.DEEPGRAM_API_KEY);
    if (!apiKey) {
        return {
            ok: false,
            status: 503,
            message: 'Deepgram API key is not configured.',
            transcript: '',
            confidence: 0,
        };
    }

    const url = new URL(DEEPGRAM_API_URL);
    url.searchParams.set('model', normalizeDeepgramModel(DEFAULT_DEEPGRAM_MODEL));
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'false');
    url.searchParams.set('numerals', 'true');
    url.searchParams.set('utterances', 'false');
    url.searchParams.set('detect_language', 'true');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': contentType || 'audio/webm',
        },
        body: audioBuffer,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {
            ok: false,
            status: response.status || 502,
            message: payload?.err_msg || payload?.message || 'Deepgram transcription failed.',
            transcript: '',
            confidence: 0,
        };
    }

    const parsed = extractDeepgramResult(payload);
    return {
        ok: true,
        status: 200,
        message: '',
        transcript: parsed.transcript,
        confidence: parsed.confidence,
        words: parsed.words,
        raw: payload,
    };
}

async function transcribeWithOpenAi(audioFile) {
    const apiKey = coerceText(process.env.OPENAI_API_KEY);
    if (!apiKey) {
        return {
            ok: false,
            status: 503,
            message: 'OpenAI API key is not configured for audio fallback.',
            transcript: '',
        };
    }

    const formData = new FormData();
    formData.append('file', audioFile, coerceText(audioFile?.name) || `voice-segment-${Date.now()}.webm`);
    formData.append('model', DEFAULT_OPENAI_AUDIO_MODEL);
    formData.append('response_format', 'json');

    const response = await fetch(OPENAI_TRANSCRIPT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {
            ok: false,
            status: response.status || 502,
            message: payload?.error?.message || payload?.message || 'OpenAI audio fallback failed.',
            transcript: '',
        };
    }

    return {
        ok: true,
        status: 200,
        message: '',
        transcript: normalizeTranscriptForFallback(payload?.text),
        raw: payload,
    };
}

export async function POST(req) {
    try {
        await verifyOwnerFeatureAccess(
            req,
            'manual-order',
            'manual_order_voice_transcribe',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const formData = await req.formData();
        const audioFile = formData.get('audio');
        const hintedMimeType = coerceText(formData.get('mimeType'));
        if (!(audioFile instanceof File)) {
            return NextResponse.json({ message: 'Audio file is required.' }, { status: 400 });
        }

        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        if (!audioBuffer.length) {
            return NextResponse.json({ message: 'Audio file is empty.' }, { status: 400 });
        }

        const contentType = coerceText(audioFile.type) || hintedMimeType || 'audio/webm';

        const deepgramResult = await transcribeWithDeepgram(audioBuffer, contentType);
        let transcript = deepgramResult.transcript || '';
        let provider = 'deepgram';
        let fallbackUsed = false;
        let fallbackMessage = '';

        if ((!deepgramResult.ok || shouldUseOpenAiFallback(deepgramResult)) && coerceText(process.env.OPENAI_API_KEY)) {
            const openAiResult = await transcribeWithOpenAi(audioFile);
            if (openAiResult.ok && openAiResult.transcript) {
                transcript = openAiResult.transcript;
                provider = 'openai';
                fallbackUsed = true;
            } else if (!deepgramResult.ok) {
                return NextResponse.json(
                    { message: openAiResult.message || deepgramResult.message || 'Voice transcription failed.' },
                    { status: openAiResult.status || deepgramResult.status || 502 }
                );
            } else {
                fallbackMessage = openAiResult.message || '';
            }
        } else if (!deepgramResult.ok) {
            return NextResponse.json(
                { message: deepgramResult.message || 'Voice transcription failed.' },
                { status: deepgramResult.status || 502 }
            );
        }

        if (!transcript) {
            return NextResponse.json(
                {
                    message: 'No speech could be detected in this segment.',
                    provider,
                    fallbackUsed,
                    confidence: Number(deepgramResult.confidence || 0),
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            transcript,
            provider,
            fallbackUsed,
            confidence: Number(deepgramResult.confidence || 0),
            fallbackMessage,
            primaryTranscript: deepgramResult.transcript || '',
        });
    } catch (error) {
        console.error('[Manual Order Voice Transcribe] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Voice transcription failed.' },
            { status: error?.status || 500 }
        );
    }
}
