
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

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
        const { conversationId, text, imageUrl } = await req.json();

        if (!conversationId || (!text && !imageUrl)) {
            return NextResponse.json({ message: 'Conversation ID and text or imageUrl are required.' }, { status: 400 });
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

        if (text) {
            messagePayload = {
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: text },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "action_end_chat", title: "End This Chat" } },
                            { type: "reply", reply: { id: "action_report_admin", title: "Report to Admin" } }
                        ]
                    }
                }
            };
            firestoreMessageData = { type: 'text', text: text };
        } else if (imageUrl) {
            console.warn("[API WARNING] Buttons cannot be sent with image messages. Sending image only.");
            messagePayload = { type: 'image', link: imageUrl };
            firestoreMessageData = { type: 'image', mediaUrl: imageUrl, text: 'Image' };
        }

        await sendWhatsAppMessage(customerPhoneWithCode, messagePayload, botPhoneNumberId);

        const firestore = getFirestore();
        const conversationRef = businessDoc.ref.collection('conversations').doc(conversationId);
        const messageRef = conversationRef.collection('messages').doc();

        const batch = firestore.batch();

        batch.set(messageRef, {
            id: messageRef.id,
            sender: 'owner',
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent',
            ...firestoreMessageData
        });

        batch.set(conversationRef, {
            lastMessage: imageUrl ? '📷 Image' : text,
            lastMessageType: imageUrl ? 'image' : 'text',
            lastMessageTimestamp: FieldValue.serverTimestamp(),
        }, { merge: true });

        await batch.commit();

        return NextResponse.json({ message: 'Message sent successfully!' }, { status: 200 });

    } catch (error) {
        console.error("POST MESSAGE ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
