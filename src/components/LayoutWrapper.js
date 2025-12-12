'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

const LayoutWrapper = ({ children }) => {
  const pathname = usePathname();
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Update theme-color meta tag dynamically based on current theme
  useEffect(() => {
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
  }, [theme, resolvedTheme]);

  // Define paths where Header and Footer should NOT be shown
  const noLayoutPaths = [
    '/owner-dashboard',
    '/admin-dashboard',
    '/customer-dashboard',
    '/rider-dashboard',
    '/complete-profile',
    '/order',
    '/cart',
    '/checkout',
    '/track',
    '/location',
    '/add-address',
    '/customer-form',
    '/bill',
    '/order/placed',
    '/street-vendor-dashboard',
    '/pre-order',
    '/split-pay'
  ];

  // Check if the current path starts with any of the noLayoutPaths
  const hideLayout = noLayoutPaths.some(path => pathname.startsWith(path));

  // THE FIX: If the main layout is being shown, force the light theme.
  useEffect(() => {
    if (!hideLayout) {
      setTheme('light');
    }
  }, [hideLayout, setTheme]);


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
