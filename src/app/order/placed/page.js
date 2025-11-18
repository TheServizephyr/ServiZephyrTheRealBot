
'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowLeft, Navigation, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const orderId = searchParams.get('orderId');
    const whatsappNumber = searchParams.get('whatsappNumber');
    
    const [trackingToken, setTrackingToken] = useState(searchParams.get('token'));
    const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId'));

    useEffect(() => {
        const currentRestaurantId = searchParams.get('restaurantId');
        if (currentRestaurantId) {
            localStorage.setItem('lastOrderedFrom', currentRestaurantId);
            if (!restaurantId) {
                setRestaurantId(currentRestaurantId);
            }
        } else {
            const storedId = localStorage.getItem('lastOrderedFrom');
            if (storedId && !restaurantId) {
                setRestaurantId(storedId);
            }
        }
        
        const fetchTokenAndRedirect = async () => {
            const tokenInUrl = searchParams.get('token');
            let finalToken = tokenInUrl;

            // If token is missing, fetch it.
            if (!tokenInUrl && orderId) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for backend processing
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            finalToken = data.order.trackingToken;
                            setTrackingToken(finalToken);
                        }
                    }
                } catch (error) {
                    console.error("Error fetching tracking token:", error);
                }
            }

            if(orderId && finalToken) {
                localStorage.setItem('liveOrder', JSON.stringify({ 
                    orderId, 
                    restaurantId: currentRestaurantId || localStorage.getItem('lastOrderedFrom'), 
                    trackingToken: finalToken,
                }));
                
                const isDineIn = !!whatsappNumber;
                const isPreOrder = !isDineIn && (currentRestaurantId || localStorage.getItem('lastOrderedFrom'));

                let trackingPath;
                if (isDineIn) {
                    trackingPath = `/track/dine-in/${orderId}`;
                } else if (isPreOrder) {
                    trackingPath = `/track/pre-order/${orderId}`;
                } else {
                    trackingPath = `/track/${orderId}`;
                }
                const trackUrl = `${trackingPath}?token=${finalToken}`;

                // Replace the current entry in the history stack
                router.replace(trackUrl);
            }
        };

        if(orderId) {
            fetchTokenAndRedirect();
        }

    }, [orderId, searchParams, restaurantId, router, whatsappNumber]); 


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
