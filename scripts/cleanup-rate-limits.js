/**
 * Rate Limits Cleanup Script
 *
 * Usage:
 *   node scripts/cleanup-rate-limits.js
 *   MODE=full node scripts/cleanup-rate-limits.js
 *   HOURS=168 node scripts/cleanup-rate-limits.js
 *
 * Default mode:
 *   - stale: delete docs older than HOURS (default: 168h = 7d)
 *
 * Full mode:
 *   - full: delete all docs from rate_limits collection
 *
 * Auth resolution order:
 *   1) FIREBASE_SERVICE_ACCOUNT_JSON
 *   2) FIREBASE_SERVICE_ACCOUNT_BASE64
 *   3) ./servizephyr-firebase-adminsdk.json
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function readServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    }
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }

    const localPath = path.join(process.cwd(), 'servizephyr-firebase-adminsdk.json');
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    throw new Error('No Firebase service account found (env or local file).');
}

async function deleteByRefs(refs) {
    if (!refs.length) return 0;
    const batchSize = 450;
    let deleted = 0;

    for (let i = 0; i < refs.length; i += batchSize) {
        const chunk = refs.slice(i, i + batchSize);
        const batch = admin.firestore().batch();
        for (const ref of chunk) batch.delete(ref);
        await batch.commit();
        deleted += chunk.length;
    }

    return deleted;
}

async function run() {
    const mode = (process.env.MODE || 'stale').toLowerCase(); // stale | full
    const hours = Number(process.env.HOURS || '168');
    if (mode !== 'stale' && mode !== 'full') {
        throw new Error(`Invalid MODE "${mode}". Use "stale" or "full".`);
    }
    if (mode === 'stale' && (!Number.isFinite(hours) || hours <= 0)) {
        throw new Error(`Invalid HOURS "${process.env.HOURS}". Must be > 0.`);
    }

    const serviceAccount = readServiceAccount();
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
    });

    const firestore = admin.firestore();
    const collection = firestore.collection('rate_limits');

    console.log('========================================');
    console.log('Rate Limits Cleanup');
    console.log(`Project: ${projectId}`);
    console.log(`Mode: ${mode}`);
    if (mode === 'stale') {
        console.log(`Delete older than: ${hours}h`);
    }
    console.log('========================================');

    const beforeSnap = await collection.get();
    const beforeCount = beforeSnap.size;
    console.log(`Before count: ${beforeCount}`);

    let deleted = 0;
    if (mode === 'full') {
        const refs = beforeSnap.docs.map((doc) => doc.ref);
        deleted = await deleteByRefs(refs);
    } else {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

        let querySnap = await collection.where('createdAt', '<', cutoffTs).limit(500).get();
        while (!querySnap.empty) {
            const refs = querySnap.docs.map((doc) => doc.ref);
            deleted += await deleteByRefs(refs);
            querySnap = await collection.where('createdAt', '<', cutoffTs).limit(500).get();
        }
    }

    const afterSnap = await collection.get();
    const afterCount = afterSnap.size;

    console.log('========================================');
    console.log(`Deleted: ${deleted}`);
    console.log(`After count: ${afterCount}`);
    console.log('========================================');
}

run().catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});
