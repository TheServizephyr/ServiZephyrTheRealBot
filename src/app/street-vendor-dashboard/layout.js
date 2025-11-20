
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ClipboardList, BarChart3, User, Salad, LogOut, Loader2, Menu, X, QrCode, Banknote, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Suspense, useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { auth } from '@/lib/firebase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import InfoDialog from '@/components/InfoDialog';
import { motion, AnimatePresence } from 'framer-motion';

const navItems = [
  { href: '/street-vendor-dashboard', icon: ClipboardList, label: 'Live Orders' },
  { href: '/street-vendor-dashboard/menu', icon: Salad, label: 'My Menu' },
  { href: '/street-vendor-dashboard/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/street-vendor-dashboard/profile', icon: User, label: 'Profile' },
  { href: '/street-vendor-dashboard/qr', icon: QrCode, label: 'My QR Code' },
  { href: '/street-vendor-dashboard/payout-settings', icon: Banknote, label: 'Payouts' },
];

const NavLink = ({ href, icon: Icon, label, onClick, isCollapsed }) => {
    const pathname = usePathname();
    const isActive = pathname === href;

    return (
        <Link href={href} onClick={onClick} passHref>
             <div className={cn("flex items-center gap-4 p-3 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors", isActive && "bg-primary/10 text-primary font-semibold", isCollapsed && "justify-center")}>
                <Icon className="h-6 w-6 flex-shrink-0" />
                {!isCollapsed && <span className="text-base font-medium">{label}</span>}
            </div>
        </Link>
    )
}

const StreetVendorLayout = ({ children }) => {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const [restaurantStatus, setRestaurantStatus] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if(!mobile) setIsSidebarOpen(true);
      else setIsSidebarOpen(false);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    if (!isUserLoading && user) {
      const fetchStatus = async () => {
        try {
          const idToken = await user.getIdToken();
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
    } else if (!isUserLoading && !user) {
        router.push('/');
    }
  }, [user, isUserLoading, router]);
  
  const handleLogout = async () => {
    await auth.signOut();
    router.push('/');
  };

  const handleStatusToggle = async (newStatus) => {
    setLoadingStatus(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const idToken = await user.getIdToken();
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

  const isCollapsed = !isSidebarOpen && !isMobile;

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-card">
        <div className="flex items-center justify-end h-[65px] px-4 border-b border-border">
            <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                <ChevronLeft className={cn("transition-transform", isCollapsed && "rotate-180")} />
            </Button>
        </div>
        <nav className="flex-grow p-2 mt-4 space-y-2">
            {navItems.map(item => (
                <NavLink key={item.href} {...item} onClick={() => isMobile && setIsSidebarOpen(false)} isCollapsed={isCollapsed} />
            ))}
        </nav>
        <footer className="p-4 border-t border-border">
            {!isCollapsed && (
                <Button onClick={handleLogout} variant="outline" className="w-full">
                    <LogOut className="mr-2 h-4 w-4"/> Logout
                </Button>
            )}
        </footer>
    </div>
  );
  
  if (isUserLoading) {
    return <div className="flex h-screen w-screen items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>;
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
        <InfoDialog
            isOpen={infoDialog.isOpen}
            onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
            title={infoDialog.title}
            message={infoDialog.message}
        />
       
        <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-lg border-b border-border h-[65px] flex-shrink-0">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between h-full">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsSidebarOpen(true)}>
                    <Menu />
                </Button>
                 <Link href="/" className="flex items-center justify-center">
                    <Image src="/logo.png" alt="ServiZephyr Logo" width={140} height={35} className="h-9 w-auto" priority />
                </Link>
            </div>
            <div className="flex items-center gap-4">
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
                                    <span className="font-semibold">Stall Status</span>
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
                        <DropdownMenuItem onClick={() => router.push('/street-vendor-dashboard/profile')} className="cursor-pointer">
                            <User className="mr-2 h-4 w-4"/> Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleLogout} className="text-red-500 font-semibold cursor-pointer">
                            <LogOut className="mr-2 h-4 w-4"/>
                            <span>Logout</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
          </div>
        </header>

        <div className="flex flex-grow overflow-hidden">
            <AnimatePresence>
                {isSidebarOpen && isMobile && (
                    <motion.div 
                        className="fixed inset-0 bg-black/60 z-40 md:hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>
            
            <motion.aside
                className="fixed top-0 left-0 h-full bg-card z-50 flex flex-col md:relative md:h-full"
                animate={isMobile ? { x: isSidebarOpen ? 0 : '-100%' } : { width: isSidebarOpen ? '256px' : '80px' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
                <SidebarContent />
            </motion.aside>

            <main className="flex-grow overflow-y-auto">
                 <Suspense fallback={<div className="min-h-[80vh] flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10"/></div>}>
                    {children}
                </Suspense>
            </main>
        </div>
    </div>
  );
}

export default StreetVendorLayout;
