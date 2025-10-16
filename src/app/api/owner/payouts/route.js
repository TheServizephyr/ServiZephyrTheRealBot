
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
        
        // ** THE FIX: Using v2 Transfers API instead of v1 Settlements API **
        const queryParams = new URLSearchParams({
            'recipient_account_id': razorpayAccountId
        });
        if (from) queryParams.append('from', from);
        if (to) queryParams.append('to', to);
        
        const path = `/v2/transfers?${queryParams.toString()}`;

        const fetchTransfersOptions = {
            hostname: 'api.razorpay.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: { 'Authorization': `Basic ${credentials}` }
        };
        
        const transfersData = await makeRazorpayRequest(fetchTransfersOptions);
        
        // Process transfers data into a payout format
        const payouts = (transfersData.items || []).map(transfer => ({
            id: transfer.id,
            amount: transfer.amount,
            currency: transfer.currency,
            status: transfer.status,
            utr: transfer.settlement_utr,
            created_at: transfer.created_at,
        }));
        
        // Calculate summary data from processed payouts
        const total = payouts.filter(p => p.status === 'processed').reduce((sum, p) => sum + p.amount, 0);
        const lastPayout = payouts.length > 0 ? payouts[0].amount : 0;
        const pending = payouts.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);


        const summary = {
            total: total / 100, // Convert from paisa to rupees
            lastPayout: lastPayout / 100,
            pending: pending / 100,
        };

        return NextResponse.json({ payouts, summary }, { status: 200 });

    } catch (error) {
        console.error("[API ERROR] /api/owner/payouts:", error);
        const errorMessage = error.error?.description || error.message || 'An internal server error occurred.';
        const statusCode = error.status || 500;
        return NextResponse.json({ message: errorMessage }, { status: statusCode });
    }
}
