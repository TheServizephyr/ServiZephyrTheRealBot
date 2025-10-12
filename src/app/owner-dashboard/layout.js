
"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/OwnerDashboard/Sidebar";
import Navbar from "@/components/OwnerDashboard/Navbar";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { AnimatePresence, motion } from "framer-motion";
import Script from "next/script";
import { ThemeProvider } from "@/components/ThemeProvider";
import "../globals.css";
import { auth } from "@/lib/firebase";
import { AlertTriangle, HardHat, ShieldOff, Salad, XCircle, Lock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";

export const dynamic = 'force-dynamic';

function FeatureLockScreen({ remark }) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
        <Lock className="h-16 w-16 text-yellow-400" />
        <h2 className="mt-6 text-2xl font-bold">Feature Restricted</h2>
        <p className="mt-2 max-w-md text-muted-foreground">Access to this feature has been temporarily restricted by the platform administrator.</p>
        {remark && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg w-full max-w-md">
                <p className="font-semibold">Admin Remark:</p>
                <p className="text-muted-foreground italic">"{remark}"</p>
            </div>
        )}
    </div>
  );
}


function OwnerDashboardContent({ children }) {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restaurantStatus, setRestaurantStatus] = useState({
      status: null,
      restrictedFeatures: [],
      suspensionRemark: ''
  });
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    
    const fetchRestaurantStatus = async (user) => {
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/status', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                setRestaurantStatus({
                    status: data.status,
                    restrictedFeatures: data.restrictedFeatures || [],
                    suspensionRemark: data.suspensionRemark || '',
                });
            } else {
                setRestaurantStatus({ status: 'error', restrictedFeatures: [], suspensionRemark: '' });
            }
        } catch (e) {
            setRestaurantStatus({ status: 'error', restrictedFeatures: [], suspensionRemark: '' });
        } finally {
            setLoading(false);
        }
    }
    
    const unsubscribe = auth.onAuthStateChanged(user => {
        if (user) {
            fetchRestaurantStatus(user);
        } else {
            router.push('/');
        }
    });

    return () => {
      window.removeEventListener('resize', checkScreenSize);
      unsubscribe();
    };
  }, [router]);

  if (loading || isMobile === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }
  
  const renderStatusScreen = () => {
      let icon, title, message, actions;

      if (restaurantStatus.status === 'approved') return null; // Good to go
      if (restaurantStatus.status === 'suspended') {
        const featureId = pathname.split('/').pop();
        if (restaurantStatus.restrictedFeatures.includes(featureId)) {
          return <FeatureLockScreen remark={restaurantStatus.suspensionRemark} />;
        }
        return null; // Not this specific feature, so allow render
      }

      // Handle pending, rejected, error states
      switch(restaurantStatus.status) {
          case 'pending':
              if (pathname.includes('/menu') || pathname.includes('/settings')) {
                  // Allow access to menu and settings for pending users
                  return null;
              }
              icon = <HardHat className="h-16 w-16 text-yellow-400" />;
              title = "Application Under Review";
              message = "Your other dashboard features are being reviewed. You can set up your menu while you wait.";
              actions = <Button onClick={() => router.push('/owner-dashboard/menu')}><Salad className="mr-2 h-4 w-4"/> Go to Menu</Button>
              break;
          case 'rejected':
              icon = <XCircle className="h-16 w-16 text-red-500" />;
              title = "Application Rejected";
              message = "Unfortunately, your application did not meet our criteria at this time. Please contact support for more information.";
              actions = <Button onClick={() => router.push('/contact')}>Contact Support</Button>
              break;
          default: // Error or other states
             icon = <AlertTriangle className="h-16 w-16 text-red-500" />;
             title = "Could Not Verify Status";
             message = "We couldn't verify your restaurant's status. This could be a temporary issue. Please refresh or contact support.";
             actions = <Button onClick={() => window.location.reload()}>Refresh</Button>
      }

      return (
        <main className={styles.mainContent} style={{padding: '1rem'}}>
          <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
            {icon}
            <h2 className="mt-6 text-2xl font-bold">{title}</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{message}</p>
            <div className="mt-6">{actions}</div>
          </div>
        </main>
      );
  }

  const blockedContent = renderStatusScreen();

  return (
    <>
      <Navbar
          isSidebarOpen={isSidebarOpen}
          setSidebarOpen={setSidebarOpen}
      />
       <div className={styles.contentWrapper}>
          <AnimatePresence>
            {isSidebarOpen && isMobile && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSidebarOpen(false)}
                className={styles.mobileOverlay}
              />
            )}
          </AnimatePresence>
          <Sidebar
            isOpen={isSidebarOpen}
            setIsOpen={setSidebarOpen}
            isMobile={isMobile}
            isCollapsed={!isSidebarOpen && !isMobile}
            restrictedFeatures={restaurantStatus.restrictedFeatures}
            status={restaurantStatus.status}
          />
          <main className={styles.mainContent}>
              {blockedContent || children}
          </main>
        </div>
    </>
  );
}


export default function OwnerDashboardRootLayout({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <OwnerDashboardContent>{children}</OwnerDashboardContent>
    </ThemeProvider>
  );
}
