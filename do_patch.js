const fs = require('fs');

function patch(filePath, searchRegex, replaceText) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(searchRegex, replaceText);
    fs.writeFileSync(filePath, content);
}

const file1 = 'src/services/order/createOrder.service.js';
patch(file1, /const orderId = firestore\.collection\('orders'\)\.doc\(\)\.id;/g, `const ORDER_COLLECTION = body?.isTestOrder ? 'test_orders' : 'orders';
        const orderId = firestore.collection(ORDER_COLLECTION).doc().id;`);

patch(file1, /actorRole = 'customer',[\r\n\s]*\}\) \{[\r\n\s]*if \(!isInventoryManagedBusinessType\(business\?\.type\)\) \{/, `actorRole = 'customer',
    isTestOrder = false,
}) {
    const targetCollection = isTestOrder ? 'test_orders' : 'orders';
    if (!isInventoryManagedBusinessType(business?.type)) {`);

patch(file1, /return orderRepository\.create\(orderData, orderId\);/g, `return orderRepository.create(orderData, orderId, { collection: targetCollection });`);
patch(file1, /const orderRef = firestore\.collection\('orders'\)\.doc\(orderId\);/g, `const orderRef = firestore.collection(targetCollection).doc(orderId);`);
patch(file1, /actorRole: 'customer',(\r?\n\s+)\}\);/g, `actorRole: 'customer',$1isTestOrder: body?.isTestOrder === true,$1});`);

const file2 = 'src/app/api/order/create/route.js';
patch(file2, /if \(FEATURE_FLAGS\.USE_NEW_ORDER_SERVICE\) \{/g, `const isTestOrder = body?.isTestOrder === true;\n        if (FEATURE_FLAGS.USE_NEW_ORDER_SERVICE || isTestOrder) {`);

console.log("SUCCESS!");
