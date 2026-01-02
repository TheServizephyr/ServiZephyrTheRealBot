"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getRedirectResult, onAuthStateChanged } from "firebase/auth";
import { Loader2 } from "lucide-react";

export default function RedirectHandler() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [error, setError] = useState(null);
    const router = useRouter();

    useEffect(() => {
        let unsubscribe = () => { };

        const handleRedirectResult = async () => {
            // Check if we are expecting a login immediately to show loader
            const initialFlag = sessionStorage.getItem('isLoggingIn');
            if (initialFlag) {
                setLoading(true);
                setMsg("Finishing login...");
            }

            console.log("[RedirectHandler] Starting redirect check...");
            console.log("[RedirectHandler] Current user:", auth.currentUser?.email || "null");
            try {
                console.log("[RedirectHandler] Calling getRedirectResult...");
                const result = await getRedirectResult(auth);
                console.log("[RedirectHandler] getRedirectResult returned:", result ? `User: ${result.user.email}` : "null");

                if (result && result.user) {
                    console.log("[RedirectHandler] User returned from redirect:", result.user.email);
                    sessionStorage.removeItem('isLoggingIn'); // Cleanup
                    setLoading(true);
                    setMsg("Verifying login details...");
                    await processLogin(result.user);
                } else {
                    console.log("[RedirectHandler] No redirect result found. Checking fallback...");

                    // Fallback: Check if we are in a 'logging in' state but redirect result was lost
                    // Use timestamp-based validation to avoid stale flags
                    const loginFlagData = sessionStorage.getItem('isLoggingIn');
                    const isDashboard = window.location.pathname.includes('dashboard');

                    if (loginFlagData) {
                        let shouldProceed = false;
                        let flagAge = 0;

                        // Try to parse timestamp
                        try {
                            if (loginFlagData === 'true') {
                                // Old format - treat as stale
                                console.log("[RedirectHandler] Old format flag detected. Clearing.");
                                sessionStorage.removeItem('isLoggingIn');
                                setLoading(false);
                                return;
                            }

                            const { timestamp } = JSON.parse(loginFlagData);
                            flagAge = (Date.now() - timestamp) / 1000;

                            // If flag is older than 30 seconds, it's stale
                            if (flagAge > 30) {
                                console.log(`[RedirectHandler] Stale login flag (${flagAge.toFixed(0)}s old). Clearing.`);
                                sessionStorage.removeItem('isLoggingIn');
                                setLoading(false);
                                return;
                            }

                            shouldProceed = true;
                        } catch (e) {
                            // Invalid format - clear it
                            console.log("[RedirectHandler] Invalid flag format. Clearing.");
                            sessionStorage.removeItem('isLoggingIn');
                            setLoading(false);
                            return;
                        }

                        // If already logged in or on dashboard, clear flag
                        if (shouldProceed && (auth.currentUser || isDashboard)) {
                            console.log("[RedirectHandler] Already authenticated/on dashboard. Clearing flag.");
                            sessionStorage.removeItem('isLoggingIn');
                            setLoading(false);
                            return;
                        }

                        if (shouldProceed) {
                            console.log(`[RedirectHandler] Fresh login flag (${flagAge.toFixed(0)}s old). Checking auth state...`);

                            // Longer timeout for slow networks and Firebase auth restoration
                            const timeoutId = setTimeout(() => {
                                console.log("[RedirectHandler] Auth state timeout (15s). No user authenticated.");
                                setLoading(false);
                                sessionStorage.removeItem('isLoggingIn');
                            }, 15000); // 15 seconds

                            unsubscribe = onAuthStateChanged(auth, async (user) => {
                                if (user) {
                                    console.log("[RedirectHandler] ✓ User authenticated:", user.email);
                                    clearTimeout(timeoutId);
                                    sessionStorage.removeItem('isLoggingIn');
                                    setLoading(true);
                                    setMsg("Recovering login session...");
                                    await processLogin(user);
                                } else {
                                    console.log("[RedirectHandler] Auth state: null (waiting for Firebase to restore session...)");
                                }
                            });
                        } else {
                            setLoading(false);
                        }
                    } else {
                        setLoading(false);
                    }
                }
            } catch (error) {
                console.error("[RedirectHandler] Redirect error:", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    setError(`Login failed: ${error.message}`);
                    setMsg("An error occurred.");
                } else {
                    setLoading(false);
                }
            }
        };

        handleRedirectResult();

        return () => unsubscribe();
    }, []);

    const processLogin = async (user) => {
        try {
            setMsg("Checking account permissions...");
            const idToken = await user.getIdToken();
            console.log("[RedirectHandler] Got ID Token, calling API...");

            const res = await fetch('/api/auth/check-role', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
            });

            const data = await res.json();
            console.log("[RedirectHandler] Role check response:", data);

            if (!res.ok) {
                if (res.status === 404) {
                    setMsg("New user detected! Redirecting...");
                    console.log("[RedirectHandler] 404 - New User. Redirecting to /complete-profile");
                    localStorage.setItem("role", "none");
                    router.push("/complete-profile");
                    return;
                }
                throw new Error(data.message || 'Failed to verify user role.');
            }

            if (data.hasMultipleRoles) {
                setMsg("Multiple accounts found. Redirecting...");
                console.log("[RedirectHandler] Multiple roles. Redirecting to /select-role");
                router.push("/select-role");
                return;
            }

            if (data.redirectTo) {
                setMsg(`Welcome back! Redirecting to ${data.outletName || 'dashboard'}...`);
                console.log(`[RedirectHandler] specific redirectTo found: ${data.redirectTo}`);
                localStorage.setItem("role", data.role || 'employee');
                router.push(data.redirectTo);
                return;
            }

            const { role, businessType } = data;
            setMsg(`Login successful! Entering ${role} dashboard...`);
            console.log(`[RedirectHandler] Role: ${role}, Business: ${businessType}`);

            localStorage.setItem("role", role);
            if (businessType) localStorage.setItem("businessType", businessType);

            if (role === "owner" || role === "restaurant-owner" || role === "shop-owner") {
                router.push("/owner-dashboard");
            } else if (role === "admin") {
                router.push("/admin-dashboard");
            } else if (role === "rider") {
                router.push("/rider-dashboard");
            } else if (role === "street-vendor") {
                router.push("/street-vendor-dashboard");
            } else {
                router.push("/customer-dashboard");
            }

        } catch (err) {
            console.error("[RedirectHandler] Logic error:", err);
            setError(`Login processing error: ${err.message}`);
            setMsg("Failed to process login.");
            // Do NOT setLoading(false) so the user sees the error
        }
    };

    if (!loading && !error) return null;

    if (error) {
        return (
            <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 text-white p-4">
                <div className="bg-red-500/10 border border-red-500 rounded-lg p-6 max-w-md w-full text-center">
                    <h2 className="text-xl font-bold mb-2 text-red-500">Login Issue</h2>
                    <p className="mb-4">{error}</p>
                    <button
                        onClick={() => { setError(null); setLoading(false); }}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                    >
                        Close & Continue
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <h2 className="text-xl font-semibold">{msg || "Finishing login..."}</h2>
        </div>
    );
}
