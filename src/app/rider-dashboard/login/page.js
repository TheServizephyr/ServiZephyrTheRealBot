'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { auth, googleProvider, db } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Bike, AlertTriangle } from 'lucide-react';
import Image from 'next/image';

export default function RiderLoginPage() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const user = result.user;

            // After login, check if this user exists in the 'drivers' collection
            const driverDocRef = doc(db, "drivers", user.uid);
            const driverDoc = await getDoc(driverDocRef);

            if (driverDoc.exists()) {
                // If the document exists, they are a valid rider.
                localStorage.setItem("role", "rider");
                router.push('/rider-dashboard');
            } else {
                // If not, they are not authorized.
                setError("Your account is not registered as a rider. Please contact your restaurant owner to get an invite.");
                await auth.signOut(); // Sign them out
            }
        } catch (err) {
            console.error("Rider login error:", err);
            setError(err.message || "An error occurred during sign-in.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <motion.div
                className="w-full max-w-md p-8 space-y-8 bg-card rounded-xl shadow-2xl shadow-primary/10 border border-border"
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
            >
                <div className="text-center">
                    <Image src="/logo.png" alt="ServiZephyr Logo" width={180} height={45} className="h-12 w-auto mx-auto mb-4" />
                    <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-3">
                        <Bike size={32} className="text-primary"/>
                        Rider Portal
                    </h1>
                    <p className="text-muted-foreground mt-2">Sign in to start receiving orders.</p>
                </div>

                <div className="space-y-6">
                    <button
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        ) : 'Sign in with Google'}
                    </button>

                    {error && (
                        <div className="flex items-start gap-3 text-sm text-destructive bg-destructive/10 p-4 rounded-md">
                            <AlertTriangle size={20} className="flex-shrink-0 mt-1"/>
                            <p>{error}</p>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
