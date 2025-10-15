
'use client';

import React, { Suspense } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowLeft, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';

const OrderPlacedContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const orderId = searchParams.get('orderId'); // Assuming orderId is passed

    const handleBackToMenu = () => {
        // Fallback if restaurantId is not available
        router.push('/');
    };

    const handleTrackOrder = () => {
        if (orderId) {
            router.push(`/track/${orderId}`);
        } else {
            // Fallback or show an error
            alert("Could not find order ID to track.");
        }
    };

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
                Order Placed Successfully!
            </motion.h1>
            <motion.p 
                className="mt-4 text-lg text-muted-foreground max-w-md"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
            >
                Thank you for your order. We have received it and will start preparing it right away. You can track its live status now.
            </motion.p>
            <motion.div
                className="flex flex-col sm:flex-row gap-4 mt-8"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
            >
                <Button 
                    onClick={handleTrackOrder}
                    className="flex items-center gap-2 px-6 py-3 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-medium"
                >
                    <Navigation className="w-5 h-5" /> Track Your Order
                </Button>
                <Button 
                    onClick={handleBackToMenu}
                    variant="outline"
                    className="flex items-center gap-2 px-6 py-3 rounded-md text-lg font-medium"
                >
                    <ArrowLeft className="w-5 h-5" /> Back to Home
                </Button>
            </motion.div>
        </div>
    );
};


export default function OrderPlacedPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><p>Loading...</p></div>}>
            <OrderPlacedContent />
        </Suspense>
    );
}
