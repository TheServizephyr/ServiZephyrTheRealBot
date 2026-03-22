"use client";

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./AuthModal.module.css";
import { X } from "lucide-react";

export default function AuthModal({ isOpen, onClose }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => (document.body.style.overflow = "auto");
  }, [isOpen]);

  const redirectUrl = useMemo(() => {
    if (typeof window === "undefined") return "/login";
    const currentPath = `${window.location.pathname || "/"}${window.location.search || ""}`;
    const params = new URLSearchParams();
    if (currentPath && currentPath !== "/") {
      params.set("redirect", currentPath);
    }
    const query = params.toString();
    return query ? `/login?${query}` : "/login";
  }, []);

  const closeModal = () => {
    onClose();
  };

  const handleGoogleLogin = async () => {
    window.location.href = redirectUrl;
  };

  const renderContent = () => {
    return (
      <div className={styles.form}>
        <h2 className={styles.title}>Welcome to ServiZephyr</h2>
        <p className={styles.infoText}>The easiest way to manage your restaurant. Please sign in to continue.</p>

        <button className={styles.btn} onClick={handleGoogleLogin}>
          Continue with Google
        </button>

        <p className={styles.switchText}>By continuing, you agree to our Terms of Service and Privacy Policy.</p>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal}>
          <motion.div className={styles.card} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={closeModal} className={styles.closeBtn}><X size={24} /></button>

            <AnimatePresence mode="wait">
              <motion.div
                key="google-login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
