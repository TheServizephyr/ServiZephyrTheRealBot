import { Alegreya, Playfair_Display } from 'next/font/google';
import "./globals.css";
import LayoutWrapper from '@/components/LayoutWrapper';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import Script from 'next/script';

// Font configuration
const alegreya = Alegreya({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-body',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-headline',
});

export const metadata = {
  title: "ServiZephyr",
  description: "Unleash the Zephyr of Success.",
};

export default function RootLayout({ children }) {
  const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return (
    <html lang="en" className={`${alegreya.variable} ${playfairDisplay.variable}`} suppressHydrationWarning>
       <head>
       </head>
       <body>
        <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker,routes`}
            strategy="beforeInteractive"
         />
         <Script src="https://checkout.razorpay.com/v1/checkout.js" />
        <FirebaseClientProvider>
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
