import { NextResponse } from 'next/server';

import { getFirestore } from '@/lib/firebase-admin';
import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const sanitizeText = (value, fallback = '') => String(value || fallback).trim();

const timestampToMillis = (value) => {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const normalizeAddress = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value !== 'object') return '';
    return sanitizeText(
        value.full ||
        value.address ||
        [value.houseNumber, value.street, value.area, value.city, value.state, value.postalCode]
            .filter(Boolean)
            .join(', ')
    );
};

const mergeAddressEntry = (bucket, address, lastUsedAt) => {
    const normalizedAddress = sanitizeText(address);
    if (!normalizedAddress) return;
    const key = normalizedAddress.toLowerCase();
    const current = bucket.get(key) || {
        full: normalizedAddress,
        useCount: 0,
        lastUsedAt: 0,
    };
    current.useCount += 1;
    current.lastUsedAt = Math.max(current.lastUsedAt || 0, lastUsedAt || 0);
    bucket.set(key, current);
};

const buildCustomerOutput = (customerMap) =>
    Array.from(customerMap.values())
        .map((entry) => ({
            phone: entry.phone,
            name: entry.name || '',
            totalOrders: entry.totalOrders || 0,
            lastUsedAt: entry.lastUsedAt || 0,
            addresses: Array.from(entry.addresses.values())
                .sort((a, b) => {
                    if ((b.lastUsedAt || 0) !== (a.lastUsedAt || 0)) return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
                    return (b.useCount || 0) - (a.useCount || 0);
                })
                .slice(0, 8),
        }))
        .sort((a, b) => {
            if ((b.lastUsedAt || 0) !== (a.lastUsedAt || 0)) return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
            return (b.totalOrders || 0) - (a.totalOrders || 0);
        })
        .slice(0, 250);

export async function GET(req) {
    try {
        const { businessSnap } = await verifyOwnerWithAudit(
            req,
            'manual_order_customer_suggestions',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.VIEW_ORDERS]
        );

        const firestore = await getFirestore();
        const businessRef = businessSnap.ref;
        const customersRef = businessRef.collection('customers');
        const customBillHistoryRef = businessRef.collection('custom_bill_history');
        const recentLimit = Math.min(400, Math.max(50, parseInt(new URL(req.url).searchParams.get('limit'), 10) || 250));

        const [customersSnap, historySnap] = await Promise.all([
            customersRef.orderBy('lastActivityAt', 'desc').limit(recentLimit).get().catch(() => customersRef.limit(recentLimit).get()),
            customBillHistoryRef.orderBy('printedAt', 'desc').limit(recentLimit).get().catch(() => customBillHistoryRef.limit(recentLimit).get()),
        ]);

        const customerMap = new Map();
        const globalAddressMap = new Map();

        customersSnap.forEach((doc) => {
            const data = doc.data() || {};
            const phone = normalizePhone(data.phone || data.phoneNumber || doc.id);
            if (!phone) return;

            const lastUsedAt = timestampToMillis(data.lastActivityAt || data.lastOrderDate || data.updatedAt || data.createdAt);
            const current = customerMap.get(phone) || {
                phone,
                name: '',
                totalOrders: 0,
                lastUsedAt: 0,
                addresses: new Map(),
            };

            current.name = sanitizeText(data.customName || data.name || current.name);
            current.totalOrders = Math.max(current.totalOrders || 0, Number(data.totalOrders || 0));
            current.lastUsedAt = Math.max(current.lastUsedAt || 0, lastUsedAt || 0);

            const addresses = Array.isArray(data.addresses) ? data.addresses : [];
            addresses.forEach((address) => {
                const normalizedAddress = normalizeAddress(address);
                mergeAddressEntry(current.addresses, normalizedAddress, lastUsedAt);
                mergeAddressEntry(globalAddressMap, normalizedAddress, lastUsedAt);
            });

            customerMap.set(phone, current);
        });

        historySnap.forEach((doc) => {
            const data = doc.data() || {};
            const phone = normalizePhone(data.customerPhone);
            const lastUsedAt = timestampToMillis(data.printedAt || data.createdAt || data.updatedAt);
            const normalizedAddress = normalizeAddress(data.customerAddress);
            if (normalizedAddress) {
                mergeAddressEntry(globalAddressMap, normalizedAddress, lastUsedAt);
            }
            if (!phone) return;

            const current = customerMap.get(phone) || {
                phone,
                name: '',
                totalOrders: 0,
                lastUsedAt: 0,
                addresses: new Map(),
            };

            current.name = sanitizeText(data.customerName || current.name);
            current.totalOrders = (current.totalOrders || 0) + 1;
            current.lastUsedAt = Math.max(current.lastUsedAt || 0, lastUsedAt || 0);
            mergeAddressEntry(current.addresses, normalizedAddress, lastUsedAt);
            customerMap.set(phone, current);
        });

        const customers = buildCustomerOutput(customerMap);
        const addresses = Array.from(globalAddressMap.values())
            .sort((a, b) => {
                if ((b.lastUsedAt || 0) !== (a.lastUsedAt || 0)) return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
                return (b.useCount || 0) - (a.useCount || 0);
            })
            .slice(0, 250);

        return NextResponse.json({
            generatedAt: Date.now(),
            customers,
            addresses,
        });
    } catch (error) {
        console.error('[ManualOrder Customer Suggestions] Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to load customer suggestions.' },
            { status: error.status || 500 }
        );
    }
}
