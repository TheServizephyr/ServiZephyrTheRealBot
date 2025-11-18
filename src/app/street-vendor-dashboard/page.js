
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, QrCode, CookingPot, PackageCheck, Check, X, Loader2, User, Phone, History, Wallet, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';

const QrScanner = dynamic(() => import('@/components/QrScanner'), { 
    ssr: false,
    loading: () => <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>
});

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const OrderCard = ({ order, onMarkReady, onCancel, onMarkCollected }) => {
    const token = order.dineInToken; // Use dineInToken for display
    const isPending = order.status === 'pending';
    const isReady = order.status === 'Ready';

    let cardClass = 'border-yellow-500 bg-yellow-500/10';
    let statusClass = 'text-yellow-400';
    if (isReady) {
        cardClass = 'border-green-500 bg-green-500/10';
        statusClass = 'text-green-400';
    }
    
    const isPaidOnline = order.paymentDetails?.method === 'razorpay';

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={`bg-card rounded-lg p-4 flex flex-col justify-between border-l-4 ${cardClass}`}
        >
            <div>
                <div className="flex justify-between items-start">
                    <p className="text-4xl font-bold text-foreground">{token}</p>
                    <div className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClass} bg-opacity-20`}>{order.status}</div>
                </div>
                 <div className="flex justify-between items-center mt-2 border-b border-dashed border-border/50 pb-3 mb-3">
                    <p className="text-3xl font-bold text-primary">₹{order.totalAmount.toFixed(2)}</p>
                    {isPaidOnline ? (
                         <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
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
                <div className="mt-3 pt-3 border-t border-dashed border-border/50">
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
                         <Button onClick={() => onCancel(order.id)} variant="destructive" className="h-12 text-base">
                            <X className="mr-2" /> Cancel
                        </Button>
                        <Button onClick={() => onMarkReady(order.id)} className="bg-primary h-12 text-base">
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
        setScannedOrder(null);
        await handleUpdateStatus(tempOrder.id, 'delivered');
        setInfoDialog({isOpen: true, title: 'Success', message: `Order for ${tempOrder.customerName} marked as collected!`});
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

        const q = query(
            collection(db, "orders"), 
            where("restaurantId", "==", vendorId),
            where("status", "in", ["pending", "Ready"])
        );
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const liveOrders = [];
            querySnapshot.forEach((doc) => {
                liveOrders.push({ id: doc.id, ...doc.data() });
            });
            liveOrders.sort((a,b) => (b.orderDate?.seconds || 0) - (a.orderDate?.seconds || 0));
            setOrders(liveOrders);
            setLoading(false);
        }, (err) => {
             const contextualError = new FirestorePermissionError({ path: `orders`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId]);
    
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
    
    const pendingOrders = useMemo(() => orders.filter(o => o.status === 'pending'), [orders]);
    const readyOrders = useMemo(() => orders.filter(o => o.status === 'Ready'), [orders]);

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4">
             <InfoDialog 
                isOpen={infoDialog.isOpen} 
                onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
                title={infoDialog.title} 
                message={infoDialog.message}
            />
            {isScannerOpen && <QrScanner onClose={() => setScannerOpen(false)} onScanSuccess={handleScanSuccess} />}
            {scannedOrder && <ScannedOrderModal isOpen={!!scannedOrder} onClose={() => setScannedOrder(null)} order={scannedOrder} onConfirm={confirmCollection} />}

            <header className="flex justify-between items-center mb-6">
                 <Link href="/street-vendor-dashboard/qr" passHref>
                    <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                        <QrCode size={28} />
                    </Button>
                 </Link>
                 <h1 className="text-2xl font-bold font-headline">Live Orders</h1>
                 <div className="flex gap-2">
                     <Link href="/street-vendor-dashboard/payout-settings" passHref>
                        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                            <Wallet size={28} />
                        </Button>
                     </Link>
                     <Link href="/street-vendor-dashboard/menu" passHref>
                        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                            <ClipboardList size={28} />
                        </Button>
                     </Link>
                 </div>
            </header>
            
            <div className="mb-6">
                <Button className="w-full h-16 text-lg bg-primary hover:bg-primary/80" onClick={() => setScannerOpen(true)}>
                    <QrCode className="mr-3"/> Scan QR to Collect
                </Button>
            </div>
            
            <main>
                {loading || isUserLoading || !vendorId && !error ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <Loader2 className="mx-auto animate-spin" size={48} />
                        <p className="mt-4">Loading your dashboard...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                        <div className="space-y-4">
                            <h2 className="text-xl font-bold text-yellow-400">New Orders ({pendingOrders.length})</h2>
                            <AnimatePresence>
                                {pendingOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancel={handleCancelOrder} />
                                ))}
                            </AnimatePresence>
                            {pendingOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No new orders waiting.</p>}
                        </div>
                         <div className="space-y-4">
                            <h2 className="text-xl font-bold text-green-400">Ready for Pickup ({readyOrders.length})</h2>
                            <AnimatePresence>
                                {readyOrders.map(order => (
                                    <OrderCard key={order.id} order={order} onMarkCollected={handleMarkCollected} />
                                ))}
                            </AnimatePresence>
                             {readyOrders.length === 0 && <p className="text-muted-foreground text-center py-10">No orders are ready for pickup.</p>}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
