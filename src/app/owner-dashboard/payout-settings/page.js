
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Banknote, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function PayoutSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [accountId, setAccountId] = useState('');
    const router = useRouter();

    useEffect(() => {
        const fetchUserData = async () => {
             setLoading(true);
             const user = auth.currentUser;
             if (user) {
                 const idToken = await user.getIdToken();
                 const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` }});
                 if (res.ok) {
                     const data = await res.json();
                     if (data.razorpayAccountId) {
                         setAccountId(data.razorpayAccountId);
                     }
                 }
             }
             setLoading(false);
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchUserData();
            } else {
                router.push('/');
            }
        });
        
        return () => unsubscribe();
    }, [router]);

    const handleLinkAccount = async () => {
        setIsSubmitting(true);
        setError('');
        
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication failed.");
            
            const idToken = await user.getIdToken();

            // The backend will get the required user/restaurant details from the token
            const response = await fetch('/api/owner/create-linked-account', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Failed to link bank account.");
            }
            
            setAccountId(result.accountId);

        } catch (err) {
            console.error("Payout Settings Error:", err);
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    if (loading) {
         return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Loader2 className="h-16 w-16 text-primary animate-spin" />
                <p className="mt-4 text-muted-foreground">Checking your account status...</p>
            </div>
        )
    }

    if (accountId) {
        return (
             <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center h-full text-center p-8 bg-card border border-border rounded-xl"
            >
                <CheckCircle className="h-20 w-20 text-green-500" />
                <h2 className="mt-6 text-2xl font-bold">Bank Account Linked Successfully!</h2>
                <p className="mt-2 max-w-md text-muted-foreground">Your Razorpay Linked Account ID is:</p>
                <p className="mt-2 text-lg font-mono p-3 bg-muted rounded-md border border-border text-foreground">{accountId}</p>
                <p className="mt-4 text-sm text-muted-foreground">You are all set to receive payouts. No further action is needed.</p>
            </motion.div>
        )
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:p-6 text-foreground min-h-screen bg-background"
        >
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight">Payout Settings</h1>
                    <p className="text-muted-foreground mt-1">Link your bank account to receive payments from online orders.</p>
                </div>

                <div className="bg-card border border-border rounded-xl p-8 text-center">
                    <Banknote className="mx-auto h-16 w-16 text-primary mb-4" />
                    <h3 className="text-xl font-semibold text-foreground">Enable Payouts via Razorpay Route</h3>
                    <p className="mt-2 text-muted-foreground max-w-lg mx-auto">
                        To receive your earnings, you need to create a Razorpay Linked Account. This is a one-time setup. Clicking the button will securely create an account for your restaurant on Razorpay.
                    </p>
                    
                    {error && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                            <AlertTriangle size={16}/> {error}
                        </div>
                    )}
                    
                    <Button 
                        onClick={handleLinkAccount}
                        className="mt-6 w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground text-lg py-6 px-8" 
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : null}
                        {isSubmitting ? 'Creating Account...' : 'Create Linked Account Now'}
                    </Button>
                </div>
            </div>
        </motion.div>
    );
}
