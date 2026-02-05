
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendWhatsAppMessage, markWhatsAppMessageAsRead } from '@/lib/whatsapp';

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner'].includes(userRole)) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0];
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0];
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

// Fetch messages for a conversation
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const conversationId = searchParams.get('conversationId');

        if (!conversationId) {
            return NextResponse.json({ message: 'Conversation ID is required.' }, { status: 400 });
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);

        const messagesSnap = await businessDoc.ref.collection('conversations').doc(conversationId).collection('messages')
            .orderBy('timestamp', 'asc')
            .get();

        const messages = messagesSnap.docs.map(doc => {
            const data = doc.data();
            const timestamp = data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : new Date().toISOString();
            return {
                id: doc.id,
                ...data,
                timestamp: timestamp,
            };
        });

        await businessDoc.ref.collection('conversations').doc(conversationId).set({ unreadCount: 0 }, { merge: true });

        return NextResponse.json({ messages }, { status: 200 });

    } catch (error) {
        console.error("GET MESSAGES ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// Send a new message from the owner
export async function POST(req) {
    try {
        const { conversationId, text, imageUrl, videoUrl, documentUrl, audioUrl, fileName } = await req.json();

        if (!conversationId || (!text && !imageUrl && !videoUrl && !documentUrl && !audioUrl)) {
            return NextResponse.json({ message: 'Conversation ID and at least one content parameter (text, imageUrl, videoUrl, documentUrl, audioUrl) are required.' }, { status: 400 });
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);
        const businessData = businessDoc.data();
        const botPhoneNumberId = businessData.botPhoneNumberId;

        if (!botPhoneNumberId) {
            throw { message: 'WhatsApp bot is not connected for this business.', status: 400 };
        }

        const customerPhoneWithCode = '91' + conversationId;

        let messagePayload;
        let firestoreMessageData;
        let lastMessagePreview;

        // ✅ HANDLE DIFFERENT MEDIA TYPES
        if (text) {
            messagePayload = {
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: {
                        text: `${text}\n\n_If you want to place an order, please end this chat first._`
                    },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "action_end_chat", title: "End Chat & Order" } }
                        ]
                    }
                }
            };
            firestoreMessageData = { type: 'text', text: text };
            lastMessagePreview = text;
        } else if (imageUrl) {
            console.warn("[API WARNING] Buttons cannot be sent with media messages. Sending image only.");
            messagePayload = { type: 'image', image: { link: imageUrl } };
            firestoreMessageData = { type: 'image', mediaUrl: imageUrl, text: 'Image' };
            lastMessagePreview = '📷 Image';
        } else if (videoUrl) {
            messagePayload = { type: 'video', video: { link: videoUrl } };
            firestoreMessageData = { type: 'video', mediaUrl: videoUrl, text: 'Video', fileName: fileName || 'video' };
            lastMessagePreview = '🎥 Video';
        } else if (documentUrl) {
            messagePayload = { type: 'document', document: { link: documentUrl, filename: fileName || 'document' } };
            firestoreMessageData = { type: 'document', mediaUrl: documentUrl, text: 'Document', fileName: fileName || 'document' };
            lastMessagePreview = `📄 ${fileName || 'Document'}`;
        } else if (audioUrl) {
            messagePayload = { type: 'audio', audio: { link: audioUrl } };
            firestoreMessageData = { type: 'audio', mediaUrl: audioUrl, text: 'Audio', fileName: fileName || 'audio' };
            lastMessagePreview = '🎵 Audio';
        }

        const response = await sendWhatsAppMessage(customerPhoneWithCode, messagePayload, botPhoneNumberId);

        if (!response || !response.messages || response.messages.length === 0) {
            console.error("[API ERROR] Failed to send message to WhatsApp. Response was invalid or empty.");
            throw { message: 'Failed to send message via WhatsApp API.', status: 502 };
        }

        const messageDocId = response.messages[0].id; // ✅ FIX: Use WhatsApp Message ID

        const firestore = await getFirestore();
        const conversationRef = businessDoc.ref.collection('conversations').doc(conversationId);
        const messageRef = conversationRef.collection('messages').doc(messageDocId); // ✅ Use WAMID

        const batch = firestore.batch();

        batch.set(messageRef, {
            id: messageDocId, // Store WAMID
            sender: 'owner',
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent',
            ...firestoreMessageData
        });

        batch.set(conversationRef, {
            lastMessage: lastMessagePreview,
            lastMessageType: firestoreMessageData.type,
            lastMessageTimestamp: FieldValue.serverTimestamp(),
            state: 'direct_chat', // ✅ FIX: Force conversation to direct_chat mode so bot doesn't reply
        }, { merge: true });

        await batch.commit();

        return NextResponse.json({ message: 'Message sent successfully!' }, { status: 200 });

    } catch (error) {
        console.error("POST MESSAGE ERROR:", error);

        let errorMessage = error.message || 'Internal Server Error';
        // Try to parse JSON error message from library
        try {
            const parsed = JSON.parse(errorMessage);
            if (parsed && parsed.message) errorMessage = `WhatsApp Error: ${parsed.message}`;
        } catch (e) {
            // Not JSON, use raw message
        }

        return NextResponse.json({ message: errorMessage }, { status: error.status || 500 });
    }
}

// Mark messages as read
export async function PATCH(req) {
    try {
        const { conversationId, messageIds } = await req.json();

        if (!conversationId || !Array.isArray(messageIds) || messageIds.length === 0) {
            return NextResponse.json({ message: 'Conversation ID and Message IDs are required.' }, { status: 400 });
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);
        const businessData = businessDoc.data();
        const botPhoneNumberId = businessData.botPhoneNumberId;

        if (!botPhoneNumberId) {
            throw { message: 'WhatsApp bot is not connected for this business.', status: 400 };
        }

        const firestore = await getFirestore();
        const messagesCollection = businessDoc.ref.collection('conversations').doc(conversationId).collection('messages');
        const batch = firestore.batch();
        let updateCount = 0;

        // Process in parallel for speed
        await Promise.all(messageIds.map(async (msgId) => {
            // 1. Mark as read on WhatsApp (External)
            await markWhatsAppMessageAsRead(msgId, botPhoneNumberId);

            // 2. Mark as read in Firestore (Internal)
            const msgRef = messagesCollection.doc(msgId);
            batch.update(msgRef, { status: 'read' });
            updateCount++;
        }));

        if (updateCount > 0) {
            await batch.commit();
        }

        // Reset unread count
        await businessDoc.ref.collection('conversations').doc(conversationId).set({ unreadCount: 0 }, { merge: true });

        return NextResponse.json({ message: 'Messages marked as read' }, { status: 200 });

    } catch (error) {
        console.error("PATCH MESSAGES ERROR:", error);
        return NextResponse.json({ message: error.message || 'Error marking messages as read' }, { status: error.status || 500 });
    }
}
