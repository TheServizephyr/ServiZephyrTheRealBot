
'use client';

import React, { Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    // --- START FIX: Read all possible params from URL ---
    const orderId = searchParams.get('orderId') || searchParams.get('firestore_order_id');
    const tokenFromUrl = searchParams.get('token');
    const restaurantId = searchParams.get('restaurantId');
    const whatsappNumber = searchParams.get('whatsappNumber');
    // --- END FIX ---
    
    useEffect(() => {
        const handleRedirect = async () => {
            if (!orderId) {
                console.warn("[Order Placed] No Order ID found in URL. Cannot proceed.");
                // Fallback to home if no order id is present
                router.replace('/');
                return;
            };

            // Clear any old cart or live order data to ensure a fresh start for the next session
            if (restaurantId) {
                localStorage.removeItem(`cart_${restaurantId}`);
                localStorage.removeItem('liveOrder');
                 console.log(`[Order Placed] Cleared localStorage for restaurant ${restaurantId}.`);
            } else {
                 localStorage.removeItem('liveOrder');
                 console.log(`[Order Placed] Cleared liveOrder from localStorage (no restaurantId).`);
            }

            let finalToken = tokenFromUrl;

            // If token is missing, it might be a COD/Pay at Counter order. 
            // We fetch the token from the backend as it's generated there.
            if (!finalToken) {
                console.log(`[Order Placed] Token not in URL for ${orderId}, fetching from API...`);
                try {
                    // Give a slight delay for backend processing if needed
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            finalToken = data.order.trackingToken;
                             console.log(`[Order Placed] Successfully fetched token from API.`);
                        } else {
                            throw new Error("Tracking token was not found in the API response.");
                        }
                    } else {
                        throw new Error(`API responded with status ${res.status}`);
                    }
                } catch (error) {
                    console.error("[Order Placed] CRITICAL: Failed to fetch tracking token:", error);
                    // Fallback to home to prevent getting stuck
                    router.replace('/');
                    return;
                }
            }

            // At this point, we must have a token to proceed.
            if (finalToken) {
                 console.log(`[Order Placed] Proceeding with Order ID: ${orderId} and Token: ${finalToken.substring(0,5)}...`);
                
                // Save the new live order details to localStorage BEFORE redirecting.
                // This allows the order page to recognize the active session when the user navigates back.
                localStorage.setItem('liveOrder', JSON.stringify({ 
                    orderId, 
                    restaurantId, // May be null, that's okay
                    trackingToken: finalToken,
                    status: 'pending', // Initial status
                }));
                 console.log(`[Order Placed] Saved new live order to localStorage.`);

                // Determine the correct tracking URL based on context
                const isDineIn = !!whatsappNumber;
                const isPreOrder = !!restaurantId && !isDineIn;

                let trackingPath;
                if (isDineIn) {
                    trackingPath = `/track/dine-in/${orderId}`;
                } else if (isPreOrder) {
                    trackingPath = `/track/pre-order/${orderId}`;
                } else {
                    trackingPath = `/track/${orderId}`;
                }
                const trackUrl = `${trackingPath}?token=${finalToken}`;

                console.log(`[Order Placed] Replacing history and redirecting to: ${trackUrl}`);
                // Replace the current history entry, so the back button doesn't lead here
                router.replace(trackUrl);
            } else {
                 console.error("[Order Placed] CRITICAL: Could not obtain a tracking token. Cannot redirect.");
                 // Fallback redirect to home to avoid getting stuck
                 router.replace('/');
            }
        };

        handleRedirect();
    }, [orderId, whatsappNumber, restaurantId, tokenFromUrl, router]); 


    // This content will be shown briefly before the redirect happens.
    return (
         <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center text-center p-4 green-theme">
            <Loader2 className="w-24 h-24 text-primary animate-spin" />
            <h1 className="text-4xl font-bold text-foreground mt-6">Placing Your Order...</h1>
            <p className="text-lg text-muted-foreground mt-2">Finalizing details and creating your tracking link. Please wait a moment.</p>
        </div>
    )
};


export default function OrderPlacedPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-16 h-16 text-primary animate-spin"/></div>}>
            <OrderPlacedContent />
        </Suspense>
    );
}
