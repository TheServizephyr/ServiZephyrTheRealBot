import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
const DEFAULT_DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';

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
        if (!deepgramResult.ok) {
            return NextResponse.json(
                { message: deepgramResult.message || 'Voice transcription failed.' },
                { status: deepgramResult.status || 502 }
            );
        }

        const transcript = deepgramResult.transcript || '';
        const provider = 'deepgram';

        if (!transcript) {
            return NextResponse.json(
                {
                    message: 'No speech could be detected in this segment.',
                    provider,
                    fallbackUsed: false,
                    confidence: Number(deepgramResult.confidence || 0),
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            transcript,
            provider,
            fallbackUsed: false,
            confidence: Number(deepgramResult.confidence || 0),
            fallbackMessage: '',
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
