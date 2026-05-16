import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { resolveCustomerTarget } from '@/lib/customer-impersonation';

export const dynamic = 'force-dynamic';

const toIso = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export async function GET(req) {
  try {
    const { targetUid } = await resolveCustomerTarget(req);
    const firestore = await getFirestore();

    const [ordersByUserIdSnap, ordersByLegacyCustomerIdSnap] = await Promise.all([
      firestore.collection('orders')
        .where('userId', '==', targetUid)
        .get(),
      firestore.collection('orders')
        .where('customerId', '==', targetUid)
        .get(),
    ]);

    const uniqueOrders = new Map();
    ordersByUserIdSnap.forEach((doc) => uniqueOrders.set(doc.id, { id: doc.id, ...doc.data() }));
    ordersByLegacyCustomerIdSnap.forEach((doc) => uniqueOrders.set(doc.id, { id: doc.id, ...doc.data() }));

    const orders = Array.from(uniqueOrders.values())
      .map((order) => ({
        ...order,
        orderDate: toIso(order.orderDate),
        createdAt: toIso(order.createdAt),
        updatedAt: toIso(order.updatedAt),
      }))
      .sort((a, b) => new Date(b.orderDate || b.createdAt || 0) - new Date(a.orderDate || a.createdAt || 0));

    return NextResponse.json({ orders }, { status: 200 });
  } catch (error) {
    console.error('[API /customer/orders] Error:', error);
    return NextResponse.json(
      { message: error.message || 'Internal Server Error' },
      { status: error.status || 500 }
    );
  }
}
