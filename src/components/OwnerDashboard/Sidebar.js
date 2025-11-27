
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
  QrCode,
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import { useSearchParams, usePathname } from 'next/navigation';

const getMenuItems = (businessType, impersonatedOwnerId) => {
  const appendParam = (href) => impersonatedOwnerId ? `${href}?impersonate_owner_id=${impersonatedOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "Live Orders", icon: ClipboardList, href: appendParam("/street-vendor-dashboard"), featureId: "live-orders" },
      { name: "My Menu", icon: Salad, href: appendParam("/street-vendor-dashboard/menu"), featureId: "menu" },
      { name: "Analytics", icon: BarChart2, href: appendParam("/street-vendor-dashboard/analytics"), featureId: "analytics" },
      { name: "My QR Code", icon: QrCode, href: appendParam("/street-vendor-dashboard/qr"), featureId: "qr" },
    ];
  }
  // Default for restaurant/shop
  return [
    { name: "Dashboard", icon: LayoutDashboard, href: appendParam("/owner-dashboard"), featureId: "dashboard" },
    { name: "Live Orders", icon: ClipboardList, href: appendParam("/owner-dashboard/live-orders"), featureId: "live-orders" },
    businessType === 'shop'
      ? { name: "Items", icon: PackageIcon, href: appendParam("/owner-dashboard/menu"), featureId: "menu" }
      : { name: "Menu", icon: Salad, href: appendParam("/owner-dashboard/menu"), featureId: "menu" },
    { name: "Dine-In", icon: ConciergeBell, href: appendParam("/owner-dashboard/dine-in"), featureId: "dine-in" },
    { name: "Bookings", icon: CalendarClock, href: appendParam("/owner-dashboard/bookings"), featureId: "bookings" },
    { name: "Customers", icon: Users, href: appendParam("/owner-dashboard/customers"), featureId: "customers" },
    { name: "WhatsApp Direct", icon: MessageSquare, href: appendParam("/owner-dashboard/whatsapp-direct"), featureId: "whatsapp-direct" },
    { name: "Analytics", icon: BarChart2, href: appendParam("/owner-dashboard/analytics"), featureId: "analytics" },
    { name: "Delivery", icon: Truck, href: appendParam("/owner-dashboard/delivery"), featureId: "delivery" },
    { name: "Coupons", icon: Ticket, href: appendParam("/owner-dashboard/coupons"), featureId: "coupons" },
  ];
};

const getSettingsItems = (businessType, impersonatedOwnerId) => {
  const appendParam = (href) => impersonatedOwnerId ? `${href}?impersonate_owner_id=${impersonatedOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "Profile", icon: Users, href: appendParam("/street-vendor-dashboard/profile"), featureId: "profile" },
      { name: "Payouts", icon: Banknote, href: appendParam("/street-vendor-dashboard/payout-settings"), featureId: "payouts" },
    ];
  }
  return [
    { name: "Location", icon: MapPin, href: appendParam("/owner-dashboard/location"), featureId: "location" },
    { name: "Connections", icon: Bot, href: appendParam("/owner-dashboard/connections"), featureId: "connections" },
    { name: "Payouts", icon: Banknote, href: appendParam("/owner-dashboard/payouts"), featureId: "payouts" },
    { name: "Onboarding", icon: Banknote, href: appendParam("/owner-dashboard/payout-settings"), featureId: "payout-settings" },
    { name: "Settings", icon: Settings, href: appendParam("/owner-dashboard/settings"), featureId: "settings" },
  ];
};


export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed, restrictedFeatures = [], status }) {
  const [businessType, setBusinessType] = useState('restaurant');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  useEffect(() => {
    // If impersonating, infer business type from URL
    if (impersonatedOwnerId) {
      if (pathname.includes('/street-vendor-dashboard')) {
        setBusinessType('street-vendor');
        return;
      } else if (pathname.includes('/shop-dashboard')) {
        setBusinessType('shop');
        return;
      }
      // If on owner-dashboard, it could be restaurant or shop. 
      // We might need to fetch it, but for now default to restaurant or check existing logic.
    }

    const storedBusinessType = localStorage.getItem('businessType');
    if (storedBusinessType) {
      setBusinessType(storedBusinessType);
    }

    const fetchBusinessType = async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          // If impersonating, we shouldn't fetch the ADMIN's business type.
          // But we might want to fetch the IMPERSONATED user's business type if possible.
          // For now, let's skip if impersonating and rely on URL or default.
          if (impersonatedOwnerId) return;

          const userDocRef = doc(db, "users", user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const fetchedType = userDoc.data().businessType || 'restaurant';
            if (fetchedType !== storedBusinessType) {
              setBusinessType(fetchedType);
              localStorage.setItem('businessType', fetchedType);
            }
          }
        } catch (error) {
          console.error("Error fetching business type from Firestore:", error);
          if (!storedBusinessType) setBusinessType('restaurant');
        }
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        fetchBusinessType();
      }
    });

    return () => unsubscribe();
  }, [impersonatedOwnerId, pathname]);

  const getIsDisabled = (featureId) => {
    const alwaysEnabled = ['menu', 'settings', 'connections', 'payout-settings', 'dine-in', 'bookings', 'whatsapp-direct', 'location', 'profile', 'qr'];
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

  const handleLinkClick = () => {
    if (isMobile) {
      setIsOpen(false);
    }
  };

  const menuItems = getMenuItems(businessType, impersonatedOwnerId);
  const settingsItems = getSettingsItems(businessType, impersonatedOwnerId);


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
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={item}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
              />
            </div>
          ))}
        </div>
        <div className={styles.menuGroup}>
          <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>General</span>
          {settingsItems.map((item) => (
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={item}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
              />
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
