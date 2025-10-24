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
  return (
    <html lang="en" className={`${alegreya.variable} ${playfairDisplay.variable}`}>
       <head>
         <Script src="https://apis.mappls.com/advancedmaps/api/29124d05-c991-454d-910a-806917d2b45e/map_sdk?layer=vector&v=3.0&callback=initMap" strategy="beforeInteractive" />
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
