'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LayoutDashboard, Wallet, LogOut, User, Loader2 } from 'lucide-react';
import { useUser } from '@/firebase';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import ImpersonationBanner from '@/components/ImpersonationBanner';

function RiderLayoutContent({ children }) {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [riderName, setRiderName] = useState('Rider');
    const [riderImage, setRiderImage] = useState('');

    // Track if auth has settled
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        if (isUserLoading) return;

        // Give auth time to settle (race condition fix)
        const timer = setTimeout(() => {
            setAuthChecked(true);
        }, 500);

        return () => clearTimeout(timer);
    }, [isUserLoading]);

    useEffect(() => {
        if (!authChecked) return;

        if (!user) {
            console.log('[Rider Layout] No user after auth check, redirecting');
            router.push('/rider-dashboard/login');
            return;
        }

        const fetchRiderInfo = async () => {
            if (user) {
                const docRef = doc(db, 'drivers', user.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setRiderName(docSnap.data().name || user.displayName || 'Rider');
                    setRiderImage(docSnap.data().profilePictureUrl || user.photoURL || '');
                }
            }
        };

        if (user) {
            fetchRiderInfo();
        }

    }, [user, isUserLoading, router]);

    // Log impersonation when detected
    useEffect(() => {
        const impersonateUserId = searchParams.get('impersonate_user_id');
        if (user && impersonateUserId) {
            user.getIdToken().then(idToken => {
                fetch('/api/admin/log-impersonation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        targetUserId: impersonateUserId,
                        targetUserEmail: user.email,
                        targetUserRole: 'Rider',
                        action: 'start_impersonation_rider'
                    })
                }).catch(err => console.error('Failed to log impersonation:', err));
            });
        }
    }, [user, searchParams]);

    const handleLogout = async () => {
        const { auth } = await import('@/lib/firebase');
        await auth.signOut();
        router.push('/rider-dashboard/login');
    };

    if (isUserLoading || !authChecked) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <GoldenCoinSpinner />
            </div>
        );
    }

    if (!user) {
        return null; // Redirect is handled in useEffect
    }

    return (
        <>
            <ImpersonationBanner vendorName={riderName} />
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
                        <Button variant="ghost" size="sm" onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" /> Logout</Button>
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
        </>
    );
}

export default function RiderLayout({ children }) {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><GoldenCoinSpinner /></div>}>
            <RiderLayoutContent>{children}</RiderLayoutContent>
        </Suspense>
    );
}
