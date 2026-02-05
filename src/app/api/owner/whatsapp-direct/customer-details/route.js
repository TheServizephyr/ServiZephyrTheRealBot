
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

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

    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    }
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');
        if (!hasAccess) throw { message: 'Access Denied', status: 403 };
        targetOwnerId = employeeOfOwnerId;
    }
    else if (!['owner', 'restaurant-owner', 'shop-owner'].includes(userRole)) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) return restaurantsQuery.docs[0].ref;

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) return shopsQuery.docs[0].ref;

    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const url = new URL(req.url, `http://${req.headers.host}`);
        const phoneNumber = url.searchParams.get('phoneNumber');

        if (!phoneNumber) {
            return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const customersRef = businessRef.collection('customers');

        // --- Phone Number Matching Strategy ---
        // WhatsApp numbers often include country code (e.g., 919876543210).
        // Database might store as 9876543210, +919876543210, or 919876543210.
        // We try variations to find the matching customer document.

        const cleanPhone = phoneNumber.replace(/\D/g, ''); // Remove all non-digits
        // Safe slice for last 10 digits
        const last10 = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;

        // Variations to try
        const phoneVariations = [
            phoneNumber,                    // derived from URL
            cleanPhone,                     // only digits
            last10,                         // last 10 digits (common in India)
            `+${cleanPhone}`,               // with plus
            `91${last10}`,                  // with 91 prefix
            `+91${last10}`                  // with +91 prefix
        ];

        // Remove duplicates and filter valid-ish numbers (min 10 digits)
        const uniqueVariations = [...new Set(phoneVariations)].filter(p => p && p.length >= 10);

        console.log(`[Customer Details] Searching for ${phoneNumber} with variations:`, uniqueVariations);

        let customerDoc = null;

        // Collect ALL matching customer records (may have duplicates with different stats)
        const allMatchingCustomers = [];

        for (const variant of uniqueVariations) {
            // Try 'phoneNumber' field
            let snapshot = await customersRef.where('phoneNumber', '==', variant).get();
            snapshot.docs.forEach(doc => allMatchingCustomers.push(doc));

            // Try 'phone' field  
            snapshot = await customersRef.where('phone', '==', variant).get();
            snapshot.docs.forEach(doc => allMatchingCustomers.push(doc));

            // Try Document ID
            const docRef = customersRef.doc(variant);
            const docSnap = await docRef.get();
            if (docSnap.exists) allMatchingCustomers.push(docSnap);
        }

        // Deduplicate by ID
        const uniqueCustomers = Array.from(
            new Map(allMatchingCustomers.map(doc => [doc.id, doc])).values()
        );

        console.log(`[Customer Details] Found ${uniqueCustomers.length} unique customer record(s)`);

        // Pick the record that HAS totalSpend field (the one Customer Page uses)
        customerDoc = uniqueCustomers.find(doc => {
            const data = doc.data();
            return data.totalSpend !== undefined && data.totalSpend !== null;
        });

        // Fallback to first record
        if (!customerDoc && uniqueCustomers.length > 0) {
            customerDoc = uniqueCustomers[0];
            console.log(`[Customer Details] No record with totalSpend, using first`);
        }



        if (customerDoc) {
            const data = customerDoc.data();
            console.log(`[Customer Details] Found customer record for phone variations`);

            // Calculate stats dynamically from orders collection
            let totalOrders = 0;
            let totalSpent = 0;

            try {
                const ordersRef = firestore.collection('orders');

                // Query orders by restaurantId and phone variations
                const orderQueries = uniqueVariations.map(variant =>
                    ordersRef
                        .where('restaurantId', '==', businessRef.id)
                        .where('customerPhone', '==', variant)
                        .where('status', '!=', 'rejected')
                        .get()
                );

                const orderSnapshots = await Promise.all(orderQueries);

                // Merge all orders and deduplicate by ID
                const allOrders = new Map();
                orderSnapshots.forEach(snapshot => {
                    snapshot.docs.forEach(doc => allOrders.set(doc.id, doc));
                });

                totalOrders = allOrders.size;

                // Calculate total spent
                allOrders.forEach(doc => {
                    const orderData = doc.data();
                    const amount = parseFloat(orderData.totalAmount || orderData.amount || orderData.billTotal || 0);
                    if (!isNaN(amount)) totalSpent += amount;
                });

                console.log(`[Customer Details] Calculated from orders - Orders: ${totalOrders}, Spent: ₹${totalSpent}`);

            } catch (err) {
                console.error('[Customer Details] Error calculating stats from orders:', err);
            }

            return NextResponse.json({
                exists: true,
                id: customerDoc.id,
                details: {
                    customName: data.customName || data.name || '',
                    notes: data.notes || '',
                    totalOrders: data.totalOrders || 0,
                    totalSpent: data.totalSpend || 0,
                    // Handle Firestore Timestamp or ISO string
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || null)
                }
            }, { status: 200 });
        }

        // Return empty stats if not found
        return NextResponse.json({
            exists: false,
            details: {
                customName: '',
                notes: '',
                totalOrders: 0,
                totalSpent: 0,
                createdAt: null
            }
        }, { status: 200 });

    } catch (error) {
        console.error("GET Customer Details Error:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { phoneNumber, customName, notes } = await req.json();

        if (!phoneNumber) {
            return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
        }

        const customersRef = businessRef.collection('customers');
        const querySnapshot = await customersRef.where('phoneNumber', '==', phoneNumber).limit(1).get();

        let customerRef;
        let oldName = '';

        if (querySnapshot.empty) {
            // Create new customer record if it doesn't exist (lazy creation)
            customerRef = customersRef.doc();
            await customerRef.set({
                phoneNumber,
                customName: customName || '',
                notes: notes || '',
                createdAt: new Date(),
                totalOrders: 0,
                totalSpent: 0
            });
        } else {
            const doc = querySnapshot.docs[0];
            customerRef = doc.ref;
            oldName = doc.data().customName || doc.data().name;

            const updates = {};
            if (customName !== undefined) updates.customName = customName;
            if (notes !== undefined) updates.notes = notes;

            if (Object.keys(updates).length > 0) {
                await customerRef.update(updates);
            }
        }

        // If name changed, update the conversation document too for immediate UI reflection in the list
        if (customName && customName !== oldName) {
            const conversationsRef = businessRef.collection('conversations');
            // Find conversation by customerPhone
            const convQuery = await conversationsRef.where('customerPhone', '==', phoneNumber).limit(1).get();
            if (!convQuery.empty) {
                await convQuery.docs[0].ref.update({ customerName: customName });
            }
        }

        return NextResponse.json({ message: 'Customer details updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH Customer Details Error:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
