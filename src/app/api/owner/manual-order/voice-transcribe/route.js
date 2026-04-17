import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
const DEFAULT_DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';
const DEEPGRAM_KEYTERM_LIMIT = 90;
const DEEPGRAM_KEYTERM_TOKEN_LIMIT = 420;

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

function normalizeLanguageCode(value = '') {
    return coerceText(value).toLowerCase();
}

function isAllowedDetectedLanguage(value = '') {
    const normalized = normalizeLanguageCode(value);
    return normalized.startsWith('en') || normalized.startsWith('hi') || normalized === 'multi';
}

function parseKeytermsInput(value = '') {
    if (typeof value !== 'string') return [];

    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        const seen = new Set();
        const results = [];
        let tokenCount = 0;

        parsed.forEach((entry) => {
            const term = coerceText(entry);
            if (!term) return;
            const normalized = term.toLowerCase();
            if (seen.has(normalized)) return;
            const tokens = term.split(/\s+/).filter(Boolean);
            if (!tokens.length) return;
            if (results.length >= DEEPGRAM_KEYTERM_LIMIT) return;
            if (tokenCount + tokens.length > DEEPGRAM_KEYTERM_TOKEN_LIMIT) return;
            seen.add(normalized);
            results.push(term);
            tokenCount += tokens.length;
        });

        return results;
    } catch {
        return [];
    }
}

function extractDeepgramResult(payload = {}) {
    const channel = payload?.results?.channels?.[0] || {};
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
        detectedLanguage: coerceText(channel?.detected_language),
        languageConfidence: Number(channel?.language_confidence || 0) || 0,
    };
}

function shouldRetryDeepgramTranscript(result = {}) {
    const transcript = normalizeTranscriptForFallback(result?.transcript);
    const detectedLanguage = normalizeLanguageCode(result?.detectedLanguage);
    const confidence = Number(result?.confidence || 0);
    const languageConfidence = Number(result?.languageConfidence || 0);

    if (!transcript) return true;
    if (/[\u0370-\u03FF\u0400-\u04FF]/u.test(transcript)) return true;
    if (detectedLanguage && !isAllowedDetectedLanguage(detectedLanguage) && languageConfidence >= 0.18) {
        return true;
    }
    if (confidence < 0.52 && transcript.split(/\s+/).filter(Boolean).length <= 5) {
        return true;
    }
    return false;
}

function isRetryTranscriptBetter(nextResult = {}, previousResult = {}) {
    const nextTranscript = normalizeTranscriptForFallback(nextResult?.transcript);
    const previousTranscript = normalizeTranscriptForFallback(previousResult?.transcript);
    const nextConfidence = Number(nextResult?.confidence || 0);
    const previousConfidence = Number(previousResult?.confidence || 0);
    const nextAllowedLanguage = isAllowedDetectedLanguage(nextResult?.detectedLanguage);
    const previousAllowedLanguage = isAllowedDetectedLanguage(previousResult?.detectedLanguage);
    const nextHasForeignScript = /[\u0370-\u03FF\u0400-\u04FF]/u.test(nextTranscript);
    const previousHasForeignScript = /[\u0370-\u03FF\u0400-\u04FF]/u.test(previousTranscript);

    if (!previousTranscript && nextTranscript) return true;
    if (previousHasForeignScript && !nextHasForeignScript && nextTranscript) return true;
    if (!previousAllowedLanguage && nextAllowedLanguage && nextTranscript) return true;
    if (nextConfidence >= previousConfidence + 0.05 && nextTranscript) return true;
    if (
        nextTranscript &&
        previousTranscript &&
        nextTranscript.length > previousTranscript.length * 1.2 &&
        nextConfidence >= previousConfidence - 0.04
    ) {
        return true;
    }
    return false;
}

async function transcribeWithDeepgram(audioBuffer, contentType, options = {}) {
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

    const mode = coerceText(options?.mode) || 'multilingual';
    const keyterms = Array.isArray(options?.keyterms) ? options.keyterms : [];
    const url = new URL(DEEPGRAM_API_URL);
    url.searchParams.set('model', normalizeDeepgramModel(DEFAULT_DEEPGRAM_MODEL));
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'false');
    url.searchParams.set('numerals', 'true');
    url.searchParams.set('utterances', 'false');
    if (mode === 'restricted') {
        url.searchParams.append('detect_language', 'en');
        url.searchParams.append('detect_language', 'hi');
    } else {
        url.searchParams.set('language', 'multi');
    }
    keyterms.forEach((keyterm) => {
        url.searchParams.append('keyterm', keyterm);
    });

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
        detectedLanguage: parsed.detectedLanguage,
        languageConfidence: parsed.languageConfidence,
        mode,
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
        const keyterms = parseKeytermsInput(coerceText(formData.get('keyterms')));
        if (!(audioFile instanceof File)) {
            return NextResponse.json({ message: 'Audio file is required.' }, { status: 400 });
        }

        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        if (!audioBuffer.length) {
            return NextResponse.json({ message: 'Audio file is empty.' }, { status: 400 });
        }

        const contentType = coerceText(audioFile.type) || hintedMimeType || 'audio/webm';

        const primaryResult = await transcribeWithDeepgram(audioBuffer, contentType, {
            keyterms,
            mode: 'multilingual',
        });
        if (!primaryResult.ok) {
            return NextResponse.json(
                { message: primaryResult.message || 'Voice transcription failed.' },
                { status: primaryResult.status || 502 }
            );
        }

        let deepgramResult = primaryResult;
        let fallbackUsed = false;

        if (shouldRetryDeepgramTranscript(primaryResult)) {
            const restrictedResult = await transcribeWithDeepgram(audioBuffer, contentType, {
                keyterms,
                mode: 'restricted',
            });
            if (restrictedResult.ok && isRetryTranscriptBetter(restrictedResult, primaryResult)) {
                deepgramResult = restrictedResult;
                fallbackUsed = true;
            }
        }

        const transcript = deepgramResult.transcript || '';
        const provider = 'deepgram';

        if (!transcript) {
            return NextResponse.json(
                {
                    message: 'No speech could be detected in this segment.',
                    provider,
                    fallbackUsed,
                    confidence: Number(deepgramResult.confidence || 0),
                    detectedLanguage: deepgramResult.detectedLanguage || '',
                    languageConfidence: Number(deepgramResult.languageConfidence || 0),
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            transcript,
            provider,
            fallbackUsed,
            confidence: Number(deepgramResult.confidence || 0),
            fallbackMessage: fallbackUsed ? 'Deepgram restricted-language retry was used.' : '',
            primaryTranscript: deepgramResult.transcript || '',
            detectedLanguage: deepgramResult.detectedLanguage || '',
            languageConfidence: Number(deepgramResult.languageConfidence || 0),
            transcriptionMode: deepgramResult.mode || 'multilingual',
        });
    } catch (error) {
        console.error('[Manual Order Voice Transcribe] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Voice transcription failed.' },
            { status: error?.status || 500 }
        );
    }
}
