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
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/owner-dashboard" },
  { name: "Live Orders", icon: ClipboardList, href: "/owner-dashboard/live-orders" },
  { name: "Menu", icon: Salad, href: "/owner-dashboard/menu" },
  { name: "Customers", icon: Users, href: "/owner-dashboard/customers" },
  { name: "Analytics", icon: BarChart2, href: "/owner-dashboard/analytics" },
  { name: "Delivery", icon: Truck, href: "/owner-dashboard/delivery" },
  { name: "Coupons", icon: Ticket, href: "/owner-dashboard/coupons" },
];

const settingsItem = {
  name: "Settings",
  icon: Settings,
  href: "/owner-dashboard/settings",
};

export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed }) {

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
              <SidebarLink key={item.name} item={item} isCollapsed={isCollapsed} />
            ))}
        </div>
        <div className={styles.menuGroup}>
            <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>General</span>
            <SidebarLink item={settingsItem} isCollapsed={isCollapsed} />
        </div>
      </nav>
      
    </aside>
  );
}
