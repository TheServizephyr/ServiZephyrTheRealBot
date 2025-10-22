

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import https from 'https';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their business details
async function verifyOwnerAndGetBusiness(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    } else {
        const userDoc = await firestore.collection('users').doc(uid).get();
        if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
             throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
        }
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const businessData = restaurantsQuery.docs[0].data();
        if (!businessData.razorpayAccountId) throw { message: 'Razorpay account is not linked.', status: 404 };
        return { razorpayAccountId: businessData.razorpayAccountId };
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', finalUserId).limit(1).get();
     if (!shopsQuery.empty) {
        const businessData = shopsQuery.docs[0].data();
        if (!businessData.razorpayAccountId) throw { message: 'Razorpay account is not linked.', status: 404 };
        return { razorpayAccountId: businessData.razorpayAccountId };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}

// Helper to make Razorpay API requests, now with header support
async function makeRazorpayRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    // First, try to parse as JSON
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        // If it's a JSON error from Razorpay, reject with it
                        reject(parsedData);
                    }
                } catch (e) {
                    // If parsing fails, it might be a non-JSON error (like HTML)
                    // Reject with a generic error, including the raw data for debugging
                    reject({ error: { description: `Failed to parse Razorpay JSON response. Raw data: ${data}` } });
                }
            });
        });
        req.on('error', (e) => reject({ error: { description: e.message } }));
        req.end();
    });
}


export async function GET(req) {
    try {
        const { razorpayAccountId } = await verifyOwnerAndGetBusiness(req);
        
        const { searchParams } = new URL(req.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
        
        // ** THE FIX: Fetch all payments for the linked account first, then get transfers for each. **
        const paymentQueryParams = new URLSearchParams();
        if (from) paymentQueryParams.append('from', from);
        if (to) paymentQueryParams.append('to', to);

        const paymentsPath = `/v1/payments?${paymentQueryParams.toString()}`;

        // ** CRITICAL FIX: Add the 'X-Razorpay-Account' header to specify the linked account **
        const fetchPaymentsOptions = {
            hostname: 'api.razorpay.com',
            port: 443,
            path: paymentsPath,
            method: 'GET',
            headers: { 
                'Authorization': `Basic ${credentials}`,
                'X-Razorpay-Account': razorpayAccountId 
            }
        };
        
        const paymentsData = await makeRazorpayRequest(fetchPaymentsOptions);
        
        if (!paymentsData.items || paymentsData.items.length === 0) {
            return NextResponse.json({ payouts: [], summary: { total: 0, lastPayout: 0, pending: 0 } }, { status: 200 });
        }
        
        const transferPromises = paymentsData.items.map(async (payment) => {
            if (payment.status !== 'captured') return { items: [] }; // Only look for transfers on captured payments
            const transferPath = `/v1/payments/${payment.id}/transfers`;
            const fetchTransfersOptions = {
                hostname: 'api.razorpay.com',
                port: 443,
                path: transferPath,
                method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            };
            // Adding a catch here to prevent one failed transfer call from breaking the whole Promise.all
            return makeRazorpayRequest(fetchTransfersOptions).catch(err => {
                console.warn(`Could not fetch transfers for payment ${payment.id}:`, err?.error?.description || err.message);
                return { items: [] }; // Return empty structure on error
            });
        });

        const transfersResults = await Promise.all(transferPromises);
        const allTransfers = transfersResults.flatMap(result => result.items || []);
        
        // Filter transfers to only include those made to our specific linked account
        const relevantTransfers = allTransfers.filter(t => t.recipient === razorpayAccountId);


        // Process transfers data into a payout format
        const payouts = relevantTransfers.map(transfer => ({
            id: transfer.id,
            amount: transfer.amount,
            currency: transfer.currency,
            status: transfer.status,
            utr: transfer.settlement_utr,
            created_at: transfer.created_at,
        }));
        
        // Calculate summary data from processed payouts
        const total = payouts.filter(p => p.status === 'processed').reduce((sum, p) => sum + p.amount, 0);
        
        // Sort payouts by date to find the latest one
        payouts.sort((a, b) => b.created_at - a.created_at);
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
