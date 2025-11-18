
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const orderId = searchParams.get('orderId');
    const whatsappNumber = searchParams.get('whatsappNumber');
    const restaurantId = searchParams.get('restaurantId');
    
    useEffect(() => {
        const handleRedirect = async () => {
            if (!orderId) return;

            // Immediately clear the cart and live order from localStorage
            if (restaurantId) {
                localStorage.removeItem(`cart_${restaurantId}`);
                localStorage.removeItem('liveOrder');
            }

            const tokenInUrl = searchParams.get('token');
            let finalToken = tokenInUrl;

            // If token is missing, fetch it from the status endpoint.
            if (!tokenInUrl) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for backend processing
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            finalToken = data.order.trackingToken;
                        }
                    }
                } catch (error) {
                    console.error("Error fetching tracking token:", error);
                }
            }

            // Only proceed if we have a token
            if (finalToken) {
                // Save the new live order details
                localStorage.setItem('liveOrder', JSON.stringify({ 
                    orderId, 
                    restaurantId,
                    trackingToken: finalToken,
                    status: 'pending',
                }));
                
                // Determine the correct tracking path
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

                // Replace the current history entry, so the back button doesn't lead here
                router.replace(trackUrl);
            }
        };

        handleRedirect();
    }, [orderId, whatsappNumber, restaurantId, searchParams, router]); 


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
