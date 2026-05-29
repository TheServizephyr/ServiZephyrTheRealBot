
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { getCountryCallingCode, parsePhoneNumberFromString, validatePhoneNumberLength } from 'libphonenumber-js';

function assertRestaurantCollection(collectionName) {
    if (collectionName !== 'restaurants') {
        throw {
            message: 'Bookings are only available for restaurant businesses.',
            status: 403,
        };
    }
}

function getCustomerNotificationTone(status, previousStatus) {
    if (status === 'confirmed') {
        return {
            responseMessage: 'Booking approved.',
        };
    }
    if (status === 'cancelled' && previousStatus === 'pending') {
        return {
            responseMessage: 'Booking rejected.',
        };
    }
    if (status === 'cancelled') {
        return {
            responseMessage: 'Booking cancelled.',
        };
    }
    return {
        responseMessage: `Booking marked as ${status}.`,
    };
}

function normalizePublicBookingPhonePayload(body = {}) {
    const countryIso = String(body.phoneCountryIso || 'IN').trim().toUpperCase();
    let dialCode = '';
    try {
        dialCode = getCountryCallingCode(countryIso);
    } catch {
        return null;
    }

    const rawNationalNumber = String(body.phoneNationalNumber || body.phone || '').replace(/\D/g, '');
    const parsedPhone = parsePhoneNumberFromString(rawNationalNumber, countryIso);
    if (!rawNationalNumber || validatePhoneNumberLength(rawNationalNumber, countryIso) !== undefined || parsedPhone?.isPossible() !== true) {
        return null;
    }

    const nationalNumber = parsedPhone.nationalNumber;
    const e164 = parsedPhone.number.replace(/\D/g, '');
    const storedPhone = countryIso === 'IN' && /^\d{10}$/.test(nationalNumber) ? nationalNumber : e164;

    return {
        storedPhone,
        phoneE164: e164,
        phoneNationalNumber: nationalNumber,
        phoneCountryDialCode: dialCode,
        phoneCountryIso: countryIso,
        phoneCountryName: String(body.phoneCountryName || '').trim(),
    };
}

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

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

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is managing bookings for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} accessing ${employeeOfOwnerId}'s bookings`);
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, collectionName: collectionName, businessData: doc.data() || {}, isAdmin: userRole === 'admin' };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


// GET all bookings for the owner's business
export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        assertRestaurantCollection(collectionName);

        const bookingsRef = firestore.collection(collectionName).doc(businessId).collection('bookings');
        const bookingsSnap = await bookingsRef.orderBy('bookingDateTime', 'desc').get();

        let bookings = bookingsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
            };
        });

        return NextResponse.json({ bookings }, { status: 200 });

    } catch (error) {
        console.error("GET BOOKINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

// POST a new booking from a customer
export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const body = await req.json();
        const { restaurantId, name, phone, guests, bookingDateTime, occasion, source } = body;

        if (!restaurantId || !name || !phone || !guests || !bookingDateTime) {
            return NextResponse.json({ message: 'Missing required booking data.' }, { status: 400 });
        }

        const normalizedPhonePayload = normalizePublicBookingPhonePayload(body);
        if (!normalizedPhonePayload) {
            return NextResponse.json({ message: 'Invalid phone number format.' }, { status: 400 });
        }
        const normalizedPhone = normalizedPhonePayload.storedPhone;

        const normalizedGuests = Number.parseInt(String(guests), 10);
        if (!Number.isInteger(normalizedGuests) || normalizedGuests < 1 || normalizedGuests > 20) {
            return NextResponse.json({ message: 'Guests must be between 1 and 20.' }, { status: 400 });
        }

        const bookingAt = new Date(bookingDateTime);
        if (Number.isNaN(bookingAt.getTime())) {
            return NextResponse.json({ message: 'Invalid booking date/time.' }, { status: 400 });
        }
        if (bookingAt.getTime() <= Date.now()) {
            return NextResponse.json({ message: 'Booking time must be in the future.' }, { status: 400 });
        }

        const businessRef = firestore.collection('restaurants').doc(restaurantId);
        const businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            return NextResponse.json({ message: `Business with ID ${restaurantId} not found.` }, { status: 404 });
        }
        const businessData = businessSnap.data();
        const businessType = String(businessData?.businessType || 'restaurant').trim().toLowerCase();
        if (businessType === 'shop' || businessType === 'store' || businessType === 'street-vendor' || businessType === 'street_vendor') {
            return NextResponse.json({ message: 'Bookings are only available for restaurant businesses.' }, { status: 403 });
        }
        if (businessData?.isBookingEnabled === false) {
            return NextResponse.json({ message: 'Bookings are currently disabled for this restaurant.' }, { status: 403 });
        }

        // Prevent duplicate active booking request for same phone and slot.
        const duplicateSnap = await businessRef.collection('bookings')
            .where('customerPhone', '==', normalizedPhone)
            .where('bookingDateTime', '==', bookingAt)
            .where('status', 'in', ['pending', 'confirmed'])
            .limit(1)
            .get();

        if (!duplicateSnap.empty) {
            return NextResponse.json({ message: 'You already have a booking request for this slot.' }, { status: 409 });
        }

        const newBookingRef = businessRef.collection('bookings').doc();

        const newBookingData = {
            id: newBookingRef.id,
            customerName: String(name || '').trim(),
            customerPhone: normalizedPhone,
            customerPhoneE164: normalizedPhonePayload.phoneE164,
            customerPhoneNationalNumber: normalizedPhonePayload.phoneNationalNumber,
            customerPhoneDialCode: normalizedPhonePayload.phoneCountryDialCode,
            customerPhoneCountryIso: normalizedPhonePayload.phoneCountryIso,
            customerPhoneCountryName: normalizedPhonePayload.phoneCountryName,
            partySize: normalizedGuests,
            bookingDateTime: bookingAt,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            notes: String(occasion || '').trim(),
            occasion: String(occasion || '').trim(),
            source: String(source || '').trim() === 'manual_quick_add' ? 'manual_quick_add' : 'public_booking',
        };

        await newBookingRef.set(newBookingData);

        // TODO: Send WhatsApp notification to owner

        return NextResponse.json({ message: 'Booking request sent successfully!', id: newBookingRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST BOOKING ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

// PATCH to update a booking's status
export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        assertRestaurantCollection(collectionName);
        const { bookingId, status } = await req.json();

        if (!bookingId || !status) {
            return NextResponse.json({ message: 'Booking ID and new status are required.' }, { status: 400 });
        }

        const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
        }

        const bookingRef = firestore.collection(collectionName).doc(businessId).collection('bookings').doc(bookingId);

        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
            return NextResponse.json({ message: 'Booking not found.' }, { status: 404 });
        }

        const bookingData = bookingSnap.data() || {};
        const previousStatus = String(bookingData.status || '').trim().toLowerCase();
        const updates = {
            status,
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (status === 'confirmed') updates.confirmedAt = FieldValue.serverTimestamp();
        if (status === 'cancelled') updates.cancelledAt = FieldValue.serverTimestamp();
        if (status === 'completed') updates.completedAt = FieldValue.serverTimestamp();

        await bookingRef.update(updates);

        const notification = getCustomerNotificationTone(status, previousStatus);

        return NextResponse.json({
            message: notification.responseMessage,
        }, { status: 200 });

    } catch (error) {
        console.error("PATCH BOOKING ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
