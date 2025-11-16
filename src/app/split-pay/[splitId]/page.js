'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, Clock, Users, IndianRupee, Share2, Copy, RefreshCw, Wallet, User, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import QRCode from 'qrcode.react';
import Script from 'next/script';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const ShareButton = ({ text }) => {
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    return (
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline"><Share2 className="mr-2 h-4 w-4"/> Share</Button>
        </a>
    );
};

const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <Button size="sm" variant="outline" onClick={handleCopy}>
            <Copy className="mr-2 h-4 w-4"/> {copied ? 'Copied!' : 'Copy'}
        </Button>
    );
};

const PaymentTimeline = ({ shares }) => (
    <div className="space-y-4">
        {shares.map((share, index) => (
            <div key={share.shareId} className="flex items-center gap-4">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", share.status === 'paid' ? 'bg-green-500' : 'bg-yellow-500')}>
                    {share.status === 'paid' ? <CheckCircle size={18} className="text-white"/> : <Clock size={18} className="text-white"/>}
                </div>
                <div className="flex-grow flex justify-between items-center">
                    <span className="font-semibold">{share.shareId === 0 ? 'You' : `Friend ${share.shareId}`}</span>
                    <span className="font-mono text-sm">{formatCurrency(share.amount)}</span>
                </div>
            </div>
        ))}
    </div>
);


const ShareCard = ({ share, isInitiator = false }) => {
    const paymentLink = `${window.location.origin}/split-pay/${share.splitId}?pay_share=${share.shareId}`;
    const shareText = `Hi! Please pay your share of ${formatCurrency(share.amount)} for our group order using this link: ${paymentLink}`;

    return (
         <div className="bg-card rounded-lg border border-border p-4 space-y-4">
            <p className="font-bold text-foreground flex items-center gap-2"><User size={16}/> {isInitiator ? 'Your Share' : `Friend ${share.shareId}`}</p>
            <div className="flex justify-center items-center gap-4">
                <div className="text-center">
                    <p className="text-4xl font-bold text-center">{formatCurrency(share.amount)}</p>
                </div>
                {!isInitiator && (
                    <div className="bg-white p-2 rounded-md">
                         <QRCode value={paymentLink} size={80} level="H" />
                    </div>
                )}
            </div>
             <div className="flex gap-2 justify-center pt-2 border-t border-dashed">
                <ShareButton text={shareText}/>
                <CopyButton text={paymentLink}/>
            </div>
        </div>
    );
};


export default function SplitPayPage() {
    const { splitId } = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const db = useFirestore();

    const [splitData, setSplitData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPaying, setIsPaying] = useState(null);

    useEffect(() => {
        if (!splitId || !db) {
            setError(`Session ID is missing or Firestore is not ready.`);
            setLoading(false);
            return;
        }

        setLoading(true);
        const splitDocRef = doc(db, 'split_payments', splitId);

        const unsubscribe = onSnapshot(splitDocRef, 
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = { ...docSnap.data(), id: docSnap.id };
                    setSplitData(data);
                    if (data.status === 'completed' && data.trackingToken) {
                        setTimeout(() => router.push(`/order/placed?orderId=${data.baseOrderId}&token=${data.trackingToken}`), 2500);
                    }
                } else {
                    setError("This payment session could not be found.");
                }
                setLoading(false);
            },
            (err) => {
                console.error("Firestore onSnapshot error:", err);
                setError(`Could not load the payment session. Error: ${err.message}.`);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [splitId, db, router]);

    const shareToPay = useMemo(() => {
        const shareIdParam = searchParams.get('pay_share');
        return shareIdParam ? parseInt(shareIdParam, 10) : null;
    }, [searchParams]);
    
    const remainingAmount = useMemo(() => {
        if (!splitData) return 0;
        const paidAmount = (splitData.shares || []).filter(s => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);
        return splitData.totalAmount - paidAmount;
    }, [splitData]);

    const handlePayShare = useCallback(async (share, isRemaining = false) => {
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
            setError("Payment gateway is not configured.");
            return;
        }
        setIsPaying(isRemaining ? 'remaining' : share.shareId);

        let orderId;
        let amount;

        if (isRemaining) {
             if (remainingAmount <= 0) {
                alert("The bill is already fully paid!");
                setIsPaying(null);
                return;
            }
            try {
                const res = await fetch('/api/payment/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grandTotal: remainingAmount })
                });
                if(!res.ok) throw new Error("Could not create order for remaining amount.");
                const orderData = await res.json();
                orderId = orderData.id;
                amount = remainingAmount;
            } catch(err) {
                 setError(err.message);
                 setIsPaying(null);
                 return;
            }
        } else {
            orderId = share.razorpay_order_id;
            amount = share.amount;
        }
        
        const options = {
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            amount: amount * 100,
            currency: "INR",
            name: "Group Order Payment",
            description: `Payment for group order`,
            order_id: orderId,
            notes: { split_session_id: splitId },
            handler: (response) => {},
            modal: { ondismiss: () => setIsPaying(null) }
        };
        try {
            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (response) => {
                 setError("Payment Failed: " + response.error.description);
                 setIsPaying(null);
            });
            rzp.open();
        } catch (e) {
            setError("Could not open payment window. Please try again or refresh the page.");
            setIsPaying(null);
        }
    }, [splitId, remainingAmount]);

    const initiatorShare = useMemo(() => splitData?.shares?.find(s => s.shareId === 0), [splitData]);
    const friendShares = useMemo(() => splitData?.shares?.filter(s => s.shareId !== 0) || [], [splitData]);

    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    if (error) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>;
    }
    if (!splitData) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Session data not available.</div>
    }
    if (splitData.status === 'completed') {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1, transition: { type: 'spring', delay: 0.2 } }}>
                    <CheckCircle className="h-24 w-24 text-green-500" />
                </motion.div>
                <h1 className="text-3xl font-bold mt-4">All Payments Received!</h1>
                <p className="text-muted-foreground mt-2">Your order is being placed. Redirecting you now...</p>
            </div>
        );
    }

    const myShareCard = splitData.shares.find(s => s.shareId === shareToPay);

    if (shareToPay !== null) {
        if (!myShareCard) {
             return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">This specific payment link is invalid.</div>
        }
         return (
             <div className="min-h-screen bg-background text-foreground p-4 md:p-8 flex items-center justify-center">
                 <Script src="https://checkout.razorpay.com/v1/checkout.js" />
                 <div className="w-full max-w-sm">
                    <h1 className="text-2xl font-bold text-center mb-6">Pay Your Share</h1>
                    <ShareCard share={myShareCard} isInitiator={false}/>
                 </div>
            </div>
         );
    }
    
    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />

            <div className="max-w-4xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Split Payment Tracker</h1>
                    <p className="text-muted-foreground mt-2">Track payments from your friends in real-time.</p>
                </header>

                <div className="grid lg:grid-cols-3 gap-8 items-start">
                    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="lg:col-span-1 bg-card border border-border rounded-xl p-6 shadow-lg space-y-4">
                        <div className="flex justify-between items-center text-lg">
                            <span className="font-semibold text-muted-foreground">Total Bill</span>
                            <span className="font-bold text-primary">{formatCurrency(splitData.totalAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-lg">
                            <span className="font-semibold text-muted-foreground">Remaining</span>
                            <span className="font-bold text-foreground">{formatCurrency(remainingAmount)}</span>
                        </div>
                        <h3 className="text-lg font-bold pt-4 border-t border-dashed">Payment Status</h3>
                        <PaymentTimeline shares={splitData.shares} />
                    </motion.div>
                    
                    <div className="lg:col-span-2 space-y-6">
                        {initiatorShare && (
                             <motion.div initial={{opacity: 0, y:20}} animate={{opacity:1, y:0}} className="bg-card p-4 rounded-lg border-2 border-primary">
                                 <ShareCard share={initiatorShare} isInitiator={true}/>
                             </motion.div>
                        )}

                        <div className="space-y-4">
                             <Button onClick={() => handlePayShare({ amount: remainingAmount }, true)} className="w-full h-14 text-lg" disabled={!!isPaying || remainingAmount <= 0}>
                                {isPaying === 'remaining' ? <Loader2 className="animate-spin" /> : `Pay Remaining Balance (${formatCurrency(remainingAmount)})`}
                            </Button>
                        </div>
                         
                        <h2 className="text-xl font-bold pt-4">Friends' Shares</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {friendShares.map(share => (
                               <ShareCard key={share.shareId} share={{...share, splitId}} isInitiator={false} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
