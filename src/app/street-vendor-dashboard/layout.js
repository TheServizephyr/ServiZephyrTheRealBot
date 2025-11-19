'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ClipboardList, BarChart3, User, Bot, Salad, LogOut, Loader2 } from 'lucide-react';
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


const navItems = [
  { href: '/street-vendor-dashboard', icon: ClipboardList, label: 'Live Orders' },
  { href: '/street-vendor-dashboard/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/street-vendor-dashboard/profile', icon: User, label: 'Profile' },
];

const NavLink = ({ href, icon: Icon, label }) => {
    const pathname = usePathname();
    const isActive = pathname === href;

    return (
        <Link href={href} className="flex flex-col items-center justify-center gap-1 flex-1 text-muted-foreground hover:text-primary transition-colors">
            <Icon className={cn("h-6 w-6", isActive && "text-primary")} />
            <span className={cn("text-xs font-medium", isActive && "text-primary")}>{label}</span>
        </Link>
    )
}

const StreetVendorLayout = ({ children }) => {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const [restaurantStatus, setRestaurantStatus] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

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
    }
  }, [user, isUserLoading]);
  
  const handleLogout = async () => {
    await auth.signOut();
    router.push('/');
  };

  const handleStatusToggle = async (newStatus) => {
    setLoadingStatus(true);
    try {
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
        <InfoDialog
            isOpen={infoDialog.isOpen}
            onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
            title={infoDialog.title}
            message={infoDialog.message}
        />
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-lg border-b border-border">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
             <Link href="/" className="flex items-center justify-center">
                <Image src="/logo.png" alt="ServiZephyr Logo" width={140} height={35} className="h-9 w-auto" priority />
            </Link>
            <div className="flex items-center gap-4">
                <Link href="/street-vendor-dashboard/menu" passHref>
                    <Button variant="outline" className="flex items-center gap-2">
                        <Salad size={16}/>
                        <span className="hidden sm:inline">My Menu</span>
                    </Button>
                </Link>
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
                          <Label htmlFor="restaurant-status" className="flex items-center justify-between cursor-pointer">
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground">Stall Status</span>
                              <span className={`text-xs ${restaurantStatus ? 'text-green-500' : 'text-red-500'}`}>
                                  {restaurantStatus ? 'Open for orders' : 'Closed'}
                              </span>
                            </div>
                            <Switch
                                id="restaurant-status"
                                checked={restaurantStatus}
                                onCheckedChange={handleStatusToggle}
                                disabled={loadingStatus}
                                aria-label="Toggle restaurant open/closed status"
                            />
                          </Label>
                        </div>
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
        <main className="flex-grow pb-24">
             <Suspense fallback={<div className="min-h-[80vh] flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10"/></div>}>
                {children}
            </Suspense>
        </main>
        <footer className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
            <div className="container mx-auto px-4 h-20 flex items-center justify-around">
                {navItems.map(item => (
                    <NavLink key={item.href} {...item} />
                ))}
            </div>
        </footer>
    </div>
  );
}

export default StreetVendorLayout;
