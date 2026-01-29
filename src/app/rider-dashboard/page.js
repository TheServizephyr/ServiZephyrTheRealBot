
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, PowerOff, Loader2, Mail, Check, X, ShoppingBag, Bell, Bike, CheckCircle } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const InvitationCard = ({ invite, onAccept, onDecline }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-primary/10 border border-primary/30 rounded-lg p-6 text-center"
        >
            <Mail size={32} className="mx-auto text-primary mb-3" />
            <h3 className="text-lg font-bold text-foreground">You have a new invitation!</h3>
            <p className="mt-1 text-muted-foreground">
                <span className="font-semibold text-foreground">{invite.restaurantName}</span> wants to add you as a delivery rider.
            </p>
            <div className="mt-4 flex justify-center gap-4">
                <Button onClick={() => onAccept(invite)} variant="default" className="bg-green-500 hover:bg-green-600 text-white"><Check className="mr-2 h-4 w-4" /> Accept</Button>
                <Button onClick={() => onDecline(invite.id)} variant="destructive"><X className="mr-2 h-4 w-4" /> Decline</Button>
            </div>
        </motion.div>
    )
}

// 🏪 Restaurant Connection Card Component
const RestaurantConnectionCard = ({ restaurantId }) => {
    const [restaurant, setRestaurant] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRestaurant = async () => {
            try {
                // Try restaurants collection first
                let docRef = doc(db, 'restaurants', restaurantId);
                let docSnap = await getDoc(docRef);

                if (!docSnap.exists()) {
                    // Try shops collection
                    docRef = doc(db, 'shops', restaurantId);
                    docSnap = await getDoc(docRef);
                }

                if (docSnap.exists()) {
                    setRestaurant({ id: docSnap.id, ...docSnap.data() });
                }
            } catch (err) {
                console.error('[Restaurant Card] Fetch error:', err);
            } finally {
                setLoading(false);
            }
        };

        if (restaurantId) {
            fetchRestaurant();
        }
    }, [restaurantId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-4">
                <Loader2 className="animate-spin text-primary" size={24} />
            </div>
        );
    }

    if (!restaurant) {
        return <p className="text-sm text-muted-foreground text-center">Restaurant not found</p>;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                <div className="bg-primary/20 p-3 rounded-full">
                    <ShoppingBag className="text-primary" size={20} />
                </div>
                <div className="flex-1">
                    <h4 className="text-lg font-bold text-foreground">{restaurant.name}</h4>
                    {restaurant.address && (
                        <p className="text-sm text-muted-foreground mt-1">
                            📍 {restaurant.address.street}, {restaurant.address.city}
                        </p>
                    )}
                    {restaurant.ownerPhone && (
                        <p className="text-sm text-muted-foreground mt-1">
                            📞 {restaurant.ownerPhone}
                        </p>
                    )}
                </div>
                <div className="bg-green-500/20 px-3 py-1 rounded-full">
                    <span className="text-xs font-bold text-green-400">✓ Active</span>
                </div>
            </div>
        </div>
    );
};

// 🔥 PHASE 2 & 3: Action-First Delivery Card with Status Flow Buttons
const DeliveryCard = ({ order, isPrimary, onStatusAction, isLoading }) => {
    const getStatusConfig = (status) => {
        switch (status) {
            case 'dispatched':
                return { button: 'REACHED RESTAURANT', color: 'bg-orange-500', icon: '🏪' };
            case 'reached_restaurant':
                return { button: 'FOOD COLLECTED', color: 'bg-yellow-500', icon: '📦' };
            case 'picked_up':
                return { button: 'START DELIVERY', color: 'bg-blue-500', icon: '🚀' };
            case 'on_the_way':
                return { button: 'MARK DELIVERED', color: 'bg-green-500', icon: '✅' };
            case 'delivery_attempted':
                return { button: 'MARK FAILED', color: 'bg-red-500', icon: '❌' };
            case 'failed_delivery':
                return { button: 'RETURNED TO RESTAURANT', color: 'bg-gray-500', icon: '🔄' };
            default:
                return { button: 'UPDATE STATUS', color: 'bg-primary', icon: '📋' };
        }
    };

    const config = getStatusConfig(order.status);
    const lat = order.customerLocation?._latitude || order.customerLocation?.latitude;
    const lng = order.customerLocation?._longitude || order.customerLocation?.longitude;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={cn(
                "rounded-xl p-4 sm:p-5 border-2 shadow-lg w-full break-words",
                isPrimary ? "bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-blue-500" : "bg-card border-border"
            )}
        >
            {/* PHASE 7: Priority Badge */}
            {isPrimary && (
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">⭐</span>
                    <span className="text-lg font-black text-yellow-400">DELIVER FIRST</span>
                </div>
            )}

            {/* Customer Info */}
            <div className="mb-4 min-w-0">
                <p className="text-sm text-muted-foreground mb-1">👤 Customer</p>
                <h3 className="text-xl sm:text-2xl font-bold text-foreground break-words">{order.customerName || 'Unknown'}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-2 break-words whitespace-normal">📍 {order.customerAddress || 'Address not available'}</p>
            </div>

            {/* PHASE 4: COD Visibility */}
            <div className={cn(
                "p-4 rounded-lg mb-4 text-center",
                order.paymentMethod === 'cod' ? "bg-green-100 border-2 border-green-500" : "bg-blue-100 border-2 border-blue-500"
            )}>
                {order.paymentMethod === 'cod' ? (
                    <>
                        <p className="text-3xl font-black text-green-700">💵 COLLECT CASH</p>
                        <p className="text-4xl font-black text-green-800 mt-1">₹{order.totalAmount?.toFixed(2) || '0'}</p>
                    </>
                ) : (
                    <p className="text-2xl font-bold text-blue-700">✅ PAID ONLINE</p>
                )}
            </div>

            {/* PHASE 5: Call Button */}
            {order.customerPhone && (
                <a
                    href={`tel:${order.customerPhone}`}
                    className="block w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-xl mb-3 flex items-center justify-center text-lg font-bold"
                >
                    📞 Call Customer: {order.customerPhone}
                </a>
            )}

            {/* PHASE 6: Track Delivery Page (Rider's Internal Map View) */}
            <Link
                href="/rider-dashboard/track"
                className="block w-full h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-xl mb-3 flex items-center justify-center text-lg font-bold"
            >
                🗺️ View Map & Navigate
            </Link>

            {/* PHASE 3 & 9: Status Action Button (Large, One-Hand Friendly) + POLISH 1: Loading State */}
            <button
                onClick={() => onStatusAction(order.id, order.status)}
                disabled={isLoading}
                className={cn(
                    "w-full h-16 rounded-xl text-white text-xl font-black transition-all",
                    config.color,
                    isLoading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90 active:scale-95"
                )}
            >
                {isLoading ? (
                    <>
                        <Loader2 className="inline-block animate-spin mr-2" size={24} />
                        Loading...
                    </>
                ) : (
                    <>{config.icon} {config.button}</>
                )}
            </button>

            <p className="text-xs text-center text-muted-foreground mt-2">Order #{order.id?.substring(0, 8)}</p>
        </motion.div>
    );
};


export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [invites, setInvites] = useState([]);
    const [activeOrders, setActiveOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isRestaurantActive, setIsRestaurantActive] = useState(false);
    const [isOnline, setIsOnline] = useState(true); // ✅ STEP 8C: Network status
    const [actionLoading, setActionLoading] = useState(null); // 🔥 POLISH 1: Button locking
    const [gpsPermission, setGpsPermission] = useState('granted'); // 🔥 POLISH 2: GPS warning
    const [batteryLevel, setBatteryLevel] = useState(100); // 🔥 POLISH 3: Battery warning


    const handleApiCall = useCallback(async (endpoint, method = 'PATCH', body = {}) => {
        if (!user) throw new Error('Authentication Error');
        const idToken = await user.getIdToken();
        const response = await fetch(endpoint, {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'An API error occurred.');
        }
        return await response.json();
    }, [user]);

    // ✅ STEP 8A: Intelligent GPS Tracking with Retry
    useEffect(() => {
        let locationInterval;
        let retryTimeout;

        const sendLocation = async () => {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    });
                });

                const { latitude, longitude } = position.coords;
                await handleApiCall('/api/rider/dashboard', 'PATCH', {
                    location: { latitude, longitude }
                });
                console.log('[GPS] Location sent successfully');

            } catch (err) {
                console.warn('[GPS] Failed, retrying in 5s:', err.message);
                // ✅ Fast retry on failure instead of waiting 20s
                retryTimeout = setTimeout(sendLocation, 5000);
            }
        };

        if (driverData?.status === 'online' || driverData?.status === 'on-delivery') {
            sendLocation(); // Send immediately on mount
            locationInterval = setInterval(sendLocation, 20000);
        }

        return () => {
            if (locationInterval) clearInterval(locationInterval);
            if (retryTimeout) clearTimeout(retryTimeout);
        };
    }, [driverData?.status, handleApiCall]);

    // ✅ STEP 8B: Screen Wake Lock
    useEffect(() => {
        let wakeLock = null;

        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('[Wake Lock] Screen will stay active');
                }
            } catch (err) {
                console.warn('[Wake Lock] Failed:', err);
            }
        };

        if (driverData?.status === 'online' || driverData?.status === 'on-delivery') {
            requestWakeLock();
        }

        return () => {
            wakeLock?.release();
        };
    }, [driverData?.status]);

    // ✅ STEP 8C: Network Status Monitoring
    useEffect(() => {
        const updateNetworkStatus = () => {
            setIsOnline(navigator.onLine);
            console.log('[Network]', navigator.onLine ? 'Online' : 'Offline');
        };

        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);

        return () => {
            window.removeEventListener('online', updateNetworkStatus);
            window.removeEventListener('offline', updateNetworkStatus);
        };
    }, []);

    // ✅ STEP 8D: Auto Resume Tracking on Foreground
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && (driverData?.status === 'online' || driverData?.status === 'on-delivery')) {
                console.log('[Visibility] App resumed, forcing location update');
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        handleApiCall('/api/rider/dashboard', 'PATCH', {
                            location: {
                                latitude: position.coords.latitude,
                                longitude: position.coords.longitude
                            }
                        }).catch(err => console.error('[GPS Resume]', err));
                    },
                    (err) => console.error('[GPS Resume] Failed:', err),
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [driverData?.status, handleApiCall]);

    // 🔥 POLISH 2: GPS Permission Monitoring
    useEffect(() => {
        const checkGPSPermission = async () => {
            if ('permissions' in navigator) {
                try {
                    const result = await navigator.permissions.query({ name: 'geolocation' });
                    setGpsPermission(result.state);
                    result.addEventListener('change', () => setGpsPermission(result.state));
                } catch (err) {
                    console.warn('[GPS Permission] Check failed:', err);
                }
            }
        };
        checkGPSPermission();
    }, []);

    // 🔥 POLISH 3: Battery Level Monitoring
    useEffect(() => {
        const checkBattery = async () => {
            if ('getBattery' in navigator) {
                try {
                    const battery = await navigator.getBattery();
                    setBatteryLevel(battery.level * 100);
                    battery.addEventListener('levelchange', () => {
                        setBatteryLevel(battery.level * 100);
                    });
                } catch (err) {
                    console.warn('[Battery] Check failed:', err);
                }
            }
        };
        checkBattery();
    }, []);

    // 🔥 POLISH 5: Vibration & Sound on New Orders
    useEffect(() => {
        const prevOrderCount = activeOrders.length;

        // Detect new order assignment
        if (activeOrders.length > prevOrderCount && prevOrderCount > 0) {
            // Vibrate
            if ('vibrate' in navigator) {
                navigator.vibrate([200, 100, 200]);
            }

            // Play sound (simple beep using Web Audio API)
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                gainNode.gain.value = 0.3;

                oscillator.start();
                setTimeout(() => oscillator.stop(), 200);
            } catch (err) {
                console.warn('[Sound] Failed:', err);
            }
        }
    }, [activeOrders.length]);

    // Helper: One-time restaurant active check (not a listener!)
    const checkRestaurantActive = useCallback(async (restaurantId) => {
        if (!restaurantId) {
            setIsRestaurantActive(false);
            return;
        }

        try {
            const [restSnap, shopSnap] = await Promise.all([
                getDoc(doc(db, 'restaurants', restaurantId)),
                getDoc(doc(db, 'shops', restaurantId))
            ]);
            setIsRestaurantActive(restSnap.exists() || shopSnap.exists());
        } catch (error) {
            console.error('[RiderDash] Restaurant check error:', error);
            setIsRestaurantActive(false);
        }
    }, []);

    // Helper: One-time invites fetch (not a listener!)
    const fetchInvitesOnce = useCallback(async (userId) => {
        try {
            const invitesQuery = query(collection(db, 'drivers', userId, 'invites'));
            const snapshot = await getDocs(invitesQuery);
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.error('[RiderDash] Invites fetch error:', error);
        }
    }, []);

    // Main data fetching and real-time listeners (OPTIMIZED: 5 → 2 listeners!)
    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-dashboard/login');
            return;
        }

        setLoading(true);
        let unsubscribes = [];

        const driverDocRef = doc(db, 'drivers', user.uid);
        const unsubscribeDriver = onSnapshot(driverDocRef,
            (driverSnap) => {
                if (driverSnap.exists()) {
                    const data = driverSnap.data();
                    setDriverData(data);
                    setError('');

                    // One-time restaurant check (not a listener!)
                    if (data.currentRestaurantId) {
                        checkRestaurantActive(data.currentRestaurantId);
                    } else {
                        setIsRestaurantActive(false);
                    }
                } else {
                    setError('Your rider profile could not be found.');
                }
                setLoading(false); // Only stop loading after profile check
            },
            (err) => {
                const contextualError = new FirestorePermissionError({ path: driverDocRef.path, operation: 'get' });
                errorEmitter.emit('permission-error', contextualError);
                setError("You don't have permission to view this data.");
                setLoading(false);
            }
        );
        unsubscribes.push(unsubscribeDriver);

        // LISTENER 2: Active orders (critical real-time data)
        // ✅ Include all statuses from Steps 4-5 pickup and failure flows
        const ordersQuery = query(
            collection(db, "orders"),
            where("deliveryBoyId", "==", user.uid),
            where("status", "in", [
                "dispatched", "reached_restaurant", "picked_up",
                "on_the_way", "delivery_attempted", "failed_delivery"
            ])
        );
        const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
            const newOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveOrders(newOrders);
        });
        unsubscribes.push(unsubscribeOrders);

        // One-time fetch of invites (not real-time critical)
        fetchInvitesOnce(user.uid);

        console.log('[RiderDash] Active listeners:', unsubscribes.length); // Should log: 2

        return () => {
            console.log('[RiderDash] Cleaning up', unsubscribes.length, 'listeners');
            unsubscribes.forEach(unsub => unsub());
        };

    }, [user, isUserLoading, router, checkRestaurantActive, fetchInvitesOnce]);

    const handleToggleOnline = async () => {
        const newStatus = driverData?.status === 'online' ? 'offline' : 'online';
        try {
            await handleApiCall('/api/rider/dashboard', 'PATCH', { status: newStatus });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to update your status. Please try again.' });
        }
    };

    const handleAcceptInvite = async (invite) => {
        if (!user) return;
        try {
            const data = await handleApiCall('/api/rider/accept-invite', 'POST', {
                restaurantId: invite.restaurantId,
                restaurantName: invite.restaurantName,
                inviteId: invite.id
            });
            setInfoDialog({ isOpen: true, title: "Success!", message: data.message });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to accept the invitation: ${err.message}` });
        }
    };

    const handleDeclineInvite = async (inviteId) => {
        if (!user) return;
        const inviteDocRef = doc(db, 'drivers', user.uid, 'invites', inviteId);
        try {
            await deleteDoc(inviteDocRef);
        } catch (err) {
            const contextualError = new FirestorePermissionError({ path: inviteDocRef.path, operation: 'delete' });
            errorEmitter.emit('permission-error', contextualError);
            setInfoDialog({ isOpen: true, title: 'Error', message: "Failed to decline invitation." });
        }
    }

    // 🔥 POLISH 1 & 4: Unified Status Action Handler with Button Locking + Auto Scroll
    const handleStatusAction = async (orderId, currentStatus) => {
        if (actionLoading === orderId) return; // Prevent double tap

        setActionLoading(orderId);

        try {
            let endpoint, body;

            switch (currentStatus) {
                case 'dispatched':
                    endpoint = '/api/rider/reached-restaurant';
                    body = { orderIds: [orderId] };
                    break;
                case 'reached_restaurant':
                    endpoint = '/api/rider/accept-order';
                    body = { orderIds: [orderId] };
                    break;
                case 'picked_up':
                    endpoint = '/api/rider/start-delivery';
                    body = { orderIds: [orderId] };
                    break;
                case 'on_the_way':
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'delivered' };
                    break;
                case 'delivery_attempted':
                    endpoint = '/api/rider/mark-failed';
                    body = { orderIds: [orderId], reason: 'Customer unreachable' };
                    break;
                case 'failed_delivery':
                    endpoint = '/api/rider/return-order';
                    body = { orderIds: [orderId] };
                    break;
                default:
                    throw new Error('Unknown status');
            }

            await handleApiCall(endpoint, 'POST', body);

            // 🔥 POLISH 4: Auto scroll to top on status change
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // Remove from active orders if delivered or returned
            if (currentStatus === 'on_the_way' || currentStatus === 'failed_delivery') {
                setActiveOrders(prev => prev.filter(o => o.id !== orderId));
            }
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Action Failed', message: err.message });
        } finally {
            setActionLoading(null);
        }
    }

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><GoldenCoinSpinner /></div>
    }

    if (error && !driverData) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-red-500">{error}</p></div>
    }

    const isDriverOnline = driverData?.status === 'online';
    const isBusy = driverData?.status === 'on-delivery';

    // ✅ PHASE 1: Focus Mode -Sort orders by priority (earliest assigned first)
    const sortedOrders = [...activeOrders].sort((a, b) => {
        const statusOrder = {
            'on_the_way': 1,
            'delivery_attempted': 2,
            'picked_up': 3,
            'reached_restaurant': 4,
            'dispatched': 5,
            'failed_delivery': 6
        };
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
    });

    const primaryDelivery = sortedOrders[0];
    const secondaryDeliveries = sortedOrders.slice(1);

    return (
        <div className="min-h-screen bg-background pb-20">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false })} title={infoDialog.title} message={infoDialog.message} />

            <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
                {/* ✅ STEP 8C: Network Loss Indicator */}
                {!isOnline && (
                    <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded-lg text-center text-sm font-semibold animate-pulse">
                        📡 Network lost. Reconnecting...
                    </div>
                )}

                {/* 🔥 POLISH 2: GPS Permission Warning */}
                {gpsPermission === 'denied' && (
                    <div className="bg-orange-100 border border-orange-300 text-orange-700 p-3 rounded-lg text-center text-sm font-semibold">
                        📍 Location permission required for deliveries. Enable in browser settings.
                    </div>
                )}

                {/* 🔥 POLISH 3: Battery Saver Warning */}
                {batteryLevel < 15 && (
                    <div className="bg-yellow-100 border border-yellow-300 text-yellow-700 p-3 rounded-lg text-center text-sm font-semibold">
                        🔋 Low battery ({Math.round(batteryLevel)}%) may affect tracking. Charge soon.
                    </div>
                )}

                {/* ✅ PHASE 1 & 8: Status Card with GPS Info */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-card p-6 rounded-xl border border-border shadow-lg"
                >
                    {/* Online/Offline Toggle */}
                    <button
                        onClick={handleToggleOnline}
                        disabled={isBusy}
                        className={cn(
                            "mx-auto w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 mb-4",
                            isDriverOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400",
                            isBusy && "bg-blue-500/20 text-blue-400 cursor-not-allowed"
                        )}
                    >
                        {isDriverOnline || isBusy ? <Power size={48} /> : <PowerOff size={48} />}
                    </button>

                    <p className="text-sm text-muted-foreground text-center">YOUR STATUS</p>
                    <p className={cn("text-3xl font-bold text-center mt-1 capitalize", isDriverOnline ? 'text-green-400' : isBusy ? 'text-blue-400' : 'text-red-400')}>
                        {driverData?.status?.replace('-', ' ') || 'Offline'}
                    </p>
                    {isBusy && <p className="text-xs text-blue-400 text-center mt-2">Complete current delivery to go offline.</p>}

                    {/* PHASE 8: GPS Status */}
                    {(isDriverOnline || isBusy) && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-center gap-2 text-sm">
                                <span className="text-green-400">📍 GPS Active</span>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">Updates every 20s</span>
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* 🏪 RESTAURANT CONNECTIONS CARD */}
                {driverData?.currentRestaurantId && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-gradient-to-br from-primary/10 to-purple-500/10 border border-primary/30 rounded-xl p-5 shadow-lg"
                    >
                        <h3 className="text-md font-bold text-foreground mb-3 flex items-center gap-2">
                            🏪 Connected Restaurant
                        </h3>
                        <RestaurantConnectionCard restaurantId={driverData.currentRestaurantId} />
                    </motion.div>
                )}

                {/* Invitation Section */}
                <AnimatePresence>
                    {driverData && !driverData.currentRestaurantId && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Restaurant Invitation</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {invites.length > 0 ? (
                                    <div className="space-y-4">
                                        {invites.map(invite => (
                                            <InvitationCard key={invite.id} invite={invite} onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground text-center py-8">You are not an employee of any restaurant yet. Ask your owner to send an invite to your email.</p>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </AnimatePresence>

                {/* ✅ PHASE 1: PRIMARY DELIVERY (Focus Mode) */}
                {primaryDelivery && (
                    <div>
                        <h2 className="text-2xl font-black text-foreground mb-3 flex items-center gap-2">
                            <Bike className="text-primary" />
                            Current Delivery
                        </h2>
                        <DeliveryCard
                            order={primaryDelivery}
                            isPrimary={true}
                            onStatusAction={handleStatusAction}
                            isLoading={actionLoading === primaryDelivery.id}
                        />
                    </div>
                )}

                {/* ✅ PHASE 1: SECONDARY DELIVERIES (Collapsed) */}
                {secondaryDeliveries.length > 0 && (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ShoppingBag className="text-muted-foreground" size={20} />
                                Next Deliveries ({secondaryDeliveries.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {secondaryDeliveries.map((order, index) => (
                                <div key={order.id}>
                                    {index > 0 && <hr className="my-3 border-border" />}
                                    <DeliveryCard
                                        order={order}
                                        isPrimary={false}
                                        onStatusAction={handleStatusAction}
                                        isLoading={actionLoading === order.id}
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                {/* No Active Orders State */}
                {!primaryDelivery && (
                    <Card>
                        <CardContent className="py-12">
                            <div className="text-center">
                                <Bell className="mx-auto text-muted-foreground mb-4" size={48} />
                                <p className="text-xl font-semibold text-foreground">No Active Deliveries</p>
                                <p className="text-muted-foreground mt-2">Waiting for new orders from your restaurant...</p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
