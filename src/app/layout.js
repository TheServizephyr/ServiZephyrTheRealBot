import { Alegreya, Playfair_Display } from 'next/font/google';
import "./globals.css";
import LayoutWrapper from '@/components/LayoutWrapper';
import PWARecoveryHandler from '@/components/PWARecoveryHandler';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import RedirectHandler from '@/components/RedirectHandler';
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
  title: "ServiZephyr | Founded by Ashwani Baghel - Restaurant Management",
  description: "ServiZephyr - AI-powered restaurant management platform founded by Ashwani Baghel. Streamline orders, payments, dine-in operations & delivery management.",
  keywords: "restaurant management, food ordering system, dine-in management, delivery management, online ordering for restaurants, restaurant POS, food business automation, restaurant software India",
  authors: [{ name: "ServiZephyr" }],
  creator: "ServiZephyr",
  publisher: "ServiZephyr",

  // PWA Configuration
  manifest: "/manifest.json",

  // Icons and Favicons
  icons: {
    icon: [
      { url: "/logo.png", sizes: "any" },
      { url: "/logo.png", sizes: "192x192", type: "image/png" },
      { url: "/logo.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/logo.png", sizes: "180x180", type: "image/png" },
    ],
  },

  // Apple Mobile Web App
  appleWebApp: {
    capable: true,
    title: "ServiZephyr",
    statusBarStyle: "black-translucent",
  },

  // Custom meta tags
  other: {
    'mobile-web-app-capable': 'yes',
  },

  // Open Graph (Facebook, LinkedIn)
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://servizephyr.com",
    siteName: "ServiZephyr",
    title: "ServiZephyr - Street Food Vendor Management",
    description: "Unleash the Zephyr of Success. Manage your street food business with ease.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "ServiZephyr Logo",
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "ServiZephyr - Street Food Vendor Management",
    description: "Unleash the Zephyr of Success. Manage your street food business with ease.",
    images: ["/logo.png"],
  },

  // Viewport
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
  },
};

export default function RootLayout({ children }) {
  const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return (
    <html lang="en" className={`${alegreya.variable} ${playfairDisplay.variable}`} suppressHydrationWarning>
      <head>
        {/* Dynamic theme-color based on color scheme */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
      </head>
      <body>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker,routes`}
          strategy="beforeInteractive"
        />
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />

        {/* Production: Silence Console Logs */}
        <Script id="console-silencer" strategy="beforeInteractive">
          {`
            if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
              console.log = function() {};
              console.warn = function() {};
              console.info = function() {};
              console.debug = function() {};
              // Keep console.error for debugging critical issues
            }
          `}
        </Script>

        {/* PWA Service Worker Registration */}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/service-worker.js')
                  .then(function(registration) {
                    console.log('[SW] Registration successful:', registration.scope);
                  })
                  .catch(function(error) {
                    console.log('[SW] Registration failed:', error);
                  });
              });
            }
          `}
        </Script>


        <FirebaseClientProvider>
          <PWARecoveryHandler />
          <GlobalHapticHandler />
          <RedirectHandler />
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
