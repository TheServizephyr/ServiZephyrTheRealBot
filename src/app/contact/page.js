'use client';

import { Mail, Phone } from 'lucide-react';

export default function ContactPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Contact Us</h1>
        <div className="bg-card border border-border rounded-xl p-8 space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-primary mb-4">Get in Touch</h2>
            <p className="text-muted-foreground">
              We're here to help and answer any question you might have. We look forward to hearing from you.
            </p>
          </div>
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3 rounded-full">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Email</h3>
                <p className="text-muted-foreground">For any inquiries, support, or feedback, please email us.</p>
                <a href="mailto:ashwanibaghel@servizephyr.com" className="text-primary font-medium hover:underline">
                  ashwanibaghel@servizephyr.com
                </a>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3 rounded-full">
                <Phone className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Phone</h3>
                <p className="text-muted-foreground">You can also reach out to us via phone during business hours.</p>
                <a href="tel:+919027872803" className="text-primary font-medium hover:underline">
                  +91 90278 72803
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
