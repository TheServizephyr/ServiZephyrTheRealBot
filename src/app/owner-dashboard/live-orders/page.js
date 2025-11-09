
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, ChevronUp, ChevronDown, Check, CookingPot, Bike, PartyPopper, Undo2, Bell, PackageCheck, Printer, X, Loader2, IndianRupee, Wallet, History, ClockIcon, User, Phone, MapPin, Search, ShoppingBag, ConciergeBell, FilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Link from 'next/link';
import InfoDialog from '@/components/InfoDialog';
import { Checkbox } from '@/components/ui/checkbox';
import BillToPrint from '@/components/BillToPrint';
import { useReactToPrint } from 'react-to-print';


export const dynamic = 'force-dynamic';

const statusConfig = {
  'pending': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  'confirmed': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'preparing': { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  'ready_for_pickup': { color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  'dispatched': { color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  'delivered': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'picked_up': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'rejected': { color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const deliveryStatusFlow = ['pending', 'confirmed', 'preparing', 'dispatched', 'delivered'];
const pickupStatusFlow = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];


const RejectOrderModal = ({ order, isOpen, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [otherReason, setOtherReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setOtherReason('');
            setIsSubmitting(false);
        }
    }, [isOpen]);

    const handleConfirm = async () => {
        const finalReason = reason === 'other' ? otherReason : reason;
        if (!finalReason) {
            setInfoDialog({ isOpen: true, title: 'Validation Error', message: 'Please select or enter a reason for rejection.' });
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(order.id, finalReason);
            onClose();
        } catch (error) {
            // parent shows dialog
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const rejectionReasons = [
        { value: "item_unavailable", label: "Item(s) out of stock" },
        { value: "restaurant_closed", label: "Restaurant is currently closed" },
        { value: "customer_request", label: "Customer requested cancellation" },
        { value: "invalid_details", label: "Invalid address or phone number" },
        { value: "undeliverable_address", label: "Address not deliverable" },
        { value: "other", label: "Other" },
    ];

    return (
        <>
        <InfoDialog
            isOpen={infoDialog.isOpen}
            onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
            title={infoDialog.title}
            message={infoDialog.message}
        />
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Reject Order #{order?.id.substring(0, 5)}</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to reject this order? This action cannot be undone. The customer will be notified.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div>
                        <Label htmlFor="rejection-reason">Reason for Rejection</Label>
                        <select
                            id="rejection-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="mt-1 w-full p-2 border rounded-md bg-input border-border focus:ring-primary focus:border-primary"
                        >
                            <option value="" disabled>Select a reason...</option>
                            {rejectionReasons.map(r => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>
                    {reason === 'other' && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                        >
                            <Label htmlFor="other-reason">Please specify the reason</Label>
                            <Textarea
                                id="other-reason"
                                value={otherReason}
                                onChange={(e) => setOtherReason(e.target.value)}
                                className="mt-1"
                                placeholder="e.g., Unable to process payment, weather conditions, etc."
                            />
                        </motion.div>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                    <Button variant="destructive" onClick={handleConfirm} disabled={isSubmitting || !reason || (reason === 'other' && !otherReason.trim())}>
                        {isSubmitting ? "Rejecting..." : "Confirm Rejection"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
};


const AssignRiderModal = ({ isOpen, onClose, onAssign, orders, riders }) => {
    const [selectedRiderId, setSelectedRiderId] = useState(null);
    const [selectedOrderIds, setSelectedOrderIds] = useState([]);
    const [markAsActive, setMarkAsActive] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectedRider = useMemo(() => riders.find(r => r.id === selectedRiderId), [selectedRiderId, riders]);
    const isSelectedRiderInactive = selectedRider?.status === 'Inactive';

    useEffect(() => {
        if (isOpen) {
            setSelectedRiderId(null);
            setMarkAsActive(false);
            setIsSubmitting(false);
            // Pre-select the order(s) the modal was opened for
            setSelectedOrderIds(orders.map(o => o.id));
        }
    }, [isOpen, orders]);
    
    const handleOrderSelection = (orderId) => {
        setSelectedOrderIds(prev => 
            prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
        );
    }

    const handleAssign = async () => {
        if (selectedRiderId && selectedOrderIds.length > 0) {
            setIsSubmitting(true);
            try {
                await onAssign(selectedOrderIds, selectedRiderId, markAsActive);
                onClose();
            } catch (error) {
                // error is handled by parent
                throw error;
            } finally {
                setIsSubmitting(false);
            }
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Assign Rider for Order(s)</DialogTitle>
                    <DialogDescription>Select orders to batch and a rider to dispatch them.</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    <div>
                        <Label>Select Orders to Assign:</Label>
                        <div className="mt-2 space-y-2 p-2 bg-muted/50 rounded-lg">
                            {orders.map(order => (
                                <div key={order.id} className="flex items-center gap-3 p-2 bg-background rounded-md">
                                    <Checkbox id={`order-${order.id}`} checked={selectedOrderIds.includes(order.id)} onCheckedChange={() => handleOrderSelection(order.id)} />
                                    <Label htmlFor={`order-${order.id}`} className="cursor-pointer w-full">
                                        <div className="flex justify-between">
                                            <span className="font-semibold">{order.id.substring(0,8)}...</span>
                                            <span className="text-xs text-muted-foreground">{order.customer}</span>
                                        </div>
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <Label>Select a Rider:</Label>
                         <div className="mt-2 space-y-2">
                             {riders.length > 0 ? riders.map(rider => (
                                <div
                                    key={rider.id}
                                    onClick={() => setSelectedRiderId(rider.id)}
                                    className={cn(
                                        "p-3 rounded-lg border cursor-pointer transition-all flex justify-between items-center",
                                        selectedRiderId === rider.id 
                                            ? 'bg-primary/20 border-primary ring-2 ring-primary'
                                            : 'bg-muted/50 border-border hover:bg-muted'
                                    )}
                                >
                                    <div>
                                        <p className="font-bold text-foreground">{rider.name}</p>
                                        <p className="text-sm text-muted-foreground">{rider.phone}</p>
                                    </div>
                                    {rider.status === 'Inactive' && <span className="text-xs font-semibold px-2 py-1 bg-red-500/10 text-red-500 rounded-full">Inactive</span>}
                                    {rider.status === 'On Delivery' && <span className="text-xs font-semibold px-2 py-1 bg-blue-500/10 text-blue-500 rounded-full">On Delivery</span>}
                                </div>
                            )) : (
                                <p className="text-center text-muted-foreground py-4">No riders found. Please add riders in the 'Delivery' section.</p>
                            )}
                        </div>
                    </div>
                </div>

                 {isSelectedRiderInactive && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg flex items-center justify-between"
                    >
                        <div className="flex flex-col">
                            <Label htmlFor="mark-active" className="font-semibold text-destructive">This rider is currently inactive.</Label>
                            <span className="text-xs text-destructive/80">Toggle on to make them available and assign the order.</span>
                        </div>
                        <Switch
                            id="mark-active"
                            checked={markAsActive}
                            onCheckedChange={setMarkAsActive}
                            aria-label="Mark as Active & Assign"
                        />
                    </motion.div>
                )}
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                    <Button onClick={handleAssign} disabled={!selectedRiderId || selectedOrderIds.length === 0 || (isSelectedRiderInactive && !markAsActive) || isSubmitting} className="bg-primary hover:bg-primary/90">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Bike size={16} className="mr-2"/>}
                        {isSubmitting ? 'Assigning...' : 'Assign & Dispatch'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ActionButton = ({ status, onNext, onRevert, order, onRejectClick, isUpdating, onPrintClick, onAssignClick }) => {
    const isPickup = order.deliveryType === 'pickup';
    const isDineIn = order.deliveryType === 'dine-in';
    const statusFlow = isPickup ? pickupStatusFlow : deliveryStatusFlow;
    
    const currentIndex = statusFlow.indexOf(status);
    
    const isFinalStatus = status === 'delivered' || status === 'rejected' || status === 'picked_up' || status === 'active_tab';

    if (isUpdating) {
        return (
            <div className="flex items-center justify-center gap-2 h-9 text-muted-foreground text-sm w-full">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
            </div>
        );
    }
    
    if (isDineIn) {
        return (
             <div className="flex items-center gap-2">
                <Link href="/owner-dashboard/dine-in">
                    <Button size="sm" className="bg-primary hover:bg-primary/90 h-9">
                        <ConciergeBell size={16} className="mr-2"/> View on Dine-In Board
                    </Button>
                </Link>
             </div>
        )
    }

    if (isFinalStatus) {
        return (
            <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${status === 'rejected' ? 'text-red-400' : 'text-green-400'}`}>
                    Order {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                </span>
                 <Button onClick={onPrintClick} variant="outline" size="icon" className="h-9 w-9">
                    <Printer size={16} />
                 </Button>
            </div>
        );
    }
    
    const nextStatus = statusFlow[currentIndex + 1];
    let prevStatus = null;
    if(currentIndex > 0) { 
        prevStatus = statusFlow[currentIndex - 1];
    }


    const actionConfig = {
        'pending': { text: 'Confirm Order', icon: Check, action: () => onNext(nextStatus) },
        'confirmed': { text: 'Start Preparing', icon: CookingPot, action: () => onNext(nextStatus) },
        'preparing': isPickup
            ? { text: 'Ready for Pickup', icon: PackageCheck, action: () => onNext(nextStatus) }
            : { text: 'Out for Delivery', icon: Bike, action: () => onAssignClick([order]) },
        'ready_for_pickup': { text: 'Mark as Picked Up', icon: PartyPopper, action: () => onNext(nextStatus) },
        'dispatched': { text: 'Mark Delivered', icon: PartyPopper, action: () => onNext(nextStatus) },
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
    const isConfirmable = status === 'pending';

    return (
        <div className="flex flex-col sm:flex-row items-stretch gap-2 w-full">
            <Button
                onClick={action.action}
                size="sm"
                className="bg-primary hover:bg-primary/90 h-9 flex-grow"
            >
                <ActionIcon size={16} className="mr-2" />
                {action.text}
            </Button>
            <div className="flex gap-2">
                {isConfirmable && (
                     <Button
                        onClick={() => onRejectClick(order)}
                        variant="destructive"
                        size="sm"
                        className="h-9 flex-1"
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
                        <Undo2 size={16} />
                    </Button>
                )}
            </div>
        </div>
    );
};

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

const OrderDetailModal = ({ isOpen, onClose, data }) => {
    const { order, restaurant, customer } = data || {};

    if (!isOpen || !order) {
        return null;
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl bg-card border-border text-card-foreground">
                <DialogHeader>
                    <DialogTitle>Order Details #{order.id.substring(0, 8)}</DialogTitle>
                    <DialogDescription>
                        Full details for the order placed on {format(new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate), 'PPpp')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-6 py-4 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-4">
                        <h4 className="font-semibold flex items-center gap-2"><User size={16}/> Customer Details</h4>
                        <div className="p-4 bg-muted rounded-lg">
                            <p><strong>Name:</strong> {order.customerName}</p>
                            <p><strong>Phone:</strong> {order.customerPhone}</p>
                            <p><strong>Address:</strong> {order.customerAddress}</p>
                        </div>
                         {customer && (
                            <div className="p-4 bg-blue-500/10 rounded-lg">
                                <h5 className="font-semibold text-blue-400">Customer Insights</h5>
                                <p><strong>Total Orders:</strong> {customer.totalOrders || 0}</p>
                                <p><strong>Total Spend:</strong> ₹{customer.totalSpend?.toFixed(2) || '0.00'}</p>
                                <p><strong>Loyalty Points:</strong> {customer.loyaltyPoints || 0}</p>
                            </div>
                         )}
                    </div>
                     <div className="space-y-4">
                        <h4 className="font-semibold flex items-center gap-2"><IndianRupee size={16}/> Payment Details</h4>
                        <div className="p-4 bg-muted rounded-lg">
                            <p><strong>Payment Method:</strong> <span className="font-mono p-1 rounded bg-background text-sm">{order.paymentDetails?.method || 'N/A'}</span></p>
                            <p><strong>Subtotal:</strong> ₹{order.subtotal?.toFixed(2)}</p>
                             {order.discount > 0 && <p className="text-green-500"><strong>Discount:</strong> - ₹{order.discount?.toFixed(2)}</p>}
                            <p><strong>GST:</strong> ₹{(order.cgst + order.sgst).toFixed(2)}</p>
                            <p><strong>Delivery Charge:</strong> ₹{order.deliveryCharge?.toFixed(2)}</p>
                            <p className="font-bold text-lg border-t border-dashed mt-2 pt-2"><strong>Grand Total:</strong> ₹{order.totalAmount?.toFixed(2)}</p>
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <h4 className="font-semibold flex items-center gap-2 mb-2"><ShoppingBag size={16}/> Items Ordered</h4>
                        <div className="p-4 bg-muted rounded-lg space-y-2">
                            {order.items.map((item, index) => (
                                <div key={index} className="flex justify-between border-b border-border/50 pb-1">
                                    <span>{item.quantity} x {item.name}</span>
                                    <span>₹{item.price * item.quantity}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                 <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// Main Board Component
export default function LiveOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'orderDate', direction: 'desc' });
  const [assignModalData, setAssignModalData] = useState({ isOpen: false, orders: [] });
  const [rejectionModalData, setRejectionModalData] = useState({ isOpen: false, order: null });
  const [detailModalData, setDetailModalData] = useState({ isOpen: false, data: null });
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const [selectedOrders, setSelectedOrders] = useState([]);
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const [printData, setPrintData] = useState(null);
  const [restaurantData, setRestaurantData] = useState(null);
  const billPrintRef = useRef();

   useEffect(() => {
    if (printData) {
      handlePrint();
    }
  }, [printData]);

  const handlePrint = useReactToPrint({
    content: () => billPrintRef.current,
    documentTitle: `bill-${printData?.id}`,
    onAfterPrint: () => setPrintData(null),
  });

  const fetchInitialData = async (isManualRefresh = false) => {
    if (!isManualRefresh) setLoading(true);
    
    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        const idToken = await user.getIdToken();

        let ordersUrl = new URL('/api/owner/orders', window.location.origin);
        let ridersUrl = new URL('/api/owner/delivery', window.location.origin);
        let settingsUrl = new URL('/api/owner/settings', window.location.origin);
        
        if (impersonatedOwnerId) {
            ordersUrl.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            ridersUrl.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            settingsUrl.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const [ordersRes, ridersRes, settingsRes] = await Promise.all([
            fetch(ordersUrl.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } }),
            fetch(ridersUrl.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } }),
            fetch(settingsUrl.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } })
        ]);

        if (!ordersRes.ok) throw new Error('Failed to fetch orders');
        const ordersData = await ordersRes.json();
        setOrders(ordersData.orders || []);
        
        if (ridersRes.ok) {
            const ridersData = await ridersRes.json();
            setRiders(ridersData.boys || []);
        }
        
        if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            setRestaurantData({
                name: settingsData.restaurantName,
                address: settingsData.address,
                gstin: settingsData.gstin,
            });
        }

    } catch (error) {
        console.error("[LiveOrders] Error fetching initial data:", error);
        setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load data: ${error.message}` });
    } finally {
        if(!isManualRefresh) setLoading(false);
    }
  };
  
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        fetchInitialData();
      }
      else {
        setLoading(false);
      }
    });

    const interval = setInterval(() => {
        fetchInitialData(true);
    }, 30000);
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
    if (!res.ok) {
        throw new Error(data.message || 'API call failed');
    }
    return data;
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    setUpdatingOrderId(orderId);
    try {
      await handleAPICall('PATCH', { orderId, newStatus });
      await fetchInitialData(true);
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: `Error updating status: ${error.message}` });
    } finally {
      setUpdatingOrderId(null);
    }
  };
  
  const handleAssignRider = async (orderIds, riderId, activateRider) => {
    setUpdatingOrderId(orderIds[0]);
    try {
        if (activateRider) {
             await handleAPICall('PATCH', { boy: { id: riderId, status: 'Available' } }, '/api/owner/delivery');
        }
        
        await handleAPICall('PATCH', { orderIds, newStatus: 'dispatched', deliveryBoyId: riderId });
        await fetchInitialData(true);
        setAssignModalData({ isOpen: false, orders: [] });
    } catch (error) {
        setInfoDialog({ isOpen: true, title: 'Error', message: `Error assigning rider: ${error.message}` });
        setAssignModalData({ isOpen: false, orders: [] });
        throw error;
    } finally {
        setUpdatingOrderId(null);
        setSelectedOrders([]);
    }
  };


  const handleRejectOrder = async (orderId, reason) => {
    setUpdatingOrderId(orderId);
    try {
        await handleAPICall('PATCH', { orderId, newStatus: 'rejected', rejectionReason: reason });
        await fetchInitialData(true);
    } catch (error) {
        setInfoDialog({ isOpen: true, title: 'Error', message: `Error rejecting order: ${error.message}` });
        throw error;
    } finally {
        setUpdatingOrderId(null);
    }
  }

  const handlePrintClick = (order) => {
    setPrintData(order);
  };
  
  const handleDetailClick = async (orderId, customerId) => {
    try {
      const data = await handleAPICall('GET', { id: orderId, customerId });
      setDetailModalData({ isOpen: true, data });
    } catch(e) {
      setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load details: ${e.message}` });
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const handleSelectOrder = (orderId) => {
      setSelectedOrders(prev => 
        prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
      );
  };
  
  const handleAssignSelected = () => {
      const ordersToAssign = orders.filter(o => selectedOrders.includes(o.id));
      setAssignModalData({isOpen: true, orders: ordersToAssign});
  }
  
  const filteredAndSortedOrders = useMemo(() => {
    let sortableItems = [...orders];

    const filterMap = {
        'All': () => true,
        'New': order => order.status === 'pending',
        'Confirmed': order => order.status === 'confirmed',
        'Preparing': order => order.status === 'preparing',
        'Dispatched': order => order.status === 'dispatched' || order.status === 'ready_for_pickup',
        'Delivered': order => order.status === 'delivered' || order.status === 'picked_up',
        'Rejected': order => order.status === 'rejected',
    };

    if (filterMap[activeFilter]) {
        sortableItems = sortableItems.filter(filterMap[activeFilter]);
    }
    
    if (searchQuery) {
        const lowercasedQuery = searchQuery.toLowerCase();
        sortableItems = sortableItems.filter(order => {
            const matchesId = order.id.toLowerCase().includes(lowercasedQuery);
            const matchesCustomerName = (order.customer || '').toLowerCase().includes(lowercasedQuery);
            const matchesCustomerPhone = (order.customerPhone || '').includes(searchQuery);
            const matchesCustomerAddress = (order.customerAddress || '').toLowerCase().includes(lowercasedQuery);
            const matchesItems = (order.items || []).some(item => item.name.toLowerCase().includes(lowercasedQuery));
            
            return matchesId || matchesCustomerName || matchesCustomerPhone || matchesCustomerAddress || matchesItems;
        });
    }

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
  }, [orders, sortConfig, activeFilter, searchQuery]);

  return (
    <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
        <InfoDialog
            isOpen={infoDialog.isOpen}
            onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
            title={infoDialog.title}
            message={infoDialog.message}
        />
        
        {printData && (
             <div style={{ display: 'none' }}>
                <BillToPrint ref={billPrintRef} order={printData} restaurant={restaurantData} />
             </div>
        )}
        
        <OrderDetailModal
            isOpen={detailModalData.isOpen}
            onClose={() => setDetailModalData({ isOpen: false, data: null })}
            data={detailModalData.data}
        />

        {assignModalData.isOpen && (
            <AssignRiderModal
                isOpen={assignModalData.isOpen}
                onClose={() => setAssignModalData({ isOpen: false, orders: [] })}
                onAssign={handleAssignRider}
                orders={assignModalData.orders}
                riders={riders}
            />
        )}

        {rejectionModalData.isOpen && (
            <RejectOrderModal
                isOpen={rejectionModalData.isOpen}
                onClose={() => setRejectionModalData({ isOpen: false, order: null })}
                onConfirm={handleRejectOrder}
                order={rejectionModalData.order}
            />
        )}
        
        <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Live Order Management</h1>
                <p className="text-muted-foreground mt-1 text-sm md:text-base">A real-time, intelligent view of your kitchen's pulse.</p>
            </div>
             <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="relative flex-grow md:flex-grow-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search orders..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full md:w-64 pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                    />
                </div>
                 <Link href="/owner-dashboard/custom-bill" passHref>
                    <Button variant="outline" className="flex-shrink-0">
                        <FilePlus size={16} />
                        <span className="ml-2 hidden sm:inline">Custom Bill</span>
                    </Button>
                </Link>
                <Button onClick={() => fetchInitialData(true)} variant="outline" className="flex-shrink-0">
                    <RefreshCw size={16} className={cn(loading && "animate-spin")} />
                    <span className="ml-2 hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
                </Button>
            </div>
        </div>

        <Tabs defaultValue="All" value={activeFilter} onValueChange={setActiveFilter} className="w-full mb-6">
            <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4 md:grid-cols-7 h-auto p-1 bg-muted">
                <TabsTrigger value="All">All</TabsTrigger>
                <TabsTrigger value="New">New</TabsTrigger>
                <TabsTrigger value="Confirmed">Confirmed</TabsTrigger>
                <TabsTrigger value="Preparing">Preparing</TabsTrigger>
                <TabsTrigger value="Dispatched">Dispatched</TabsTrigger>
                <TabsTrigger value="Delivered">Delivered</TabsTrigger>
                <TabsTrigger value="Rejected">Rejected</TabsTrigger>
            </TabsList>
        </Tabs>
        
        {selectedOrders.length > 0 && (
            <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-center justify-between mb-4"
            >
                <p className="font-semibold text-primary">{selectedOrders.length} order(s) selected for batching.</p>
                <Button size="sm" onClick={handleAssignSelected}>
                    <Bike size={16} className="mr-2"/> Assign Selected to Rider
                </Button>
            </motion.div>
        )}

        <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-muted/30">
                            <th className="p-4 w-12 text-left text-sm font-semibold text-muted-foreground"></th>
                            <SortableHeader column="id" sortConfig={sortConfig} onSort={handleSort}>Order Details</SortableHeader>
                            <th className="p-4 text-left text-sm font-semibold text-muted-foreground hidden md:table-cell">Items</th>
                            <SortableHeader column="orderDate" sortConfig={sortConfig} onSort={handleSort}>Time</SortableHeader>
                            <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                            <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        <AnimatePresence>
                           {loading && filteredAndSortedOrders.length === 0 ? (
                                Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4 w-12"></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4 hidden md:table-cell"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/3"></div></td>
                                        <td className="p-4"><div className="h-8 bg-muted rounded w-full"></div></td>
                                    </tr>
                                ))
                            ) : filteredAndSortedOrders.map(order => (
                                <motion.tr
                                    key={order.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, x: -50 }}
                                    transition={{ duration: 0.3 }}
                                    className="hover:bg-muted/50"
                                >
                                    <td className="p-4 w-12 align-top">
                                        {order.status === 'preparing' && order.deliveryType !== 'pickup' && (
                                            <Checkbox
                                                checked={selectedOrders.includes(order.id)}
                                                onCheckedChange={() => handleSelectOrder(order.id)}
                                                aria-label={`Select order ${order.id}`}
                                            />
                                        )}
                                    </td>
                                    <td className="p-4 align-top">
                                        <div className="font-bold text-foreground text-sm truncate max-w-[100px] sm:max-w-none">{order.id}</div>
                                        <div 
                                            onClick={() => handleDetailClick(order.id, order.customerId)} 
                                            className="text-sm text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                                            title="View Customer & Order Details"
                                        >
                                            {order.customer}
                                        </div>
                                        {order.deliveryType === 'dine-in' && (
                                            <div className="mt-1 font-mono text-xs text-primary bg-primary/10 border border-primary/20 rounded px-2 py-1 inline-flex flex-col">
                                                <span>Table: {order.tableId}</span>
                                                <span>Token: {order.dineInToken}</span>
                                            </div>
                                        )}
                                        <div className="mt-1 flex items-center gap-2">
                                            {order.deliveryType === 'pickup' ? (
                                                <div title="Pickup Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 w-fit"><ShoppingBag size={12}/> Pickup</div>
                                            ) : order.deliveryType === 'dine-in' ? (
                                                <div title="Dine-In Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 w-fit"><ConciergeBell size={12}/> Dine-In</div>
                                            ) : (
                                                <div title="Delivery Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 w-fit"><Bike size={12}/> Delivery</div>
                                            )}
                                            {order.paymentDetails?.method === 'cod' 
                                                ? <div title="Cash on Delivery" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 w-fit"><IndianRupee size={12}/> POD</div>
                                                : <div title="Prepaid Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 w-fit"><Wallet size={12}/> PAID</div>
                                            }
                                        </div>
                                    </td>
                                    <td className="p-4 align-top hidden md:table-cell">
                                        {(order.items || []).slice(0, 2).map((item, index) => (
                                            <div key={index} className="text-xs text-muted-foreground">{item.quantity}x {item.name}</div>
                                        ))}
                                        {(order.items || []).length > 2 && <div className="text-xs text-primary font-semibold mt-1">...and { (order.items || []).length - 2} more</div>}
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground align-top">
                                        {format(new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate), 'dd/MM/yyyy, hh:mm a')}
                                    </td>
                                    <td className="p-4 align-top">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <button className={cn('flex items-center gap-2 text-xs font-semibold rounded-full border px-3 py-1 w-fit capitalize transition-transform hover:scale-105', statusConfig[order.status]?.color)}>
                                                    {order.status.replace('_', ' ')}
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-80">
                                                <div className="grid gap-4">
                                                    <div className="space-y-2">
                                                        <h4 className="font-medium leading-none flex items-center gap-2"><History size={16} /> Status History</h4>
                                                        <div className="text-sm text-muted-foreground space-y-2">
                                                            {(order.statusHistory || []).length > 0 ? (
                                                                [...order.statusHistory].reverse().map((h, i) => (
                                                                    <div key={i} className="flex items-center gap-2">
                                                                        <ClockIcon size={12} />
                                                                        <span className="font-semibold capitalize">{h.status}:</span>
                                                                        <span>{format(new Date(h.timestamp?.seconds ? h.timestamp.seconds * 1000 : h.timestamp), 'hh:mm:ss a')}</span>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p>No history available.</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    </td>
                                    <td className="p-4 w-auto md:w-[320px] align-top">
                                        <ActionButton
                                            order={order}
                                            status={order.status}
                                            isUpdating={updatingOrderId === order.id}
                                            onNext={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRevert={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRejectClick={(order) => setRejectionModalData({ isOpen: true, order: order })}
                                            onPrintClick={() => handlePrintClick(order)}
                                            onAssignClick={(orders) => setAssignModalData({ isOpen: true, orders })}
                                        />
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                         { !loading && filteredAndSortedOrders.length === 0 && (
                            <tr>
                                <td colSpan="7" className="text-center p-16 text-muted-foreground">
                                    <p className="text-lg font-semibold">No orders found.</p>
                                    <p>Try adjusting your filters or search term.</p>
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
