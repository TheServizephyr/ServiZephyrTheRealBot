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

    // This logic fetches the tracking token if it's not in the URL,
    // which is common after an online payment redirect where the token might be lost.
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
        
        const fetchTokenIfNeeded = async () => {
            const tokenInUrl = searchParams.get('token');

            if (!tokenInUrl && orderId) {
                try {
                    // Give the backend a moment to process the webhook and generate the token
                    await new Promise(resolve => setTimeout(resolve, 1500)); 
                    
                    const res = await fetch(`/api/order/status/${orderId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.order?.trackingToken) {
                            setTrackingToken(data.order.trackingToken);
                            // --- START FIX: Save live order data here after fetching ---
                            localStorage.setItem('liveOrder', JSON.stringify({ 
                                orderId, 
                                restaurantId: data.restaurant.id, 
                                trackingToken: data.order.trackingToken, 
                                status: 'pending' 
                            }));
                             // --- END FIX ---
                        }
                    }
                } catch (error) {
                    console.error("Error fetching tracking token:", error);
                }
            } else if (tokenInUrl) {
                if (tokenInUrl !== trackingToken) {
                    setTrackingToken(tokenInUrl);
                }
                // --- START FIX: Save live order data when token is in URL ---
                localStorage.setItem('liveOrder', JSON.stringify({ 
                    orderId, 
                    restaurantId: currentRestaurantId || localStorage.getItem('lastOrderedFrom'), 
                    trackingToken: tokenInUrl, 
                    status: 'pending' 
                }));
                // --- END FIX ---
            }
        };

        if(orderId) {
            fetchTokenIfNeeded();
        }

    }, [orderId, searchParams, restaurantId, trackingToken]); 


    const handleBackToMenu = () => {
        const vendorId = searchParams.get('restaurantId') || localStorage.getItem('lastOrderedFrom');
        if (vendorId) {
            const backUrl = `/order/${vendorId}`;
            router.push(backUrl);
        } else {
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
        const isPreOrder = !isDineIn && restaurantId;

        let trackingPath;
        if (isDineIn) {
            trackingPath = 'track/dine-in/';
        } else if (isPreOrder) {
            trackingPath = 'track/pre-order/';
        } else {
            trackingPath = 'track/';
        }
        
        if (orderId && trackingToken) {
            const trackUrl = `/${trackingPath}${orderId}?token=${trackingToken}`;
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
         <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center text-center p-4 green-theme">
            <CheckCircle className="w-24 h-24 text-primary mx-auto" />
            <h1 className="text-4xl font-bold text-foreground mt-6">Order Placed!</h1>
            <p className="text-lg text-muted-foreground mt-2">Your order has been sent to the vendor.</p>
            <p className="text-sm text-muted-foreground max-w-md">Your order ID is <span className="font-bold text-foreground">#{orderId}</span></p>
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
