const admin = require('firebase-admin');

async function run() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    
    let credential = null;
    if (serviceAccountJson) {
        try {
            const parsed = JSON.parse(serviceAccountJson);
            if (parsed.private_key && parsed.private_key.includes('\\n')) {
                parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
            }
            credential = admin.credential.cert(parsed);
        } catch (e) {
            console.error('Error parsing JSON service account:', e);
        }
    } else if (serviceAccountBase64) {
        try {
            const decoded = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
            const parsed = JSON.parse(decoded);
            if (parsed.private_key && parsed.private_key.includes('\\n')) {
                parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
            }
            credential = admin.credential.cert(parsed);
        } catch (e) {
            console.error('Error parsing Base64 service account:', e);
        }
    }
    
    if (!credential) {
        console.error('No service account credential found in env!');
        return;
    }
    
    admin.initializeApp({
        credential
    });
    
    const firestore = admin.firestore();
    
    console.log('--- Checking Collections ---');
    const collections = ['restaurants', 'shops', 'street_vendors'];
    
    for (const col of collections) {
        const snap = await firestore.collection(col).get();
        console.log(`Collection "${col}": ${snap.size} documents`);
        snap.forEach(doc => {
            const data = doc.data();
            console.log(` - ID: ${doc.id}, Name: ${data.name}, isPublished: ${data.isPublished}, isClaimed: ${data.isClaimed}`);
        });
    }
    
    console.log('\n--- Checking Menu Items ---');
    const menuSnap = await firestore.collectionGroup('menu').get();
    console.log(`Total menu items across all subcollections: ${menuSnap.size}`);
    menuSnap.forEach(doc => {
        const data = doc.data();
        console.log(` - Menu Item ID: ${doc.id}, Name: ${data.name}, isAvailable: ${data.isAvailable}, isDeleted: ${data.isDeleted}`);
    });
}

run();
