
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import axios from 'axios';

// Helper to verify owner and get their restaurant details
async function verifyOwnerAndGetRestaurant(req, auth) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const firestore = getFirestore();
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw { message: 'Owner user profile not found.', status: 404 };
    }
    
    const restaurantDoc = restaurantsQuery.docs[0];
    return {
      restaurantRef: restaurantDoc.ref,
      restaurantData: restaurantDoc.data(),
      userData: userDoc.data()
    };
}

export async function POST(req) {
    console.log("[API LOG] Received POST request to /api/owner/create-linked-account");
    const auth = getAuth();
    
    try {
        const { restaurantRef, restaurantData, userData } = await verifyOwnerAndGetRestaurant(req, auth);
        
        // --- VALIDATION ---
        if (!userData.email || !restaurantData.name || !userData.name) {
             return NextResponse.json({ message: 'User email, name, and restaurant name are required to create a linked account.' }, { status: 400 });
        }

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;

        if (!key_id || !key_secret) {
            console.error("[API ERROR] Razorpay credentials are not configured on the server.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');

        // --- STEP 1: Create a Linked Account via /accounts endpoint ---
        console.log("[API LOG] Step 1: Creating Razorpay Linked Account...");
        const accountPayload = {
            type: "linked",
            email: userData.email,
            legal_business_name: restaurantData.name,
            contact_name: userData.name,
            profile: {
                category: "food_beverage",
                subcategory: "restaurant"
            }
        };
        
        let linkedAccount;
        try {
            // ** THE FINAL FIX **: Use a direct axios call with the full, absolute URL.
            const accountResponse = await axios.post('https://api.razorpay.com/v1/accounts', accountPayload, {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/json'
                }
            });

            linkedAccount = accountResponse.data;
            // The ID here will be the `acc_...` ID
            console.log("[API LOG] Razorpay Linked Account created. Account ID is:", linkedAccount.id); 
        } catch (error) {
            console.error("[API ERROR] Failed to create Razorpay Linked Account:", error.response ? error.response.data : error.message);
            const errorDetail = error.response?.data?.error?.description || 'Failed to create linked account.';
            return NextResponse.json({ message: `Razorpay Error: ${errorDetail}` }, { status: 500 });
        }

        // --- STEP 2: Save the `acc_...` ID to Firestore ---
        console.log("[API LOG] Step 2: Saving Route Account ID to Firestore...");
        await restaurantRef.update({
            razorpayAccountId: linkedAccount.id, // This is the 'acc_...' ID
        });
        console.log(`[API LOG] Firestore updated with Account ID: ${linkedAccount.id}`);

        return NextResponse.json({ message: 'Linked account created successfully!', accountId: linkedAccount.id }, { status: 200 });

    } catch (error) {
        console.error("CREATE LINKED ACCOUNT API - FULL ERROR OBJECT:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
