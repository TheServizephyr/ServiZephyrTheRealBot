
'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();

    const orderId = searchParams.get('orderId') || searchParams.get('firestore_order_id');
    const tokenFromUrl = searchParams.get('token');
    const restaurantId = searchParams.get('restaurantId');
    const whatsappNumber = searchParams.get('whatsappNumber');
    const deliveryTypeFromUrl = searchParams.get('deliveryType');
    const businessTypeFromUrl = searchParams.get('businessType');
    const tabIdFromUrl = searchParams.get('tabId');
    const phoneFromUrl = searchParams.get('phone');
    const refFromUrl = searchParams.get('ref');

    useEffect(() => {
        const handleRedirect = async () => {
            if (!orderId) {
                console.warn("[Order Placed] No Order ID found in URL. Cannot proceed.");
                router.replace('/');
                return;
            };

            // This is the critical step: Clear old data and save the new live order info
            // before any redirection happens.
            try {
                if (restaurantId) {
                    localStorage.removeItem(`cart_${restaurantId}`);
                    console.log(`[Order Placed] Cleared cart for restaurant ${restaurantId}.`);
                }

                const liveOrderKey = `liveOrder_${restaurantId}`;
                localStorage.removeItem(liveOrderKey);
                console.log(`[Order Placed] Cleared previous liveOrder from localStorage for key: ${liveOrderKey}.`);

                // The token might be in the URL (for COD) or we fetch it (for online).
                let finalToken = tokenFromUrl;
                let orderStatusData = null;
                let trackingPath = `/track/${orderId}`;
                const normalizedDeliveryType = String(deliveryTypeFromUrl || '').trim().toLowerCase();
                const normalizedBusinessType = String(businessTypeFromUrl || '').trim().toLowerCase();
                const canUseUrlRoutingHints = Boolean(finalToken && (normalizedDeliveryType || normalizedBusinessType));

                if (canUseUrlRoutingHints) {
                    if (normalizedBusinessType === 'street-vendor' || normalizedDeliveryType === 'street-vendor-pre-order') {
                        trackingPath = `/track/pre-order/${orderId}`;
                    } else if (normalizedDeliveryType === 'dine-in' || normalizedDeliveryType === 'car-order') {
                        trackingPath = `/track/dine-in/${orderId}`;
                    } else if (normalizedDeliveryType === 'delivery' || normalizedDeliveryType === 'pickup') {
                        trackingPath = `/track/delivery/${orderId}`;
                    }
                }

                if (!canUseUrlRoutingHints && !orderStatusData) {
                    console.log(finalToken
                        ? `[Order Placed] Fetching order details for ${orderId}...`
                        : `[Order Placed] Token not in URL for ${orderId}, fetching from API...`);
                    // Add a small delay to allow Firestore to be consistent
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        orderStatusData = await res.json();
                        if (orderStatusData.order?.trackingToken) {
                            finalToken = finalToken || orderStatusData.order.trackingToken;
                            console.log(`[Order Placed] Successfully fetched token from API.`);
                        } else if (!finalToken) {
                            throw new Error("Tracking token was not found in the API response.");
                        }
                    } else {
                        throw new Error(`API responded with status ${res.status}`);
                    }
                }

                if (finalToken) {
                    localStorage.setItem(liveOrderKey, JSON.stringify({
                        orderId,
                        restaurantId,
                        trackingToken: finalToken,
                        status: 'pending',
                        timestamp: Date.now(),
                    }));
                    console.log(`[Order Placed] Saved new live order to localStorage with key: ${liveOrderKey}`);

                    if (!canUseUrlRoutingHints && !orderStatusData) {
                        const res = await fetch(`/api/order/status/${orderId}`);
                        if (res.ok) {
                            orderStatusData = await res.json();
                        }
                    }

                    // Fetch order details to determine correct tracking page
                    if (orderStatusData?.order) {
                        const deliveryType = orderStatusData.order?.deliveryType;
                        const businessType = orderStatusData.order?.businessType;

                        console.log(`[Order Placed] Detected deliveryType: ${deliveryType}, businessType: ${businessType}`);

                        // ✅ STREET VENDOR: Save to multi-order localStorage
                        if (businessType === 'street-vendor') {
                            const { addVendorOrder } = await import('@/lib/vendorOrdersStorage');
                            addVendorOrder(restaurantId, {
                                orderId,
                                token: finalToken,
                                totalAmount: orderStatusData.order?.totalAmount || 0,
                                itemCount: orderStatusData.order?.items?.length || 0
                            });
                            console.log(`[Order Placed] Added street vendor order to multi-order storage`);
                        }

                        // Route based on BUSINESS TYPE first (street vendors have special tracking)
                        if (businessType === 'street-vendor') {
                            trackingPath = `/track/pre-order/${orderId}`;
                        } else if (deliveryType === 'dine-in') {
                            trackingPath = `/track/dine-in/${orderId}`;
                        } else if (deliveryType === 'delivery' || deliveryType === 'pickup') {
                            trackingPath = `/track/delivery/${orderId}`;
                        } else if (deliveryType === 'street-vendor-pre-order') {
                            trackingPath = `/track/pre-order/${orderId}`;
                        } else {
                            // Fallback to generic tracking
                            trackingPath = `/track/${orderId}`;
                        }
                    } else {
                        // Fallback if API fails
                        console.warn('[Order Placed] Could not fetch order data, using generic tracking');
                        trackingPath = `/track/${orderId}`;
                    }

                    const extraParams = new URLSearchParams();
                    extraParams.set('token', finalToken);
                    if (tabIdFromUrl) extraParams.set('tabId', tabIdFromUrl);
                    if (phoneFromUrl) extraParams.set('phone', phoneFromUrl);
                    if (refFromUrl) extraParams.set('ref', refFromUrl);
                    const trackUrl = `${trackingPath}?${extraParams.toString()}`;

                    console.log(`[Order Placed] Replacing history and redirecting to: ${trackUrl}`);
                    router.replace(trackUrl);

                } else {
                    throw new Error("Could not obtain a tracking token. Cannot redirect.");
                }

            } catch (error) {
                console.error("[Order Placed] CRITICAL ERROR:", error);
                router.replace('/');
            }
        };

        handleRedirect();
    }, [orderId, whatsappNumber, restaurantId, tokenFromUrl, deliveryTypeFromUrl, businessTypeFromUrl, tabIdFromUrl, phoneFromUrl, refFromUrl, router]);


    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center text-center p-4 green-theme">
            <GoldenCoinSpinner />
            <h1 className="text-4xl font-bold text-foreground mt-6">Placing Your Order...</h1>
            <p className="text-lg text-muted-foreground mt-2">Finalizing details and creating your tracking link. Please wait a moment.</p>
        </div>
    )
};


export default function OrderPlacedPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <OrderPlacedContent />
        </Suspense>
    );
}
