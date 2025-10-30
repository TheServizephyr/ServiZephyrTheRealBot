'use client';

import { motion } from 'framer-motion';
import { User, LogOut, ChevronRight, ShoppingBag, MapPin, Settings } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase'; // Using the custom hook to get user data
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from '@/components/ui/card';

const ProfileOption = ({ icon, title, description, onClick }) => (
    <motion.div
        onClick={onClick}
        className="flex items-center p-4 bg-background hover:bg-muted rounded-lg cursor-pointer transition-colors"
        whileTap={{ scale: 0.98 }}
    >
        <div className="mr-4 bg-muted p-3 rounded-full text-primary">
            {icon}
        </div>
        <div className="flex-grow">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="text-muted-foreground" />
    </motion.div>
);

export default function ProfilePage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();

    const handleLogout = async () => {
        await auth.signOut();
        localStorage.clear();
        router.push('/');
    };

    if (isUserLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        )
    }

  return (
    <div className="p-4 md:p-6 space-y-6">
        <header>
            <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-muted-foreground mt-1">Manage your orders, addresses, and settings.</p>
        </header>

        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <Card className="p-6">
                <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20 border-4 border-primary/20">
                        <AvatarImage src={user?.photoURL || ''} alt={user?.displayName || 'User'} />
                        <AvatarFallback className="text-2xl bg-muted">{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                    </Avatar>
                    <div>
                        <h2 className="text-2xl font-bold">{user?.displayName || 'Hello, User!'}</h2>
                        <p className="text-muted-foreground">{user?.email}</p>
                    </div>
                </div>
            </Card>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="space-y-3"
        >
            <ProfileOption 
                icon={<ShoppingBag size={20}/>}
                title="My Orders"
                description="View your past and current orders"
                onClick={() => {}} // Placeholder for future navigation
            />
             <ProfileOption 
                icon={<MapPin size={20}/>}
                title="My Addresses"
                description="Manage your saved delivery locations"
                onClick={() => {}} // Placeholder for future navigation
            />
             <ProfileOption 
                icon={<Settings size={20}/>}
                title="Account Settings"
                description="Update your notification preferences"
                onClick={() => {}} // Placeholder for future navigation
            />
        </motion.div>
        
         <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8"
        >
             <Button onClick={handleLogout} variant="destructive" className="w-full md:w-auto">
                <LogOut className="mr-2 h-4 w-4"/> Logout
            </Button>
        </motion.div>
    </div>
  );
}
