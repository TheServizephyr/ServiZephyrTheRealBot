
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, IndianRupee, CreditCard, Landmark, Split, Users as UsersIcon, QrCode, PlusCircle, Trash2, Home, Building, MapPin, Lock, Loader2, CheckCircle, Share2, Copy } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { Input } from '@/components/ui/input';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';


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
        if (splitCount < 2) {
            setError("Must split between at least 2 people.");
            return;
        }
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/payment/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    totalAmount: orderDetails.grandTotal, 
                    splitCount, 
                    baseOrderId: orderDetails.firestore_order_id,
                    restaurantId: orderDetails.restaurantId,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create split payment session.');
            
            router.push(`/split-pay/${data.splitId}`);

        } catch (err) {
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
    
    const [isOnlinePaymentFlow, setIsOnlinePaymentFlow] = useState(false); 
    const [isSplitBillActive, setIsSplitBillActive] = useState(false);
    
    const [loading, setLoading] = useState(true);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [error, setError] = useState('');
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);
    
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        if (isPaymentConfirmed) {
            setInfoDialog({ isOpen: true, title: 'Payment Confirmed', message: 'Your payment was successful. Thank you for dining with us!' });
            const cleanUrl = `/order/${restaurantId}?table=${tableId}&tabId=${tabId}`;
            router.replace(cleanUrl);
        }
    }, [isPaymentConfirmed, restaurantId, tableId, tabId, router]);
    

    useEffect(() => {
        const verifyAndFetch = async () => {
            setLoading(true);

            // --- START: NEW UNIVERSAL VERIFICATION LOGIC ---
            const isDineIn = !!tableId;
            const isLoggedInUser = !!user;
            const isWhatsAppSession = !!phoneFromUrl && !!token;
            
            const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');
            const isAnonymousPreOrder = savedCart.deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;

            if (isDineIn || isLoggedInUser || isAnonymousPreOrder) {
                console.log(`[Checkout Page] Session validated. Reason: ${isDineIn ? 'Dine-in' : isLoggedInUser ? 'Logged in' : 'Anonymous Pre-order'}`);
                setIsTokenValid(true);
            } else if (isWhatsAppSession) {
                try {
                    const res = await fetch('/api/auth/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneFromUrl, token }) });
                    if (!res.ok) throw new Error((await res.json()).message || "Session validation failed.");
                    setIsTokenValid(true);
                } catch (err) {
                    setTokenError(err.message); setLoading(false); return;
                }
            } else {
                if(!isUserLoading) {
                    setTokenError("No session information found."); setLoading(false); return;
                }
            }
            // --- END: NEW UNIVERSAL VERIFICATION LOGIC ---

            const phoneToLookup = phoneFromUrl || user?.phoneNumber || '';
            setOrderPhone(phoneToLookup);
            
            if (!restaurantId) { router.push('/'); return; }
            setError('');

            const parsedData = savedCart;
            
            const deliveryType = tableId ? 'dine-in' : (parsedData.deliveryType || 'delivery');
            const updatedData = { ...parsedData, phone: phoneToLookup, token, tableId, dineInTabId: tabId, deliveryType };
            
            setCart(updatedData.cart || []);
            setAppliedCoupons(updatedData.appliedCoupons || []);
            setCartData(updatedData);

            try {
                setOrderName(user?.displayName || parsedData.tab_name || '');
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
                    if (deliveryType === 'delivery') setCodEnabled(paymentData.deliveryCodEnabled);
                    else if (deliveryType === 'pickup') setCodEnabled(paymentData.pickupPodEnabled);
                    else if (deliveryType === 'dine-in') setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                    else if (deliveryType === 'street-vendor-pre-order') setCodEnabled(true); // Always true for pay at counter for vendors
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
    }, [restaurantId, phoneFromUrl, token, tableId, tabId, user, isUserLoading, router, isPaymentConfirmed]);
    

    const handleAddNewAddress = () => {
        const params = new URLSearchParams({
            returnUrl: window.location.href,
            phone: phoneFromUrl || '',
            token: token || '',
        });
        if (tableId) params.append('table', tableId);
        router.push(`/add-address?${params.toString()}`);
    };

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);
    
    const { totalDiscount, finalDeliveryCharge, cgst, sgst, grandTotal } = useMemo(() => {
        if (!cartData) return { totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, grandTotal: subtotal };
        const deliveryType = cartData.deliveryType || 'delivery';
        const isStreetVendor = deliveryType === 'street-vendor-pre-order';
        
        let couponDiscountValue = 0;
        appliedCoupons.forEach(coupon => {
            if (subtotal >= coupon.minOrder) {
                if (coupon.type === 'flat') couponDiscountValue += coupon.value;
                else if (coupon.type === 'percentage') couponDiscountValue += (subtotal * coupon.value) / 100;
            }
        });
        const hasFreeDelivery = appliedCoupons.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        const deliveryCharge = (isStreetVendor || deliveryType !== 'delivery' || hasFreeDelivery) ? 0 : (cartData.deliveryCharge || 0);
        const tip = (isStreetVendor || deliveryType !== 'delivery') ? 0 : (cartData.tipAmount || 0);
        const taxableAmount = subtotal - couponDiscountValue;
        
        const tax = (isStreetVendor || taxableAmount <= 0) ? 0 : taxableAmount * 0.05;

        const finalGrandTotal = taxableAmount + deliveryCharge + (tax * 2) + tip;
        return { totalDiscount: couponDiscountValue, finalDeliveryCharge: deliveryCharge, cgst: tax, sgst: tax, grandTotal: finalGrandTotal };
    }, [cartData, cart, appliedCoupons, subtotal]);

    const handleAddMoreToTab = () => {
        const params = new URLSearchParams({
            restaurantId, phone: phoneFromUrl || '', token: token || '',
            table: tableId, tabId: cartData.dineInTabId
        });
        router.push(`/order/${restaurantId}?${params.toString()}`);
    };

    const handleViewBill = () => {
        setDineInModalOpen(false);
        setIsOnlinePaymentFlow(true);
    };
    
    const placeOrder = async (paymentMethod) => {
        if (!validateOrderDetails()) return;
        
        const deliveryType = cartData.tableId ? 'dine-in' : (cartData.deliveryType || 'delivery');

        const orderData = {
            name: orderName, phone: orderPhone, restaurantId, items: cart, notes: cartData.notes, coupon: appliedCoupons.find(c => !c.customerId) || null,
            loyaltyDiscount: 0, subtotal, cgst, sgst, deliveryCharge: finalDeliveryCharge, grandTotal, paymentMethod: paymentMethod,
            deliveryType: cartData.deliveryType, pickupTime: cartData.pickupTime || '', tipAmount: cartData.tipAmount || 0,
            businessType: cartData.businessType || 'restaurant', tableId: cartData.tableId || null, dineInTabId: cartData.dineInTabId || null,
            pax_count: cartData.pax_count || null, tab_name: cartData.tab_name || null, address: selectedAddress 
        };

        setIsProcessingPayment(true); 
        setError('');

        try {
            const res = await fetch('/api/customer/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            if (data.razorpay_order_id) {
                const redirectUrl = `${window.location.origin}/checkout?restaurantId=${restaurantId}&table=${tableId}&tabId=${data.dine_in_tab_id || tabId}&payment_confirmed=true`;
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amount: grandTotal * 100, currency: "INR", name: cartData.restaurantName,
                    description: `Order from ${cartData.restaurantName}`, order_id: data.razorpay_order_id,
                    handler: function (response) {
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
                            setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You can try paying again.' });
                            setIsProcessingPayment(false); 
                        }
                    }
                };
                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response){
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: response.error.description });
                    setIsProcessingPayment(false);
                });
                rzp.open();
            } else {
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
            setError(err.message);
            setIsProcessingPayment(false);
        }
    };
    
    const validateOrderDetails = () => {
        const deliveryType = cartData.tableId ? 'dine-in' : (cartData.deliveryType || 'delivery');
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

    const handleOnlinePayClick = () => {
        if (validateOrderDetails()) {
            setIsOnlinePaymentFlow(true);
        }
    };
    
    const handlePayAtCounter = () => {
        if(validateOrderDetails()){
            placeOrder('cod');
        }
    }
    
    if (loading && !cartData) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>;
    }
    
    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16"/></div>;
    }

    const deliveryType = cartData?.deliveryType || 'delivery';
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
        firestore_order_id: cartData.id, 
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
                 {(deliveryType === 'dine-in' || deliveryType === 'street-vendor-pre-order') && (
                     <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsSplitBillActive(true)} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all">
                        <Split size={40} className="text-primary flex-shrink-0"/>
                        <div>
                            <h3 className="text-xl font-bold">Split The Bill</h3>
                            <p className="text-muted-foreground">Split equally with your friends.</p>
                        </div>
                    </motion.button>
                )}
            </div>
        );
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
                            <p className="text-xs text-muted-foreground">{cameToPay ? 'Final Step' : 'Step 2 of 2'}</p>
                            <h1 className="text-xl font-bold">{cameToPay ? 'Pay Your Bill' : 'Choose Payment Method'}</h1>
                        </div>
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                        {error && <p className="text-destructive text-sm bg-destructive/10 p-2 rounded-md mb-4">{error}</p>}
                        
                        {deliveryType !== 'dine-in' && !isOnlinePaymentFlow && (
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
                                        <Label htmlFor="name">Your Name</Label>
                                        <Input id="name" value={orderName} onChange={(e) => setOrderName(e.target.value)} disabled={loading} />
                                    </div>
                                )}
                                {deliveryType !== 'street-vendor-pre-order' && (
                                    <div>
                                        <Label htmlFor="phone">Phone Number</Label>
                                        <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} />
                                    </div>
                                )}
                             </div>
                         </div>
                        )}

                         <div className="bg-card p-4 rounded-lg border border-border mb-6">
                            <div className="flex justify-between items-center text-lg font-bold">
                                <span>Total Amount Payable</span>
                                <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span>
                            </div>
                        </div>
                        
                        {isOnlinePaymentFlow ? renderPaymentOptions() : (
                             <div className="space-y-4">
                                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleOnlinePayClick} disabled={isProcessingPayment} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50">
                                     {isProcessingPayment ? <Loader2 className="animate-spin h-10 w-10 text-primary flex-shrink-0"/> : <Landmark size={40} className="text-primary flex-shrink-0"/>}
                                    <div>
                                        <h3 className="text-xl font-bold">Pay Online</h3>
                                        <p className="text-muted-foreground">UPI, Credit/Debit Card, Netbanking</p>
                                    </div>
                                </motion.button>
                                {loading ? (
                                    <div className="w-full p-6 bg-card border-2 border-border rounded-lg animate-pulse h-[116px]"><div className="h-6 bg-muted rounded w-3/4"></div></div>
                                ) : codEnabled ? (
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
                        
                    </motion.div>
                </main>
            </div>
        </>
    );
};


const CheckoutPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>}>
        <CheckoutPageInternal />
    </Suspense>
);

export default CheckoutPage;
