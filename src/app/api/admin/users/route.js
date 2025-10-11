
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const firestore = getFirestore();
        const usersSnap = await firestore.collection('users').get();
        
        const users = usersSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || 'Unnamed User',
                email: data.email || 'No Email',
                phone: data.phone || 'No Phone',
                role: data.role?.charAt(0).toUpperCase() + data.role?.slice(1) || 'Customer',
                joinDate: data.createdAt?.toDate()?.toISOString() || new Date().toISOString(),
                status: data.status || 'Active',
                profilePictureUrl: data.profilePictureUrl,
            };
        });

        return NextResponse.json({ users }, { status: 200 });

    } catch (error) {
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { userId, status } = await req.json();

        if (!userId || !status) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const validStatuses = ['Active', 'Blocked'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        const firestore = getFirestore();
        const userRef = firestore.collection('users').doc(userId);
        
        await userRef.update({ status });
        
        const auth = getAuth();
        await auth.updateUser(userId, {
            disabled: status === 'Blocked'
        });
        
        return NextResponse.json({ message: 'User status updated successfully' }, { status: 200 });

    } catch (error) {
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
