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
  const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;
  return (
    <html lang="en" className={`${alegreya.variable} ${playfairDisplay.variable}`}>
       <head>
         <link rel="stylesheet" href={`https://apis.mappls.com/advancedmaps/api/${MAPPLS_API_KEY}/map_sdk_v3.0.css`} />
         <Script src={`https://apis.mappls.com/advancedmaps/api/${MAPPLS_API_KEY}/map_sdk?layer=vector&v=3.0&callback=initMap`} strategy="beforeInteractive" />
       </head>
       <body>
        <FirebaseClientProvider>
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
