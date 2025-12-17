
'use client';

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { User, Sun, Moon, Menu, UserCheck } from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import { useTheme } from "next-themes";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import InfoDialog from "@/components/InfoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUser } from '@/firebase';


const MotionDiv = motion.div;

export default function Navbar({ isSidebarOpen, setSidebarOpen, restaurantName, restaurantLogo, userRole }) {
  const [restaurantStatus, setRestaurantStatus] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const { user } = useUser();

  useEffect(() => {
    const fetchStatus = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (res.ok) {
          const data = await res.json();
          setRestaurantStatus(data.isOpen);
        }
      } catch (error) {
        console.error("Failed to fetch restaurant status:", error);
      } finally {
        setLoadingStatus(false);
      }
    };
    fetchStatus();
  }, []);


  const handleLogout = async () => {
    try {
      await auth.signOut();
      localStorage.clear();
      router.push('/');
    } catch (error) {
      console.error("Logout failed:", error);
      setInfoDialog({ isOpen: true, title: "Error", message: "Could not log out. Please try again." });
    }
  };

  const handleStatusToggle = async (newStatus) => {
    setLoadingStatus(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not authenticated");
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ isOpen: newStatus })
      });
      if (!res.ok) throw new Error("Failed to update status");
      setRestaurantStatus(newStatus);
    } catch (error) {
      setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
    } finally {
      setLoadingStatus(false);
    }
  };

  return (
    <>
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <button
            className={`${styles.iconButton} md:hidden`}
            onClick={() => setSidebarOpen(!isSidebarOpen)}
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-4">
            {restaurantLogo && (
              <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-border">
                <Image src={restaurantLogo} alt="Restaurant Logo" layout="fill" objectFit="cover" />
              </div>
            )}
            <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">{restaurantName}</h2>
          </div>
          {/* Role Badge - Owner or Employee */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${userRole ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            <UserCheck className={`h-4 w-4 ${userRole ? 'text-blue-500' : 'text-amber-500'}`} />
            <span className={`text-xs sm:text-sm font-semibold capitalize ${userRole ? 'text-blue-500' : 'text-amber-500'}`}>
              {userRole || 'Owner'}
            </span>
          </div>
        </div>

        <div className={styles.navActions}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={styles.iconButton}
          >
            <AnimatePresence mode="wait">
              <MotionDiv
                key={theme}
                initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                transition={{ duration: 0.2 }}
              >
                {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
              </MotionDiv>
            </AnimatePresence>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar>
                  <AvatarImage src={user?.photoURL} alt={user?.displayName || 'User'} />
                  <AvatarFallback>{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end">
              <DropdownMenuLabel>
                <p className="font-semibold">{user?.displayName}</p>
                <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2">
                <Label htmlFor="restaurant-status-header" className="flex items-center justify-between cursor-pointer">
                  <div className="flex flex-col">
                    <span className="font-semibold">Restaurant Status</span>
                    <span className={cn("text-xs", restaurantStatus ? 'text-green-500' : 'text-red-500')}>
                      {restaurantStatus ? 'Open for orders' : 'Closed'}
                    </span>
                  </div>
                  <Switch
                    id="restaurant-status-header"
                    checked={restaurantStatus}
                    onCheckedChange={handleStatusToggle}
                    disabled={loadingStatus}
                    aria-label="Toggle restaurant open/closed status"
                  />
                </Label>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/owner-dashboard/settings')} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-500 font-semibold cursor-pointer">
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}
