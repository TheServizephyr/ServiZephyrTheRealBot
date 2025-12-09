
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req);

    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || !['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userDoc.data().role)) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', uid).limit(1).get();
        if (!querySnapshot.empty) {
            const restaurantId = querySnapshot.docs[0].id;
            return { uid, restaurantId, collectionName };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

// Hardcoded category configurations
const restaurantCategoryConfig = {
    "starters": true, "main-course": true, "beverages": true,
    "desserts": true, "soup": true, "tandoori-item": true,
    "momos": true, "burgers": true, "rolls": true,
    "tandoori-khajana": true, "rice": true, "noodles": true,
    "pasta": true, "raita": true, 'snacks': true,
    'chaat': true, 'sweets': true,
};

const shopCategoryConfig = {
    "electronics": true, "groceries": true, "clothing": true,
    "books": true, "home-appliances": true, "toys-games": true,
    "beauty-personal-care": true, "sports-outdoors": true,
};

// Basic validation for a single menu item
function validateMenuItem(item) {
    if (!item.name || typeof item.name !== 'string') return "Missing or invalid 'name'";
    if (!item.categoryId || typeof item.categoryId !== 'string') return `Missing 'categoryId' for item: ${item.name}`;

    if (typeof item.isVeg !== 'boolean') {
        item.isVeg = true;
    }

    if (!Array.isArray(item.portions) || item.portions.length === 0) return `Missing or empty 'portions' array for item: ${item.name}`;

    for (const portion of item.portions) {
        if (!portion.name || typeof portion.name !== 'string') return `Invalid portion name for item: ${item.name}`;
        if (typeof portion.price !== 'number' || portion.price < 0) return `Invalid portion price for item: ${item.name}`;
    }
    return null; // No errors
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const { items } = await req.json();

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ message: 'Request body must be a non-empty array of menu items.' }, { status: 400 });
        }

        // Get business document to check businessType and existing categories
        const businessRef = firestore.collection(collectionName).doc(restaurantId);
        const businessSnap = await businessRef.get();
        const businessData = businessSnap.data();
        const businessType = businessData.businessType ||
            (collectionName === 'restaurants' ? 'restaurant' :
                (collectionName === 'shops' ? 'shop' : 'street-vendor'));

        // Street vendors should have NO hardcoded categories - all categories are custom
        const hardcodedCategories = businessType === 'street-vendor'
            ? {} // Empty object - no hardcoded categories for street vendors
            : (businessType === 'restaurant' ? restaurantCategoryConfig : shopCategoryConfig);

        const currentCustomCategories = businessData.customCategories || [];
        console.log(`[Bulk Upload] Current custom categories:`, currentCustomCategories.map(c => c.id).join(', '));

        // Extract unique categories from items
        const uniqueCategories = new Set();
        items.forEach(item => {
            if (item.categoryId) {
                uniqueCategories.add(item.categoryId);
            }
        });
        console.log(`[Bulk Upload] Unique categories in upload:`, Array.from(uniqueCategories).join(', '));

        // Find new categories that need to be saved
        const newCategories = [];
        uniqueCategories.forEach(catId => {
            // Skip if hardcoded or already in custom categories
            if (hardcodedCategories[catId]) {
                console.log(`[Bulk Upload] Category '${catId}' is hardcoded, skipping`);
                return;
            }
            if (currentCustomCategories.some(cat => cat.id === catId)) {
                console.log(`[Bulk Upload] Category '${catId}' already exists in custom categories, skipping`);
                return;
            }

            // New category found - create title from ID
            const title = catId.split('-').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');

            newCategories.push({ id: catId, title });
            console.log(`[Bulk Upload] New category detected: '${catId}' -> '${title}'`);
        });

        const batch = firestore.batch();
        const menuRef = firestore.collection(collectionName).doc(restaurantId).collection('menu');
        const allItems = [];

        // If there are new categories, update business document
        if (newCategories.length > 0) {
            const updatedCategories = [...currentCustomCategories, ...newCategories];
            batch.update(businessRef, { customCategories: updatedCategories });
            console.log(`[Bulk Upload] Adding ${newCategories.length} new categories:`,
                newCategories.map(c => `${c.id} (${c.title})`).join(', '));
        } else {
            console.log(`[Bulk Upload] No new categories to add`);
        }

        for (const item of items) {
            const validationError = validateMenuItem(item);
            if (validationError) {
                return NextResponse.json({ message: `Validation failed: ${validationError}` }, { status: 400 });
            }

            const docRef = menuRef.doc();
            const newItem = {
                id: docRef.id,
                createdAt: FieldValue.serverTimestamp(),
                isAvailable: true, // Default to available
                order: 999, // Default order, can be managed later
                ...item,
                tags: item.tags || [],
                imageUrl: item.imageUrl || '',
            };
            batch.set(docRef, newItem);
            allItems.push(newItem);
        }

        await batch.commit();
        console.log(`[Bulk Upload] Successfully added ${allItems.length} items and ${newCategories.length} new categories`);

        return NextResponse.json({
            message: `Successfully added ${allItems.length} items to your menu!`,
            categoriesAdded: newCategories.length
        }, { status: 201 });

    } catch (error) {
        console.error("BULK MENU UPLOAD ERROR:", error);
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        if (error instanceof SyntaxError) {
            return NextResponse.json({ message: `Invalid JSON format: ${error.message}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
