
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, QrCode, CookingPot, PackageCheck, Check, X, Loader2, User, Phone, History, Wallet, IndianRupee, Calendar as CalendarIcon, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useMemoFirebase, useCollection } from '@/firebase';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, Timestamp, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { startOfDay, endOfDay, format } from 'date-fns';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import QrScanner from '@/components/QrScanner';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'dd/MM, p'); // e.g., 25/12, 1:33 PM
};

const OrderCard = ({ order, onMarkReady, onCancel, onMarkCollected }) => {
    const token = order.dineInToken;
    const isPending = order.status === 'pending';
    const isReady = order.status === 'Ready';

    let statusClass = 'text-yellow-400 bg-yellow-100 border-yellow-200';
    if (isReady) {
        statusClass = 'text-green-700 bg-green-100 border-green-200';
    } else if (order.status === 'delivered' || order.status === 'picked_up') {
        statusClass = 'text-blue-700 bg-blue-100 border-blue-200';
    } else if (order.status === 'rejected') {
        statusClass = 'text-red-700 bg-red-100 border-red-200';
    }
    
    const isPaidOnline = order.paymentDetails?.method === 'razorpay';

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="rounded-lg p-4 flex flex-col justify-between border-l-4 bg-white border-yellow-500"
        >
            <div>
                <div className="flex justify-between items-start">
                    <p className="text-4xl font-bold text-black">{token}</p>
                    <div className="text-right">
                        <div className={cn('px-2 py-1 text-xs font-semibold rounded-full border bg-opacity-20 capitalize', statusClass)}>{order.status}</div>
                        <p className="text-xs text-gray-500 mt-1">{formatDateTime(order.orderDate)}</p>
                    </div>
                </div>
                 <div className="flex justify-between items-center mt-2 border-b border-dashed border-gray-300 pb-3 mb-3">
                    <p className="text-3xl font-bold text-green-600">{formatCurrency(order.totalAmount)}</p>
                    {isPaidOnline ? (
                         <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                            <Wallet size={14}/> PAID ONLINE
                        </div>
                    ) : (
                         <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                            <IndianRupee size={14}/> PAY AT COUNTER
                        </div>
                    )}
                </div>

                <div className="mt-2 text-gray-600 space-y-1">
                    <div className="flex items-center gap-2">
                        <User size={16}/>
                        <span className="font-semibold text-black text-lg">{order.customerName}</span>
                    </div>
                    {order.customerPhone && (
                        <div className="flex items-center gap-2 text-sm">
                            <Phone size={14}/>
                            <span>{order.customerPhone}</span>
                        </div>
                    )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-gray-300">
                    <p className="font-semibold text-black">Items:</p>
                    <ul className="list-disc list-inside text-gray-600 text-sm">
                        {order.items.map(item => (
                            <li key={item.name}>{item.quantity}x {item.name}</li>
                        ))}
                    </ul>
                </div>
            </div>
            <div className="mt-4">
                {isPending && (
                    <div className="grid grid-cols-2 gap-2">
                         <Button onClick={() => onCancel(order.id)} variant="destructive" className="h-12 text-base">
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


export default function StreetVendorDashboard() {
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
        
        if (date) {
             const start = startOfDay(date);
             const end = endOfDay(date);
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

    const handleUpdateStatus = async (orderId, newStatus) => {
        try {
            await handleApiCall('/api/owner/orders', 'PATCH', {
                orderIds: [orderId],
                newStatus
            });
        } catch (error) {
             setInfoDialog({isOpen: true, title: "Error", message: error.message});
        }
    };

    const handleMarkReady = (orderId) => handleUpdateStatus(orderId, 'Ready');
    const handleCancelOrder = (orderId) => handleUpdateStatus(orderId, 'rejected');
    const handleMarkCollected = (orderId) => handleUpdateStatus(orderId, 'delivered');
    
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
    
    const handleSetDateFilter = (selectedDate) => {
        setDate(selectedDate);
        if(selectedDate) setIsCalendarOpen(false);
    };

  return (
    <div className="min-h-screen bg-background text-foreground font-body p-4 pb-24">
        <InfoDialog 
            isOpen={infoDialog.isOpen} 
            onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
            title={infoDialog.title} 
            message={infoDialog.message}
        />
        {isScannerOpen && <QrScanner onClose={() => setScannerOpen(false)} onScanSuccess={handleScanSuccess} />}
        {scannedOrder && <ScannedOrderModal isOpen={!!scannedOrder} onClose={() => setScannedOrder(null)} order={scannedOrder} onConfirm={confirmCollection} />}
        
        <div className="fixed bottom-4 right-4 z-50 md:relative md:bottom-auto md:right-auto md:mb-6">
             <Button className="md:hidden h-16 w-16 rounded-full shadow-lg bg-black hover:bg-gray-800" size="icon" onClick={() => setScannerOpen(true)}>
                <QrCode size={28} className="text-white"/>
            </Button>
            <Button className="hidden md:flex w-full h-16 text-lg bg-primary hover:bg-primary/80" onClick={() => setScannerOpen(true)}>
                <QrCode className="mr-3"/> Scan QR to Collect
            </Button>
        </div>


        <div className="mb-6 flex flex-col md:flex-row items-center justify-center gap-4">
            <div className="relative w-full flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search by token, name, phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                />
            </div>
             <div className="flex w-full md:w-auto items-center justify-center gap-2">
                 <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        size="sm"
                        className={cn(
                          "w-full md:w-auto justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                         <span>
                            {date ? format(date, "LLL dd, yyyy") : "All Time"}
                         </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <div className="p-2 flex flex-col gap-2">
                            <Button variant="ghost" size="sm" className="justify-start" onClick={() => handleSetDateFilter(null)}>All Time</Button>
                            <Button variant="ghost" size="sm" className="justify-start" onClick={() => handleSetDateFilter(new Date())}>Today</Button>
                        </div>
                      <Calendar
                        initialFocus
                        mode="single"
                        selected={date}
                        onSelect={handleSetDateFilter}
                        disabled={(d) => d > new Date() || d < new Date("2024-01-01")}
                      />
                    </PopoverContent>
                  </Popover>
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
                        <div className="space-y-4">
                             <AnimatePresence>
                                {pendingOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancel={handleCancelOrder} />
                                ))}
                            </AnimatePresence>
                            {pendingOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No new orders for the selected date.</p>}
                        </div>
                    </TabsContent>
                    <TabsContent value="ready" className="mt-4">
                         <div className="space-y-4">
                            <AnimatePresence>
                                {readyOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkCollected={handleMarkCollected} />
                                ))}
                            </AnimatePresence>
                            {readyOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No orders are ready for pickup.</p>}
                        </div>
                    </TabsContent>
                    <TabsContent value="collected" className="mt-4">
                         <div className="space-y-4">
                             <AnimatePresence>
                                {collectedOrders.map(order => (
                                    <OrderCard key={order.id} order={order} />
                                ))}
                            </AnimatePresence>
                            {collectedOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No orders have been collected today.</p>}
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </main>
    </div>
  );
}
