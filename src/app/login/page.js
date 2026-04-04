"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence, onAuthStateChanged } from "firebase/auth";
import { isDesktopApp } from "@/lib/desktop/runtime";
import {
    persistResolvedAuthProfile,
    resolveBestEffortAuthRedirect,
} from "@/lib/authRoleCache";

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
    const desktopRuntime = isDesktopApp();

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
            if (desktopRuntime) {
                console.log("[Login] Desktop runtime detected, trying popup-based Google login first...");
                setMsg("Opening Google sign-in...");
                await setPersistence(auth, browserLocalPersistence);

                try {
                    const result = await signInWithPopup(auth, googleProvider);
                    console.log("[Login] Desktop popup successful, processing...");
                    writeLoginFlag(null);
                    setLoading(true);
                    setMsg("Verifying user details...");
                    await handleAuthSuccess(result.user);
                    return;
                } catch (desktopPopupError) {
                    console.warn("[Login] Desktop popup failed, falling back to redirect...", desktopPopupError);
                    if (!shouldFallbackToRedirect(desktopPopupError)) {
                        throw desktopPopupError;
                    }
                    writeLoginFlag(JSON.stringify({ timestamp: Date.now(), mode: 'desktop-redirect' }));
                    await signInWithRedirect(auth, googleProvider);
                    return;
                }
            }

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
            const code = String(err?.code || "");
            if (code === "auth/unauthorized-domain") {
                setError("Google login is blocked because localhost is not authorized in Firebase Authentication. Add localhost in Firebase -> Authentication -> Settings -> Authorized domains.");
            } else {
                setError(err.message || "Login failed. Please try again.");
            }
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
                if (desktopRuntime) {
                    const fallbackRedirect = await resolveBestEffortAuthRedirect(user);
                    if (fallbackRedirect) {
                        console.log("[Login] Desktop best-effort auth fallback resolved after 404:", fallbackRedirect);
                        window.location.href = fallbackRedirect;
                        return;
                    }
                }
                // New user - redirect to onboarding profile completion
                console.log("[Login] New user detected, redirecting to complete-profile");
                return router.push("/complete-profile");
            }

            if (data.hasMultipleRoles) {
                persistResolvedAuthProfile(user, data);
                console.log("[Login] Multiple roles detected, redirecting to select-role");
                window.location.href = "/select-role";
                return;
            }

            // PRIORITY 1: Check if API returned specific redirectTo (for employees, etc.)
            if (data.redirectTo) {
                persistResolvedAuthProfile(user, data);
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
                persistResolvedAuthProfile(user, data);

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
                    window.location.href = redirectTo || "/owner-dashboard/live-orders";
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
            console.log("[Login] No role matched or found after auth resolution.");
            if (desktopRuntime) {
                const fallbackRedirect = await resolveBestEffortAuthRedirect(user);
                if (fallbackRedirect) {
                    console.log("[Login] Desktop best-effort auth fallback resolved after empty payload:", fallbackRedirect);
                    window.location.href = fallbackRedirect;
                    return;
                }
            }
            router.push(redirectTo || "/");
        } catch (err) {
            console.error("[Login] Auth error:", err);
            if (desktopRuntime) {
                const fallbackRedirect = await resolveBestEffortAuthRedirect(user);
                if (fallbackRedirect) {
                    console.log("[Login] Desktop best-effort auth fallback resolved after auth error:", fallbackRedirect);
                    window.location.href = fallbackRedirect;
                    return;
                }
            }
            setError("Authentication failed. Please try again.");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden text-slate-950">
            {/* Subtle animated background gradient */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(253,186,18,0.08),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(253,186,18,0.05),_transparent_40%)]" />
            
            <div className="relative w-full max-w-md px-6 sm:px-8 py-10 z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                >
                    <div className="flex flex-col items-center mb-8">
                        <div className="flex h-16 w-16 mb-6 items-center justify-center rounded-2xl bg-white shadow-sm border border-slate-100">
                            <Image src="/logo.png" alt="ServiZephyr logo" width={48} height={48} className="h-10 w-10 object-contain" priority />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 text-center">
                            Welcome Back
                        </h1>
                        <p className="mt-2 text-center text-slate-500 text-[15px]">
                            Sign in to access {getRedirectLabel(redirectTo)}.
                        </p>
                    </div>

                    <div className="rounded-3xl border border-slate-200/60 bg-white/80 backdrop-blur-xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:p-10">
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 font-medium"
                            >
                                {error}
                            </motion.div>
                        )}

                        {msg && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900"
                            >
                                {loading && (
                                    <div className="h-4 w-4 shrink-0 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />
                                )}
                                {msg}
                            </motion.div>
                        )}

                        <button
                            onClick={handleGoogleLogin}
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white border border-slate-200 px-6 py-3.5 text-base font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:border-slate-300 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? (
                                <div className="h-5 w-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                            ) : (
                                <>
                                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    <span>Continue with Google</span>
                                </>
                            )}
                        </button>

                        <div className="mt-8 pt-6 border-t border-slate-100">
                            <p className="text-center text-[13px] leading-relaxed text-slate-500">
                                By continuing, you agree to ServiZephyr&apos;s{" "}
                                <a href="/terms-and-conditions" className="font-semibold text-slate-700 hover:text-amber-600 transition-colors">
                                    Terms of Service
                                </a>{" "}
                                and{" "}
                                <a href="/privacy" className="font-semibold text-slate-700 hover:text-amber-600 transition-colors">
                                    Privacy Policy
                                </a>.
                            </p>
                        </div>
                    </div>
                </motion.div>
                
                <p className="mt-8 text-center text-[13px] font-medium text-slate-500">
                    Need help?{" "}
                    <a href="/contact" className="text-slate-700 hover:text-amber-600 transition-colors">
                        Contact Support
                    </a>
                </p>
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
