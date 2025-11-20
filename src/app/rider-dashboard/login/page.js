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
                        className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-[#4285F4] hover:bg-[#357ae8] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        ) : (
                             <>
                                <svg className="w-5 h-5 mr-3" viewBox="0 0 48 48">
                                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C43.021,36.251,44,34.058,44,31.625C44,27.904,44,24.488,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                </svg>
                                Sign in with Google
                            </>
                        )}
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
