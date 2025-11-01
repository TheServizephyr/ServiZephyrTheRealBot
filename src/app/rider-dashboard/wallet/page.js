'use client';

import { useState, useEffect } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser } from '@/firebase';
import { Wallet, IndianRupee, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function WalletPage() {
    const { user, isUserLoading } = useUser();
    const [walletBalance, setWalletBalance] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isUserLoading || !user) {
            return;
        }

        const docRef = doc(db, 'drivers', user.uid);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setWalletBalance(docSnap.data().walletBalance || 0);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, isUserLoading]);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">My Wallet</h1>
                <p className="text-muted-foreground mt-1">View your current balance and transaction history.</p>
            </header>

            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><IndianRupee/> Current Balance</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="animate-spin text-primary" />
                    ) : (
                        <p className="text-5xl font-bold text-primary">₹{walletBalance.toFixed(2)}</p>
                    )}
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground py-10">
                        <p>Transaction history coming soon.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
