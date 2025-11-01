'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, PowerOff, Loader2, Mail, Check, X, ShoppingBag, Bell } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDoc, updateDoc, arrayRemove, setDoc, deleteDoc } from 'firebase/firestore';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';


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

const NewOrderCard = ({ order, onAccept }) => {
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
            <Button onClick={() => onAccept(order.id)} className="w-full mt-4 bg-primary hover:bg-primary/90">
                Accept Order
            </Button>
        </motion.div>
    );
};

export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [invites, setInvites] = useState([]);
    const [assignedOrders, setAssignedOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

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

    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-dashboard/login');
            return;
        }

        const driverDocRef = doc(db, 'drivers', user.uid);
        const unsubscribeDriver = onSnapshot(driverDocRef, 
            (doc) => {
                if (doc.exists()) {
                    setDriverData(doc.data());
                    setError('');
                } else {
                    setError('Your rider profile could not be found.');
                }
                setLoading(false);
            },
            (err) => {
                const contextualError = new FirestorePermissionError({
                  path: driverDocRef.path,
                  operation: 'get',
                });
                setError(contextualError.message);
                errorEmitter.emit('permission-error', contextualError);
                setLoading(false);
            }
        );

        const invitesQuery = query(collection(db, 'drivers', user.uid, 'invites'));
        const unsubscribeInvites = onSnapshot(invitesQuery, (snapshot) => {
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const ordersQuery = query(collection(db, 'orders'), where('assignedDriverId', '==', user.uid), where('status', '==', 'ready_for_delivery'));
        const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
            setAssignedOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => {
            unsubscribeDriver();
            unsubscribeInvites();
            unsubscribeOrders();
        };

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
            const driverDocRef = doc(db, 'drivers', user.uid);
            await updateDoc(driverDocRef, {
                currentRestaurantId: invite.restaurantId,
                currentRestaurantName: invite.restaurantName,
            });

            const restaurantRiderRef = doc(db, 'restaurants', invite.restaurantId, 'deliveryBoys', user.uid);
            const userDoc = await getDoc(doc(db, 'users', user.uid));

            await setDoc(restaurantRiderRef, {
                id: user.uid,
                name: user.displayName,
                phone: user.phoneNumber,
                status: 'offline',
                createdAt: new Date(),
                ...userDoc.data(),
            });
            
            await deleteDoc(doc(db, 'drivers', user.uid, 'invites', invite.id));

            setInfoDialog({isOpen: true, title: "Success!", message: `You are now an employee of ${invite.restaurantName}.`});
        } catch (err) {
            console.error("Error accepting invite:", err);
            setInfoDialog({ isOpen: true, title: 'Error', message: "Failed to accept the invitation."});
        }
    };

    const handleDeclineInvite = async (inviteId) => {
        if (!user) return;
        try {
             await deleteDoc(doc(db, 'drivers', user.uid, 'invites', inviteId));
        } catch(err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: "Failed to decline invitation."});
        }
    }

    const handleAcceptOrder = (orderId) => {
        setInfoDialog({isOpen: true, title: "Order Accepted", message: `Order ${orderId.substring(0,6)} has been accepted. You should now proceed to the restaurant.`});
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>
    }

    if(error){
        return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-red-500">{error}</p></div>
    }

    const isOnline = driverData?.status === 'online';

    return (
        <div className="p-4 md:p-6 space-y-6">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false})} title={infoDialog.title} message={infoDialog.message} />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-card p-6 rounded-lg border border-border text-center shadow-lg"
            >
                <button onClick={handleToggleOnline} className={cn("mx-auto w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300", isOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                    {isOnline ? <Power size={48}/> : <PowerOff size={48}/>}
                </button>
                <p className="text-sm text-muted-foreground mt-4">YOUR STATUS</p>
                <p className={cn("text-2xl font-bold mt-1 capitalize", isOnline ? 'text-green-400' : 'text-red-400')}>
                    {driverData?.status || 'Offline'}
                </p>
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
            
            {driverData && driverData.currentRestaurantId && (
                 <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center text-green-400 font-semibold flex items-center justify-center gap-2"
                >
                    <Check size={20}/> You are an employee of: {driverData.currentRestaurantName}
                </motion.div>
            )}
            </AnimatePresence>
            
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                       <Bell className="text-primary"/> New Orders ({assignedOrders.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {assignedOrders.length > 0 ? (
                         <div className="space-y-4">
                            {assignedOrders.map(order => (
                                <NewOrderCard key={order.id} order={order} onAccept={handleAcceptOrder} />
                            ))}
                        </div>
                    ) : (
                         <p className="text-muted-foreground text-center py-8">You have no new orders. Waiting for your restaurant to assign one...</p>
                    )}
                </CardContent>
            </Card>

        </div>
    );
}
