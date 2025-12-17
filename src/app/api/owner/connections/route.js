

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their UID
async function verifyOwner(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use the central helper
    
    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing connections for owner ${impersonatedOwnerId}.`);
        return impersonatedOwnerId;
    }
    
    // Employee access
    if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');
        
        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        
        console.log(`[API Employee Access] ${uid} viewing ${employeeOfOwnerId}'s connections`);
        return employeeOfOwnerId;
    }

    // Owner access
    if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    return uid;
}

export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const ownerId = await verifyOwner(req, auth, firestore);

        const restaurantsQuery = await firestore.collection('restaurants')
            .where('ownerId', '==', ownerId)
            .where('botPhoneNumberId', '!=', null)
            .get();
            
        const shopsQuery = await firestore.collection('shops')
            .where('ownerId', '==', ownerId)
            .where('botPhoneNumberId', '!=', null)
            .get();

        if (restaurantsQuery.empty && shopsQuery.empty) {
            return NextResponse.json({ connections: [] }, { status: 200 });
        }
        
        const restaurantConnections = restaurantsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus || 'Connected'
            };
        });
        
        const shopConnections = shopsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus || 'Connected'
            };
        });

        const connections = [...restaurantConnections, ...shopConnections];

        return NextResponse.json({ connections }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/connections ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

