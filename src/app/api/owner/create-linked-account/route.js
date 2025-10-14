
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import https from 'https';

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
        console.log("[API LOG] Step 1: Creating Razorpay Linked Account using native https...");
        const accountPayload = JSON.stringify({
            type: "linked",
            email: userData.email,
            legal_business_name: restaurantData.name,
            contact_name: userData.name,
            profile: {
                category: "food_beverage",
                subcategory: "restaurant"
            }
        });
        
        const options = {
            hostname: 'api.razorpay.com',
            port: 443,
            path: '/v1/accounts',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': accountPayload.length,
                'Authorization': `Basic ${credentials}`
            }
        };

        const linkedAccount = await new Promise((resolve, reject) => {
            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', (chunk) => {
                    data += chunk;
                });
                apiRes.on('end', () => {
                    if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                        resolve(JSON.parse(data));
                    } else {
                        reject({ response: { data: JSON.parse(data) }});
                    }
                });
            });

            apiReq.on('error', (e) => {
                reject({ message: e.message });
            });

            apiReq.write(accountPayload);
            apiReq.end();
        });
        
        console.log("[API LOG] Razorpay Linked Account created. Account ID is:", linkedAccount.id); 

        // --- STEP 2: Save the `acc_...` ID to Firestore ---
        console.log("[API LOG] Step 2: Saving Route Account ID to Firestore...");
        await restaurantRef.update({
            razorpayAccountId: linkedAccount.id,
        });
        console.log(`[API LOG] Firestore updated with Account ID: ${linkedAccount.id}`);

        return NextResponse.json({ message: 'Linked account created successfully!', accountId: linkedAccount.id }, { status: 200 });

    } catch (error) {
        console.error("[API ERROR] Failed to create Razorpay Linked Account:", error.response ? error.response.data : error.message);
        const errorDetail = error.response?.data?.error?.description || error.message || 'Failed to create linked account.';
        return NextResponse.json({ message: `Razorpay Error: ${errorDetail}` }, { status: 500 });
    }
}
