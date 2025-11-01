

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./AuthModal.module.css";
import { X } from "lucide-react";

// --- START: CORRECT FIREBASE IMPORT ---
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup } from "firebase/auth";
// --- END: CORRECT FIREBASE IMPORT ---


export default function AuthModal({ isOpen, onClose }) {
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(""); // info, success, error
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => (document.body.style.overflow = "auto");
  }, [isOpen]);
  

  const resetForm = () => {
    setMsg("");
    setMsgType("");
    setLoading(false);
  };

  const closeModal = () => {
    resetForm();
    onClose();
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setMsg("Opening Google sign-in...");
    setMsgType("info");
    console.log("[DEBUG] AuthModal: handleGoogleLogin started.");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      console.log("[DEBUG] AuthModal: Google sign-in successful. User:", user.email);
      
      setMsg("Verifying user details...");
      
      // Correctly check the user's role from our backend
      const idToken = await user.getIdToken();
      console.log("[DEBUG] AuthModal: Got ID token. Calling /api/auth/check-role...");
      const res = await fetch('/api/auth/check-role', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${idToken}`,
          },
      });
  
      const data = await res.json();
      console.log(`[DEBUG] AuthModal: Received response from check-role API. Status: ${res.status}, Data:`, data);
  
      if (!res.ok) {
          // If the backend returns a 404, it's a new user.
          if(res.status === 404) {
               console.log("[DEBUG] AuthModal: User not found (404), treating as new user.");
               setMsg("✅ New user detected! Redirecting to complete your profile...");
               setMsgType("success");
               localStorage.setItem("role", "none"); 
               setTimeout(() => {
                 closeModal();
                 router.push("/complete-profile");
               }, 1500);
               return;
          }
          // For any other error, display it.
          throw new Error(data.message || 'Failed to verify user role.');
      }
      
      // If the response is OK, the backend found a role.
      const { role, businessType } = data;
      console.log(`[DEBUG] AuthModal: Role found: '${role}', BusinessType: '${businessType}'. Redirecting...`);
      setMsg(`✅ Login successful! Redirecting to ${role} dashboard...`);
      setMsgType("success");
      localStorage.setItem("role", role);
      if (businessType) {
        localStorage.setItem("businessType", businessType);
      }
  
      setTimeout(() => {
        closeModal();
        // --- START THE FIX ---
        if (role === "owner" || role === "restaurant-owner" || role === "shop-owner") {
          console.log("[DEBUG] AuthModal: Redirecting to /owner-dashboard.");
          router.push("/owner-dashboard");
        } else if (role === "admin") {
          console.log("[DEBUG] AuthModal: Redirecting to /admin-dashboard.");
          router.push("/admin-dashboard");
        } else if (role === "rider") {
          console.log("[DEBUG] AuthModal: Redirecting to /rider-dashboard.");
          router.push("/rider-dashboard");
        } else {
          console.log("[DEBUG] AuthModal: Redirecting to /customer-dashboard.");
          router.push("/customer-dashboard");
        }
        // --- END THE FIX ---
      }, 1500);
  
    } catch (err) {
        let errorMessage = "An unexpected error occurred. Please try again.";
        if (err.code) {
            switch (err.code) {
                case 'auth/popup-closed-by-user':
                    errorMessage = 'Sign-in popup closed before completion.';
                    break;
                case 'auth/cancelled-popup-request':
                    errorMessage = 'Multiple sign-in attempts detected. Please try again.';
                    break;
                case 'auth/permission-denied':
                    errorMessage = 'This domain is not authorized. Please contact support.';
                    break;
                default:
                    errorMessage = `Error: ${err.code}. Please try again.`;
            }
        } else {
            errorMessage = err.message;
        }
        console.error("[DEBUG] AuthModal: Login failed.", err);
        setMsg(`❌ Login Failed: ${errorMessage}`);
        setMsgType("error");
        setLoading(false);
    }
  };


  const renderContent = () => {
    return (
      <div className={styles.form}>
        <h2 className={styles.title}>Welcome to ServiZephyr</h2>
        <p className={styles.infoText}>The easiest way to manage your restaurant. Please sign in to continue.</p>
        
        <button className={styles.btn} onClick={handleGoogleLogin} disabled={loading}>
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
            <button onClick={closeModal} className={styles.closeBtn}><X size={24}/></button>
            
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

            {msg && (
              <motion.p 
                className={`${styles.msg} ${msgType === "success" ? styles.msgSuccess : msgType === "error" ? styles.msgError : styles.msgInfo}`} 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ duration: 0.2 }}
              >
                {loading && <span className={styles.spinner}></span>}
                {msg}
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
