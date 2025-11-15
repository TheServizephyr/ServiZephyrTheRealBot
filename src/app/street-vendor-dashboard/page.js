'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, QrCode, CookingPot, PackageCheck, Check, X, Loader2, User, Phone, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';


const OrderCard = ({ order, onMarkReady, onCancel, onMarkCollected }) => {
    const token = order.id.slice(-4).toUpperCase();
    const isPending = order.status === 'pending';
    const isReady = order.status === 'Ready';

    let cardClass = 'border-yellow-500 bg-yellow-500/10';
    let statusClass = 'text-yellow-400';
    if (isReady) {
        cardClass = 'border-green-500 bg-green-500/10';
        statusClass = 'text-green-400';
    }

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={`bg-card rounded-lg p-4 flex flex-col justify-between border-l-4 ${cardClass}`}
        >
            <div>
                <div className="flex justify-between items-start">
                    <p className="text-4xl font-bold text-foreground">#{token}</p>
                    <div className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClass} bg-opacity-20`}>{order.status}</div>
                </div>
                <div className="mt-4 text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                        <User size={16}/>
                        <span className="font-semibold text-foreground text-lg">{order.customerName}</span>
                    </div>
                    {order.customerPhone && (
                        <div className="flex items-center gap-2 text-sm">
                            <Phone size={14}/>
                            <span>{order.customerPhone}</span>
                        </div>
                    )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-border/50">
                    <p className="font-semibold text-foreground">Items:</p>
                    <ul className="list-disc list-inside text-muted-foreground text-sm">
                        {order.items.map(item => (
                            <li key={item.name}>{item.quantity}x {item.name}</li>
                        ))}
                    </ul>
                </div>
            </div>
            <div className="mt-4">
                {isPending && (
                    <div className="grid grid-cols-2 gap-2">
                         <Button onClick={() => onCancel(order.id)} variant="destructive" className="h-12 text-base">
                            <X className="mr-2" /> Cancel
                        </Button>
                        <Button onClick={() => onMarkReady(order.id)} className="bg-primary h-12 text-base">
                            <CookingPot className="mr-2" /> Mark Ready
                        </Button>
                    </div>
                )}
                {isReady && (
                     <Button onClick={() => onMarkCollected(order.id)} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-lg h-12">
                        <PackageCheck className="mr-2" /> Mark as Collected
                    </Button>
                )}
            </div>
        </motion.div>
    );
};


export default function StreetVendorDashboard() {
    const { user, isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        if (isUserLoading || !user) {
            if(!isUserLoading) setLoading(false);
            return;
        }

        const q = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            if (!querySnapshot.empty) {
                const vendorDoc = querySnapshot.docs[0];
                setVendorId(vendorDoc.id);
            } else {
                setLoading(false);
            }
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: `street_vendors`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Error fetching vendor ID:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, isUserLoading]);

    useEffect(() => {
        if (!vendorId) return;

        const q = query(
            collection(db, "orders"), 
            where("restaurantId", "==", vendorId),
            where("status", "in", ["pending", "Ready"])
        );
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const liveOrders = [];
            querySnapshot.forEach((doc) => {
                liveOrders.push({ id: doc.id, ...doc.data() });
            });
            // New orders first
            liveOrders.sort((a,b) => (b.orderDate?.seconds || 0) - (a.orderDate?.seconds || 0));
            setOrders(liveOrders);
            setLoading(false);
        }, (err) => {
             const contextualError = new FirestorePermissionError({ path: `orders`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId]);
    
    const handleUpdateStatus = async (orderId, newStatus) => {
        try {
            const idToken = await user.getIdToken();
            const response = await fetch('/api/owner/orders', {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                 },
                body: JSON.stringify({ orderId, newStatus }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update order status');
            }
        } catch (error) {
             setInfoDialog({isOpen: true, title: "Error", message: error.message});
        }
    };

    const handleMarkReady = (orderId) => handleUpdateStatus(orderId, 'Ready');
    const handleCancelOrder = (orderId) => handleUpdateStatus(orderId, 'Cancelled');
    const handleMarkCollected = (orderId) => handleUpdateStatus(orderId, 'delivered');
    
    const pendingOrders = useMemo(() => orders.filter(o => o.status === 'pending'), [orders]);
    const readyOrders = useMemo(() => orders.filter(o => o.status === 'Ready'), [orders]);

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4">
             <InfoDialog 
                isOpen={infoDialog.isOpen} 
                onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
                title={infoDialog.title} 
                message={infoDialog.message}
            />
            <header className="flex justify-between items-center mb-6">
                 <Link href="/street-vendor-dashboard/qr" passHref>
                    <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                        <QrCode size={28} />
                    </Button>
                 </Link>
                 <h1 className="text-2xl font-bold font-headline">Live Orders</h1>
                 <div className="flex gap-2">
                     <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                        <History size={28} />
                    </Button>
                     <Link href="/street-vendor-dashboard/menu" passHref>
                        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                            <ClipboardList size={28} />
                        </Button>
                     </Link>
                 </div>
            </header>
            
            <main>
                {loading ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <Loader2 className="mx-auto animate-spin" size={48} />
                        <p className="mt-4">Loading your dashboard...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                        <div className="space-y-4">
                            <h2 className="text-xl font-bold text-yellow-400">New Orders ({pendingOrders.length})</h2>
                            <AnimatePresence>
                                {pendingOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancel={handleCancelOrder} />
                                ))}
                            </AnimatePresence>
                            {pendingOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No new orders waiting.</p>}
                        </div>
                         <div className="space-y-4">
                            <h2 className="text-xl font-bold text-green-400">Ready for Pickup ({readyOrders.length})</h2>
                            <AnimatePresence>
                                {readyOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkCollected={handleMarkCollected} />
                                ))}
                            </AnimatePresence>
                             {readyOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No orders are ready for pickup.</p>}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
