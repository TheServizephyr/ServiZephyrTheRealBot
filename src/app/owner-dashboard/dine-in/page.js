
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const TableCard = ({ tableId, orders }) => {
    const totalBill = useMemo(() => orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0), [orders]);
    const customerNames = useMemo(() => [...new Set(orders.map(o => o.customerName))], [orders]);
    const allItems = useMemo(() => {
        const itemMap = new Map();
        orders.forEach(order => {
            (order.items || []).forEach(item => {
                const existing = itemMap.get(item.name);
                if (existing) {
                    itemMap.set(item.name, { ...existing, qty: existing.qty + item.qty });
                } else {
                    itemMap.set(item.name, { ...item });
                }
            });
        });
        return Array.from(itemMap.values());
    }, [orders]);

    const latestOrderTime = useMemo(() => {
        if (orders.length === 0) return null;
        const latestTimestamp = Math.max(...orders.map(o => o.orderDate.seconds ? o.orderDate.seconds * 1000 : new Date(o.orderDate).getTime()));
        return new Date(latestTimestamp);
    }, [orders]);
    
    // Placeholder status logic
    const status = "Ordering"; 

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
            <Card className="flex flex-col h-full bg-card shadow-lg hover:shadow-primary/20 transition-shadow duration-300">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-2xl font-bold">Table {tableId}</CardTitle>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{customerNames.join(', ')}</span>
                        <Users size={16} className="text-muted-foreground"/>
                    </div>
                </CardHeader>
                <CardContent className="flex-grow p-4">
                    <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                        <Clock size={14}/> Last activity: {latestOrderTime ? format(latestOrderTime, 'p') : 'N/A'}
                    </div>
                     <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {allItems.map((item, index) => (
                            <div key={index} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded-md">
                                <span className="text-foreground">{item.name}</span>
                                <span className="font-semibold text-foreground">x{item.qty}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
                <CardFooter className="flex-col items-start bg-muted/30 p-4 border-t">
                    <div className="flex justify-between items-center w-full mb-4">
                        <span className="text-lg font-bold">Total Bill:</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(totalBill)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <Button variant="outline"><Printer size={16} className="mr-2"/> Print Bill</Button>
                        <Button className="bg-primary hover:bg-primary/90"><CheckCircle size={16} className="mr-2"/> Mark as Paid</Button>
                    </div>
                </CardFooter>
            </Card>
        </motion.div>
    );
};


export default function DineInPage() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const fetchDineInOrders = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();
            
            let url = new URL('/api/owner/orders', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            }

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch orders');
            }
            const data = await res.json();
            // Filter for dine-in and active tabs
            const dineInOrders = (data.orders || []).filter(o => o.deliveryType === 'dine-in' && o.status === 'active_tab');
            setOrders(dineInOrders);
        } catch (error) {
            console.error("Error fetching dine-in orders:", error);
            alert(`Could not load dine-in data: ${error.message}`);
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
          if (user) fetchDineInOrders();
          else setLoading(false);
        });
    
        const interval = setInterval(() => fetchDineInOrders(true), 30000);
        return () => {
            unsubscribe();
            clearInterval(interval);
        };
      }, [impersonatedOwnerId]);


    const ordersByTable = useMemo(() => {
        return orders.reduce((acc, order) => {
            const tableId = order.tableId || 'Unknown';
            if (!acc[tableId]) {
                acc[tableId] = [];
            }
            acc[tableId].push(order);
            return acc;
        }, {});
    }, [orders]);

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables.</p>
                </div>
                 <Button onClick={() => fetchDineInOrders(true)} variant="outline" disabled={loading}>
                    <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh View
                </Button>
            </div>
            
            {loading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl h-96"></div>
                    ))}
                </div>
            ) : Object.keys(ordersByTable).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Object.entries(ordersByTable).map(([tableId, tableOrders]) => (
                        <TableCard key={tableId} tableId={tableId} orders={tableOrders} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-24 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold">No Active Tables</p>
                    <p>When a customer scans a QR code and orders, their table will appear here live.</p>
                </div>
            )}
        </div>
    );
}

