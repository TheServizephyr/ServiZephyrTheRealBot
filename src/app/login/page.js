"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence, onAuthStateChanged } from "firebase/auth";

const getSafeRedirectPath = (value) => {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return null;
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
    return trimmed;
};

const getRedirectLabel = (path) => {
    if (!path) return "your dashboard";
    if (path.startsWith("/owner-dashboard")) return "the owner dashboard";
    if (path.startsWith("/admin-dashboard")) return "the admin dashboard";
    if (path.startsWith("/street-vendor-dashboard")) return "the street-vendor dashboard";
    if (path.startsWith("/rider-dashboard")) return "the rider dashboard";
    if (path.startsWith("/employee-dashboard")) return "the employee dashboard";
    if (path.startsWith("/customer-dashboard")) return "the customer dashboard";
    return "where you left off";
};

function LoginPageContent() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [msg, setMsg] = useState(""); // Message to show user
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = getSafeRedirectPath(searchParams.get("redirect"));
    const hasProcessedRedirect = useRef(false); // Prevent React Strict Mode double call

    const shouldFallbackToRedirect = (error) => {
        const code = String(error?.code || '');
        return [
            'auth/popup-closed-by-user',
            'auth/popup-blocked',
            'auth/cancelled-popup-request',
        ].includes(code);
    };

    const readLoginFlag = () =>
        sessionStorage.getItem('isLoggingIn') || localStorage.getItem('isLoggingIn');

    const writeLoginFlag = (value) => {
        if (value == null) {
            sessionStorage.removeItem('isLoggingIn');
            localStorage.removeItem('isLoggingIn');
            return;
        }
        sessionStorage.setItem('isLoggingIn', value);
        localStorage.setItem('isLoggingIn', value);
    };

    // Handle redirect result when user returns from Google
    useEffect(() => {
        // CRITICAL: Prevent double execution in React Strict Mode (dev)
        if (hasProcessedRedirect.current) {
            console.log("[Login] Already processed, skipping duplicate call");
            return;
        }

        const handleRedirectResult = async () => {
            let unsubscribe = () => { };
            let timeoutId = null;
            try {
                console.log("[Login] Checking for redirect result...");
                const loginFlag = readLoginFlag();
                const isLikelyMobile =
                    typeof navigator !== 'undefined' &&
                    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
                const authRecoveryTimeoutMs = isLikelyMobile ? 45000 : 15000;

                if (loginFlag) {
                    setLoading(true);
                    setMsg("Finishing login...");
                }

                const result = await getRedirectResult(auth);

                if (result && result.user) {
                    console.log("[Login] Redirect result found:", result.user.email);
                    hasProcessedRedirect.current = true; // Mark as processed
                    setLoading(true);
                    setMsg("Verifying user details..."); // ✅ THIS MESSAGE!
                    writeLoginFlag(null); // Cleanup
                    await handleAuthSuccess(result.user);
                } else {
                    console.log("[Login] No redirect result, checking fallback...");

                    if (auth.currentUser && loginFlag) {
                        console.log("[Login] Fallback - User authenticated:", auth.currentUser.email);
                        hasProcessedRedirect.current = true;
                        setLoading(true);
                        setMsg("Verifying user details...");
                        writeLoginFlag(null);
                        await handleAuthSuccess(auth.currentUser);
                    } else if (auth.currentUser) {
                        console.log("[Login] Auth user already restored. Continuing...");
                        hasProcessedRedirect.current = true;
                        setLoading(true);
                        setMsg("Restoring login session...");
                        await handleAuthSuccess(auth.currentUser);
                    } else if (loginFlag) {
                        let flagAgeSec = 0;
                        try {
                            const parsed = JSON.parse(loginFlag);
                            flagAgeSec = (Date.now() - Number(parsed?.timestamp || 0)) / 1000;
                        } catch {
                            flagAgeSec = 0;
                        }

                        if (flagAgeSec > 600) {
                            console.log("[Login] Stale login flag detected, clearing.");
                            writeLoginFlag(null);
                            setLoading(false);
                            return;
                        }

                        console.log("[Login] Waiting for Firebase auth state restore...");
                        timeoutId = setTimeout(() => {
                            writeLoginFlag(null);
                            setLoading(false);
                            setError("Login did not finish on this browser. Please try Google sign-in again.");
                        }, authRecoveryTimeoutMs);

                        unsubscribe = onAuthStateChanged(auth, async (user) => {
                            if (!user || hasProcessedRedirect.current) return;
                            if (timeoutId) clearTimeout(timeoutId);
                            hasProcessedRedirect.current = true;
                            writeLoginFlag(null);
                            setLoading(true);
                            setMsg("Recovering login session...");
                            await handleAuthSuccess(user);
                        });
                    } else {
                        console.log("[Login] No processing needed");
                        setLoading(false);
                    }
                }
            } catch (err) {
                console.error("[Login] Redirect error:", err);
                setError(err.message || "Login failed. Please try again.");
                setLoading(false);
            }

            return () => {
                unsubscribe();
                if (timeoutId) clearTimeout(timeoutId);
            }
        };

        const cleanupPromise = handleRedirectResult();
        return () => {
            Promise.resolve(cleanupPromise).then((cleanup) => {
                if (typeof cleanup === 'function') cleanup();
            });
        };
    }, []);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError("");

        try {
            try {
                console.log("[Login] Trying popup-based Google login...");
                const result = await signInWithPopup(auth, googleProvider);
                console.log("[Login] Popup successful, processing...");
                writeLoginFlag(null);
                setLoading(true);
                setMsg("Verifying user details...");
                await handleAuthSuccess(result.user);
                return;
            } catch (popupError) {
                console.warn("[Login] Popup auth failed, evaluating redirect fallback...", popupError);
                if (!shouldFallbackToRedirect(popupError)) {
                    throw popupError;
                }
                console.log("[Login] Falling back to redirect-based login...");
                await setPersistence(auth, browserLocalPersistence);
                writeLoginFlag(JSON.stringify({ timestamp: Date.now() }));
                await signInWithRedirect(auth, googleProvider);
                return;
            }
        } catch (err) {
            console.error("Login error:", err);
            setError(err.message || "Login failed. Please try again.");
            setLoading(false);
            writeLoginFlag(null);
        }
    };

    const handleAuthSuccess = async (user) => {
        console.log("[Login] handleAuthSuccess called with user:", user.email);
        try {
            const idToken = await user.getIdToken();
            console.log("[Login] Got ID token, calling check-role API...");

            let res, data;
            try {
                res = await fetch("/api/auth/check-role", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${idToken}`
                    },
                });
                console.log("[Login] Fetch completed, status:", res.status);

                data = await res.json();
                console.log("[Login] API Response:", { status: res.status, data });
            } catch (fetchError) {
                console.error("[Login] Fetch error:", fetchError);
                throw new Error(`API call failed: ${fetchError.message}`);
            }

            if (res.status === 404) {
                // New user - redirect to role selection
                console.log("[Login] New user detected, redirecting to select-role");
                return router.push("/select-role");
            }

            if (data.hasMultipleRoles) {
                console.log("[Login] Multiple roles detected, redirecting to select-role");
                window.location.href = "/select-role";
                return;
            }

            // PRIORITY 1: Check if API returned specific redirectTo (for employees, etc.)
            if (data.redirectTo) {
                console.log("[Login] API returned redirectTo:", data.redirectTo);
                localStorage.setItem("role", data.role || "employee");
                localStorage.removeItem("businessType");
                sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                window.location.href = data.redirectTo;
                return;
            }

            if (data.role) {
                const { role, businessType } = data;
                console.log("[Login] Role found:", role, "Business Type:", businessType);

                const resolvedBusinessType =
                    (businessType
                        ? (
                            businessType === "street_vendor"
                                ? "street-vendor"
                                : (businessType === "shop" ? "store" : businessType)
                        )
                        : null) ||
                    (role === "shop-owner" ? "store"
                        : role === "street-vendor" ? "street-vendor"
                            : (role === "owner" || role === "restaurant-owner") ? "restaurant"
                                : null);

                localStorage.setItem("role", role);
                if (resolvedBusinessType) {
                    localStorage.setItem("businessType", resolvedBusinessType);
                } else {
                    localStorage.removeItem("businessType");
                }

                // Show success message before redirect
                const dashboardName =
                    role === "admin" ? "admin dashboard"
                        : (role === "owner" || role === "restaurant-owner" || role === "shop-owner") ? "owner dashboard"
                            : role === "street-vendor" ? "street-vendor dashboard"
                                : role === "rider" || role === "delivery-boy" ? "rider dashboard"
                                    : role === "employee" ? "employee dashboard"
                                        : "customer dashboard";

                setMsg(`✅ Login successful! Redirecting to ${dashboardName}...`);

                // Redirect based on role - MATCH RedirectHandler logic exactly
                if (role === "owner" || role === "restaurant-owner" || role === "shop-owner") {
                    console.log("[Login] Redirecting to owner dashboard");
                    sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                    window.location.href = redirectTo || "/owner-dashboard";
                    return;
                } else if (role === "admin") {
                    console.log("[Login] Redirecting to admin dashboard");
                    window.location.href = redirectTo || "/admin-dashboard";
                    return;
                } else if (role === "rider" || role === "delivery-boy") {
                    console.log("[Login] Redirecting to rider dashboard");
                    window.location.href = redirectTo || "/rider-dashboard";
                    return;
                } else if (role === "street-vendor") {
                    console.log("[Login] Redirecting to street-vendor dashboard");
                    sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                    window.location.href = redirectTo || "/street-vendor-dashboard";
                    return;
                } else if (role === "employee") {
                    console.log("[Login] Redirecting to employee dashboard");
                    window.location.href = redirectTo || "/employee-dashboard";
                    return;
                } else {
                    // customer or unknown
                    console.log("[Login] Redirecting to customer dashboard");
                    window.location.href = redirectTo || "/customer-dashboard";
                    return;
                }
            }

            // Fallback
            console.log("[Login] No role matched or found, redirecting to home");
            router.push(redirectTo || "/");
        } catch (err) {
            console.error("[Login] Auth error:", err);
            setError("Authentication failed. Please try again.");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen overflow-hidden bg-[#fffdf6] text-slate-950">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(253,186,18,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(253,186,18,0.16),_transparent_26%)]" />
            <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
                <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                    <motion.div
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="order-2 lg:order-1"
                    >
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-4 py-2 text-sm font-semibold text-amber-900 shadow-sm">
                            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                            Built for restaurants, cloud kitchens, cafes and street vendors
                        </div>
                        <div className="mt-6 max-w-2xl">
                            <h1 className="font-headline text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                                One secure sign-in.
                                <span className="block text-amber-500">Everything ready after that.</span>
                            </h1>
                            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
                                Sign in once and we will take you straight to {getRedirectLabel(redirectTo)}. No extra setup, no repeated taps, just a fast handoff into your workspace.
                            </p>
                        </div>

                        <div className="mt-8 grid gap-4 sm:grid-cols-3">
                            {[
                                { title: "Fast login", text: "Popup on desktop, redirect fallback on mobile when needed." },
                                { title: "Role-aware", text: "Owners, customers, riders and staff land in the right place." },
                                { title: "Secure session", text: "Google sign-in with server-side role checks before redirect." },
                            ].map((item) => (
                                <div key={item.title} className="rounded-2xl border border-amber-100 bg-white/80 p-4 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.22)]">
                                    <div className="text-sm font-semibold text-slate-950">{item.title}</div>
                                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="order-1 lg:order-2"
                    >
                        <div className="rounded-[30px] border border-amber-200/70 bg-white/95 p-6 shadow-[0_40px_120px_-50px_rgba(15,23,42,0.28)] sm:p-8">
                            <div className="rounded-[24px] border border-slate-100 bg-[linear-gradient(180deg,#fffef9_0%,#ffffff_68%,#fff7db_100%)] p-6 sm:p-8">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 shadow-inner shadow-amber-200/70">
                                        <Image src="/logo.png" alt="ServiZephyr logo" width={42} height={42} className="h-10 w-10 object-contain" priority />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">ServiZephyr Access</p>
                                        <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Continue with Google</h2>
                                    </div>
                                </div>

                                <p className="mt-5 text-base leading-7 text-slate-600">
                                    Use the same Google account you already use for your restaurant, staff, rider or customer access. We&apos;ll verify the role and continue automatically.
                                </p>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                                    >
                                        {error}
                                    </motion.div>
                                )}

                                {msg && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
                                    >
                                        {loading && (
                                            <div className="h-4 w-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                                        )}
                                        {msg}
                                    </motion.div>
                                )}

                                <button
                                    onClick={handleGoogleLogin}
                                    disabled={loading}
                                    className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground shadow-[0_20px_40px_-20px_rgba(253,186,18,0.9)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    {loading ? (
                                        <div className="h-6 w-6 rounded-full border-[3px] border-slate-900 border-t-transparent animate-spin" />
                                    ) : (
                                        <>
                                            <svg className="h-6 w-6" viewBox="0 0 24 24">
                                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                            </svg>
                                            <span>{loading ? "Signing you in..." : "Continue with Google"}</span>
                                        </>
                                    )}
                                </button>

                                <div className="mt-6 rounded-2xl border border-slate-200 bg-white/90 px-4 py-4">
                                    <div className="flex items-center justify-between text-sm text-slate-500">
                                        <span>Authentication</span>
                                        <span className="font-semibold text-slate-700">Google + role verification</span>
                                    </div>
                                    <div className="mt-3 h-px bg-slate-200" />
                                    <p className="mt-3 text-sm leading-6 text-slate-600">
                                        By continuing, you agree to ServiZephyr&apos;s{" "}
                                        <a href="/terms-and-conditions" className="font-semibold text-amber-700 hover:underline">
                                            Terms of Service
                                        </a>{" "}
                                        and{" "}
                                        <a href="/privacy" className="font-semibold text-amber-700 hover:underline">
                                            Privacy Policy
                                        </a>.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <p className="mt-5 text-center text-sm text-slate-600">
                            Need help?{" "}
                            <a href="/support" className="font-semibold text-amber-700 hover:underline">
                                Contact Support
                            </a>
                        </p>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#fffdf6] flex items-center justify-center">
                <div className="h-8 w-8 rounded-full border-4 border-amber-500 border-t-transparent animate-spin"></div>
            </div>
        }>
            <LoginPageContent />
        </Suspense>
    );
}
