
"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Bell, User, Sun, Moon, Menu } from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import { useTheme } from "next-themes";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export default function Navbar({ isSidebarOpen, setSidebarOpen }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await auth.signOut();
      localStorage.removeItem('role');
      router.push('/');
    } catch (error) {
      console.error("Logout failed:", error);
      alert("Could not log out. Please try again.");
    }
  };


  return (
    <header className={styles.navbar}>
      <div className={styles.navLeft}>
        <button
          className={`${styles.iconButton} md:hidden`}
          onClick={() => setSidebarOpen(!isSidebarOpen)}
        >
          <Menu size={22} />
        </button>
        <div className="hidden md:block">
            <Image src="/logo.png" alt="Logo" width={150} height={40} />
        </div>
        {/* Search Bar */}
        <div className={styles.searchBar}>
            <Search className={styles.searchIcon} size={20} />
            <input type="text" placeholder="Search..." />
        </div>
      </div>

      {/* Right side actions */}
      <div className={styles.navActions}>
        <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={styles.iconButton}
        >
            <AnimatePresence mode="wait">
                <motion.div
                    key={theme}
                    initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                    transition={{ duration: 0.2 }}
                >
                    {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
                </motion.div>
            </AnimatePresence>
        </button>

        <button className={styles.iconButton}>
          <Bell size={22} />
        </button>

        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={`${styles.profileBtn} ${styles.iconButton}`}
          >
            <User size={22} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                className={styles.profileDropdown}
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <a href="/owner-dashboard/settings" className={styles.dropdownItem}>
                  <User size={16} /> Profile
                </a>
                <div className={styles.dropdownDivider}></div>
                <button onClick={handleLogout} className={cn(styles.dropdownItem, styles.logoutButton)}>
                  Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
