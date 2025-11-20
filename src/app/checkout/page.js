
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

const SplitBillInterface = ({ totalAmount, onBack, orderDetails }) => {
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
            const payload = { 
                grandTotal: orderDetails.grandTotal, 
                splitCount, 
                baseOrderId: orderDetails.firestore_order_id,
                restaurantId: orderDetails.restaurantId,
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
            <Button onClick={onBack} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Payment Options</Button>
            <h3 className="text-lg font-bold">Split Equally</h3>
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Label htmlFor="split-count">Split bill between how many people?</Label>
                <input id="split-count" type="number" min="2" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value))} className="w-24 p-2 rounded-md bg-input border border-border" />
            </div>
            <Button onClick={handleGenerateSplitLinks} disabled={loading || splitCount < 2} className="w-full h-12 text-lg">
                {loading ? <Loader2 className="animate-spin"/> : 'Create Split Session'}
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

            // --- START: Anonymous Pre-Order Check ---
            let isAnonymousPreOrder = false;
            try {
                const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');
                isAnonymousPreOrder = savedCart.deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;
            } catch (e) {
                // Ignore parsing errors, isAnonymousPreOrder will remain false
            }
            // --- END: Anonymous Pre-Order Check ---
            
            console.log(`[Checkout Page] Verification checks: isDineIn=${isDineIn}, isLoggedInUser=${isLoggedInUser}, isWhatsAppSession=${isWhatsAppSession}, isAnonymousPreOrder=${isAnonymousPreOrder}, activeOrderId=${!!activeOrderId}`);

            if (isDineIn || isLoggedInUser || activeOrderId) {
                console.log("[Checkout Page] Session validated (Direct).");
                setIsTokenValid(true);
            } else if (isWhatsAppSession) {
                try {
                    console.log("[Checkout Page] Verifying WhatsApp session via API...");
                    const res = await fetch('/api/auth/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneFromUrl, token }) });
                    if (!res.ok) throw new Error((await res.json()).message || "Session validation failed.");
                    console.log("[Checkout Page] Session validated (API).");
                    setIsTokenValid(true);
                } catch (err) {
                    console.error("[Checkout Page] Token verification failed:", err.message);
                    setTokenError(err.message); setLoading(false); return;
                }
            } else if (isAnonymousPreOrder) {
                console.log("[Checkout Page] Session validated (Anonymous Pre-Order).");
                setIsTokenValid(true);
            } else {
                if(!isUserLoading) {
                    console.error("[Checkout Page] No session info found and user is not loading.");
                    setTokenError("No session information found."); setLoading(false); return;
                }
            }
            
            if (isLoggedInUser || activeOrderId) {
                console.log("[Checkout Page] Auto-confirming details for non-interactive session.");
                setDetailsConfirmed(true);
            }

            const phoneToLookup = phoneFromUrl || user?.phoneNumber || '';
            setOrderPhone(phoneToLookup);
            
            if (!restaurantId) { router.push('/'); return; }
            setError('');

            const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');
            const parsedData = savedCart;
            
            const deliveryType = tableId ? 'dine-in' : (parsedData.deliveryType || 'delivery');
            const updatedData = { ...parsedData, phone: phoneToLookup, token, tableId, dineInTabId: tabId, deliveryType };
            
            console.log("[Checkout Page] Setting cart data from localStorage:", updatedData);
            setCart(updatedData.cart || []);
            setAppliedCoupons(updatedData.appliedCoupons || []);
            setCartData(updatedData);

            try {
                setOrderName(user?.displayName || parsedData.tab_name || '');
                if (phoneToLookup) {
                     console.log(`[Checkout Page] Looking up customer details for phone: ${phoneToLookup}`);
                    const lookupRes = await fetch('/api/customer/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneToLookup }) });
                    if (lookupRes.ok) {
                        const data = await lookupRes.json();
                        console.log("[Checkout Page] Customer lookup successful:", data);
                        setOrderName(prev => prev || data.name || '');
                        if (deliveryType === 'delivery') {
                            setUserAddresses(data.addresses || []);
                            setSelectedAddress(prev => prev || data.addresses?.[0] || null);
                        }
                    } else {
                        console.warn("[Checkout Page] Customer lookup failed or user not found.");
                    }
                }

                console.log(`[Checkout Page] Fetching payment settings for restaurant: ${restaurantId}`);
                const paymentSettingsRes = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
                if (paymentSettingsRes.ok) {
                    const paymentData = await paymentSettingsRes.json();
                    console.log("[Checkout Page] Payment settings fetched:", paymentData);
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
                console.error("[Checkout Page] Error fetching initial data:", err);
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

    const { subtotal, totalDiscount, finalDeliveryCharge, cgst, sgst, grandTotal } = useMemo(() => {
        const currentSubtotal = cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0);
        if (!cartData) return { subtotal: currentSubtotal, totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, grandTotal: currentSubtotal };

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

        const finalGrandTotal = taxableAmount + deliveryCharge + (tax * 2) + tip;
        return { subtotal: currentSubtotal, totalDiscount: couponDiscountValue, finalDeliveryCharge: deliveryCharge, cgst: tax, sgst: tax, grandTotal: finalGrandTotal };
    }, [cartData, cart, appliedCoupons, deliveryType, activeOrderId]);


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
            console.log("[Checkout Page] Sending order to /api/order/create with payload:", orderData);
            const res = await fetch('/api/order/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            console.log("[Checkout Page] Order API response received:", data);

            if (activeOrderId) {
                 router.push(`/track/pre-order/${activeOrderId}?token=${token}`);
                 return;
            }

            if (data.razorpay_order_id) {
                console.log("[Checkout Page] Razorpay order ID found. Opening payment gateway.");
                const redirectUrl = `${window.location.origin}/checkout?restaurantId=${restaurantId}&table=${tableId}&tabId=${data.dine_in_tab_id || tabId}&payment_confirmed=true`;
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
                        ondismiss: function() {
                            console.log("[Checkout Page] Razorpay modal dismissed.");
                            setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You can try paying again.' });
                            setIsProcessingPayment(false); 
                        }
                    }
                };
                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response){
                    console.error("[Checkout Page] Razorpay payment failed:", response);
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: response.error.description });
                    setIsProcessingPayment(false);
                });
                rzp.open();
            } else {
                console.log("[Checkout Page] No Razorpay ID. Clearing cart and handling redirection.");
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
        if ((deliveryType === 'street-vendor-pre-order' || deliveryType === 'pickup') && (!orderName || orderName.trim().length === 0)) {
             setError("Please provide a name for the order.");
             return false;
        }
        setError('');
        return true;
    }

    const handleConfirmDetails = () => {
        if (validateOrderDetails()) {
            setDetailsConfirmed(true);
        }
    }
    
    const handlePayAtCounter = () => {
        if(validateOrderDetails()){
            placeOrder('cod');
        }
    }
    
    if (loading && !cartData) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner/></div>;
    }
    
    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner/></div>;
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

    const fullOrderDetailsForSplit = {
        grandTotal,
        firestore_order_id: activeOrderId || `temp_${Date.now()}`,
        restaurantId
    };

    
    const renderPaymentOptions = () => {
        if (isSplitBillActive) {
            return <SplitBillInterface totalAmount={grandTotal} onBack={() => setIsSplitBillActive(false)} orderDetails={fullOrderDetailsForSplit}/>
        }

        return (
             <div className="space-y-4">
                {isOnlinePaymentFlow && <Button onClick={() => setIsOnlinePaymentFlow(false)} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Button>}
                
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => placeOrder('razorpay')} disabled={isProcessingPayment} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50">
                    {isProcessingPayment && <Loader2 className="animate-spin h-5 w-5"/>}
                    {!isProcessingPayment && <CreditCard size={40} className="text-primary flex-shrink-0"/>}
                    <div>
                        <h3 className="text-xl font-bold">Pay Full Bill</h3>
                        <p className="text-muted-foreground">Use UPI, Card, or Netbanking</p>
                    </div>
                </motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsSplitBillActive(true)} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all">
                    <Split size={40} className="text-primary flex-shrink-0"/>
                    <div>
                        <h3 className="text-xl font-bold">Split The Bill</h3>
                        <p className="text-muted-foreground">Split equally with your friends.</p>
                    </div>
                </motion.button>
            </div>
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
                            <Label htmlFor="name" className="flex items-center gap-2"><User size={16}/> Your Name *</Label>
                            <Input id="name" value={orderName} onChange={(e) => setOrderName(e.target.value)} disabled={loading} required/>
                        </div>
                    )}
                    {(deliveryType === 'street-vendor-pre-order') ? (
                         <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16}/> Phone Number (Optional)</Label>
                            <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} placeholder="For order updates via WhatsApp"/>
                        </div>
                    ): (
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16}/> Phone Number</Label>
                            <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} />
                        </div>
                    )}
                 </div>
                  <Button onClick={handleConfirmDetails} className="w-full mt-4 bg-primary text-primary-foreground">
                    Confirm & Choose Payment
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
                            <div className="bg-card p-4 rounded-lg border border-border mb-6">
                                <div className="flex justify-between items-center text-lg font-bold">
                                    <span>{activeOrderId ? 'Amount to Add:' : 'Total Amount Payable'}</span>
                                    <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span>
                                </div>
                            </div>
                            
                            {isOnlinePaymentFlow ? renderPaymentOptions() : (
                                 <div className="space-y-4">
                                     {onlinePaymentEnabled &&
                                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsOnlinePaymentFlow(true)} disabled={isProcessingPayment} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50">
                                            {isProcessingPayment ? <Loader2 className="animate-spin h-10 w-10 text-primary flex-shrink-0"/> : <Landmark size={40} className="text-primary flex-shrink-0"/>}
                                            <div>
                                                <h3 className="text-xl font-bold">Pay Online</h3>
                                                <p className="text-muted-foreground">UPI, Credit/Debit Card, Netbanking</p>
                                            </div>
                                        </motion.button>
                                     }
                                    {codEnabled ? (
                                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handlePayAtCounter} disabled={isProcessingPayment} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50">
                                            {isProcessingPayment ? <Loader2 className="animate-spin h-10 w-10 text-primary flex-shrink-0"/> : <IndianRupee size={40} className="text-primary flex-shrink-0"/>}
                                            <div>
                                                <h3 className="text-xl font-bold">{deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' || deliveryType === 'street-vendor-pre-order') ? 'Pay at Counter' : 'Pay on Delivery'}</h3>
                                                <p className="text-muted-foreground">Pay with cash or UPI when you receive your order</p>
                                            </div>
                                        </motion.button>
                                    ) : (
                                        <div className="w-full text-left p-6 bg-muted/50 border-2 border-dashed border-border rounded-lg flex items-center gap-6 opacity-60">
                                            <IndianRupee size={40} className="text-muted-foreground flex-shrink-0"/>
                                            <div>
                                                <h3 className="text-xl font-bold text-muted-foreground">{deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' || deliveryType === 'street-vendor-pre-order') ? 'Pay at Counter' : 'Pay on Delivery'}</h3>
                                                <p className="text-muted-foreground">This payment method is not available right now.</p>
                                            </div>
                                        </div>
                                    )}
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
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner/></div>}>
        <CheckoutPageInternal />
    </Suspense>
);

export default CheckoutPage;
