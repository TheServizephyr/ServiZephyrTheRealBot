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

async function run() {
    const restaurantId = 'up-14-food-point-&-chaap-junction';
    console.log(`Fetching sample unknown orders for ${restaurantId}...`);
    
    const snap = await db.collection('orders').where('restaurantId', '==', restaurantId).limit(5).get();
    
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`\nOrder ID: ${doc.id}`);
        console.log(JSON.stringify(data, null, 2));
    });
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
