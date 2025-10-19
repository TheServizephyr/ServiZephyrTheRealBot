

"use client";

import {
  LayoutDashboard,
  ClipboardList,
  Users,
  BarChart2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Salad,
  Truck,
  Ticket,
  Lock,
  Bot,
  MessageSquare,
  Banknote,
  Package as PackageIcon // Using an alias to avoid name conflicts
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';


const getMenuItems = (businessType) => [
  { name: "Dashboard", icon: LayoutDashboard, href: "/owner-dashboard", featureId: "dashboard" },
  { name: "Live Orders", icon: ClipboardList, href: "/owner-dashboard/live-orders", featureId: "live-orders" },
  businessType === 'shop' 
    ? { name: "Items", icon: PackageIcon, href: "/owner-dashboard/menu", featureId: "menu" } 
    : { name: "Menu", icon: Salad, href: "/owner-dashboard/menu", featureId: "menu" },
  { name: "Customers", icon: Users, href: "/owner-dashboard/customers", featureId: "customers" },
  { name: "Analytics", icon: BarChart2, href: "/owner-dashboard/analytics", featureId: "analytics" },
  { name: "Delivery", icon: Truck, href: "/owner-dashboard/delivery", featureId: "delivery" },
  { name: "Coupons", icon: Ticket, href: "/owner-dashboard/coupons", featureId: "coupons" },
];

const settingsItems = [
    { name: "Connections", icon: Bot, href: "/owner-dashboard/connections", featureId: "connections" },
    { name: "Payouts", icon: Banknote, href: "/owner-dashboard/payouts", featureId: "payouts" },
    { name: "Onboarding", icon: Settings, href: "/owner-dashboard/payout-settings", featureId: "payout-settings" },
    { name: "Settings", icon: Settings, href: "/owner-dashboard/settings", featureId: "settings" },
];


export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed, restrictedFeatures = [], status }) {
  const [businessType, setBusinessType] = useState('restaurant'); // Default to restaurant

  useEffect(() => {
    // --- THE FIX ---
    // First, try to get the businessType from localStorage for a faster UI response.
    // This is crucial after the user completes their profile and is redirected.
    const storedBusinessType = localStorage.getItem('businessType');
    if (storedBusinessType) {
      setBusinessType(storedBusinessType);
    }

    const fetchBusinessType = async () => {
      const user = auth.currentUser;
      if (user) {
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const fetchedType = userDoc.data().businessType || 'restaurant';
                if (fetchedType !== storedBusinessType) {
                  setBusinessType(fetchedType);
                  // Also update localStorage to keep it in sync
                  localStorage.setItem('businessType', fetchedType);
                }
            }
        } catch (error) {
            console.error("Error fetching business type from Firestore:", error);
            // Fallback to default if Firestore fails but localStorage had a value
            if (!storedBusinessType) setBusinessType('restaurant');
        }
      }
    };
    
    // Auth listener to trigger fetch
    const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
            fetchBusinessType();
        }
    });

    return () => unsubscribe();
  }, []);

  const getIsDisabled = (featureId) => {
    if (status === 'pending' || status === 'rejected') {
      return !['menu', 'settings', 'connections', 'payout-settings'].includes(featureId);
    }
    if (status === 'suspended') {
      return restrictedFeatures.includes(featureId);
    }
    return false;
  };

  const menuItems = getMenuItems(businessType);

  return (
    <aside
      className={`${styles.sidebar} ${isOpen ? styles.open : ''} ${isCollapsed ? styles.collapsed : ''}`}
    >

      {!isMobile && (
        <button
            className={styles.collapseBtn}
            onClick={() => setIsOpen(prev => !prev)}
        >
             <motion.div
                key={isCollapsed ? 'menu' : 'close'}
                initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
             >
                {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </motion.div>
        </button>
      )}
      
       <div className={styles.sidebarHeader}>
       </div>

      <nav className={styles.sidebarNav}>
        <div className={styles.menuGroup}>
            <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>Menu</span>
            {menuItems.map((item) => (
              <SidebarLink 
                key={item.name} 
                item={item} 
                isCollapsed={isCollapsed} 
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
              />
            ))}
        </div>
        <div className={styles.menuGroup}>
            <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>General</span>
            {settingsItems.map((item) => (
                 <SidebarLink 
                    key={item.name}
                    item={item} 
                    isCollapsed={isCollapsed} 
                    isDisabled={getIsDisabled(item.featureId)}
                    disabledIcon={Lock}
                />
            ))}
        </div>
      </nav>
      
    </aside>
  );
}
