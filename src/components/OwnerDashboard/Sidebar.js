
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
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/owner-dashboard", featureId: "dashboard" },
  { name: "Live Orders", icon: ClipboardList, href: "/owner-dashboard/live-orders", featureId: "live-orders" },
  { name: "Menu", icon: Salad, href: "/owner-dashboard/menu", featureId: "menu" },
  { name: "Customers", icon: Users, href: "/owner-dashboard/customers", featureId: "customers" },
  { name: "Analytics", icon: BarChart2, href: "/owner-dashboard/analytics", featureId: "analytics" },
  { name: "Delivery", icon: Truck, href: "/owner-dashboard/delivery", featureId: "delivery" },
  { name: "Coupons", icon: Ticket, href: "/owner-dashboard/coupons", featureId: "coupons" },
];

const settingsItem = {
  name: "Settings",
  icon: Settings,
  href: "/owner-dashboard/settings",
  featureId: "settings"
};

export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed, restrictedFeatures = [], status }) {

  const getIsDisabled = (featureId) => {
    // If restaurant is pending or rejected, only menu and settings are enabled.
    if (status === 'pending' || status === 'rejected') {
      return featureId !== 'menu' && featureId !== 'settings';
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
            {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      )}

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
            <SidebarLink 
              item={settingsItem} 
              isCollapsed={isCollapsed} 
              isDisabled={getIsDisabled(settingsItem.featureId)}
              disabledIcon={Lock}
            />
        </div>
      </nav>
      
    </aside>
  );
}
