'use client';

import { motion } from 'framer-motion';
import { User, LogOut, ChevronRight, ShoppingBag, MapPin, Settings, Edit, Save, XCircle } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import InfoDialog from '@/components/InfoDialog';

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
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(user?.displayName || '');
    const [editedPhone, setEditedPhone] = useState(user?.phoneNumber || '');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const handleLogout = async () => {
        await auth.signOut();
        localStorage.clear();
        router.push('/');
    };
    
    const handleSaveProfile = () => {
        // Here you would typically make an API call to save the user profile
        console.log("Saving profile:", { name: editedName, phone: editedPhone });
        // For now, we'll just simulate a success and update the UI
        setInfoDialog({ isOpen: true, title: 'Success', message: 'Profile updated successfully!' });
        setIsEditing(false);
        // Note: In a real app, you'd refetch the user data or update the user object
    }

    if (isUserLoading) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-100px)]">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        )
    }

  return (
    <>
     <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
    />
    <div className="p-4 md:p-6 space-y-6">
        <header className="flex justify-between items-center">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
                <p className="text-muted-foreground mt-1">Manage your orders, addresses, and settings.</p>
            </div>
             {isEditing ? (
                 <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => { setIsEditing(false); setEditedName(user?.displayName || ''); }}>
                        <XCircle size={16} className="mr-2"/> Cancel
                    </Button>
                    <Button onClick={handleSaveProfile} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        <Save size={16} className="mr-2"/> Save
                    </Button>
                </div>
            ) : (
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                    <Edit size={16} className="mr-2"/> Edit Profile
                </Button>
            )}
        </header>

        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <Card className="p-6">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Avatar className="h-20 w-20 border-4 border-primary/20">
                        <AvatarImage src={user?.photoURL || ''} alt={user?.displayName || 'User'} />
                        <AvatarFallback className="text-2xl bg-muted">{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="flex-grow w-full">
                         {isEditing ? (
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="name">Full Name</Label>
                                    <Input id="name" value={editedName} onChange={e => setEditedName(e.target.value)} />
                                </div>
                                <div>
                                    <Label htmlFor="phone">Phone Number</Label>
                                    <Input id="phone" value={editedPhone} onChange={e => setEditedPhone(e.target.value)} />
                                </div>
                            </div>
                        ) : (
                             <div>
                                <h2 className="text-2xl font-bold">{user?.displayName || 'Hello, User!'}</h2>
                                <p className="text-muted-foreground">{user?.email}</p>
                                <p className="text-muted-foreground">{user?.phoneNumber}</p>
                            </div>
                        )}
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
                onClick={() => router.push('/customer-dashboard/orders')}
            />
             <ProfileOption 
                icon={<MapPin size={20}/>}
                title="My Addresses"
                description="Manage your saved delivery locations"
                onClick={() => router.push('/customer-dashboard/addresses')}
            />
             <ProfileOption 
                icon={<Settings size={20}/>}
                title="Account Settings"
                description="Update your notification preferences"
                onClick={() => router.push('/customer-dashboard/settings')}
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
    </>
  );
}
