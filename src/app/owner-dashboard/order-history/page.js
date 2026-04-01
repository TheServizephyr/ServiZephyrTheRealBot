"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, ChevronLeft, Search, Calendar, X, Package, Phone, MapPin, CreditCard, Clock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit, Timestamp } from 'firebase/firestore';
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import OrderCancellationTool from '@/components/OrderCancellationTool';
import InfoDialog from '@/components/InfoDialog';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

const DATE_PRESETS = [
    { label: "Today", getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
    { label: "Yesterday", getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
    { label: "Last 7 Days", getValue: () => ({ from: startOfDay(subDays(new Date(), 7)), to: endOfDay(new Date()) }) }
];

const toDateInput = (date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const toAmount = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const OWNER_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];

async function resolveOwnerBusinessId(ownerId) {
    for (const collectionName of OWNER_COLLECTIONS) {
        const businessQuery = query(collection(db, collectionName), where('ownerId', '==', ownerId), limit(1));
        const businessSnapshot = await getDocs(businessQuery);
        if (!businessSnapshot.empty) {
            return businessSnapshot.docs[0].id;
        }
    }
    return null;
}

// ─── Order Detail Modal ──────────────────────────────────────────────────────
function OrderDetailModal({ order, activeTab, onClose }) {
    if (!order) return null;

    const isManualHistory = activeTab === 'manual-history';

    const items = order.items || [];
    const subtotal = toAmount(order.subtotal || order.billDetails?.subtotal, 0);
    const cgst = toAmount(order.cgst || order.billDetails?.cgst, 0);
    const sgst = toAmount(order.sgst || order.billDetails?.sgst, 0);
    const deliveryCharge = toAmount(order.deliveryCharge || order.billDetails?.deliveryCharge, 0);
    const serviceFee = toAmount(order.serviceFee || order.billDetails?.serviceFee, 0);
    const discount = toAmount(order.discount || order.billDetails?.discount, 0);
    const total = toAmount(order.totalAmount, 0) || Math.max(0, subtotal + cgst + sgst + deliveryCharge + serviceFee - discount);

    const orderId = order.customerOrderId || order.historyId || order.id;
    const customer = order.customer || order.customerName || 'Guest';
    const phone = order.customerPhone || order.phone || null;
    const rawAddress = order.customerAddress || order.deliveryAddress || null;
    const address = !rawAddress ? null
        : typeof rawAddress === 'string' ? rawAddress
        : [rawAddress.full, rawAddress.label, rawAddress.street, rawAddress.landmark, rawAddress.city, rawAddress.state, rawAddress.pincode]
            .filter(Boolean).join(', ') || null;
    const pm = order.paymentMethod || 'N/A';
    const orderDate = isManualHistory
        ? (order.printedAt ? format(new Date(order.printedAt), 'PPp') : 'N/A')
        : (order.orderDate?.seconds ? format(new Date(order.orderDate.seconds * 1000), 'PPp') : 'N/A');
    const status = order.status || (isManualHistory ? 'manual_order' : 'N/A');

    const statusColor = {
        delivered: 'bg-green-500/10 text-green-400 border-green-500/30',
        picked_up: 'bg-green-500/10 text-green-400 border-green-500/30',
        rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
        cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
        manual_order: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    }[status] || 'bg-muted text-muted-foreground border-border';

    return (
        <Dialog open={!!order} onOpenChange={onClose}>
            <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto p-0">
                <DialogHeader className="p-5 border-b border-border sticky top-0 bg-background z-10">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-lg font-bold">Order #{orderId}</DialogTitle>
                        <span className={cn("px-2 py-1 text-xs font-semibold rounded-full border capitalize", statusColor)}>
                            {status.replace(/_/g, ' ')}
                        </span>
                    </div>
                </DialogHeader>

                <div className="p-5 space-y-5">
                    {/* Customer Info */}
                    <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-semibold">{customer}</span>
                        </div>
                        {phone && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Phone className="h-4 w-4 flex-shrink-0" />
                                <span>{phone}</span>
                            </div>
                        )}
                        {address && (
                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{address}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 flex-shrink-0" />
                            <span>{orderDate}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CreditCard className="h-4 w-4 flex-shrink-0" />
                            <span className="capitalize">{pm.replace(/_/g, ' ')}</span>
                        </div>
                    </div>

                    {/* Items */}
                    <div>
                        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                            <Package className="h-4 w-4" /> Items ({items.length})
                        </h3>
                        {items.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No items info available</p>
                        ) : (
                            <div className="space-y-2">
                                {items.map((item, idx) => {
                                    const qty = item.quantity || 1;
                                    const name = item.name || item.itemName || item.item || 'Item';
                                    const lineTotal = toAmount(item.totalPrice || item.serverVerifiedTotal, 0) || (toAmount(item.price, 0) * qty);
                                    const variant = item.selectedVariant || item.variant || null;
                                    const addons = item.addons || item.selectedAddons || [];
                                    return (
                                        <div key={idx} className="flex justify-between items-start py-2 border-b border-border last:border-0 text-sm">
                                            <div className="flex-1 min-w-0 pr-2">
                                                <p className="font-medium">{qty}× {name}</p>
                                                {variant && <p className="text-xs text-muted-foreground mt-0.5">{variant}</p>}
                                                {addons.length > 0 && (
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        + {addons.map(a => a.name || a).join(', ')}
                                                    </p>
                                                )}
                                                {item.specialInstructions && (
                                                    <p className="text-xs text-yellow-500 mt-0.5 italic">&quot;{item.specialInstructions}&quot;</p>
                                                )}
                                            </div>
                                            <span className="font-semibold flex-shrink-0">₹{lineTotal.toFixed(0)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Bill Summary */}
                    <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
                        <h3 className="font-semibold mb-3">Bill Summary</h3>
                        {subtotal > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span>
                            </div>
                        )}
                        {cgst > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>CGST</span><span>₹{cgst.toFixed(2)}</span>
                            </div>
                        )}
                        {sgst > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>SGST</span><span>₹{sgst.toFixed(2)}</span>
                            </div>
                        )}
                        {deliveryCharge > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>Delivery Charge</span><span>₹{deliveryCharge.toFixed(2)}</span>
                            </div>
                        )}
                        {serviceFee > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>{order.serviceFeeLabel || 'Service Fee'}</span><span>₹{serviceFee.toFixed(2)}</span>
                            </div>
                        )}
                        {discount > 0 && (
                            <div className="flex justify-between text-green-400">
                                <span>Discount</span><span>-₹{discount.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
                            <span>Total</span><span>₹{total.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Settlement Status */}
                    {order.isSettled && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-sm text-green-400">
                            ✓ This order has been settled.
                        </div>
                    )}

                    {/* Notes / Rejection Reason */}
                    {order.specialInstructions && (
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-sm text-yellow-400">
                            <p className="font-semibold mb-1">Special Instructions:</p>
                            <p>{order.specialInstructions}</p>
                        </div>
                    )}
                    {order.rejectionReason && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                            <p className="font-semibold mb-1">Rejection Reason:</p>
                            <p>{order.rejectionReason}</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function OrderHistoryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [activeTab, setActiveTab] = useState('online');
    const [settlementFilter, setSettlementFilter] = useState('all'); // all | pending | settled

    const [orders, setOrders] = useState([]);
    const [manualOrderHistory, setManualOrderHistory] = useState([]);

    const [loading, setLoading] = useState(true);
    const [actionLoadingId, setActionLoadingId] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [dateRange, setDateRange] = useState({
        from: startOfDay(new Date()),
        to: endOfDay(new Date())
    });
    const [searchQuery, setSearchQuery] = useState('');
    const cacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_order_history::${scope}::${toDateInput(dateRange.from)}::${toDateInput(dateRange.to)}`;
    }, [impersonatedOwnerId, employeeOfOwnerId, dateRange]);

    // ── Fetchers ────────────────────────────────────────────────────────────
    const fetchOrdersData = async () => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const ownerId = user.uid;
            const restaurantId = await resolveOwnerBusinessId(ownerId);
            if (!restaurantId) return;

            const ordersQuery = query(
                collection(db, 'orders'),
                where('restaurantId', '==', restaurantId),
                where('orderDate', '>=', Timestamp.fromDate(dateRange.from)),
                where('orderDate', '<=', Timestamp.fromDate(dateRange.to)),
                orderBy('orderDate', 'desc'),
                limit(300)
            );
            const ordersSnapshot = await getDocs(ordersQuery);
            const historyStatuses = ['delivered', 'picked_up', 'rejected', 'cancelled', 'failed_delivery'];
            const fetchedOrders = [];
            ordersSnapshot.forEach((doc) => {
                const data = doc.data();
                if (historyStatuses.includes(data.status)) {
                    fetchedOrders.push({ id: doc.id, ...data });
                }
            });
            setOrders(fetchedOrders);
            return fetchedOrders;
        } catch (error) {
            console.error('[OrderHistory] Error fetching orders:', error);
            throw error;
        }
    };

    const fetchManualOrderHistoryData = async () => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const apiUrl = new URL('/api/owner/custom-bill/history', window.location.origin);
            apiUrl.searchParams.set('from', toDateInput(dateRange.from));
            apiUrl.searchParams.set('to', toDateInput(dateRange.to));
            apiUrl.searchParams.set('limit', '300');
            if (impersonatedOwnerId) apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) apiUrl.searchParams.set('employee_of', employeeOfOwnerId);

            const res = await fetch(apiUrl.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                const nextHistory = Array.isArray(data.history) ? data.history : [];
                setManualOrderHistory(nextHistory);
                return nextHistory;
            }
        } catch (error) {
            console.error('[OrderHistory] Error fetching manual order history:', error);
            throw error;
        }
    };

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [nextOrders = [], nextManualHistory = []] = await Promise.all([fetchOrdersData(), fetchManualOrderHistoryData()]);
            const payload = { orders: nextOrders, manualOrderHistory: nextManualHistory };
            try {
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: payload }));
            } catch {}
            if (isDesktopApp()) {
                await setOfflineNamespace('owner_order_history', cacheKey, { ts: Date.now(), data: payload });
            }
        } catch (error) {
            let cached = null;
            try {
                const raw = localStorage.getItem(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.data) cached = parsed.data;
                }
            } catch {}
            if (!cached && isDesktopApp()) {
                const desktopPayload = await getOfflineNamespace('owner_order_history', cacheKey, null);
                cached = desktopPayload?.data || null;
            }
            if (cached) {
                setOrders(Array.isArray(cached.orders) ? cached.orders : []);
                setManualOrderHistory(Array.isArray(cached.manualOrderHistory) ? cached.manualOrderHistory : []);
                setInfoDialog({ isOpen: true, title: 'Offline Cache Active', message: 'Live order history fetch failed, so cached desktop data is being shown.' });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAllData(); }, [dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Settlement Action ───────────────────────────────────────────────────
    const handleSettleAction = async (id, isCurrentlySettled, type) => {
        const action = isCurrentlySettled ? 'unsettle' : 'settle';
        setActionLoadingId(id);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const idToken = await user.getIdToken();

            const endpoint = type === 'manual-history' ? '/api/owner/custom-bill/history' : '/api/owner/orders';
            const body = type === 'manual-history' ? { action, historyIds: [id] } : { action, idsToUpdate: [id] };

            const apiUrl = new URL(endpoint, window.location.origin);
            if (impersonatedOwnerId) apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) apiUrl.searchParams.set('employee_of', employeeOfOwnerId);

            const res = await fetch(apiUrl.toString(), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify(body)
            });

            let data = {};
            try { data = await res.json(); } catch { }
            if (!res.ok) throw new Error(data.message || 'Operation failed');

            // Optimistic update
            if (type === 'manual-history') {
                setManualOrderHistory(prev => prev.map(bill => bill.id === id ? { ...bill, isSettled: !isCurrentlySettled } : bill));
            } else {
                setOrders(prev => prev.map(order => order.id === id ? { ...order, isSettled: !isCurrentlySettled } : order));
            }
            // Update selected order modal state too
            if (selectedOrder?.id === id) {
                setSelectedOrder(prev => ({ ...prev, isSettled: !isCurrentlySettled }));
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            setActionLoadingId(null);
        }
    };

    // ── Filtered / Sorted Data ──────────────────────────────────────────────
    const filteredData = useMemo(() => {
        let items = [];
        if (activeTab === 'online') items = orders.filter(o => !o.isManualCallOrder && o.orderSource !== 'manual_call');
        else if (activeTab === 'manual-history') items = manualOrderHistory;

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(item =>
                (item.customerOrderId || '').toString().toLowerCase().includes(q) ||
                (item.historyId || item.id || '').toString().toLowerCase().includes(q) ||
                (item.customer || item.customerName || '').toLowerCase().includes(q) ||
                (item.customerPhone || '').includes(q) ||
                (item.totalAmount || '').toString().toLowerCase().includes(q)
            );
        }

        if (settlementFilter === 'settled') items = items.filter(i => i.isSettled);
        else if (settlementFilter === 'pending') items = items.filter(i => !i.isSettled);

        return items.sort((a, b) => {
            const dateA = a.orderDate?.seconds ? a.orderDate.seconds * 1000 : new Date(a.printedAt || a.createdAt).getTime();
            const dateB = b.orderDate?.seconds ? b.orderDate.seconds * 1000 : new Date(b.printedAt || b.createdAt).getTime();
            return dateB - dateA;
        });
    }, [orders, manualOrderHistory, activeTab, searchQuery, settlementFilter]);

    const renderTableDate = (item) => {
        if (activeTab === 'manual-history') return item.printedAt ? format(new Date(item.printedAt), 'PPp') : 'N/A';
        return item.orderDate?.seconds ? format(new Date(item.orderDate.seconds * 1000), 'PPp') : 'N/A';
    };

    // ── Status Badge Helper ─────────────────────────────────────────────────
    const getStatusBadge = (status, orderType = '') => {
        if (activeTab === 'manual-history') {
            if (String(status || '').toLowerCase() === 'cancelled') {
                return <span className="px-2 py-0.5 text-xs font-medium rounded-full border capitalize bg-red-500/10 text-red-400 border-red-500/20">Cancelled</span>;
            }
            const type = String(orderType || '').toLowerCase();
            const typeMap = {
                delivery: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                pickup: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                'dine-in': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            };
            const typeCls = typeMap[type] || 'bg-purple-500/10 text-purple-400 border-purple-500/20';
            const typeLabel = type ? type.replace(/_/g, ' ') : 'Manual Order';
            return <span className={`px-2 py-0.5 text-xs font-medium rounded-full border capitalize ${typeCls}`}>{typeLabel}</span>;
        }

        const s = (status || '').toLowerCase();
        const map = {
            delivered:       'bg-green-500/10 text-green-400 border-green-500/20',
            picked_up:       'bg-green-500/10 text-green-400 border-green-500/20',
            rejected:        'bg-red-500/10 text-red-400 border-red-500/20',
            cancelled:       'bg-red-500/10 text-red-400 border-red-500/20',
            failed_delivery: 'bg-red-500/10 text-red-400 border-red-500/20',
        };
        const cls = map[s] || 'bg-muted text-muted-foreground border-border';
        const label = s === 'picked_up' ? 'Picked Up'
            : s === 'failed_delivery' ? 'Failed'
            : s.charAt(0).toUpperCase() + s.slice(1);
        return <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>{label}</span>;
    };

    const isNonPayableStatus = (status) => {
        return ['rejected', 'cancelled', 'failed_delivery'].includes((status || '').toLowerCase());
    };

    // ── Settlement Cell Helper ──────────────────────────────────────────────
    const renderSettlementCell = (item, isOnlinePrepaid) => {
        const isSettled = item.isSettled;
        const itemId = item.id;
        const isItemLoading = actionLoadingId === itemId;

        if (isOnlinePrepaid) {
            return <span className="px-3 py-1 bg-blue-500/10 text-blue-500 text-xs font-medium rounded-full border border-blue-500/20">Online Paid</span>;
        }
        // Rejected/Cancelled orders cannot be settled
        if (activeTab === 'online' && isNonPayableStatus(item.status)) {
            return <span className="px-2 py-1 text-xs text-muted-foreground">—</span>;
        }
        if (isSettled) {
            return (
                <div className="flex items-center justify-center gap-2">
                    <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs font-medium rounded-full">Settled</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        disabled={isItemLoading} onClick={(e) => { e.stopPropagation(); handleSettleAction(itemId, true, activeTab); }}>
                        {isItemLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Undo"}
                    </Button>
                </div>
            );
        }
        return (
            <Button variant="default" size="sm" className="h-8 w-20 text-xs" disabled={isItemLoading}
                onClick={(e) => { e.stopPropagation(); handleSettleAction(itemId, false, activeTab); }}>
                {isItemLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Settle"}
            </Button>
        );
    };

    const renderMobileSettlementCell = (item, isOnlinePrepaid) => {
        const isSettled = item.isSettled;
        const itemId = item.id;
        const isItemLoading = actionLoadingId === itemId;

        if (isOnlinePrepaid) {
            return <span className="px-3 py-1.5 bg-blue-500/10 text-blue-500 text-xs font-medium rounded-md border border-blue-500/20">Online Paid</span>;
        }
        // Rejected/Cancelled orders cannot be settled
        if (activeTab === 'online' && isNonPayableStatus(item.status)) {
            return <span className="text-xs text-muted-foreground px-1">—</span>;
        }
        if (isSettled) {
            return (
                <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs font-medium rounded-md">Settled</span>
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive px-2"
                        disabled={isItemLoading} onClick={() => handleSettleAction(itemId, true, activeTab)}>
                        {isItemLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Undo"}
                    </Button>
                </div>
            );
        }
        return (
            <Button variant="default" size="sm" className="h-8 w-20 text-xs font-semibold"
                disabled={isItemLoading} onClick={() => handleSettleAction(itemId, false, activeTab)}>
                {isItemLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Settle"}
            </Button>
        );
    };

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div className="flex items-center gap-3">
                    <Button onClick={() => router.push('/owner-dashboard/live-orders')} variant="ghost" size="icon">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Order History</h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">View completed orders and manage settlements</p>
                        <div className="mt-2">
                            <OfflineDesktopStatus />
                        </div>
                    </div>
                </div>
                <Button onClick={fetchAllData} variant="outline" disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    <span className="ml-2 hidden sm:inline">Refresh</span>
                </Button>
            </div>

            {/* Filters */}
            <div className="bg-card border border-border rounded-xl p-4 mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Date Presets */}
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-muted-foreground mr-1">Quick:</span>
                            {DATE_PRESETS.map((preset) => (
                                <Button key={preset.label} variant="outline" size="sm" onClick={() => setDateRange(preset.getValue())} className="text-xs">
                                    {preset.label}
                                </Button>
                            ))}
                        </div>

                        {/* Settlement Filter - Moved Above Search */}
                        <div className="flex flex-col gap-1.5 w-full md:w-auto">
                            <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground ml-1">Settlement</label>
                            <div className="flex rounded-lg border border-border overflow-hidden h-9 bg-muted/20">
                                {[['all','All'],['pending','Pending'],['settled','Settled']].map(([val, label]) => (
                                    <button key={val} onClick={() => setSettlementFilter(val)}
                                        className={cn(
                                            "px-4 text-xs font-semibold transition-all min-w-[70px]", 
                                            settlementFilter === val 
                                                ? "bg-primary text-primary-foreground shadow-sm" 
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                        )}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Date Pickers + Search */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-medium mb-1.5 block text-muted-foreground">From</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-sm h-10 border-border/60 hover:border-primary/40 transition-colors">
                                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />{format(dateRange.from, 'PP')}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <CalendarComponent mode="single" selected={dateRange.from} onSelect={(date) => date && setDateRange({ ...dateRange, from: startOfDay(date) })} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div>
                            <label className="text-xs font-medium mb-1.5 block text-muted-foreground">To</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-sm h-10 border-border/60 hover:border-primary/40 transition-colors">
                                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />{format(dateRange.to, 'PP')}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <CalendarComponent mode="single" selected={dateRange.to} onSelect={(date) => date && setDateRange({ ...dateRange, to: endOfDay(date) })} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div>
                            <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Search History</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input 
                                    type="text" 
                                    placeholder="ID, Name, Phone, Amount..." 
                                    value={searchQuery} 
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 h-10 rounded-md bg-input border border-border/60 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/60" 
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="xl:border-l xl:border-border/70 xl:pl-4 xl:self-end">
                    <OrderCancellationTool
                        accessParams={{
                            impersonate_owner_id: impersonatedOwnerId || '',
                            employee_of: employeeOfOwnerId || '',
                        }}
                        onCancelled={() => fetchAllData()}
                        title="Cancel Order By ID"
                        helperText="Looks up the order, asks for a reason, sends OTP to the owner's personal WhatsApp, then cancels after verification."
                        compact
                    />
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSettlementFilter('all'); }} className="w-full mb-6">
                <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-muted rounded-xl">
                    <TabsTrigger value="online" className="rounded-lg py-2 text-xs sm:text-sm">Online Orders</TabsTrigger>
                    <TabsTrigger value="manual-history" className="rounded-lg py-2 text-xs sm:text-sm">Manual Orders</TabsTrigger>
                </TabsList>
            </Tabs>

            {/* ── Desktop Table ────────────────────────────────────────────── */}
            <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/30">
                                <th className="p-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID</th>
                                <th className="p-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer</th>
                                <th className="p-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                                <th className="p-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date & Time</th>
                                <th className="p-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    {activeTab === 'manual-history' ? 'Type' : 'Status'}
                                </th>
                                <th className="p-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settlement</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        {[24, 32, 16, 28, 20].map((w, j) => (
                                            <td key={j} className="p-4"><div className={`h-5 bg-muted rounded w-${w}`}></div></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredData.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center text-muted-foreground">
                                        No {settlementFilter !== 'all' ? settlementFilter : ''} entries found.
                                    </td>
                                </tr>
                            ) : filteredData.map((item) => {
                                const itemId = item.id;
                                const pm = (item.paymentMethod || '').toLowerCase();
                                const isPostpaid = ['cod', 'pod', 'pay_on_delivery', 'cash', 'pay_at_restaurant', 'pay at restaurant', 'offline_counter'].includes(pm);
                                const isOnlinePrepaid = activeTab === 'online' && !isPostpaid && !!pm;

                                return (
                                    <tr key={itemId} className="hover:bg-muted/40 cursor-pointer transition-colors"
                                        onClick={() => setSelectedOrder(item)}>
                                        <td className="p-4 font-mono text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className={cn('font-semibold', String(item.status || '').toLowerCase() === 'cancelled' ? 'line-through text-muted-foreground' : 'text-primary')}>
                                                    #{item.customerOrderId || item.historyId?.substring(0,8) || itemId.substring(0, 8)}
                                                </span>
                                                {String(item.status || '').toLowerCase() === 'cancelled' && (
                                                    <span className="text-[10px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-sm font-bold border border-red-500/20" title="Cancelled">✕</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm">{item.customer || item.customerName || 'Guest'}</td>
                                        <td className={cn("p-4 text-sm font-semibold", String(item.status || '').toLowerCase() === 'cancelled' && "line-through text-muted-foreground")}>
                                            ₹{(item.totalAmount || 0).toFixed(0)}
                                        </td>
                                        <td className="p-4 text-sm text-muted-foreground">{renderTableDate(item)}</td>
                                        <td className="p-4">{getStatusBadge(item.status, item.orderType)}</td>
                                        <td className="p-4 text-center">{renderSettlementCell(item, isOnlinePrepaid)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Mobile Cards ─────────────────────────────────────────────── */}
            <div className="md:hidden flex flex-col gap-3">
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse space-y-3">
                            <div className="h-4 bg-muted w-1/3 rounded"></div>
                            <div className="h-4 bg-muted w-1/2 rounded"></div>
                            <div className="h-4 bg-muted w-1/4 rounded"></div>
                            <div className="flex justify-between items-center pt-2 border-t border-border">
                                <div className="h-8 bg-muted w-24 rounded"></div>
                                <div className="h-8 bg-muted w-20 rounded"></div>
                            </div>
                        </div>
                    ))
                ) : filteredData.length === 0 ? (
                    <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
                        No {settlementFilter !== 'all' ? settlementFilter : ''} entries found.
                    </div>
                ) : filteredData.map((item) => {
                    const itemId = item.id;
                    const pm = (item.paymentMethod || '').toLowerCase();
                    const isPostpaid = ['cod', 'pod', 'pay_on_delivery', 'cash', 'pay_at_restaurant', 'pay at restaurant', 'offline_counter'].includes(pm);
                    const isOnlinePrepaid = activeTab === 'online' && !isPostpaid && !!pm;

                    return (
                        <div key={itemId} className="bg-card border border-border rounded-xl p-4 shadow-sm active:opacity-80 transition-opacity"
                            onClick={() => setSelectedOrder(item)}>
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className={cn("font-mono text-xs font-bold", String(item.status || '').toLowerCase() === 'cancelled' ? 'line-through text-muted-foreground' : 'text-primary')}>
                                            #{item.customerOrderId || item.historyId?.substring(0,8) || itemId.substring(0, 8)}
                                        </p>
                                        {String(item.status || '').toLowerCase() === 'cancelled' && (
                                            <span className="text-[10px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-sm font-bold border border-red-500/20" title="Cancelled">✕</span>
                                        )}
                                    </div>
                                    <p className="font-semibold text-base mt-0.5">{item.customer || item.customerName || 'Guest'}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{renderTableDate(item)}</p>
                                    <div className="mt-1.5">{getStatusBadge(item.status, item.orderType)}</div>
                                </div>
                                <p className="font-bold text-lg">₹{(item.totalAmount || 0).toFixed(0)}</p>
                            </div>

                            <div className="flex justify-between items-center pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                                <span className="text-[10px] text-muted-foreground capitalize bg-muted px-2 py-1 rounded truncate max-w-[45%]">
                                    {pm.replace(/_/g, ' ') || (activeTab === 'manual-history' ? 'Counter' : 'Online')}
                                </span>
                                {renderMobileSettlementCell(item, isOnlinePrepaid)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Order Detail Modal ───────────────────────────────────────── */}
            <OrderDetailModal
                order={selectedOrder}
                activeTab={activeTab}
                onClose={() => setSelectedOrder(null)}
            />
        </div>
    );
}
