import { Alegreya, Playfair_Display } from 'next/font/google';
import "./globals.css";
import LayoutWrapper from '@/components/LayoutWrapper';
import { FirebaseClientProvider } from '@/firebase/client-provider';

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
