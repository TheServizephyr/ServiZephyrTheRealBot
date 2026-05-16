import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';

function parseRequestUrl(req) {
  return new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
}

function assertSessionNotExpired(searchParams) {
  const expiryRaw = searchParams.get('session_expiry');
  if (!expiryRaw) return;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw {
      message: 'Customer impersonation session has expired.',
      status: 403,
      code: 'IMPERSONATION_EXPIRED',
    };
  }
}

export async function resolveCustomerTarget(req) {
  const url = parseRequestUrl(req);
  const impersonateUserId = String(url.searchParams.get('impersonate_user_id') || '').trim();

  if (!impersonateUserId) {
    const uid = await verifyAndGetUid(req);
    return {
      actorUid: uid,
      targetUid: uid,
      isImpersonating: false,
      targetUserData: null,
    };
  }

  assertSessionNotExpired(url.searchParams);

  const { uid: actorUid } = await verifyAdmin(req);
  const firestore = await getFirestore();
  const targetDoc = await firestore.collection('users').doc(impersonateUserId).get();

  if (!targetDoc.exists || targetDoc.data()?.isDeleted) {
    throw {
      message: 'Target customer profile was not found.',
      status: 404,
      code: 'TARGET_CUSTOMER_NOT_FOUND',
    };
  }

  return {
    actorUid,
    targetUid: impersonateUserId,
    isImpersonating: true,
    targetUserData: targetDoc.data() || {},
  };
}

export function rejectCustomerImpersonationMutation(targetContext) {
  if (targetContext?.isImpersonating) {
    throw {
      message: 'Impersonation mode is read-only for customer data.',
      status: 403,
      code: 'IMPERSONATION_READ_ONLY',
    };
  }
}
