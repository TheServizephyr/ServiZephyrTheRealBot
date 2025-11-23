'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Loader2, Search, Wallet, IndianRupee, User, Phone } from 'lucide-react';
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

        {
            orders.length > 0 && (
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
            )
        }

        {
            error && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg mb-6 text-center">
                    {error}
                </div>
            )
        }

        {
            !loading && !error && (
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
            )
        }
        </div >
    );
}
