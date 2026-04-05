const fs = require('fs');

// 1. Revert createOrder.service.js
let svc = fs.readFileSync('src/services/order/createOrder.service.js', 'utf8');

// Remove ORDER_COLLECTION line, fix orderId line
svc = svc.replace(
  /const ORDER_COLLECTION = body\?\.isTestOrder \? 'test_orders' : 'orders';\s*\n\s*const orderId = firestore\.collection\(ORDER_COLLECTION\)\.doc\(\)\.id;/,
  `const orderId = firestore.collection('orders').doc().id;`
);

// Remove isTestOrder from persistOrderWithInventory call
svc = svc.replace(
  /actorRole: 'customer',\s*\n\s*isTestOrder: body\?\.isTestOrder === true,\s*\n\s*\}\);/,
  `actorRole: 'customer',\n        });`
);

// Revert persistOrderWithInventory signature + targetCollection
svc = svc.replace(
  /actorRole = 'customer',\s*\n\s*isTestOrder = false,\s*\n\s*\}\) \{\s*\n\s*const targetCollection = isTestOrder \? 'test_orders' : 'orders';\s*\n\s*if \(!isInventoryManagedBusinessType/,
  `actorRole = 'customer',\n}) {\n    if (!isInventoryManagedBusinessType`
);

// Fix orderRepository.create call
svc = svc.replace(
  /return orderRepository\.create\(orderData, orderId, \{ collection: targetCollection \}\);/,
  `return orderRepository.create(orderData, orderId);`
);

// Fix orderRef
svc = svc.replace(
  /const orderRef = firestore\.collection\(targetCollection\)\.doc\(orderId\);/,
  `const orderRef = firestore.collection('orders').doc(orderId);`
);

fs.writeFileSync('src/services/order/createOrder.service.js', svc);
console.log('✅ createOrder.service.js reverted');

// 2. Revert order.repository.js
let repo = fs.readFileSync('src/repositories/order.repository.js', 'utf8');
repo = repo.replace(
  /async create\(orderData, customId = null, options = \{\}\) \{\s*\n\s*const firestore = await getFirestore\(\);\s*\n\s*const targetCollection = options\.collection \|\| this\.collectionName;\s*\n\s*const docRef = customId\s*\n\s*\? firestore\.collection\(targetCollection\)\.doc\(customId\)\s*\n\s*: firestore\.collection\(targetCollection\)\.doc\(\);/,
  `async create(orderData, customId = null) {\n        const firestore = await getFirestore();\n        const docRef = customId\n            ? firestore.collection(this.collectionName).doc(customId)\n            : firestore.collection(this.collectionName).doc();`
);
fs.writeFileSync('src/repositories/order.repository.js', repo);
console.log('✅ order.repository.js reverted');

// 3. Revert route.js - remove isTestOrder force-V2
let route = fs.readFileSync('src/app/api/order/create/route.js', 'utf8');
route = route.replace(
  /const isTestOrder = body\?\.isTestOrder === true; if \(FEATURE_FLAGS\.USE_NEW_ORDER_SERVICE \|\| isTestOrder\) \{/,
  `if (FEATURE_FLAGS.USE_NEW_ORDER_SERVICE) {`
);
fs.writeFileSync('src/app/api/order/create/route.js', route);
console.log('✅ route.js reverted');

// 4. Delete temp files
const toDelete = [
  'do_patch.js', 'patch.js', 'seed_test_restaurant.js',
  'seed_menu_snapshot.js', 'check_menu.js', 'check_item_structure.js',
  'debug_single_order.js'
];
toDelete.forEach(f => {
  try { fs.unlinkSync(f); console.log('🗑️  Deleted', f); }
  catch { /* already gone */ }
});

console.log('\n✅ ALL DONE — clean slate!');
