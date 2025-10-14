

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, RefreshCw, ChevronUp, ChevronDown, Check, CookingPot, Bike, PartyPopper, Undo, Bell, PackageCheck, Printer, X, Loader2, IndianRupee, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Dialog, DialogContent } from "@/components/ui/dialog";

const statusConfig = {
  'pending': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  'paid': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'confirmed': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'preparing': { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  'dispatched': { color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  'delivered': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'rejected': { color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const statusFlow = ['pending', 'paid', 'confirmed', 'preparing', 'dispatched', 'delivered'];

// --- Bill Modal Component ---
const BillModal = ({ order, restaurant, onClose, onPrint }) => {
    if (!order || !restaurant) return null;

    const subtotal = order.subtotal || order.items.reduce((acc, item) => acc + item.qty * item.price, 0);
    const couponDiscount = order.coupon?.discount || 0;
    const loyaltyDiscount = order.loyaltyDiscount || 0;
    const totalDiscount = couponDiscount + loyaltyDiscount;
    const cgst = order.cgst || 0;
    const sgst = order.sgst || 0;
    const deliveryCharge = order.deliveryCharge || 0;
    const grandTotal = order.totalAmount;
    const orderDate = new Date(order.orderDate.seconds ? order.orderDate.seconds * 1000 : order.orderDate);

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-md p-0">
                 <div id="bill-content" className="font-mono text-black bg-white p-6">
                    <div className="text-center mb-6 border-b-2 border-dashed border-black pb-4">
                        <h1 className="text-2xl font-bold uppercase">{restaurant.name}</h1>
                        <p className="text-xs">{restaurant.address}</p>
                        {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
                        {restaurant.fssai && <p className="text-xs">FSSAI: {restaurant.fssai}</p>}
                    </div>

                    <div className="mb-4 text-xs">
                        <p><strong>Bill To:</strong> {order.customerName}</p>
                        <p><strong>Add:</strong> {order.customerAddress}</p>
                        <p><strong>Mobile:</strong> {order.customerPhone}</p>
                    </div>

                    <table className="w-full text-xs mb-4">
                        <thead className="border-y-2 border-dashed border-black">
                            <tr>
                                <th className="text-left font-bold py-2">ITEM</th>
                                <th className="text-center font-bold py-2">QTY</th>
                                <th className="text-right font-bold py-2">RATE</th>
                                <th className="text-right font-bold py-2">AMOUNT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.items.map((item, index) => (
                                <tr key={index} className="border-b border-dotted border-black">
                                    <td className="py-2">{item.name}</td>
                                    <td className="text-center py-2">{item.qty}</td>
                                    <td className="text-right py-2">{item.price.toFixed(2)}</td>
                                    <td className="text-right py-2">{(item.qty * item.price).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="space-y-1 text-xs">
                         <div className="flex justify-between"><span className="font-semibold">SUB TOTAL</span><span>{subtotal.toFixed(2)}</span></div>
                         {totalDiscount > 0 && <div className="flex justify-between"><span className="font-semibold">DISCOUNT</span><span>- {totalDiscount.toFixed(2)}</span></div>}
                         <div className="flex justify-between"><span className="font-semibold">CGST (5%)</span><span>{cgst.toFixed(2)}</span></div>
                         <div className="flex justify-between"><span className="font-semibold">SGST (5%)</span><span>{sgst.toFixed(2)}</span></div>
                         <div className="flex justify-between"><span className="font-semibold">Delivery Charge</span><span>{deliveryCharge.toFixed(2)}</span></div>
                    </div>
                    
                    <div className="flex justify-between font-bold text-lg pt-2 mt-2 border-t-2 border-dashed border-black">
                        <span>GRAND TOTAL</span>
                        <span>₹{grandTotal.toFixed(2)}</span>
                    </div>

                     <div className="mt-4 pt-4 border-t-2 border-dashed border-black text-center">
                        {order.paymentDetails?.method === 'cod' ? (
                            <div className="text-base font-bold text-red-600">CASH ON DELIVERY</div>
                        ) : (
                            <div className="text-base font-bold text-green-600">PAID ONLINE</div>
                        )}
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-dashed border-black text-xs">
                        <p><strong>Transaction ID:</strong> {order.id}</p>
                        <p><strong>Date:</strong> {orderDate.toLocaleDateString('en-IN')} | <strong>Time:</strong> {orderDate.toLocaleTimeString('en-IN')}</p>
                    </div>

                    <div className="text-center mt-6 pt-4 border-t border-dashed border-black">
                        <p className="text-xs italic">Thank you for your order!</p>
                        <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                    </div>
                </div>
                 <div className="p-4 bg-muted border-t border-border flex justify-end">
                    <Button onClick={onPrint} className="bg-primary hover:bg-primary/90">
                        <Printer className="mr-2 h-4 w-4" /> Print Bill
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};


const ActionButton = ({ status, onNext, onRevert, orderId, onReject, isUpdating, onPrintClick }) => {
    // Treat 'paid' and 'pending' as the same for the action flow
    const actionStatus = status === 'paid' ? 'pending' : status;
    const currentIndex = statusFlow.indexOf(actionStatus);

    const nextStatus = statusFlow[currentIndex + 1];
    const prevStatus = statusFlow[currentIndex - 1];

    if (isUpdating) {
        return (
            <div className="flex items-center justify-center gap-2 h-9 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
            </div>
        );
    }

    if (status === 'delivered' || status === 'rejected') {
        return (
            <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${status === 'delivered' ? 'text-green-400' : 'text-red-400'}`}>
                    Order {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
                 <Button onClick={onPrintClick} variant="outline" size="icon" className="h-9 w-9">
                    <Printer size={16} />
                 </Button>
            </div>
        );
    }
    
    const actionConfig = {
        'pending': { text: 'Confirm Order', icon: Check },
        'confirmed': { text: 'Start Preparing', icon: CookingPot },
        'preparing': { text: 'Out for Delivery', icon: Bike },
        'dispatched': { text: 'Mark Delivered', icon: PartyPopper },
    };

    const action = actionConfig[actionStatus];
    
    if (!action) {
         return (
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-400">No action available</span>
            </div>
        );
    }
    const ActionIcon = action.icon;

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
            {(status === 'pending' || status === 'paid') && (
                 <Button
                    onClick={onReject}
                    variant="destructive"
                    size="sm"
                    className="h-9"
                >
                    <X size={16} className="mr-2" />
                    Reject
                </Button>
            )}
             <Button onClick={onPrintClick} variant="outline" size="icon" className="h-9 w-9">
                <Printer size={16} />
             </Button>
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
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'orderDate', direction: 'desc' });
  const [billData, setBillData] = useState({ order: null, restaurant: null });
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  const fetchOrders = async (isManualRefresh = false) => {
    if (!isManualRefresh) setLoading(true);
    
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
        
        if (data.orders.length > orders.length && orders.length > 0 && !isManualRefresh) {
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

    const interval = setInterval(() => fetchOrders(true), 30000);
    return () => {
        unsubscribe();
        clearInterval(interval);
    };
  }, [impersonatedOwnerId]);

  const handleAPICall = async (method, body, endpoint = '/api/owner/orders') => {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    const idToken = await user.getIdToken();
    
    let url = new URL(endpoint, window.location.origin);
    if (impersonatedOwnerId) {
        url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
    }
    if (method === 'GET' && body) {
        Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
    }

    const res = await fetch(url.toString(), {
        method,
        headers: method !== 'GET' ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` } : { 'Authorization': `Bearer ${idToken}` },
        body: method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'API call failed');
    return data;
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    setUpdatingOrderId(orderId);
    try {
      await handleAPICall('PATCH', { orderId, newStatus });
      await fetchOrders(true);
    } catch (error) {
      alert(`Error updating status: ${error.message}`);
    } finally {
      setUpdatingOrderId(null);
    }
  };
  
  const handleRejectOrder = async (orderId) => {
    if (!window.confirm("Are you sure you want to reject this order? It will be marked as 'rejected' but not permanently deleted.")) return;
    setUpdatingOrderId(orderId);
    try {
        await handleAPICall('PATCH', { orderId, newStatus: 'rejected' });
        await fetchOrders(true);
    } catch (error) {
        alert(`Error rejecting order: ${error.message}`);
    } finally {
        setUpdatingOrderId(null);
    }
  }

  const handlePrintClick = async (orderId) => {
      try {
        setUpdatingOrderId(orderId);
        const data = await handleAPICall('GET', { id: orderId });
        setBillData({ order: data.order, restaurant: data.restaurant });
      } catch(e) {
        alert("Could not load bill data: " + e.message);
      } finally {
        setUpdatingOrderId(null);
      }
  };

  const handlePrint = () => {
    const printContents = document.getElementById('bill-content').innerHTML;
    const originalContents = document.body.innerHTML;
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Print Bill</title>');
    printWindow.document.write('<style>@page { size: 80mm auto; margin: 0; } body { margin: 0; font-family: monospace; } table { width: 100%; border-collapse: collapse; } th, td { padding: 4px; } </style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(printContents);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
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
          valA = new Date(valA?.seconds ? valA.seconds * 1000 : valA);
          valB = new Date(valB?.seconds ? valB.seconds * 1000 : valB);
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
        
         {billData.order && (
            <BillModal 
                order={billData.order}
                restaurant={billData.restaurant}
                onClose={() => setBillData({ order: null, restaurant: null })}
                onPrint={handlePrint}
            />
        )}
        
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
                                         {order.paymentDetails?.method === 'cod' ? (
                                            <div className="mt-1 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 w-fit">
                                                <IndianRupee size={12}/> COD
                                            </div>
                                        ) : (
                                            <div className="mt-1 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 w-fit">
                                               <Wallet size={12}/> PAID
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">
                                        <ul className="space-y-1">
                                            {(order.items || []).map(item => (
                                                <li key={item.name}>{item.qty}x {item.name}</li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">
                                        {formatDistanceToNowStrict(new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate))} ago
                                    </td>
                                    <td className="p-4">
                                        <span className={cn('px-2 py-1 text-xs font-semibold rounded-full border flex items-center gap-2 w-fit capitalize', statusConfig[order.status]?.color)}>
                                            {order.status}
                                        </span>
                                    </td>
                                    <td className="p-4 w-[300px]">
                                        <ActionButton
                                            orderId={order.id}
                                            status={order.status}
                                            isUpdating={updatingOrderId === order.id}
                                            onNext={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRevert={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onReject={() => handleRejectOrder(order.id)}
                                            onPrintClick={() => handlePrintClick(order.id)}
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
