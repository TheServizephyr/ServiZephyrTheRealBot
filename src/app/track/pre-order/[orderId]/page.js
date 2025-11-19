
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';

function PreOrderTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const tokenFromUrl = searchParams.get('token');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // States for animations
    const [isFlipped, setIsFlipped] = useState(false);
    const [animationState, setAnimationState] = useState('drop'); // 'drop', 'float'
    const [showRipple, setShowRipple] = useState(false);

    // Ref for tilt effect
    const tiltWrapperRef = useRef(null);

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

    // Handle the drop animation and transition to float
    useEffect(() => {
        const timer = setTimeout(() => {
            setAnimationState('float');
            setShowRipple(true);
            if(navigator.vibrate) navigator.vibrate([50, 20, 50]);
        }, 1200);

        const rippleTimer = setTimeout(() => {
            setShowRipple(false);
        }, 2200);

        return () => {
            clearTimeout(timer);
            clearTimeout(rippleTimer);
        };
    }, []);

    // Tilt effect logic
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

    if (loading) {
        return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    
    if (error) {
        return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center text-red-400 p-4 text-center">{error}</div>;
    }

    if (!order) {
        return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center text-slate-400 p-4 text-center">Order data not available.</div>;
    }
    
    const token = order?.dineInToken || '----';
    const [tokenPart1, tokenPart2] = token.includes('-') ? token.split('-') : [token, ''];
    const qrValue = `${window.location.origin}/street-vendor-dashboard?collect_order=${orderId}`;
    
    return (
        <div className="fixed inset-0 bg-slate-900 text-white font-sans p-4 flex flex-col justify-center items-center">
            <div className="particles-container">
                {[...Array(20)].map((_, i) => (
                    <div key={i} className="particle" style={{
                        left: `${Math.random() * 100}%`,
                        animationDelay: `${Math.random() * 5}s`,
                        animationDuration: `${(Math.random() * 3 + 3)}s`,
                    }}></div>
                ))}
            </div>
            
            <AnimatePresence>
              {showRipple && (
                <motion.div
                  className="ripple"
                  initial={{ width: 100, height: 100, opacity: 0.8, borderWidth: 10 }}
                  animate={{ width: 500, height: 500, opacity: 0, borderWidth: 0 }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              )}
            </AnimatePresence>

            <div className="scene">
                <div className="tilt-wrapper" ref={tiltWrapperRef}>
                    <div className={cn("anim-wrapper", animationState === 'drop' ? 'animate-drop' : 'animate-float')}>
                        <div className={cn("coin", isFlipped && 'flipped')} onClick={() => setIsFlipped(f => !f)}>
                            
                            <div className="coin-face coin-front">
                                <div className="texture-overlay"></div>
                                <div className="sheen"></div>
                                <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                    <path id="frontCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none"/>
                                    <text><textPath href="#frontCurve" startOffset="50%" textAnchor="middle">★ {order.restaurantName} ★ ORDER READY ★</textPath></text>
                                </svg>
                                <div style={{fontSize:'10px', fontWeight:'bold', color:'#5c3c00'}}>TOKEN</div>
                                <div className="token-number">{tokenPart1}</div>
                            </div>

                            <div className="coin-face coin-back">
                                <div className="texture-overlay"></div>
                                <div className="sheen"></div>
                                <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                    <path id="backCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none"/>
                                    <text><textPath href="#backCurve" startOffset="50%" textAnchor="middle">● POWERED BY SERVIZEPHYR ● SECURE ●</textPath></text>
                                </svg>
                                <div className="qr-box">
                                     <QRCode value={qrValue} size={120} level={"H"} bgColor="transparent" fgColor="#3e2800" />
                                </div>
                                <div style={{marginTop:'8px', fontSize:'10px', fontWeight:'bold', opacity:'0.6'}}>SCAN TO COLLECT</div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            <div className="instruction">Tap to Flip • Move cursor to Tilt</div>
        </div>
    );
}

export default function PreOrderTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>}>
            <PreOrderTrackingContent />
        </Suspense>
    )
}
