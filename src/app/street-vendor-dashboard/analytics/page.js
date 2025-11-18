'use client';

import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';

export default function StreetVendorAnalyticsPage() {
  return (
    <div className="p-4 md:p-6 flex items-center justify-center h-full">
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mt-8 flex flex-col items-center justify-center text-center bg-muted/50 border-2 border-dashed border-border rounded-xl h-96 w-full max-w-2xl"
        >
            <BarChart3 size={48} className="text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold">Analytics Coming Soon</h2>
            <p className="text-muted-foreground mt-2 max-w-sm">
                We're building powerful analytics to help you track your sales, top-selling items, and daily earnings.
            </p>
        </motion.div>
    </div>
  );
}
