'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { QrCode, ClipboardList, Package, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';

const OrderCard = ({ order, onMarkReady, onCancel }) => {
  const isReady = order.status === 'Ready';
  return (
    <motion.div
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`bg-slate-800 rounded-lg p-6 border-l-4 ${isReady ? 'border-green-500' : 'border-yellow-500'}`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-5xl font-bold text-white">#{order.token}</p>
          <p className="text-slate-400 text-lg mt-2">{order.items.map(item => `${item.quantity}x ${item.name}`).join(', ')}</p>
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
        if (!user) return;

        const fetchVendorId = async () => {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists() && userDoc.data().role === 'street-vendor') {
                const streetVendorQuery = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid), limit(1));
                const vendorSnapshot = await getDocs(streetVendorQuery);
                if (!vendorSnapshot.empty) {
                    const vendorDoc = vendorSnapshot.docs[0];
                    setVendorId(vendorDoc.id);
                }
            }
            setLoading(false);
        };

        fetchVendorId();

    }, [user, isUserLoading]);

    useEffect(() => {
        if (!vendorId) return;

        const q = query(
            collection(db, "orders"), 
            where("restaurantId", "==", vendorId),
            where("status", "in", ["Preparing", "Ready"])
        );
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const liveOrders = [];
            querySnapshot.forEach((doc) => {
                liveOrders.push({ id: doc.id, ...doc.data() });
            });
            // Sort by token number
            liveOrders.sort((a,b) => a.token - b.token);
            setOrders(liveOrders);
        });

        return () => unsubscribe();
    }, [vendorId]);
    
    const handleMarkReady = async (orderId) => {
        const orderRef = doc(db, 'orders', orderId);
        await updateDoc(orderRef, { status: 'Ready' });
        // TODO: Trigger WhatsApp notification here in a real scenario
    };
    
    const handleCancelOrder = async (orderId) => {
        const orderRef = doc(db, 'orders', orderId);
        await updateDoc(orderRef, { status: 'Cancelled' });
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white font-body p-4">
            <header className="flex justify-between items-center mb-6">
                 <Link href="/street-vendor-dashboard/qr" passHref>
                    <Button variant="ghost" className="text-slate-400 hover:text-white">
                        <QrCode size={28} />
                    </Button>
                 </Link>
                 <h1 className="text-2xl font-bold font-headline">Live Orders</h1>
                 <Link href="/street-vendor-dashboard/menu" passHref>
                    <Button variant="ghost" className="text-slate-400 hover:text-white">
                        <ClipboardList size={28} />
                    </Button>
                 </Link>
            </header>
            
            <main>
                <div className="space-y-4">
                     {loading ? (
                        <div className="text-center py-20 text-slate-500">
                            <Loader2 className="mx-auto animate-spin" size={48} />
                            <p className="mt-4">Loading your dashboard...</p>
                        </div>
                     ) : orders.length > 0 ? (
                        orders.map(order => (
                            <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancel={handleCancelOrder} />
                        ))
                     ) : (
                        <div className="text-center py-20 text-slate-500">
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
