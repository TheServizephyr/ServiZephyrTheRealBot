require('dotenv').config({ path: '.env.local' });

var admin = require('firebase-admin');

var raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}
var serviceAccount = JSON.parse(raw);
if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

var db = admin.firestore();

async function run() {
    var restaurantId = 'up-14-food-point-&-chaap-junction';
    // April 25 IST = 2026-04-24T18:30:00Z to 2026-04-25T18:29:59Z
    var startDate = new Date('2026-04-24T18:30:00.000Z');
    var endDate = new Date('2026-04-25T18:29:59.999Z');

    console.log('Fetching orders for ' + restaurantId + ' on April 25 (IST)...');

    var ordersSnap = await db.collection('orders')
        .where('restaurantId', '==', restaurantId)
        .where('orderDate', '>=', startDate)
        .where('orderDate', '<=', endDate)
        .get();

    var count = 0;

    console.log('--- All Orders on April 25 (IST) ---');
    ordersSnap.forEach(function(doc) {
        var data = doc.data();
        count++;

        var orderDateStr = 'Unknown';
        if (data.orderDate) {
            orderDateStr = data.orderDate.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        }

        var isManual = data.isManualCallOrder || String(data.orderSource || '').toLowerCase() === 'manual_call';
        var deliveryType = String(data.deliveryType || data.orderType || '').toLowerCase();
        var type = isManual ? 'MANUAL' : (deliveryType === 'dine-in' || deliveryType === 'dine_in') ? 'DINE-IN' : 'ONLINE';

        console.log('[' + count + '] FirestoreID: ' + doc.id +
            ' | CustomerOrderID: ' + (data.customerOrderId || 'N/A') +
            ' | Status: ' + (data.status || 'unknown') +
            ' | Type: ' + type +
            ' | Date(IST): ' + orderDateStr +
            ' | Amount: Rs.' + (data.totalAmount || 0));
    });

    console.log('');
    console.log('Total orders on 25 April: ' + count);
}

run().then(function() { process.exit(0); }).catch(function(err) {
    console.error(err);
    process.exit(1);
});
