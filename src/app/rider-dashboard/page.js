'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Power, PowerOff, MapPin, AlertCircle, CheckCircle, Loader2, Bike } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { doc, updateDoc, GeoPoint } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';

export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const watchIdRef = useRef(null);

    // This is the new, secure way to fetch data
    const fetchDriverData = async () => {
        console.log("[DEBUG] RiderDashboard: fetchDriverData started.");
        if (!user) {
            console.log("[DEBUG] RiderDashboard: No user found in hook, exiting fetch.");
            return;
        }

        try {
            const idToken = await user.getIdToken();
            const response = await fetch('/api/rider/dashboard', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            
            const data = await response.json();
            console.log(`[DEBUG] RiderDashboard: API response status: ${response.status}`);
            
            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch rider data.');
            }
            
            console.log("[DEBUG] RiderDashboard: Driver data found via API:", data);
            setDriverData(data.driver);

            if (data.driver.status === 'online') {
                console.log("[DEBUG] RiderDashboard: Driver is online. Starting GPS tracking.");
                startGpsTracking();
            }

        } catch (err) {
            console.error("[DEBUG] RiderDashboard: Error fetching driver data via API:", err);
            setError(err.message);
            // Optional: Sign out if profile is invalid
            if (err.message.includes("not found")) {
                await auth.signOut();
                router.push('/rider-dashboard/login');
            }
        } finally {
            setLoading(false);
            console.log("[DEBUG] RiderDashboard: fetchDriverData finished.");
        }
    };

    useEffect(() => {
        console.log(`[DEBUG] RiderDashboard: useEffect triggered. isUserLoading: ${isUserLoading}`);
        if (isUserLoading) {
            console.log("[DEBUG] RiderDashboard: Still loading user auth state. Waiting...");
            return;
        }
        if (!user) {
            console.log("[DEBUG] RiderDashboard: No user found. Redirecting to login.");
            router.push('/rider-dashboard/login');
            return;
        }

        fetchDriverData();

        // Cleanup function for the effect
        return () => {
            console.log("[DEBUG] RiderDashboard: Component unmounting. Stopping GPS tracking.");
            stopGpsTracking();
        };
    }, [user, isUserLoading, router]);

    const updateStatusInFirestore = async (newStatus) => {
        if (!user) return;
        try {
            const idToken = await user.getIdToken();
            await fetch('/api/rider/dashboard', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                 },
                body: JSON.stringify({ status: newStatus })
            });
            setDriverData(prev => (prev ? { ...prev, status: newStatus } : null));
        } catch (err) {
            console.error("Failed to update status via API:", err);
            setError("Failed to update your status. Please try again.");
        }
    };

    const startGpsTracking = () => {
        if (watchIdRef.current !== null) return;
        if (navigator.geolocation) {
            watchIdRef.current = navigator.geolocation.watchPosition(
                async (position) => {
                    if (!user) return;
                    const { latitude, longitude } = position.coords;
                    try {
                        const idToken = await user.getIdToken();
                        await fetch('/api/rider/dashboard', {
                            method: 'PATCH',
                            headers: { 
                                'Authorization': `Bearer ${idToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                location: { latitude, longitude }
                            })
                        });
                    } catch (err) {
                         console.error("Failed to update location via API:", err);
                    }
                },
                (error) => {
                    setError("GPS Error: " + error.message + ". Please enable location services.");
                    handleToggleOnline(); // Tries to set status to offline
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 0, distanceFilter: 10 }
            );
        } else {
            setError("Geolocation is not supported by this browser.");
        }
    };

    const stopGpsTracking = () => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
    };

    const handleToggleOnline = async () => {
        const newStatus = driverData?.status === 'online' ? 'offline' : 'online';
        await updateStatusInFirestore(newStatus);
        if (newStatus === 'online') {
            startGpsTracking();
        } else {
            stopGpsTracking();
        }
    };

    if (loading || isUserLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
            </div>
        );
    }
    
     if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background text-center p-4">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <h1 className="mt-4 text-2xl font-bold">An Error Occurred</h1>
                <p className="mt-2 text-muted-foreground">{error}</p>
                <Button onClick={() => window.location.reload()} className="mt-6">Try Again</Button>
            </div>
        );
    }

    const isOnline = driverData?.status === 'online';

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col p-4">
            <header className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                     <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Bike size={24} className="text-primary"/>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">{driverData?.name || 'Rider'}</h1>
                        <p className="text-sm text-muted-foreground">{driverData?.phone}</p>
                    </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => auth.signOut()}>Logout</Button>
            </header>

            <main className="flex-grow flex flex-col justify-between">
                <div>
                    <motion.div
                        className="bg-card p-6 rounded-2xl border border-border text-center mb-6"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <p className="text-sm text-muted-foreground">YOUR STATUS</p>
                        <p className={`text-2xl font-bold mt-1 capitalize ${isOnline ? 'text-green-400' : 'text-yellow-400'}`}>
                            {driverData?.status?.replace('-', ' ') || 'Offline'}
                        </p>
                    </motion.div>
                </div>
                
                 <div className="mt-auto">
                    <motion.button
                        onClick={handleToggleOnline}
                        className={`w-full h-24 rounded-2xl flex items-center justify-center text-2xl font-bold transition-colors duration-300 ${
                            isOnline
                                ? 'bg-destructive/80 text-destructive-foreground'
                                : 'bg-green-500/80 text-green-50'
                        }`}
                        whileTap={{ scale: 0.95 }}
                    >
                        {isOnline ? (
                            <>
                                <PowerOff size={32} className="mr-3" /> Go Offline
                            </>
                        ) : (
                            <>
                                <Power size={32} className="mr-3" /> Go Online
                            </>
                        )}
                    </motion.button>
                </div>
            </main>
        </div>
    );
}
