'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LayoutDashboard, Wallet, LogOut, User } from 'lucide-react';
import { useUser } from '@/firebase';

export default function RiderLayout({ children }) {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [riderName, setRiderName] = useState('Rider');
    const [riderImage, setRiderImage] = useState('');

    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-dashboard/login');
        } else {
            const fetchRiderInfo = async () => {
                const docRef = doc(db, 'drivers', user.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setRiderName(docSnap.data().name || user.displayName || 'Rider');
                    setRiderImage(docSnap.data().profilePictureUrl || user.photoURL || '');
                }
            };
            fetchRiderInfo();
        }
    }, [user, isUserLoading, router]);

    const handleLogout = async () => {
        await auth.signOut();
        router.push('/rider-dashboard/login');
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="sticky top-0 z-20 bg-card border-b border-border p-4">
                <div className="container mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Avatar>
                            <AvatarImage src={riderImage} />
                            <AvatarFallback>{riderName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <h1 className="text-lg font-bold">Welcome, {riderName}</h1>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleLogout}><LogOut className="mr-2 h-4 w-4"/> Logout</Button>
                </div>
            </header>

            <main className="flex-grow container mx-auto p-4 md:p-6">
                {children}
            </main>
            
            <footer className="sticky bottom-0 z-20 bg-card border-t border-border">
                <nav className="container mx-auto flex justify-around items-center h-20">
                     <Link href="/rider-dashboard" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary">
                        <LayoutDashboard />
                        <span className="text-xs font-medium">Dashboard</span>
                    </Link>
                    <Link href="/rider-dashboard/wallet" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary">
                        <Wallet />
                        <span className="text-xs font-medium">Earnings</span>
                    </Link>
                    <Link href="/rider-dashboard/profile" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary">
                        <User />
                        <span className="text-xs font-medium">Profile</span>
                    </Link>
                </nav>
            </footer>
        </div>
    );
}
