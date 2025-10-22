

'use client';

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Bell, User, Sun, Moon, Menu, Store, X, CheckCircle } from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import { useTheme } from "next-themes";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import InfoDialog from "@/components/InfoDialog";
import { formatDistanceToNow } from 'date-fns';

const MotionDiv = motion.div;

export default function Navbar({ isSidebarOpen, setSidebarOpen, restaurantName, restaurantLogo }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [restaurantStatus, setRestaurantStatus] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const dropdownRef = useRef(null);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  useEffect(() => {
    const fetchStatus = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (res.ok) {
          const data = await res.json();
          setRestaurantStatus(data.isOpen);
        }
      } catch (error) {
        console.error("Failed to fetch restaurant status:", error);
      } finally {
        setLoadingStatus(false);
      }
    };
    fetchStatus();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);

  const handleLogout = async () => {
    try {
      await auth.signOut();
      localStorage.removeItem('role');
      router.push('/');
    } catch (error) {
      console.error("Logout failed:", error);
      setInfoDialog({ isOpen: true, title: "Error", message: "Could not log out. Please try again." });
    }
  };

  const handleStatusToggle = async (newStatus) => {
    setLoadingStatus(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const idToken = await user.getIdToken();
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ isOpen: newStatus })
      });
      if (!res.ok) throw new Error("Failed to update status");
      setRestaurantStatus(newStatus);
    } catch (error) {
      setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
    } finally {
      setLoadingStatus(false);
    }
  };

  return (
    <>
    <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
    />
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <button
          className={`${styles.iconButton} md:hidden`}
          onClick={() => setSidebarOpen(!isSidebarOpen)}
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-4">
            {restaurantLogo && (
              <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-border">
                <Image src={restaurantLogo} alt="Restaurant Logo" layout="fill" objectFit="cover" />
              </div>
            )}
             <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">{restaurantName}</h2>
        </div>
      </div>

      <div className={styles.navActions}>
        <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={styles.iconButton}
        >
            <AnimatePresence mode="wait">
                <MotionDiv
                    key={theme}
                    initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                    transition={{ duration: 0.2 }}
                >
                    {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
                </MotionDiv>
            </AnimatePresence>
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={`${styles.profileBtn} ${styles.iconButton}`}
          >
            <User size={22} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <MotionDiv
                className={styles.profileDropdown}
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <div className="p-3">
                  <Label htmlFor="restaurant-status" className="flex items-center justify-between cursor-pointer">
                    <div className="flex flex-col">
                      <span className="font-semibold text-black">Restaurant Status</span>
                       <span className={`text-xs ${restaurantStatus ? 'text-green-500' : 'text-red-500'}`}>
                          {restaurantStatus ? 'Open for orders' : 'Closed'}
                       </span>
                    </div>
                    <Switch
                        id="restaurant-status"
                        checked={restaurantStatus}
                        onCheckedChange={handleStatusToggle}
                        disabled={loadingStatus}
                        aria-label="Toggle restaurant open/closed status"
                    />
                  </Label>
                </div>
                 <div className={styles.dropdownDivider}></div>
                <a href="/owner-dashboard/settings" className={styles.dropdownItem}>
                  <User size={16} /> <span className="font-semibold">Profile</span>
                </a>
                <div className={styles.dropdownDivider}></div>
                <button onClick={handleLogout} className={cn(styles.dropdownItem, styles.logoutButton)}>
                  <span className="font-semibold">Logout</span>
                </button>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
    </>
  );
}
