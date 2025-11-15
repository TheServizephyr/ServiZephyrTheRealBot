'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode, ClipboardList, Package, Check, X, Loader2, User, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';


const OrderCard = ({ order, onMarkReady, onCancel }) => {
  const isReady = order.status === 'Ready';
  // Use last 4 chars of order ID as a simple, unique token for now
  const token = order.id.slice(-4).toUpperCase();

  return (
    <motion.div
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`bg-card rounded-lg p-6 border-l-4 ${isReady ? 'border-green-500' : 'border-yellow-500'} shadow-lg`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-5xl font-bold text-foreground">#{token}</p>
          <div className="mt-2 text-muted-foreground space-y-1">
             <div className="flex items-center gap-2 text-lg">
                <User size={16}/>
                <span className="font-semibold text-foreground">{order.customerName}</span>
             </div>
             {order.customerPhone && (
                <div className="flex items-center gap-2 text-sm">
                    <Phone size={14}/>
                    <span>{order.customerPhone}</span>
                </div>
             )}
          </div>
          <p className="text-slate-400 text-lg mt-4">{order.items.map(item => `${item.quantity}x ${item.name}`).join(', ')}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${isReady ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
          {order.status}
        </div>
      </div>
      {!isReady && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <Button onClick={() => onMarkReady(order.id)} className="bg-green-600 hover:bg-green-700 text-white font-bold text-lg h-14">
            <Check className="mr-2" /> Ready for Pickup
          </Button>
          <Button onClick={() => onCancel(order.id)} variant="destructive" className="font-bold text-lg h-14">
            <X className="mr-2" /> Cancel Order
          </Button>
        </div>
      )}
    </motion.div>
  );
};


export default function StreetVendorDashboard() {
    const { user, isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            setLoading(false);
            return;
        };

        const fetchVendorData = async () => {
            try {
                const q = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                     const vendorDoc = querySnapshot.docs[0];
                    setVendorId(vendorDoc.id);
                } else {
                    setLoading(false);
                }
            } catch (err) {
                const contextualError = new FirestorePermissionError({ path: `street_vendors`, operation: 'list' });
                errorEmitter.emit('permission-error', contextualError);
                console.error("Error fetching vendor ID:", err);
                setLoading(false);
            }
        };
        fetchVendorData();

    }, [user, isUserLoading]);

    useEffect(() => {
        if (!vendorId) return;

        const q = query(
            collection(db, "orders"), 
            where("restaurantId", "==", vendorId),
            where("status", "in", ["pending", "Preparing", "Ready"])
        );
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const liveOrders = [];
            querySnapshot.forEach((doc) => {
                liveOrders.push({ id: doc.id, ...doc.data() });
            });
            liveOrders.sort((a,b) => (a.orderDate?.seconds || 0) - (b.orderDate?.seconds || 0));
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
    
    const handleUpdateStatus = (orderId, newStatus) => {
        const orderRef = doc(db, 'orders', orderId);
        const updateData = { status: newStatus };
        updateDoc(orderRef, updateData).catch(() => {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: orderRef.path,
                operation: 'update',
                requestResourceData: updateData
            }));
        });
    };

    const handleMarkReady = (orderId) => handleUpdateStatus(orderId, 'Ready');
    const handleCancelOrder = (orderId) => handleUpdateStatus(orderId, 'Cancelled');

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4">
            <header className="flex justify-between items-center mb-6">
                 <Link href="/street-vendor-dashboard/qr" passHref>
                    <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                        <QrCode size={28} />
                    </Button>
                 </Link>
                 <h1 className="text-2xl font-bold font-headline">Live Orders</h1>
                 <Link href="/street-vendor-dashboard/menu" passHref>
                    <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                        <ClipboardList size={28} />
                    </Button>
                 </Link>
            </header>
            
            <main>
                <div className="space-y-4">
                     {loading ? (
                        <div className="text-center py-20 text-muted-foreground">
                            <Loader2 className="mx-auto animate-spin" size={48} />
                            <p className="mt-4">Loading your dashboard...</p>
                        </div>
                     ) : orders.length > 0 ? (
                        <AnimatePresence>
                            {orders.map(order => (
                                <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancel={handleCancelOrder} />
                            ))}
                        </AnimatePresence>
                     ) : (
                        <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                            <Package size={48} className="mx-auto" />
                            <p className="mt-4 text-lg font-semibold">No live orders right now.</p>
                            <p>New pre-paid orders will appear here automatically.</p>
                        </div>
                     )}
                </div>
            </main>
        </div>
    );
}
