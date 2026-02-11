/**
 * Menu Image Migration Script
 *
 * Migrates menu item images stored directly in Firestore docs
 * (especially data URLs/base64) into Firebase Storage and writes
 * back stable download URLs into menu docs.
 *
 * Usage:
 *   node scripts/migrate-menu-images-to-storage.js
 *
 * Env:
 *   DRY_RUN=true|false                  (default: true)
 *   COLLECTIONS=restaurants,shops,...  (default: restaurants,shops,street_vendors)
 *   ONLY_COLLECTION=restaurants
 *   ONLY_BUSINESS_ID=<docId>
 *   MIGRATE_REMOTE_URLS=true|false      (default: false)
 *
 * Auth resolution order:
 *   1) FIREBASE_SERVICE_ACCOUNT_JSON
 *   2) FIREBASE_SERVICE_ACCOUNT_BASE64
 *   3) ./servizephyr-firebase-adminsdk.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function isDataUrlImage(value) {
    return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function isStorageUrl(value) {
    if (typeof value !== 'string') return false;
    return value.includes('firebasestorage.googleapis.com/') || value.includes('storage.googleapis.com/');
}

function extensionFromMime(contentType = 'image/jpeg') {
    const normalized = String(contentType).toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('heic')) return 'heic';
    if (normalized.includes('heif')) return 'heif';
    return 'jpg';
}

function parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function uploadBufferAndGetUrl(bucket, buffer, contentType, filePath) {
    const token = crypto.randomUUID();
    const file = bucket.file(filePath);
    await file.save(buffer, {
        resumable: false,
        metadata: {
            contentType,
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
                firebaseStorageDownloadTokens: token,
            }
        }
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function uploadFromDataUrl(bucket, dataUrl, collectionName, businessId, itemId) {
    const { contentType, buffer } = parseDataUrl(dataUrl);
    const ext = extensionFromMime(contentType);
    const filePath = `business_media/menu_items/${collectionName}/${businessId}/${Date.now()}_${itemId}.${ext}`;
    return uploadBufferAndGetUrl(bucket, buffer, contentType, filePath);
}

async function uploadFromRemoteUrl(bucket, sourceUrl, collectionName, businessId, itemId) {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
        throw new Error(`Remote image fetch failed (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = extensionFromMime(contentType);
    const filePath = `business_media/menu_items/${collectionName}/${businessId}/${Date.now()}_${itemId}.${ext}`;
    return uploadBufferAndGetUrl(bucket, buffer, contentType, filePath);
}

async function run() {
    const dryRun = process.env.DRY_RUN !== 'false';
    const migrateRemote = process.env.MIGRATE_REMOTE_URLS === 'true';
    const onlyCollection = process.env.ONLY_COLLECTION || '';
    const onlyBusinessId = process.env.ONLY_BUSINESS_ID || '';
    const collections = onlyCollection
        ? [onlyCollection]
        : (process.env.COLLECTIONS || 'restaurants,shops,street_vendors').split(',').map(v => v.trim()).filter(Boolean);

    const serviceAccount = readServiceAccount();
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucketName
    });

    const firestore = admin.firestore();
    const bucket = admin.storage().bucket(bucketName);

    const stats = {
        collectionsScanned: 0,
        businessesScanned: 0,
        menuDocsScanned: 0,
        dataUrlsFound: 0,
        remoteUrlsFound: 0,
        alreadyStorageUrl: 0,
        migrated: 0,
        failed: 0,
        skipped: 0
    };

    console.log('===================================================');
    console.log('Menu Image Migration');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Bucket: ${bucket.name}`);
    console.log(`Collections: ${collections.join(', ')}`);
    console.log(`Migrate remote URLs: ${migrateRemote}`);
    console.log('===================================================');

    for (const collectionName of collections) {
        stats.collectionsScanned += 1;
        const businessesSnap = onlyBusinessId
            ? await firestore.collection(collectionName).where(admin.firestore.FieldPath.documentId(), '==', onlyBusinessId).get()
            : await firestore.collection(collectionName).get();

        for (const businessDoc of businessesSnap.docs) {
            stats.businessesScanned += 1;
            const businessId = businessDoc.id;
            const menuSnap = await firestore.collection(collectionName).doc(businessId).collection('menu').get();

            for (const menuDoc of menuSnap.docs) {
                stats.menuDocsScanned += 1;
                const menuData = menuDoc.data() || {};
                const imageUrl = menuData.imageUrl;
                const itemId = menuDoc.id;

                if (!imageUrl || typeof imageUrl !== 'string') {
                    stats.skipped += 1;
                    continue;
                }

                if (isStorageUrl(imageUrl)) {
                    stats.alreadyStorageUrl += 1;
                    continue;
                }

                let newUrl = '';
                try {
                    if (isDataUrlImage(imageUrl)) {
                        stats.dataUrlsFound += 1;
                        if (!dryRun) {
                            newUrl = await uploadFromDataUrl(bucket, imageUrl, collectionName, businessId, itemId);
                        }
                    } else if (migrateRemote && /^https?:\/\//i.test(imageUrl)) {
                        stats.remoteUrlsFound += 1;
                        if (!dryRun) {
                            newUrl = await uploadFromRemoteUrl(bucket, imageUrl, collectionName, businessId, itemId);
                        }
                    } else {
                        stats.skipped += 1;
                        continue;
                    }

                    if (!dryRun) {
                        await menuDoc.ref.update({
                            imageUrl: newUrl,
                            imageMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
                            imageMigratedFrom: 'firestore-inline-or-remote'
                        });
                    }

                    stats.migrated += 1;
                    console.log(`[OK] ${collectionName}/${businessId}/menu/${itemId}`);
                } catch (error) {
                    stats.failed += 1;
                    console.error(`[FAIL] ${collectionName}/${businessId}/menu/${itemId}: ${error.message}`);
                }
            }
        }
    }

    console.log('===================================================');
    console.log('Migration Summary');
    console.log(`Collections scanned:     ${stats.collectionsScanned}`);
    console.log(`Businesses scanned:      ${stats.businessesScanned}`);
    console.log(`Menu docs scanned:       ${stats.menuDocsScanned}`);
    console.log(`Data URLs found:         ${stats.dataUrlsFound}`);
    console.log(`Remote URLs found:       ${stats.remoteUrlsFound}`);
    console.log(`Already Storage URLs:    ${stats.alreadyStorageUrl}`);
    console.log(`Migrated:                ${stats.migrated}`);
    console.log(`Failed:                  ${stats.failed}`);
    console.log(`Skipped:                 ${stats.skipped}`);
    console.log('===================================================');
}

run().catch((error) => {
    console.error('Fatal migration error:', error);
    process.exit(1);
});
