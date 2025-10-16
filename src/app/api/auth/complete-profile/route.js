
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { firestore as adminFirestore } from 'firebase-admin';

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

        // Get the data from the request body
        const { finalUserData, restaurantData } = await req.json();

        // --- VALIDATION ---
        if (!finalUserData || !finalUserData.role || !finalUserData.phone) {
             return NextResponse.json({ message: 'User role and phone are missing in payload.' }, { status: 400 });
        }
        if (finalUserData.role === 'owner' && !restaurantData) {
            return NextResponse.json({ message: 'Restaurant data is required for owners.' }, { status: 400 });
        }
        if (restaurantData && (!restaurantData.address || !restaurantData.address.street || !restaurantData.address.city)) {
             return NextResponse.json({ message: 'A structured address is required for restaurants.' }, { status: 400 });
        }

        const phone = finalUserData.phone;

        // Start a Firestore batch write for atomic operations
        const batch = firestore.batch();

        // --- USER'S PLAN IMPLEMENTATION ---

        // 1 & 2: Search and get details from unclaimed_profiles
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(phone);
        const unclaimedProfileDoc = await unclaimedProfileRef.get();
        
        let mergedUserData = { ...finalUserData };
        let restaurantsToJoin = [];

        if (unclaimedProfileDoc.exists) {
            console.log(`[PROFILE COMPLETION] Found unclaimed profile for ${phone}. Merging data.`);
            const unclaimedData = unclaimedProfileDoc.data();
            // Store associated restaurants for later use in subcollection
            if (unclaimedData.associatedRestaurants) {
                restaurantsToJoin = [...unclaimedData.associatedRestaurants];
            }
            // Merge data, giving form data priority over unclaimed data if there are conflicts
            mergedUserData = {
                ...unclaimedData, // address, etc. from bot
                ...finalUserData, // uid, email, role, etc. from client
                name: finalUserData.name || unclaimedData.name, // Prioritize name from client form
            };
            // **CRITICAL FIX**: Delete the array field before setting the master profile
            delete mergedUserData.associatedRestaurants;
        } else {
             console.log(`[PROFILE COMPLETION] No unclaimed profile found for ${phone}. Creating fresh profile.`);
        }

        // Add the new restaurant to the list if the user is an owner creating one
        if (restaurantData) {
            const newRestaurantId = restaurantData.name.replace(/\s+/g, '-').toLowerCase();
            if(!restaurantsToJoin.includes(newRestaurantId)){
                restaurantsToJoin.push(newRestaurantId);
            }
        }
        

        // 3. Create the Master User Profile (without the array field)
        const masterUserRef = firestore.collection('users').doc(uid);
        batch.set(masterUserRef, mergedUserData);
        console.log(`[PROFILE COMPLETION] Step 3: Master user profile for UID ${uid} added to batch.`);

        // 4 & 5. Create joined_restaurants subcollection AND update the restaurant's customer subcollection
        for (const restaurantIdToJoin of restaurantsToJoin) {
             const userRestaurantLinkRef = masterUserRef.collection('joined_restaurants').doc(restaurantIdToJoin);
             const oldCustomerRef = firestore.collection('restaurants').doc(restaurantIdToJoin).collection('customers').doc(phone);
             const newCustomerRef = firestore.collection('restaurants').doc(restaurantIdToJoin).collection('customers').doc(uid);

             // --- PRESERVE ANALYTICS DATA ---
             const oldCustomerDoc = await oldCustomerRef.get();
             let existingAnalytics = {};
             if (oldCustomerDoc.exists) {
                 const oldData = oldCustomerDoc.data();
                 existingAnalytics = {
                     totalSpend: oldData.totalSpend || 0,
                     loyaltyPoints: oldData.loyaltyPoints || 0,
                     lastOrderDate: oldData.lastOrderDate || null,
                     totalOrders: oldData.totalOrders || 0,
                 };
                 // Now that we have the data, we can delete the old record
                 batch.delete(oldCustomerRef);
             }
             
             // Data for the restaurant's customer sub-collection
             const restaurantCustomerData = {
                 name: mergedUserData.name,
                 phone: mergedUserData.phone,
                 email: mergedUserData.email,
                 status: 'claimed',
                 notes: 'Customer profile claimed and updated.',
                 ...existingAnalytics // Add the preserved analytics data
             };
             batch.set(newCustomerRef, restaurantCustomerData);
             console.log(`[PROFILE COMPLETION] Step 5: Updated customer record in restaurant ${restaurantIdToJoin} with analytics.`);

             // Data for the user's joined_restaurants sub-collection
             const userRestaurantLinkData = {
                 restaurantId: restaurantIdToJoin,
                 joinedAt: adminFirestore.FieldValue.serverTimestamp(),
                 ...existingAnalytics // Also add analytics here
             };
             batch.set(userRestaurantLinkRef, userRestaurantLinkData);
             console.log(`[PROFILE COMPLETION] Step 4: Added restaurant ${restaurantIdToJoin} to user's joined_restaurants with analytics.`);
        }


        // Handle case where user is an owner creating a new restaurant
        if (finalUserData.role === 'owner' && restaurantData) {
             const restaurantId = restaurantData.name.replace(/\s+/g, '-').toLowerCase();
             const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
             const finalRestaurantData = {
                ...restaurantData,
                razorpayAccountId: '', // Add this field for future Razorpay Route integration
             };
             batch.set(restaurantRef, finalRestaurantData);
             console.log(`[PROFILE COMPLETION] Owner Action: New restaurant ${restaurantId} added to batch.`);
        }
        
        // 6. Delete the unclaimed_profile
        if (unclaimedProfileDoc.exists) {
            batch.delete(unclaimedProfileRef);
            console.log(`[PROFILE COMPLETION] Step 6: Unclaimed profile for ${phone} marked for deletion in batch.`);
        }

        // Atomically commit all batched operations
        await batch.commit();

        console.log(`[PROFILE COMPLETION] Successfully completed profile for user ${uid}`);
        return NextResponse.json({ message: 'Profile completed successfully!', role: finalUserData.role }, { status: 200 });

    } catch (error) {
        console.error('COMPLETE PROFILE API ERROR:', error);
        // Provide a more detailed error message
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
