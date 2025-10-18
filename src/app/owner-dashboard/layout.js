

'use client';

import { useState, useEffect } from "react";
import Sidebar from "@/components/OwnerDashboard/Sidebar";
import Navbar from "@/components/OwnerDashboard/Navbar";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { AnimatePresence, motion } from "framer-motion";
import Script from "next/script";
import { ThemeProvider } from "@/components/ThemeProvider";
import "../globals.css";
import { auth } from "@/lib/firebase";
import { AlertTriangle, HardHat, ShieldOff, Salad, XCircle, Lock, Mail, Phone, MessageSquare, Menu, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";

export const dynamic = 'force-dynamic';

function FeatureLockScreen({ remark, featureId }) {
  const supportPhone = "919027872803";
  const supportEmail = "contact@servizephyr.com";

  const whatsappText = encodeURIComponent(`Hello ServiZephyr Team,\n\nMy access to the '${featureId}' feature has been restricted. The remark says: "${remark}".\n\nPlease help me resolve this.`);
  const emailSubject = encodeURIComponent(`Issue: Access Restricted for '${featureId}' Feature`);
  const emailBody = encodeURIComponent(`Hello ServiZephyr Team,\n\nI am writing to you because my access to the '${featureId}' feature on my dashboard has been restricted.\n\nThe remark provided is: "${remark}"\n\nCould you please provide more details or guide me on the steps to resolve this?\n\nThank you.`);


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
        <div className="mt-6 pt-6 border-t border-border w-full max-w-md">
            <p className="text-sm font-semibold mb-4">Need help? Contact support.</p>
            <div className="flex justify-center gap-4">
                <a href={`https://wa.me/${supportPhone}?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline"><MessageSquare className="mr-2 h-4 w-4"/> WhatsApp</Button>
                </a>
                <a href={`mailto:${supportEmail}?subject=${emailSubject}&body=${emailBody}`}>
                    <Button variant="outline"><Mail className="mr-2 h-4 w-4"/> Email</Button>
                </a>
                <a href={`tel:${supportPhone}`}>
                     <Button variant="outline"><Phone className="mr-2 h-4 w-4"/> Call Us</Button>
                </a>
            </div>
        </div>
    </div>
  );
}


function OwnerDashboardContent({ children }) {
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [restaurantStatus, setRestaurantStatus] = useState({
      status: null,
      restrictedFeatures: [],
      suspensionRemark: ''
  });
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Load Facebook SDK
    window.fbAsyncInit = function() {
      window.FB.init({
        appId            : '1183141156381017',
        xfbml            : true,
        version          : 'v19.0'
      });
      window.FB.AppEvents.logPageView();
    };
    
    (function(d, s, id){
       var js, fjs = d.getElementsByTagName(s)[0];
       if (d.getElementById(id)) {return;}
       js = d.createElement(s); js.id = id;
       js.src = "https://connect.facebook.net/en_US/sdk.js";
       fjs.parentNode.insertBefore(js, fjs);
     }(document, 'script', 'facebook-jssdk'));

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
        // ** THE FIX **
        // Trust localStorage first to prevent redirect flicker on page load.
        const storedRole = localStorage.getItem('role');

        if (user && (storedRole === 'owner' || storedRole === 'restaurant-owner' || storedRole === 'shop-owner')) {
            fetchRestaurantStatus(user);
        } else if (user) {
            // User is logged in but not an owner, redirect
            router.push('/');
        } else {
            // No user found, redirect
            router.push('/');
        }
    });

    return () => {
      window.removeEventListener('resize', checkScreenSize);
      unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }
  
  const renderStatusScreen = () => {
      const featureId = pathname.split('/').pop();
      if (restaurantStatus.status === 'approved') return null; 

      if (restaurantStatus.status === 'suspended') {
        if (restaurantStatus.restrictedFeatures.includes(featureId)) {
          return <FeatureLockScreen remark={restaurantStatus.suspensionRemark} featureId={featureId} />;
        }
        return null; // Not this specific feature, so allow render
      }
      
      let icon, title, message, actions;

      // Handle pending, rejected, error states
      switch(restaurantStatus.status) {
          case 'pending':
              if (pathname.endsWith('/owner-dashboard/menu') || pathname.endsWith('/owner-dashboard/settings') || pathname.endsWith('/owner-dashboard/connections') || pathname.endsWith('/owner-dashboard/payout-settings')) {
                  return null;
              }
              icon = <HardHat className="h-16 w-16 text-yellow-400" />;
              title = "Application Under Review";
              message = "Your other dashboard features are being reviewed. You can set up your menu and settings while you wait.";
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
             actions = (
                <div className="flex gap-4">
                    <Button onClick={() => window.location.reload()} variant="default">Refresh</Button>
                    <Button variant="default" onClick={() => router.push('/contact')}>Contact Support</Button>
                </div>
            );
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
    <div className="flex h-screen flex-col bg-background">
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
    </div>
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
      <OwnerDashboardContent>{children}</OwnerDashboardContent>
    </ThemeProvider>
  );
}
