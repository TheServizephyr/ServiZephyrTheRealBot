'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, BarChart3, User, Bot, Salad } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Image from 'next/image';

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
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-lg border-b border-border">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
             <Link href="/" className="flex items-center justify-center">
                <Image src="/logo.png" alt="ServiZephyr Logo" width={140} height={35} className="h-9 w-auto" priority />
            </Link>
            <div className="flex items-center gap-2">
                <Link href="/street-vendor-dashboard/menu" passHref>
                    <Button variant="outline" className="flex items-center gap-2">
                        <Salad size={16}/>
                        <span className="hidden sm:inline">My Menu</span>
                    </Button>
                </Link>
                <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-full bg-primary/10 text-primary border border-primary/20">
                    <Bot size={16} />
                    <span>Vendor Mode</span>
                </div>
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
