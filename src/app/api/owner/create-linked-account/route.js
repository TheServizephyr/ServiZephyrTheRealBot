
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import https from 'https';

// Helper to verify owner and get their restaurant details
async function verifyOwnerAndGetRestaurant(req, auth) {
    console.log("[API LOG] Verifying owner and fetching data...");
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    console.log(`[API LOG] UID: ${uid} verified.`);
    
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
    console.log("[API LOG] Successfully fetched user and restaurant data.");
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
        console.log("[API LOG] User Data:", JSON.stringify(userData, null, 2));
        console.log("[API LOG] Restaurant Data:", JSON.stringify(restaurantData, null, 2));
        
        if (!userData.email || !restaurantData.name || !userData.name) {
             return NextResponse.json({ message: 'User email, name, and restaurant name are required to create a linked account.' }, { status: 400 });
        }

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;

        console.log(`[API LOG] Using Razorpay Key ID: ${key_id ? 'Found' : 'NOT FOUND'}`);

        if (!key_id || !key_secret) {
            console.error("[API ERROR] Razorpay credentials are not configured on the server.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');

        // --- STEP 1: Create a Linked Account via /v2/accounts endpoint ---
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
        
        console.log("[API LOG] Sending this payload to Razorpay:", accountPayload);

        const options = {
            hostname: 'api.razorpay.com',
            port: 443,
            path: '/v2/accounts',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': accountPayload.length,
                'Authorization': `Basic ${credentials}`
            }
        };

        console.log("[API LOG] HTTPS Request Options:", JSON.stringify(options, null, 2));

        const linkedAccount = await new Promise((resolve, reject) => {
            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                console.log(`[API LOG] Razorpay Response Status Code: ${apiRes.statusCode}`);
                apiRes.on('data', (chunk) => {
                    data += chunk;
                });
                apiRes.on('end', () => {
                    console.log("[API LOG] Raw response from Razorpay:", data);
                    try {
                        const parsedData = JSON.parse(data);
                        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                            resolve(parsedData);
                        } else {
                            // Reject with the parsed error from Razorpay
                            reject(parsedData);
                        }
                    } catch (e) {
                         console.error("[API ERROR] Failed to parse Razorpay JSON response.", e);
                         // Reject with the raw data if JSON parsing fails
                         reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                    }
                });
            });

            apiReq.on('error', (e) => {
                console.error("[API ERROR] HTTPS request error:", e);
                reject({ error: { description: e.message } });
            });

            apiReq.write(accountPayload);
            apiReq.end();
        });
        
        console.log("[API LOG] Razorpay Linked Account created. Full Response:", JSON.stringify(linkedAccount, null, 2));
        const accountId = linkedAccount.id;
        if (!accountId || !accountId.startsWith('acc_')) {
            throw new Error(`Invalid Account ID received from Razorpay: ${accountId}`);
        }
        console.log("[API LOG] Extracted Account ID:", accountId); 

        // --- STEP 2: Save the `acc_...` ID to Firestore ---
        console.log(`[API LOG] Step 2: Saving Route Account ID ${accountId} to Firestore...`);
        await restaurantRef.update({
            razorpayAccountId: accountId,
        });
        console.log(`[API LOG] Firestore updated successfully.`);

        return NextResponse.json({ message: 'Linked account created successfully!', accountId: accountId }, { status: 200 });

    } catch (error) {
        // Log detailed error information
        const errorDetail = error.error ? JSON.stringify(error.error, null, 2) : error.message;
        console.error("[API ERROR] Failed to create Razorpay Linked Account:", errorDetail);
        
        const errorMessageForUser = error.error?.description || error.message || 'Failed to create linked account.';
        return NextResponse.json({ message: `Razorpay Error: ${errorMessageForUser}` }, { status: 500 });
    }
}
