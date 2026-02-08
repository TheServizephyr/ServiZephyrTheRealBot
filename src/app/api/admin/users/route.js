
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const usersSnap = await firestore.collection('users').get();

        const users = usersSnap.docs.map(doc => {
            const data = doc.data();

            // Determine user role based on businessType and role fields
            let userRole = 'Customer'; // Default

            if (data.role === 'admin' || data.isAdmin) {
                userRole = 'Admin';
            } else if (data.businessType === 'restaurant') {
                userRole = 'Owner';
            } else if (data.businessType === 'shop') {
                userRole = 'Shop Owner';
            } else if (data.businessType === 'street-vendor' || data.businessType === 'street_vendor') {
                userRole = 'Street Vendor';
            } else if (data.role === 'rider' || data.role === 'delivery') {
                userRole = 'Rider';
            } else if (data.role === 'owner') {
                userRole = 'Owner';
            } else if (data.role) {
                userRole = data.role.charAt(0).toUpperCase() + data.role.slice(1);
            }

            // Try multiple timestamp fields for join date
            let joinDate;
            const timestampFields = ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt'];

            for (const field of timestampFields) {
                if (data[field]) {
                    joinDate = data[field]?.toDate?.()?.toISOString() || data[field];
                    break;
                }
            }

            if (!joinDate) {
                joinDate = 'Unknown';
            }

            return {
                id: doc.id,
                name: data.name || 'Unnamed User',
                email: data.email || 'No Email',
                phone: data.phone || data.phoneNumber || 'No Phone',
                role: userRole,
                joinDate: joinDate,
                status: data.status || 'Active',
                profilePictureUrl: data.profilePictureUrl,
            };
        });

        // Sort by join date - latest first, invalid dates at the end
        users.sort((a, b) => {
            const dateA = new Date(a.joinDate);
            const dateB = new Date(b.joinDate);

            const isValidA = !isNaN(dateA.getTime()) && a.joinDate !== 'Unknown';
            const isValidB = !isNaN(dateB.getTime()) && b.joinDate !== 'Unknown';

            if (isValidA && isValidB) {
                return dateB - dateA;
            }
            if (isValidA && !isValidB) {
                return -1;
            }
            if (!isValidA && isValidB) {
                return 1;
            }
            return 0;
        });

        return NextResponse.json({ users }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/users ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const { userId, status } = await req.json();

        if (!userId || !status) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const validStatuses = ['Active', 'Blocked'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const userRef = firestore.collection('users').doc(userId);

        await userRef.update({ status });

        const auth = await getAuth();
        await auth.updateUser(userId, {
            disabled: status === 'Blocked'
        });

        return NextResponse.json({ message: 'User status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/users ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
