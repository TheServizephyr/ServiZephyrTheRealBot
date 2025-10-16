
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import https from 'https';

// Helper to verify owner and get their restaurant details
async function verifyOwnerAndGetRestaurant(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const url = new URL(req.headers.get('referer') || 'http://localhost');
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }

    const restaurantData = restaurantsQuery.docs[0].data();
    if (!restaurantData.razorpayAccountId) {
        throw { message: 'Razorpay account is not linked. Please link your account in the onboarding settings.', status: 404 };
    }
    
    return { razorpayAccountId: restaurantData.razorpayAccountId };
}

// Helper to make Razorpay API requests
async function makeRazorpayRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(parsedData);
                    }
                } catch (e) {
                    reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                }
            });
        });
        req.on('error', (e) => reject({ error: { description: e.message } }));
        req.end();
    });
}


export async function GET(req) {
    try {
        const { razorpayAccountId } = await verifyOwnerAndGetRestaurant(req);
        
        const { searchParams } = new URL(req.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
        
        let path = `/v1/accounts/${razorpayAccountId}/settlements`;
        const queryParams = new URLSearchParams();
        if (from) queryParams.append('from', from);
        if (to) queryParams.append('to', to);
        if (queryParams.toString()) path += `?${queryParams.toString()}`;

        const fetchSettlementsOptions = {
            hostname: 'api.razorpay.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: { 'Authorization': `Basic ${credentials}` }
        };
        
        const settlementsData = await makeRazorpayRequest(fetchSettlementsOptions);
        
        const payouts = settlementsData.items || [];
        
        // Calculate summary data
        const total = payouts.reduce((sum, p) => sum + p.amount, 0);
        const lastPayout = payouts.length > 0 ? payouts[0].amount : 0;

        // NOTE: 'Pending' amount is more complex and usually comes from a different Razorpay API
        // (like account balance). For now, we'll return 0.
        const summary = {
            total: total / 100, // Convert from paisa to rupees
            lastPayout: lastPayout / 100,
            pending: 0,
        };

        return NextResponse.json({ payouts, summary }, { status: 200 });

    } catch (error) {
        console.error("[API ERROR] /api/owner/payouts:", error);
        const errorMessage = error.error?.description || error.message || 'An internal server error occurred.';
        const statusCode = error.status || 500;
        return NextResponse.json({ message: errorMessage }, { status: statusCode });
    }
}
