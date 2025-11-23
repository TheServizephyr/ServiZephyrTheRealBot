
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, IndianRupee, CreditCard, Landmark, Split, Users as UsersIcon, QrCode, PlusCircle, Trash2, Home, Building, MapPin, Lock, Loader2, CheckCircle, Share2, Copy, User, Phone } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { Input } from '@/components/ui/input';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';


const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);

const SplitBillInterface = ({ totalAmount, onBack, orderDetails, onPlaceOrder }) => {
    const [splitCount, setSplitCount] = useState(2);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleGenerateSplitLinks = async () => {
        console.log("[SplitBillInterface] Generating split links...");
        if (splitCount < 2) {
            setError("Must split between at least 2 people.");
            return;
        }
        setLoading(true);
        setError('');

        try {
            // ALWAYS call onPlaceOrder to add items (works for both new and existing orders)
            console.log("[SplitBillInterface] Calling onPlaceOrder to add items...");
            const orderResult = await onPlaceOrder('split_bill');
            if (!orderResult || !orderResult.firestore_order_id) {
                throw new Error("Failed to process order for split payment.");
            }
            const baseOrderId = orderResult.firestore_order_id;
            console.log(`[SplitBillInterface] Order processed with ID: ${baseOrderId}`);

            const payload = {
                grandTotal: orderDetails.grandTotal,
                splitCount,
                baseOrderId: baseOrderId,
                restaurantId: orderDetails.restaurantId,
                // Pass pending items if this is an add-on order
                pendingItems: orderResult.pendingItems || [],
                pendingSubtotal: orderResult.pendingSubtotal || 0,
                pendingCgst: orderResult.pendingCgst || 0,
                pendingSgst: orderResult.pendingSgst || 0,
            };
            console.log("[SplitBillInterface] Calling /api/payment/create-order with payload:", payload);

            const res = await fetch('/api/payment/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create split payment session.');

            console.log(`[SplitBillInterface] Split session created with ID: ${data.splitId}. Redirecting...`);
            router.push(`/split-pay/${data.splitId}`);

        } catch (err) {
            console.error("[SplitBillInterface] Error creating split session:", err);
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <Button onClick={onBack} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Payment Options</Button>
            <h3 className="text-lg font-bold">Split Equally</h3>
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Label htmlFor="split-count">Split bill between how many people?</Label>
                <input id="split-count" type="number" min="2" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value))} className="w-24 p-2 rounded-md bg-input border border-border" />
            </div>
            <Button onClick={handleGenerateSplitLinks} disabled={loading || splitCount < 2} className="w-full h-12 text-lg">
                {loading ? <Loader2 className="animate-spin" /> : 'Create Split Session'}
            </Button>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        </div>
    );
};

const CheckoutPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isUserLoading } = useUser();
    const restaurantId = searchParams.get('restaurantId');
    const phoneFromUrl = searchParams.get('phone');
    const token = searchParams.get('token');
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');
    const isPaymentConfirmed = searchParams.get('payment_confirmed');

    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');

    const [cart, setCart] = useState([]);
    const [cartData, setCartData] = useState(null);
    const [appliedCoupons, setAppliedCoupons] = useState([]);

    const [orderName, setOrderName] = useState('');
    const [orderPhone, setOrderPhone] = useState('');
    const [selectedAddress, setSelectedAddress] = useState(null);

    const [userAddresses, setUserAddresses] = useState([]);
    const [codEnabled, setCodEnabled] = useState(false);
    const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(true);

    const [isOnlinePaymentFlow, setIsOnlinePaymentFlow] = useState(false);
    const [isSplitBillActive, setIsSplitBillActive] = useState(false);
    const [detailsConfirmed, setDetailsConfirmed] = useState(false);

    const [loading, setLoading] = useState(true);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [error, setError] = useState('');
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);

    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // Convenience Fee States
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null); // 'online' or 'counter'
    const [selectedOnlinePaymentType, setSelectedOnlinePaymentType] = useState(null); // 'full' or 'split'
    const [convenienceFeeRate] = useState(2.5); // 2.5% default

    const activeOrderId = searchParams.get('activeOrderId');

    useEffect(() => {
        if (isPaymentConfirmed) {
            setInfoDialog({ isOpen: true, title: 'Payment Confirmed', message: 'Your payment was successful. Thank you for dining with us!' });
            const cleanUrl = `/order/${restaurantId}?table=${tableId}&tabId=${tabId}`;
            router.replace(cleanUrl);
        }
    }, [isPaymentConfirmed, restaurantId, tableId, tabId, router]);


    useEffect(() => {
        console.log("[Checkout Page] Component mounting. isUserLoading:", isUserLoading);
        const verifyAndFetch = async () => {
            setLoading(true);

            const isDineIn = !!tableId;
            const isLoggedInUser = !!user;
            const isWhatsAppSession = !!phoneFromUrl && !!token;

            const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');
            const deliveryType = tableId ? 'dine-in' : (savedCart.deliveryType || 'delivery');
            const isAnonymousPreOrder = deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;

            console.log(`[Checkout Page] Verification checks: isDineIn=${isDineIn}, isLoggedInUser=${isLoggedInUser}, isWhatsAppSession=${isWhatsAppSession}, isAnonymousPreOrder=${isAnonymousPreOrder}, activeOrderId=${!!activeOrderId}`);

            if (isDineIn || isLoggedInUser || activeOrderId || isAnonymousPreOrder) {
                console.log("[Checkout Page] Session validated (Direct).");
                setIsTokenValid(true);
            } else if (isWhatsAppSession) {
                try {
                    const res = await fetch('/api/auth/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneFromUrl, token }) });
                    if (!res.ok) throw new Error((await res.json()).message || "Session validation failed.");
                    setIsTokenValid(true);
                } catch (err) {
                    setTokenError(err.message); setLoading(false); return;
                }
            }
            else {
                if (!isUserLoading) {
                    setTokenError("No session information found."); setLoading(false); return;
                }
            }

            // --- FIX: Logic to determine if details form is needed ---
            if (activeOrderId) {
                setDetailsConfirmed(true); // Don't ask for name on add-on orders
            } else if (deliveryType === 'street-vendor-pre-order') {
                setDetailsConfirmed(true); // Skip old form, use new inline UI for name/phone
            } else if (deliveryType === 'delivery' && !isLoggedInUser) {
                setDetailsConfirmed(false); // Ask for details for guest delivery
            } else {
                setDetailsConfirmed(true); // Otherwise, assume details are known (dine-in, logged-in user)
            }


            const phoneToLookup = phoneFromUrl || user?.phoneNumber || '';
            setOrderPhone(phoneToLookup);

            if (!restaurantId) { router.push('/'); return; }
            setError('');

            const updatedData = { ...savedCart, phone: phoneToLookup, token, tableId, dineInTabId: tabId, deliveryType };

            console.log("[Checkout Page] Setting cart data from localStorage:", updatedData);
            setCart(updatedData.cart || []);
            setAppliedCoupons(updatedData.appliedCoupons || []);
            setCartData(updatedData);

            try {
                const customerNameFromStorage = localStorage.getItem('customerName');
                setOrderName(customerNameFromStorage || user?.displayName || savedCart.tab_name || '');

                if (phoneToLookup) {
                    const lookupRes = await fetch('/api/customer/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneToLookup }) });
                    if (lookupRes.ok) {
                        const data = await lookupRes.json();
                        setOrderName(prev => prev || data.name || '');
                        if (deliveryType === 'delivery') {
                            setUserAddresses(data.addresses || []);
                            setSelectedAddress(prev => prev || data.addresses?.[0] || null);
                        }
                    }
                }

                const paymentSettingsRes = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
                if (paymentSettingsRes.ok) {
                    const paymentData = await paymentSettingsRes.json();
                    if (deliveryType === 'delivery') {
                        setCodEnabled(paymentData.deliveryCodEnabled);
                        setOnlinePaymentEnabled(paymentData.deliveryOnlinePaymentEnabled);
                    } else if (deliveryType === 'pickup') {
                        setCodEnabled(paymentData.pickupPodEnabled);
                        setOnlinePaymentEnabled(paymentData.pickupOnlinePaymentEnabled);
                    } else if (deliveryType === 'dine-in') {
                        setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                        setOnlinePaymentEnabled(paymentData.dineInOnlinePaymentEnabled);
                    } else if (deliveryType === 'street-vendor-pre-order') {
                        setCodEnabled(true);
                        setOnlinePaymentEnabled(true);
                    }
                }
            } catch (err) {
                setError('Failed to load checkout details. Please try again.');
            } finally {
                setLoading(false);
            }
        };

        if (!isUserLoading && !isPaymentConfirmed) {
            verifyAndFetch();
        } else if (isPaymentConfirmed) {
            setLoading(false);
        }
    }, [restaurantId, phoneFromUrl, token, tableId, tabId, user, isUserLoading, router, isPaymentConfirmed, activeOrderId]);

    const deliveryType = useMemo(() => cartData?.deliveryType || 'delivery', [cartData]);

    const handleAddNewAddress = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('returnUrl', window.location.href);
        router.push(`/add-address?${params.toString()}`);
    };

    const { subtotal, totalDiscount, finalDeliveryCharge, cgst, sgst, convenienceFee, grandTotal } = useMemo(() => {
        const currentSubtotal = cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0);
        if (!cartData) return { subtotal: currentSubtotal, totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, convenienceFee: 0, grandTotal: currentSubtotal };

        const isStreetVendor = deliveryType === 'street-vendor-pre-order';
        const isFreeDeliveryApplied = appliedCoupons.some(c => c.type === 'free_delivery' && currentSubtotal >= c.minOrder);
        const isFreeDeliveryThresholdMet = cartData?.deliveryFreeThreshold && currentSubtotal >= cartData.deliveryFreeThreshold;
        const isDeliveryFree = isFreeDeliveryApplied || isFreeDeliveryThresholdMet;

        let couponDiscountValue = 0;
        appliedCoupons.forEach(coupon => {
            if (currentSubtotal >= coupon.minOrder) {
                if (coupon.type === 'flat') couponDiscountValue += coupon.value;
                else if (coupon.type === 'percentage') couponDiscountValue += (currentSubtotal * coupon.value) / 100;
            }
        });

        const deliveryCharge = (isStreetVendor || deliveryType !== 'delivery' || isDeliveryFree || activeOrderId) ? 0 : (cartData.deliveryCharge || 0);
        const tip = (isStreetVendor || deliveryType !== 'delivery' || activeOrderId) ? 0 : (cartData.tipAmount || 0);
        const taxableAmount = currentSubtotal - couponDiscountValue;

        const tax = (isStreetVendor || taxableAmount <= 0) ? 0 : taxableAmount * 0.05;

        const subtotalWithTaxAndCharges = taxableAmount + deliveryCharge + (tax * 2) + tip;

        // Calculate convenience fee ONLY if online payment is selected
        const calculatedConvenienceFee = selectedPaymentMethod === 'online'
            ? Math.ceil(subtotalWithTaxAndCharges * (convenienceFeeRate / 100))
            : 0;

        const finalGrandTotal = subtotalWithTaxAndCharges + calculatedConvenienceFee;
        return {
            subtotal: currentSubtotal,
            totalDiscount: couponDiscountValue,
            finalDeliveryCharge: deliveryCharge,
            cgst: tax,
            sgst: tax,
            convenienceFee: calculatedConvenienceFee,
            grandTotal: finalGrandTotal
        };
    }, [cartData, cart, appliedCoupons, deliveryType, activeOrderId, selectedPaymentMethod, convenienceFeeRate]);


    const handleAddMoreToTab = () => {
        const params = new URLSearchParams({
            restaurantId, phone: phoneFromUrl || '', token: token || '',
            table: tableId, tabId: cartData.dineInTabId
        });
        router.push(`/order/${restaurantId}?${params.toString()}`);
    };

    const handleViewBill = () => {
        setDineInModalOpen(false);
        setDetailsConfirmed(true);
        setIsOnlinePaymentFlow(true);
    };

    const placeOrder = async (paymentMethod) => {
        console.log(`[Checkout Page] placeOrder called with paymentMethod: ${paymentMethod}`);
        if (!validateOrderDetails()) return;

        const orderData = {
            name: orderName, phone: orderPhone, restaurantId, items: cart, notes: cartData.notes, coupon: appliedCoupons.find(c => !c.customerId) || null,
            loyaltyDiscount: 0, subtotal, cgst, sgst, deliveryCharge: finalDeliveryCharge, grandTotal, paymentMethod: paymentMethod,
            deliveryType: cartData.deliveryType, pickupTime: cartData.pickupTime || '', tipAmount: cartData.tipAmount || 0,
            businessType: cartData.businessType || 'restaurant', tableId: cartData.tableId || null, dineInTabId: cartData.dineInTabId || null,
            pax_count: cartData.pax_count || null, tab_name: cartData.tab_name || null, address: selectedAddress,
            existingOrderId: activeOrderId || undefined,
        };

        setIsProcessingPayment(true);
        setError('');

        try {
            console.log(`[Checkout Page] Sending order to /api/order/create. PaymentMethod: ${paymentMethod}, ExistingOrderId: ${orderData.existingOrderId}`);
            const res = await fetch('/api/order/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
            const data = await res.json();
            console.log("[Checkout Page] Order API response received:", data);

            if (data.razorpay_order_id) {
                console.log(`[Checkout Page] Razorpay ID found: ${data.razorpay_order_id}`);
            } else {
                console.warn(`[Checkout Page] NO Razorpay ID found in response!`);
            }
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            // If split_bill, return the response for SplitBillInterface
            if (paymentMethod === 'split_bill') {
                setIsProcessingPayment(false);
                return data;
            }

            if (data.razorpay_order_id) {
                console.log("[Checkout Page] Razorpay order ID found. Opening payment gateway.");
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amount: grandTotal * 100, currency: "INR", name: cartData.restaurantName,
                    description: `Order from ${cartData.restaurantName}`, order_id: data.razorpay_order_id,
                    handler: function (response) {
                        console.log("[Checkout Page] Razorpay payment successful:", response);
                        localStorage.removeItem(`cart_${restaurantId}`);
                        const isPreOrder = deliveryType === 'street-vendor-pre-order';
                        const trackingUrl = isPreOrder
                            ? `/order/placed?orderId=${data.firestore_order_id}&token=${data.token}&restaurantId=${restaurantId}`
                            : `/order/placed?orderId=${data.firestore_order_id}&token=${data.token}`;
                        router.push(trackingUrl);
                    },
                    prefill: { name: orderName, email: user?.email || "customer@servizephyr.com", contact: orderPhone },
                    redirect: orderData.deliveryType === 'dine-in' ? true : false,
                    modal: {
                        ondismiss: function () {
                            console.log("[Checkout Page] Razorpay modal dismissed.");
                            setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You can try paying again.' });
                            setIsProcessingPayment(false);
                        }
                    }
                };
                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response) {
                    console.error("[Checkout Page] Razorpay payment failed:", response);
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: response.error.description });
                    setIsProcessingPayment(false);
                });
                rzp.open();
            } else {
                console.warn(`[Checkout Page] NO Razorpay ID found in response!`);
                console.log("[Checkout Page] No Razorpay ID. Clearing cart and handling redirection.");

                if (activeOrderId) {
                    router.push(`/track/pre-order/${activeOrderId}?token=${token}`);
                    return;
                }

                localStorage.removeItem(`cart_${restaurantId}`);
                if (orderData.deliveryType === 'dine-in') {
                    setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab settled at counter. Thank you!' });
                    setTimeout(() => {
                        const newUrl = `/order/${restaurantId}?table=${tableId}&tabId=${data.dine_in_tab_id || tabId}`;
                        router.replace(newUrl);
                    }, 2000);
                } else {
                    router.push(`/order/placed?orderId=${data.firestore_order_id}&token=${data.token}&restaurantId=${restaurantId}`);
                }
            }
        } catch (err) {
            console.error("[Checkout Page] placeOrder function error:", err);
            setError(err.message);
            setIsProcessingPayment(false);
        }
    };

    const validateOrderDetails = () => {
        if (activeOrderId) return true;

        if (deliveryType === 'delivery' && !selectedAddress) {
            setError("Please select or add a delivery address.");
            return false;
        }
        if (deliveryType === 'street-vendor-pre-order' && (!orderName || orderName.trim().length === 0)) {
            setError("Please provide a name for the order.");
            return false;
        }
        setError('');
        return true;
    }

    const handleConfirmDetails = () => {
        if (validateOrderDetails()) {
            localStorage.setItem('customerName', orderName);
            setDetailsConfirmed(true);
        }
    }

    const handlePayAtCounter = () => {
        if (validateOrderDetails()) {
            placeOrder('cod');
        }
    }

    const fullOrderDetailsForSplit = {
        grandTotal,
        firestore_order_id: activeOrderId || `temp_${Date.now()}`,
        restaurantId
    };

    const renderPaymentOptions = () => {
        if (isSplitBillActive) {
            return <SplitBillInterface totalAmount={grandTotal} onBack={() => setIsSplitBillActive(false)} orderDetails={fullOrderDetailsForSplit} onPlaceOrder={placeOrder} />
        }

        return (
            <div className="space-y-4">
                {isOnlinePaymentFlow && <Button onClick={() => setIsOnlinePaymentFlow(false)} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>}

                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => placeOrder('online')} disabled={isProcessingPayment} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50">
                    {isProcessingPayment && <Loader2 className="animate-spin h-5 w-5" />}
                    {!isProcessingPayment && <CreditCard size={40} className="text-primary flex-shrink-0" />}
                    <div>
                        <h3 className="text-xl font-bold">Pay Full Bill</h3>
                        <p className="text-muted-foreground">Use UPI, Card, or Netbanking</p>
                    </div>
                </motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsSplitBillActive(true)} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all">
                    <Split size={40} className="text-primary flex-shrink-0" />
                    <div>
                        <h3 className="text-xl font-bold">Split The Bill</h3>
                        <p className="text-muted-foreground">Split equally with your friends.</p>
                    </div>
                </motion.button>
            </div >
        );
    }

    const renderDetailsForm = () => {
        return (
            <div className="mb-6 bg-card p-4 rounded-lg border">
                <h3 className="font-bold text-lg mb-2">Confirm Your Details</h3>
                <div className="space-y-4">
                    {deliveryType === 'delivery' ? (
                        <div>
                            <Label htmlFor="address">Select an address</Label>
                            <div className="space-y-2 mt-2">
                                {userAddresses.map(addr => (
                                    <div key={addr.id} className="flex items-start gap-2 p-3 rounded-md bg-muted has-[:checked]:bg-primary/10 has-[:checked]:border-primary border border-transparent">
                                        <input type="radio" id={addr.id} name="address" value={addr.id} checked={selectedAddress?.id === addr.id} onChange={() => setSelectedAddress(addr)} className="h-4 w-4 mt-1 text-primary border-gray-300 focus:ring-primary" />
                                        <Label htmlFor={addr.id} className="flex-1 cursor-pointer">
                                            <p className="font-semibold">{addr.name}{addr.label && <span className="font-normal text-muted-foreground"> ({addr.label})</span>}</p>
                                            <p className="text-xs text-muted-foreground">{addr.full}</p>
                                            <p className="text-xs text-muted-foreground">Ph: {addr.phone}</p>
                                        </Label>
                                    </div>
                                ))}
                                <Button variant="outline" className="w-full" onClick={handleAddNewAddress}><PlusCircle className="mr-2 h-4 w-4" /> Add New Address</Button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <Label htmlFor="name" className="flex items-center gap-2"><User size={16} /> Your Name *</Label>
                            <Input id="name" value={orderName} onChange={(e) => setOrderName(e.target.value)} disabled={loading} required />
                        </div>
                    )}
                    {(deliveryType === 'street-vendor-pre-order') ? (
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16} /> Phone Number (Optional)</Label>
                            <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} placeholder="For order updates via WhatsApp" />
                        </div>
                    ) : (
                        deliveryType !== 'delivery' && (
                            <div>
                                <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16} /> Phone Number</Label>
                                <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} />
                            </div>
                        )
                    )}
                </div>
                <Button onClick={handleConfirmDetails} className="w-full mt-4 bg-primary text-primary-foreground">
                    Confirm & Choose Payment
                </Button>
            </div>
        )
    }

    if (loading && !cartData) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    const cameToPay = (!cart || cart.length === 0) && tabId;

    if (deliveryType === 'dine-in' && cartData?.dineInModel === 'post-paid' && cart.length > 0) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <Lock size={48} className="text-destructive mb-4" />
                <h1 className="text-2xl font-bold text-foreground">Payment Not Required</h1>
                <p className="mt-2 text-muted-foreground max-w-md">This is a post-paid order. Please place your order from the cart to get a WhatsApp confirmation.</p>
                <Button onClick={() => router.push(`/cart?restaurantId=${restaurantId}&${searchParams.toString()}`)} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Cart
                </Button>
            </div>
        );
    }

    if (isPaymentConfirmed) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <CheckCircle className="w-24 h-24 text-primary mx-auto" />
                <h1 className="text-4xl font-bold text-foreground mt-6">Payment Successful!</h1>
                <p className="mt-4 text-lg text-muted-foreground max-w-md">Thank you for dining with us. Your bill has been settled.</p>
                <Button onClick={() => router.push(`/order/${restaurantId}?table=${tableId}`)} className="mt-8">
                    Back to Menu
                </Button>
            </div>
        )
    }

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <Dialog open={isDineInModalOpen} onOpenChange={setDineInModalOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>What would you like to do?</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 gap-4 py-4">
                        <Button onClick={handleAddMoreToTab} variant="outline" className="h-16 text-lg">Add More Items</Button>
                        <Button onClick={handleViewBill} className="h-16 text-lg">View Bill & Pay</Button>
                    </div>
                </DialogContent>
            </Dialog>
            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10"><ArrowLeft /></Button>
                        <div>
                            <p className="text-xs text-muted-foreground">{cameToPay ? 'Final Step' : detailsConfirmed ? (activeOrderId ? 'Add to Order' : 'Step 2 of 2') : 'Step 1 of 2'}</p>
                            <h1 className="text-xl font-bold">{cameToPay ? 'Pay Your Bill' : detailsConfirmed ? 'Choose Payment Method' : 'Confirm Your Details'}</h1>
                        </div>
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                        {error && <p className="text-destructive text-sm bg-destructive/10 p-2 rounded-md mb-4">{error}</p>}

                        {!detailsConfirmed && renderDetailsForm()}

                        {detailsConfirmed && (
                            <>
                                {/* BILL SUMMARY WITH BREAKDOWN */}
                                <div className="bg-card p-4 rounded-lg border border-border mb-6">
                                    <h3 className="font-bold text-lg mb-4">Bill Summary</h3>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span>Subtotal</span>
                                            <span>₹{subtotal.toFixed(2)}</span>
                                        </div>
                                        {cgst > 0 && (
                                            <>
                                                <div className="flex justify-between text-sm">
                                                    <span>CGST (5%)</span>
                                                    <span>₹{cgst.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span>SGST (5%)</span>
                                                    <span>₹{sgst.toFixed(2)}</span>
                                                </div>
                                            </>
                                        )}
                                        <div className="border-t border-dashed pt-2 mt-2" />
                                        <div className="flex justify-between text-sm">
                                            <span>Order Total</span>
                                            <span className="font-semibold">₹{(subtotal + cgst + sgst).toFixed(2)}</span>
                                        </div>
                                        {convenienceFee > 0 && (
                                            <>
                                                <div className="flex justify-between text-sm text-orange-600">
                                                    <span>Payment Processing Fee ({convenienceFeeRate}%)</span>
                                                    <span>₹{convenienceFee.toFixed(2)}</span>
                                                </div>
                                            </>
                                        )}
                                        <div className="border-t border-border pt-2 mt-2" />
                                        <div className="flex justify-between text-xl font-bold">
                                            <span>You Pay</span>
                                            <span className="text-primary">₹{grandTotal.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* INLINE PAYMENT METHOD SELECTION */}
                                <div className="bg-card p-4 rounded-lg border border-border mb-6">
                                    <h3 className="font-bold text-lg mb-3">💳 Select Payment Method</h3>
                                    <div className="space-y-3">
                                        {/* Pay at Counter Option */}
                                        {codEnabled && (
                                            <div
                                                onClick={() => {
                                                    setSelectedPaymentMethod('counter');
                                                    setSelectedOnlinePaymentType(null);
                                                }}
                                                className={cn(
                                                    "p-4 rounded-lg border-2 cursor-pointer transition-all",
                                                    selectedPaymentMethod === 'counter'
                                                        ? "border-primary bg-primary/5"
                                                        : "border-border hover:border-primary/50"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                                                        selectedPaymentMethod === 'counter' ? "border-primary" : "border-border"
                                                    )}>
                                                        {selectedPaymentMethod === 'counter' && (
                                                            <div className="w-3 h-3 rounded-full bg-primary" />
                                                        )}
                                                    </div>
                                                    <IndianRupee size={24} className="text-primary" />
                                                    <div className="flex-1">
                                                        <p className="font-bold">
                                                            {deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' || deliveryType === 'street-vendor-pre-order') ? 'Pay at Counter' : 'Pay on Delivery'}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">Cash or UPI at the counter</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Pay Online Option */}
                                        {onlinePaymentEnabled && (
                                            <div
                                                onClick={() => setSelectedPaymentMethod('online')}
                                                className={cn(
                                                    "p-4 rounded-lg border-2 cursor-pointer transition-all",
                                                    selectedPaymentMethod === 'online'
                                                        ? "border-primary bg-primary/5"
                                                        : "border-border hover:border-primary/50"
                                                )}
                                            >
                                                <div className="flex items-center gap-3 mb-2">
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                                                        selectedPaymentMethod === 'online' ? "border-primary" : "border-border"
                                                    )}>
                                                        {selectedPaymentMethod === 'online' && (
                                                            <div className="w-3 h-3 rounded-full bg-primary" />
                                                        )}
                                                    </div>
                                                    <Landmark size={24} className="text-primary" />
                                                    <div className="flex-1">
                                                        <p className="font-bold">Pay Online</p>
                                                        <p className="text-xs text-muted-foreground">UPI, Cards, Netbanking</p>
                                                    </div>
                                                </div>

                                                {/* Convenience Fee Warning */}
                                                {selectedPaymentMethod === 'online' && (
                                                    <div className="ml-11 mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-xs text-orange-700 dark:text-orange-400">
                                                        ⚠️ +₹{convenienceFee.toFixed(2)} payment processing fee will be added
                                                    </div>
                                                )}

                                                {/* Online Payment Sub-options */}
                                                {selectedPaymentMethod === 'online' && (
                                                    <div className="ml-11 mt-3 space-y-2 pl-3 border-l-2 border-primary/30">
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedOnlinePaymentType('full');
                                                            }}
                                                            className={cn(
                                                                "p-3 rounded border cursor-pointer",
                                                                selectedOnlinePaymentType === 'full'
                                                                    ? "border-primary bg-background"
                                                                    : "border-border/50 hover:border-primary/50"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div className={cn(
                                                                    "w-4 h-4 rounded-full border flex items-center justify-center",
                                                                    selectedOnlinePaymentType === 'full' ? "border-primary" : "border-border"
                                                                )}>
                                                                    {selectedOnlinePaymentType === 'full' && (
                                                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                                                    )}
                                                                </div>
                                                                <Wallet size={16} />
                                                                <span className="text-sm font-medium">Pay Full Bill</span>
                                                            </div>
                                                        </div>

                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedOnlinePaymentType('split');
                                                            }}
                                                            className={cn(
                                                                "p-3 rounded border cursor-pointer",
                                                                selectedOnlinePaymentType === 'split'
                                                                    ? "border-primary bg-background"
                                                                    : "border-border/50 hover:border-primary/50"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div className={cn(
                                                                    "w-4 h-4 rounded-full border flex items-center justify-center",
                                                                    selectedOnlinePaymentType === 'split' ? "border-primary" : "border-border"
                                                                )}>
                                                                    {selectedOnlinePaymentType === 'split' && (
                                                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                                                    )}
                                                                </div>
                                                                <Split size={16} />
                                                                <span className="text-sm font-medium">Split with Friends</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* CUSTOMER DETAILS (Conditional based on payment method) */}
                                {selectedPaymentMethod && (
                                    <div className="bg-card p-4 rounded-lg border border-border mb-6">
                                        <h3 className="font-bold text-lg mb-3">📝 Your Details</h3>
                                        <div className="space-y-3">
                                            <div>
                                                <Label htmlFor="customer-name" className="flex items-center gap-2">
                                                    <User size={16} /> Name *
                                                </Label>
                                                <Input
                                                    id="customer-name"
                                                    value={orderName}
                                                    onChange={(e) => setOrderName(e.target.value)}
                                                    placeholder="Enter your name"
                                                    disabled={loading}
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="customer-phone" className="flex items-center gap-2">
                                                    <Phone size={16} /> Phone Number {selectedPaymentMethod === 'counter' ? '*' : '(Optional)'}
                                                </Label>
                                                <Input
                                                    id="customer-phone"
                                                    value={orderPhone}
                                                    onChange={(e) => setOrderPhone(e.target.value)}
                                                    placeholder="10-digit mobile number"
                                                    disabled={loading || !!phoneFromUrl}
                                                    required={selectedPaymentMethod === 'counter'}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* PLACE ORDER BUTTON */}
                                {selectedPaymentMethod && (
                                    selectedPaymentMethod === 'counter' ? (
                                        <Button
                                            onClick={handlePayAtCounter}
                                            disabled={isProcessingPayment || !orderName.trim() || (selectedPaymentMethod === 'counter' && !orderPhone.trim())}
                                            className="w-full h-14 text-lg"
                                        >
                                            {isProcessingPayment ? <Loader2 className="animate-spin" /> : 'Place Order'}
                                        </Button>
                                    ) : (
                                        selectedOnlinePaymentType && (
                                            <Button
                                                onClick={() => {
                                                    if (selectedOnlinePaymentType === 'full') {
                                                        placeOrder('online');
                                                    } else if (selectedOnlinePaymentType === 'split') {
                                                        setIsSplitBillActive(true);
                                                    }
                                                }}
                                                disabled={isProcessingPayment || !orderName.trim()}
                                                className="w-full h-14 text-lg"
                                            >
                                                {isProcessingPayment ? <Loader2 className="animate-spin" /> :
                                                    selectedOnlinePaymentType === 'full' ? 'Proceed to Pay' : 'Create Split Session'
                                                }
                                            </Button>
                                        )
                                    )
                                )}

                                {/* SPLIT BILL INTERFACE (if active) */}
                                {isSplitBillActive && (
                                    <div className="mt-6">
                                        <SplitBillInterface
                                            totalAmount={grandTotal}
                                            onBack={() => setIsSplitBillActive(false)}
                                            orderDetails={fullOrderDetailsForSplit}
                                            onPlaceOrder={placeOrder}
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </motion.div>
                </main>
            </div>
        </>
    );
};


const CheckoutPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <CheckoutPageInternal />
    </Suspense>
);

export default CheckoutPage;
