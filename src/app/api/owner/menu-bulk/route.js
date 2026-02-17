
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { normalizeMenuItemImageUrl } from '@/lib/server/menu-image-storage';

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req);

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!querySnapshot.empty) {
            const restaurantId = querySnapshot.docs[0].id;
            return { uid: targetOwnerId, restaurantId, collectionName };
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
    if (String(item.categoryId).trim().toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
        return `Category '${RESERVED_OPEN_ITEMS_CATEGORY_ID}' is reserved for manual billing and not allowed in menu upload`;
    }

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

        const batch = firestore.batch();
        const menuRef = firestore.collection(collectionName).doc(restaurantId).collection('menu');
        const allItems = [];

        // 1. Build a map of all existing categories (hardcoded + custom)
        const allCategories = { ...hardcodedCategories };

        const existingCustomCategoriesSnap = await businessRef.collection('custom_categories').get();
        existingCustomCategoriesSnap.forEach(doc => {
            const data = doc.data();
            allCategories[data.id] = { title: data.title, order: data.order };
        });
        console.log(`[Bulk Upload] Total existing categories (hardcoded + custom):`, Object.keys(allCategories).join(', '));

        // 2. Identify unique category IDs from the uploaded items
        const uniqueItemCategoryIds = new Set(items.map(i => i.categoryId).filter(Boolean));
        console.log(`[Bulk Upload] Unique categories in upload:`, Array.from(uniqueItemCategoryIds).join(', '));

        // 3. Determine which categories are truly new and need to be added to the sub-collection
        const newCategoriesToAdd = [];
        uniqueItemCategoryIds.forEach(catId => {
            if (!allCategories[catId]) {
                newCategoriesToAdd.push(catId);
            }
        });

        // 4. Add new custom categories to the sub-collection
        if (newCategoriesToAdd.length > 0) {
            // Fetch existing sub-collection to determine max order
            const existingCatsSnap = await businessRef.collection('custom_categories').orderBy('order', 'desc').limit(1).get();
            let maxOrder = existingCatsSnap.empty ? 0 : (existingCatsSnap.docs[0].data().order || 0);

            for (const catId of newCategoriesToAdd) {
                // Check if exists (double-check in case of concurrent writes or previous batch operations)
                const catRef = businessRef.collection('custom_categories').doc(catId);
                const catSnap = await catRef.get();

                if (!catSnap.exists) {
                    // Try to find a categoryTitle in the items, otherwise generate from ID
                    const title = items.find(i => i.categoryId === catId)?.categoryTitle || catId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    maxOrder++;
                    batch.set(catRef, {
                        id: catId,
                        title: title,
                        order: maxOrder,
                        createdAt: FieldValue.serverTimestamp()
                    });
                    allCategories[catId] = { title, order: maxOrder }; // Update local map for subsequent items
                }
            }
            console.log(`[Bulk Upload] Adding ${newCategoriesToAdd.length} new categories to sub-collection.`);
        } else {
            console.log(`[Bulk Upload] No new categories to add to sub-collection.`);
        }

        for (const item of items) {
            const validationError = validateMenuItem(item);
            if (validationError) {
                return NextResponse.json({ message: `Validation failed: ${validationError}` }, { status: 400 });
            }

            const normalizedImageUrl = await normalizeMenuItemImageUrl(item.imageUrl || '', restaurantId, item.id || item.name);
            const docRef = menuRef.doc();
            const newItem = {
                id: docRef.id,
                createdAt: FieldValue.serverTimestamp(),
                isAvailable: true, // Default to available
                order: 999, // Default order, can be managed later
                ...item,
                tags: item.tags || [],
                imageUrl: normalizedImageUrl || '',
            };
            batch.set(docRef, newItem);
            allItems.push(newItem);
        }

        await batch.commit();
        console.log(`[Bulk Upload] Successfully added ${allItems.length} items and ${newCategoriesToAdd.length} new categories`);

        // Increment menuVersion for automatic cache invalidation
        try {
            await businessRef.update({
                menuVersion: FieldValue.increment(1)
            });
            console.log(`[Bulk Upload] ✅ menuVersion incremented for business ${restaurantId}`);
        } catch (versionError) {
            console.error('[Bulk Upload] ❌ menuVersion increment failed:', versionError);
            // Non-fatal - items saved successfully
        }

        return NextResponse.json({
            message: `Successfully added ${allItems.length} items to your menu!`,
            categoriesAdded: newCategoriesToAdd.length
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
