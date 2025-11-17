'use client';

import React, { useState, useEffect, Suspense, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, ShoppingBag, Loader2, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const coinTiers = {
    bronze: {
        gradient: 'from-[#CD7F32] via-[#E6AC75] to-[#8B4513]',
        shadow: 'shadow-orange-900/50',
        text: 'text-orange-900',
        tokenText: 'text-[#8B4513]',
    },
    silver: {
        gradient: 'from-[#C0C0C0] via-[#FFFFFF] to-[#A9A9A9]',
        shadow: 'shadow-gray-700/50',
        text: 'text-gray-800',
        tokenText: 'text-gray-700',
    },
    gold: {
        gradient: 'from-[#FFD700] via-[#FFF8C6] to-[#DAA520]',
        shadow: 'shadow-yellow-700/50',
        text: 'text-yellow-900',
        tokenText: 'text-yellow-800',
    },
};

const SimpleTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid' || currentStatus === 'pending' || currentStatus === 'confirmed' || currentStatus === 'preparing') ? 'confirmed' : currentStatus;
    
    const steps = [
        { key: 'confirmed', title: 'Order Confirmed', icon: <Check size={32} /> },
        { key: 'Ready', title: 'Ready for Pickup', icon: <ShoppingBag size={32} /> },
    ];
    
    let currentStepIndex = -1;
    if (activeStatus === 'confirmed') {
        currentStepIndex = 0;
    } else if (activeStatus === 'Ready' || activeStatus === 'delivered' || activeStatus === 'picked_up') {
        currentStepIndex = 1;
    }

    return (
        <div className="flex justify-between items-center w-full max-w-sm mx-auto px-2 sm:px-4 pt-4">
            {steps.map(({ key, title, icon }, index) => {
                const isCompleted = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;
                
                return (
                    <React.Fragment key={key}>
                        <div className="flex flex-col items-center text-center w-28">
                            <motion.div
                                className={cn(
                                    "w-20 h-20 rounded-full flex items-center justify-center border-4 transition-all duration-500",
                                    isCompleted ? 'bg-primary border-primary/50 text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                                )}
                                animate={{ scale: isCurrent ? 1.1 : 1 }}
                                transition={{ type: 'spring' }}
                            >
                                {icon}
                            </motion.div>
                            <p className={`mt-2 text-sm font-semibold ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {title}
                            </p>
                        </div>
                        {index < steps.length - 1 && (
                             <div className="flex-1 h-1 rounded-full bg-border">
                                <motion.div
                                    className="h-full rounded-full bg-primary"
                                    initial={{ width: '0%' }}
                                    animate={{ width: isCompleted ? '100%' : '0%' }}
                                    transition={{ duration: 0.5, delay: 0.2 }}
                                />
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

function PreOrderTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!orderId) {
            setError("Order ID is missing.");
            setLoading(false);
            return;
        }

        try {
            const res = await fetch(`/api/order/status/${orderId}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to fetch order status.');
            }
            const data = await res.json();
            setOrderData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(true), 20000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const coinTier = useMemo(() => {
        const amount = orderData?.order?.totalAmount || 0;
        if (amount > 500) return 'gold';
        if (amount > 150) return 'silver';
        return 'bronze';
    }, [orderData]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>
        );
    }
    
    if (error) {
        return (
             <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>
        );
    }

    if (!orderData || !orderData.order) {
        return (
             <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Order data not available.</div>
        );
    }

    const { order, restaurant } = orderData;
    const currentStatus = order.status;
    const token = order.dineInToken || '#----XX';
    const tokenNumber = token.split('-')[0];
    const tokenChars = token.split('-')[1] || 'XX';
    const tierStyles = coinTiers[coinTier];

    return (
        <div className="min-h-screen bg-slate-900 text-white font-sans p-4 flex flex-col">
            <header className="flex justify-between items-center mb-6">
                <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => router.back()}><ArrowLeft size={28} /></Button>
                <h1 className="text-2xl font-bold font-headline">{restaurant.name}</h1>
                <Button onClick={() => fetchData()} variant="ghost" size="icon" disabled={loading} className="text-slate-400 hover:text-white">
                    <RefreshCw className={`h-6 w-6 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>

            <main className="flex-grow flex flex-col items-center justify-center text-center">
                <motion.div
                    initial={{ scale: 0.5, y: 100, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 150, damping: 15, delay: 0.2 }}
                    className={cn(
                        "relative w-72 h-72 rounded-full flex flex-col items-center justify-center shadow-2xl bg-gradient-to-br",
                        tierStyles.gradient, tierStyles.shadow
                    )}
                >
                    <div className="absolute inset-2 rounded-full border-4 border-white/20"></div>
                    <div className="absolute inset-4 rounded-full border-2 border-white/20"></div>
                     <motion.div
                        className="absolute inset-0 rounded-full opacity-30"
                        style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 60%)'
                        }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
                    />
                    
                    <div className="relative z-10 flex flex-col items-center justify-center text-center">
                         <p className={cn("font-bold text-xl opacity-80", tierStyles.text)}>TOKEN</p>
                        <p className={cn("text-7xl font-bold tracking-wider", tierStyles.text)} style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.2)' }}>
                            {tokenNumber}
                        </p>
                         <p className={cn("text-2xl font-bold opacity-80", tierStyles.text)}>
                            {tokenChars}
                        </p>
                    </div>
                </motion.div>
                
                <p className="mt-8 text-slate-400 max-w-md">
                    Please show this token at the counter to collect your order when it's ready.
                </p>
                
                <div className="w-full max-w-xl mt-8">
                     <SimpleTimeline currentStatus={currentStatus} />
                </div>
            </main>
        </div>
    );
}

export default function PreOrderTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-16 h-16 animate-spin text-primary"/></div>}>
            <PreOrderTrackingContent />
        </Suspense>
    )
}
