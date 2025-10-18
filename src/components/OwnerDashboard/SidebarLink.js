
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import styles from "./OwnerDashboard.module.css";
import { cn } from "@/lib/utils";


export default function SidebarLink({ item, isCollapsed, isDisabled, disabledIcon: DisabledIcon }) {
  const pathname = usePathname();
  const isActive = pathname === item.href;

  const textVariants = {
    expanded: { opacity: 1, width: "auto", transition: { duration: 0.2, delay: 0.1 } },
    collapsed: { opacity: 0, width: 0, transition: { duration: 0.1 } },
  };
  
  return (
      <Link href={item.href} passHref legacyBehavior>
          <a
            className={cn(
                styles.sidebarLink,
                isActive && !isDisabled && styles.sidebarLinkActive,
                isDisabled && 'opacity-50 cursor-not-allowed',
                isCollapsed && styles.sidebarLinkCollapsed,
            )}
            title={isDisabled ? `${item.name} is currently restricted` : item.name}
          >
              <div className={styles.sidebarLinkInner}>
                <div className={cn(styles.linkIcon, isCollapsed && styles.collapsedIcon)}>
                    {isDisabled && DisabledIcon ? (
                        <DisabledIcon size={22} />
                    ) : (
                        <item.icon size={22} />
                    )}
                </div>
                <motion.span
                  variants={textVariants}
                  animate={isCollapsed ? "collapsed" : "expanded"}
                  className={styles.linkText}
                >
                  {item.name}
                </motion.span>
              </div>
          </a>
      </Link>
  );
}
