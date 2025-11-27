
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
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

        const firestore = await getFirestore();
        const userRef = firestore.collection('users').doc(userId);

        await userRef.update({ status });

        const auth = getAuth();
        await auth.updateUser(userId, {
            disabled: status === 'Blocked'
        });

        return NextResponse.json({ message: 'User status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/users ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
