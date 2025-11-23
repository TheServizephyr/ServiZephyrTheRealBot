'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowLeft, CheckCircle, Check, IndianRupee, ShoppingBag, User, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { toPng } from 'html-to-image';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const StatusTimeline = ({ currentStatus }) => {
    const activeIndex = useMemo(() => {
        const adjustedStatus = currentStatus === 'pending' ? 'confirmed' : currentStatus;
        if (adjustedStatus === 'delivered' || adjustedStatus === 'picked_up') return 2;
        if (adjustedStatus === 'Ready') return 1;
        if (adjustedStatus === 'confirmed') return 0;
        return -1;
    }, [currentStatus]);

    const statusConfig = [
        { key: 'confirmed', title: 'Confirmed' },
        { key: 'Ready', title: 'Ready' },
        { key: 'delivered', title: 'Collected' },
    ];

    return (
        <div className="w-full max-w-sm relative flex justify-between items-center z-10">
            <div className="absolute top-1/2 left-0 w-full h-1 bg-border -translate-y-1/2">
                <motion.div
                    className="h-full bg-primary"
                    initial={{ width: '0%' }}
                    animate={{ width: activeIndex > 0 ? `${(activeIndex / (statusConfig.length - 1)) * 100}%` : '0%' }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                />
            </div>
            {statusConfig.map((status, index) => {
                const isCompleted = index <= activeIndex;
                return (
                    <div key={status.key} className="flex flex-col items-center text-center w-24 z-10">
                        <motion.div
                            className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all duration-500",
                                isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-border text-muted-foreground'
                            )}
                            animate={{ scale: isCompleted ? 1.1 : 1 }}
                            transition={{ type: 'spring' }}
                        >
                            <Check size={14} />
                        </motion.div>
                        <p className={cn(
                            "mt-2 text-xs font-semibold",
                            isCompleted ? 'text-foreground' : 'text-muted-foreground'
                        )}>
                            {status.title}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

function PreOrderTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const tokenFromUrl = searchParams.get('token');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [isFlipped, setIsFlipped] = useState(false);
    const [animationState, setAnimationState] = useState('drop');
    const [showRipple, setShowRipple] = useState(false);

    const tiltWrapperRef = useRef(null);

    const isOrderComplete = order?.status === 'delivered' || order?.status === 'picked_up';
    const isOrderRejected = order?.status === 'rejected';

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
                if (data.trackingToken !== tokenFromUrl) {
                    setError("Invalid token. You do not have permission to view this order.");
                    setOrder(null);
                } else {
                    setOrder(data);
                    setError(null);
                }
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
    }, [orderId, tokenFromUrl]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setAnimationState('float');
            setShowRipple(true);
            if (navigator.vibrate) navigator.vibrate([50, 20, 50]);
        }, 1200);

        const rippleTimer = setTimeout(() => setShowRipple(false), 2200);

        return () => { clearTimeout(timer); clearTimeout(rippleTimer); };
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!tiltWrapperRef.current) return;
            const x = e.clientX / window.innerWidth;
            const y = e.clientY / window.innerHeight;
            const rotateY = (x - 0.5) * 40;
            const rotateX = (0.5 - y) * 40;
            tiltWrapperRef.current.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        };
        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, []);

    const handleBackToMenu = () => {
        if (order?.restaurantId) {
            router.push(`/order/${order.restaurantId}`);
        } else {
            router.push('/');
        }
    };

    const coinTheme = useMemo(() => {
        if (!order) return 'bronze-theme';
        const amount = order.totalAmount || 0;
        if (amount > 500) return 'gold-theme';
        if (amount >= 150) return 'silver-theme';
        return 'bronze-theme';
    }, [order]);

    const qrColor = useMemo(() => {
        switch (coinTheme) {
            case 'gold-theme': return '#5c3c00';
            case 'silver-theme': return '#4a4a4a';
            case 'bronze-theme':
            default: return '#4a3318';
        }
    }, [coinTheme]);


    if (loading) {
        return <div className="fixed inset-0 bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (error) {
        return <div className="fixed inset-0 bg-background flex flex-col items-center justify-center text-red-500 p-4 text-center">
            <p>{error}</p>
            <Button onClick={handleBackToMenu} className="mt-4"><ArrowLeft size={16} className="mr-2" /> Back to Menu</Button>
        </div>;
    }

    if (!order) {
        return <div className="fixed inset-0 bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Order data not available.</div>;
    }

    const token = order?.dineInToken || '----';
    const [tokenPart1, tokenPart2] = token.includes('-') ? token.split('-') : [token, ''];
    const qrValue = orderId ? `${window.location.origin}/street-vendor-dashboard?collect_order=${orderId}` : '';
    const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date();
    const formattedDate = format(orderDate, 'dd MMM, p');

    return (
        <div className={cn("fixed inset-0 bg-background text-foreground font-sans p-4 flex flex-col justify-between items-center", coinTheme)}>
            <AnimatePresence>
                {isOrderComplete && (
                    <div className="confetti-container">
                        {[...Array(100)].map((_, i) => {
                            const style = {
                                left: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 4}s`,
                                animationDuration: `${Math.random() * 3 + 3}s`,
                                backgroundColor: `hsl(${Math.random() * 360}, 70%, 60%)`
                            };
                            return <div key={i} className="confetti" style={style}></div>
                        })}
                    </div>
                )}
            </AnimatePresence>
            {/* Layer 1 Security: Only show Back to Menu if order is pending */}
            <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center w-full z-20">
                {order?.status === 'pending' ? (
                    <Button onClick={handleBackToMenu} variant="ghost" className="text-foreground hover:bg-muted">
                        <ArrowLeft className="mr-2" /> Back to Menu
                    </Button>
                ) : (
                    <div className="text-sm text-yellow-600 bg-yellow-500/10 px-3 py-2 rounded-md">
                        Order is {order?.status}. Cannot add items.
                    </div>
                )}
            </header>

            <AnimatePresence>
                {isOrderComplete ? (
                    <motion.div
                        key="completion-screen"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex-grow flex flex-col items-center justify-center text-center"
                    >
                        <CheckCircle size={80} className="text-green-500 mb-6" />
                        <h2 className="text-4xl font-bold text-foreground">Order Collected!</h2>
                        <p className="mt-2 text-muted-foreground">Thank you for your order. Enjoy your meal!</p>
                        <Button onClick={handleBackToMenu} className="mt-8 bg-primary text-primary-foreground hover:bg-primary/90">
                            Order Again
                        </Button>
                    </motion.div>
                ) : isOrderRejected ? (
                    <motion.div
                        key="rejection-screen"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex-grow flex flex-col items-center justify-center text-center"
                    >
                        <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1, rotate: [0, -10, 10, -5, 5, 0] }} transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.2 }}>
                            <XCircle size={80} className="text-destructive mb-6" />
                        </motion.div>
                        <h2 className="text-4xl font-bold text-foreground">Order Cancelled</h2>
                        <p className="mt-2 text-muted-foreground">We're sorry, your order could not be processed.</p>
                        <p className="mt-4 text-sm font-semibold bg-destructive/10 text-destructive p-2 rounded-md">Reason: {order.rejectionReason || 'Not specified'}</p>
                        <Button onClick={handleBackToMenu} className="mt-8 bg-primary text-primary-foreground hover:bg-primary/90">
                            Try Again
                        </Button>
                    </motion.div>
                ) : (
                    <motion.div
                        key="coin-view"
                        initial={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        className="flex-grow flex flex-col items-center justify-center"
                    >
                        <AnimatePresence>
                            {showRipple && <motion.div className="ripple" initial={{ width: 100, height: 100, opacity: 0.8, borderWidth: 10 }} animate={{ width: 500, height: 500, opacity: 0, borderWidth: 0 }} transition={{ duration: 1, ease: "easeOut" }} />}
                        </AnimatePresence>

                        <div className="scene">
                            <div className="tilt-wrapper" ref={tiltWrapperRef}>
                                <div className={cn("anim-wrapper", animationState === 'drop' ? 'animate-drop' : 'animate-float')}>
                                    <div className={cn("coin", isFlipped && 'flipped')} onClick={() => setIsFlipped(f => !f)}>

                                        <div className="coin-face coin-front">
                                            <div className="texture-overlay"></div>
                                            <div className="sheen"></div>
                                            <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                                <path id="frontCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none" />
                                                <text><textPath href="#frontCurve" startOffset="50%" textAnchor="middle">★ {order.restaurantName} ★ {formattedDate} ★</textPath></text>
                                            </svg>
                                            <div className="token-label">TOKEN</div>
                                            <div className="token-number">
                                                <span className="token-number-main">{tokenPart1}-</span>
                                                <span className="token-number-sub">{tokenPart2}</span>
                                            </div>
                                        </div>

                                        <div className="coin-face coin-back">
                                            <div className="texture-overlay"></div>
                                            <div className="sheen"></div>
                                            <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                                <path id="backCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none" />
                                                <text><textPath href="#backCurve" startOffset="50%" textAnchor="middle">★ SECURED BY ServiZephyr ★ YOUR TRUSTED PARTNER ★</textPath></text>
                                            </svg>
                                            <div className="qr-box">
                                                <QRCode
                                                    value={qrValue}
                                                    size={140}
                                                    level={"H"}
                                                    bgColor="transparent"
                                                    fgColor={qrColor}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {!(isOrderComplete || isOrderRejected) && (
                <footer className="w-full flex flex-col items-center gap-6 z-20 pb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                            "border p-4 rounded-xl shadow-lg w-full max-w-sm transition-colors duration-500",
                            (order.status === 'pending' || order.status === 'confirmed') && "bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700",
                            order.status === 'Ready' && "bg-green-100 border-green-300 dark:bg-green-900/30 dark:border-green-700",
                            !['pending', 'confirmed', 'Ready'].includes(order.status) && "bg-card border-border"
                        )}
                    >
                        <div className="space-y-2">
                            <p className="text-sm"><strong>Bill to:</strong> {order.customerName}</p>
                            {order.items.map((item, index) => (
                                <div key={index} className="flex justify-between text-muted-foreground text-sm">
                                    <span>{item.quantity} x {item.name}</span>
                                    <span>{formatCurrency(item.totalPrice)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between font-bold text-lg pt-2 border-t border-dashed text-green-600">
                                <span>Grand Total</span>
                                <span>{formatCurrency(order.totalAmount)}</span>
                            </div>
                        </div>
                    </motion.div>
                    <StatusTimeline currentStatus={order.status} />
                </footer>
            )}
        </div>
    );
}

export default function PreOrderTrackingPage() {
    return (
        <Suspense fallback={<div className="fixed inset-0 bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <PreOrderTrackingContent />
        </Suspense>
    )
}
