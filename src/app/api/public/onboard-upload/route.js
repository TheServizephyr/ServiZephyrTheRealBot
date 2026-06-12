import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';
import { firebaseConfig } from '@/firebase/config';

export async function POST(req) {
    try {
        // Initialize Firebase Admin by calling getFirestore()
        await getFirestore();

        const formData = await req.formData();
        const files = formData.getAll('files');

        if (!files || files.length === 0) {
            return NextResponse.json({ message: 'No files provided.' }, { status: 400 });
        }

        const bucketName = firebaseConfig.storageBucket || `gs://${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
        const bucket = getStorage().bucket(bucketName);

        const uploadedUrls = [];

        for (const file of files) {
            if (!(file instanceof File)) continue;

            const buffer = Buffer.from(await file.arrayBuffer());
            const extension = file.name.split('.').pop() || 'jpg';
            const uniqueFileName = `${nanoid()}.${extension}`;
            const filePath = `onboarding_assets/menus/${uniqueFileName}`;

            const firebaseFile = bucket.file(filePath);

            await firebaseFile.save(buffer, {
                metadata: {
                    contentType: file.type,
                },
                public: true,
            });

            // Standard public storage URL format
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
            uploadedUrls.push(publicUrl);
        }

        return NextResponse.json({
            success: true,
            urls: uploadedUrls
        }, { status: 200 });

    } catch (error) {
        console.error("PUBLIC ASSET UPLOAD ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
