
"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/OwnerDashboard/Sidebar";
import Navbar from "@/components/OwnerDashboard/Navbar";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { AnimatePresence, motion } from "framer-motion";
import Script from "next/script";
import { ThemeProvider } from "@/components/ThemeProvider";
import "../globals.css";

export const dynamic = 'force-dynamic';

export default function OwnerDashboardLayout({ children }) {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(null); // Initialize with null

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile); // Open if not mobile, closed if mobile
    };

    // Run on initial mount
    checkScreenSize();
    
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Render a loading state until isMobile is determined
  if (isMobile === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

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
      <div className={styles.dashboardApp}>
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
        
        <Navbar
            isSidebarOpen={isSidebarOpen}
            setSidebarOpen={setSidebarOpen}
        />
        <div className={styles.contentWrapper}>
          <Sidebar
            isOpen={isSidebarOpen}
            setIsOpen={setSidebarOpen}
            isMobile={isMobile}
            isCollapsed={!isSidebarOpen && !isMobile}
          />
          <main className={styles.mainContent}>
              {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
