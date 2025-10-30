'use client';

import { motion } from 'framer-motion';
import { Map } from 'lucide-react';

export default function DiscoverPage() {
  return (
    <div className="p-4 md:p-6">
        <header>
            <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
            <p className="text-muted-foreground mt-1">Find new restaurants and deals near you.</p>
        </header>

        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mt-8 flex flex-col items-center justify-center text-center bg-muted/50 border-2 border-dashed border-border rounded-xl h-96"
        >
            <Map size={48} className="text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold">Map View Coming Soon</h2>
            <p className="text-muted-foreground mt-2 max-w-sm">
                This is where the map with nearby ServiZephyr restaurants will appear.
            </p>
        </motion.div>
    </div>
  );
}
