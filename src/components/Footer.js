import Link from 'next/link'
import { Twitter, Linkedin, Instagram } from 'lucide-react'

const Footer = () => {
  return (
    <footer id="contact" className="bg-card py-8 border-t border-border/40">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">ServiZephyr</h3>
            <p className="mt-2 text-sm text-muted-foreground">Your own WhatsApp ordering bot & growth toolkit.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Quick Links</h3>
            <ul className="mt-2 space-y-2">
              <li><Link href="#features" className="text-sm text-muted-foreground hover:text-primary">Features</Link></li>
              <li><Link href="#pricing" className="text-sm text-muted-foreground hover:text-primary">Pricing</Link></li>
              <li><Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary">Privacy Policy</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Connect With Us</h3>
            <div className="mt-2 flex space-x-4">
              <Link href="#" className="text-muted-foreground hover:text-primary"><Twitter /></Link>
              <Link href="#" className="text-muted-foreground hover:text-primary"><Linkedin /></Link>
              <Link href="#" className="text-muted-foreground hover:text-primary"><Instagram /></Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">contact@servizephyr.com</p>
          </div>
        </div>
        <div className="mt-8 border-t border-border pt-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} ServiZephyr. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

export default Footer
