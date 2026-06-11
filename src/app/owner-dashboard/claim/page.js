'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { Loader2, ShieldCheck, Phone, Lock, Sparkles, CheckCircle2, ArrowRight, Store } from 'lucide-react';
import { getBestEffortIdToken } from '@/lib/client-session';

export default function ClaimRestaurantPage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();

    const [phone, setPhone] = useState('');
    const [claimToken, setClaimToken] = useState('');
    const [claiming, setClaiming] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [claimedData, setClaimedData] = useState(null);

    // If user is not logged in after auth finishes, redirect to login
    useEffect(() => {
        if (!isUserLoading && !user) {
            router.replace(`/login?redirect=/owner-dashboard/claim`);
        }
    }, [user, isUserLoading, router]);

    const handleClaimSubmit = async (e) => {
        if (e) e.preventDefault();
        setError(null);

        if (!phone.trim()) {
            setError('Please enter the phone number associated with your restaurant.');
            return;
        }
        if (!claimToken.trim()) {
            setError('Please enter the claim token.');
            return;
        }

        setClaiming(true);
        try {
            const idToken = await getBestEffortIdToken(user);

            const response = await fetch('/api/owner/claim-restaurant', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    phone: phone.trim(),
                    claimToken: claimToken.trim()
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.message || 'Verification failed. Please try again.');
            }

            setClaimedData(data);
            setSuccess(true);
            
            // Clean local storage caching to force dashboard update
            if (typeof window !== 'undefined') {
                localStorage.removeItem('businessType');
                localStorage.removeItem('role');
            }

        } catch (err) {
            console.error('[Claim] Error:', err);
            setError(err.message || 'An error occurred during claiming.');
        } finally {
            setClaiming(false);
        }
    };

    if (isUserLoading || (!user && !error)) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
                <span className="text-sm font-medium text-slate-400">Verifying session...</span>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl relative overflow-hidden">
                    {/* Background sparkles */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
                    
                    <div className="h-16 w-16 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="h-8 w-8 animate-bounce" />
                    </div>

                    <h2 className="text-2xl font-black text-slate-100 mb-2 font-headline">
                        Claim Successful!
                    </h2>
                    <p className="text-sm text-slate-400 leading-relaxed mb-6">
                        Your restaurant has been successfully linked to your account. Your dashboard and menu are now active!
                    </p>

                    <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 mb-8 flex items-center gap-3 text-left">
                        <Store className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                        <div>
                            <span className="text-xs text-slate-500 font-bold block uppercase tracking-wider">Claimed Outlet ID</span>
                            <span className="text-sm font-bold text-slate-200">{claimedData?.businessId}</span>
                        </div>
                    </div>

                    <button
                        onClick={() => router.push('/owner-dashboard/live-orders')}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-black py-3 px-6 rounded-full transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                    >
                        Go to Dashboard <ArrowRight className="h-5 w-5" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
                
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-100 font-headline leading-tight">
                            Claim Restaurant Profile
                        </h1>
                        <p className="text-xs text-slate-400">
                            Link your pre-onboarded profile to your owner account.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleClaimSubmit} className="space-y-5">
                    {/* Phone Number */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5 pl-1">
                            Registered Phone Number
                        </label>
                        <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                            <input
                                type="tel"
                                placeholder="Enter phone (e.g. 919876543210)"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-2xl py-3 pl-12 pr-4 text-slate-100 placeholder-slate-600 text-sm focus:outline-none transition-all shadow-inner"
                            />
                        </div>
                    </div>

                    {/* Claim Token */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5 pl-1">
                            Claim Token Code (6-digit)
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                            <input
                                type="text"
                                placeholder="e.g. SZ-892401"
                                value={claimToken}
                                onChange={(e) => setClaimToken(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-2xl py-3 pl-12 pr-4 text-slate-100 placeholder-slate-600 text-sm focus:outline-none transition-all shadow-inner"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-950/40 border border-red-900/60 rounded-2xl p-3 text-xs text-red-400 flex items-start gap-2.5">
                            <Sparkles className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={claiming}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 disabled:opacity-50 text-slate-950 font-black py-3 px-6 rounded-full transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                    >
                        {claiming ? (
                            <>
                                <Loader2 className="h-5 w-5 animate-spin" /> Verifying Profile...
                            </>
                        ) : (
                            <>
                                Claim Ownership <ArrowRight className="h-5 w-5" />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
