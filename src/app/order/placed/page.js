
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
    const phone = searchParams.get('phone');
    
    const [trackingToken, setTrackingToken] = useState(searchParams.get('token'));
    const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId'));

    useEffect(() => {
        console.log("[Placed Page] useEffect triggered. Current orderId from URL:", orderId);

        // 1. Immediately try to get and save the restaurantId.
        const currentRestaurantId = searchParams.get('restaurantId');
        if (currentRestaurantId) {
            console.log("[Placed Page] Found restaurantId in URL, saving to localStorage:", currentRestaurantId);
            localStorage.setItem('lastOrderedFrom', currentRestaurantId);
            if (!restaurantId) {
                console.log("[Placed Page] Setting restaurantId state from URL param.");
                setRestaurantId(currentRestaurantId);
            }
        } else {
            const storedId = localStorage.getItem('lastOrderedFrom');
            console.log("[Placed Page] No restaurantId in URL. Found in localStorage:", storedId);
            if (storedId && !restaurantId) {
                 console.log("[Placed Page] Setting restaurantId state from localStorage.");
                setRestaurantId(storedId);
            }
        }
        
        // 2. Smartly fetch the tracking token if needed.
        const fetchTokenIfNeeded = async () => {
            const tokenInUrl = searchParams.get('token');
            console.log("[Placed Page] fetchTokenIfNeeded called. Token in URL:", tokenInUrl);

            if (!tokenInUrl && orderId) {
                console.log("[Placed Page] Token not in URL, will fetch from backend for order:", orderId);
                try {
                    // This delay is crucial for Razorpay webhook to process.
                    console.log("[Placed Page] Waiting 1.5s for webhook to process...");
                    await new Promise(resolve => setTimeout(resolve, 1500)); 
                    
                    console.log(`[Placed Page] Fetching token from /api/order/status/${orderId}`);
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            console.log("[Placed Page] Successfully fetched token:", data.order.trackingToken);
                            setTrackingToken(data.order.trackingToken); // This is the critical line that was missing
                        } else {
                            console.warn("[Placed Page] Order found, but no tracking token yet. The webhook might be slow.");
                        }
                    } else {
                        console.error("[Placed Page] Failed to fetch order status to get token. Status:", res.status);
                    }
                } catch (error) {
                    console.error("[Placed Page] Error fetching tracking token:", error);
                }
            } else if (tokenInUrl) {
                if (tokenInUrl !== trackingToken) {
                    console.log("[Placed Page] Setting trackingToken state from URL param.");
                    setTrackingToken(tokenInUrl);
                }
            } else {
                console.log("[Placed Page] No orderId or token in URL. Cannot fetch token.");
            }
        };

        if(orderId) {
            fetchTokenIfNeeded();
        } else {
             console.log("[Placed Page] No orderId found in URL. Skipping token fetch.");
        }

    }, [orderId, searchParams, restaurantId, trackingToken]); // Dependency array is key


    const handleBackToMenu = () => {
        console.log("[Placed Page] handleBackToMenu clicked. Current restaurantId state:", restaurantId);
        if (restaurantId) {
            const params = new URLSearchParams();
            if (phone) params.set('phone', phone);
            const sessionToken = searchParams.get('token') || trackingToken;
            if (sessionToken) params.set('token', sessionToken);
            
            const backUrl = `/order/${restaurantId}?${params.toString()}`;
            console.log("[Placed Page] Navigating back to menu:", backUrl);
            router.push(backUrl);
        } else {
            console.error("[Placed Page] Could not determine which restaurant to go back to. Falling back to home.");
            router.push('/'); 
        }
    };

    const handleConfirmOnWhatsApp = () => {
        if (orderId && whatsappNumber) {
            const message = `Hi! I've placed a dine-in order. Please confirm my order ID: ${orderId}`;
            const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
            window.location.href = whatsappUrl;
        } else {
            alert("Could not create WhatsApp confirmation link. Order ID or bot number is missing.");
        }
    };
    
    const handleTrackOrder = () => {
        const isDineIn = !!whatsappNumber;
        const trackingPath = isDineIn ? 'dine-in/' : '';
        console.log(`[Placed Page] handleTrackOrder clicked. Order ID: ${orderId}, Token: ${trackingToken}`);
        if (orderId && trackingToken) {
            const trackUrl = `/track/${trackingPath}${orderId}?token=${trackingToken}`;
            console.log(`[Placed Page] Navigating to track page: ${trackUrl}`);
            router.push(trackUrl);
        } else {
            alert("Tracking information is not yet available. This can happen with online payments. Please wait a moment and try again.");
        }
    }
    
    const isDineIn = !!whatsappNumber;

    if (isDineIn) {
        return (
            <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center text-center p-4 green-theme">
                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}
                >
                    <CheckCircle className="w-24 h-24 text-primary mx-auto" />
                </motion.div>
                <motion.h1 
                    className="text-4xl font-bold text-foreground mt-6"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    One Last Step!
                </motion.h1>
                <motion.p 
                    className="mt-4 text-lg text-muted-foreground max-w-md"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                >
                    To confirm your order and get your unique token number, please send the pre-filled message on WhatsApp.
                </motion.p>
                <motion.div
                    className="flex flex-col sm:flex-row gap-4 mt-8"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.6 }}
                >
                    <Button 
                        onClick={handleConfirmOnWhatsApp}
                        className="flex items-center gap-2 px-6 py-3 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-medium"
                    >
                        <MessageSquare className="w-5 h-5" /> Confirm on WhatsApp
                    </Button>
                    <Button 
                        onClick={handleTrackOrder}
                        variant="outline"
                        className="flex items-center gap-2 px-6 py-3 rounded-md text-lg font-medium"
                        disabled={!trackingToken}
                    >
                        { !trackingToken ? <Loader2 className="w-5 h-5 animate-spin"/> : <Navigation className="w-5 h-5" /> }
                         <span className="ml-2">Track Your Order</span>
                    </Button>
                </motion.div>
            </div>
        );
    }

    return (
         <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center text-center p-4">
            <CheckCircle className="w-24 h-24 text-primary mx-auto" />
            <h1 className="text-4xl font-bold text-foreground mt-6">Order Placed!</h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-md">Your order has been sent to the restaurant.</p>
            <div className="flex flex-col sm:flex-row gap-4 mt-8">
                 <Button 
                    onClick={handleTrackOrder}
                    className="flex items-center gap-2 px-6 py-3 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-medium"
                    disabled={!trackingToken}
                >
                   { !trackingToken ? <Loader2 className="w-5 h-5 animate-spin"/> : <Navigation className="w-5 h-5" /> }
                   <span className="ml-2">Track Your Order</span>
                </Button>
                <Button 
                    onClick={handleBackToMenu}
                    variant="outline"
                    className="flex items-center gap-2 px-6 py-3 rounded-md text-lg font-medium"
                    disabled={!restaurantId}
                >
                    <ArrowLeft className="w-5 h-5" /> Back to Menu
                </Button>
            </div>
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
