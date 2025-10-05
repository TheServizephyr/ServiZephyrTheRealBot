
import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // Check role from the central 'users' collection
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    // Find the restaurant associated with this owner
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    const restaurantId = restaurantsQuery.docs[0].id;
    
    return { uid, restaurantId };
}

// NEW CUSTOMER-CENTRIC SEEDING LOGIC
async function seedInitialCustomers(firestore, restaurantId) {
    const batch = firestore.batch();
    const usersRef = firestore.collection('users');
    const restaurantCustomersRef = firestore.collection('restaurants').doc(restaurantId).collection('customers');
    
    const initialCustomers = [
        { uid: 'seed-user-rohan', name: 'Rohan Sharma', email: 'rohan.sharma@example.com', phone: '9876543210', role: 'customer', totalSpend: 12550, loyaltyPoints: 125, lastOrderDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
        { uid: 'seed-user-priya', name: 'Priya Desai', email: 'priya.desai@example.com', phone: '9876543211', role: 'customer', totalSpend: 8750, loyaltyPoints: 87, lastOrderDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        { uid: 'seed-user-amit', name: 'Amit Patel', email: 'amit.patel@example.com', phone: '9876543212', role: 'customer', totalSpend: 25400, loyaltyPoints: 254, lastOrderDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    ];

    const finalCustomersForRestaurant = [];

    initialCustomers.forEach(cust => {
        // 1. Create the central user document in 'users' collection
        const centralUserRef = usersRef.doc(cust.uid);
        batch.set(centralUserRef, {
            name: cust.name,
            email: cust.email,
            phone: cust.phone,
            role: 'customer',
            profilePictureUrl: `https://picsum.photos/seed/${cust.uid}/200/200`,
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
        });
        
        // 2. Link this customer to the specific restaurant in the sub-collection
        const restaurantCustomerRef = restaurantCustomersRef.doc(cust.uid);
        const restaurantCustomerData = {
            name: cust.name, // Denormalized for easy display in owner dashboard
            phone: cust.phone, // Denormalized
            email: cust.email, // Denormalized
            totalSpend: cust.totalSpend,
            loyaltyPoints: cust.loyaltyPoints,
            lastOrderDate: adminFirestore.Timestamp.fromDate(cust.lastOrderDate),
            notes: 'This is a sample customer.'
        };
        batch.set(restaurantCustomerRef, restaurantCustomerData);

        // 3. (Optional but good practice) Create the reverse link in the user's document
        const userRestaurantLinkRef = centralUserRef.collection('joined_restaurants').doc(restaurantId);
        batch.set(userRestaurantLinkRef, {
            // This data would be fetched from the restaurant doc in a real scenario
            restaurantName: "Your Seed Restaurant", 
            joinedAt: adminFirestore.FieldValue.serverTimestamp()
        });

        // Prepare data to be returned for the immediate API response
        finalCustomersForRestaurant.push({
            id: cust.uid, // The ID is the user's UID
            ...restaurantCustomerData
        });
    });

    await batch.commit();
    return finalCustomersForRestaurant;
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const customersRef = firestore.collection('restaurants').doc(restaurantId).collection('customers');
        const customersSnap = await customersRef.orderBy('totalSpend', 'desc').get();

        let customers = [];
        if (customersSnap.empty) {
            customers = await seedInitialCustomers(firestore, restaurantId);
        } else {
            customers = customersSnap.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ...data,
                    // Ensure date is ISO string for client
                    lastOrderDate: data.lastOrderDate?.toDate().toISOString()
                };
            });
        }
        
        const totalCustomers = customers.length;
        const topSpender = customers.length > 0 ? customers.reduce((prev, current) => ((prev.totalSpend || 0) > (current.totalSpend || 0)) ? prev : current, {}) : {};
        
        const stats = {
            totalCustomers,
            // These stats would be recalculated based on orders in a real scenario
            newThisMonth: Math.floor(totalCustomers / 5), 
            repeatRate: totalCustomers > 0 ? 65 : 0,
            topSpender,
        };

        return NextResponse.json({ customers, stats }, { status: 200 });

    } catch (error) {
        console.error("GET CUSTOMERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { customerId, notes } = await req.json();

        if (!customerId || notes === undefined) {
            return NextResponse.json({ message: 'Customer ID and notes are required.' }, { status: 400 });
        }

        // The customerId is the UID of the user. We are updating the record in the restaurant's sub-collection.
        const customerRef = firestore.collection('restaurants').doc(restaurantId).collection('customers').doc(customerId);
        
        const customerSnap = await customerRef.get();
        if (!customerSnap.exists) {
            return NextResponse.json({ message: 'Customer not found in this restaurant.' }, { status: 404 });
        }

        // Only update the notes field in the restaurant's sub-collection.
        await customerRef.update({ notes: notes });

        return NextResponse.json({ message: 'Customer notes updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH CUSTOMER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
