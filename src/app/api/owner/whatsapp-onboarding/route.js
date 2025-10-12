
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import axios from 'axios';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurantRef(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    // For this flow, we assume the owner manages one primary restaurant.
    // A more complex system might ask the owner which restaurant to connect.
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner. Please complete your profile first.', status: 404 };
    }
    
    return restaurantsQuery.docs[0].ref;
}

export async function POST(req) {
    const auth = getAuth();
    const firestore = getFirestore();

    try {
        // Step 2.2: Secure the Endpoint
        const restaurantRef = await verifyOwnerAndGetRestaurantRef(req, auth, firestore);

        const { code } = await req.json();
        if (!code) {
            return NextResponse.json({ message: 'Authorization code is missing.' }, { status: 400 });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        // Step 2.3: Exchange the Authorization Code for a User Access Token
        const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
            params: {
                client_id: appId,
                client_secret: appSecret,
                code: code,
            }
        });

        const userAccessToken = tokenResponse.data.access_token;
        if (!userAccessToken) {
            throw new Error("Could not retrieve User Access Token from Facebook.");
        }

        // Step 2.4: Get the Bot's Details (The Handshake)
        // Debug the token to get the embedded signup session details
        const debugResponse = await axios.get('https://graph.facebook.com/debug_token', {
            params: {
                input_token: userAccessToken,
                access_token: `${appId}|${appSecret}` // App Access Token
            }
        });
        
        const embeddedSignupData = debugResponse.data.data?.granular_scopes?.find(s => s.scope === 'whatsapp_business_management')?.target_ids;
        if (!embeddedSignupData || embeddedSignupData.length === 0) {
            console.error("Debug Token Response:", JSON.stringify(debugResponse.data, null, 2));
            throw new Error("Could not retrieve WhatsApp Business Account details from the session. The `target_ids` field is missing or empty.");
        }
        
        const waba_id = embeddedSignupData[0];

        // Get phone number ID using the WABA ID
        const phoneNumbersResponse = await axios.get(`https://graph.facebook.com/v19.0/${waba_id}/phone_numbers`, {
             params: {
                access_token: userAccessToken
            }
        });

        if (!phoneNumbersResponse.data.data || phoneNumbersResponse.data.data.length === 0) {
            throw new Error(`No phone numbers found for WABA ID: ${waba_id}`);
        }

        const phone_number_id = phoneNumbersResponse.data.data[0].id;
        
        // Step 2.5: Save the Credentials to Firestore
        const updateData = {
            botPhoneNumberId: phone_number_id,
            wabaId: waba_id,
            botStatus: 'Connected', // Update status
        };

        await restaurantRef.set(updateData, { merge: true });

        // Step 2.6: Send a Success Response
        return NextResponse.json({ message: 'WhatsApp bot connected successfully!' }, { status: 200 });

    } catch (error) {
        console.error("WHATSAPP ONBOARDING ERROR:", error.response ? error.response.data : error.message);
        
        let errorMessage = 'An internal server error occurred.';
        let statusCode = 500;

        if (error.status) {
            errorMessage = error.message;
            statusCode = error.status;
        } else if (error.response && error.response.data && error.response.data.error) {
            errorMessage = error.response.data.error.message || 'Failed to communicate with Facebook API.';
        } else {
            errorMessage = error.message;
        }

        return NextResponse.json({ message: errorMessage }, { status: statusCode });
    }
}
