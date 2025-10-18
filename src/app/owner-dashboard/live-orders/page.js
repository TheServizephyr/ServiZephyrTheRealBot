

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, ChevronUp, ChevronDown, Check, CookingPot, Bike, PartyPopper, Undo, Bell, PackageCheck, Printer, X, Loader2, IndianRupee, Wallet, History, ClockIcon, User, Phone, MapPin, Search } from 'lucide-react';
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


const statusConfig = {
  'pending': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  'paid': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'confirmed': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'preparing': { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  'dispatched': { color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  'delivered': { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'rejected': { color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const statusFlow = ['pending', 'confirmed', 'preparing', 'dispatched', 'delivered'];

const RejectOrderModal = ({ order, isOpen, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [otherReason, setOtherReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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
            alert("Please select or enter a reason for rejection.");
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(order.id, finalReason);
            onClose();
        } catch (error) {
            // alert handled in parent
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
    );
};

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
                        <p className="text-xs">{restaurant.address.street}, {restaurant.address.city}, {restaurant.address.state} - {restaurant.address.postalCode}</p>
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
                 <div className="p-4 bg-muted border-t border-border flex justify-end no-print">
                    <Button onClick={onPrint} className="bg-primary hover:bg-primary/90">
                        <Printer className="mr-2 h-4 w-4" /> Print Bill
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const AssignRiderModal = ({ isOpen, onClose, onAssign, order, riders }) => {
    const [selectedRiderId, setSelectedRiderId] = useState(null);
    const [markAsActive, setMarkAsActive] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectedRider = useMemo(() => riders.find(r => r.id === selectedRiderId), [selectedRiderId, riders]);
    const isSelectedRiderInactive = selectedRider?.status === 'Inactive';

    useEffect(() => {
        if (isOpen) {
            setSelectedRiderId(null);
            setMarkAsActive(false);
            setIsSubmitting(false);
        }
    }, [isOpen]);

    const handleAssign = async () => {
        if (selectedRiderId) {
            setIsSubmitting(true);
            try {
                await onAssign(order.id, selectedRiderId, markAsActive);
                onClose();
            } catch (error) {
                // The parent's catch block will show an alert
            } finally {
                setIsSubmitting(false);
            }
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Assign Rider for Order #{order?.id.substring(0, 5)}</DialogTitle>
                    <DialogDescription>Select a rider to dispatch this order.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3 max-h-60 overflow-y-auto">
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
                        </div>
                    )) : (
                        <p className="text-center text-muted-foreground py-4">No riders found. Please add riders in the 'Delivery' section.</p>
                    )}
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
                    <Button onClick={handleAssign} disabled={!selectedRiderId || (isSelectedRiderInactive && !markAsActive) || isSubmitting} className="bg-primary hover:bg-primary/90">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Bike size={16} className="mr-2"/>}
                        {isSubmitting ? 'Assigning...' : 'Assign & Dispatch'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const OrderDetailModal = ({ data, isOpen, onClose }) => {
    if (!isOpen || !data || !data.order) {
        return null;
    }

    const { order, customer } = data;
    const orderDate = new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Details for Order #{order.id.substring(0, 8)}</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="order" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="order">Order Details</TabsTrigger>
                        <TabsTrigger value="customer">Customer Details</TabsTrigger>
                    </TabsList>
                    <TabsContent value="order" className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto p-1 pr-4">
                        <div className="text-sm space-y-1">
                            <p><strong>Order ID:</strong> <span className="font-mono">{order.id}</span></p>
                            <p><strong>Time:</strong> {format(orderDate, 'dd/MM/yyyy, hh:mm a')}</p>
                            <p><strong>Payment:</strong> <span className={cn("font-semibold", order.paymentDetails.method === 'cod' ? 'text-yellow-500' : 'text-green-400')}>{order.paymentDetails.method.toUpperCase()}</span></p>
                        </div>
                         <div className="space-y-2 border-t border-border pt-4">
                            <h4 className="font-semibold">Items</h4>
                             <ul className="list-disc pl-5 text-muted-foreground text-sm">
                                {(order.items || []).map((item, index) => (
                                    <li key={index} className="mb-1">{item.qty}x {item.name} - ₹{(item.qty * item.price).toFixed(2)}</li>
                                ))}
                            </ul>
                        </div>
                        {order.notes && (
                             <div className="space-y-2 border-t border-border pt-4">
                                <h4 className="font-semibold">Notes from Customer</h4>
                                <p className="text-sm text-muted-foreground italic">"{order.notes}"</p>
                            </div>
                        )}
                        <div className="space-y-1 border-t border-border pt-4 text-sm">
                            <div className="flex justify-between"><span>Subtotal:</span> <span className="font-medium">₹{order.subtotal?.toFixed(2)}</span></div>
                            {order.discount > 0 && <div className="flex justify-between text-green-400"><span>Discount:</span> <span className="font-medium">- ₹{order.discount?.toFixed(2)}</span></div>}
                            <div className="flex justify-between"><span>Delivery:</span> <span>₹{order.deliveryCharge?.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>Taxes (CGST+SGST):</span> <span>₹{(order.cgst + order.sgst).toFixed(2)}</span></div>
                            <div className="border-t border-dashed my-2"></div>
                            <div className="flex justify-between text-base font-bold"><span>Grand Total:</span> <span>₹{order.totalAmount?.toFixed(2)}</span></div>
                        </div>
                    </TabsContent>
                    <TabsContent value="customer" className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto p-1">
                        {customer ? (
                            <>
                                <div className="space-y-2">
                                     <div className="flex items-center gap-3">
                                        <User size={16} className="text-muted-foreground"/>
                                        <span className="font-semibold">{customer.name}</span>
                                     </div>
                                     <div className="flex items-center gap-3">
                                        <Phone size={16} className="text-muted-foreground"/>
                                        <span>{customer.phone}</span>
                                     </div>
                                     <div className="flex items-start gap-3">
                                        <MapPin size={16} className="text-muted-foreground mt-1"/>
                                        <span className="flex-1">{order.customerAddress}</span>
                                     </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                                   <div className="bg-muted p-3 rounded-lg text-center">
                                        <p className="text-xs text-muted-foreground">Total Spend</p>
                                        <p className="text-lg font-bold">₹{customer.totalSpend?.toLocaleString() || 0}</p>
                                   </div>
                                   <div className="bg-muted p-3 rounded-lg text-center">
                                        <p className="text-xs text-muted-foreground">Total Orders</p>
                                        <p className="text-lg font-bold">{customer.totalOrders || 0}</p>
                                   </div>
                                </div>
                                <Link href={`/owner-dashboard/customers?customerId=${order.customerId}`}>
                                    <Button variant="outline" className="w-full">View Full Customer Profile</Button>
                                </Link>
                            </>
                        ) : (
                            <p className="text-muted-foreground text-center py-8">Customer details could not be loaded.</p>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};


const ActionButton = ({ status, onNext, onRevert, order, onRejectClick, isUpdating, onPrintClick, onAssignClick }) => {
    const isConfirmable = status === 'pending' || status === 'paid';
    const actionStatus = isConfirmable ? 'pending' : status;
    const currentIndex = statusFlow.indexOf(actionStatus);

    const nextStatus = statusFlow[currentIndex + 1];
    const prevStatus = currentIndex > 1 ? statusFlow[currentIndex - 1] : (status === 'confirmed' ? 'pending' : null);


    if (isUpdating) {
        return (
            <div className="flex items-center justify-center gap-2 h-9 text-muted-foreground text-sm w-full">
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
        'pending': { text: 'Confirm Order', icon: Check, action: () => onNext(nextStatus) },
        'confirmed': { text: 'Start Preparing', icon: CookingPot, action: () => onNext(nextStatus) },
        'preparing': { text: 'Out for Delivery', icon: Bike, action: onAssignClick },
        'dispatched': { text: 'Mark Delivered', icon: PartyPopper, action: () => onNext(nextStatus) },
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
                        <Undo size={16} />
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


// Main Board Component
export default function LiveOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'orderDate', direction: 'desc' });
  const [billData, setBillData] = useState({ order: null, restaurant: null });
  const [assignModalData, setAssignModalData] = useState({ isOpen: false, order: null });
  const [rejectionModalData, setRejectionModalData] = useState({ isOpen: false, order: null });
  const [detailModalData, setDetailModalData] = useState({ isOpen: false, data: null });
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  const fetchInitialData = async (isManualRefresh = false) => {
    if (!isManualRefresh) setLoading(true);
    
    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        const idToken = await user.getIdToken();

        let ordersUrl = new URL('/api/owner/orders', window.location.origin);
        let ridersUrl = new URL('/api/owner/delivery', window.location.origin);
        if (impersonatedOwnerId) {
            ordersUrl.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            ridersUrl.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const [ordersRes, ridersRes] = await Promise.all([
            fetch(ordersUrl.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } }),
            fetch(ridersUrl.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } })
        ]);

        if (!ordersRes.ok) throw new Error('Failed to fetch orders');
        const ordersData = await ordersRes.json();
        
        if (ridersRes.ok) {
            const ridersData = await ridersRes.json();
            // Now we get ALL riders to show in the modal
            setRiders(ridersData.boys || []);
        }

        setOrders(ordersData.orders || []);
    } catch (error) {
        console.error(error);
        alert("Could not load data: " + error.message);
    } finally {
        if(!isManualRefresh) setLoading(false);
    }
  };
  
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) fetchInitialData();
      else setLoading(false);
    });

    const interval = setInterval(() => fetchInitialData(true), 30000);
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
      await fetchInitialData(true);
    } catch (error) {
      alert(`Error updating status: ${error.message}`);
    } finally {
      setUpdatingOrderId(null);
    }
  };
  
  const handleAssignRider = async (orderId, riderId, activateRider) => {
    setUpdatingOrderId(orderId);
    try {
        if (activateRider) {
             console.log(`Activating rider ${riderId}...`);
             // We send a separate, non-blocking call to update the rider status
             handleAPICall('PATCH', { boy: { id: riderId, status: 'Available' } }, '/api/owner/delivery');
        }
        
        await handleAPICall('PATCH', { orderId, newStatus: 'dispatched', deliveryBoyId: riderId });
        await fetchInitialData(true);
        setAssignModalData({ isOpen: false, order: null });
    } catch (error) {
        alert(`Error assigning rider: ${error.message}`);
        setAssignModalData({ isOpen: false, order: null });
        // Re-throw to be caught by the modal's finally block
        throw error;
    } finally {
        setUpdatingOrderId(null);
    }
  };


  const handleRejectOrder = async (orderId, reason) => {
    setUpdatingOrderId(orderId);
    try {
        await handleAPICall('PATCH', { orderId, newStatus: 'rejected', rejectionReason: reason });
        await fetchInitialData(true);
    } catch (error) {
        alert(`Error rejecting order: ${error.message}`);
        throw error; // Re-throw so modal knows it failed
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

  const handleDetailClick = async (orderId, customerId) => {
    try {
      setUpdatingOrderId(orderId);
      const data = await handleAPICall('GET', { id: orderId, customerId: customerId });
      setDetailModalData({ isOpen: true, data });
    } catch(e) {
      alert("Could not load details: " + e.message);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };


  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const filteredAndSortedOrders = useMemo(() => {
    let sortableItems = [...orders];

    if (activeFilter !== 'All') {
        if (activeFilter === 'New') {
            sortableItems = sortableItems.filter(order => order.status === 'pending' || order.status === 'paid');
        } else {
            sortableItems = sortableItems.filter(order => order.status === activeFilter.toLowerCase());
        }
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
        
         {billData.order && (
            <BillModal 
                order={billData.order}
                restaurant={billData.restaurant}
                onClose={() => setBillData({ order: null, restaurant: null })}
                onPrint={handlePrint}
            />
        )}
        
        <OrderDetailModal
            isOpen={detailModalData.isOpen}
            onClose={() => setDetailModalData({ isOpen: false, data: null })}
            data={detailModalData.data}
        />

        {assignModalData.isOpen && (
            <AssignRiderModal
                isOpen={assignModalData.isOpen}
                onClose={() => setAssignModalData({ isOpen: false, order: null })}
                onAssign={handleAssignRider}
                order={assignModalData.order}
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
                <Button onClick={() => fetchInitialData(true)} variant="outline" className="flex-shrink-0">
                    <RefreshCw size={16} className={cn(loading && "animate-spin")} />
                    <span className="ml-2 hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
                </Button>
            </div>
        </div>

        <Tabs defaultValue="All" value={activeFilter} onValueChange={setActiveFilter} className="w-full mb-6">
            <TabsList className="flex w-full overflow-x-auto bg-muted p-1 h-auto justify-start">
                <TabsTrigger value="All">All</TabsTrigger>
                <TabsTrigger value="New">New</TabsTrigger>
                <TabsTrigger value="Confirmed">Confirmed</TabsTrigger>
                <TabsTrigger value="Preparing">Preparing</TabsTrigger>
                <TabsTrigger value="Dispatched">Dispatched</TabsTrigger>
                <TabsTrigger value="Delivered">Delivered</TabsTrigger>
                <TabsTrigger value="Rejected">Rejected</TabsTrigger>
            </TabsList>
        </Tabs>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-muted/30">
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
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4 hidden md:table-cell"><div className="h-5 bg-muted rounded w-full"></div></td>
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
                                    <td className="p-4">
                                        <div className="font-bold text-foreground text-sm truncate max-w-[100px] sm:max-w-none">{order.id}</div>
                                        <div className="flex items-center gap-2">
                                            <div className="text-sm text-muted-foreground">{order.customer}</div>
                                             <button onClick={() => handleDetailClick(order.id, order.customerId)} title="View Customer & Order Details">
                                                <User size={14} className="text-primary hover:text-primary/80 cursor-pointer"/>
                                            </button>
                                        </div>
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
                                    <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                                        <ul className="space-y-1">
                                            {(order.items || []).map((item, index) => (
                                                <li key={index} className="whitespace-nowrap">{item.qty}x {item.name}</li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">
                                        {format(new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate), 'dd/MM/yyyy, hh:mm a')}
                                    </td>
                                    <td className="p-4">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <button className={cn('flex items-center gap-2 text-xs font-semibold rounded-full border px-3 py-1 w-fit capitalize transition-transform hover:scale-105', statusConfig[order.status]?.color)}>
                                                    {order.status}
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
                                    <td className="p-4 w-auto md:w-[320px]">
                                        <ActionButton
                                            order={order}
                                            status={order.status}
                                            isUpdating={updatingOrderId === order.id}
                                            onNext={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRevert={(newStatus) => handleUpdateStatus(order.id, newStatus)}
                                            onRejectClick={(order) => setRejectionModalData({ isOpen: true, order: order })}
                                            onPrintClick={() => handlePrintClick(order.id)}
                                            onAssignClick={() => setAssignModalData({ isOpen: true, order: order })}
                                        />
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                         { !loading && filteredAndSortedOrders.length === 0 && (
                            <tr>
                                <td colSpan="5" className="text-center p-16 text-muted-foreground">
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

    




    

    

