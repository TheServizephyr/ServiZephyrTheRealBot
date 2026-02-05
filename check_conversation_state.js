// Quick script to check conversation state for debugging
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
}

const firestore = admin.firestore();

async function checkConversationState() {
    const phone = '9027872803';
    const restaurantId = 'patel-ki-hatti';

    const conversationRef = firestore
        .collection('restaurants')
        .doc(restaurantId)
        .collection('conversations')
        .doc(phone);

    const snap = await conversationRef.get();

    if (snap.exists) {
        console.log('Conversation exists with data:', snap.data());
    } else {
        console.log('No conversation found for', phone);
    }
}

check ConversationState().catch(console.error);
