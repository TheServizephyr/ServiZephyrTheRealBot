'use client';

import { motion } from 'framer-motion';
import { MessageSquare } from 'lucide-react';

export default function CommunityPage() {
    return (
        <div className="p-4 md:p-6">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Community Feed</h1>
                <p className="text-muted-foreground mt-1">See what&apos;s cooking in your neighborhood.</p>
            </header>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="mt-8 flex flex-col items-center justify-center text-center bg-muted/50 border-2 border-dashed border-border rounded-xl h-96"
            >
                <MessageSquare size={48} className="text-muted-foreground mb-4" />
                <h2 className="text-xl font-bold">Food Broadcast Coming Soon</h2>
                <p className="text-muted-foreground mt-2 max-w-sm">
                    This is where you&apos;ll post your cravings and find exclusive, real-time deals from local restaurants.
                </p>
            </motion.div>
        </div>
    );
}
