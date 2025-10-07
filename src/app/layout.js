
import { Alegreya, Belleza } from 'next/font/google';
import "./globals.css";
import LayoutWrapper from '@/components/LayoutWrapper';
import { FirebaseClientProvider } from '@/firebase/client-provider';

// Font configuration
const alegreya = Alegreya({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-body',
});

const belleza = Belleza({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-headline',
});

export const metadata = {
  title: "ServiZephyr", // You can change this
  description: "Your restaurant's digital ecosystem.", // You can change this
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${alegreya.variable} ${belleza.variable}`}>
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
