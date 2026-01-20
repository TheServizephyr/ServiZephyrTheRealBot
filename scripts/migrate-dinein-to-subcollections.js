/**
 * Dine-In Subcollection Migration Script
 * 
 * Migrates orders from array-based storage to subcollection pattern
 * 
 * BEFORE: dine_in_tabs.orders = [ {order1}, {order2}, ... ]
 * AFTER:  dine_in_tabs/{tabId}/orders/{orderId} = {orderData}
 * 
 * Run: node scripts/migrate-dinein-to-subcollections.js
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

// Configuration
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to dry run for safety
const BATCH_SIZE = 50;
const BACKUP_DIR = path.join(__dirname, '../backups/dinein-migration');

// Statistics
const stats = {
    totalTabs: 0,
    migratedTabs: 0,
    totalOrders: 0,
    migratedOrders: 0,
    errors: [],
    skipped: []
};

/**
 * Create backup directory
 */
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

/**
 * Backup tab data before migration
 */
async function backupTab(tabId, tabData) {
    const backupPath = path.join(BACKUP_DIR, `${tabId}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(tabData, null, 2));
    console.log(`✅ Backed up tab ${tabId}`);
}

/**
 * Migrate a single tab's orders from array to subcollection
 */
async function migrateTab(restaurantId, tabId, tabData) {
    try {
        // Backup first
        await backupTab(tabId, tabData);

        const orders = tabData.orders || [];

        if (orders.length === 0) {
            console.log(`⏭️  Tab ${tabId} has no orders, skipping`);
            stats.skipped.push({ tabId, reason: 'no_orders' });
            return;
        }

        stats.totalOrders += orders.length;

        if (DRY_RUN) {
            console.log(`🔍 [DRY RUN] Would migrate ${orders.length} orders for tab ${tabId}`);
            stats.migratedTabs++;
            stats.migratedOrders += orders.length;
            return;
        }

        // Perform migration in transaction
        await firestore.runTransaction(async (transaction) => {
            const tabRef = firestore
                .collection('restaurants')
                .doc(restaurantId)
                .collection('dine_in_tabs')
                .doc(tabId);

            // 1. Create subcollection entries
            for (const order of orders) {
                const orderId = order.id || order.orderId;
                if (!orderId) {
                    throw new Error(`Order missing ID in tab ${tabId}`);
                }

                const orderRef = tabRef.collection('orders').doc(orderId);
                transaction.set(orderRef, {
                    ...order,
                    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                    migratedFrom: 'array'
                });
            }

            // 2. Mark tab as migrated (keep array for rollback)
            transaction.update(tabRef, {
                ordersArray: orders, // Backup
                orders: admin.firestore.FieldValue.delete(), // Remove array
                migrated: true,
                migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                ordersCount: orders.length
            });
        });

        console.log(`✅ Migrated ${orders.length} orders for tab ${tabId}`);
        stats.migratedTabs++;
        stats.migratedOrders += orders.length;

    } catch (error) {
        console.error(`❌ Error migrating tab ${tabId}:`, error.message);
        stats.errors.push({ tabId, error: error.message });
    }
}

/**
 * Find all active dine-in tabs across all restaurants
 */
async function findAllActiveTabs() {
    const tabs = [];

    // Get all restaurants
    const restaurantsSnapshot = await firestore.collection('restaurants').get();

    for (const restaurantDoc of restaurantsSnapshot.docs) {
        const restaurantId = restaurantDoc.id;

        // Get all active tabs for this restaurant
        const tabsSnapshot = await firestore
            .collection('restaurants')
            .doc(restaurantId)
            .collection('dine_in_tabs')
            .where('status', '==', 'active')
            .get();

        for (const tabDoc of tabsSnapshot.docs) {
            const tabData = tabDoc.data();

            // Only migrate if tab has orders array and not already migrated
            if (tabData.orders && Array.isArray(tabData.orders) && !tabData.migrated) {
                tabs.push({
                    restaurantId,
                    tabId: tabDoc.id,
                    tabData
                });
            }
        }
    }

    return tabs;
}

/**
 * Main migration function
 */
async function migrate() {
    console.log('🚀 Dine-In Subcollection Migration Started');
    console.log(`📍 Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE MIGRATION'}`);
    console.log('');

    ensureBackupDir();

    // Find all tabs to migrate
    console.log('🔍 Finding active tabs with orders array...');
    const tabs = await findAllActiveTabs();
    stats.totalTabs = tabs.length;

    console.log(`📊 Found ${tabs.length} tabs to migrate`);
    console.log('');

    if (tabs.length === 0) {
        console.log('✅ No tabs to migrate!');
        return;
    }

    // Migrate in batches
    for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
        const batch = tabs.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} tabs)`);

        for (const { restaurantId, tabId, tabData } of batch) {
            await migrateTab(restaurantId, tabId, tabData);
        }
    }

    // Print summary
    console.log('\n');
    console.log('═══════════════════════════════════════');
    console.log('📊 Migration Summary');
    console.log('═══════════════════════════════════════');
    console.log(`Total Tabs Found:     ${stats.totalTabs}`);
    console.log(`Tabs Migrated:        ${stats.migratedTabs}`);
    console.log(`Tabs Skipped:         ${stats.skipped.length}`);
    console.log(`Total Orders:         ${stats.totalOrders}`);
    console.log(`Orders Migrated:      ${stats.migratedOrders}`);
    console.log(`Errors:               ${stats.errors.length}`);
    console.log('═══════════════════════════════════════');

    if (stats.skipped.length > 0) {
        console.log('\n⏭️  Skipped Tabs:');
        stats.skipped.forEach(({ tabId, reason }) => {
            console.log(`  - ${tabId}: ${reason}`);
        });
    }

    if (stats.errors.length > 0) {
        console.log('\n❌ Errors:');
        stats.errors.forEach(({ tabId, error }) => {
            console.log(`  - ${tabId}: ${error}`);
        });
    }

    console.log(`\n💾 Backups saved to: ${BACKUP_DIR}`);

    if (DRY_RUN) {
        console.log('\n⚠️  This was a DRY RUN - no changes were made');
        console.log('Run with DRY_RUN=false to perform actual migration');
    } else {
        console.log('\n✅ Migration complete!');
    }
}

/**
 * Rollback function - restores from backup
 */
async function rollback(tabId) {
    console.log(`🔄 Rolling back tab ${tabId}...`);

    const backupPath = path.join(BACKUP_DIR, `${tabId}.json`);

    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup not found for tab ${tabId}`);
    }

    const tabData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

    // Find restaurant (assuming single restaurant for now)
    const tabDocs = await firestore.collectionGroup('dine_in_tabs')
        .where(admin.firestore.FieldPath.documentId(), '==', tabId)
        .get();

    if (tabDocs.empty) {
        throw new Error(`Tab ${tabId} not found in database`);
    }

    const tabRef = tabDocs.docs[0].ref;

    await firestore.runTransaction(async (transaction) => {
        // Delete subcollection
        const ordersSnapshot = await tabRef.collection('orders').get();
        ordersSnapshot.docs.forEach(doc => {
            transaction.delete(doc.ref);
        });

        // Restore array
        transaction.update(tabRef, {
            orders: tabData.ordersArray || tabData.orders,
            migrated: false,
            ordersArray: admin.firestore.FieldValue.delete(),
            rolledBackAt: admin.firestore.FieldValue.serverTimestamp()
        });
    });

    console.log(`✅ Rolled back tab ${tabId}`);
}

// CLI
const command = process.argv[2];

if (command === 'rollback') {
    const tabId = process.argv[3];
    if (!tabId) {
        console.error('Usage: node migrate-dinein-to-subcollections.js rollback <tabId>');
        process.exit(1);
    }
    rollback(tabId)
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Rollback failed:', err);
            process.exit(1);
        });
} else {
    migrate()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Migration failed:', err);
            process.exit(1);
        });
}
