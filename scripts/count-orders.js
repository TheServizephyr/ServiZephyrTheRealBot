const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const localPath = path.join(process.cwd(), 'servizephyr-firebase-adminsdk.json');
let serviceAccount;
if (fs.existsSync(localPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
} else {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkOrders(restaurantId) {
    console.log(`\n========================================`);
    console.log(`Fetching orders for ID: ${restaurantId}...`);
    
    const snap = await db.collection('orders').where('restaurantId', '==', restaurantId).get();
    
    let whatsappOrdersCount = 0;
    let totalOrders = snap.size;
    let otherOnlineOrdersCount = 0;
    let manualOrdersCount = 0;

    const sourceCounts = {};
    const orderTypeCounts = {};

    snap.forEach(doc => {
        const data = doc.data();
        
        const source = data.source || data.orderSource || 'unknown';
        const type = data.orderType || data.typeOfOrder || 'unknown';
        
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
        orderTypeCounts[type] = (orderTypeCounts[type] || 0) + 1;

        if (String(source).toLowerCase().includes('whatsapp')) {
            whatsappOrdersCount++;
        } else if (String(source).toLowerCase().includes('online') || String(source).toLowerCase().includes('web') || String(source).toLowerCase().includes('guest')) {
            otherOnlineOrdersCount++;
        } else if (String(source).toLowerCase().includes('manual')) {
            manualOrdersCount++;
        }
    });
    
    console.log(`Total orders: ${totalOrders}`);
    console.log(`WhatsApp orders: ${whatsappOrdersCount}`);
    console.log(`Other online orders: ${otherOnlineOrdersCount}`);
    console.log(`Manual orders: ${manualOrdersCount}`);
    
    if (totalOrders > 0) {
        console.log('\n--- Breakdown by Source ---');
        for (const [s, count] of Object.entries(sourceCounts)) {
            console.log(`${s}: ${count}`);
        }

        console.log('\n--- Breakdown by Order Type ---');
        for (const [t, count] of Object.entries(orderTypeCounts)) {
            console.log(`${t}: ${count}`);
        }
    }
}

async function run() {
    await checkOrders('up-14-food-point-&-chaap-junction');
    await checkOrders('up-14-food-point-and-chaap-junction');
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
