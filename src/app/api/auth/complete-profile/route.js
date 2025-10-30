

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';


export async function POST(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const authHeader = req.headers.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const { finalUserData, businessData, businessType } = await req.json();

        // --- VALIDATION ---
        if (!finalUserData || !finalUserData.role || !finalUserData.phone) {
             return NextResponse.json({ message: 'User role and phone are missing in payload.' }, { status: 400 });
        }
        
        const isBusinessOwner = finalUserData.role === 'restaurant-owner' || finalUserData.role === 'shop-owner';

        if (isBusinessOwner && !businessData) {
            return NextResponse.json({ message: 'Business data is required for owners.' }, { status: 400 });
        }
        if (businessData && (!businessData.address || !businessData.address.street || !businessData.address.city)) {
             return NextResponse.json({ message: 'A structured address is required for businesses.' }, { status: 400 });
        }

        const normalizedPhone = finalUserData.phone.slice(-10);
        const batch = firestore.batch();

        // --- MERGE UNCLAIMED PROFILE LOGIC ---
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get(); // Await the get() call
        let mergedUserData = { ...finalUserData };

        if (unclaimedProfileSnap.exists) { 
            console.log(`[PROFILE COMPLETION] Unclaimed profile for ${normalizedPhone} found. Merging data.`);
            const unclaimedData = unclaimedProfileSnap.data();
            
            const existingAddresses = finalUserData.addresses || [];
            // Ensure addresses in unclaimed data are in the new format
            const unclaimedAddresses = (unclaimedData.addresses || []).map(addr => {
                if (typeof addr === 'string') {
                    // Convert old string address to new structured format
                    return {
                        id: `addr_${Date.now()}_${Math.random()}`,
                        label: 'Default',
                        name: unclaimedData.name,
                        phone: unclaimedData.phone,
                        alternatePhone: '',
                        street: addr,
                        city: '',
                        state: '',
                        pincode: '',
                        country: 'IN',
                        full: addr, // Keep the original string as 'full' for compatibility
                    };
                }
                // If it's already an object, ensure it has a 'full' property.
                if (addr && !addr.full) {
                    addr.full = `${addr.street || ''}, ${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`.replace(/, , /g, ', ').trim();
                }
                return addr;
            }).filter(Boolean); // Filter out any null/undefined addresses

            mergedUserData.addresses = [...existingAddresses, ...unclaimedAddresses];

            // NEW & CORRECTED: Handle moving customer data from phone ID to UID
            if (unclaimedData.orderedFrom && Array.isArray(unclaimedData.orderedFrom)) {
                for (const restaurantInfo of unclaimedData.orderedFrom) {
                    if (restaurantInfo.restaurantId) {
                        const restaurantId = restaurantInfo.restaurantId;
                        const collectionPath = restaurantInfo.businessType === 'shop' ? 'shops' : 'restaurants';

                        const oldCustomerRef = firestore.collection(collectionPath).doc(restaurantId).collection('customers').doc(normalizedPhone);
                        const newCustomerRef = firestore.collection(collectionPath).doc(restaurantId).collection('customers').doc(uid);
                        
                        const oldCustomerSnap = await oldCustomerRef.get();
                        
                        let oldCustomerData = {};
                        if (oldCustomerSnap.exists) {
                            oldCustomerData = oldCustomerSnap.data();
                            // Delete the old record keyed by phone number
                            batch.delete(oldCustomerRef);
                            console.log(`[PROFILE COMPLETION] Marked old customer record at ${oldCustomerRef.path} for deletion.`);
                        }
                        
                        // Create or merge data into the new record keyed by UID
                        const newCustomerPayload = {
                            ...oldCustomerData,
                            name: finalUserData.name, // Update with master profile name
                            email: finalUserData.email, // Add email
                            status: 'verified', // Mark as verified
                            lastSeen: FieldValue.serverTimestamp()
                        };

                        batch.set(newCustomerRef, newCustomerPayload, { merge: true });
                        console.log(`[PROFILE COMPLETION] Marked new/updated customer record at ${newCustomerRef.path} for creation.`);
                        
                        // Also create the entry in the user's `joined_restaurants` subcollection
                        const userRestaurantLinkRef = firestore.collection('users').doc(uid).collection('joined_restaurants').doc(restaurantId);
                         batch.set(userRestaurantLinkRef, {
                            restaurantName: restaurantInfo.restaurantName, 
                            joinedAt: FieldValue.serverTimestamp(),
                            totalSpend: oldCustomerData.totalSpend || 0,
                            loyaltyPoints: oldCustomerData.loyaltyPoints || 0,
                            lastOrderDate: oldCustomerData.lastOrderDate,
                            totalOrders: oldCustomerData.totalOrders || 0,
                        }, { merge: true });
                    }
                }
            }

            // *** THE FIX: Migrate orders from phone number ID to UID ***
            const unclaimedOrdersQuery = firestore.collection('orders').where('customerId', '==', normalizedPhone);
            const unclaimedOrdersSnap = await unclaimedOrdersQuery.get();
            if (!unclaimedOrdersSnap.empty) {
                console.log(`[PROFILE COMPLETION] Found ${unclaimedOrdersSnap.size} orders to migrate for phone ${normalizedPhone}.`);
                unclaimedOrdersSnap.forEach(orderDoc => {
                    batch.update(orderDoc.ref, { customerId: uid });
                    console.log(`[PROFILE COMPLETION] Marked order ${orderDoc.id} to be updated with new UID.`);
                });
            }
            
            // Delete the unclaimed profile after processing
            batch.delete(unclaimedProfileRef);
            console.log(`[PROFILE COMPLETION] Unclaimed profile for ${normalizedPhone} marked for deletion.`);
        }
        // --- END MERGE LOGIC ---

        // ** THE FIX IS HERE: Add the server-side timestamp before saving **
        mergedUserData.createdAt = FieldValue.serverTimestamp();

        const masterUserRef = firestore.collection('users').doc(uid);
        batch.set(masterUserRef, mergedUserData, { merge: true });
        console.log(`[PROFILE COMPLETION] Step 1: Master user profile for UID ${uid} added to batch.`);

        if (isBusinessOwner && businessData) {
             const collectionName = businessType === 'restaurant' ? 'restaurants' : 'shops';
             const businessId = businessData.name.replace(/\s+/g, '-').toLowerCase();
             const businessRef = firestore.collection(collectionName).doc(businessId);
             
             const finalBusinessData = {
                ...businessData,
                createdAt: FieldValue.serverTimestamp(),
                razorpayAccountId: '', 
             };
             batch.set(businessRef, finalBusinessData);
             console.log(`[PROFILE COMPLETION] Owner Action: New ${businessType} '${businessId}' added to batch.`);
        }
        
        await batch.commit();

        console.log(`[PROFILE COMPLETION] Successfully completed profile for user ${uid}`);
        return NextResponse.json({ message: 'Profile completed successfully!', role: finalUserData.role }, { status: 200 });

    } catch (error) {
        console.error('COMPLETE PROFILE API ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
