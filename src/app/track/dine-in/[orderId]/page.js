
'use client';

import React, { useState, useEffect, Suspense, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CookingPot, Home, RefreshCw, ArrowLeft, XCircle, Wallet, Split, ShoppingBag, PlusCircle, IndianRupee, Sparkles, CheckCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order and will start preparing it soon." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "The kitchen is currently preparing your delicious food." },
    ready_for_pickup: { title: 'Ready', icon: <ShoppingBag size={24} />, step: 3, description: "Your order is ready to be served." },
    delivered: { title: 'Served', icon: <Home size={24} />, step: 4, description: "Enjoy your meal!" },
    rejected: { title: 'Order Rejected', icon: <XCircle size={24} />, step: 4, isError: true, description: "We're sorry, the restaurant could not accept your order." },
};


const StatusTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid') ? 'pending' : currentStatus;
    const currentStepConfig = statusConfig[activeStatus] || { step: 0, isError: false };
    const currentStep = currentStepConfig.step;
    const isError = currentStepConfig.isError;

    const uniqueSteps = Object.values(statusConfig)
        .filter((value, index, self) =>
            !value.isError && self.findIndex(v => v.step === value.step && !v.title.includes("Delivery")) === index
        );

    return (
        <div className="flex justify-between items-start w-full px-2 sm:px-4 pt-4">
            {uniqueSteps.map(({ title, icon, step }) => {
                const isCompleted = step <= currentStep;
                const isCurrent = step === currentStep;
                return (
                    <React.Fragment key={step}>
                        <div className="flex flex-col items-center text-center w-20">
                            <motion.div
                                className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${isError ? 'bg-destructive border-destructive text-destructive-foreground' :
                                    isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                                    }`}
                                animate={{ scale: isCurrent ? 1.1 : 1 }}
                                transition={{ type: 'spring' }}
                            >
                                {icon}
                            </motion.div>
                            <p className={`mt-2 text-xs font-semibold ${isError ? 'text-destructive' :
                                isCompleted ? 'text-foreground' : 'text-muted-foreground'
                                }`}>
                                {isError ? statusConfig[currentStatus].title : title}
                            </p>
                        </div>
                        {step < uniqueSteps.length - 1 && (
                            <div className="flex-1 h-1 mt-6 mx-1 sm:mx-2 rounded-full bg-border">
                                <motion.div
                                    className={`h-full rounded-full ${isError ? 'bg-destructive' : 'bg-primary'}`}
                                    initial={{ width: '0%' }}
                                    animate={{ width: isCompleted ? '100%' : '0%' }}
                                    transition={{ duration: 0.5, delay: 0.2 }}
                                />
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};


function DineInTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const sessionToken = searchParams.get('token');

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [isMarkingDone, setIsMarkingDone] = useState(false);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!orderId) {
            setError("Order ID is missing.");
            setLoading(false);
            return;
        }

        try {
            const res = await fetch(`/api/order/status/${orderId}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to fetch order status.');
            }
            const data = await res.json();
            setOrderData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(true), 20000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Calculate bill details - AGGREGATE ALL ORDERS IN SAME TAB
    const billDetails = useMemo(() => {
        if (!orderData?.order) return null;
        const order = orderData.order;

        // For dine-in, we need to fetch ALL orders with same dineInTabId
        // But for now, show current order's items
        // TODO: Fetch all orders with same dineInTabId from API

        return {
            items: order.items || [],
            subtotal: order.subtotal || order.totalAmount || 0,
            cgst: order.cgst || 0,
            sgst: order.sgst || 0,
            discount: order.coupon?.discount || 0,
            grandTotal: order.totalAmount || 0,
        };
    }, [orderData]);

    const handleAddMoreItems = () => {
        const params = new URLSearchParams();
        if (orderData.restaurant?.id) params.set('table', orderData.order.tableId);
        if (orderData.order?.dineInTabId) params.set('tabId', orderData.order.dineInTabId);
        router.push(`/order/${orderData.restaurant?.id}?${params.toString()}`);
    };

    const handlePayAtCounter = async () => {
        // Customer chose Pay at Counter - update payment status
        setIsMarkingDone(true);
        try {
            const res = await fetch(`/api/order/update`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: orderId,
                    dineInTabId: orderData.order?.dineInTabId,
                    paymentStatus: 'pay_at_counter',
                    paymentMethod: 'counter'
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to update payment status');
            }

            setIsPayModalOpen(false);

            // Refresh data to show updated status
            fetchData(true);
        } catch (err) {
            console.error('Error updating payment status:', err);
            alert('Failed to update payment status. Please try again.');
        } finally {
            setIsMarkingDone(false);
        }
    };

    const handlePayOnline = () => {
        const params = new URLSearchParams();
        if (orderData.restaurant?.id) params.set('restaurantId', orderData.restaurant.id);
        if (orderData.order?.tableId) params.set('table', orderData.order.tableId);
        if (orderData.order?.dineInTabId) params.set('tabId', orderData.order.dineInTabId);
        if (sessionToken) params.set('session_token', sessionToken);
        router.push(`/checkout?${params.toString()}`);
    };

    const handleSplitBill = () => {
        const params = new URLSearchParams();
        if (orderData.restaurant?.id) params.set('restaurantId', orderData.restaurant.id);
        if (orderData.order?.tableId) params.set('table', orderData.order.tableId);
        if (orderData.order?.dineInTabId) params.set('tabId', orderData.order.dineInTabId);
        if (sessionToken) params.set('session_token', sessionToken);
        params.set('split', 'true');
        router.push(`/checkout?${params.toString()}`);
    };

    const handleMarkDone = async () => {
        // Customer marking they're done - table goes to needs_cleaning
        setIsMarkingDone(true);
        try {
            // Call API to mark table as needing cleaning
            const res = await fetch('/api/owner/tables', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    restaurantId: orderData.restaurant?.id,
                    tableId: orderData.order?.tableId,
                    action: 'customer_done'
                })
            });
            if (res.ok) {
                alert('Thank you! The staff has been notified to clean your table.');
            }
        } catch (err) {
            console.error('Error marking done:', err);
        } finally {
            setIsMarkingDone(false);
        }
    };


    if (loading && !orderData) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <GoldenCoinSpinner />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{error}</p>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    if (!orderData || !orderData.order) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    const currentStatusInfo = statusConfig[orderData.order.status] || statusConfig.pending;
    const isServed = orderData.order.status === 'delivered';

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
            {/* Pay Modal */}
            <Dialog open={isPayModalOpen} onOpenChange={setIsPayModalOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-sm">
                    <DialogHeader>
                        <DialogTitle>How would you like to pay?</DialogTitle>
                        <DialogDescription>Select your preferred payment method</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-4">
                        <Button onClick={handlePayAtCounter} variant="outline" className="w-full h-14 justify-start text-left">
                            <IndianRupee className="mr-3 h-5 w-5" />
                            <div>
                                <p className="font-semibold">Pay at Counter</p>
                                <p className="text-xs text-muted-foreground">Cash, UPI, or Card at billing counter</p>
                            </div>
                        </Button>
                        <Button onClick={handlePayOnline} className="w-full h-14 justify-start text-left bg-primary hover:bg-primary/90">
                            <Wallet className="mr-3 h-5 w-5" />
                            <div>
                                <p className="font-semibold">Pay Online (Full Bill)</p>
                                <p className="text-xs opacity-80">Pay the entire bill via UPI/Card</p>
                            </div>
                        </Button>
                        <Button onClick={handleSplitBill} variant="outline" className="w-full h-14 justify-start text-left">
                            <Split className="mr-3 h-5 w-5" />
                            <div>
                                <p className="font-semibold">Split Bill</p>
                                <p className="text-xs text-muted-foreground">Share payment with your group</p>
                            </div>
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <header className="p-4 border-b border-border flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => {
                            // Navigate back to order page with table and tab params
                            const params = new URLSearchParams();
                            if (orderData.order?.tableId) params.set('table', orderData.order.tableId);
                            if (orderData.order?.dineInTabId) params.set('tabId', orderData.order.dineInTabId);
                            router.push(`/order/${orderData.restaurant?.id}?${params.toString()}`);
                        }}
                        variant="ghost"
                        size="icon"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <p className="text-xs text-muted-foreground">Tracking Dine-In Order</p>
                        <h1 className="font-bold text-lg">{orderData.restaurant?.name}</h1>
                    </div>
                </div>
                <Button onClick={() => fetchData(true)} variant="outline" size="icon" disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>

            <main className="flex-grow flex flex-col p-4 md:p-8 overflow-y-auto pb-32">
                <div className="w-full max-w-2xl mx-auto">
                    {/* Token Display */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <div className="p-4 bg-card rounded-t-lg border border-border text-center">
                            <h2 className="text-sm font-semibold text-muted-foreground">Your Token</h2>
                            <p className="text-4xl font-bold text-primary tracking-widest">{orderData.order.dineInToken || "N/A"}</p>
                        </div>
                        <div className="p-4 bg-card rounded-b-lg border-x border-b border-border">
                            <StatusTimeline currentStatus={orderData.order.status} />
                        </div>
                    </motion.div>

                    {/* Status Message */}
                    <motion.div
                        key={orderData.order.status}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-6 text-center bg-card p-4 rounded-lg border border-border"
                    >
                        <h3 className="text-xl font-bold">{currentStatusInfo.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{currentStatusInfo.description}</p>
                    </motion.div>

                    {/* Bill Details Section */}
                    {billDetails && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="mt-6 bg-card rounded-lg border border-border overflow-hidden"
                        >
                            <div className="p-4 border-b border-border bg-muted/30">
                                <h3 className="font-bold flex items-center gap-2">
                                    <Sparkles size={16} className="text-primary" /> Your Bill
                                </h3>
                            </div>
                            <div className="p-4 space-y-2">
                                {billDetails.items.map((item, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">{item.quantity}x {item.name}</span>
                                        <span>{formatCurrency(item.totalPrice || item.price * item.quantity)}</span>
                                    </div>
                                ))}
                                <div className="border-t border-dashed border-border pt-2 mt-2 space-y-1">
                                    <div className="flex justify-between text-sm text-muted-foreground">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(billDetails.subtotal)}</span>
                                    </div>
                                    {billDetails.cgst > 0 && (
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>CGST</span>
                                            <span>{formatCurrency(billDetails.cgst)}</span>
                                        </div>
                                    )}
                                    {billDetails.sgst > 0 && (
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>SGST</span>
                                            <span>{formatCurrency(billDetails.sgst)}</span>
                                        </div>
                                    )}
                                    {billDetails.discount > 0 && (
                                        <div className="flex justify-between text-sm text-green-500">
                                            <span>Discount</span>
                                            <span>-{formatCurrency(billDetails.discount)}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-between font-bold text-lg pt-2 border-t border-border">
                                    <span>Total</span>
                                    <span className="text-primary">{formatCurrency(billDetails.grandTotal)}</span>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Add More Items Button */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="mt-6"
                    >
                        <Button onClick={handleAddMoreItems} variant="outline" className="w-full h-12">
                            <PlusCircle className="mr-2 h-5 w-5" /> Add More Items
                        </Button>
                    </motion.div>

                    {/* I'm Done Button - Only show when served */}
                    {isServed && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6 }}
                            className="mt-4"
                        >
                            <Button
                                onClick={handleMarkDone}
                                variant="outline"
                                className="w-full h-12 border-green-500 text-green-500 hover:bg-green-500/10"
                                disabled={isMarkingDone}
                            >
                                <CheckCircle className="mr-2 h-5 w-5" />
                                {isMarkingDone ? 'Notifying Staff...' : "I'm Done - Clear My Table"}
                            </Button>
                        </motion.div>
                    )}
                </div>
            </main>

            <footer className="fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-lg border-t border-border z-10">
                <div className="container mx-auto p-4 space-y-3">
                    {/* Add More Items Button */}
                    {!isServed && (
                        <Button
                            onClick={handleAddMoreItems}
                            variant="outline"
                            className="w-full h-12 border-primary text-primary hover:bg-primary/10"
                        >
                            <Plus className="mr-2 h-5 w-5" /> Add More Items
                        </Button>
                    )}

                    {/* Pay Bill Button */}
                    <Button
                        onClick={() => setIsPayModalOpen(true)}
                        className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        <Wallet className="mr-3 h-6 w-6" /> Pay Bill - {formatCurrency(billDetails?.grandTotal || 0)}
                    </Button>
                </div>
            </footer>
        </div>
    );
}

export default function DineInTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <DineInTrackingContent />
        </Suspense>
    )
}
