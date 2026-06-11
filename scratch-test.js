const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (typeof parsed?.private_key === 'string' && parsed.private_key.includes('\\n')) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function test() {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    console.error('No service account found in env vars');
    return;
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  const firestore = admin.firestore();
  const doc = await firestore.collection('restaurants').doc('up-14-food-point-&-chaap-junction').get();
  if (!doc.exists) {
    console.log('Restaurant not found in firestore!');
    return;
  }
  
  console.log('Restaurant exists.');
  const menuSnap = await doc.ref.collection('menu').get();
  console.log('Menu count:', menuSnap.size);
  
  if (menuSnap.size > 0) {
    console.log('First menu item sample:', JSON.stringify({
      id: menuSnap.docs[0].id,
      data: menuSnap.docs[0].data()
    }, null, 2));
  }
}

test();
