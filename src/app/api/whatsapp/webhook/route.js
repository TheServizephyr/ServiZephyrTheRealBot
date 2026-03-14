import { NextResponse } from 'next/server';
import { Client } from "@upstash/qstash";
import crypto from 'crypto';
import { getFirestore } from '@/lib/firebase-admin';

async function getBusinessBrief(firestore, botPhoneNumberId) {
    const rSnap = await firestore.collection('restaurants').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!rSnap.empty) return { id: rSnap.docs[0].id, collection: 'restaurants' };
    const sSnap = await firestore.collection('shops').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!sSnap.empty) return { id: sSnap.docs[0].id, collection: 'shops' };
    const vSnap = await firestore.collection('street_vendors').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!vSnap.empty) return { id: vSnap.docs[0].id, collection: 'street_vendors' };
    return null;
}

const normalizePhone = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/^\+?91/, '').replace(/\D/g, '');
    return cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
};

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
        // ✅ SECURITY: Verify Meta X-Hub-Signature-256 HMAC before Queueing
        const signature = request.headers.get('x-hub-signature-256');
        const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
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

        // 🛑 OPTIMIZATION: Only queue actual incoming customer messages. 
        // Bypass QStash for status updates (sent, delivered, read) to save free tier limits.
        const change = body?.entry?.[0]?.changes?.[0];
        const value = change?.value || {};
        const hasMessages = Array.isArray(value.messages) && value.messages.length > 0;
        
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.servizephyr.com';
        const processUrl = `${baseUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/process`;

        // Default to bypass if it's not a message event (like status)
        let shouldBypassQStash = !hasMessages;
        let bypassReason = !hasMessages ? 'non-message event (status update)' : '';

        // If it is a message, intelligently bypass based on state & type
        if (hasMessages) {
            const message = value.messages[0];
            if (message.type === 'interactive' || message.type === 'button') {
                shouldBypassQStash = true;
                bypassReason = 'interactive button push';
            } else if (['text', 'image', 'audio', 'video', 'document'].includes(message.type)) {
                try {
                    // FAST FIRESTORE CHECK
                    const firestore = await getFirestore();
                    const botId = value.metadata?.phone_number_id;
                    const business = await getBusinessBrief(firestore, botId);
                    
                    if (business) {
                        const customerPhone = normalizePhone(message.from);
                        const convRef = firestore.collection(business.collection).doc(business.id).collection('conversations').doc(customerPhone);
                        const convSnap = await convRef.get();
                        const state = convSnap.exists ? convSnap.data().state : 'menu';
                        
                        if (state === 'direct_chat' || state === 'browsing_order') {
                            shouldBypassQStash = true;
                            bypassReason = `active conversation state (${state})`;
                        } else {
                            // Let's specifically check if it's exactly the tracking greeting/help so we can queue it
                            const text = (message.text?.body || '').trim().toLowerCase();
                            const isNeedHelp = text.match(/^["']?\s*need\s*help\??\s*["']?$/i) || text.match(/^["']?\s*help\s*["']?$/i);
                            const isEndChat = text.match(/^["]?\s*end\s*chat\s*["]?$/i);
                            
                            // If it's a lightweight sync command, process it synchronously
                            if (isNeedHelp || isEndChat) {
                                shouldBypassQStash = true;
                                bypassReason = 'lightweight text command';
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Webhook WA Receiver] ⚠️ Error during fast state check, will fallback to queue', e);
                }
            }
        }

        if (shouldBypassQStash) {
            console.log(`[Webhook WA Receiver] ⚡ Bypassing QStash for ${bypassReason}. Saving quota.`);
            const syncResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-fallback-bypass': appSecret || 'fallback-secret'
                },
                body: JSON.stringify(body)
            });
            return NextResponse.json({ message: 'Processed synchronously to save quota' }, { status: syncResponse.status });
        }

        // Publish to QStash
        const qstashToken = process.env.QSTASH_TOKEN || process.env.KV_REST_API_TOKEN;
        if (!qstashToken) {
            console.warn('[Webhook WA Receiver] ⚠️ QSTASH_TOKEN not set. Configure in .env');
            return NextResponse.json({ message: 'Server configuration error.' }, { status: 500 });
        }

        const qstashClient = new Client({ token: qstashToken });

        try {
            await qstashClient.publishJSON({
                url: processUrl,
                body: body,
                retries: 3
            });
            console.log('[Webhook WA Receiver] 🚀 Event queued successfully to QStash');
            return NextResponse.json({ message: 'Event queued successfully' }, { status: 200 });
        } catch (qstashError) {
            console.error('[Webhook WA Receiver] ⚠️ QStash queuing failed (Limit Exceeded?). Falling back to synchronous processing.', qstashError.message);
            
            // 🔥 FAIL-SAFE FALLBACK: Call the processor synchronously directly
            const fallbackResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-fallback-bypass': appSecret || 'fallback-secret'
                },
                body: JSON.stringify(body)
            });
            
            console.log(`[Webhook WA Receiver] 🔄 Fallback complete. Status: ${fallbackResponse.status}`);
            return NextResponse.json({ message: 'Processed via synchronous fallback' }, { status: 200 });
        }

    } catch (error) {
        console.error('[Webhook WA Receiver] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
