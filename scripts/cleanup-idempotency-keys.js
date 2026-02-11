/**
 * Idempotency Keys Cleanup Script
 *
 * Usage:
 *   node scripts/cleanup-idempotency-keys.js
 *   DAYS=7 node scripts/cleanup-idempotency-keys.js
 *   MODE=full node scripts/cleanup-idempotency-keys.js
 *
 * Default mode:
 *   - stale: delete idempotency_keys older than DAYS (default: 7)
 *
 * Full mode:
 *   - full: delete all docs from idempotency_keys collection
 *
 * Matching logic for stale cleanup:
 *   - Uses first available timestamp among:
 *     completedAt, failedAt, createdAt
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

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const maybe = Number(value);
    return Number.isFinite(maybe) ? maybe : null;
}

async function run() {
    const mode = (process.env.MODE || 'stale').toLowerCase(); // stale | full
    const days = Number(process.env.DAYS || '7');
    if (mode !== 'stale' && mode !== 'full') {
        throw new Error(`Invalid MODE "${mode}". Use "stale" or "full".`);
    }
    if (mode === 'stale' && (!Number.isFinite(days) || days <= 0)) {
        throw new Error(`Invalid DAYS "${process.env.DAYS}". Must be > 0.`);
    }

    const serviceAccount = readServiceAccount();
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
    });

    const firestore = admin.firestore();
    const collection = firestore.collection('idempotency_keys');

    console.log('========================================');
    console.log('Idempotency Keys Cleanup');
    console.log(`Project: ${projectId}`);
    console.log(`Mode: ${mode}`);
    if (mode === 'stale') {
        console.log(`Delete older than: ${days}d`);
    }
    console.log('========================================');

    const beforeSnap = await collection.get();
    const beforeCount = beforeSnap.size;
    console.log(`Before count: ${beforeCount}`);

    let deleted = 0;

    if (mode === 'full') {
        deleted = await deleteByRefs(beforeSnap.docs.map((doc) => doc.ref));
    } else {
        const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
        const refsToDelete = [];

        for (const doc of beforeSnap.docs) {
            const data = doc.data() || {};
            const ts =
                toMillis(data.completedAt) ??
                toMillis(data.failedAt) ??
                toMillis(data.createdAt);

            if (ts && ts < cutoffMs) {
                refsToDelete.push(doc.ref);
            }
        }

        deleted = await deleteByRefs(refsToDelete);
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

