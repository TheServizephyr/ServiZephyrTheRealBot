'use client';

import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Store,
  Users,
  BarChart2,
  Settings,
  MessageSquare,
  ChevronLeft,
  Menu,
  Bell,
  Sun,
  Moon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const SidebarLink = ({ href, icon: Icon, children, isCollapsed }) => {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link href={href} passHref>
      <div
        className={`flex items-center p-3 my-1 rounded-lg cursor-pointer transition-colors ${
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        } ${isCollapsed ? 'justify-center' : ''}`}
      >
        <Icon size={22} />
        {!isCollapsed && <span className="ml-4 font-medium">{children}</span>}
      </div>
    </Link>
  );
};

function AdminLayoutContent({ children }) {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  const isCollapsed = !isSidebarOpen && !isMobile;

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={isMobile ? { x: '-100%' } : { width: '260px' }}
            animate={isMobile ? { x: 0 } : { width: isCollapsed ? '80px' : '260px' }}
            exit={isMobile ? { x: '-100%' } : { width: '80px' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`fixed md:relative h-full z-50 bg-card border-r border-border flex flex-col ${
              isCollapsed ? 'items-center' : ''
            }`}
          >
            <div
              className={`flex items-center shrink-0 border-b border-border ${
                isCollapsed ? 'h-[65px] justify-center' : 'h-[65px] px-6'
              }`}
            >
              {!isCollapsed && <h1 className="text-xl font-bold text-primary">ServiZephyr</h1>}
            </div>
            <nav className="flex-grow p-4 space-y-2">
              <SidebarLink href="/admin/dashboard" icon={LayoutDashboard} isCollapsed={isCollapsed}>
                Dashboard
              </SidebarLink>
              <SidebarLink href="/admin/restaurants" icon={Store} isCollapsed={isCollapsed}>
                Restaurants
              </SidebarLink>
              <SidebarLink href="/admin/users" icon={Users} isCollapsed={isCollapsed}>
                Users
              </SidebarLink>
              <SidebarLink href="/admin/analytics" icon={BarChart2} isCollapsed={isCollapsed}>
                Analytics
              </SidebarLink>
              <SidebarLink href="/admin/community" icon={MessageSquare} isCollapsed={isCollapsed}>
                Community
              </SidebarLink>
              <SidebarLink href="/admin/settings" icon={Settings} isCollapsed={isCollapsed}>
                Settings
              </SidebarLink>
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between h-16 px-6 bg-card border-b border-border shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </Button>
            <h2 className="text-lg font-semibold">Admin Panel</h2>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
            <Button variant="ghost" size="icon">
              <Bell />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src="https://picsum.photos/seed/admin/100/100" alt="@admin" />
                    <AvatarFallback>AD</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">Admin</p>
                    <p className="text-xs leading-none text-muted-foreground">admin@servizephyr.com</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export default function AdminRootLayout({ children }) {
    return (
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
            <AdminLayoutContent>{children}</AdminLayoutContent>
        </ThemeProvider>
    )
}
