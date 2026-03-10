import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import {
  buildAudit,
  getCustomerResult,
  getOrderResult,
  getRestaurantResult,
  patchCustomerResult,
  deleteOrderResult,
} from '@/lib/admin-check-ids';

async function resolveLookup(firestore, type, id) {
  if (type === 'customer') {
    return getCustomerResult(firestore, id);
  }
  if (type === 'restaurant') {
    return getRestaurantResult(firestore, id);
  }
  if (type === 'order') {
    return getOrderResult(firestore, id);
  }
  return null;
}

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || '').trim();
}

export async function POST(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);
    const { type, id } = await req.json();
    const normalizedType = normalizeType(type);
    const normalizedId = normalizeId(id);

    if (!normalizedType || !normalizedId) {
      return NextResponse.json({ message: 'Both type and id are required.' }, { status: 400 });
    }
    if (!['customer', 'restaurant', 'order'].includes(normalizedType)) {
      return NextResponse.json({ message: 'Invalid type. Use customer, restaurant, or order.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const data = await resolveLookup(firestore, normalizedType, normalizedId);
    if (!data) {
      return NextResponse.json({ message: `No ${normalizedType} found for ID ${normalizedId}.` }, { status: 404 });
    }

    const audit = buildAudit({
      type: normalizedType,
      id: normalizedId,
      data,
      adminContext,
      endpoint: '/api/admin/check-ids',
    });

    return NextResponse.json({ type: normalizedType, data, audit }, { status: 200 });
  } catch (error) {
    console.error('POST /api/admin/check-ids ERROR:', error);
    return NextResponse.json({ message: error.message || 'Internal Server Error', error: error.message }, { status: error.status || 500 });
  }
}

export async function PATCH(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);
    const body = await req.json();
    const normalizedType = normalizeType(body.type);
    const normalizedId = normalizeId(body.id);
    const action = String(body.action || '').trim().toLowerCase();

    if (normalizedType !== 'customer' || !normalizedId || !action) {
      return NextResponse.json({ message: 'type=customer, id, and action are required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const data = await patchCustomerResult({
      firestore,
      identifier: normalizedId,
      action,
      payload: body,
    });

    if (action === 'update_profile' && body.status !== undefined && data?.customer?.userType === 'user' && data?.customer?.uid) {
      const auth = await getAuth();
      await auth.updateUser(data.customer.uid, { disabled: body.status === 'Blocked' });
    }

    const audit = buildAudit({
      type: normalizedType,
      id: normalizedId,
      data,
      adminContext,
      endpoint: '/api/admin/check-ids',
      event: `admin_check_ids_${action}`,
    });

    return NextResponse.json({ message: 'Customer updated successfully.', type: normalizedType, data, audit }, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/admin/check-ids ERROR:', error);
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
  }
}

export async function DELETE(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);
    const body = await req.json();
    const normalizedType = normalizeType(body.type);
    const normalizedId = normalizeId(body.id);

    if (normalizedType !== 'order' || !normalizedId) {
      return NextResponse.json({ message: 'type=order and id are required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const data = await deleteOrderResult({ firestore, identifier: normalizedId });
    const audit = buildAudit({
      type: normalizedType,
      id: normalizedId,
      data: { order: data.deletedOrder },
      adminContext,
      endpoint: '/api/admin/check-ids',
      event: 'admin_check_ids_delete_order',
    });

    return NextResponse.json({ message: 'Order deleted successfully.', type: normalizedType, data, audit }, { status: 200 });
  } catch (error) {
    console.error('DELETE /api/admin/check-ids ERROR:', error);
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
  }
}
