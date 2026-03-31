import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';

const ADMIN_CONFIG_COLLECTION = 'admins';
const ADMIN_CONFIG_DOC_ID = 'servizephyr';

const getDefaultAdminConfig = () => ({
    platformName: 'ServiZephyr',
    legalBusinessName: 'ServiZephyr',
    address: {
        street: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN',
    },
    businessWhatsappNumber: '',
    botPhoneNumberId: '',
    botDisplayNumber: '',
    gstin: '',
    supportEmail: '',
    supportPhone: '',
    adminUserIds: [],
    mailboxCollectionName: 'error_reports',
    reportsCollectionName: 'error_reports',
    conversationsCollectionName: 'admin_conversations',
    notes: '',
});

export async function GET(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();
        const ref = firestore.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_CONFIG_DOC_ID);
        const snap = await ref.get();

        if (!snap.exists) {
            const defaults = getDefaultAdminConfig();
            await ref.set(defaults, { merge: true });
            return NextResponse.json(defaults, { status: 200 });
        }

        return NextResponse.json({
            ...getDefaultAdminConfig(),
            ...snap.data(),
        }, { status: 200 });
    } catch (error) {
        console.error('GET ADMIN SETTINGS ERROR:', error);
        return NextResponse.json({ message: error.message || 'Failed to load admin settings.' }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();
        const ref = firestore.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_CONFIG_DOC_ID);
        const body = await req.json();
        const defaults = getDefaultAdminConfig();

        const normalizedAdminIds = Array.isArray(body.adminUserIds)
            ? body.adminUserIds.map((value) => String(value || '').trim()).filter(Boolean)
            : defaults.adminUserIds;

        const payload = {
            platformName: String(body.platformName || defaults.platformName).trim() || defaults.platformName,
            legalBusinessName: String(body.legalBusinessName || defaults.legalBusinessName).trim() || defaults.legalBusinessName,
            address: {
                street: String(body.address?.street || '').trim(),
                city: String(body.address?.city || '').trim(),
                state: String(body.address?.state || '').trim(),
                postalCode: String(body.address?.postalCode || '').trim(),
                country: String(body.address?.country || defaults.address.country).trim() || defaults.address.country,
            },
            businessWhatsappNumber: String(body.businessWhatsappNumber || '').trim(),
            botPhoneNumberId: String(body.botPhoneNumberId || '').trim(),
            botDisplayNumber: String(body.botDisplayNumber || '').trim(),
            gstin: String(body.gstin || '').trim(),
            supportEmail: String(body.supportEmail || '').trim(),
            supportPhone: String(body.supportPhone || '').trim(),
            adminUserIds: normalizedAdminIds,
            mailboxCollectionName: String(body.mailboxCollectionName || defaults.mailboxCollectionName).trim() || defaults.mailboxCollectionName,
            reportsCollectionName: String(body.reportsCollectionName || defaults.reportsCollectionName).trim() || defaults.reportsCollectionName,
            conversationsCollectionName: String(body.conversationsCollectionName || defaults.conversationsCollectionName).trim() || defaults.conversationsCollectionName,
            notes: String(body.notes || '').trim(),
            updatedAt: new Date().toISOString(),
        };

        await ref.set(payload, { merge: true });
        return NextResponse.json(payload, { status: 200 });
    } catch (error) {
        console.error('PATCH ADMIN SETTINGS ERROR:', error);
        return NextResponse.json({ message: error.message || 'Failed to save admin settings.' }, { status: error.status || 500 });
    }
}
