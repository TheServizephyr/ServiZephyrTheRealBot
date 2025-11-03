
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, PowerOff, Loader2, Mail, Check, X, ShoppingBag, Bell, Bike, CheckCircle } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDoc, deleteDoc } from 'firebase/firestore';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { FirestorePermissionError, errorEmitter } from '@/firebase';

const InvitationCard = ({ invite, onAccept, onDecline }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-primary/10 border border-primary/30 rounded-lg p-6 text-center"
        >
            <Mail size={32} className="mx-auto text-primary mb-3"/>
            <h3 className="text-lg font-bold text-foreground">You have a new invitation!</h3>
            <p className="mt-1 text-muted-foreground">
                <span className="font-semibold text-foreground">{invite.restaurantName}</span> wants to add you as a delivery rider.
            </p>
            <div className="mt-4 flex justify-center gap-4">
                <Button onClick={() => onAccept(invite)} variant="default" className="bg-green-500 hover:bg-green-600 text-white"><Check className="mr-2 h-4 w-4"/> Accept</Button>
                <Button onClick={() => onDecline(invite.id)} variant="destructive"><X className="mr-2 h-4 w-4"/> Decline</Button>
            </div>
        </motion.div>
    )
}

const NewOrderCard = ({ order, onAccept, isAccepting }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-card border border-border rounded-lg p-4"
        >
            <div className="flex justify-between items-start">
                <div>
                     <p className="text-xs text-muted-foreground">New Order from</p>
                     <h3 className="font-bold text-lg text-primary">{order.restaurantName}</h3>
                </div>
                <div className="text-right">
                    <p className="font-bold text-lg">₹{order.totalAmount.toFixed(2)}</p>
                     <p className="text-xs text-muted-foreground">ID: #{order.id.substring(0, 6)}</p>
                </div>
            </div>
            <div className="mt-3 pt-3 border-t border-dashed">
                <p className="text-sm font-semibold">To: {order.customerName}</p>
                <p className="text-xs text-muted-foreground">{order.customerAddress}</p>
            </div>
            <Button onClick={() => onAccept(order.id)} className="w-full mt-4 bg-primary hover:bg-primary/90" disabled={isAccepting}>
                {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                Accept & Start Delivery
            </Button>
        </motion.div>
    );
};

// --- START: NEW COMPONENT FOR ACTIVE DELIVERIES ---
const ActiveDeliveryCard = ({ order, onMarkDelivered }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4"
        >
            <div className="flex justify-between items-start">
                <div>
                     <p className="text-xs text-blue-300">Delivering to</p>
                     <h3 className="font-bold text-lg text-foreground">{order.customerName}</h3>
                </div>
                <div className="text-right">
                    <p className="font-bold text-lg text-primary">₹{order.totalAmount.toFixed(2)}</p>
                     <p className="text-xs text-muted-foreground">ID: #{order.id.substring(0, 6)}</p>
                </div>
            </div>
            <div className="mt-3 pt-3 border-t border-dashed border-blue-500/30">
                <p className="text-sm text-muted-foreground">{order.customerAddress}</p>
            </div>
            <Button onClick={() => onMarkDelivered(order.id)} className="w-full mt-4 bg-primary hover:bg-primary/90">
                <CheckCircle className="mr-2 h-4 w-4" /> Mark as Delivered
            </Button>
        </motion.div>
    );
};
// --- END: NEW COMPONENT ---

export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [invites, setInvites] = useState([]);
    const [activeOrders, setActiveOrders] = useState([]); // This will now hold both 'dispatched' and 'on_the_way'
    const [loading, setLoading] = useState(true);
    const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isRestaurantActive, setIsRestaurantActive] = useState(false);


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

    // GPS Tracking useEffect
    useEffect(() => {
        let locationInterval;
        if (driverData?.status === 'online' || driverData?.status === 'on-delivery') {
            locationInterval = setInterval(() => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        handleApiCall('/api/rider/dashboard', 'PATCH', {
                            location: { latitude, longitude }
                        }).catch(err => console.error("GPS: Failed to send location update:", err));
                    },
                    (err) => console.error("GPS: Error getting location:", err),
                    { enableHighAccuracy: true }
                );
            }, 20000); 
        }

        return () => {
            if (locationInterval) clearInterval(locationInterval);
        };
    }, [driverData?.status, handleApiCall]);

    // Main data fetching and real-time listeners
    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-dashboard/login');
            return;
        }

        let unsubscribes = [];

        const driverDocRef = doc(db, 'drivers', user.uid);
        const unsubscribeDriver = onSnapshot(driverDocRef, 
            (driverSnap) => {
                if (driverSnap.exists()) {
                    const data = driverSnap.data();
                    setDriverData(data);
                    setError('');
                    
                    if (data.currentRestaurantId) {
                        const restaurantDocRef = doc(db, 'restaurants', data.currentRestaurantId);
                        const shopDocRef = doc(db, 'shops', data.currentRestaurantId);
                        
                        const unsubRestaurant = onSnapshot(restaurantDocRef, (snap) => setIsRestaurantActive(snap.exists()));
                        const unsubShop = onSnapshot(shopDocRef, (snap) => setIsRestaurantActive(prev => prev || snap.exists()));
                        
                        unsubscribes.push(unsubRestaurant, unsubShop);

                    } else {
                        setIsRestaurantActive(false);
                    }
                } else {
                    setError('Your rider profile could not be found.');
                }
                setLoading(false);
            },
            (err) => {
                 const contextualError = new FirestorePermissionError({ path: driverDocRef.path, operation: 'get' });
                 errorEmitter.emit('permission-error', contextualError);
                 setError("You don't have permission to view this data.");
                 setLoading(false);
            }
        );
        unsubscribes.push(unsubscribeDriver);

        const invitesQuery = query(collection(db, 'drivers', user.uid, 'invites'));
        const unsubscribeInvites = onSnapshot(invitesQuery, (snapshot) => {
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        unsubscribes.push(unsubscribeInvites);
        
        // --- START THE FIX: Listen for both 'dispatched' and 'on_the_way' orders ---
        const ordersQuery = query(collection(db, "orders"), where("deliveryBoyId", "==", user.uid), where("status", "in", ["dispatched", "on_the_way"]));
        // --- END THE FIX ---
        const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
            const newOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveOrders(newOrders);
        });
        unsubscribes.push(unsubscribeOrders);

        return () => unsubscribes.forEach(unsub => unsub());

    }, [user, isUserLoading, router]);

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
            setInfoDialog({isOpen: true, title: "Success!", message: data.message});
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to accept the invitation: ${err.message}`});
        }
    };

    const handleDeclineInvite = async (inviteId) => {
        if (!user) return;
        const inviteDocRef = doc(db, 'drivers', user.uid, 'invites', inviteId);
        try {
             await deleteDoc(inviteDocRef);
        } catch(err) {
            const contextualError = new FirestorePermissionError({ path: inviteDocRef.path, operation: 'delete'});
            errorEmitter.emit('permission-error', contextualError);
            setInfoDialog({ isOpen: true, title: 'Error', message: "Failed to decline invitation."});
        }
    }

    const handleAcceptOrder = async () => {
        setIsAcceptingOrder(true);
        try {
            const orderIds = activeOrders.filter(o => o.status === 'dispatched').map(o => o.id);
            if (orderIds.length === 0) return;
            await handleApiCall('/api/rider/accept-order', 'POST', { orderIds });
            // No need to redirect, the page will update automatically
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not process order acceptance: ${err.message}`});
        } finally {
            setIsAcceptingOrder(false);
        }
    };
    
    // --- START: NEW FUNCTION TO MARK ORDER DELIVERED ---
    const handleMarkDelivered = async (orderId) => {
        try {
            await handleApiCall('/api/rider/update-order-status', 'PATCH', { 
                orderId,
                newStatus: 'delivered'
            });
            // Optimistically remove from UI
            setActiveOrders(prev => prev.filter(o => o.id !== orderId));
        } catch(err) {
            setInfoDialog({ isOpen: true, title: 'Update Failed', message: `Could not mark order as delivered: ${err.message}`});
        }
    }
    // --- END: NEW FUNCTION ---

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>
    }

    if(error && !driverData){
        return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-red-500">{error}</p></div>
    }

    const isOnline = driverData?.status === 'online';
    const isBusy = driverData?.status === 'on-delivery';
    
    const dispatchedOrders = activeOrders.filter(o => o.status === 'dispatched');
    const onTheWayOrders = activeOrders.filter(o => o.status === 'on_the_way');

    return (
        <div className="p-4 md:p-6 space-y-6">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen:false})} title={infoDialog.title} message={infoDialog.message} />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-card p-6 rounded-lg border border-border text-center shadow-lg"
            >
                <button 
                    onClick={handleToggleOnline} 
                    disabled={isBusy}
                    className={cn(
                        "mx-auto w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300", 
                        isOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400",
                        isBusy && "bg-blue-500/20 text-blue-400 cursor-not-allowed"
                    )}
                >
                    {isOnline || isBusy ? <Power size={48}/> : <PowerOff size={48}/>}
                </button>
                <p className="text-sm text-muted-foreground mt-4">YOUR STATUS</p>
                <p className={cn("text-2xl font-bold mt-1 capitalize", isOnline ? 'text-green-400' : isBusy ? 'text-blue-400' : 'text-red-400')}>
                    {driverData?.status?.replace('-', ' ') || 'Offline'}
                </p>
                {isBusy && <p className="text-xs text-blue-400">Complete current delivery to go offline.</p>}
            </motion.div>

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
            
            {/* --- START: NEW ACTIVE DELIVERIES SECTION --- */}
            {onTheWayOrders.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3 text-blue-400">
                            <Bike className="animate-pulse" /> Active Deliveries ({onTheWayOrders.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {onTheWayOrders.map(order => (
                            <ActiveDeliveryCard key={order.id} order={order} onMarkDelivered={handleMarkDelivered}/>
                        ))}
                         <Button onClick={() => router.push('/rider-dashboard/track')} className="w-full mt-4">
                            View on Map
                        </Button>
                    </CardContent>
                </Card>
            )}
            {/* --- END: NEW ACTIVE DELIVERIES SECTION --- */}
            
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                       <Bell className="text-primary"/> New Orders ({dispatchedOrders.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {dispatchedOrders.length > 0 ? (
                         <div className="space-y-4">
                            {dispatchedOrders.map(order => (
                                <NewOrderCard key={order.id} order={order} onAccept={() => {}} isAccepting={isAcceptingOrder} />
                            ))}
                            <Button onClick={handleAcceptOrder} className="w-full mt-4 bg-primary hover:bg-primary/90" disabled={isAcceptingOrder}>
                                {isAcceptingOrder ? <Loader2 className="animate-spin mr-2"/> : null}
                                Accept All ({dispatchedOrders.length}) & Start
                            </Button>
                        </div>
                    ) : (
                         <p className="text-muted-foreground text-center py-8">You have no new orders. Waiting for your restaurant to assign one...</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
