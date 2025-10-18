
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

        const phone = finalUserData.phone;
        const batch = firestore.batch();

        // --- MERGE UNCLAIMED PROFILE LOGIC ---
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(phone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get();
        let mergedUserData = { ...finalUserData };

        if (unclaimedProfileSnap.exists()) {
            console.log(`[PROFILE COMPLETION] Unclaimed profile for ${phone} found. Merging data.`);
            const unclaimedData = unclaimedProfileSnap.data();
            // Merge addresses, prioritizing unclaimed data if new user has none.
            const existingAddresses = finalUserData.addresses || [];
            const unclaimedAddresses = unclaimedData.addresses || [];
            mergedUserData.addresses = [...existingAddresses, ...unclaimedAddresses];
            
            // Delete the unclaimed profile after merging
            batch.delete(unclaimedProfileRef);
            console.log(`[PROFILE COMPLETION] Unclaimed profile for ${phone} marked for deletion.`);

            // ** NEW ** Update status in all restaurants/shops where user was 'unclaimed'
             const allRestaurants = await firestore.collection('restaurants').get();
             allRestaurants.forEach(async (restaurantDoc) => {
                 const restaurantCustomerRef = restaurantDoc.ref.collection('customers').doc(phone);
                 const customerSnap = await restaurantCustomerRef.get();
                 if (customerSnap.exists && customerSnap.data().status === 'unclaimed') {
                     batch.update(restaurantCustomerRef, { status: 'verified', userId: uid });
                     console.log(`[PROFILE COMPLETION] Updated user status to 'verified' in restaurant ${restaurantDoc.id}`);
                 }
             });
        }
        // --- END MERGE LOGIC ---


        const masterUserRef = firestore.collection('users').doc(uid);
        batch.set(masterUserRef, mergedUserData, { merge: true });
        console.log(`[PROFILE COMPLETION] Step 1: Master user profile for UID ${uid} added to batch.`);

        if (isBusinessOwner && businessData) {
             const collectionName = businessType === 'restaurant' ? 'restaurants' : 'shops';
             const businessId = businessData.name.replace(/\s+/g, '-').toLowerCase();
             const businessRef = firestore.collection(collectionName).doc(businessId);
             
             const finalBusinessData = {
                ...businessData,
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
