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

  throw new Error('Firebase service account env vars are missing.');
}

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(getServiceAccount()),
    });
  }
  return admin.firestore();
}

function parseArgs(argv) {
  const args = { limit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--limit' && argv[i + 1]) {
      args.limit = Math.max(1, Number(argv[i + 1]) || 10);
      i += 1;
    }
  }
  return args;
}

function formatTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function printSection(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log('No documents found.');
    return;
  }

  for (const row of rows) {
    console.log(JSON.stringify(row, null, 2));
  }
}

async function fetchRecentDocs(firestore, collectionName, orderField, limit) {
  const snap = await firestore
    .collection(collectionName)
    .orderBy(orderField, 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function main() {
  const { limit } = parseArgs(process.argv.slice(2));
  const firestore = initFirestore();

  const [publicApiLimits, securityEvents, securityAnomalies] = await Promise.all([
    fetchRecentDocs(firestore, 'public_api_limits', 'updatedAt', limit),
    fetchRecentDocs(firestore, 'security_events', 'createdAt', limit),
    fetchRecentDocs(firestore, 'security_anomaly_windows', 'lastSeenAt', limit),
  ]);

  printSection(
    'public_api_limits',
    publicApiLimits.map((doc) => ({
      id: doc.id,
      bucket: doc.bucket || null,
      scope: doc.scope || null,
      ipAddress: doc.ipAddress || null,
      subjectKey: doc.subjectKey || null,
      count: doc.count || 0,
      windowStart: doc.windowStart || null,
      createdAt: formatTimestamp(doc.createdAt),
      updatedAt: formatTimestamp(doc.updatedAt),
      expiresAt: formatTimestamp(doc.expiresAt),
    }))
  );

  printSection(
    'security_events',
    securityEvents.map((doc) => ({
      id: doc.id,
      type: doc.type || null,
      severity: doc.severity || null,
      source: doc.source || null,
      path: doc.path || null,
      ipAddress: doc.ipAddress || null,
      actorUid: doc.actorUid || null,
      createdAt: formatTimestamp(doc.createdAt),
      metadata: doc.metadata || {},
    }))
  );

  printSection(
    'security_anomaly_windows',
    securityAnomalies.map((doc) => ({
      id: doc.id,
      type: doc.type || null,
      source: doc.source || null,
      count: doc.count || 0,
      threshold: doc.threshold || null,
      windowStart: doc.windowStart || null,
      windowSec: doc.windowSec || null,
      lastPath: doc.lastPath || null,
      lastIpAddress: doc.lastIpAddress || null,
      createdAt: formatTimestamp(doc.createdAt),
      lastSeenAt: formatTimestamp(doc.lastSeenAt),
      flaggedAt: formatTimestamp(doc.flaggedAt),
    }))
  );
}

main().catch((error) => {
  console.error('Failed to inspect security collections');
  console.error(error?.message || error);
  process.exit(1);
});
