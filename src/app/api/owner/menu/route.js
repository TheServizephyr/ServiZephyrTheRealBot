

import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    const restaurantSnap = restaurantsQuery.docs[0];
    
    return { uid, restaurantId: restaurantSnap.id, restaurantSnap };
}

async function seedInitialMenu(firestore, restaurantId) {
    const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');
    const batch = firestore.batch();

    const initialItems = [
        { name: 'Paneer Tikka', description: 'Tandoor-cooked cottage cheese', portions: [{name: 'Half', price: 180}, {name: 'Full', price: 280}], isVeg: true, isAvailable: true, categoryId: 'starters', order: 1, imageUrl: `https://picsum.photos/seed/paneertikka/100/100`, tags: ["Bestseller"], addOnGroups: [] },
        { name: 'Chilli Chicken', description: 'Spicy diced chicken', portions: [{name: 'Half', price: 200}, {name: 'Full', price: 320}], isVeg: false, isAvailable: true, categoryId: 'starters', order: 2, imageUrl: `https://picsum.photos/seed/chillichicken/100/100`, tags: ["Most Reordered"], addOnGroups: [] },
        { name: 'Dal Makhani', description: 'Creamy black lentils', portions: [{name: 'Full', price: 250}], isVeg: true, isAvailable: true, categoryId: 'main-course', order: 1, imageUrl: `https://picsum.photos/seed/dalmakhani/100/100`, addOnGroups: [
            { title: "Select Your Bread", options: [{name: "Tandoori Roti", price: 15}, {name: "Butter Naan", price: 30}], required: true, type: "radio" },
        ]},
        { name: 'Veg Steamed Momos', description: '8 Pcs, served with chutney', portions: [{name: 'Full', price: 120}], isVeg: true, isAvailable: true, categoryId: 'momos', order: 1, imageUrl: `https://picsum.photos/seed/vegmomos/100/100`, tags: ["Chef's Special"], addOnGroups: [] },
    ];
    
    initialItems.forEach(itemData => {
        const docRef = menuRef.doc();
        const newItem = {
            id: docRef.id,
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
            ...itemData
        };
        batch.set(docRef, newItem);
    });

    await batch.commit();
    
    const seededMenuSnap = await menuRef.get();
    const menuData = {};
    const categoryKeys = ["momos", "burgers", "rolls", "soup", "tandoori-item", "starters", "main-course", "tandoori-khajana", "rice", "noodles", "pasta", "raita", "desserts", "beverages"];
    categoryKeys.forEach(key => { menuData[key] = []; });

    seededMenuSnap.docs.forEach(doc => {
        const item = { id: doc.id, ...doc.data() };
        if (item.categoryId && menuData[item.categoryId]) {
            menuData[item.categoryId].push(item);
        }
    });

    Object.keys(menuData).forEach(key => {
        menuData[key].sort((a, b) => a.order - b.order);
    });

    return menuData;
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');
        const menuSnap = await menuRef.get();

        let menuData = {};
        const restaurantData = restaurantSnap.data();
        // Custom categories are now objects {id: string, title: string}
        const customCategories = restaurantData.customCategories || [];

        const defaultCategoryKeys = ["momos", "burgers", "rolls", "soup", "tandoori-item", "starters", "main-course", "tandoori-khajana", "rice", "noodles", "pasta", "raita", "desserts", "beverages"];
        
        // Combine default keys with custom category IDs
        const allCategoryKeys = [...new Set([...defaultCategoryKeys, ...customCategories.map(c => c.id)])];

        if (menuSnap.empty) {
            menuData = await seedInitialMenu(firestore, restaurantId);
        } else {
            allCategoryKeys.forEach(key => {
                menuData[key] = [];
            });

            menuSnap.docs.forEach(doc => {
                const item = doc.data();
                if (item.categoryId && menuData.hasOwnProperty(item.categoryId)) {
                    menuData[item.categoryId].push({ id: doc.id, ...item });
                } else if (item.categoryId) {
                    // This case handles if a category exists in an item but not in the combined list (edge case)
                    menuData[item.categoryId] = [{ id: doc.id, ...item }];
                }
            });

            Object.keys(menuData).forEach(key => {
                menuData[key].sort((a, b) => (a.order || 0) - (b.order || 0));
            });
        }

        return NextResponse.json({ menu: menuData, customCategories: customCategories }, { status: 200 });

    } catch (error) {
        console.error("GET MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { item, categoryId, newCategory, isEditing } = await req.json();

        if (!item || !item.name || !item.portions || item.portions.length === 0) {
            return NextResponse.json({ message: 'Missing required item data. Name and at least one portion are required.' }, { status: 400 });
        }

        const batch = firestore.batch();
        const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');
        
        let finalCategoryId = categoryId;

        // --- BATCH LOGIC ---

        // Step 1: Handle new category creation if applicable
        if (showNewCategory && newCategory) {
            const formattedId = newCategory.toLowerCase().replace(/\s+/g, '-');
            finalCategoryId = formattedId;
            const restaurantRef = restaurantSnap.ref;
            const restaurantData = restaurantSnap.data();
            const currentCategories = restaurantData.customCategories || [];
            
            // Check if the category already exists to prevent duplicates
            if (!currentCategories.some(cat => cat.id === formattedId)) {
                const newCategoryObject = { id: formattedId, title: newCategory };
                batch.update(restaurantRef, { 
                    customCategories: adminFirestore.FieldValue.arrayUnion(newCategoryObject) 
                });
            }
        }
        
        // Step 2: Prepare the menu item data
        const finalItem = {
            ...item,
            categoryId: finalCategoryId,
            portions: item.portions || [],
            addOnGroups: item.addOnGroups || [],
        };

        let newItemId = item.id;
        
        // Step 3: Add the item operation (create or update) to the batch
        if (isEditing) {
            if (!item.id) return NextResponse.json({ message: 'Item ID is required for editing.' }, { status: 400 });
            const itemRef = menuRef.doc(item.id);
            const { id, createdAt, ...updateData } = finalItem;
            batch.update(itemRef, updateData);
        } else {
            const categoryQuerySnap = await menuRef.where('categoryId', '==', finalCategoryId).orderBy('order', 'desc').limit(1).get();
            const maxOrder = categoryQuerySnap.empty ? 0 : (categoryQuerySnap.docs[0].data().order || 0);
            
            const newItemRef = menuRef.doc();
            newItemId = newItemRef.id;

            batch.set(newItemRef, {
                ...finalItem,
                id: newItemId,
                order: maxOrder + 1,
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            });
        }

        // Step 4: Commit the entire batch
        await batch.commit();

        const message = isEditing ? 'Item updated successfully!' : 'Item added successfully!';
        const status = isEditing ? 200 : 201;

        return NextResponse.json({ message, id: newItemId }, { status });

    } catch (error) {
        console.error("POST MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { itemId } = await req.json();

        if (!itemId) {
            return NextResponse.json({ message: 'Item ID is required.' }, { status: 400 });
        }

        const itemRef = firestore.collection('restaurants').doc(restaurantId).collection('menu').doc(itemId);
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
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { itemIds, action, updates } = await req.json();
        
        const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');

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

        return NextResponse.json({ message: `Bulk action '${action}' completed successfully.` }, { status: 200 });
    } catch (error) {
        console.error("PATCH MENU ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
