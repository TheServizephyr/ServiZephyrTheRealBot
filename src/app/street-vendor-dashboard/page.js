
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, QrCode, CookingPot, PackageCheck, Check, X, Loader2, User, Phone, History, Wallet, IndianRupee, Calendar as CalendarIcon, Search, Filter, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useMemoFirebase, useCollection } from '@/firebase';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, Timestamp, getDocs, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { startOfDay, endOfDay, format, addDays } from 'date-fns';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import QrScanner from '@/components/QrScanner';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'dd/MM, p'); // e.g., 25/12, 1:33 PM
};

const RejectOrderModal = ({ order, isOpen, onClose, onConfirm, onMarkOutOfStock, showInfoDialog }) => {
    const [reason, setReason] = useState('');
    const [otherReason, setOtherReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const [isOutOfStockModalOpen, setIsOutOfStockModalOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setOtherReason('');
            setIsSubmitting(false);
            setIsOutOfStockModalOpen(false);
        }
    }, [isOpen]);

    const handleConfirm = async () => {
        if (reason === 'item_unavailable') {
            setIsOutOfStockModalOpen(true);
            return;
        }

        const finalReason = reason === 'other' ? otherReason : reason;
        if (!finalReason) {
            showInfoDialog({ isOpen: true, title: 'Validation Error', message: 'Please select or enter a reason for rejection.' });
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(order.id, finalReason);
            onClose();
        } catch (error) {
            showInfoDialog({ isOpen: true, title: 'Error', message: `Could not reject order: ${error.message}` });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleOutOfStockConfirm = async (outOfStockItems) => {
        setIsSubmitting(true);
        try {
            if (outOfStockItems.length > 0) {
              await onMarkOutOfStock(outOfStockItems);
            }
            await onConfirm(order.id, "Item(s) out of stock");
            setIsOutOfStockModalOpen(false);
            onClose();
            showInfoDialog({isOpen: true, title: 'Success', message: 'Item(s) marked as out of stock and order rejected.'});

        } catch (error) {
             showInfoDialog({ isOpen: true, title: 'Error', message: `Could not perform action: ${error.message}` });
        } finally {
            setIsSubmitting(false);
        }
    };

    const rejectionReasons = [
        { value: "item_unavailable", label: "Item(s) out of stock" },
        { value: "customer_request", label: "Customer requested cancellation" },
        { value: "other", label: "Other" },
    ];
    
    if (!isOpen) return null;

    return (
        <>
            <Dialog open={isOpen && !isOutOfStockModalOpen} onOpenChange={onClose}>
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
                            {isSubmitting ? "Rejecting..." : (reason === 'item_unavailable' ? "Next" : "Confirm Rejection")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {order && <OutOfStockModal isOpen={isOutOfStockModalOpen} onClose={() => setIsOutOfStockModalOpen(false)} orderItems={order.items} onConfirm={handleOutOfStockConfirm} />}
        </>
    );
};

const OutOfStockModal = ({ isOpen, onClose, orderItems, onConfirm }) => {
    const [selectedItems, setSelectedItems] = useState([]);
    const [isConfirming, setIsConfirming] = useState(false);

    const handleToggleItem = (itemId) => {
        setSelectedItems(prev => 
            prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
        );
    };

    const handleConfirm = async () => {
        setIsConfirming(true);
        await onConfirm(selectedItems);
        setIsConfirming(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Mark Items Out of Stock</DialogTitle>
                    <DialogDescription>
                        Select the items that are out of stock. This will update your menu automatically.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2 max-h-60 overflow-y-auto">
                    {orderItems.map(item => (
                        <div key={item.id || item.name} className="flex items-center space-x-3 p-3 rounded-lg bg-muted border border-border">
                            <Checkbox 
                                id={`stock-${item.id}`} 
                                checked={selectedItems.includes(item.id)}
                                onCheckedChange={() => handleToggleItem(item.id)}
                            />
                            <Label htmlFor={`stock-${item.id}`} className="font-semibold text-foreground cursor-pointer flex-grow">
                                {item.name}
                            </Label>
                        </div>
                    ))}
                </div>
                <DialogFooter>
                     <Button variant="secondary" onClick={onClose} disabled={isConfirming}>Skip</Button>
                     <Button variant="destructive" onClick={handleConfirm} disabled={isConfirming}>
                        {isConfirming ? "Updating..." : `Confirm & Reject Order`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const OrderCard = ({ order, onMarkReady, onCancelClick, onMarkCollected }) => {
    const token = order.dineInToken;
    const isPending = order.status === 'pending';
    const isReady = order.status === 'Ready';

    let statusClass = 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
    let borderClass = 'border-yellow-500';
    if (isReady) {
        statusClass = 'text-green-500 bg-green-500/10 border-green-500/20';
        borderClass = 'border-green-500';
    } else if (order.status === 'delivered' || order.status === 'picked_up') {
        statusClass = 'text-blue-500 bg-blue-500/10 border-blue-500/20';
        borderClass = 'border-blue-500';
    } else if (order.status === 'rejected') {
        statusClass = 'text-red-500 bg-red-500/10 border-red-500/20';
        borderClass = 'border-red-500';
    }
    
    const isPaidOnline = order.paymentDetails?.method === 'razorpay';

    return (
        <motion.div
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
                        <p className="text-xs text-muted-foreground mt-1">{formatDateTime(order.orderDate)}</p>
                    </div>
                </div>
                 <div className="flex justify-between items-center mt-2 border-b border-dashed border-border pb-3 mb-3">
                    <p className="text-3xl font-bold text-green-500">{formatCurrency(order.totalAmount)}</p>
                    {isPaidOnline ? (
                         <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                            <Wallet size={14}/> PAID ONLINE
                        </div>
                    ) : (
                         <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            <IndianRupee size={14}/> PAY AT COUNTER
                        </div>
                    )}
                </div>

                <div className="mt-2 text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                        <User size={16}/>
                        <span className="font-semibold text-foreground text-lg">{order.customerName}</span>
                    </div>
                    {order.customerPhone && (
                        <div className="flex items-center gap-2 text-sm">
                            <Phone size={14}/>
                            <span>{order.customerPhone}</span>
                        </div>
                    )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-border">
                    <p className="font-semibold text-foreground">Items:</p>
                    <ul className="list-disc list-inside text-muted-foreground text-sm">
                        {order.items.map(item => (
                            <li key={item.name}>{item.quantity}x {item.name}</li>
                        ))}
                    </ul>
                </div>
            </div>
            <div className="mt-4">
                {isPending && (
                    <div className="grid grid-cols-2 gap-2">
                         <Button onClick={() => onCancelClick(order)} variant="destructive" className="h-12 text-base">
                            <X className="mr-2" /> Cancel
                        </Button>
                        <Button onClick={() => onMarkReady(order.id)} className="bg-green-600 hover:bg-green-700 h-12 text-base">
                            <CookingPot className="mr-2" /> Mark Ready
                        </Button>
                    </div>
                )}
                {isReady && (
                     <Button onClick={() => onMarkCollected(order.id)} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-lg h-12">
                        <PackageCheck className="mr-2" /> Mark as Collected
                    </Button>
                )}
            </div>
        </motion.div>
    );
};

const ScannedOrderModal = ({ order, isOpen, onClose, onConfirm }) => {
    if (!order) return null;
    const isPaidOnline = order.paymentDetails?.method === 'razorpay';
    const orderDate = order?.orderDate;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Confirm Collection for Order <span className="font-mono text-primary">{order.dineInToken}</span></DialogTitle>
                    <DialogDescription>
                        Hand over the following items to the customer. This will automatically mark the order as collected.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                     <div className="p-4 bg-muted rounded-lg border border-border">
                        <div className="flex justify-between items-center font-bold">
                            <span>TOTAL BILL:</span>
                            <span className="text-2xl text-primary">{formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1">
                            <span>Payment Status:</span>
                             {isPaidOnline ? (
                                <span className="font-semibold text-green-500">PAID ONLINE</span>
                            ) : (
                                <span className="font-semibold text-yellow-400">TO BE COLLECTED AT COUNTER</span>
                            )}
                        </div>
                    </div>
                    <div>
                        <h4 className="font-semibold text-muted-foreground mb-2">Customer Details:</h4>
                        <p><strong>Name:</strong> {order.customerName}</p>
                        {order.customerPhone && <p><strong>Phone:</strong> {order.customerPhone}</p>}
                        {orderDate && <p><strong>Time:</strong> {format(new Date(orderDate.seconds * 1000), 'hh:mm a')}</p>}
                    </div>
                     <div>
                        <h4 className="font-semibold text-muted-foreground mb-2">Items:</h4>
                        <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                           {order.items.map(item => (
                                <li key={item.name}>{item.quantity}x {item.name}</li>
                            ))}
                        </ul>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={onConfirm} className="bg-primary hover:bg-primary/90">Confirm & Handover</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const StreetVendorDashboardContent = () => {
    const { user, isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isScannerOpen, setScannerOpen] = useState(false);
    const [scannedOrder, setScannedOrder] = useState(null);
    const searchParams = useSearchParams();
    const [date, setDate] = useState(null);
    const [error, setError] = useState(null);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [rejectModalState, setRejectModalState] = useState({ isOpen: false, order: null });


    const handleApiCall = useCallback(async (endpoint, method = 'PATCH', body = {}) => {
        if (!user) throw new Error('Authentication Error');
        const idToken = await user.getIdToken();
        const response = await fetch(endpoint, {
            method,
            headers: { 
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
             },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'An API error occurred.');
        }
        return await response.json();
    }, [user]);

    const handleScanSuccess = useCallback(async (scannedUrl) => {
        setScannerOpen(false);
        try {
            const url = new URL(scannedUrl);
            const orderId = url.searchParams.get('collect_order');
    
            if (!orderId) {
                throw new Error('This QR code does not contain a valid order ID.');
            }
    
            const orderRef = doc(db, 'orders', orderId);
            const orderSnap = await getDoc(orderRef);
            if (!orderSnap.exists()) {
                throw new Error('Order not found in the system.');
            }

            if (!vendorId) {
                 throw new Error('Vendor information not yet loaded. Please try again in a moment.');
            }

            if (orderSnap.data().restaurantId !== vendorId) {
                throw new Error('This order does not belong to your stall.');
            }
            setScannedOrder({ id: orderSnap.id, ...orderSnap.data() });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Invalid QR', message: error.message });
        }
    }, [vendorId]);


    useEffect(() => {
        const orderToCollect = searchParams.get('collect_order');
        if (orderToCollect) {
            const fullUrl = `${window.location.origin}${window.location.pathname}?collect_order=${orderToCollect}`;
            handleScanSuccess(fullUrl);
        }
    }, [searchParams, handleScanSuccess]);

    const confirmCollection = async () => {
        if (!scannedOrder) return;
        const tempOrder = { ...scannedOrder };
        try {
            await handleUpdateStatus(tempOrder.id, 'delivered');
            setInfoDialog({isOpen: true, title: 'Success', message: `Order for ${tempOrder.customerName} marked as collected!`});
            setScannedOrder(null);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not mark order as collected: ${error.message}` });
        }
    };

    useEffect(() => {
        if (isUserLoading || !user) {
            if(!isUserLoading) setLoading(false);
            return;
        }

        const q = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            if (!querySnapshot.empty) {
                const vendorDoc = querySnapshot.docs[0];
                setVendorId(vendorDoc.id);
            } else {
                setLoading(false);
            }
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: `street_vendors`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Error fetching vendor ID:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, isUserLoading]);

    useEffect(() => {
        if (!vendorId) return;
        
        setLoading(true);

        let q = query(collection(db, "orders"), where("restaurantId", "==", vendorId));
        
        if (date?.from) {
            const start = startOfDay(date.from);
            const end = date.to ? endOfDay(date.to) : endOfDay(date.from);
            q = query(q, where("orderDate", ">=", Timestamp.fromDate(start)), where("orderDate", "<=", Timestamp.fromDate(end)));
        }
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedOrders = [];
            querySnapshot.forEach((doc) => {
                fetchedOrders.push({ id: doc.id, ...doc.data() });
            });
            fetchedOrders.sort((a,b) => (b.orderDate?.seconds || 0) - (a.orderDate?.seconds || 0));
            setOrders(fetchedOrders);
            setLoading(false);
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: `orders`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId, date]);

    const handleUpdateStatus = async (orderId, newStatus, reason = null) => {
        try {
            await handleApiCall('/api/owner/orders', 'PATCH', {
                orderIds: [orderId],
                newStatus,
                rejectionReason: reason,
            });
        } catch (error) {
             setInfoDialog({isOpen: true, title: "Error", message: error.message});
             throw error;
        }
    };
    
    const handleMarkOutOfStock = async (itemIds) => {
        if (!vendorId || itemIds.length === 0) return;
        try {
            await handleApiCall('/api/owner/menu', 'PATCH', {
                itemIds: itemIds, action: 'outOfStock'
            });
        } catch(error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not mark item as out of stock: ${error.message}` });
            throw error;
        }
    };

    const handleMarkReady = (orderId) => handleUpdateStatus(orderId, 'Ready');
    const handleMarkCollected = (orderId) => handleUpdateStatus(orderId, 'delivered');
    const handleOpenRejectModal = (order) => setRejectModalState({ isOpen: true, order });
    
    const filteredOrders = useMemo(() => {
        if (!searchQuery) return orders;
        const lowerQuery = searchQuery.toLowerCase();
        return orders.filter(order => 
            order.dineInToken?.toLowerCase().includes(lowerQuery) ||
            order.customerName?.toLowerCase().includes(lowerQuery) ||
            order.customerPhone?.includes(lowerQuery) ||
            order.totalAmount?.toString().includes(lowerQuery)
        );
    }, [orders, searchQuery]);

    const pendingOrders = useMemo(() => filteredOrders.filter(o => o.status === 'pending'), [filteredOrders]);
    const readyOrders = useMemo(() => filteredOrders.filter(o => o.status === 'Ready'), [filteredOrders]);
    const collectedOrders = useMemo(() => filteredOrders.filter(o => o.status === 'delivered' || o.status === 'picked_up'), [filteredOrders]);
    
     const handleSetDateFilter = (selectedRange) => {
        setDate(selectedRange);
        if (selectedRange?.to || !selectedRange?.from) {
            setIsCalendarOpen(false);
        }
    };

  return (
    <div className="min-h-screen bg-background text-foreground font-body p-4 pb-24">
        <InfoDialog 
            isOpen={infoDialog.isOpen} 
            onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
            title={infoDialog.title} 
            message={infoDialog.message}
        />
        <RejectOrderModal
            isOpen={rejectModalState.isOpen}
            onClose={() => setRejectModalState({ isOpen: false, order: null })}
            order={rejectModalState.order}
            onConfirm={handleUpdateStatus}
            onMarkOutOfStock={handleMarkOutOfStock}
            showInfoDialog={setInfoDialog}
        />

        {isScannerOpen && (
            <QrScanner onClose={() => setScannerOpen(false)} onScanSuccess={handleScanSuccess} />
        )}
        {scannedOrder && <ScannedOrderModal isOpen={!!scannedOrder} onClose={() => setScannedOrder(null)} order={scannedOrder} onConfirm={confirmCollection} />}
        
        <header className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold font-headline">Live Pre-Orders</h1>
             <Button onClick={() => setScannerOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground hidden md:flex">
                <QrCode className="mr-2" /> Scan to Collect
            </Button>
        </header>

        <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search by token, name, phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                />
            </div>
            <div className="flex-shrink-0">
                 <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                          "w-auto justify-start text-left font-normal h-10",
                          !date && "text-muted-foreground"
                        )}
                      >
                         <CalendarIcon className={cn("h-4 w-4", date && "text-primary")} />
                         <span className={cn("truncate hidden md:inline-block ml-2", date && "text-primary")}>
                            {date?.from ? (
                              date.to ? (
                                <>
                                  {format(date.from, "LLL dd")} - {format(date.to, "LLL dd, y")}
                                </>
                              ) : (
                                format(date.from, "LLL dd, y")
                              )
                            ) : (
                              "Filter by Date"
                            )}
                         </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                       <Calendar
                        initialFocus
                        mode="range"
                        selected={date}
                        onSelect={handleSetDateFilter}
                        numberOfMonths={1}
                        disabled={(d) => d > new Date() || d < new Date("2024-01-01")}
                      />
                    </PopoverContent>
                  </Popover>
                  {date && <Button variant="ghost" size="sm" onClick={() => setDate(null)} className="ml-2">Clear</Button>}
            </div>
        </div>
        
        <main>
            {(loading || isUserLoading || !vendorId) && !error ? (
                 <div className="text-center py-20 text-muted-foreground">
                    <Loader2 className="mx-auto animate-spin" size={48} />
                    <p className="mt-4">Loading your dashboard...</p>
                 </div>
            ) : error ? (
                 <div className="text-center py-20 text-red-500">{error}</div>
            ) : (
                <Tabs defaultValue="new_orders" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="new_orders">New ({pendingOrders.length})</TabsTrigger>
                        <TabsTrigger value="ready">Ready ({readyOrders.length})</TabsTrigger>
                        <TabsTrigger value="collected">Collected ({collectedOrders.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="new_orders" className="mt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                             <AnimatePresence>
                                {pendingOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancelClick={handleOpenRejectModal} />
                                ))}
                            </AnimatePresence>
                            {pendingOrders.length === 0 && <p className="text-muted-foreground text-center py-10 col-span-full">No new orders for the selected date.</p>}
                        </div>
                    </TabsContent>
                    <TabsContent value="ready" className="mt-4">
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <AnimatePresence>
                                {readyOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkCollected={handleMarkCollected} />
                                ))}
                            </AnimatePresence>
                            {readyOrders.length === 0 && <p className="text-muted-foreground text-center py-10 col-span-full">No orders are ready for pickup.</p>}
                        </div>
                    </TabsContent>
                    <TabsContent value="collected" className="mt-4">
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                             <AnimatePresence>
                                {collectedOrders.map(order => (
                                    <OrderCard key={order.id} order={order} />
                                ))}
                            </AnimatePresence>
                            {collectedOrders.length === 0 && <p className="text-muted-foreground text-center py-10 col-span-full">No orders have been collected for the selected date.</p>}
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </main>
        <div className="md:hidden fixed bottom-6 right-6 z-40">
             <Button onClick={() => setScannerOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground h-16 w-16 rounded-full shadow-lg">
                <QrCode size={32} />
            </Button>
        </div>
    </div>
  );
}

const StreetVendorDashboard = () => (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
        <StreetVendorDashboardContent />
    </Suspense>
);

export default StreetVendorDashboard;
