/**
 * Remediation Script: Demote Unauthorized Admin User
 * 
 * Usage:
 *   node scripts/demote-unauthorized-admin.js [--uid <userId>]
 * 
 * Defaults to targeting: ru8VkeSPO3ZCxLdtPxPolwnU52F3 (Kaushik Dutta)
 */

const admin = require('firebase-admin');

function getServiceAccount() {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    return JSON.parse(json);
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  throw new Error('Firebase service account credentials missing from environment.');
}

function initFirebase() {
  if (!admin.apps.length) {
    const cred = getServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(cred),
    });
  }
  return {
    firestore: admin.firestore(),
    auth: admin.auth(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  let targetUid = 'ru8VkeSPO3ZCxLdtPxPolwnU52F3';

  const uidArgIdx = args.indexOf('--uid');
  if (uidArgIdx !== -1 && args[uidArgIdx + 1]) {
    targetUid = args[uidArgIdx + 1].trim();
  }

  console.log(`[REMEDIATION] Target User UID: ${targetUid}`);

  const { firestore, auth } = initFirebase();

  // 1. Fetch user document from Firestore
  const userRef = firestore.collection('users').doc(targetUid);
  const snap = await userRef.get();

  if (!snap.exists) {
    console.warn(`[WARNING] Firestore document for user ${targetUid} not found!`);
  } else {
    const data = snap.data();
    console.log(`[CURRENT DATA] Name: ${data.name}, Email: ${data.email}, Role: ${data.role}, Status: ${data.status}`);

    // Update Firestore document
    await userRef.set({
      role: 'customer',
      isAdmin: admin.firestore.FieldValue.delete(),
      status: 'Blocked',
      demotedAt: admin.firestore.FieldValue.serverTimestamp(),
      demotedReason: 'Unauthorized admin privilege escalation remediation',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[SUCCESS] Firestore document updated: role changed to 'customer', isAdmin removed, status kept as 'Blocked'.`);
  }

  // 2. Revoke Firebase Auth custom claims and active tokens
  try {
    const userRecord = await auth.getUser(targetUid);
    console.log(`[AUTH USER] Email: ${userRecord.email}, Disabled: ${userRecord.disabled}, CustomClaims:`, userRecord.customClaims);

    // Disable user, reset claims, revoke sessions
    await auth.updateUser(targetUid, {
      disabled: true,
    });

    await auth.setCustomUserClaims(targetUid, {
      isAdmin: null,
      role: 'customer',
    });

    await auth.revokeRefreshTokens(targetUid);
    console.log(`[SUCCESS] Firebase Auth: account disabled, customClaims wiped, and all active refresh tokens revoked.`);
  } catch (authErr) {
    console.error(`[AUTH ERROR] Could not update auth user:`, authErr.message);
  }

  console.log(`\n[COMPLETE] User ${targetUid} has been completely neutralized and stripped of all administrative privileges.`);
}

main().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
