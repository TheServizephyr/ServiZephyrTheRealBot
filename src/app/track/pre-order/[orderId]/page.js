
'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, ShoppingBag, Loader2, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';

const coinTiers = {
    bronze: 'coin-bronze',
    silver: 'coin-silver',
    gold: 'coin-gold',
};

const tierColors = {
    bronze: { base: '#CD7F32', dark: '#8B4513' },
    silver: { base: '#C0C0C0', dark: '#757575' },
    gold: { base: '#FFD700', dark: '#B8860B' },
};

const SimpleTimeline = ({ currentStatus }) => {
    const isConfirmed = currentStatus === 'pending' || currentStatus === 'confirmed' || currentStatus === 'Ready' || currentStatus === 'delivered' || currentStatus === 'picked_up';
    const isReady = currentStatus === 'Ready' || currentStatus === 'delivered' || currentStatus === 'picked_up';

    return (
        <div className="flex justify-between items-center w-full max-w-sm mx-auto px-4 pt-4">
            <div className="flex flex-col items-center text-center">
                <motion.div
                    className="w-16 h-16 rounded-full flex items-center justify-center border-4 bg-primary border-primary/50 text-primary-foreground"
                    animate={{ scale: isConfirmed ? 1 : 0.9, opacity: isConfirmed ? 1 : 0.7 }}
                >
                    <Check size={32} />
                </motion.div>
                <p className="mt-2 text-sm font-semibold text-foreground">Order Confirmed</p>
            </div>
            
            <div className="flex-1 h-1.5 rounded-full bg-border mx-4">
                <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: '0%' }}
                    animate={{ width: isReady ? '100%' : '0%' }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                />
            </div>
            
            <div className="flex flex-col items-center text-center">
                <motion.div
                    className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center border-4 transition-colors duration-500",
                        isReady ? 'bg-primary border-primary/50 text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                    )}
                    animate={{ scale: isReady ? 1 : 0.9, opacity: isReady ? 1 : 0.7 }}
                >
                    <ShoppingBag size={32} />
                </motion.div>
                <p className={`mt-2 text-sm font-semibold ${isReady ? 'text-foreground' : 'text-muted-foreground'}`}>
                    Ready for Pickup
                </p>
            </div>
        </div>
    );
};


function PreOrderTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isFlipped, setIsFlipped] = useState(false);

    useEffect(() => {
        const fetchData = async (isBackground = false) => {
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
        };

        fetchData();
        const interval = setInterval(() => fetchData(true), 20000);
        return () => clearInterval(interval);
    }, [orderId]);

    const coinTier = useMemo(() => {
        const amount = orderData?.order?.totalAmount || 0;
        if (amount > 500) return 'gold';
        if (amount > 150) return 'silver';
        return 'bronze';
    }, [orderData]);

    const { order, restaurant } = orderData || {};
    const currentStatus = order?.status;
    const token = order?.dineInToken || '#----';
    const tierStyle = coinTiers[coinTier];
    const tierColor = tierColors[coinTier];
    
    const qrValue = order ? `${window.location.origin}/collect/${order.id}` : '';

    const statusText = currentStatus === 'Ready' || currentStatus === 'delivered' || currentStatus === 'picked_up'
        ? "Your order is ready! Please slide the coin and show the QR code at the counter."
        : "Your order is being prepared...";

    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    
    if (error) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>;
    }

    if (!order) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Order data not available.</div>;
    }

    return (
        <div className="min-h-screen bg-slate-900 text-white font-sans p-4 flex flex-col">
            <header className="flex justify-between items-center mb-6">
                <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => router.back()}><ArrowLeft size={28} /></Button>
                <h1 className="text-xl font-bold font-headline">{restaurant?.name}</h1>
                <div className="w-12"></div>
            </header>

            <main className="flex-grow flex flex-col items-center justify-center text-center">
                 <motion.div
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 150, damping: 20 }}
                    className={cn("coin-container w-80 h-80", isFlipped && 'is-flipped')}
                    onClick={() => setIsFlipped(f => !f)}
                >
                    <div className="coin-flipper">
                        <div className={cn("coin-face coin-front", tierStyle)}>
                            <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="curve" d="M 50, 150 a 100,100 0 1,1 200,0" fill="transparent"/>
                                <text width="100"><textPath xlinkHref="#curve" startOffset="50%" textAnchor="middle">{restaurant?.name || 'Your Restaurant'}</textPath></text>
                            </svg>
                            <span className="token-number font-mono text-7xl font-bold">{token}</span>
                            <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="bottom-curve" d="M 250, 150 a 100,100 0 1,1 -200,0" fill="transparent"/>
                                <text width="100"><textPath xlinkHref="#bottom-curve" startOffset="50%" textAnchor="middle">{new Date(order.orderDate.seconds * 1000).toLocaleDateString()}</textPath></text>
                            </svg>
                        </div>
                        <div className={cn("coin-face coin-back", tierStyle)}>
                            <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="brand-curve" d="M 50, 150 a 100,100 0 1,1 200,0" fill="transparent"/>
                                <text width="100"><textPath xlinkHref="#brand-curve" startOffset="50%" textAnchor="middle">Powered by ServiZephyr</textPath></text>
                            </svg>
                            <div className="p-4 bg-white rounded-lg">
                                <QRCode value={qrValue} size={160} fgColor={tierColor.dark} bgColor="transparent" />
                            </div>
                        </div>
                    </div>
                </motion.div>
                
                <motion.p 
                    className="mt-8 text-slate-300 text-lg font-semibold max-w-md"
                    key={statusText}
                    initial={{opacity: 0}} animate={{opacity: 1}}
                >
                    {statusText}
                </motion.p>
                
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
