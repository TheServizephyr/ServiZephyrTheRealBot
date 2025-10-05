
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
    '/complete-profile',
    '/order',
    '/customer-form',
    '/bill'
  ];

  // Check if the current path starts with any of the noLayoutPaths
  const hideLayout = noLayoutPaths.some(path => pathname.startsWith(path));

  if (hideLayout) {
    return <main className="flex-grow">{children}</main>;
  }

  return (
    <>
      <Header />
      <main className="flex-grow">{children}</main>
      <Footer />
    </>
  );
};

export default LayoutWrapper;
