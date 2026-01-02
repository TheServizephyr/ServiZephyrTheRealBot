"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getRedirectResult, onAuthStateChanged } from "firebase/auth";
import { Loader2 } from "lucide-react";

export default function RedirectHandler() {
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState("Initializing...");
    const [error, setError] = useState(null);
    const router = useRouter();

    useEffect(() => {
        const handleRedirectResult = async () => {
            console.log("[RedirectHandler] Starting redirect check...");
            try {
                const result = await getRedirectResult(auth);
                if (result && result.user) {
                    console.log("[RedirectHandler] User returned from redirect:", result.user.email);
                    setLoading(true);
                    setMsg("Verifying login details...");
                    await processLogin(result.user);
                } else {
                    console.log("[RedirectHandler] No redirect result found. Checking current auth state...");
                    // Optional: Check if user is already logged in but caught in a reload loop?
                    // For now, just stop loading to allow normal app usage.
                    setLoading(false);
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
