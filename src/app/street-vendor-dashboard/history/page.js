'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, startOfDay, endOfDay, isToday } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Loader2, Search, Wallet, IndianRupee, User, Phone, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { useUser } from '@/firebase';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RefundDialog from '@/components/RefundDialog';
import { useToast } from '@/components/ui/use-toast';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function OrderHistoryPage() {
    const { user, loading: isUserLoading } = useUser();
    const { toast } = useToast();
    const [date, setDate] = useState({ from: new Date(), to: new Date() });
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [refundDialogOpen, setRefundDialogOpen] = useState(false);
    const [selectedOrderForRefund, setSelectedOrderForRefund] = useState(null);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    // Auto-load today's data on page load
    useEffect(() => {
        if (isUserLoading || !user) return;

        const loadTodayData = () => {
            // Check if today's data is in localStorage
            const cachedData = localStorage.getItem('history_today_cache');
            const cacheDate = localStorage.getItem('history_cache_date');
            const todayStr = format(new Date(), 'yyyy-MM-dd');

            if (cachedData && cacheDate === todayStr) {
                // Use cached data
                console.log("Loading today's data from cache");
                setOrders(JSON.parse(cachedData));
            } else {
                // Fetch fresh data for today
                console.log("Fetching fresh data for today");
                fetchTodayHistory();
            }
        };

        loadTodayData();
    }, [user, isUserLoading, impersonatedOwnerId]);

    const fetchTodayHistory = async () => {
        setLoading(true);
        setError(null);

        try {
            const today = new Date();
            const start = startOfDay(today).toISOString();
            const end = endOfDay(today).toISOString();
            const idToken = await user.getIdToken();

            let url = `/api/owner/orders?startDate=${start}&endDate=${end}`;
            if (impersonatedOwnerId) {
                url += `&impersonate_owner_id=${impersonatedOwnerId}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) throw new Error('Failed to fetch history');

            const data = await res.json();
            const fetchedOrders = data.orders || [];

            setOrders(fetchedOrders);

            // Cache today's data in localStorage
            const todayStr = format(new Date(), 'yyyy-MM-dd');
            localStorage.setItem('history_today_cache', JSON.stringify(fetchedOrders));
            localStorage.setItem('history_cache_date', todayStr);
        } catch (err) {
            console.error("Error fetching today's history:", err);
            setError("Failed to load today's history. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async () => {
        if (!date?.from) return;

        setLoading(true);
        setError(null);
        setOrders([]);

        try {
            const start = startOfDay(date.from).toISOString();
            const end = date.to ? endOfDay(date.to).toISOString() : endOfDay(date.from).toISOString();
            const idToken = await user.getIdToken();

            let url = `/api/owner/orders?startDate=${start}&endDate=${end}`;
            if (impersonatedOwnerId) {
                url += `&impersonate_owner_id=${impersonatedOwnerId}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) throw new Error('Failed to fetch history');

            const data = await res.json();
            const fetchedOrders = data.orders || [];

            setOrders(fetchedOrders);

            // If fetching today's data, update cache
            if (isToday(date.from) && (!date.to || isToday(date.to))) {
                const todayStr = format(new Date(), 'yyyy-MM-dd');
                localStorage.setItem('history_today_cache', JSON.stringify(fetchedOrders));
                localStorage.setItem('history_cache_date', todayStr);
            }
        } catch (err) {
            console.error("Error fetching history:", err);
            setError("Failed to load history. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Filter Logic
    const handleRefundSuccess = (data) => {
        toast({
            title: "Refund Processed Successfully",
            description: `₹${data.amount.toFixed(2)} will be credited to customer's account in ${data.expectedCreditDays}`,
        });

        // Refresh orders to show updated refund status
        if (isToday(date.from)) {
            fetchTodayHistory();
        } else {
            fetchHistory();
        }
    };

    const handleRefundClick = (order) => {
        setSelectedOrderForRefund(order);
        setRefundDialogOpen(true);
    };

    const canRefund = (order) => {
        // Check if order can be refunded
        const validStatuses = ['completed', 'delivered', 'cancelled'];
        if (!validStatuses.includes(order.status)) return false;

        // Check if already fully refunded
        if (order.refundStatus === 'completed') return false;

        // Check if payment was online
        const paymentDetails = order.paymentDetails || [];
        const hasOnlinePayment = Array.isArray(paymentDetails) && paymentDetails.some(p => p.method === 'razorpay' && p.razorpay_payment_id);
        if (!hasOnlinePayment) return false;

        // Check 7-day limit
        const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
        const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceOrder > 7) return false;

        return true;
    };

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.length === 0 && (
                <div className="text-center text-muted-foreground py-10 col-span-full">
                    {emptyMessage}
                </div>
            )}
            <AnimatePresence>
                {items.map((order) => {
                    const token = order.dineInToken || order.trackingToken || 'N/A';

                    let statusClass = 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
                    let borderClass = 'border-yellow-500';
                    if (order.status === 'delivered' || order.status === 'picked_up') {
                        statusClass = 'text-blue-500 bg-blue-500/10 border-blue-500/20';
                        borderClass = 'border-blue-500';
                    } else if (order.status === 'rejected' || order.status === 'cancelled') {
                        statusClass = 'text-red-500 bg-red-500/10 border-red-500/20';
                        borderClass = 'border-red-500';
                    }

                    // Payment Logic
                    const paymentDetailsArray = Array.isArray(order.paymentDetails) ? order.paymentDetails : [order.paymentDetails].filter(Boolean);
                    const amountPaidOnline = paymentDetailsArray
                        .filter(p => p.method === 'razorpay' && p.status === 'paid')
                        .reduce((sum, p) => sum + (p.amount || 0), 0);
                    const amountDueAtCounter = (order.totalAmount || 0) - amountPaidOnline;
                    const isFullyPaidOnline = amountPaidOnline >= (order.totalAmount || 0);
                    const isPartiallyPaid = amountPaidOnline > 0 && amountDueAtCounter > 0.01;

                    return (
                        <motion.div
                            key={order.id}
                            layout
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                            className={cn("rounded-lg p-4 flex flex-col justify-between border-l-4 bg-card shadow-lg hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300", borderClass)}
                        >
                            <div>
                                <div className="flex justify-between items-start">
                                    <p className="text-4xl font-bold text-foreground">{token}</p>
                                    <div className="text-right">
                                        <div className={cn('px-2 py-1 text-xs font-semibold rounded-full border bg-opacity-20 capitalize', statusClass)}>{order.status}</div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {order.orderDate ? format(
                                                order.orderDate.toDate ? order.orderDate.toDate() : new Date(order.orderDate.seconds * 1000 || order.orderDate),
                                                'dd/MM, p'
                                            ) : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center mt-2 border-b border-dashed border-border pb-3 mb-3">
                                    <p className="text-3xl font-bold text-green-500">{formatCurrency(order.totalAmount)}</p>
                                    {isFullyPaidOnline ? (
                                        <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                                            <Wallet size={14} /> PAID ONLINE
                                        </div>
                                    ) : isPartiallyPaid ? (
                                        <div className="text-right">
                                            <span className="block text-xs font-semibold text-green-500">Paid: {formatCurrency(amountPaidOnline)}</span>
                                            <span className="block text-xs font-semibold text-yellow-400">Due: {formatCurrency(amountDueAtCounter)}</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                            <IndianRupee size={14} /> PAY AT COUNTER
                                        </div>
                                    )}
                                </div>

                                <div className="mt-2 text-muted-foreground space-y-1">
                                    <div className="flex items-center gap-2">
                                        <User size={16} />
                                        <span className="font-semibold text-foreground text-lg">{order.customerName || 'Guest'}</span>
                                    </div>
                                    {order.customerPhone && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <Phone size={14} />
                                            <span>{order.customerPhone}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-3 pt-3 border-t border-dashed border-border">
                                    <p className="font-semibold text-foreground">Items:</p>
                                    <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                                        {order.items.map((item, idx) => {
                                            const portionName = item.portion?.name;
                                            const addOns = (item.selectedAddOns || [])
                                                .map(addon => `${addon.quantity}x ${addon.name}`)
                                                .join(', ');
                                            return (
                                                <li key={idx}>
                                                    {item.quantity || item.qty}x {item.name}
                                                    {portionName && portionName.toLowerCase() !== 'full' && ` - ${portionName}`}
                                                    {addOns && <span className="text-xs text-primary block pl-4">({addOns})</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                                {order.status === 'rejected' && order.rejectionReason && (
                                    <div className="mt-3 pt-3 border-t border-dashed border-border text-red-500 text-sm">
                                        <p className="font-bold">Reason for Rejection:</p>
                                        <p>{order.rejectionReason}</p>
                                    </div>
                                )}

                                {/* Refund Status Badge */}
                                {order.refundStatus && order.refundStatus !== 'none' && (
                                    <div className="mt-3 pt-3 border-t border-dashed border-border">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-semibold text-blue-500">
                                                    {order.refundStatus === 'completed' ? '✓ Fully Refunded' : '⚠ Partially Refunded'}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Amount: ₹{(order.refundAmount || 0).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Refund Button */}
                                {canRefund(order) && (
                                    <div className="mt-3 pt-3 border-t border-dashed border-border">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            onClick={() => handleRefundClick(order)}
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Process Refund
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4 pb-24">
            <header className="flex items-center gap-4 mb-6">
                <Link href={impersonatedOwnerId ? `/street-vendor-dashboard?impersonate_owner_id=${impersonatedOwnerId}` : "/street-vendor-dashboard"}>
                    <Button variant="ghost" size="icon">
                        <ArrowLeft />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold font-headline">Order History</h1>
            </header>

            <div className="bg-card border border-border p-4 rounded-xl shadow-sm mb-6 flex justify-center">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            className={cn(
                                "justify-start text-left font-normal h-12 text-lg bg-green-600 hover:bg-green-700 text-white px-6"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-5 w-5" />
                            <span>Fetch History</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <div className="p-3 space-y-3">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={date?.from}
                                selected={date}
                                onSelect={setDate}
                                numberOfMonths={1}
                            />
                            <Button
                                onClick={fetchHistory}
                                disabled={loading || !date?.from}
                                className="w-full"
                            >
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Search History
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
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

            {/* Refund Dialog */}
            {selectedOrderForRefund && (
                <RefundDialog
                    order={selectedOrderForRefund}
                    open={refundDialogOpen}
                    onOpenChange={setRefundDialogOpen}
                    onRefundSuccess={handleRefundSuccess}
                />
            )}
        </div>
    );
}
