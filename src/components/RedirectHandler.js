"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getRedirectResult } from "firebase/auth";
import { Loader2 } from "lucide-react";

export default function RedirectHandler() {
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState("");
    const router = useRouter();

    useEffect(() => {
        const handleRedirectResult = async () => {
            try {
                const result = await getRedirectResult(auth);
                if (result && result.user) {
                    console.log("[RedirectHandler] User returned from redirect:", result.user.email);
                    setLoading(true);
                    setMsg("Verifying login details...");
                    await processLogin(result.user);
                } else {
                    setLoading(false); // No redirect result, just normal page load
                }
            } catch (error) {
                console.error("[RedirectHandler] Redirect error:", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    // Only alert for real errors
                    // alert(`Login failed: ${error.message}`); 
                }
                setLoading(false);
            }
        };

        handleRedirectResult();
    }, []);

    const processLogin = async (user) => {
        try {
            setMsg("Checking account permissions...");
            const idToken = await user.getIdToken();

            const res = await fetch('/api/auth/check-role', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
            });

            const data = await res.json();
            console.log("[RedirectHandler] Role check response:", data);

            if (!res.ok) {
                if (res.status === 404) {
                    setMsg("New user detected! Redirecting...");
                    localStorage.setItem("role", "none");
                    router.push("/complete-profile");
                    return;
                }
                throw new Error(data.message || 'Failed to verify user role.');
            }

            if (data.hasMultipleRoles) {
                setMsg("Multiple accounts found. Redirecting...");
                router.push("/select-role");
                return;
            }

            if (data.redirectTo) {
                setMsg(`Welcome back! Redirecting to ${data.outletName || 'dashboard'}...`);
                localStorage.setItem("role", data.role || 'employee');
                router.push(data.redirectTo);
                return;
            }

            const { role, businessType } = data;
            setMsg(`Login successful! Entering ${role} dashboard...`);
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
            // alert(`Login error: ${err.message}`);
            setLoading(false);
        }
    };

    if (!loading) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <h2 className="text-xl font-semibold">{msg || "Finishing login..."}</h2>
        </div>
    );
}
