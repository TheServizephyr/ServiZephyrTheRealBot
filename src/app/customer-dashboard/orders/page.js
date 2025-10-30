'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingBag, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

// Mock Data
const mockOrders = [
    { id: 'ORD-1234', restaurant: "Baghel's Restaurant", date: '2024-05-20', amount: 450, status: 'Delivered', items: ['Paneer Tikka', 'Butter Naan'] },
    { id: 'ORD-5678', restaurant: "Pizza Point", date: '2024-05-18', amount: 800, status: 'Delivered', items: ['Margherita Pizza', 'Coke'] },
    { id: 'ORD-9101', restaurant: "Curry Corner", date: '2024-05-15', amount: 650, status: 'Cancelled', items: ['Butter Chicken', 'Garlic Naan'] },
];

const OrderCard = ({ order }) => {
    const statusClasses = {
        Delivered: 'bg-green-500/10 text-green-400',
        Cancelled: 'bg-red-500/10 text-red-400',
        'In Progress': 'bg-blue-500/10 text-blue-400',
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4"
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs text-muted-foreground">#{order.id}</p>
                    <h3 className="font-bold text-lg text-foreground">{order.restaurant}</h3>
                </div>
                <div className={`px-3 py-1 text-xs font-semibold rounded-full ${statusClasses[order.status]}`}>
                    {order.status}
                </div>
            </div>
            <div className="mt-4 border-t border-dashed border-border pt-4">
                <p className="text-sm text-muted-foreground">{order.items.join(', ')}</p>
                <div className="flex justify-between items-center mt-2">
                    <p className="text-sm text-muted-foreground">{new Date(order.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    <p className="font-bold text-lg text-foreground">₹{order.amount}</p>
                </div>
            </div>
        </motion.div>
    );
};

export default function MyOrdersPage() {
    const router = useRouter();
    // In a real app, you would fetch this data
    const loading = false;
    const orders = mockOrders;

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
