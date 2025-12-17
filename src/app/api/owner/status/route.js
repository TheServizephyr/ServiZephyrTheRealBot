
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their business
async function verifyOwnerAndGetBusiness(req) {
    const auth = await getAuth();
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    // --- Get URL params ---
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    // Get current user's data
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // Determine target owner ID
    let targetOwnerId = uid;

    // --- ADMIN IMPERSONATION ---
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing status for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // --- EMPLOYEE ACCESS (SECURE) ---
    else if (employeeOfOwnerId) {
        console.log(`[STATUS API DEBUG] employeeOfOwnerId:`, employeeOfOwnerId);
        console.log(`[STATUS API DEBUG] userData.linkedOutlets:`, JSON.stringify(userData.linkedOutlets || []));

        const accessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, userData);

        console.log(`[STATUS API DEBUG] accessResult:`, JSON.stringify(accessResult));

        if (!accessResult.authorized) {
            console.warn(`[SECURITY] Blocked unauthorized employee_of access: ${uid} -> ${employeeOfOwnerId}`);
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        console.log(`[API Employee Access] ${uid} (${accessResult.employeeRole}) accessing ${employeeOfOwnerId}'s data`);
        targetOwnerId = employeeOfOwnerId;
    }
    // --- OWNER ACCESS ---
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        // Check if user is employee-only (no owner role)
        const linkedOutlets = userData.linkedOutlets || [];
        const activeOutlet = linkedOutlets.find(o => o.status === 'active');
        if (activeOutlet) {
            // Employee without employee_of param - redirect them to use proper URL
            throw { message: 'Please select your outlet from the account selector.', status: 400 };
        }
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!querySnapshot.empty) {
            const docData = querySnapshot.docs[0].data();
            return {
                status: docData.approvalStatus || 'pending',
                restrictedFeatures: docData.restrictedFeatures || [],
                suspensionRemark: docData.suspensionRemark || '',
            };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const { status, restrictedFeatures, suspensionRemark } = await verifyOwnerAndGetBusiness(req);
        return NextResponse.json({ status, restrictedFeatures, suspensionRemark }, { status: 200 });
    } catch (error) {
        console.error("GET /api/owner/status ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
