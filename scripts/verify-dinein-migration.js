/**
 * Verification Script for Dine-In Migration
 * 
 * Verifies that migrated data matches original data
 * 
 * Run: node scripts/verify-dinein-migration.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../servizephyr-firebase-adminsdk.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();
const BACKUP_DIR = path.join(__dirname, '../backups/dinein-migration');

const results = {
    total: 0,
    verified: 0,
    mismatches: [],
    missing: []
};

/**
 * Verify a single tab
 */
async function verifyTab(tabId) {
    try {
        results.total++;

        // Read backup
        const backupPath = path.join(BACKUP_DIR, `${tabId}.json`);
        if (!fs.existsSync(backupPath)) {
            results.missing.push({ tabId, reason: 'No backup found' });
            return;
        }

        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        const originalOrders = backup.orders || [];

        // Get current subcollection
        const tabDocs = await firestore.collectionGroup('dine_in_tabs')
            .where(admin.firestore.FieldPath.documentId(), '==', tabId)
            .get();

        if (tabDocs.empty) {
            results.missing.push({ tabId, reason: 'Tab not found' });
            return;
        }

        const tabRef = tabDocs.docs[0].ref;
        const ordersSnapshot = await tabRef.collection('orders').get();
        const migratedOrders = ordersSnapshot.docs.map(doc => doc.data());

        // Compare counts
        if (originalOrders.length !== migratedOrders.length) {
            results.mismatches.push({
                tabId,
                issue: 'Order count mismatch',
                original: originalOrders.length,
                migrated: migratedOrders.length
            });
            return;
        }

        // Compare order IDs
        const originalIds = new Set(originalOrders.map(o => o.id || o.orderId));
        const migratedIds = new Set(migratedOrders.map(o => o.id || o.orderId));

        const missingIds = [...originalIds].filter(id => !migratedIds.has(id));
        if (missingIds.length > 0) {
            results.mismatches.push({
                tabId,
                issue: 'Missing orders',
                missingIds
            });
            return;
        }

        console.log(`✅ Tab ${tabId} verified (${migratedOrders.length} orders)`);
        results.verified++;

    } catch (error) {
        results.mismatches.push({
            tabId,
            issue: 'Verification error',
            error: error.message
        });
    }
}

/**
 * Main verification
 */
async function verify() {
    console.log('🔍 Starting migration verification...\n');

    // Get all backups
    const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));

    console.log(`Found ${backups.length} backups to verify\n`);

    for (const tabId of backups) {
        await verifyTab(tabId);
    }

    // Summary
    console.log('\n═══════════════════════════════════════');
    console.log('📊 Verification Summary');
    console.log('═══════════════════════════════════════');
    console.log(`Total Tabs:           ${results.total}`);
    console.log(`Verified OK:          ${results.verified}`);
    console.log(`Mismatches:           ${results.mismatches.length}`);
    console.log(`Missing:              ${results.missing.length}`);
    console.log('═══════════════════════════════════════');

    if (results.mismatches.length > 0) {
        console.log('\n❌ Mismatches:');
        results.mismatches.forEach(m => {
            console.log(`  ${m.tabId}: ${m.issue}`);
            if (m.missingIds) console.log(`    Missing: ${m.missingIds.join(', ')}`);
            if (m.error) console.log(`    Error: ${m.error}`);
        });
    }

    if (results.missing.length > 0) {
        console.log('\n⚠️  Missing:');
        results.missing.forEach(m => {
            console.log(`  ${m.tabId}: ${m.reason}`);
        });
    }

    if (results.verified === results.total) {
        console.log('\n✅ All tabs verified successfully!');
    } else {
        console.log('\n⚠️  Some tabs have issues - review above');
    }
}

verify()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Verification failed:', err);
        process.exit(1);
    });
