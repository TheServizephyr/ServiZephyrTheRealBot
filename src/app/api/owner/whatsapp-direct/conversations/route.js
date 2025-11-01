
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    let targetOwnerId = uid;
    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        
        const conversationsSnap = await businessRef.collection('conversations')
            .orderBy('lastMessageTimestamp', 'desc')
            .get();
            
        const conversations = conversationsSnap.docs.map(doc => {
            const data = doc.data();
            const lastMessageTimestamp = data.lastMessageTimestamp?.toDate ? data.lastMessageTimestamp.toDate().toISOString() : null;
            return {
                id: doc.id,
                ...data,
                lastMessageTimestamp,
            };
        });

        return NextResponse.json({ conversations }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/whatsapp-direct/conversations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();

        const { conversationId, tag, action } = await req.json();

        if (!conversationId) {
            return NextResponse.json({ message: 'Conversation ID is required.' }, { status: 400 });
        }
        
        const conversationRef = businessRef.collection('conversations').doc(conversationId);

        if (action === 'end_chat') {
            await conversationRef.set({ state: 'menu' }, { merge: true });

            const botPhoneNumberId = businessData.botPhoneNumberId;
            const customerPhoneWithCode = '91' + conversationId;

            const payload = {
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: `This chat has been closed by the restaurant. You can now use the menu below or type any message to start again.`
                    },
                    action: {
                        buttons: [
                             { type: "reply", reply: { id: `action_order_${businessDoc.id}`, title: "Order Food" } },
                            { type: "reply", reply: { id: `action_track_${businessDoc.id}`, title: "Track Last Order" } },
                             { type: "reply", reply: { id: "action_help", title: "Need More Help?" } }
                        ]
                    }
                }
            };
            await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
            
            return NextResponse.json({ message: 'Chat ended and menu sent.' }, { status: 200 });
        }

        const validTags = ['Urgent', 'Feedback', 'Complaint', 'Resolved', null];
        if (tag !== undefined && !validTags.includes(tag)) {
            return NextResponse.json({ message: 'Invalid tag provided.' }, { status: 400 });
        }
        
        if (tag !== undefined) {
             await conversationRef.set({ tag: tag || FieldValue.delete() }, { merge: true });
             return NextResponse.json({ message: 'Tag updated successfully.' }, { status: 200 });
        }

        return NextResponse.json({ message: 'No valid action or tag provided.' }, { status: 400 });

    } catch (error) {
        console.error("PATCH /api/owner/whatsapp-direct/conversations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
