// Quick script to reset conversation state for 8922
const admin = require('firebase-admin');

// Initialize Firebase Admin (assumes GOOGLE_APPLICATION_CREDENTIALS is set)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
}

const firestore = admin.firestore();

async function resetConversationState() {
    const phone = '8922035716';
    const restaurantId = 'patel-ki-hatti';

    const conversationRef = firestore
        .collection('restaurants')
        .doc(restaurantId)
        .collection('conversations')
        .doc(phone);

    console.log('Resetting conversation state for', phone);

    await conversationRef.set({
        state: 'menu',
        lastWelcomeSent: null,
        unreadCount: 0
    }, { merge: true });

    console.log('✅ Conversation state reset successfully!');
}

resetConversationState().catch(console.error);
