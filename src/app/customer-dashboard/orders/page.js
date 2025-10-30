'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingBag, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { useUser } from '@/firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const OrderCard = ({ order }) => {
    const statusClasses = {
        Delivered: 'bg-green-500/10 text-green-400',
        Cancelled: 'bg-red-500/10 text-red-400',
        Rejected: 'bg-red-500/10 text-red-400',
        'In Progress': 'bg-blue-500/10 text-blue-400',
        'Pending': 'bg-yellow-500/10 text-yellow-400',
        'Confirmed': 'bg-blue-500/10 text-blue-400',
        'Preparing': 'bg-orange-500/10 text-orange-400',
        'Dispatched': 'bg-indigo-500/10 text-indigo-400',
        'Picked Up': 'bg-green-500/10 text-green-400',
    };

    const statusText = (order.status || 'pending').replace('_', ' ');
    const capitalizedStatus = statusText.charAt(0).toUpperCase() + statusText.slice(1);

    const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4"
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs text-muted-foreground">#{order.id}</p>
                    <h3 className="font-bold text-lg text-foreground">{order.restaurantName || 'Unnamed Restaurant'}</h3>
                </div>
                <div className={`px-3 py-1 text-xs font-semibold rounded-full ${statusClasses[capitalizedStatus] || 'bg-gray-500/10 text-gray-400'}`}>
                    {capitalizedStatus}
                </div>
            </div>
            <div className="mt-4 border-t border-dashed border-border pt-4">
                <p className="text-sm text-muted-foreground">{(order.items || []).map(i => `${i.qty}x ${i.name}`).join(', ')}</p>
                <div className="flex justify-between items-center mt-2">
                    <p className="text-sm text-muted-foreground">
                        {orderDate ? orderDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                    </p>
                    <p className="font-bold text-lg text-foreground">₹{order.totalAmount?.toFixed(2)}</p>
                </div>
            </div>
        </motion.div>
    );
};

export default function MyOrdersPage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isUserLoading) {
            return;
        }
        if (!user) {
            setError("Please log in to view your orders.");
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        
        // **THE FIX:** Remove the orderBy from the Firestore query
        const q = query(
            collection(db, "orders"), 
            where("customerId", "==", user.uid)
        );

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const customerOrders = [];
            querySnapshot.forEach((doc) => {
                customerOrders.push({ id: doc.id, ...doc.data() });
            });
            
            // **THE FIX:** Sort the orders on the client-side after fetching
            customerOrders.sort((a, b) => {
                const dateA = a.orderDate?.toDate ? a.orderDate.toDate() : new Date(a.orderDate);
                const dateB = b.orderDate?.toDate ? b.orderDate.toDate() : new Date(b.orderDate);
                return dateB - dateA;
            });

            setOrders(customerOrders);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching orders:", err);
            setError("Failed to fetch orders. Please try again.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, isUserLoading]);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <header className="flex items-center gap-4">
                 <Button variant="ghost" size="icon" onClick={() => router.push('/customer-dashboard/profile')}><ArrowLeft/></Button>
                 <div>
                    <h1 className="text-3xl font-bold tracking-tight">My Orders</h1>
                    <p className="text-muted-foreground mt-1">A history of all your past and current orders.</p>
                 </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary h-12 w-12"/></div>
            ) : error ? (
                 <div className="text-center py-20 text-destructive border-2 border-dashed border-destructive/30 rounded-xl">
                    <p className="mt-4 font-semibold">Error loading orders</p>
                    <p className="text-sm">{error}</p>
                </div>
            ) : orders.length > 0 ? (
                 <div className="space-y-4">
                    {orders.map(order => (
                        <OrderCard key={order.id} order={order} />
                    ))}
                 </div>
            ) : (
                <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 font-semibold">No Orders Yet</p>
                    <p className="text-sm">You haven't placed any orders. Let's change that!</p>
                </div>
            )}
        </div>
    );
}
