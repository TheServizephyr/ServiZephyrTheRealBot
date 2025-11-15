'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, Clock, Users, IndianRupee, Share2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import QRCode from 'qrcode.react';
import Script from 'next/script';


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
    const router = useRouter();
    const [splitData, setSplitData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        console.log(`[DEBUG] SplitPay Page Mounted. splitId: ${splitId}`);

        if (!splitId) {
            console.error("[DEBUG] No splitId found in URL.");
            setError("Split session ID is missing.");
            setLoading(false);
            return;
        }

        console.log(`[DEBUG] Setting up Firestore listener for split_payments/${splitId}`);
        const splitDocRef = doc(db, 'split_payments', splitId);
        
        const unsubscribe = onSnapshot(splitDocRef, (docSnap) => {
            console.log("[DEBUG] onSnapshot callback triggered.");
            if (docSnap.exists()) {
                const data = docSnap.data();
                console.log("[DEBUG] Document exists. Data received:", JSON.stringify(data, null, 2));
                setSplitData(data);
                setError(null); // Clear previous errors if any

                if (data.status === 'completed') {
                    console.log("[DEBUG] Split is complete. Redirecting to tracking page for base order:", data.baseOrderId);
                    router.push(`/track/${data.baseOrderId}`);
                }
            } else {
                console.error("[DEBUG] Document does not exist in Firestore.");
                setError("This split payment session was not found or has expired.");
            }
            setLoading(false);
            console.log("[DEBUG] State updated. Loading: false");
        }, (err) => {
            console.error("[DEBUG] CRITICAL: Firestore onSnapshot error:", err);
            setError("Could not load the payment session. Please try again.");
            setLoading(false);
            console.log("[DEBUG] Error state updated. Loading: false");
        });

        // Cleanup function for when the component unmounts
        return () => {
            console.log("[DEBUG] Unsubscribing from Firestore listener.");
            unsubscribe();
        };
    }, [splitId, router]);
    
    const handlePayShare = (share) => {
        console.log("[DEBUG] handlePayShare triggered for share:", share);
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
            alert("Payment gateway is not configured.");
            console.error("[DEBUG] Razorpay Key ID is missing.");
            return;
        }
        
        const options = {
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            amount: share.amount * 100, // Amount in paise
            currency: "INR",
            name: "Group Order Payment",
            description: `Your share for order #${splitData?.baseOrderId?.substring(0,8)}`,
            order_id: share.razorpay_order_id,
            notes: {
                split_session_id: splitId,
            },
            handler: function (response) {
               console.log("[DEBUG] Razorpay payment successful:", response);
               // Webhook will handle the Firestore update. Page will auto-update via onSnapshot.
            },
            modal: {
                ondismiss: function() {
                    console.log("[DEBUG] Razorpay modal dismissed.");
                    alert('Payment was not completed.');
                }
            }
        };
        console.log("[DEBUG] Opening Razorpay with options:", options);
        try {
            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', function (response){
                console.error("[DEBUG] Razorpay payment failed:", response.error);
                alert("Payment Failed: " + response.error.description);
            });
            rzp.open();
        } catch (e) {
            console.error("[DEBUG] Error initializing Razorpay:", e);
            alert("Could not open payment window. Please try again.");
        }
    };


    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }

    if (error) {
        return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>;
    }
    
    const paidShares = splitData ? (splitData.shares || []).filter(s => s.status === 'paid').length : 0;
    const progress = splitData ? (paidShares / splitData.splitCount) * 100 : 0;
    const remainingAmount = splitData ? splitData.totalAmount - (paidShares * (splitData.shares?.[0]?.amount || 0)) : 0;


    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <div className="max-w-4xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Split Payment Tracker</h1>
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
                                             <Button onClick={() => handlePayShare(share)} className="w-full bg-primary hover:bg-primary/80">Pay Now</Button>
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
                
                 {remainingAmount > 0 && paidShares > 0 && (
                    <div className="mt-12 text-center p-6 bg-card border border-dashed rounded-xl">
                        <h3 className="text-lg font-semibold">Someone not paying?</h3>
                        <p className="text-muted-foreground text-sm mt-1">You can pay the remaining amount to complete the order now.</p>
                        <Button onClick={() => alert("This feature is coming soon!")} className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground">
                            Pay Remaining {formatCurrency(remainingAmount)}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
