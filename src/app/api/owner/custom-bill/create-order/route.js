import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { sendSystemMessage } from '@/lib/whatsapp';
import { getOrCreateGuestProfile, obfuscateGuestId } from '@/lib/guest-utils';
import { createOrderV2 } from '@/services/order/createOrder.service';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
    return null;
}

function toPositiveNumber(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
}

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeItem(item, index) {
    const qty = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const unitPrice = toPositiveNumber(item?.price ?? item?.portion?.price, 0);
    const totalPrice = toPositiveNumber(item?.totalPrice, unitPrice * qty);

    return {
        id: item?.id || `manual-item-${index}`,
        name: item?.name || 'Custom Item',
        categoryId: item?.categoryId || 'manual',
        isVeg: !!item?.isVeg,
        quantity: qty,
        price: unitPrice,
        totalPrice,
        cartItemId: item?.cartItemId || `${item?.id || 'item'}-${index}`,
        portion: item?.portion?.name
            ? {
                name: item.portion.name,
                price: toPositiveNumber(item.portion.price, unitPrice),
            }
            : {
                name: 'Standard',
                price: unitPrice,
            },
        selectedAddOns: Array.isArray(item?.selectedAddOns)
            ? item.selectedAddOns.map((addOn) => ({
                name: addOn?.name || 'Addon',
                price: toPositiveNumber(addOn?.price, 0),
                quantity: Math.max(1, parseInt(addOn?.quantity, 10) || 1),
            }))
            : [],
    };
}

async function geocodeAddress(addressText) {
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error('Google Maps key missing on server.');
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressText)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    if (!res.ok || data.status !== 'OK' || !data.results?.length) {
        const reason = data.error_message || data.status || 'Geocoding failed';
        throw new Error(`Address geocoding failed: ${reason}`);
    }

    const first = data.results[0];
    const lat = Number(first?.geometry?.location?.lat);
    const lng = Number(first?.geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Address coordinates are invalid.');
    }

    return {
        latitude: lat,
        longitude: lng,
        formattedAddress: first.formatted_address || addressText,
    };
}

function getBusinessTypeFromCollection(collectionName) {
    if (collectionName === 'shops') return 'shop';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

function resolvePublicBaseUrl(req) {
    const PROD_BASE_URL = 'https://www.servizephyr.com';
    const envBase =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        '';

    const requestOrigin = (() => {
        try {
            return new URL(req.url).origin;
        } catch {
            return '';
        }
    })();

    const rawBase = (envBase || requestOrigin || PROD_BASE_URL).trim();
    const isTunnelOrLocal = /localhost|127\.0\.0\.1|ngrok|trycloudflare|loca\.lt|localtunnel/i.test(rawBase);

    return isTunnelOrLocal ? PROD_BASE_URL : rawBase;
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_create_order',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, businessSnap, collectionName } = context;
        const body = await req.json();

        const customerDetails = body?.customerDetails || {};
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const notes = body?.notes || '';

        const customerName = String(customerDetails?.name || 'Guest').trim() || 'Guest';
        const phone = normalizePhone(customerDetails?.phone);
        const addressText = String(customerDetails?.address || '').trim();

        if (!phone) {
            return NextResponse.json({ message: 'Valid customer phone is required.' }, { status: 400 });
        }
        if (!rawItems.length) {
            return NextResponse.json({ message: 'At least one item is required.' }, { status: 400 });
        }

        const items = rawItems.map(normalizeItem);
        const subtotal = items.reduce((sum, item) => sum + toPositiveNumber(item.totalPrice, 0), 0);

        const providedLat = toFiniteNumber(customerDetails?.latitude ?? customerDetails?.lat);
        const providedLng = toFiniteNumber(customerDetails?.longitude ?? customerDetails?.lng);
        const hasProvidedAddress = !!addressText;

        let geocoded = null;
        if (hasProvidedAddress) {
            geocoded = (providedLat !== null && providedLng !== null)
                ? {
                    latitude: providedLat,
                    longitude: providedLng,
                    formattedAddress: addressText,
                }
                : await geocodeAddress(addressText);
        }

        const firestore = await getFirestore();
        const profileResult = await getOrCreateGuestProfile(firestore, phone);
        const guestRef = await obfuscateGuestId(profileResult.userId);

        const createOrderPayload = {
            name: customerName,
            phone,
            address: hasProvidedAddress ? {
                full: geocoded.formattedAddress,
                latitude: geocoded.latitude,
                longitude: geocoded.longitude,
            } : null,
            restaurantId: businessId,
            items,
            notes,
            paymentMethod: 'cod',
            businessType: getBusinessTypeFromCollection(collectionName),
            deliveryType: 'delivery',
            subtotal,
            cgst: 0,
            sgst: 0,
            grandTotal: subtotal,
            deliveryCharge: 0,
            skipAddressValidation: !hasProvidedAddress,
            idempotencyKey: `manual_call_${businessId}_${Date.now()}_${nanoid(8)}`,
            guestRef,
        };

        const createOrderReq = { json: async () => createOrderPayload };
        const createOrderRes = await createOrderV2(createOrderReq);
        const createOrderData = await createOrderRes.json();

        if (!createOrderRes.ok) {
            return NextResponse.json(createOrderData, { status: createOrderRes.status });
        }

        const orderId = createOrderData?.order_id || createOrderData?.firestore_order_id;
        const token = createOrderData?.token;
        if (!orderId || !token) {
            return NextResponse.json(
                { message: 'Order created but tracking token missing.' },
                { status: 500 }
            );
        }

        const baseUrl = resolvePublicBaseUrl(req);
        const trackingUrl = `${baseUrl}/track/delivery/${orderId}?token=${token}&ref=${encodeURIComponent(guestRef)}&activeOrderId=${orderId}`;
        const returnTrackingPath = `/track/delivery/${orderId}?token=${token}&ref=${guestRef}&activeOrderId=${orderId}`;
        const addAddressLink = `${baseUrl}/add-address?ref=${encodeURIComponent(guestRef)}&phone=${phone}&activeOrderId=${orderId}&returnUrl=${encodeURIComponent(returnTrackingPath)}`;

        const businessData = businessSnap.data() || {};
        const botPhoneNumberId = businessData.botPhoneNumberId;
        let whatsappSent = false;
        let whatsappError = null;

        if (botPhoneNumberId) {
            try {
                const message = hasProvidedAddress
                    ? `Your order has been created successfully.\n\nTrack your order here:\n${trackingUrl}`
                    : `Your order has been created successfully.\n\nTo enable live tracking, please add your current delivery location:\n${addAddressLink}`;
                const waResponse = await sendSystemMessage(
                    `91${phone}`,
                    message,
                    botPhoneNumberId,
                    businessId,
                    businessData.name || 'ServiZephyr',
                    collectionName
                );
                if (waResponse?.messages?.[0]?.id) {
                    whatsappSent = true;
                } else {
                    whatsappSent = false;
                    whatsappError = 'WhatsApp API did not return a message id.';
                }
            } catch (err) {
                whatsappError = err?.message || 'Failed to send WhatsApp message.';
                console.error('[Custom Bill Create Order] WhatsApp send failed:', err);
            }
        } else {
            whatsappError = 'Business botPhoneNumberId is not configured.';
        }

        return NextResponse.json({
            message: 'Order created successfully.',
            orderId,
            token,
            guestRef,
            trackingUrl,
            addAddressLink: hasProvidedAddress ? null : addAddressLink,
            addressPending: !hasProvidedAddress,
            whatsappSent,
            whatsappError,
        });
    } catch (error) {
        console.error('[Custom Bill Create Order] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
