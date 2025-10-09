

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
    const restaurantDoc = restaurantsQuery.docs[0];
    
    return { uid, restaurantId: restaurantDoc.id, restaurantDoc };
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
        const { restaurantId, restaurantDoc } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');
        const menuSnap = await menuRef.get();

        let menuData = {};
        const restaurantData = restaurantDoc.data();
        const customCategories = restaurantData.customCategories || [];

        const defaultCategoryKeys = ["momos", "burgers", "rolls", "soup", "tandoori-item", "starters", "main-course", "tandoori-khajana", "rice", "noodles", "pasta", "raita", "desserts", "beverages"];
        const allCategoryKeys = [...new Set([...defaultCategoryKeys, ...customCategories])];

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
        const { restaurantId, restaurantDoc } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { item, categoryId, newCategory, isEditing } = await req.json();

        const finalCategoryId = newCategory ? newCategory.toLowerCase().replace(/\s+/g, '-') : categoryId;

        if (!item || !item.name || !item.portions || item.portions.length === 0) {
            return NextResponse.json({ message: 'Missing required item data. Name and at least one portion are required.' }, { status: 400 });
        }
        
        const menuRef = firestore.collection('restaurants').doc(restaurantId).collection('menu');
        
        const finalItem = {
            ...item,
            portions: item.portions || [],
            addOnGroups: item.addOnGroups || [],
        };
        
        // If a new category was created, add it to the restaurant's custom category list
        if (newCategory) {
            const restaurantRef = restaurantDoc.ref;
            await restaurantRef.update({
                customCategories: adminFirestore.FieldValue.arrayUnion(finalCategoryId)
            });
        }


        if (isEditing) {
            if (!item.id) return NextResponse.json({ message: 'Item ID is required for editing.' }, { status: 400 });
            const itemRef = menuRef.doc(item.id);
            const { id, categoryId: ignoredCategoryId, order, createdAt, ...updateData } = finalItem;
            await itemRef.update(updateData);
            return NextResponse.json({ message: 'Item updated successfully!', id: item.id }, { status: 200 });
        } else {
            const categoryQuery = await menuRef.where('categoryId', '==', finalCategoryId).orderBy('order', 'desc').limit(1).get();
            const maxOrder = categoryQuery.empty ? 0 : (categoryQuery.docs[0].data().order || 0);
            const newItemRef = menuRef.doc();
            await newItemRef.set({
                ...finalItem,
                id: newItemRef.id,
                categoryId: finalCategoryId,
                order: maxOrder + 1,
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            });
            return NextResponse.json({ message: 'Item added successfully!', id: newItemRef.id }, { status: 201 });
        }

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
