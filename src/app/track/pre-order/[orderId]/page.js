'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Check, ShoppingBag, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

const tierColors = {
    bronze: { base: '#CD7F32', dark: '#8B4513' },
    silver: { base: '#C0C0C0', dark: '#757575' },
    gold: { base: '#FFD700', dark: '#B8860B' },
};

const SimpleTimeline = ({ currentStatus }) => {
    const isConfirmed = ['pending', 'confirmed', 'Ready', 'delivered', 'picked_up'].includes(currentStatus);
    const isReady = ['Ready', 'delivered', 'picked_up'].includes(currentStatus);

    return (
        <div className="flex justify-between items-center w-full max-w-sm mx-auto px-4 pt-4">
            <div className="flex flex-col items-center text-center">
                <motion.div
                    className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center border-4",
                        isConfirmed ? 'bg-primary border-primary/50 text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                    )}
                    animate={{ scale: isConfirmed ? 1 : 0.9, opacity: isConfirmed ? 1 : 0.7 }}
                >
                    <Check size={32} />
                </motion.div>
                <p className={`mt-2 text-sm font-semibold ${isConfirmed ? 'text-foreground' : 'text-muted-foreground'}`}>Order Confirmed</p>
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
        if (!orderId) {
            setError("Order ID is missing.");
            setLoading(false);
            return;
        }

        const docRef = doc(db, 'orders', orderId);

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = { id: docSnap.id, ...docSnap.data() };
                setOrderData(data);
                setError(null);
            } else {
                setError("This order could not be found.");
            }
            setLoading(false);
        }, (err) => {
            console.error("Firestore onSnapshot error:", err);
            setError("Could not load the order session.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, [orderId]);
    
    const coinTier = useMemo(() => {
        const amount = orderData?.totalAmount || 0;
        if (amount > 500) return 'gold';
        if (amount > 200) return 'silver';
        return 'bronze';
    }, [orderData]);

    if (loading) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    
    if (error) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400 p-4 text-center">{error}</div>;
    }

    if (!orderData) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 p-4 text-center">Order data not available.</div>;
    }
    
    const token = orderData?.dineInToken || '#----';
    const tierStyle = `coin-${coinTier}`;
    const qrValue = `${window.location.origin}/collect/${orderId}`;
    
    const statusText = orderData.status === 'Ready' || orderData.status === 'delivered' || orderData.status === 'picked_up'
        ? "Your order is ready! Please flip the coin and show the QR code at the counter."
        : "Your order is being prepared...";
        
    const orderDate = orderData?.orderDate?.seconds 
        ? new Date(orderData.orderDate.seconds * 1000)
        : null;

    return (
        <div className="min-h-screen bg-slate-900 text-white font-sans p-4 flex flex-col">
            <header className="flex justify-between items-center mb-6">
                <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => router.back()}><ArrowLeft size={28} /></Button>
                <h1 className="text-xl font-bold font-headline">{orderData?.restaurantName || 'Your Order'}</h1>
                <div className="w-12"></div>
            </header>

            <main className="flex-grow flex flex-col items-center justify-center text-center">
                 <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 150, damping: 20 }}
                    className={cn("coin-container w-80 h-80", isFlipped && 'is-flipped')}
                    onClick={() => setIsFlipped(f => !f)}
                >
                    <div className="coin-flipper">
                        <div className={cn("coin-face coin-front", tierStyle)}>
                            <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="curve" d="M 50, 150 a 100,100 0 1,1 200,0" fill="transparent"/>
                                <text width="100" className="coin-text-fill"><textPath xlinkHref="#curve" startOffset="50%" textAnchor="middle">★ {orderData.restaurantName} ★</textPath></text>
                            </svg>
                            <div className="token-number">{orderData.dineInToken || '#----'}</div>
                            <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="bottom-curve" d="M 250, 150 a 100,100 0 1,1 -200,0" fill="transparent"/>
                                <text width="100" className="coin-text-fill">
                                    <textPath xlinkHref="#bottom-curve" startOffset="50%" textAnchor="middle">
                                        {orderDate ? `${orderDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} • ${orderDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                    </textPath>
                                </text>
                            </svg>
                        </div>
                        <div className={cn("coin-face coin-back", tierStyle)}>
                             <svg className="circular-text" viewBox="0 0 300 300">
                                <path id="brand-curve" d="M 50, 150 a 100,100 0 1,1 200,0" fill="transparent"/>
                                <text width="100" className="coin-text-fill"><textPath xlinkHref="#brand-curve" startOffset="50%" textAnchor="middle">● POWERED BY SERVİZEPHYR ●</textPath></text>
                            </svg>
                            <div className="p-4 bg-white rounded-lg">
                                 <QRCode value={qrValue} size={160} fgColor={tierColors[coinTier].dark} bgColor="transparent" />
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
                     <SimpleTimeline currentStatus={orderData.status} />
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
