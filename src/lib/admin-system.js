import { createHash, randomInt } from 'crypto';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

const ADMIN_COLLECTION = 'admins';
const ADMIN_DOC_ID = 'servizephyr';
const DEFAULT_CONVERSATIONS_COLLECTION = 'admin_conversations';
const DEFAULT_MAILBOX_COLLECTION = 'adminMailbox';

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

export async function getAdminSystemConfig(firestoreArg = null) {
    const firestore = firestoreArg || await getFirestore();
    const snap = await firestore.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID).get();
    const data = snap.exists ? (snap.data() || {}) : {};

    return {
        docId: ADMIN_DOC_ID,
        platformName: String(data.platformName || 'ServiZephyr').trim() || 'ServiZephyr',
        businessWhatsappNumber: String(data.businessWhatsappNumber || '').trim(),
        botPhoneNumberId: String(data.botPhoneNumberId || '').trim(),
        botDisplayNumber: String(data.botDisplayNumber || '').trim(),
        conversationsCollectionName: String(data.conversationsCollectionName || DEFAULT_CONVERSATIONS_COLLECTION).trim() || DEFAULT_CONVERSATIONS_COLLECTION,
        mailboxCollectionName: String(data.mailboxCollectionName || data.reportsCollectionName || DEFAULT_MAILBOX_COLLECTION).trim() || DEFAULT_MAILBOX_COLLECTION,
        adminUserIds: Array.isArray(data.adminUserIds) ? data.adminUserIds.map((id) => String(id || '').trim()).filter(Boolean) : [],
    };
}

export function generateFourDigitOtp() {
    return String(randomInt(1000, 10000));
}

export function hashOtp(code) {
    return createHash('sha256').update(String(code || '')).digest('hex');
}

async function upsertAdminMailboxConversation({
    firestore,
    config,
    phoneNumber,
    preview,
    metadata = {},
    sender = 'system',
}) {
    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) return;

    const mailboxCollectionName = config.mailboxCollectionName || DEFAULT_MAILBOX_COLLECTION;
    const mailboxRef = firestore.collection(mailboxCollectionName).doc(`wa_${normalizedPhone}`);
    const customerName = metadata.customerName || 'Admin Contact';

    await mailboxRef.set({
        id: `wa_${normalizedPhone}`,
        kind: 'whatsapp_conversation',
        title: customerName || 'WhatsApp Conversation',
        message: String(preview || '').trim(),
        description: String(preview || '').trim(),
        path: '/admin-dashboard/whatsapp-direct',
        status: metadata.status || 'new',
        timestamp: FieldValue.serverTimestamp(),
        exactTimestamp: new Date().toISOString(),
        user: {
            uid: metadata.userUid || null,
            email: metadata.email || 'N/A',
            name: customerName || 'Unknown',
            phone: normalizedPhone,
            type: 'whatsapp_owner',
        },
        context: {
            source: 'servizephyr_admin_bot',
            conversationPhone: normalizedPhone,
            sender,
            metadata,
        },
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

export async function storeAdminConversationMessage({
    firestore,
    config,
    phoneNumber,
    text,
    preview,
    metadata = {},
    sender = 'system',
    status = 'sent',
    type = 'system',
    isSystem = true,
}) {
    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) return;

    const collectionName = config.conversationsCollectionName || DEFAULT_CONVERSATIONS_COLLECTION;
    const conversationRef = firestore
        .collection(ADMIN_COLLECTION)
        .doc(ADMIN_DOC_ID)
        .collection(collectionName)
        .doc(normalizedPhone);

    const messageRef = conversationRef.collection('messages').doc();
    const nowIso = new Date().toISOString();

    const batch = firestore.batch();
    batch.set(conversationRef, {
        customerName: metadata.customerName || 'Admin Contact',
        customerPhone: normalizedPhone,
        lastMessage: String(preview || text || '').trim().slice(0, 180),
        lastMessageType: type,
        lastMessageTimestamp: FieldValue.serverTimestamp(),
        unreadCount: sender === 'customer' ? FieldValue.increment(1) : 0,
        tag: metadata.tag || 'System',
        source: 'servizephyr_admin_bot',
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    batch.set(messageRef, {
        sender,
        type,
        status,
        isSystem,
        text: String(text || '').trim(),
        timestamp: FieldValue.serverTimestamp(),
        exactTimestamp: nowIso,
        metadata,
    });

    await batch.commit();
    await upsertAdminMailboxConversation({
        firestore,
        config,
        phoneNumber: normalizedPhone,
        preview: String(preview || text || '').trim().slice(0, 180),
        metadata,
        sender,
    });
}

export async function storeAdminInboundMessage({
    phoneNumber,
    messageText,
    customerName = '',
    metadata = {},
}) {
    const firestore = await getFirestore();
    const config = await getAdminSystemConfig(firestore);

    await storeAdminConversationMessage({
        firestore,
        config,
        phoneNumber,
        text: String(messageText || '').trim(),
        preview: String(messageText || '').trim(),
        metadata: {
            ...metadata,
            customerName: customerName || 'Owner Contact',
            channel: 'admin_system',
        },
        sender: 'customer',
        status: 'received',
        type: 'text',
        isSystem: false,
    });
}

export async function sendAdminSystemMessage({
    phoneNumber,
    messageText,
    customerName = '',
    preview = '',
    metadata = {},
}) {
    const firestore = await getFirestore();
    const config = await getAdminSystemConfig(firestore);

    if (!config.botPhoneNumberId) {
        throw new Error('ServiZephyr admin bot phone number ID is not configured.');
    }

    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone || normalizedPhone.length < 10) {
        throw new Error('Valid WhatsApp phone number is required.');
    }

    const recipient = `91${normalizedPhone}`;
    const header = `*${config.platformName}*\n\n`;
    const fullMessage = header + String(messageText || '').trim();

    const response = await sendWhatsAppMessage(recipient, fullMessage, config.botPhoneNumberId);

    await storeAdminConversationMessage({
        firestore,
        config,
        phoneNumber: normalizedPhone,
        text: fullMessage,
        preview: preview || messageText,
        metadata: {
            ...metadata,
            customerName: customerName || null,
            channel: 'admin_system',
        },
    });

    return response;
}
