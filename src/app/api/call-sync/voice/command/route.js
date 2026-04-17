import { NextResponse } from 'next/server';

import { getDatabase, getFirestore } from '@/lib/firebase-admin';
import { processCallSyncVoiceTranscript } from '@/lib/server/callSyncVoiceBilling';
import {
    parseManualOrderVoiceKeyterms,
    transcribeManualOrderVoiceAudio,
} from '@/lib/server/manualOrderVoiceTranscription';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function coerceText(value = '') {
    return String(value || '').trim();
}

export async function POST(req) {
    try {
        const contentType = String(req.headers.get('content-type') || '').toLowerCase();
        let token = '';
        let commandId = '';
        let transcript = '';
        let audioBuffer = null;
        let audioMimeType = '';
        let sttKeyterms = [];

        if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            const audioFile = formData.get('audio');
            token = coerceText(formData.get('token'));
            commandId = coerceText(formData.get('commandId'));
            transcript = coerceText(formData.get('transcript'));
            audioMimeType = coerceText(formData.get('mimeType'));
            sttKeyterms = parseManualOrderVoiceKeyterms(coerceText(formData.get('keyterms')));

            if (audioFile instanceof File) {
                audioBuffer = Buffer.from(await audioFile.arrayBuffer());
                if (!audioMimeType) {
                    audioMimeType = coerceText(audioFile.type) || 'audio/mp4';
                }
            }
        } else {
            const body = await req.json().catch(() => ({}));
            token = coerceText(body?.token);
            commandId = coerceText(body?.commandId);
            transcript = coerceText(body?.transcript);
            sttKeyterms = Array.isArray(body?.keyterms)
                ? body.keyterms.map((value) => coerceText(value)).filter(Boolean)
                : [];
        }

        if (!token) {
            return NextResponse.json({ message: 'Call sync token is required.' }, { status: 400 });
        }

        let transcription = null;
        if (!transcript) {
            if (!(audioBuffer instanceof Buffer) || audioBuffer.length <= 0) {
                return NextResponse.json(
                    { message: 'Transcript or recorded audio is required.' },
                    { status: 400 }
                );
            }

            transcription = await transcribeManualOrderVoiceAudio({
                audioBuffer,
                contentType: audioMimeType || 'audio/mp4',
                keyterms: sttKeyterms,
            });
            if (!transcription.ok) {
                return NextResponse.json(
                    {
                        message: transcription.message || 'Voice transcription failed.',
                        provider: transcription.provider || 'deepgram',
                        confidence: Number(transcription.confidence || 0),
                        detectedLanguage: transcription.detectedLanguage || '',
                        languageConfidence: Number(transcription.languageConfidence || 0),
                        transcriptionMode: transcription.transcriptionMode || '',
                        noSpeech: transcription.status === 422,
                    },
                    { status: transcription.status || 502 }
                );
            }

            transcript = coerceText(transcription.transcript);
        }

        const [firestore, rtdb] = await Promise.all([
            getFirestore(),
            getDatabase(),
        ]);

        const result = await processCallSyncVoiceTranscript({
            firestore,
            rtdb,
            token,
            transcript,
            commandId,
        });

        return NextResponse.json(
            {
                ok: result.ok,
                applied: result.applied !== false,
                deduped: result.deduped === true,
                message: result.message || '',
                transcript,
                transcription: transcription
                    ? {
                        provider: transcription.provider || 'deepgram',
                        confidence: Number(transcription.confidence || 0),
                        detectedLanguage: transcription.detectedLanguage || '',
                        languageConfidence: Number(transcription.languageConfidence || 0),
                        transcriptionMode: transcription.transcriptionMode || '',
                        fallbackUsed: transcription.fallbackUsed === true,
                    }
                    : null,
                restaurantName: result.restaurantName || '',
                businessType: result.businessType || 'restaurant',
                draft: result.draft || null,
            },
            { status: result.status || 200 }
        );
    } catch (error) {
        console.error('[CallSyncVoiceCommand] Failed to process command:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to process companion voice command.' },
            { status: 500 }
        );
    }
}
