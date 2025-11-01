
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is managing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, collectionName: 'restaurants', isAdmin: userRole === 'admin' };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, collectionName: 'shops', isAdmin: userRole === 'admin' };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, businessSnap, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
        const menuSnap = await menuRef.get();

        let menuData = {};
        const businessData = businessSnap.data();
        const customCategories = businessData.customCategories || [];

        const businessType = businessData.businessType || (collectionName === 'restaurants' ? 'restaurant' : 'shop');
        
        const defaultRestaurantCategories = ["momos", "burgers", "rolls", "soup", "tandoori-item", "starters", "main-course", "tandoori-khajana", "rice", "noodles", "pasta", "raita", "desserts", "beverages"];
        const defaultShopCategories = ["electronics", "groceries", "clothing", "books", "home-appliances", "toys-games", "beauty-personal-care", "sports-outdoors"];
        
        const defaultCategoryKeys = businessType === 'restaurant' ? defaultRestaurantCategories : defaultShopCategories;
        
        const allCategoryKeys = [...new Set([...defaultCategoryKeys, ...customCategories.map(c => c.id)])];

        allCategoryKeys.forEach(key => {
            menuData[key] = [];
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            if (item.categoryId && menuData.hasOwnProperty(item.categoryId)) {
                menuData[item.categoryId].push({ id: doc.id, ...item });
            } else if (item.categoryId) {
                menuData[item.categoryId] = [{ id: doc.id, ...item }];
            }
        });

        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 0) - (b.order || 0));
        });

        return NextResponse.json({ menu: menuData, customCategories: customCategories, businessType: businessType }, { status: 200 });

    } catch (error) {
        console.error("GET MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    console.log("[API LOG] Received POST request to /api/owner/menu");
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        console.log("[API LOG] Firebase Admin SDK initialized.");

        const { businessId, businessSnap, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        console.log(`[API LOG] Owner verified for business ID: ${businessId}`);

        const { item, categoryId, newCategory, isEditing } = await req.json();
        console.log("[API LOG] Request body parsed:", { isEditing, categoryId, newCategory: !!newCategory });

        if (!item || !item.name || !item.portions || item.portions.length === 0) {
            console.error("[API LOG] Validation Failed: Missing required item data.");
            return NextResponse.json({ message: 'Missing required item data. Name and at least one portion are required.' }, { status: 400 });
        }

        const batch = firestore.batch();
        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
        
        let finalCategoryId = categoryId;

        if (newCategory && newCategory.trim() !== '') {
            console.log(`[API LOG] New category detected: "${newCategory}"`);
            const formattedId = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
            finalCategoryId = formattedId;
            
            const businessRef = businessSnap.ref;
            const businessData = businessSnap.data();
            const currentCategories = businessData.customCategories || [];
            
            if (!currentCategories.some(cat => cat.id === formattedId)) {
                console.log(`[API LOG] Category "${formattedId}" does not exist. Adding to batch.`);
                const newCategoryObject = { id: formattedId, title: newCategory.trim() };
                const updatedCategories = [...currentCategories, newCategoryObject];
                batch.update(businessRef, { customCategories: updatedCategories });
            } else {
                console.log(`[API LOG] Category "${formattedId}" already exists.`);
            }
        }
        
        const finalItem = {
            ...item,
            categoryId: finalCategoryId,
            portions: item.portions || [],
            addOnGroups: item.addOnGroups || [],
        };

        let newItemId = item.id;
        
        if (isEditing) {
            console.log(`[API LOG] Editing item ID: ${item.id}. Adding update to batch.`);
            if (!item.id) {
                console.error("[API LOG] Edit failed: No item ID provided.");
                return NextResponse.json({ message: 'Item ID is required for editing.' }, { status: 400 });
            }
            const itemRef = menuRef.doc(item.id);
            const { id, createdAt, ...updateData } = finalItem;
            batch.update(itemRef, updateData);
        } else {
            console.log(`[API LOG] Creating new item in category: ${finalCategoryId}.`);
            const categoryQuerySnap = await menuRef.where('categoryId', '==', finalCategoryId).orderBy('order', 'desc').limit(1).get();
            const maxOrder = categoryQuerySnap.empty ? 0 : (categoryQuerySnap.docs[0].data().order || 0);
            console.log(`[API LOG] Max order in category is ${maxOrder}. New order will be ${maxOrder + 1}.`);
            
            const newItemRef = menuRef.doc();
            newItemId = newItemRef.id;

            batch.set(newItemRef, {
                ...finalItem,
                id: newItemId,
                order: maxOrder + 1,
                createdAt: FieldValue.serverTimestamp(),
            });
            console.log(`[API LOG] New item with ID ${newItemId} added to batch.`);
        }

        console.log("[API LOG] Committing batch...");
        await batch.commit();
        console.log("[API LOG] Batch commit successful!");

        const message = isEditing ? 'Item updated successfully!' : 'Item added successfully!';
        const status = isEditing ? 200 : 201;

        return NextResponse.json({ message, id: newItemId }, { status });

    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in POST /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { itemId } = await req.json();

        if (!itemId) {
            return NextResponse.json({ message: 'Item ID is required.' }, { status: 400 });
        }

        const itemRef = firestore.collection(collectionName).doc(businessId).collection('menu').doc(itemId);
        await itemRef.delete();

        return NextResponse.json({ message: 'Item deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { itemIds, action, updates } = await req.json();
        
        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');

        if (updates && updates.id) {
            const itemRef = menuRef.doc(updates.id);
            await itemRef.update({ isAvailable: updates.isAvailable });
            return NextResponse.json({ message: 'Item availability updated.' }, { status: 200 });
        }

        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !action) {
            return NextResponse.json({ message: 'Item IDs array and action are required for bulk updates.' }, { status: 400 });
        }

        const batch = firestore.batch();
        itemIds.forEach(itemId => {
            const itemRef = menuRef.doc(itemId);
            if (action === 'delete') {
                batch.delete(itemRef);
            } else if (action === 'outOfStock') {
                batch.update(itemRef, { isAvailable: false });
            }
        });

        await batch.commit();

        return NextResponse.json({ message: `Bulk action '${action}' completed successfully on ${itemIds.length} items.` }, { status: 200 });

    } catch (error) {
        console.error("PATCH MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
