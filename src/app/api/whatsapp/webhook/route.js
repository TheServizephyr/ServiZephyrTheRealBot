import { NextResponse } from 'next/server';
import { Client } from "@upstash/qstash";
import crypto from 'crypto';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request) {
    console.log("[Webhook WA Receiver] GET request received for verification.");
    try {
        const { searchParams } = new URL(request.url);
        const mode = searchParams.get('hub.mode');
        const token = searchParams.get('hub.verify_token');
        const challenge = searchParams.get('hub.challenge');

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log("[Webhook WA Receiver] Verification SUCCESS. Responding with challenge.");
            return new NextResponse(challenge, { status: 200 });
        } else {
            console.error("[Webhook WA Receiver] Verification FAILED.");
            return new NextResponse('Verification Failed', { status: 403 });
        }
    } catch (error) {
        console.error('[Webhook WA Receiver] CRITICAL ERROR in GET handler:', error);
        return new NextResponse('Server Error', { status: 500 });
    }
}

export async function POST(request) {
    console.log("[Webhook WA Receiver] POST request received.");
    try {
        // ✅ SECURITY: Verify Meta X-Hub-Signature-256 HMAC before processing
        const signature = request.headers.get('x-hub-signature-256');
        const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
        const rawBodyText = await request.text();

        if (appSecret) {
            if (!signature) {
                console.error('[Webhook WA Receiver] ❌ SECURITY: Missing Signature. Rejecting.');
                return new NextResponse('Unauthorized: Missing signature', { status: 403 });
            }

            const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBodyText, 'utf8').digest('hex');
            const sigBuffer = Buffer.from(signature);
            const expectedBuffer = Buffer.from(expectedSig);

            if (!(sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer))) {
                console.error('[Webhook WA Receiver] ❌ SECURITY: Signature mismatch. Rejecting.');
                return new NextResponse('Forbidden: Invalid signature', { status: 403 });
            }
            console.log('[Webhook WA Receiver] ✅ Meta signature verified.');
        } else {
            console.warn('[Webhook WA Receiver] ⚠️ META_APP_SECRET not set — skipping signature verification');
        }

        let body;
        try {
            body = JSON.parse(rawBodyText);
        } catch {
            return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
        }

        if (body?.object !== 'whatsapp_business_account') {
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const change = body?.entry?.[0]?.changes?.[0];
        const value = change?.value || {};
        const hasMessages = Array.isArray(value.messages) && value.messages.length > 0;

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.servizephyr.com';
        const processUrl = `${baseUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/process`;

        // ⚡ SPEED OPTIMIZATION: Process ALL incoming customer messages synchronously.
        // Every user (new/old, any conversation state) gets the welcome message — there is no case
        // where QStash helps response time here. QStash adds 5-10s of queue + cold-start latency.
        // Only status-update events (sent/delivered/read — no .messages array) still go to QStash
        // to conserve quota since they don't need a fast human-facing response.
        if (hasMessages) {
            console.log(`[Webhook WA Receiver] ⚡ Incoming message — processing synchronously for speed.`);
            const syncResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-fallback-bypass': appSecret || 'fallback-secret'
                },
                body: JSON.stringify(body)
            });
            return NextResponse.json({ message: 'Processed synchronously' }, { status: syncResponse.status });
        }

        // Status-only events (sent/delivered/read) → QStash for async processing
        const qstashToken = process.env.QSTASH_TOKEN || process.env.KV_REST_API_TOKEN;
        if (!qstashToken) {
            console.warn('[Webhook WA Receiver] ⚠️ QSTASH_TOKEN not set. Falling back to sync for status event.');
            const syncResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-fallback-bypass': appSecret || 'fallback-secret'
                },
                body: JSON.stringify(body)
            });
            return NextResponse.json({ message: 'Processed synchronously (no QStash token)' }, { status: syncResponse.status });
        }

        const qstashClient = new Client({ token: qstashToken });

        try {
            await qstashClient.publishJSON({
                url: processUrl,
                body: body,
                retries: 3
            });
            console.log('[Webhook WA Receiver] 🚀 Status event queued to QStash');
            return NextResponse.json({ message: 'Status event queued' }, { status: 200 });
        } catch (qstashError) {
            console.error('[Webhook WA Receiver] ⚠️ QStash queuing failed. Falling back to sync.', qstashError.message);
            const fallbackResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-fallback-bypass': appSecret || 'fallback-secret'
                },
                body: JSON.stringify(body)
            });
            console.log(`[Webhook WA Receiver] 🔄 Sync fallback complete. Status: ${fallbackResponse.status}`);
            return NextResponse.json({ message: 'Processed via sync fallback' }, { status: 200 });
        }

    } catch (error) {
        console.error('[Webhook WA Receiver] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
