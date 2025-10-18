
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
  X,
  Menu
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';


const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/owner-dashboard", featureId: "dashboard" },
  { name: "Live Orders", icon: ClipboardList, href: "/owner-dashboard/live-orders", featureId: "live-orders" },
  { name: "Menu", icon: Salad, href: "/owner-dashboard/menu", featureId: "menu" },
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

  const getIsDisabled = (featureId) => {
    // If restaurant is pending or rejected, only menu and settings are enabled.
    if (status === 'pending' || status === 'rejected') {
      return !['menu', 'settings', 'connections', 'payout-settings'].includes(featureId);
    }
    // If suspended, check the restrictedFeatures list.
    if (status === 'suspended') {
      return restrictedFeatures.includes(featureId);
    }
    // If approved or any other status, nothing is disabled.
    return false;
  };

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
                {isCollapsed ? <Menu size={20} /> : <X size={20} />}
            </motion.div>
        </button>
      )}
      
       <div className={styles.sidebarHeader}>
          {/* This div is now mainly for spacing to accommodate the new button position */}
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
