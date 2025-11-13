'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const LayoutWrapper = ({ children }) => {
  const pathname = usePathname();

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
    '/pre-order' // Added this line
  ];

  // Check if the current path starts with any of the noLayoutPaths
  const hideLayout = noLayoutPaths.some(path => pathname.startsWith(path));

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
