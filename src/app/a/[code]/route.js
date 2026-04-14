import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const CODE_REGEX = /^[A-Za-z0-9_-]{6,32}$/;

function coerceDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
        return value.toDate();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const ALLOWED_PATH_PREFIXES = ['/add-address', '/public/bill/', '/order/', '/track/'];

function normalizeTargetPath(targetPath) {
    if (typeof targetPath !== 'string') return null;
    if (!targetPath.startsWith('/')) return null;
    const isAllowed = ALLOWED_PATH_PREFIXES.some((prefix) => targetPath.startsWith(prefix));
    if (!isAllowed) return null;
    return targetPath;
}

export async function GET(request, { params }) {
    try {
        const code = String(params?.code || '').trim();
        if (!CODE_REGEX.test(code)) {
            return new NextResponse('Invalid link.', { status: 400 });
        }

        const firestore = await getFirestore();
        const linkRef = firestore.collection('short_links').doc(code);
        const linkSnap = await linkRef.get();

        if (!linkSnap.exists) {
            return new NextResponse('This link is invalid or expired.', { status: 404 });
        }

        const linkData = linkSnap.data() || {};
        const expiresAt = coerceDate(linkData.expiresAt);

        const targetPath = normalizeTargetPath(linkData.targetPath);
        if (!targetPath) {
            return new NextResponse('Invalid link target.', { status: 400 });
        }

        await linkRef.set({
            status: 'used',
            lastAccessedAt: new Date(),
            ...(expiresAt && expiresAt.getTime() < Date.now()
                ? { revivedAt: new Date() }
                : {}),
            accessCount: FieldValue.increment(1),
        }, { merge: true });

        const requestUrl = new URL(request.url);
        const redirectUrl = new URL(targetPath, requestUrl.origin);
        return NextResponse.redirect(redirectUrl, 302);
    } catch (error) {
        console.error('[Short Link Redirect] Error:', error);
        return new NextResponse('Unable to open link right now. Please try again.', { status: 500 });
    }
}
