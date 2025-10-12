

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, RefreshCw, ChevronUp, ChevronDown, Check, CookingPot, Bike, PartyPopper, Undo, Bell, PackageCheck, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from 'date-fns';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';


const statusConfig = {
  'pending': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  'confirmed': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'preparing': { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  'dispatched': { color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  'delivered': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
};

const statusFlow = ['pending', 'confirmed', 'preparing', 'dispatched', 'delivered'];

const ActionButton = ({ status, onNext, onRevert, orderId }) => {
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const currentIndex = statusFlow.indexOf(status);
    const nextStatus = statusFlow[currentIndex + 1];
    const prevStatus = statusFlow[currentIndex - 1];

    if (status === 'delivered') {
        return (
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-green-400">Order Completed</span>
            </div>
        );
    }
    
    const actionConfig = {
        'pending': { text: 'Confirm Order', icon: Check },
        'confirmed': { text: 'Start Preparing', icon: CookingPot },
        'preparing': { text: 'Out for Delivery', icon: Bike },
        'dispatched': { text: 'Mark Delivered', icon: PartyPopper },
    };

    const action = actionConfig[status];
    if (!action) {
         return (
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-400">No action available</span>
            </div>
        );
    }
    const ActionIcon = action.icon;
    
    const billUrl = impersonatedOwnerId
        ? `/owner-dashboard/bill/${orderId}?impersonate_owner_id=${impersonatedOwnerId}`
        : `/owner-dashboard/bill/${orderId}`;


    return (
        <div className="flex items-center gap-2">
            <Button
                onClick={() => onNext(nextStatus)}
                size="sm"
                className="bg-primary hover:bg-primary/90 h-9 flex-grow"
            >
                <ActionIcon size={16} className="mr-2" />
                {action.text}
            </Button>
             <Link href={billUrl} passHref>
                <Button asChild variant="outline" size="sm" className="w-full h-9">
                    <a>
                        <Printer size={16} className="mr-2" /> Print Bill
                    </a>
                </Button>
            </Link>
            {prevStatus && (
                 <Button
                    onClick={() => onRevert(prevStatus)}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={`Revert to ${prevStatus}`}
                 >
                    <Undo size={16} />
                </Button>
            )}
        </div>
    );
};

const PriorityStars = ({ score }) => (
  <div className="flex items-center">
    {[...Array(5)].map((_, i) => (
      <Star
        key={i}
        size={16}
        className={cn(
          'transition-colors',
          i < score ? 'text-primary fill-primary' : 'text-muted-foreground/50'
        )}
      />
    ))}
  </div>
);


const SortableHeader = ({ children, column, sortConfig, onSort }) => {
  const isSorted = sortConfig.key === column;
  const direction = isSorted ? sortConfig.direction : 'desc';
  const Icon = direction === 'asc' ? ChevronUp : ChevronDown;

  return (
    <th onClick={() => onSort(column)} className="cursor-pointer p-4 text-left text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
      <div className="flex items-center gap-2">
        {children}
        {isSorted && <Icon size={16} />}
      </div>
    </th>
  );
};


// Main Board Component
export default function LiveOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: 'orderDate', direction: 'desc' });
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  const fetchOrders = async (isManualRefresh = false) => {
    if (!isManualRefresh) setLoading(true); else {
        // add a small visual flicker on manual refresh
        setOrders(prev => [...prev]);
    }
    
    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        const idToken = await user.getIdToken();

        let url = new URL('/api/owner/orders', window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!res.ok) throw new Error('Failed to fetch orders');
        const data = await res.json();
        
        // Play sound if new orders have arrived (simplified logic)
        if (data.orders.length > orders.length && orders.length > 0) {
            const sound = document.getElementById('notification-sound');
            if(sound) sound.play().catch(e => console.log("Audio play failed:", e));
        }

        setOrders(data.orders || []);
    } catch (error) {
        console.error(error);
        alert("Could not load orders: " + error.message);
    } finally {
        if(!isManualRefresh) setLoading(false);
    }
  };
  
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) fetchOrders();
      else setLoading(false);
    });

    const interval = setInterval(() => fetchOrders(true), 30000); // Auto-refresh every 30 seconds
    return () => {
        unsubscribe();
        clearInterval(interval);
    };
  }, [impersonatedOwnerId]);

  const handleAPICall = async (method, body) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    const idToken = await user.getIdToken();
    
    let url = new URL('/api/owner/orders', window.location.origin);
    if (impersonatedOwnerId) {
        url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
    }

    const res = await fetch(url.toString(), {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'API call failed');
    return data;
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    // Optimistic UI update
    const originalOrders = [...orders];
    const updatedOrders = orders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
    );
    setOrders(updatedOrders);
    
    try {
      await handleAPICall('PATCH', { orderId, newStatus });
    } catch (error) {
      alert(`Error updating status: ${error.message}`);
      setOrders(originalOrders); // Revert on failure
    }
  };
  
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const sortedOrders = useMemo(() => {
    let sortableItems = [...orders];
    sortableItems.sort((a, b) => {
      const key = sortConfig.key;
      let valA = a[key];
      let valB = b[key];
      if (key === 'orderDate') {
          valA = new Date(valA.seconds ? valA.seconds * 1000 : valA);
          valB = new Date(valB.seconds ? valB.seconds * 1000 : valB);
      }
      if (valA < valB) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (valA > valB) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return sortableItems;
  }, [orders, sortConfig]);


  return (
    <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
        <audio id="notification-sound" src="/notification.mp3" preload="auto"></audio>

        <div className="flex flex-col md:flex-row justify-between md:items-center mb-6">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Live Order Management</h1>
                <p className="text-muted-foreground mt-1 text-sm md:text-base">A real-time, intelligent view of your kitchen's pulse.</p>
            </div>
            <Button onClick={() => fetchOrders(true)} variant="outline" className="mt-2 sm:mt-0">
                <RefreshCw size={16} className={cn(loading && "animate-spin")} />
                <span className="ml-2">{loading ? 'Loading...' : 'Refresh'}</span>
            </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-muted/30">
                            <SortableHeader column="priority" sortConfig={sortConfig} onSort={handleSort}>Priority</SortableHeader>
                            <SortableHeader column="id" sortConfig={sortConfig} onSort={handleSort}>Order Details</SortableHeader>
                            <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Order Items</th>
                            <SortableHeader column="orderDate" sortConfig={sortConfig} onSort={handleSort}>Time Elapsed</SortableHeader>
                            <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                            <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        <AnimatePresence>
                           {loading && sortedOrders.length === 0 ? (
                                Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-full"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/3"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-full"></div></td>
                                    </tr>
                                ))
                            ) : sortedOrders.map(order => (
                                <motion.tr
                                    key={order.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, x: -50 }}
                                    transition={{ duration: 0.3 }}
                                    className="hover:bg-muted/50"
                                >
                                    <td className="p-4"><PriorityStars score={order.priority} /></td>
                                    <td className="p-4">
                                        <div className="font-bold text-foreground">{order.id}</div>
                                        <div className="text-sm text-muted-foreground">{order.customer}</div>
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">
                                        <ul className="space-y-1">
                                            {(order.items || []).map(item => (
                                                <li key={item.name}>{item.qty}x {item.name}</li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">
                                        {formatDistanceToNowStrict(new Date(order.orderDate.seconds ? order.orderDate.seconds * 1000 : order.orderDate))} ago
                                    </td>
                                    <td className="p-4">
                                        <span className={cn('px-2 py-1 text-xs font-semibold rounded-full border flex items-center gap-2 w-fit', statusConfig[order.status]?.color)}>
                                            {order.status}
                                        </span>
                                    </td>
                                    <td className="p-4 w-[250px]">
                                        <ActionButton
                                            orderId={order.id}
                                            status={order.status}
                                            onNext={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRevert={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                        />
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                         { !loading && sortedOrders.length === 0 && (
                            <tr>
                                <td colSpan="6" className="text-center p-16 text-muted-foreground">
                                    <p className="text-lg font-semibold">All caught up!</p>
                                    <p>No live orders right now.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
}
