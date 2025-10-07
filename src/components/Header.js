'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import AuthModal from './AuthModal'

const Header = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur-sm"
      >
        <div className="container mx-auto flex h-20 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center justify-center">
            <Image src="/logo.png" alt="ServiZephyr Logo" width={192} height={64} style={{height: 'auto'}} priority />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <Link href="#product" className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Product
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#features" className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Features
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#pricing" className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Pricing
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#faq" className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              FAQ
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
            <Link href="#contact" className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
              Contact
              <span className="absolute bottom-0 left-0 h-0.5 w-full scale-x-0 bg-primary transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
            </Link>
          </nav>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn-shine inline-flex h-10 items-center justify-center rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Get Started
          </button>
        </div>
      </motion.header>
      <AuthModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  )
}

export default Header
