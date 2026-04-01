"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/firebase/provider";
import { auth } from "@/lib/firebase";
import { isDesktopApp } from "@/lib/desktop/runtime";
import { resolveBestEffortAuthRedirect } from "@/lib/authRoleCache";
import { getBestEffortIdToken } from "@/lib/client-session";

function resolveDashboardPath(payload) {
  if (payload?.redirectTo) return payload.redirectTo;
  if (payload?.hasMultipleRoles) return "/select-role";
  if (payload?.role === "admin") return "/admin-dashboard";
  if (payload?.role === "rider" || payload?.role === "delivery-boy") return "/rider-dashboard";
  if (payload?.role === "street-vendor") return "/street-vendor-dashboard";
  if (payload?.role === "employee") return "/employee-dashboard";
  if (payload?.role === "owner" || payload?.role === "restaurant-owner" || payload?.role === "shop-owner") {
    return "/owner-dashboard";
  }
  if (payload?.role === "customer") return "/customer-dashboard";
  return null;
}

export default function DesktopAuthRecovery() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const redirectInFlightRef = useRef(false);

  const hardRedirect = (targetPath) => {
    if (typeof window === "undefined") return;
    if (!targetPath) return;
    window.location.replace(targetPath);
  };

  useEffect(() => {
    const desktopRuntime = isDesktopApp();
    if (!desktopRuntime) return;
    if (redirectInFlightRef.current) return;

    const isLandingPath = pathname === "/" || pathname === "/login";
    if (!isLandingPath) return;
    if (isUserLoading) return;

    if (!user) {
      if (pathname === "/") {
        redirectInFlightRef.current = true;
        console.log("[DesktopAuthRecovery] No desktop user on landing page, sending to /login");
        hardRedirect("/login");
      }
      return;
    }

    let cancelled = false;

    const recoverDesktopSession = async () => {
      try {
        redirectInFlightRef.current = true;
        const currentUser = auth.currentUser || user;
        const idToken = await getBestEffortIdToken(currentUser);
        const res = await fetch("/api/auth/check-role", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
          },
        });

        if (cancelled) return;

        if (res.status === 404) {
          const fallbackRedirect = await resolveBestEffortAuthRedirect(currentUser);
          if (fallbackRedirect) {
            console.log("[DesktopAuthRecovery] Resolved desktop fallback after 404:", fallbackRedirect);
            hardRedirect(fallbackRedirect);
            return;
          }
          console.log("[DesktopAuthRecovery] User exists but no profile found, sending to /complete-profile");
          hardRedirect("/complete-profile");
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        const targetPath = resolveDashboardPath(data);
        if (targetPath && targetPath !== pathname) {
          console.log("[DesktopAuthRecovery] Recovered desktop session, redirecting to", targetPath);
          hardRedirect(targetPath);
          return;
        }

        if (pathname === "/") {
          console.log("[DesktopAuthRecovery] Desktop session unresolved on home, forcing /login");
          hardRedirect("/login");
        }
      } catch (error) {
        console.error("[DesktopAuthRecovery] Failed to resolve session", error);
        const fallbackRedirect = await resolveBestEffortAuthRedirect(auth.currentUser || user);
        if (fallbackRedirect) {
          hardRedirect(fallbackRedirect);
          return;
        }
        if (pathname === "/") {
          hardRedirect("/login");
          return;
        }
        redirectInFlightRef.current = false;
      }
    };

    void recoverDesktopSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, user, isUserLoading]);

  return null;
}
