'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Home, Map, MessageSquare, User, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Suspense, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ThemeProvider } from '@/components/ThemeProvider';
import ThemeColorUpdater from '@/components/ThemeColorUpdater';
import Image from 'next/image';
import { useUser } from '@/firebase';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import ImpersonationBanner from '@/components/ImpersonationBanner';

const navItems = [
  { href: '/customer-dashboard', icon: Home, label: 'My Hub' },
  { href: '/customer-dashboard/discover', icon: Map, label: 'Discover' },
  { href: '/customer-dashboard/community', icon: MessageSquare, label: 'Community' },
  { href: '/customer-dashboard/profile', icon: User, label: 'Profile' },
];

const NavLink = ({ href, icon: Icon, label }) => {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/customer-dashboard' && pathname.startsWith(href));

  return (
    <Link href={href} className="flex flex-col items-center justify-center gap-1 flex-1 text-muted-foreground hover:text-primary transition-colors">
      <Icon className={cn("h-6 w-6", isActive && "text-primary")} />
      <span className={cn("text-xs font-medium", isActive && "text-primary")}>{label}</span>
    </Link>
  )
}

const CustomerDashboardContent = ({ children }) => {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/');
    }
  }, [user, isUserLoading, router]);

  // Log impersonation when detected
  useEffect(() => {
    const impersonateUserId = searchParams.get('impersonate_user_id');
    if (user && impersonateUserId) {
      user.getIdToken().then(idToken => {
        fetch('/api/admin/log-impersonation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            targetUserId: impersonateUserId,
            targetUserEmail: user.email,
            targetUserRole: 'Customer',
            action: 'start_impersonation_customer'
          })
        }).catch(err => console.error('Failed to log impersonation:', err));
      });
    }
  }, [user, searchParams]);

  if (isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <>
      <ImpersonationBanner vendorName={user?.displayName || user?.email || 'Customer'} />
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center justify-center">
              <Image src="/logo.png" alt="ServiZephyr Logo" width={140} height={35} className="h-9 w-auto" priority />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
          </div>
        </header>
        <main className="flex-grow pb-24">
          <Suspense fallback={<div className="min-h-[80vh] flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            {children}
          </Suspense>
        </main>
        <footer className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50">
          <div className="container mx-auto px-4 h-20 flex items-center justify-around">
            {navItems.map(item => (
              <NavLink key={item.href} {...item} />
            ))}
          </div>
        </footer>
      </div>
    </>
  );
}

export default function CustomerDashboardLayout({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorUpdater />
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><GoldenCoinSpinner /></div>}>
        <CustomerDashboardContent>{children}</CustomerDashboardContent>
      </Suspense>
    </ThemeProvider>
  )
}
