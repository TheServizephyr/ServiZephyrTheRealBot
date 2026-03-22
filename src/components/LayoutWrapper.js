'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

const HIDE_LAYOUT_EXACT_PATHS = new Set([
  '/login',
  '/complete-profile',
  '/select-role',
  '/join',
  '/cart',
  '/checkout',
  '/location',
  '/add-address',
  '/customer-form',
  '/about',
  '/contact',
]);

const HIDE_LAYOUT_PREFIXES = [
  '/owner-dashboard',
  '/admin-dashboard',
  '/customer-dashboard',
  '/rider-dashboard',
  '/order',
  '/track',
  '/bill',
  '/street-vendor-dashboard',
  '/pre-order',
  '/split-pay',
  '/public',
];

const LayoutWrapper = ({ children }) => {
  const pathname = usePathname();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Wait for client-side mount before checking theme
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update theme-color meta tag dynamically based on current theme
  useEffect(() => {
    if (!mounted) return; // Wait for mount before updating

    const currentTheme = resolvedTheme || theme;
    const themeColor = currentTheme === 'dark' ? '#0a0a0a' : '#ffffff';

    // Find existing theme-color meta tags and update them
    const metaTags = document.querySelectorAll('meta[name="theme-color"]');
    metaTags.forEach(tag => {
      tag.setAttribute('content', themeColor);
    });

    // If no meta tag exists, create one
    if (metaTags.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeColor;
      document.head.appendChild(meta);
    }
  }, [mounted, theme, resolvedTheme]);

  const hideLayout = useMemo(() => {
    if (!pathname) return false;
    if (HIDE_LAYOUT_EXACT_PATHS.has(pathname)) return true;
    return HIDE_LAYOUT_PREFIXES.some((pathPrefix) => pathname.startsWith(pathPrefix));
  }, [pathname]);




  if (hideLayout) {
    return <main className="flex-grow">{children}</main>;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
};

export default LayoutWrapper;
