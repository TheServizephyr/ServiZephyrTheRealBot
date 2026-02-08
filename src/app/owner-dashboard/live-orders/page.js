
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, ChevronUp, ChevronDown, Check, CookingPot, Bike, PartyPopper, Undo2, Bell, PackageCheck, Printer, X, Loader2, IndianRupee, Wallet, History, ClockIcon, User, Phone, MapPin, Search, ShoppingBag, ConciergeBell, FilePlus, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { formatSafeDate, formatSafeTime, formatSafeRelativeTime, formatSafeDateShort, safeToDate } from '@/lib/safeDateFormat';
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
import PrintOrderDialog from '@/components/PrintOrderDialog';
import { useReactToPrint } from 'react-to-print';
import { usePolling } from '@/lib/usePolling';


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

// ✅ FIX: Added 'ready_for_pickup' to delivery flow (Rider Assigned stage)
const deliveryStatusFlow = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'dispatched', 'delivered'];
const pickupStatusFlow = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];


const RejectOrderModal = ({ order, isOpen, onClose, onConfirm, onMarkRestaurantClosed, onMarkItemsOutOfStock }) => {
    const [reason, setReason] = useState('');
    const [otherReason, setOtherReason] = useState('');
    const [shouldRefund, setShouldRefund] = useState('true');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [markRestaurantClosed, setMarkRestaurantClosed] = useState(false);
    const [outOfStockItemIds, setOutOfStockItemIds] = useState([]);

    // Unique order items that have menu item IDs (for out-of-stock selection)
    const orderItemsWithIds = useMemo(() => {
        const seen = new Set();
        return (order?.items || []).filter(i => {
            const id = i.id || i.itemId;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        }).map(i => ({ id: i.id || i.itemId, name: i.name || i.itemName || 'Unknown Item', quantity: i.quantity || 1 }));
    }, [order?.items]);

    // Calculate online payment amount
    const paymentDetailsArray = Array.isArray(order?.paymentDetails) ? order.paymentDetails : [order?.paymentDetails].filter(Boolean);
    const amountPaidOnlineDetails = paymentDetailsArray
        .filter(p => (p?.method === 'razorpay' || p?.method === 'phonepe' || p?.method === 'online') && p?.status === 'paid')
        .reduce((sum, p) => sum + (p?.amount || 0), 0);
    const isPaidViaRoot = order?.paymentStatus === 'paid' && (order?.paymentMethod === 'razorpay' || order?.paymentMethod === 'phonepe' || order?.paymentMethod === 'online');
    const amountPaidOnline = isPaidViaRoot ? (order?.totalAmount || 0) : amountPaidOnlineDetails;
    const hasOnlinePayment = amountPaidOnline > 0;

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setOtherReason('');
            setShouldRefund('true'); // Default to refund
            setIsSubmitting(false);
            setMarkRestaurantClosed(false);
            setOutOfStockItemIds([]);
        }
    }, [isOpen]);

    const toggleOutOfStockItem = (itemId) => {
        setOutOfStockItemIds(prev =>
            prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
        );
    };

    // Smart pre-selection based on reason
    useEffect(() => {
        if (reason === 'item_unavailable' || reason === 'restaurant_closed' || reason === 'undeliverable_address') {
            setShouldRefund('true'); // Vendor's fault = refund
        } else if (reason === 'customer_request' || reason === 'invalid_details') {
            setShouldRefund('false'); // Customer's fault = no refund
        }
    }, [reason]);

    const handleConfirm = async () => {
        const finalReason = reason === 'other' ? otherReason : reason;
        if (!finalReason) {
            setInfoDialog({ isOpen: true, title: 'Validation Error', message: 'Please select or enter a reason for rejection.' });
            return;
        }
        // For item_unavailable, require at least one item selected when items with IDs exist
        if (reason === 'item_unavailable' && orderItemsWithIds.length > 0 && outOfStockItemIds.length === 0) {
            setInfoDialog({ isOpen: true, title: 'Select Items', message: 'Please select at least one item to mark as out of stock. This will prevent future orders from including these items.' });
            return;
        }
        setIsSubmitting(true);
        try {
            // Execute actions before rejection
            if (reason === 'restaurant_closed' && markRestaurantClosed && onMarkRestaurantClosed) {
                await onMarkRestaurantClosed();
            }
            if (reason === 'item_unavailable' && outOfStockItemIds.length > 0 && onMarkItemsOutOfStock) {
                await onMarkItemsOutOfStock(outOfStockItemIds);
            }
            await onConfirm(order.id, finalReason, shouldRefund === 'true');
            onClose();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error?.message || 'Something went wrong. Please try again.' });
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

                        {/* Restaurant Closed - Mark closed to avoid future rejections */}
                        {reason === 'restaurant_closed' && onMarkRestaurantClosed && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="p-4 border border-amber-500/30 rounded-lg bg-amber-500/10 space-y-3"
                            >
                                <p className="font-semibold text-sm text-amber-400">🏪 Avoid Future Rejections</p>
                                <p className="text-sm text-muted-foreground">
                                    Mark your restaurant as closed now so new orders won&apos;t come in and you won&apos;t have to reject them.
                                </p>
                                <Label htmlFor="restaurant-closed-toggle" className="flex items-center justify-between cursor-pointer">
                                    <span className="font-medium text-sm">Mark restaurant closed now</span>
                                    <Switch
                                        id="restaurant-closed-toggle"
                                        checked={markRestaurantClosed}
                                        onCheckedChange={(checked) => setMarkRestaurantClosed(!!checked)}
                                        aria-label="Toggle restaurant closed status"
                                    />
                                </Label>
                            </motion.div>
                        )}

                        {/* Item(s) Out of Stock - Select which items to mark */}
                        {reason === 'item_unavailable' && orderItemsWithIds.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="p-4 border border-orange-500/30 rounded-lg bg-orange-500/10 space-y-3"
                            >
                                <p className="font-semibold text-sm text-orange-400">📦 Mark Items Out of Stock</p>
                                <p className="text-sm text-muted-foreground">
                                    Select which items are out of stock. They will be marked unavailable so future orders won&apos;t include them.
                                </p>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {orderItemsWithIds.map((item) => (
                                        <label key={item.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded-md hover:bg-background/50">
                                            <Checkbox
                                                checked={outOfStockItemIds.includes(item.id)}
                                                onCheckedChange={() => toggleOutOfStockItem(item.id)}
                                            />
                                            <span className="text-sm flex-1">{item.quantity}x {item.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        {/* Refund Policy Selection */}
                        {hasOnlinePayment && reason && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/10 space-y-3"
                            >
                                <p className="font-semibold text-sm text-yellow-400">⚠️ Refund Policy</p>
                                <div className="space-y-2">
                                    <label className="flex items-start space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="refund-policy"
                                            value="true"
                                            checked={shouldRefund === 'true'}
                                            onChange={(e) => setShouldRefund(e.target.value)}
                                            className="mt-1"
                                        />
                                        <div className="flex-1">
                                            <p className="font-semibold text-sm">Cancel WITH Refund</p>
                                            <p className="text-xs text-muted-foreground">
                                                Customer will receive full refund (₹{amountPaidOnline})
                                            </p>
                                        </div>
                                    </label>
                                    <label className="flex items-start space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="refund-policy"
                                            value="false"
                                            checked={shouldRefund === 'false'}
                                            onChange={(e) => setShouldRefund(e.target.value)}
                                            className="mt-1"
                                        />
                                        <div className="flex-1">
                                            <p className="font-semibold text-sm">Cancel WITHOUT Refund</p>
                                            <p className="text-xs text-muted-foreground">
                                                No refund - customer fault/duplicate order
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            </motion.div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                        <Button
                            variant="destructive"
                            onClick={handleConfirm}
                            disabled={
                                isSubmitting ||
                                !reason ||
                                (reason === 'other' && !otherReason.trim()) ||
                                (reason === 'item_unavailable' && orderItemsWithIds.length > 0 && outOfStockItemIds.length === 0) ||
                                (reason === 'restaurant_closed' && !markRestaurantClosed) // Require toggle to be ON
                            }
                        >
                            {isSubmitting ? "Rejecting..." : "Confirm Rejection"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};


const AssignRiderModal = ({ isOpen, onClose, onAssign, initialSelectedOrders, riders, allOrders }) => {
    const [selectedRiderId, setSelectedRiderId] = useState(null);
    const [selectedOrderIds, setSelectedOrderIds] = useState([]);
    const [markAsActive, setMarkAsActive] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filter relevant orders: status 'preparing' and deliveryType 'delivery'
    // Also include currently selected orders even if status changed (edge case)
    const assignableOrders = useMemo(() => {
        return allOrders.filter(o =>
            (o.status === 'preparing' || o.status === 'ready_for_pickup' || initialSelectedOrders.some(iso => iso.id === o.id)) &&
            o.deliveryType === 'delivery'
        );
    }, [allOrders, initialSelectedOrders]);

    const selectedRider = useMemo(() => riders.find(r => r.id === selectedRiderId), [selectedRiderId, riders]);
    const isSelectedRiderInactive = selectedRider?.status === 'Inactive';
    const isSelectedRiderBusy = selectedRider?.status === 'On Delivery' || selectedRider?.status === 'on-delivery';

    useEffect(() => {
        if (isOpen) {
            setSelectedRiderId(null);
            setMarkAsActive(false);
            setIsSubmitting(false);
            // Pre-select the orders passed initially
            setSelectedOrderIds(initialSelectedOrders.map(o => o.id));
        }
    }, [isOpen, initialSelectedOrders]);

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
            <DialogContent className="bg-background border-border text-foreground max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Assign Rider</DialogTitle>
                    <DialogDescription>Batch orders and assign a rider.</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4 flex-1 overflow-y-auto min-h-0">
                    <div>
                        <Label>Select Orders to Assign ({selectedOrderIds.length} selected):</Label>
                        <div className="mt-2 space-y-2 p-2 bg-muted/50 rounded-lg max-h-48 overflow-y-auto">
                            {assignableOrders.length > 0 ? assignableOrders.map(order => (
                                <div key={order.id} className="flex items-center gap-3 p-2 bg-background rounded-md border border-border/50">
                                    <Checkbox
                                        id={`order-${order.id}`}
                                        checked={selectedOrderIds.includes(order.id)}
                                        onCheckedChange={() => handleOrderSelection(order.id)}
                                    />
                                    <Label htmlFor={`order-${order.id}`} className="cursor-pointer w-full flex flex-col">
                                        <div className="flex justify-between items-center w-full">
                                            <span className="font-bold">#{order.customerOrderId || order.id.substring(0, 5)}</span>
                                            <span className="text-xs font-mono bg-muted px-1 rounded">₹{Math.round(order.totalAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>{order.customer}</span>
                                            <span>{order.customerAddress ? order.customerAddress.substring(0, 15) + '...' : 'No Address'}</span>
                                        </div>
                                    </Label>
                                </div>
                            )) : (
                                <p className="text-sm text-center text-muted-foreground p-4">No eligible orders found.</p>
                            )}
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
                                    <div className="flex items-center gap-2">
                                        {rider.status === 'Inactive' && <span className="text-xs font-semibold px-2 py-1 bg-red-500/10 text-red-500 rounded-full">Inactive</span>}
                                        {rider.status === 'On Delivery' && <span className="text-xs font-semibold px-2 py-1 bg-blue-500/10 text-blue-500 rounded-full">Busy</span>}
                                    </div>
                                </div>
                            )) : (
                                <p className="text-center text-muted-foreground py-4">No riders found. Please add riders.</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {isSelectedRiderInactive && (
                        <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-lg flex items-center justify-between">
                            <Label htmlFor="mark-active" className="text-sm font-semibold text-destructive">Rider Inactive. Mark Active?</Label>
                            <Switch id="mark-active" checked={markAsActive} onCheckedChange={setMarkAsActive} />
                        </div>
                    )}
                    {isSelectedRiderBusy && (
                        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-lg text-sm text-yellow-600">
                            ⚠️ Rider is currently busy on another delivery.
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4">
                    <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                    <Button
                        onClick={handleAssign}
                        disabled={!selectedRiderId || selectedOrderIds.length === 0 || (isSelectedRiderInactive && !markAsActive) || isSelectedRiderBusy || isSubmitting}
                        className="bg-primary hover:bg-primary/90"
                    >
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bike size={16} className="mr-2" />}
                        {isSubmitting ? 'Assigning...' : 'Assign & Dispatch'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ActionButton = ({ status, onNext, onRevert, order, onRejectClick, isUpdating, onPrintClick, onAssignClick, employeeOfOwnerId, impersonatedOwnerId, userRole }) => {
    const isPickup = order.deliveryType === 'pickup';
    const isDineIn = order.deliveryType === 'dine-in';
    const statusFlow = isPickup ? pickupStatusFlow : deliveryStatusFlow;

    const currentIndex = statusFlow.indexOf(status);

    const isFinalStatus = status === 'delivered' || status === 'rejected' || status === 'picked_up';

    if (isUpdating) {
        return (
            <div className="flex items-center justify-center gap-2 h-9 text-muted-foreground text-sm w-full">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
            </div>
        );
    }

    if (isDineIn) {
        const currentIndex = ['pending', 'confirmed', 'preparing', 'ready'].indexOf(status);
        const prevStatus = currentIndex > 0 ? ['pending', 'confirmed', 'preparing', 'ready'][currentIndex - 1] : null;

        const dineInUrl = employeeOfOwnerId
            ? `/owner-dashboard/dine-in?employee_of=${employeeOfOwnerId}`
            : impersonatedOwnerId
                ? `/owner-dashboard/dine-in?impersonate_owner_id=${impersonatedOwnerId}`
                : '/owner-dashboard/dine-in';

        return (
            <div className="flex items-center gap-2">
                <Link href={dineInUrl}>
                    <Button size="sm" className="bg-primary hover:bg-primary/90 h-9">
                        <ConciergeBell size={16} className="mr-2" /> View on Dine-In Board
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
                        <Undo2 size={16} />
                    </Button>
                )}
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
    if (currentIndex > 0) {
        prevStatus = statusFlow[currentIndex - 1];
    }


    const actionConfig = {
        'pending': { text: 'Confirm Order', icon: Check, action: () => onNext(nextStatus), permission: PERMISSIONS.UPDATE_ORDER_STATUS },
        'confirmed': { text: 'Start Preparing', icon: CookingPot, action: () => onNext(nextStatus), permission: PERMISSIONS.MARK_ORDER_PREPARING },
        'preparing': isPickup
            ? { text: 'Ready for Pickup', icon: PackageCheck, action: () => onNext(nextStatus), permission: PERMISSIONS.MARK_ORDER_READY }
            : { text: 'Assign Rider', icon: Bike, action: () => onAssignClick([order]), permission: PERMISSIONS.ASSIGN_RIDER }, // ✅ Changed text
        'ready_for_pickup': {
            text: isPickup ? 'Mark as Picked Up' : 'Mark Out for Delivery', // ✅ Dynamic text
            icon: isPickup ? PartyPopper : Bike,
            action: () => onNext(nextStatus),
            permission: PERMISSIONS.MARK_ORDER_SERVED
        },
        'dispatched': { text: 'Mark Delivered', icon: PartyPopper, action: () => onNext(nextStatus), permission: PERMISSIONS.MARK_ORDER_SERVED },
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
            {hasPermission(userRole, action.permission || PERMISSIONS.UPDATE_ORDER_STATUS) && (
                <Button
                    onClick={action.action}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 h-9 flex-grow"
                >
                    <ActionIcon size={16} className="mr-2" />
                    {action.text}
                </Button>
            )}
            <div className="flex gap-2">
                {isConfirmable && hasPermission(userRole, PERMISSIONS.CANCEL_ORDER) && (
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
                {prevStatus && hasPermission(userRole, PERMISSIONS.UPDATE_ORDER_STATUS) && (
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
                    <DialogTitle>Order Details #{order.id?.substring(0, 8) || 'Unknown'}</DialogTitle>
                    <DialogDescription>
                        Full details for the order placed on {format(new Date(order.orderDate?.seconds ? order.orderDate.seconds * 1000 : order.orderDate), 'PPpp')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-6 py-4 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-4">
                        <h4 className="font-semibold flex items-center gap-2"><User size={16} /> Customer Details</h4>
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
                        <h4 className="font-semibold flex items-center gap-2"><IndianRupee size={16} /> Payment Details</h4>
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
                        <h4 className="font-semibold flex items-center gap-2 mb-2"><ShoppingBag size={16} /> Items Ordered</h4>
                        <div className="p-4 bg-muted rounded-lg space-y-2">
                            {order.items.map((item, index) => (
                                <div key={index} className="flex justify-between items-center border-b border-border/50 pb-1">
                                    <div className="flex items-center gap-2">
                                        <span>{item.quantity} x {item.name}</span>
                                        {item.addedAt && (() => {
                                            try {
                                                const date = item.addedAt?.seconds
                                                    ? new Date(item.addedAt.seconds * 1000)
                                                    : new Date(item.addedAt);
                                                // Only render if valid date
                                                if (isNaN(date.getTime())) return null;
                                                return (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-semibold">
                                                        🆕 Added {format(date, 'hh:mm a')}
                                                    </span>
                                                );
                                            } catch (e) {
                                                return null; // Fail silently
                                            }
                                        })()}
                                    </div>
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

const OrderCard = ({ order, onDetailClick, actionButtonProps, onSelect, isSelected }) => {
    const isPaidOnline = (order.paymentMethod === 'razorpay' || order.paymentMethod === 'phonepe' || order.paymentMethod === 'online') && order.paymentStatus === 'paid';
    const isCOD = !isPaidOnline;

    // Show checkbox only for 'preparing' delivery orders
    const showCheckbox = order.status === 'preparing' && order.deliveryType === 'delivery';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
                "bg-card border-2 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:shadow-2xl transition-all duration-300 relative overflow-hidden hover:-translate-y-1",
                isSelected ? "border-primary ring-2 ring-primary shadow-primary/20" : "border-border/60"
            )}
        >
            {/* Batch Selection Checkbox */}
            {showCheckbox && (
                <div className="absolute top-4 right-4 z-10">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelect(order.id)}
                        className="w-5 h-5 border-2 border-foreground/50 data-[state=checked]:border-primary bg-background"
                    />
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-start pr-8">
                <div>
                    <div className="font-extrabold text-lg tracking-tight">#{order.customerOrderId || order.id.substring(0, 8)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                        {formatSafeRelativeTime(order.orderDate)}
                    </div>
                </div>
                <div className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase border tracking-wide",
                    order.deliveryType === 'delivery' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                        order.deliveryType === 'pickup' ? "bg-purple-500/10 text-purple-500 border-purple-500/20" :
                            "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
                )}>
                    {order.deliveryType === 'delivery' ? 'Delivery' : order.deliveryType === 'pickup' ? 'Pickup' : 'Dine-In'}
                </div>
            </div>

            {/* Payment Status Badges */}
            <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border w-fit",
                isPaidOnline ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-orange-500/10 text-orange-500 border-orange-500/20"
            )}>
                {isPaidOnline ? (
                    <><Check size={12} className="stroke-[3]" /> PAID ONLINE</>
                ) : (
                    <><Wallet size={12} className="stroke-[3]" /> PAY ON DELIVERY (COD)</>
                )}
            </div>

            {/* Info Sections */}
            <div className="bg-muted/30 p-3 rounded-xl border border-border/50 space-y-2.5">
                <div className="flex gap-2.5 items-start">
                    <User size={14} className="text-primary mt-0.5 shrink-0" />
                    <div>
                        <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Customer</span>
                        <div
                            className="text-sm font-medium leading-tight hover:text-primary cursor-pointer hover:underline decoration-dashed underline-offset-2"
                            onClick={() => onDetailClick(order.id, order.customerId)}
                        >
                            {order.customerName || order.customer || 'Guest'} <span className="text-muted-foreground">• {order.customerPhone}</span>
                        </div>
                    </div>
                </div>
                {order.customerAddress && (
                    <div className="flex gap-2.5 items-start">
                        <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
                        <div>
                            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Delivery Address</span>
                            <div className="text-sm font-medium leading-tight line-clamp-2" title={order.customerAddress}>
                                {order.customerAddress}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Special Note */}
            {order.notes && (
                <div className="bg-yellow-500/5 border-l-4 border-yellow-500 p-3 text-xs italic text-yellow-600/90 font-medium rounded-r-lg">
                    "{order.notes}"
                </div>
            )}

            {/* Items List (Preview) */}
            <div className="space-y-1.5 py-1">
                {(order.items || []).slice(0, 3).map((item, idx) => {
                    // Safe Price parsing
                    const price = parseFloat(item.price) || 0;
                    const qty = parseInt(item.quantity) || 1;
                    const lineTotal = price * qty;

                    return (
                        <div key={idx} className="flex justify-between items-start text-sm">
                            <span className="text-foreground/90 leading-tight">
                                <span className="font-extrabold text-primary mr-2">{qty}x</span>
                                {item.name}
                            </span>
                            <span className="font-semibold text-muted-foreground">₹{lineTotal}</span>
                        </div>
                    )
                })}
                {(order.items || []).length > 3 && (
                    <div className="text-xs text-primary font-bold pt-1 cursor-pointer hover:underline" onClick={() => onDetailClick(order.id, order.customerId)}>
                        +{(order.items || []).length - 3} more items...
                    </div>
                )}
            </div>

            {/* Bill Summary */}
            <div className="border-t border-border pt-4 mt-auto flex justify-between items-end">
                <div>
                    <span className={cn(
                        "block text-[10px] font-bold uppercase tracking-wider mb-0.5",
                        isCOD ? "text-orange-500" : "text-muted-foreground"
                    )}>
                        {isCOD ? "Collect Cash" : "Total Amount"}
                    </span>
                    <span className="text-2xl font-black tracking-tight">₹{Math.round(order.totalAmount || 0)}</span>
                </div>
                <div className={cn(
                    "text-[10px] font-extrabold uppercase px-2 py-1 rounded bg-secondary text-secondary-foreground",
                    statusConfig[order.status]?.color?.split(' ')[1] // Extract text color class if possible, or fallback
                )}>
                    {order.status.replace('_', ' ')}
                </div>
            </div>

            {/* Actions */}
            <div className="pt-2">
                <ActionButton
                    {...actionButtonProps}
                    order={order}
                    status={order.status}
                    className="w-full" // Pass class for full width
                />
            </div>
        </motion.div>
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
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [userRole, setUserRole] = useState(null);
    const [viewMode, setViewMode] = useState('grid'); // 'list' or 'grid'

    // Detect mobile and force grid view
    useEffect(() => {
        const checkMobile = () => {
            if (window.innerWidth < 768) {
                setViewMode('grid');
            }
        };
        checkMobile(); // Check on mount
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Print Modal State
    const [printModalData, setPrintModalData] = useState({ isOpen: false, order: null });
    const [restaurantData, setRestaurantData] = useState(null);

    // Fetch User Role
    useEffect(() => {
        const fetchRole = async () => {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    setUserRole(userDoc.data().role || 'owner'); // Default to owner if role missing (owner docs sometimes lack role field)
                }
            } catch (err) {
                console.error("Error fetching user role:", err);
            }
        };
        fetchRole();
    }, []);

    const handlePrintClick = (order) => {
        setPrintModalData({ isOpen: true, order });
    };


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
            } else if (employeeOfOwnerId) {
                ordersUrl.searchParams.append('employee_of', employeeOfOwnerId);
                ridersUrl.searchParams.append('employee_of', employeeOfOwnerId);
                settingsUrl.searchParams.append('employee_of', employeeOfOwnerId);
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
            if (!isManualRefresh) setLoading(false);
        }
    };


    // Use adaptive polling for impersonation/employee access
    usePolling(() => fetchInitialData(true), {
        interval: 60000,
        enabled: !!(impersonatedOwnerId || employeeOfOwnerId),
        deps: [impersonatedOwnerId, employeeOfOwnerId]
    });

    // Real-time listener for orders (replaces 30-second polling)
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        // ✅ For owner's own dashboard - use REAL-TIME Firestore listener
        setLoading(true);

        // Fetch restaurant ID from user's document
        const ownerId = user.uid;

        // Fetch static data (riders & settings) via API once
        const fetchStaticData = async () => {
            try {
                const idToken = await user.getIdToken();
                const [ridersRes, settingsRes] = await Promise.all([
                    fetch('/api/owner/delivery', { headers: { 'Authorization': `Bearer ${idToken}` } }),
                    fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } })
                ]);

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
                console.error('[LiveOrders] Error fetching static data:', error);
            }
        };

        fetchStaticData();

        // ✅ CRITICAL FIX: Get restaurantId first (orders use restaurantId, not ownerId!)
        const setupListener = async () => {
            try {
                // Fetch owner's restaurant document to get restaurantId
                const restaurantsQuery = query(
                    collection(db, 'restaurants'),
                    where('ownerId', '==', ownerId),
                    limit(1)
                );

                const restaurantSnapshot = await getDocs(restaurantsQuery);

                if (restaurantSnapshot.empty) {
                    console.error('[LiveOrders] No restaurant found for owner:', ownerId);
                    setLoading(false);
                    return;
                }

                const restaurantId = restaurantSnapshot.docs[0].id;
                console.log('[LiveOrders] Found restaurantId:', restaurantId);

                // Real-time listener for ACTIVE orders only (Bandwidth Optimization)
                // Filter: Only active statuses.
                const activeStatuses = ['pending', 'placed', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived'];

                console.log('[LiveOrders] Setting up optimized query for active orders...');
                const ordersQuery = query(
                    collection(db, 'orders'),
                    where('restaurantId', '==', restaurantId),
                    where('status', 'in', activeStatuses),
                    // orderBy('orderDate', 'desc'), // REMOVED to avoid composite index issues with 'in' query. We sort client-side.
                    limit(100)
                );

                const unsubscribe = onSnapshot(
                    ordersQuery,
                    (querySnapshot) => {
                        const fetchedOrders = [];
                        querySnapshot.forEach((doc) => {
                            const orderData = doc.data();
                            fetchedOrders.push({ id: doc.id, ...orderData });
                        });

                        // CLIENT-SIDE SORT (Newest First)
                        fetchedOrders.sort((a, b) => {
                            const dateA = a.orderDate?.seconds || 0;
                            const dateB = b.orderDate?.seconds || 0;
                            return dateB - dateA;
                        });

                        setOrders(fetchedOrders);
                        setLoading(false);
                    },
                    (error) => {
                        console.error('[LiveOrders] Firestore listener error:', error);
                        setInfoDialog({
                            isOpen: true,
                            title: 'Connection Error',
                            message: 'Could not connect to live orders. Please refresh the page.'
                        });
                        setLoading(false);
                    }
                );

                // Return cleanup function
                return unsubscribe;
            } catch (error) {
                console.error('[LiveOrders] Error setting up listener:', error);
                setLoading(false);
                return () => { }; // No-op cleanup
            }
        };

        // Call setup function and store cleanup
        let cleanupFn = () => { };
        setupListener().then(unsubscribe => {
            if (unsubscribe) cleanupFn = unsubscribe;
        });

        // Cleanup function when component unmounts
        return () => {
            console.log('[LiveOrders] Cleaning up real-time listener');
            cleanupFn();
        };
    }, [impersonatedOwnerId, employeeOfOwnerId]);


    const handleAPICall = async (method, body, endpoint = '/api/owner/orders') => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
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

        // OPTIMISTIC UPDATE - Update UI instantly for better UX!
        const previousOrders = orders;
        setOrders(prevOrders =>
            prevOrders.map(order =>
                order.id === orderId
                    ? { ...order, status: newStatus }
                    : order
            )
        );

        try {
            await handleAPICall('PATCH', { orderId, newStatus });
            // No need to refresh - Firestore listener will update automatically!
            // Or if not using listener (impersonation), manual refresh happens
            if (impersonatedOwnerId || employeeOfOwnerId) {
                await fetchInitialData(true);
            }
        } catch (error) {
            // REVERT optimistic update on error
            setOrders(previousOrders);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Error updating status: ${error.message}` });
        } finally {
            setUpdatingOrderId(null);
        }
    };

    const handleAssignRider = async (orderIds, riderId, activateRider) => {
        setUpdatingOrderId(orderIds[0]);

        // OPTIMISTIC UPDATE - Update UI instantly
        const previousOrders = orders;
        setOrders(prevOrders =>
            prevOrders.map(order =>
                orderIds.includes(order.id)
                    ? { ...order, status: 'ready_for_pickup', deliveryBoyId: riderId } // ✅ Optimistic to ready_for_pickup
                    : order
            )
        );

        try {
            if (activateRider) {
                await handleAPICall('PATCH', { boy: { id: riderId, status: 'Available' } }, '/api/owner/delivery');
            }

            await handleAPICall('PATCH', { orderIds, newStatus: 'ready_for_pickup', deliveryBoyId: riderId }); // ✅ Status -> ready_for_pickup (Notification suppressed)
            // Firestore listener will confirm the update
            if (impersonatedOwnerId || employeeOfOwnerId) {
                await fetchInitialData(true);
            }
            setAssignModalData({ isOpen: false, orders: [] });
        } catch (error) {
            // REVERT on error
            setOrders(previousOrders);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Error assigning rider: ${error.message}` });
            setAssignModalData({ isOpen: false, orders: [] });
            throw error;
        } finally {
            setUpdatingOrderId(null);
            setSelectedOrders([]);
        }
    };


    const handleMarkRestaurantClosed = async () => {
        await handleAPICall('PATCH', { isOpen: false }, '/api/owner/settings');
    };

    const handleMarkItemsOutOfStock = async (itemIds) => {
        if (!itemIds?.length) return;
        await handleAPICall('PATCH', { itemIds, action: 'outOfStock' }, '/api/owner/menu');
    };

    const handleRejectOrder = async (orderId, reason, shouldRefund = true) => {
        setUpdatingOrderId(orderId);

        // OPTIMISTIC UPDATE - Update UI instantly
        const previousOrders = orders;
        setOrders(prevOrders =>
            prevOrders.map(order =>
                order.id === orderId
                    ? { ...order, status: 'rejected', rejectionReason: reason }
                    : order
            )
        );

        try {
            await handleAPICall('PATCH', { orderId, newStatus: 'rejected', rejectionReason: reason, shouldRefund });
            // Firestore listener will confirm
            if (impersonatedOwnerId || employeeOfOwnerId) {
                await fetchInitialData(true);
            }
        } catch (error) {
            // REVERT on error
            setOrders(previousOrders);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Error rejecting order: ${error.message}` });
            throw error;
        } finally {
            setUpdatingOrderId(null);
        }
    };

    const handleDetailClick = async (orderId, customerId) => {
        try {
            const data = await handleAPICall('GET', { id: orderId, customerId });
            setDetailModalData({ isOpen: true, data });
        } catch (e) {
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
        setAssignModalData({ isOpen: true, orders: ordersToAssign });
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
                const matchesCustomerOrderId = (order.customerOrderId || '').toString().toLowerCase().includes(lowercasedQuery);
                const matchesCustomerName = (order.customer || '').toLowerCase().includes(lowercasedQuery);
                const matchesCustomerPhone = (order.customerPhone || '').includes(searchQuery);
                const matchesCustomerAddress = (order.customerAddress || '').toLowerCase().includes(lowercasedQuery);
                const matchesItems = (order.items || []).some(item => item.name.toLowerCase().includes(lowercasedQuery));

                return matchesId || matchesCustomerOrderId || matchesCustomerName || matchesCustomerPhone || matchesCustomerAddress || matchesItems;
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

            {printModalData.isOpen && (
                <PrintOrderDialog
                    isOpen={printModalData.isOpen}
                    onClose={() => setPrintModalData({ isOpen: false, order: null })}
                    order={printModalData.order}
                    restaurant={restaurantData}
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
                    onClose={() => setAssignModalData({ isOpen: false, orders: [] })}
                    onAssign={handleAssignRider}
                    initialSelectedOrders={assignModalData.orders}
                    riders={riders}
                    allOrders={orders}
                />
            )}

            {rejectionModalData.isOpen && (
                <RejectOrderModal
                    isOpen={rejectionModalData.isOpen}
                    onClose={() => setRejectionModalData({ isOpen: false, order: null })}
                    onConfirm={handleRejectOrder}
                    order={rejectionModalData.order}
                    onMarkRestaurantClosed={handleMarkRestaurantClosed}
                    onMarkItemsOutOfStock={handleMarkItemsOutOfStock}
                />
            )}

            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Live Order Management</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A real-time, intelligent view of your kitchen&apos;s pulse.</p>
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
                    <Link href="/owner-dashboard/order-history" passHref>
                        <Button variant="outline" className="flex-shrink-0">
                            <History size={16} />
                            <span className="ml-2 hidden sm:inline">History</span>
                        </Button>
                    </Link>
                    <Button onClick={() => fetchInitialData(true)} variant="outline" className="flex-shrink-0">
                        <RefreshCw size={16} className={cn(loading && "animate-spin")} />
                        <span className="ml-2 hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
                    </Button>

                    {/* View Toggle (Hidden on mobile as it's card-only) */}
                    <div className="hidden md:flex items-center bg-muted rounded-md border border-border p-1 gap-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                "p-1.5 rounded-sm transition-all",
                                viewMode === 'grid' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Grid View"
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "p-1.5 rounded-sm transition-all",
                                viewMode === 'list' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                            title="List View"
                        >
                            <List size={16} />
                        </button>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="All" value={activeFilter} onValueChange={setActiveFilter} className="w-full mb-6">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 md:grid-cols-5 h-auto p-1 bg-muted">
                    <TabsTrigger value="All">All</TabsTrigger>
                    <TabsTrigger value="New">New</TabsTrigger>
                    <TabsTrigger value="Confirmed">Confirmed</TabsTrigger>
                    <TabsTrigger value="Preparing">Preparing</TabsTrigger>
                    <TabsTrigger value="Dispatched">Dispatched</TabsTrigger>
                </TabsList>
            </Tabs>

            {selectedOrders.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-center justify-between mb-4"
                >
                    <p className="font-semibold text-primary">{selectedOrders.length} order(s) selected for batching.</p>
                    <p className="font-semibold text-primary">{selectedOrders.length} order(s) selected for batching.</p>
                    <Button size="sm" onClick={handleAssignSelected}>
                        <Bike size={16} className="mr-2" /> Assign Selected
                    </Button>
                </motion.div>
            )}

            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                    <AnimatePresence>
                        {loading && filteredAndSortedOrders.length === 0 ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="bg-card border rounded-xl h-[400px] animate-pulse" />
                            ))
                        ) : filteredAndSortedOrders.length === 0 ? (
                            <div className="col-span-full text-center p-16 text-muted-foreground bg-card border border-border rounded-xl border-dashed">
                                <p className="text-lg font-semibold">No orders found.</p>
                                <p>Try adjusting your filters or search term.</p>
                            </div>
                        ) : (
                            filteredAndSortedOrders.map(order => (
                                <OrderCard
                                    key={order.id}
                                    order={order}
                                    isSelected={selectedOrders.includes(order.id)}
                                    onSelect={handleSelectOrder}
                                    onDetailClick={handleDetailClick}
                                    actionButtonProps={{
                                        isUpdating: updatingOrderId === order.id,
                                        onNext: (newStatus) => handleUpdateStatus(order.id, newStatus),
                                        onRevert: (newStatus) => handleUpdateStatus(order.id, newStatus),
                                        onRejectClick: (order) => setRejectionModalData({ isOpen: true, order: order }),
                                        onPrintClick: () => setPrintModalData({ isOpen: true, order: order }),
                                        onAssignClick: (orders) => setAssignModalData({ isOpen: true, orders }),
                                        employeeOfOwnerId,
                                        impersonatedOwnerId,
                                        userRole
                                    }}
                                />
                            ))
                        )}
                    </AnimatePresence>
                </div>
            ) : (
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
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="p-4 w-12"></td>
                                                <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                                <td className="p-4 hidden md:table-cell"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                                <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                                <td className="p-4"><div className="h-5 bg-muted rounded w-1/3"></div></td>
                                                <td className="p-4"><div className="h-8 bg-muted rounded w-full"></div></td>
                                            </tr>
                                        ))
                                    ) : (filteredAndSortedOrders.map(order => (
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
                                                {order.status === 'preparing' && order.deliveryType !== 'pickup' && order.deliveryType !== 'dine-in' && (
                                                    <Checkbox
                                                        checked={selectedOrders.includes(order.id)}
                                                        onCheckedChange={() => handleSelectOrder(order.id)}
                                                        aria-label={`Select order ${order.id}`}
                                                    />
                                                )}
                                            </td>
                                            <td className="p-4 align-top">
                                                <div className="font-bold text-foreground text-sm truncate max-w-[100px] sm:max-w-none">{order.customerOrderId || order.id}</div>
                                                <div
                                                    onClick={() => handleDetailClick(order.id, order.customerId)}
                                                    className="text-sm text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                                                    title="View Customer & Order Details"
                                                >
                                                    {order.customer}
                                                </div>
                                                <div className="mt-1 flex items-center gap-2">
                                                    {order.deliveryType === 'delivery' && (
                                                        <div title="Delivery Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 w-fit"><Bike size={12} /> Delivery</div>
                                                    )}
                                                    {order.deliveryType === 'pickup' && (
                                                        <div title="Pickup Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 w-fit"><ShoppingBag size={12} /> Pickup</div>
                                                    )}
                                                    {order.diningPreference === 'takeaway' && order.deliveryType !== 'delivery' && order.deliveryType !== 'pickup' && (
                                                        <div title="Takeaway Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 w-fit"><PackageCheck size={12} /> Takeaway</div>
                                                    )}
                                                    {/* ✅ FIX: Only show Dine-In tag if deliveryType is explicitly dine-in */}
                                                    {(order.deliveryType === 'dine-in' || (order.diningPreference === 'dine-in' && order.deliveryType !== 'delivery' && order.deliveryType !== 'pickup')) && (
                                                        <div title="Dine-In Order" className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 w-fit"><ConciergeBell size={12} /> Dine-In</div>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="p-4 align-top hidden md:table-cell">
                                                {(order.items || []).slice(0, 2).map((item, index) => (
                                                    <div key={index} className="text-xs text-muted-foreground flex items-center gap-2">
                                                        <span>{item.quantity}x {item.name}</span>
                                                        {item.addedAt && (() => {
                                                            const addedDate = safeToDate(item.addedAt?.seconds ? new Date(item.addedAt.seconds * 1000) : item.addedAt);
                                                            return addedDate ? (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-[10px] font-semibold">
                                                                    🆕 Added {format(addedDate, 'hh:mm a')}
                                                                </span>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                ))}
                                                {(order.items || []).length > 2 && <div className="text-xs text-primary font-semibold mt-1">...and {(order.items || []).length - 2} more</div>}
                                            </td>
                                            <td className="p-4 text-sm text-muted-foreground align-top">
                                                {formatSafeDate(order.orderDate?.seconds ? new Date(order.orderDate.seconds * 1000) : order.orderDate, 'Invalid Date')}
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
                                                    onPrintClick={() => setPrintModalData({ isOpen: true, order: order })}
                                                    onAssignClick={(orders) => setAssignModalData({ isOpen: true, orders })}
                                                    employeeOfOwnerId={employeeOfOwnerId}
                                                    impersonatedOwnerId={impersonatedOwnerId}
                                                    userRole={userRole}
                                                />
                                            </td>
                                        </motion.tr>
                                    )))}
                                </AnimatePresence>
                                {!loading && filteredAndSortedOrders.length === 0 && (
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
            )}
        </div>
    );
}
