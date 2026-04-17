import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/lib/permissions';
import {
    parseManualOrderVoiceKeyterms,
    transcribeManualOrderVoiceAudio,
} from '@/lib/server/manualOrderVoiceTranscription';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function coerceText(value = '') {
    return String(value || '').trim();
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
        const keyterms = parseManualOrderVoiceKeyterms(coerceText(formData.get('keyterms')));

        if (!(audioFile instanceof File)) {
            return NextResponse.json({ message: 'Audio file is required.' }, { status: 400 });
        }

        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        const contentType = coerceText(audioFile.type) || hintedMimeType || 'audio/webm';
        const result = await transcribeManualOrderVoiceAudio({
            audioBuffer,
            contentType,
            keyterms,
        });

        if (!result.ok) {
            return NextResponse.json(
                {
                    message: result.message || 'Voice transcription failed.',
                    provider: result.provider || 'deepgram',
                    fallbackUsed: result.fallbackUsed === true,
                    confidence: Number(result.confidence || 0),
                    detectedLanguage: result.detectedLanguage || '',
                    languageConfidence: Number(result.languageConfidence || 0),
                    transcriptionMode: result.transcriptionMode || '',
                },
                { status: result.status || 502 }
            );
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('[Manual Order Voice Transcribe] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Voice transcription failed.' },
            { status: error?.status || 500 }
        );
    }
}
