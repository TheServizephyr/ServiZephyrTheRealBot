
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import axios from 'axios';

// Helper to verify owner and get their first restaurant ID
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
    return restaurantsQuery.docs[0].ref;
}

// --- THIS IS THE FINAL AND CORRECT IMPLEMENTATION USING AXIOS ---
export async function POST(req) {
    console.log("[API LOG] Received POST request to /api/owner/create-linked-account");
    const auth = getAuth();
    
    try {
        const restaurantRef = await verifyOwnerAndGetRestaurant(req, auth);
        const { name, email, phone, account_number, ifsc_code, bank_name } = await req.json();

        // --- VALIDATION ---
        if (!name || !email || !phone || !account_number || !ifsc_code) {
            return NextResponse.json({ message: 'Missing required fields for account creation.' }, { status: 400 });
        }

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;

        if (!key_id || !key_secret) {
            console.error("[API ERROR] Razorpay credentials are not configured on the server.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
        const razorpayApi = axios.create({
            baseURL: 'https://api.razorpay.com/v1',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            }
        });


        // --- STEP 1: Create a Contact (This response contains the `acc_...` ID) ---
        console.log("[API LOG] Step 1: Creating Razorpay Contact...");
        const contactPayload = {
            name: name,
            email: email,
            contact: phone,
            type: "vendor",
            notes: {
                "business_name": bank_name,
            }
        };
        
        let contact;
        try {
            const contactResponse = await razorpayApi.post('/contacts', contactPayload);
            contact = contactResponse.data;
            // The 'id' in the contact response is the Route Account ID (`acc_...`)
            console.log("[API LOG] Razorpay Contact created. The Route Account ID is:", contact.id);
        } catch (error) {
            console.error("[API ERROR] Failed to create Razorpay contact:", error.response ? error.response.data : error.message);
            const errorDetail = error.response?.data?.error?.description || 'Failed to create contact.';
            return NextResponse.json({ message: `Razorpay Error: ${errorDetail}` }, { status: 500 });
        }


        // --- STEP 2: Create a Fund Account (to link the bank) ---
        console.log("[API LOG] Step 2: Creating Razorpay Fund Account...");
        const fundAccountPayload = {
            contact_id: contact.id, // Use the ID from the contact, which is the acc_... ID
            account_type: "bank_account",
            bank_account: {
                name: name,
                ifsc: ifsc_code,
                account_number: account_number
            }
        };

        let fundAccount;
        try {
            const fundAccountResponse = await razorpayApi.post('/fund_accounts', fundAccountPayload);
            fundAccount = fundAccountResponse.data;
            console.log("[API LOG] Razorpay Fund Account created successfully. Fund Account ID is:", fundAccount.id);
        } catch (error) {
             console.error("[API ERROR] Failed to create Razorpay fund account:", error.response ? error.response.data : error.message);
            const errorDetail = error.response?.data?.error?.description || 'Failed to create fund account.';
            return NextResponse.json({ message: `Razorpay Error: ${errorDetail}` }, { status: 500 });
        }
        
        // --- STEP 3: Save the CORRECT Route Account ID ('acc_...') to Firestore ---
        console.log("[API LOG] Step 3: Saving Razorpay Route Account ID to Firestore...");
        await restaurantRef.update({
            // ** THE FIX **: We save the 'id' from the contact response, which is the 'acc_...' ID.
            razorpayAccountId: contact.id 
        });
        console.log("[API LOG] Firestore updated successfully with Route Account ID:", contact.id);

        return NextResponse.json({ message: 'Bank account linked successfully!', accountId: contact.id }, { status: 200 });

    } catch (error) {
        console.error("CREATE LINKED ACCOUNT API - FULL ERROR OBJECT:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
