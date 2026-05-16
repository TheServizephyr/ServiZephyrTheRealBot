import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { SALES_PARTNERS_COLLECTION, serializePartner } from '@/lib/sales-operations';

export async function verifySalesPartner(req) {
  const uid = await verifyAndGetUid(req);
  const firestore = await getFirestore();
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  const email = String(userData.email || '').trim().toLowerCase();
  const phone = String(userData.phone || userData.phoneNumber || '').replace(/\D/g, '').slice(0, 10);

  let partnerDoc = null;

  const byUser = await firestore
    .collection(SALES_PARTNERS_COLLECTION)
    .where('userId', '==', uid)
    .limit(1)
    .get();
  if (!byUser.empty) partnerDoc = byUser.docs[0];

  let matchedUnlinkedPartnerDoc = null;

  if (!partnerDoc && email) {
    const byEmail = await firestore
      .collection(SALES_PARTNERS_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!byEmail.empty) matchedUnlinkedPartnerDoc = byEmail.docs[0];
  }

  if (!partnerDoc && !matchedUnlinkedPartnerDoc && phone) {
    const byPhone = await firestore
      .collection(SALES_PARTNERS_COLLECTION)
      .where('phone', '==', phone)
      .limit(1)
      .get();
    if (!byPhone.empty) matchedUnlinkedPartnerDoc = byPhone.docs[0];
  }

  if (!partnerDoc && matchedUnlinkedPartnerDoc) {
    const matchedPartner = serializePartner(matchedUnlinkedPartnerDoc);
    if (matchedPartner.userId && matchedPartner.userId !== uid) {
      throw { message: 'This employee ID is already linked to another login account.', status: 409 };
    }
    throw {
      message: 'Enter your employee ID to activate your sales dashboard.',
      status: 428,
      code: 'EMPLOYEE_ID_REQUIRED',
    };
  }

  if (!partnerDoc && userData.role === 'sales-partner') {
    throw { message: 'Sales partner profile not found. Ask admin to activate your partner profile.', status: 404 };
  }

  if (!partnerDoc) {
    throw { message: 'Access denied: sales partner only.', status: 403 };
  }

  const partner = serializePartner(partnerDoc);
  if (partner.status === 'inactive') {
    throw { message: 'Your sales partner account is inactive.', status: 403 };
  }

  return { uid, userData, partner, partnerRef: partnerDoc.ref };
}
