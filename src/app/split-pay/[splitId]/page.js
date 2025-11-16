

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, Clock, Users, IndianRupee, Share2, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import QRCode from 'qrcode.react';
import Script from 'next/script';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

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

export default function SplitPayPage() {
    const { splitId } = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const db = useFirestore(); // Use the hook to get the correct, initialized firestore instance

    const [splitData, setSplitData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPaying, setIsPaying] = useState(false);

    useEffect(() => {
        console.log(`[DEBUG] split-pay page: useEffect triggered for splitId: ${splitId}`);
        if (!splitId || !db) {
            const errorMsg = `Split session ID is missing or Firestore is not ready. splitId: ${splitId}, db: ${!!db}`;
            console.error(`[DEBUG] split-pay page: ${errorMsg}`);
            setError(errorMsg);
            setLoading(false);
            return;
        }

        setLoading(true);
        console.log(`[DEBUG] split-pay page: Setting up Firestore listener for split_payments/${splitId}`);
        const splitDocRef = doc(db, 'split_payments', splitId);

        const unsubscribe = onSnapshot(splitDocRef, 
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    console.log("[DEBUG] split-pay page: Firestore onSnapshot received data:", JSON.stringify(data, null, 2));
                    setSplitData(data);

                    if (data.status === 'completed') {
                         console.log("[DEBUG] split-pay page: Session completed. Redirecting in 2.5 seconds...");
                        setTimeout(() => router.push(`/order/placed?orderId=${data.baseOrderId}&token=${data.trackingToken}`), 2500);
                    }
                } else {
                    console.warn(`[DEBUG] split-pay page: Firestore document does not exist for ID: ${splitId}`);
                    setError("This payment session could not be found. It may have been deleted or never existed.");
                }
                setLoading(false);
            },
            (err) => {
                console.error("[DEBUG] CRITICAL: Firestore onSnapshot error:", err);
                setError(`Could not load the payment session. Error: ${err.message}. Please check console for details.`);
                setLoading(false);
            }
        );

        return () => {
            console.log(`[DEBUG] split-pay page: Cleaning up Firestore listener for ${splitId}`);
            unsubscribe();
        };
    }, [splitId, db, router]);

     const shareToPay = useMemo(() => {
        return searchParams.get('pay_share');
    }, [searchParams]);

    const handlePayShare = useCallback((share) => {
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
            setError("Payment gateway is not configured.");
            return;
        }
        setIsPaying(true);
        const options = {
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            amount: share.amount * 100,
            currency: "INR",
            name: "Group Order Payment",
            description: `Your share for the group order`,
            order_id: share.razorpay_order_id,
            handler: function (response) {
               // The onSnapshot listener will automatically update the UI
            },
            modal: {
                ondismiss: function() {
                    setIsPaying(false);
                }
            },
            "prefill": {
                // You can prefill customer info here if available
            }
        };
        try {
            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', function (response){
                 setError("Payment Failed: " + response.error.description);
                 setIsPaying(false);
            });
            rzp.open();
        } catch (e) {
            setError("Could not open payment window. Please try again or refresh the page.");
            setIsPaying(false);
        }
    }, []);

    useEffect(() => {
        if (shareToPay && splitData && !loading) {
            const shareIndex = parseInt(shareToPay, 10);
            const share = splitData.shares?.find(s => s.shareId === shareIndex);
            if (share && share.status === 'pending') {
                console.log(`[DEBUG] split-pay page: Auto-triggering payment for shareId: ${shareToPay}`);
                handlePayShare(share);
            }
        }
    }, [shareToPay, splitData, loading, handlePayShare]);

    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    if (error) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>;
    }
    
    if (!splitData) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Session data not available. It might be loading or the session is invalid.</div>
    }
    
    const paidShares = (splitData.shares || []).filter(s => s.status === 'paid').length;
    const progress = (paidShares / splitData.splitCount) * 100;
    const remainingAmount = splitData.totalAmount - (paidShares * (splitData.shares?.[0]?.amount || 0));

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

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <div className="max-w-4xl mx-auto">
                <header className="text-center mb-8">
                    <div className="flex justify-center items-center gap-4">
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Split Payment Tracker</h1>
                        <Button onClick={() => fetchStatus(false)} variant="ghost" size="icon" disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""}/></Button>
                    </div>
                    <p className="text-muted-foreground mt-2">Track payments from your friends in real-time.</p>
                </header>
                <motion.div initial={{opacity:0}} animate={{opacity:1}} className="bg-card border border-border rounded-xl p-6 shadow-lg">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3 text-lg">
                            <Users className="text-primary"/>
                            <span className="font-semibold text-foreground">Split between {splitData.splitCount} people</span>
                        </div>
                        <div className="text-right">
                             <p className="text-muted-foreground text-sm">Total Bill</p>
                             <p className="font-bold text-3xl text-primary">{formatCurrency(splitData.totalAmount)}</p>
                        </div>
                    </div>
                    <div className="mt-6">
                        <div className="flex justify-between items-center mb-2">
                             <span className="text-sm font-semibold text-foreground">{paidShares} of {splitData.splitCount} Paid</span>
                             <span className="text-sm font-semibold text-foreground">{formatCurrency(remainingAmount)} Remaining</span>
                        </div>
                        <Progress value={progress} className="h-4" />
                    </div>
                </motion.div>
                <div className="mt-8">
                    <h2 className="text-xl font-bold mb-4">Your Friends' Shares</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(splitData?.shares || []).map((share, index) => {
                            const isPaid = share.status === 'paid';
                            const paymentLink = `${window.location.origin}/split-pay/${splitId}?pay_share=${share.shareId}`;
                            const shareText = `Hi! Please pay your share of ${formatCurrency(share.amount)} for our group order using this link: ${paymentLink}`;

                            return (
                                <motion.div 
                                    key={share.shareId}
                                    className={`p-4 rounded-lg border-2 ${isPaid ? 'border-green-500 bg-green-500/10' : 'border-dashed border-border'}`}
                                    initial={{opacity: 0, y:20}}
                                    animate={{opacity:1, y:0}}
                                    transition={{delay: index * 0.1}}
                                >
                                    <div className="flex justify-between items-center">
                                        <p className="font-bold text-foreground">Friend {share.shareId + 1}</p>
                                        {isPaid ? (
                                            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/20 text-green-400"><CheckCircle size={14}/> Paid</span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400"><Clock size={14}/> Pending</span>
                                        )}
                                    </div>
                                    <p className="text-2xl font-bold text-center my-3">{formatCurrency(share.amount)}</p>
                                    {!isPaid && (
                                        <div className="space-y-3 flex flex-col items-center">
                                             <Button onClick={() => handlePayShare(share)} className="w-full bg-primary hover:bg-primary/80" disabled={isPaying}>
                                                {isPaying ? <Loader2 className="animate-spin" /> : `Pay Now`}
                                             </Button>
                                             <div className="bg-white p-2 rounded-lg inline-block">
                                                <QRCode value={paymentLink} size={128} />
                                            </div>
                                            <p className="text-xs text-muted-foreground">Ask your friend to scan or use the links below.</p>
                                            <div className="flex gap-2 justify-center">
                                                <ShareButton text={shareText}/>
                                                <CopyButton text={paymentLink}/>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
