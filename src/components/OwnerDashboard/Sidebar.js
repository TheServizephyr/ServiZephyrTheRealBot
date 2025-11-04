
'use client';

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
  Package as PackageIcon,
  ConciergeBell,
  CalendarClock,
  MapPin,
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import Link from "next/link";


const getMenuItems = (businessType) => [
  { name: "Dashboard", icon: LayoutDashboard, href: "/owner-dashboard", featureId: "dashboard" },
  { name: "Live Orders", icon: ClipboardList, href: "/owner-dashboard/live-orders", featureId: "live-orders" },
  businessType === 'shop' 
    ? { name: "Items", icon: PackageIcon, href: "/owner-dashboard/menu", featureId: "menu" } 
    : { name: "Menu", icon: Salad, href: "/owner-dashboard/menu", featureId: "menu" },
  { name: "Dine-In", icon: ConciergeBell, href: "/owner-dashboard/dine-in", featureId: "dine-in" },
  { name: "Bookings", icon: CalendarClock, href: "/owner-dashboard/bookings", featureId: "bookings" },
  { name: "Customers", icon: Users, href: "/owner-dashboard/customers", featureId: "customers" },
  { name: "WhatsApp Direct", icon: MessageSquare, href: "/owner-dashboard/whatsapp-direct", featureId: "whatsapp-direct" },
  { name: "Analytics", icon: BarChart2, href: "/owner-dashboard/analytics", featureId: "analytics" },
  { name: "Delivery", icon: Truck, href: "/owner-dashboard/delivery", featureId: "delivery" },
  { name: "Coupons", icon: Ticket, href: "/owner-dashboard/coupons", featureId: "coupons" },
];

const settingsItems = [
    { name: "Location", icon: MapPin, href: "/owner-dashboard/location", featureId: "location" },
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
    const alwaysEnabled = ['menu', 'settings', 'connections', 'payout-settings', 'dine-in', 'bookings', 'whatsapp-direct', 'location'];
    if (alwaysEnabled.includes(featureId)) {
        return false;
    }
    
    if (status === 'pending' || status === 'rejected') {
      return true;
    }

    if (status === 'suspended') {
      return restrictedFeatures.includes(featureId);
    }
    
    return false;
  };

  const menuItems = getMenuItems(businessType);

  return (
    <>
      <div className={`flex items-center shrink-0 border-b border-border justify-between ${isCollapsed ? 'h-[65px] justify-center' : 'h-[65px] px-6'}`}>
        <Link href="/" passHref>
            <div className="flex items-center gap-2 cursor-pointer">
                <Image src="/logo.png" alt="Logo" width={isCollapsed ? 32 : 40} height={isCollapsed ? 32 : 40} />
                {!isCollapsed && <h1 className="text-xl font-bold text-primary">ServiZephyr</h1>}
            </div>
        </Link>
        <button className="hidden md:flex p-2 rounded-full hover:bg-muted" onClick={() => setIsOpen(prev => !prev)}>
            <ChevronLeft className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>
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
    </>
  );
}
