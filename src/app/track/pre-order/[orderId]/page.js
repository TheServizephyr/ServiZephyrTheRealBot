
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, ShoppingBag, Loader2, ArrowLeft, XCircle, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const SimpleTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid' || currentStatus === 'pending' || currentStatus === 'confirmed') ? 'confirmed' : currentStatus;
    
    const steps = [
        { key: 'confirmed', title: 'Order Confirmed', icon: <Check size={24} /> },
        { key: 'Ready', title: 'Ready for Pickup', icon: <ShoppingBag size={24} /> },
    ];
    
    let currentStepIndex = -1;
    if (activeStatus === 'confirmed' || activeStatus === 'preparing') {
        currentStepIndex = 0;
    } else if (activeStatus === 'Ready' || activeStatus === 'delivered') {
        currentStepIndex = 1;
    }

    return (
        <div className="flex justify-between items-start w-full max-w-sm mx-auto px-2 sm:px-4 pt-4">
            {steps.map(({ key, title, icon }, index) => {
                const isCompleted = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;
                
                return (
                    <React.Fragment key={key}>
                        <div className="flex flex-col items-center text-center w-28">
                            <motion.div
                                className={cn(
                                    "w-16 h-16 rounded-full flex items-center justify-center border-4 transition-all duration-500",
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
                             <div className="flex-1 h-1 mt-8 mx-1 rounded-full bg-border">
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

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
                <h1 className="text-2xl font-bold mt-4">Loading Your Order Status...</h1>
            </div>
        );
    }
    
    if (error) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{error}</p>
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }

    if (!orderData || !orderData.order) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }
    
    const currentStatusKey = (orderData.order.status === 'paid' || orderData.order.status === 'pending') ? 'confirmed' : orderData.order.status;
    const currentStatusInfo = statusConfig[currentStatusKey] || statusConfig.confirmed;

    const coinClass = "bg-gradient-to-br from-gray-400 via-gray-100 to-gray-400 text-gray-800"; // Silver


    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
            <style jsx global>{`
                .coin-shadow {
                    box-shadow: 
                        inset 0 0 10px rgba(255,255,255,0.8), 
                        0 5px 15px rgba(0,0,0,0.3),
                        inset 0px -5px 5px rgba(0,0,0,0.2);
                }
            `}</style>

            <header className="p-4 border-b border-border flex justify-between items-center">
                <div>
                    <p className="text-xs text-muted-foreground">Tracking Pre-Order</p>
                    <h1 className="font-bold text-lg">{orderData.restaurant?.name}</h1>
                </div>
                <Button onClick={() => fetchData()} variant="outline" size="icon" disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>
            
            <main className="flex-grow flex flex-col items-center justify-center p-4 md:p-8">
                <div className="w-full max-w-2xl mx-auto">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 260, damping: 20 }}
                        className={`relative w-64 h-64 mx-auto rounded-full ${coinClass} flex flex-col items-center justify-center coin-shadow`}
                    >
                        <p className="font-bold text-xl opacity-70">TOKEN</p>
                        <p className="text-7xl font-bold tracking-wider">{orderData.order.dineInToken || "#----"}</p>
                    </motion.div>
                    
                     <motion.div
                        key={orderData.order.status}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-8 text-center bg-card p-6 rounded-lg border border-border"
                    >
                         <h3 className="text-2xl font-bold">{currentStatusInfo.title}</h3>
                         <p className="mt-2 text-muted-foreground">{currentStatusInfo.description}</p>
                    </motion.div>
                    
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{delay: 0.4}}>
                        <div className="bg-card rounded-lg border mt-8">
                            <SimpleTimeline currentStatus={orderData.order.status} />
                        </div>
                    </motion.div>
                    
                     <div className="mt-8 text-center bg-blue-500/10 text-blue-400 p-4 rounded-lg flex items-start gap-3">
                        <Info size={16} className="flex-shrink-0 mt-1"/>
                        <p className="text-sm">
                            Show this token at the counter to collect your order when it's ready. You will get a notification, or you can keep this page open.
                        </p>
                    </div>

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
