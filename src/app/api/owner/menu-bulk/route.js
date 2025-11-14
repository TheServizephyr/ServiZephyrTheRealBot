
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

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
    if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner' && userDoc.data().role !== 'street-vendor')) {
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

// Basic validation for a single menu item
function validateMenuItem(item) {
    if (!item.name || typeof item.name !== 'string') return "Missing or invalid 'name'";
    if (!item.categoryId || typeof item.categoryId !== 'string') return `Missing 'categoryId' for item: ${item.name}`;
    
    if (typeof item.isVeg !== 'boolean') {
        // For non-restaurant types, this might not be relevant, but we can default it.
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
        const { restaurantId, collectionName } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { items } = await req.json();

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ message: 'Request body must be a non-empty array of menu items.' }, { status: 400 });
        }
        
        const batch = firestore.batch();
        const menuRef = firestore.collection(collectionName).doc(restaurantId).collection('menu');
        const allItems = [];

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
                // Ensure array fields exist
                tags: item.tags || [],
                addOnGroups: item.addOnGroups || [],
                imageUrl: item.imageUrl || `https://picsum.photos/seed/${item.name.replace(/\s/g, '')}/100/100`,
            };
            batch.set(docRef, newItem);
            allItems.push(newItem);
        }

        await batch.commit();

        return NextResponse.json({ message: `Successfully added ${allItems.length} items to your menu!` }, { status: 201 });

    } catch (error) {
        console.error("BULK MENU UPLOAD ERROR:", error);
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        // Check for JSON parsing error
        if (error instanceof SyntaxError) {
            return NextResponse.json({ message: `Invalid JSON format: ${error.message}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
