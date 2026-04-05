const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

// Initialize Firebase directly here
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccount = JSON.parse(serviceAccountRaw);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function createTestRestaurant() {
  const bizId = 'load-test-restaurant';
  
  // 1. Create Business Doc
  await db.collection('restaurants').doc(bizId).set({
    name: 'Load Test Speed Restaurant',
    businessId: bizId,
    type: 'restaurant',
    isOpen: true,
    dineInModel: 'post-paid',
    lastOrderToken: 0,
    address: { full: 'Test City, Load Town' },
    coordinates: { lat: 28.6139, lng: 77.2090 }, // Dummy loc
    createdAt: new Date()
  });

  // 2. Create the V2 Delivery Config
  await db.collection('restaurants').doc(bizId).collection('delivery_settings').doc('config').set({
    enabled: true,
    baseDistance: 5,
    baseFee: 10,
    freeDeliveryThreshold: 0
  });

  // 3. Create a Dummy Coupon
  await db.collection('restaurants').doc(bizId).collection('coupons').doc('TESTFREE').set({
    code: 'TESTFREE',
    type: 'flat',
    value: 50,
    status: 'active',
    minOrder: 10
  });

  console.log(`✅ Loaded Test Restaurant: ${bizId}`);
}

createTestRestaurant().then(() => process.exit(0)).catch(console.error);
