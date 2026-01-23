// Bulk Cancel LoadTest Orders Script
// Run this with: node cancel-loadtest-orders.js

const admin = require('firebase-admin');

// Initialize Firebase Admin using environment variables
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID || 'servizephyr',
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

const db = admin.firestore();

async function cancelLoadTestOrders() {
    try {
        console.log('🔍 Searching for LoadTest orders in ashwani\'s-restaurant...\n');

        // Query all collections to find the restaurant
        const collections = ['restaurants', 'shops', 'street_vendors'];
        let restaurantId = null;
        let collectionName = null;

        for (const col of collections) {
            const snapshot = await db.collection(col)
                .where('restaurantName', '==', 'ashwani\'s-restaurant')
                .limit(1)
                .get();

            if (!snapshot.empty) {
                restaurantId = snapshot.docs[0].id;
                collectionName = col;
                console.log(`✅ Found restaurant in ${col}: ${restaurantId}\n`);
                break;
            }
        }

        if (!restaurantId) {
            console.log('❌ Restaurant not found!');
            return;
        }

        // Get all orders for this restaurant
        const ordersSnapshot = await db.collection('orders')
            .where('restaurantId', '==', restaurantId)
            .get();

        console.log(`📦 Total orders found: ${ordersSnapshot.size}\n`);

        // Filter LoadTest orders
        const loadTestOrders = [];
        ordersSnapshot.forEach(doc => {
            const data = doc.data();
            const customerName = data.customerName || '';
            const items = data.items || [];

            // Check if it's a LoadTest order
            if (customerName.includes('LoadTest') ||
                customerName.includes('Test') ||
                items.some(item => item.name && item.name.includes('LoadTest'))) {
                loadTestOrders.push({
                    id: doc.id,
                    customerName: customerName,
                    status: data.status,
                    createdAt: data.createdAt?.toDate?.() || 'Unknown'
                });
            }
        });

        console.log(`🎯 LoadTest orders found: ${loadTestOrders.length}\n`);

        if (loadTestOrders.length === 0) {
            console.log('✨ No LoadTest orders to cancel!');
            return;
        }

        // Display orders
        console.log('Orders to be cancelled:');
        console.log('─'.repeat(80));
        loadTestOrders.forEach((order, index) => {
            console.log(`${index + 1}. ${order.id} | ${order.customerName} | ${order.status}`);
        });
        console.log('─'.repeat(80));
        console.log('');

        // Batch cancel
        console.log('🔄 Starting bulk cancellation...\n');

        const batch = db.batch();
        let cancelledCount = 0;

        for (const order of loadTestOrders) {
            // Only cancel if not already cancelled or completed
            if (order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'completed') {
                const orderRef = db.collection('orders').doc(order.id);
                batch.update(orderRef, {
                    status: 'cancelled',
                    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
                    cancelledBy: 'bulk_cleanup_script',
                    cancellationReason: 'LoadTest cleanup'
                });
                cancelledCount++;
                console.log(`✅ Queued for cancellation: ${order.id}`);
            } else {
                console.log(`⏭️  Skipped (already ${order.status}): ${order.id}`);
            }
        }

        if (cancelledCount > 0) {
            await batch.commit();
            console.log(`\n🎉 Successfully cancelled ${cancelledCount} LoadTest orders!`);
        } else {
            console.log('\n📌 No orders needed cancellation (all already cancelled/completed)');
        }

        // Summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 SUMMARY:');
        console.log(`   Total LoadTest orders found: ${loadTestOrders.length}`);
        console.log(`   Cancelled: ${cancelledCount}`);
        console.log(`   Skipped: ${loadTestOrders.length - cancelledCount}`);
        console.log('='.repeat(80));

    } catch (error) {
        console.error('❌ Error:', error);
        throw error;
    }
}

// Run the script
console.log('🚀 Starting LoadTest Order Cleanup Script\n');
console.log('⚠️  WARNING: This will cancel all LoadTest orders!');
console.log('Press Ctrl+C to abort, or wait 3 seconds to continue...\n');

setTimeout(() => {
    cancelLoadTestOrders()
        .then(() => {
            console.log('\n✅ Script completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}, 3000);
