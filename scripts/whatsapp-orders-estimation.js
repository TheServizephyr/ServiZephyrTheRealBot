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

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function run() {
    const restaurantId = 'up-14-food-point-&-chaap-junction';
    console.log(`Fetching orders and conversations for ${restaurantId}...`);
    
    // 1. Get all orders
    const ordersSnap = await db.collection('orders').where('restaurantId', '==', restaurantId).get();
    
    let totalOnlineOrders = 0;
    let whatsappLinkedOrders = 0;
    
    // 2. Get all conversations (WhatsApp interactions)
    const conversationsSnap = await db.collection('restaurants').doc(restaurantId).collection('conversations').get();
    const whatsappPhones = new Set();
    
    conversationsSnap.forEach(doc => {
        whatsappPhones.add(normalizePhone(doc.id));
    });
    
    console.log(`Found ${whatsappPhones.size} unique WhatsApp conversations for this restaurant.`);

    ordersSnap.forEach(doc => {
        const data = doc.data();
        
        // Skip manual orders
        if (data.isManualCallOrder || String(data.orderSource || '').toLowerCase() === 'manual_call') {
            return;
        }
        
        // Skip dine-in
        const deliveryType = String(data.deliveryType || data.orderType || '').toLowerCase();
        if (deliveryType === 'dine-in' || deliveryType === 'dine_in') {
            return;
        }

        totalOnlineOrders++;
        
        const phone = normalizePhone(data.customerPhone || data.phone);
        if (phone && whatsappPhones.has(phone)) {
            whatsappLinkedOrders++;
        }
    });
    
    console.log(`\nResults:`);
    console.log(`Total Online Orders: ${totalOnlineOrders}`);
    console.log(`Orders by customers who interacted via WhatsApp: ${whatsappLinkedOrders}`);
    console.log(`Other online orders (Web/App only): ${totalOnlineOrders - whatsappLinkedOrders}`);
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
