
'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowLeft, Navigation, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    // Get all params from the URL
    const orderId = searchParams.get('orderId');
    const whatsappNumber = searchParams.get('whatsappNumber');
    const phone = searchParams.get('phone');
    
    // State to hold the token and restaurantId
    const [trackingToken, setTrackingToken] = useState(searchParams.get('token'));
    const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId'));

    useEffect(() => {
        // This effect runs once on mount and then whenever the searchParams change.
        
        // 1. Immediately save the restaurantId from URL to localStorage if it exists.
        // This makes the "Back to Menu" button robust.
        const currentRestaurantId = searchParams.get('restaurantId');
        if (currentRestaurantId) {
            localStorage.setItem('lastOrderedFrom', currentRestaurantId);
            setRestaurantId(currentRestaurantId);
        } else {
            // If not in URL, try to get it from storage.
            const storedId = localStorage.getItem('lastOrderedFrom');
            if (storedId) {
                setRestaurantId(storedId);
            }
        }

        // 2. Smartly fetch the tracking token if it's not present in the URL.
        const fetchTokenIfNeeded = async () => {
            const currentOrderId = searchParams.get('orderId');
            const tokenInUrl = searchParams.get('token');

            if (!tokenInUrl && currentOrderId) {
                console.log("Token not in URL, attempting to fetch from backend for order:", currentOrderId);
                try {
                    // This delay gives the webhook a moment to process the payment and generate the token.
                    await new Promise(resolve => setTimeout(resolve, 1500)); 
                    
                    const res = await fetch(`/api/order/status/${currentOrderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            console.log("Successfully fetched token:", data.order.trackingToken);
                            setTrackingToken(data.order.trackingToken);
                        } else {
                            console.warn("Order found, but no tracking token yet. Retrying might be needed.");
                        }
                    } else {
                        console.error("Failed to fetch order status to get token. Status:", res.status);
                    }
                } catch (error) {
                    console.error("Error fetching tracking token:", error);
                }
            } else if (tokenInUrl) {
                setTrackingToken(tokenInUrl);
            }
        };

        fetchTokenIfNeeded();

    }, [searchParams]);


    const handleBackToMenu = () => {
        // Uses the state variable `restaurantId` which is now reliably set.
        if (restaurantId) {
            const params = new URLSearchParams();
            if (phone) params.set('phone', phone);
            // Re-use the session token if available for seamless navigation back to the menu
            const sessionToken = searchParams.get('token');
            if (sessionToken) params.set('token', sessionToken);
            
            router.push(`/order/${restaurantId}?${params.toString()}`);
        } else {
            console.error("Could not determine which restaurant to go back to. Falling back to home.");
            router.push('/'); // Fallback to home if restaurantId is somehow lost
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
        if (orderId && trackingToken) {
            router.push(`/track/${trackingPath}${orderId}?token=${trackingToken}`);
        } else {
            alert("Tracking information is not yet available for this order. Please refresh and try again in a moment.");
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
                        <Navigation className="w-5 h-5" /> Track Your Order
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
                    <Navigation className="w-5 h-5" /> Track Your Order
                </Button>
                <Button 
                    onClick={handleBackToMenu}
                    variant="outline"
                    className="flex items-center gap-2 px-6 py-3 rounded-md text-lg font-medium"
                >
                    <ArrowLeft className="w-5 h-5" /> Back to Menu
                </Button>
            </div>
        </div>
    )
};


export default function OrderPlacedPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><p>Loading...</p></div>}>
            <OrderPlacedContent />
        </Suspense>
    );
}
