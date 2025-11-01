
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
            console.log("[DEBUG] RiderDashboard: Auth state is loading, waiting...");
            return;
        }
        if (!user) {
            console.log("[DEBUG] RiderDashboard: No user found, redirecting to login.");
            router.push('/rider-dashboard/login');
            return;
        }

        console.log(`[DEBUG] RiderDashboard: User authenticated with UID: ${user.uid}. Fetching driver data.`);
        const driverDocRef = doc(db, "drivers", user.uid);

        const fetchDriverData = async () => {
            console.log(`[DEBUG] RiderDashboard: Inside fetchDriverData for UID: ${user.uid}`);
            setLoading(true);
            try {
                const driverDoc = await getDoc(driverDocRef);
                console.log(`[DEBUG] RiderDashboard: Firestore getDoc() call completed. Document exists: ${driverDoc.exists()}`);

                if (driverDoc.exists()) {
                    const data = driverDoc.data();
                    console.log("[DEBUG] RiderDashboard: Driver document data found:", data);
                    setDriverData(data);
                    if (data.status === 'online') {
                        startGpsTracking();
                    }
                } else {
                    console.error(`[DEBUG] RiderDashboard: CRITICAL - Driver document does not exist for UID: ${user.uid}.`);
                    setError("Your rider profile could not be found. Please contact support or complete your profile.");
                    await auth.signOut();
                    router.push('/rider-dashboard/login');
                }
            } catch (err) {
                console.error("[DEBUG] RiderDashboard: Error fetching driver data:", err);
                setError("Could not load your profile. Please try again.");
            } finally {
                console.log("[DEBUG] RiderDashboard: fetchDriverData finished. Setting loading to false.");
                setLoading(false);
            }
        };

        fetchDriverData();

        return () => {
            console.log("[DEBUG] RiderDashboard: Component unmounting, stopping GPS tracking.");
            stopGpsTracking();
        };
    }, [user, isUserLoading, router]);

    const updateStatusInFirestore = async (newStatus) => {
        if (!user) return;
        console.log(`[DEBUG] RiderDashboard: Updating status to '${newStatus}' in Firestore.`);
        const driverDocRef = doc(db, "drivers", user.uid);
        try {
            await updateDoc(driverDocRef, { status: newStatus });
            setDriverData(prev => ({ ...prev, status: newStatus }));
            console.log(`[DEBUG] RiderDashboard: Firestore status updated successfully.`);
        } catch (err) {
            console.error("[DEBUG] RiderDashboard: Failed to update status in Firestore:", err);
            setError("Failed to update your status. Please try again.");
        }
    };

    const startGpsTracking = () => {
        if (watchIdRef.current !== null) {
            console.log("[DEBUG] RiderDashboard: GPS tracking is already active.");
            return;
        }
        if (navigator.geolocation) {
            console.log("[DEBUG] RiderDashboard: Starting GPS tracking.");
            watchIdRef.current = navigator.geolocation.watchPosition(
                async (position) => {
                    if (!user) return;
                    const { latitude, longitude } = position.coords;
                    const driverDocRef = doc(db, "drivers", user.uid);
                    const newLocation = new GeoPoint(latitude, longitude);
                    try {
                        await updateDoc(driverDocRef, { currentLocation: newLocation });
                        console.log("[DEBUG] RiderDashboard: Location updated:", latitude, longitude);
                    } catch (err) {
                         console.error("[DEBUG] RiderDashboard: Failed to update location in Firestore:", err);
                    }
                },
                (error) => {
                    console.error("[DEBUG] RiderDashboard: Error watching position:", error);
                    setError("GPS Error: " + error.message + ". Please enable location services.");
                    handleToggleOnline('offline');
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 0, distanceFilter: 10 }
            );
        } else {
            setError("Geolocation is not supported by this browser.");
            console.error("[DEBUG] RiderDashboard: Geolocation not supported.");
        }
    };

    const stopGpsTracking = () => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
            console.log("[DEBUG] RiderDashboard: GPS tracking stopped.");
        }
    };

    const handleToggleOnline = async () => {
        const newStatus = driverData?.status === 'online' ? 'offline' : 'online';
        console.log(`[DEBUG] RiderDashboard: Toggling status to ${newStatus}.`);
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
