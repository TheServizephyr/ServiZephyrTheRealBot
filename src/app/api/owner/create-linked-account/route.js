
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
    
    return restaurantsQuery.docs[0];
}


export async function POST(req) {
    try {
        const restaurantDoc = await verifyOwnerAndGetRestaurantRef(req);
        const restaurantRef = restaurantDoc.ref;
        const ownerId = restaurantDoc.data().ownerId;
        
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

        const ownerDoc = await getFirestore().collection('users').doc(ownerId).get();
        const ownerEmail = ownerDoc.exists ? ownerDoc.data().email : null;

        if (!ownerEmail) {
             return NextResponse.json({ message: 'Owner email not found, which is required for creating a linked account.' }, { status: 400 });
        }
        
        // --- CORRECTED LOGIC: Create a Contact first, then a Fund Account ---

        // Step 1: Create a Contact
        const contactPayload = {
            name: name, // Use the account holder's name for the contact
            email: ownerEmail,
            // You can add more details like contact number if available
        };
        const contact = await razorpay.contacts.create(contactPayload);
        if (!contact || !contact.id) {
            throw new Error("Failed to create Contact on Razorpay.");
        }
        const contactId = contact.id;
        
        // Step 2: Use the Contact ID to create the Fund Account
        const fundAccountPayload = {
            contact_id: contactId,
            account_type: 'bank_account',
            bank_account: {
                name: name,
                ifsc: ifsc,
                account_number: account_number
            }
        };

        const fundAccount = await razorpay.fundAccount.create(fundAccountPayload);
        
        if (!fundAccount || !fundAccount.id) {
            throw new Error("Failed to create Fund Account on Razorpay. The response did not contain a Fund Account ID.");
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
        // Log the entire error object to see its structure
        console.error("CREATE LINKED ACCOUNT API - FULL ERROR OBJECT:", JSON.stringify(error, null, 2));

        // Try to find the message, even if it's nested
        const errorMessage = error.response?.data?.error?.description || error.message || "An unknown error occurred. Check server logs for the full error object.";
        
        return NextResponse.json({ message: `Backend Error: ${errorMessage}` }, { status: 500 });
    }
}
