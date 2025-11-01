'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Power, PowerOff, MapPin, AlertCircle, CheckCircle, Loader2, Bike } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, GeoPoint } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';

export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const watchIdRef = useRef(null);

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

        console.log(`[DEBUG] RiderDashboard: User found (UID: ${user.uid}). Preparing to fetch driver data.`);
        const driverDocRef = doc(db, "drivers", user.uid);

        const fetchDriverData = async () => {
            console.log("[DEBUG] RiderDashboard: fetchDriverData started.");
            setLoading(true);
            try {
                const driverDoc = await getDoc(driverDocRef);

                console.log(`[DEBUG] RiderDashboard: Firestore document fetch attempted. Exists: ${driverDoc.exists()}`);
                if (driverDoc.exists()) {
                    const data = driverDoc.data();
                    console.log("[DEBUG] RiderDashboard: Driver data found:", data);
                    setDriverData(data);
                    if (data.status === 'online') {
                        console.log("[DEBUG] RiderDashboard: Driver is online. Starting GPS tracking.");
                        startGpsTracking();
                    }
                } else {
                    console.error("[DEBUG] RiderDashboard: CRITICAL - Driver document does not exist in 'drivers' collection.");
                    setError("Your rider profile could not be found. Please contact support or complete your profile.");
                    await auth.signOut();
                    router.push('/rider-dashboard/login');
                }
            } catch (err) {
                console.error("[DEBUG] RiderDashboard: Error fetching driver data:", err);
                setError("Could not load your profile. Please try again.");
            } finally {
                setLoading(false);
                 console.log("[DEBUG] RiderDashboard: fetchDriverData finished.");
            }
        };

        fetchDriverData();

        // Cleanup function for the effect
        return () => {
            console.log("[DEBUG] RiderDashboard: Component unmounting. Stopping GPS tracking.");
            stopGpsTracking();
        };
    }, [user, isUserLoading, router]);

    const updateStatusInFirestore = async (newStatus) => {
        if (!user) return;
        const driverDocRef = doc(db, "drivers", user.uid);
        try {
            await updateDoc(driverDocRef, { status: newStatus });
            setDriverData(prev => ({ ...prev, status: newStatus }));
        } catch (err) {
            console.error("Failed to update status in Firestore:", err);
            setError("Failed to update your status. Please try again.");
        }
    };

    const startGpsTracking = () => {
        if (watchIdRef.current !== null) {
            return;
        }
        if (navigator.geolocation) {
            watchIdRef.current = navigator.geolocation.watchPosition(
                async (position) => {
                    if (!user) return;
                    const { latitude, longitude } = position.coords;
                    const driverDocRef = doc(db, "drivers", user.uid);
                    const newLocation = new GeoPoint(latitude, longitude);
                    try {
                        await updateDoc(driverDocRef, { currentLocation: newLocation });
                    } catch (err) {
                         console.error("Failed to update location in Firestore:", err);
                    }
                },
                (error) => {
                    setError("GPS Error: " + error.message + ". Please enable location services.");
                    handleToggleOnline('offline');
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
