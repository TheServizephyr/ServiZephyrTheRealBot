"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import styles from "./OwnerDashboard.module.css";

export default function SidebarLink({ item, isCollapsed }) {
  const pathname = usePathname();
  const isActive = pathname === item.href;

  const linkVariants = {
    expanded: { paddingLeft: "1.25rem", paddingRight: "1.25rem" },
    collapsed: { paddingLeft: "1.5rem", paddingRight: "1.5rem" },
  };

  const iconVariants = {
    expanded: { marginRight: "1rem" },
    collapsed: { marginRight: "0rem" },
  };

  const textVariants = {
    expanded: { opacity: 1, width: "auto" },
    collapsed: { opacity: 0, width: 0 },
  };

  return (
    <Link href={item.href} passHref>
      <motion.div
        variants={linkVariants}
        className={`${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ""}`}
      >
        <motion.div variants={iconVariants}>
            <item.icon className={styles.linkIcon} size={22} />
        </motion.div>
        <motion.span
          variants={textVariants}
          transition={{ duration: 0.2 }}
          className={styles.linkText}
        >
          {item.name}
        </motion.span>
      </motion.div>
    </Link>
  );
}
