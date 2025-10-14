import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import Razorpay from 'razorpay';

async function verifyOwnerAndGetRestaurantRef(req) {
    const auth = getAuth();
    const firestore = getFirestore();
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
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    
    return restaurantsQuery.docs[0].ref;
}


export async function POST(req) {
    try {
        const restaurantRef = await verifyOwnerAndGetRestaurantRef(req);
        const { name, account_number, ifsc } = await req.json();

        if (!name || !account_number || !ifsc) {
            return NextResponse.json({ message: 'Account holder name, account number, and IFSC code are required.' }, { status: 400 });
        }
        
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("Razorpay keys are not configured in environment variables.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }

        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const restaurantSnap = await restaurantRef.get();
        const ownerId = restaurantSnap.data().ownerId;
        const ownerDoc = await getFirestore().collection('users').doc(ownerId).get();
        const ownerEmail = ownerDoc.data().email;

        if (!ownerEmail) {
             return NextResponse.json({ message: 'Owner email not found, which is required for creating a linked account.' }, { status: 400 });
        }
        
        // --- UPDATED LOGIC: Use Fund Account API ---
        const fundAccountPayload = {
            contact: {
                name: name,
                email: ownerEmail,
            },
            account_type: 'bank_account',
            bank_account: {
                name: name,
                ifsc: ifsc,
                account_number: account_number
            }
        };

        const fundAccount = await razorpay.fundAccount.create(fundAccountPayload);
        
        if (!fundAccount || !fundAccount.id) {
            throw new Error("Failed to create Fund Account on Razorpay.");
        }

        // Save the returned fund account ID (starts with 'fa_')
        await restaurantRef.update({
            razorpayAccountId: fundAccount.id
        });

        return NextResponse.json({ 
            message: 'Razorpay Fund Account created and linked successfully!', 
            accountId: fundAccount.id 
        }, { status: 201 });

    } catch (error) {
        console.error("CREATE LINKED ACCOUNT API ERROR:", error.response ? error.response.data : error.message);
        const errorMessage = error.response?.data?.error?.description || error.message || "An unknown error occurred.";
        return NextResponse.json({ message: `Backend Error: ${errorMessage}` }, { status: error.status || 500 });
    }
}
