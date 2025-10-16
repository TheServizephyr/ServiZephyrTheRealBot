

'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import https from 'https';

// Helper to make Razorpay API requests
async function makeRazorpayRequest(options, payload = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`[API LOG] Razorpay Response Status (${options.path}): ${res.statusCode}`);
                console.log(`[API LOG] Raw response from Razorpay (${options.path}):`, data);
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(parsedData);
                    }
                } catch (e) {
                    console.error(`[API ERROR] Failed to parse Razorpay JSON response from ${options.path}.`, e);
                    reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`[API ERROR] HTTPS request error for ${options.path}:`, e);
            reject({ error: { description: e.message } });
        });

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}


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
        const { beneficiaryName, accountNumber, ifsc } = await req.json();
        
        // Validation from Razorpay's email & our new form
        if (!userData.email || !restaurantData.name || !userData.name || !userData.phone || !restaurantData.address || !restaurantData.address.street) {
             return NextResponse.json({ message: 'User email, name, phone, restaurant name, and a structured address are required.' }, { status: 400 });
        }
        if (!beneficiaryName || !accountNumber || !ifsc) {
            return NextResponse.json({ message: 'Bank Account Holder Name, Account Number, and IFSC code are required.' }, { status: 400 });
        }

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;

        if (!key_id || !key_secret) {
            console.error("[API ERROR] Razorpay credentials are not configured on the server.");
            return NextResponse.json({ message: 'Payment gateway is not fully configured on the server.' }, { status: 500 });
        }
        
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
        const baseOptions = {
            hostname: 'api.razorpay.com',
            port: 443,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`,
            }
        };

        // --- STEP 1: Create a Linked Account (using 'route' type) ---
        console.log("[API LOG] Step 1: Creating Razorpay Route Account...");
        const accountPayload = JSON.stringify({
            type: "route", 
            email: userData.email,
            legal_business_name: restaurantData.name,
            business_type: "proprietorship", 
            contact_name: userData.name,
            phone: userData.phone,
            profile: {
                category: "food",
                subcategory: "restaurant",
                addresses: {
                    registered: {
                        street1: restaurantData.address.street,
                        street2: restaurantData.address.street,
                        city: restaurantData.address.city,
                        state: restaurantData.address.state,
                        postal_code: restaurantData.address.postalCode,
                        country: restaurantData.address.country || "IN"
                    }
                }
            }
        });
        
        const createAccountOptions = {
            ...baseOptions,
            path: '/v2/accounts',
            method: 'POST',
        };

        const linkedAccount = await makeRazorpayRequest(createAccountOptions, accountPayload);
        const accountId = linkedAccount.id;
        console.log(`[API LOG] Step 1 SUCCESS. Route Account ID: ${accountId}`);


        // --- STEP 2: Create a Stakeholder ---
        console.log(`[API LOG] Step 2: Creating Stakeholder for Account ${accountId}...`);
        const stakeholderPayload = JSON.stringify({
            name: userData.name,
            email: userData.email,
            phone: {
                primary: userData.phone,
            }
        });

        const createStakeholderOptions = {
            ...baseOptions,
            path: `/v2/accounts/${accountId}/stakeholders`,
            method: 'POST',
        };
        const stakeholder = await makeRazorpayRequest(createStakeholderOptions, stakeholderPayload);
        console.log(`[API LOG] Step 2 SUCCESS. Stakeholder ID: ${stakeholder.id}`);


        // --- STEP 3: Request Product Configuration ---
        console.log(`[API LOG] Step 3: Requesting 'route' product configuration for Account ${accountId}...`);
        const productRequestPayload = JSON.stringify({
            product_name: "route",
            tnc_accepted: true,
        });

        const requestProductOptions = {
            ...baseOptions,
            path: `/v2/accounts/${accountId}/products`,
            method: 'POST',
        };
        const product = await makeRazorpayRequest(requestProductOptions, productRequestPayload);
        const productId = product.id;
        console.log(`[API LOG] Step 3 SUCCESS. Product ID: ${productId}`);


        // --- STEP 4: Update Product Configuration (Activate) ---
        console.log(`[API LOG] Step 4: Activating 'route' for Product ${productId} with bank details...`);
        
        const updateProductPayload = JSON.stringify({
           tnc_accepted: true,
           settlements: {
                account_number: accountNumber,
                ifsc_code: ifsc,
                beneficiary_name: beneficiaryName,
           }
        });

        const updateProductOptions = {
            ...baseOptions,
            path: `/v2/accounts/${accountId}/products/${productId}`,
            method: 'PATCH',
        };
        await makeRazorpayRequest(updateProductOptions, updateProductPayload);
        console.log(`[API LOG] Step 4 SUCCESS. Product configuration updated and activated.`);


        // --- FINAL STEP: Save the accountId to Firestore ---
        console.log(`[API LOG] Final Step: Saving Route Account ID ${accountId} to Firestore...`);
        await restaurantRef.update({
            razorpayAccountId: accountId,
        });
        console.log(`[API LOG] Firestore updated successfully.`);

        return NextResponse.json({ message: 'Linked account created and activated successfully!', accountId: accountId }, { status: 200 });

    } catch (error) {
        const errorDetail = error.error ? JSON.stringify(error.error, null, 2) : error.message;
        console.error("[API ERROR] Failed to complete Razorpay Linked Account setup:", errorDetail);
        
        const errorMessageForUser = error.error?.description || error.message || 'Failed to create linked account.';
        return NextResponse.json({ message: `Razorpay Error: ${errorMessageForUser}` }, { status: 500 });
    }
}
