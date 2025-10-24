

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';

async function verifyOwnerAndGetBusinessRef(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw { message: 'Unauthorized', status: 401 };
    
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    let targetOwnerId = uid;
    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].id;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].id;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function POST(req) {
    try {
        const businessId = await verifyOwnerAndGetBusinessRef(req);
        const { fileName, fileType, conversationId } = await req.json();

        if (!fileName || !fileType || !conversationId) {
            return NextResponse.json({ message: 'Missing required parameters.' }, { status: 400 });
        }
        
        const bucket = getStorage().bucket(`gs://${process.env.FIREBASE_PROJECT_ID}.appspot.com`);
        const extension = fileName.split('.').pop();
        const uniqueFileName = `${nanoid()}.${extension}`;
        const filePath = `whatsapp_media/${businessId}/${conversationId}/${uniqueFileName}`;
        
        const file = bucket.file(filePath);

        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: fileType,
        });

        // The public URL of the file after upload
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        return NextResponse.json({ 
            success: true, 
            presignedUrl: url,
            publicUrl: publicUrl
        }, { status: 200 });

    } catch (error) {
        console.error("CREATE UPLOAD URL ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
