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
  title: "ServiZephyr - Street Food Vendor Management",
  description: "Unleash the Zephyr of Success. Manage your street food business with ease - orders, menu, payments, and more.",
  keywords: "street food, vendor management, food ordering, restaurant management, online ordering",
  authors: [{ name: "ServiZephyr" }],
  creator: "ServiZephyr",
  publisher: "ServiZephyr",

  // PWA Configuration
  manifest: "/manifest.json",
  themeColor: "#FF6B35",

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
      </head>
      <body>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker,routes`}
          strategy="beforeInteractive"
        />
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />

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
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
