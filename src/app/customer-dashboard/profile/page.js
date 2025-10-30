'use client';

import { motion } from 'framer-motion';
import { User, LogOut } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function ProfilePage() {
    const router = useRouter();

    const handleLogout = async () => {
        await auth.signOut();
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        router.push('/');
    };

  return (
    <div className="p-4 md:p-6 space-y-8">
        <header>
            <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-muted-foreground mt-1">Manage your orders, addresses, and settings.</p>
        </header>

        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mt-8 flex flex-col items-center justify-center text-center bg-muted/50 border-2 border-dashed border-border rounded-xl h-96 p-4"
        >
            <User size={48} className="text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold">More Features Coming Soon</h2>
            <p className="text-muted-foreground mt-2 max-w-sm">
                This is where you'll find your detailed order history, saved addresses, and account settings.
            </p>
             <Button onClick={handleLogout} variant="destructive" className="mt-8">
                <LogOut className="mr-2 h-4 w-4"/> Logout
            </Button>
        </motion.div>
    </div>
  );
}
