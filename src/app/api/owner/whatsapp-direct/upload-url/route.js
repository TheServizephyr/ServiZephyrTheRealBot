
import { NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';

// ✅ ALLOWED FILE TYPES (Images, Videos, Documents, Audio)
const ALLOWED_MIME_TYPES = {
    images: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
    videos: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'],
    documents: [
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.ms-excel', // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    ],
    audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4'],
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function isFileTypeAllowed(mimeType) {
    return Object.values(ALLOWED_MIME_TYPES).flat().includes(mimeType);
}

function getMediaType(mimeType) {
    if (ALLOWED_MIME_TYPES.images.includes(mimeType)) return 'image';
    if (ALLOWED_MIME_TYPES.videos.includes(mimeType)) return 'video';
    if (ALLOWED_MIME_TYPES.documents.includes(mimeType)) return 'document';
    if (ALLOWED_MIME_TYPES.audio.includes(mimeType)) return 'audio';
    return 'unknown';
}


export async function POST(req) {
    try {
        const { businessId } = await verifyOwnerFeatureAccess(req, 'whatsapp-direct', 'upload_whatsapp_direct_media');
        const { fileName, fileType, fileSize } = await req.json();

        if (!fileName || !fileType) {
            return NextResponse.json({ message: 'Missing required parameters (fileName, fileType).' }, { status: 400 });
        }

        // ✅ VALIDATE FILE TYPE (Ignore parameters like charset or codecs)
        const baseMimeType = fileType.split(';')[0].trim().toLowerCase();

        if (!isFileTypeAllowed(baseMimeType)) {
            console.error(`[Upload URL] Rejected MIME type: ${fileType} (base: ${baseMimeType})`);
            return NextResponse.json({
                message: `File type not allowed. Supported: Images, Videos, Documents (PDF, Word, Excel), and Audio files.`,
                allowedTypes: ALLOWED_MIME_TYPES
            }, { status: 400 });
        }

        // ✅ VALIDATE FILE SIZE (25MB limit)
        if (fileSize && fileSize > MAX_FILE_SIZE) {
            return NextResponse.json({
                message: `File size exceeds limit. Maximum allowed: 25MB`,
                maxSize: MAX_FILE_SIZE
            }, { status: 400 });
        }

        // ✅ FIX: Use correct project ID
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe';
        const bucket = getStorage().bucket(`${projectId}.firebasestorage.app`);

        const extension = fileName.split('.').pop();
        const uniqueFileName = `${nanoid()}.${extension}`;
        const mediaType = getMediaType(baseMimeType);
        const filePath = `business_media/MESSAGE_MEDIA/${businessId}/${Date.now()}_${uniqueFileName}`;

        const file = bucket.file(filePath);

        // Generate Signed URL for UPLOAD (Write)
        // ✅ Enforce the CLEAN mime type (e.g., 'audio/webm') for stability
        const [uploadUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: baseMimeType,
        });

        // ✅ FIX: Generate Signed URL for READ with 7 days expiration (Max allowed by GCS V4)
        const [readUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        return NextResponse.json({
            success: true,
            presignedUrl: uploadUrl,
            publicUrl: readUrl,
            mediaType: mediaType,
            fileName: uniqueFileName,
            storagePath: filePath,
            finalMimeType: baseMimeType // Tell frontend exactly what content-type to use
        }, { status: 200 });

    } catch (error) {
        console.error("CREATE UPLOAD URL ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
