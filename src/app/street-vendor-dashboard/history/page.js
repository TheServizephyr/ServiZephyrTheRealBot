'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { useUser } from '@/firebase';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function OrderHistoryPage() {
    const { user, loading: isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [date, setDate] = useState({ from: new Date(), to: new Date() });
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Fetch Vendor ID
    useEffect(() => {
        if (isUserLoading || !user) return;

        const fetchVendorId = async () => {
            try {
                const q = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    setVendorId(snapshot.docs[0].id);
                }
            } catch (err) {
                console.error("Error fetching vendor ID:", err);
                setError("Could not load vendor profile.");
            }
        };

        fetchVendorId();
    }, [user, isUserLoading]);

    const fetchHistory = async () => {
        if (!vendorId || !date?.from) return;

        setLoading(true);
        setError(null);
        setOrders([]);

        try {
            const start = startOfDay(date.from);
            const end = date.to ? endOfDay(date.to) : endOfDay(date.from);

            const q = query(
                collection(db, 'orders'),
                where('restaurantId', '==', vendorId),
                where('orderDate', '>=', Timestamp.fromDate(start)),
                where('orderDate', '<=', Timestamp.fromDate(end)),
                orderBy('orderDate', 'desc')
            );

            const snapshot = await getDocs(q);
            const fetchedOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            setOrders(fetchedOrders);
        } catch (err) {
            console.error("Error fetching history:", err);
            setError("Failed to load history. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Filter Logic
    const filteredOrders = useMemo(() => {
        let items = [...orders];

        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            items = items.filter(order =>
                order.customerName?.toLowerCase().includes(lowerQuery) ||
                order.trackingToken?.toLowerCase().includes(lowerQuery) ||
                order.id.toLowerCase().includes(lowerQuery)
            );
        }
        return items;
    }, [orders, searchQuery]);

    const completedOrders = useMemo(() => filteredOrders.filter(o => ['delivered', 'picked_up'].includes(o.status)), [filteredOrders]);
    const cancelledOrders = useMemo(() => filteredOrders.filter(o => ['rejected', 'cancelled'].includes(o.status)), [filteredOrders]);

    const OrderList = ({ items, emptyMessage }) => (
        <div className="space-y-4">
            {items.length === 0 && (
                <div className="text-center text-muted-foreground py-10">
                    {emptyMessage}
                </div>
            )}
            <AnimatePresence>
                {items.map((order) => (
                    <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-card border border-border p-4 rounded-xl shadow-sm"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="font-bold text-lg">{order.customerName || 'Guest'}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {order.orderDate ? format(order.orderDate.toDate(), 'dd MMM, p') : ''}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Token: {order.trackingToken || 'N/A'}</p>
                            </div>
                            <div className={cn(
                                "px-2 py-1 rounded text-xs font-bold uppercase",
                                order.status === 'delivered' || order.status === 'picked_up' ? "bg-green-100 text-green-700" :
                                    order.status === 'rejected' || order.status === 'cancelled' ? "bg-red-100 text-red-700" :
                                        "bg-gray-100 text-gray-700"
                            )}>
                                {order.status}
                            </div>
                        </div>
                        <div className="space-y-1 mb-3">
                            {order.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm">
                                    <span>{item.quantity}x {item.name}</span>
                                    <span className="text-muted-foreground">{formatCurrency(item.totalPrice)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-dashed">
                            <span className="font-bold">Total</span>
                            <span className="font-bold text-primary">{formatCurrency(order.totalAmount)}</span>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4 pb-24">
            <header className="flex items-center gap-4 mb-6">
                <Link href="/street-vendor-dashboard">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold font-headline">Order History</h1>
            </header>

            <div className="bg-card border border-border p-4 rounded-xl shadow-sm mb-6 space-y-4">
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-muted-foreground">Select Date Range</label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date?.from ? (
                                    date.to ? (
                                        <>
                                            {format(date.from, "LLL dd, y")} -{" "}
                                            {format(date.to, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(date.from, "LLL dd, y")
                                    )
                                ) : (
                                    <span>Pick a date</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={date?.from}
                                selected={date}
                                onSelect={setDate}
                                numberOfMonths={1}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                <Button onClick={fetchHistory} disabled={loading || !vendorId} className="w-full">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Fetch History
                </Button>
            </div>

            {orders.length > 0 && (
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by Name or Token..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                    />
                </div>
            )}

            {error && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg mb-6 text-center">
                    {error}
                </div>
            )}

            {!loading && !error && (
                <Tabs defaultValue="completed" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                        <TabsTrigger value="completed">Completed ({completedOrders.length})</TabsTrigger>
                        <TabsTrigger value="cancelled">Cancelled ({cancelledOrders.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="completed">
                        <OrderList items={completedOrders} emptyMessage="No completed orders found." />
                    </TabsContent>
                    <TabsContent value="cancelled">
                        <OrderList items={cancelledOrders} emptyMessage="No cancelled orders found." />
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
