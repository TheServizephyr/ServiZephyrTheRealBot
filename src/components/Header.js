'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname();
  const loginHref = pathname && pathname !== '/' ? `/login?redirect=${encodeURIComponent(pathname)}` : '/login';

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        className={cn(
          "sticky top-0 z-50 w-full border-b bg-white/92 backdrop-blur-xl transition-all duration-300",
          isScrolled ? "border-amber-200 shadow-sm shadow-amber-100/60" : "border-transparent"
        )}
      >
        <div className="container mx-auto flex h-20 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center justify-center">
            <Image src="/logo.png" alt="ServiZephyr Logo" width={180} height={45} className="h-12 w-auto" priority />
          </Link>
          <nav className="hidden items-center justify-evenly flex-1 md:flex">
            <Link href="#product" className="group relative text-sm font-medium text-slate-600 transition-colors hover:text-primary">
              Product
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#features" className="group relative text-sm font-medium text-slate-600 transition-colors hover:text-primary">
              Features
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#pricing" className="group relative text-sm font-medium text-slate-600 transition-colors hover:text-primary">
              Pricing
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#faq" className="group relative text-sm font-medium text-slate-600 transition-colors hover:text-primary">
              FAQ
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#contact" className="group relative text-sm font-medium text-slate-600 transition-colors hover:text-primary">
              Contact
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
          </nav>
          <Link
            href={loginHref}
            className="btn-shine inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Get Started
          </Link>
        </div>
      </motion.header>
    </>
  )
}

export default Header
