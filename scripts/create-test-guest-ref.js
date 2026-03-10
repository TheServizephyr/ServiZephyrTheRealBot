const admin = require('firebase-admin');
const { nanoid } = require('nanoid');

const DEFAULT_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];
const BUSINESS_COLLECTIONS = [
  { name: 'restaurants', businessType: 'restaurant' },
  { name: 'shops', businessType: 'store' },
  { name: 'street_vendors', businessType: 'street-vendor' },
];

function parseArgs(argv) {
  const args = { phone: '', businessId: '', host: 'http://localhost:3001' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();
    if (!arg) continue;
    if (arg.startsWith('dotenv_config_path=')) continue;

    if (arg === '--business') {
      args.businessId = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }

    if (arg === '--host') {
      args.host = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }

    if (!args.phone) {
      args.phone = arg;
    }
  }

  return args;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64');
}

function getDatabaseUrl(serviceAccount) {
  if (process.env.FIREBASE_DATABASE_URL) return process.env.FIREBASE_DATABASE_URL;
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  return projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined;
}

function getStorageBucket(serviceAccount) {
  return process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`;
}

function getAdminApp() {
  if (admin.apps.length > 0) return admin.app();

  const serviceAccount = getServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: getDatabaseUrl(serviceAccount),
    storageBucket: getStorageBucket(serviceAccount),
  });
}

async function getOrCreateGuestProfile(firestore, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new Error('Phone must normalize to a valid 10-digit number.');
  }

  const existingUser = await firestore
    .collection('users')
    .where('phone', '==', normalizedPhone)
    .limit(1)
    .get();

  if (!existingUser.empty) {
    throw new Error(`Phone ${normalizedPhone} already belongs to logged-in user UID ${existingUser.docs[0].id}. Use a different number for guest testing.`);
  }

  const existingGuest = await firestore
    .collection('guest_profiles')
    .where('phone', '==', normalizedPhone)
    .limit(1)
    .get();

  if (!existingGuest.empty) {
    return {
      guestId: existingGuest.docs[0].id,
      created: false,
      data: existingGuest.docs[0].data() || {},
    };
  }

  const guestId = `g_${nanoid(16)}`;
  const payload = {
    phone: normalizedPhone,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    addresses: [],
    name: `Test Guest ${normalizedPhone.slice(-4)}`,
    status: 'Active',
  };

  await firestore.collection('guest_profiles').doc(guestId).set(payload);
  return { guestId, created: true, data: payload };
}

async function resolveBusiness(firestore, explicitBusinessId = '') {
  const safeBusinessId = String(explicitBusinessId || '').trim();
  if (safeBusinessId) {
    for (const config of BUSINESS_COLLECTIONS) {
      const doc = await firestore.collection(config.name).doc(safeBusinessId).get();
      if (doc.exists) {
        const data = doc.data() || {};
        return {
          collectionName: config.name,
          businessId: doc.id,
          businessType: data.businessType || config.businessType,
          name: data.name || 'Unnamed Business',
        };
      }
    }
    throw new Error(`Business ${safeBusinessId} not found in restaurants/shops/street_vendors.`);
  }

  for (const config of BUSINESS_COLLECTIONS) {
    const snap = await firestore.collection(config.name).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data() || {};
      return {
        collectionName: config.name,
        businessId: doc.id,
        businessType: data.businessType || config.businessType,
        name: data.name || 'Unnamed Business',
      };
    }
  }

  throw new Error('No business found in restaurants/shops/street_vendors.');
}

async function issueGuestAccessRef(firestore, { subjectId, phone, businessId, channel = 'local-test' }) {
  const ref = nanoid(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await firestore.collection('guest_sessions').doc(ref).set({
    subjectId,
    subjectType: 'guest',
    phone: normalizePhone(phone),
    businessId: String(businessId || '').trim(),
    channel,
    scopes: DEFAULT_SCOPES,
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    metadata: {
      source: 'local-script',
      generatedAt: new Date().toISOString(),
    },
  });

  return { ref, expiresAt };
}

async function main() {
  const { phone, businessId, host } = parseArgs(process.argv.slice(2));
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new Error('Usage: node -r dotenv/config scripts/create-test-guest-ref.js 9087654321 [--business <businessId>] [--host http://localhost:3001]');
  }

  const app = getAdminApp();
  const firestore = app.firestore();

  const guest = await getOrCreateGuestProfile(firestore, normalizedPhone);
  const business = await resolveBusiness(firestore, businessId);
  const session = await issueGuestAccessRef(firestore, {
    subjectId: guest.guestId,
    phone: normalizedPhone,
    businessId: business.businessId,
  });

  const safeHost = String(host || 'http://localhost:3001').replace(/\/+$/g, '');
  const url = `${safeHost}/order/${encodeURIComponent(business.businessId)}?ref=${encodeURIComponent(session.ref)}`;

  console.log('');
  console.log('Test guest ref created');
  console.log(`phone: ${normalizedPhone}`);
  console.log(`guestId: ${guest.guestId}`);
  console.log(`guestProfileCreated: ${guest.created ? 'yes' : 'no-existing-used'}`);
  console.log(`businessId: ${business.businessId}`);
  console.log(`businessName: ${business.name}`);
  console.log(`businessCollection: ${business.collectionName}`);
  console.log(`ref: ${session.ref}`);
  console.log(`expiresAt: ${session.expiresAt.toISOString()}`);
  console.log(`url: ${url}`);
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error('Failed to create test guest ref');
  console.error(error?.message || error);
  console.error('');
  process.exit(1);
});
