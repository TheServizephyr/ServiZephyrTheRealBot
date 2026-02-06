'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, IndianRupee, CreditCard, Landmark, Split, Users as UsersIcon, QrCode, PlusCircle, Trash2, Home, Building, MapPin, Lock, Loader2, CheckCircle, Share2, Copy, User, Phone, AlertTriangle, RefreshCw } from 'lucide-react';
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
import { v4 as uuidv4 } from 'uuid';
import { fetchWithRetry } from '@/lib/fetchWithRetry';


const ORDER_STATE = {
    IDLE: 'idle',
    CREATING_ORDER: 'creating_order',
    PAYMENT_PROCESSING: 'payment_processing',
    PAYMENT_PENDING: 'payment_pending',
    SUCCESS: 'success',
    ERROR: 'error'
};

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
    const ref = searchParams.get('ref'); // NEW: Guest Ref
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');
    const isPaymentConfirmed = searchParams.get('payment_confirmed');

    // ... (State hooks unchanged) ...
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
    const [activeOrderId, setActiveOrderId] = useState(searchParams.get('activeOrderId'));

    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [selectedOnlinePaymentType, setSelectedOnlinePaymentType] = useState('full'); // 'full' or 'split'
    const [paymentGateway, setPaymentGateway] = useState('razorpay'); // 'razorpay', 'phonepe'
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [orderState, setOrderState] = useState(ORDER_STATE.IDLE);
    const [orderError, setOrderError] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [idempotencyKey, setIdempotencyKey] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [vendorCharges, setVendorCharges] = useState({
        gstEnabled: false, gstRate: 5, gstMinAmount: 0,
        convenienceFeeEnabled: false, convenienceFeeRate: 2.5, convenienceFeePaidBy: 'customer', convenienceFeeLabel: 'Payment Fee',
        packagingChargeEnabled: false, packagingChargeAmount: 0
    });

    const [bundlingOrderDetails, setBundlingOrderDetails] = useState(null);
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);



    // Initialize Idempotency Key (Persist across reloads)
    useEffect(() => {
        try {
            const storedKey = localStorage.getItem('current_order_key');
            if (storedKey) {
                setIdempotencyKey(storedKey);
            } else {
                const newKey = uuidv4();
                localStorage.setItem('current_order_key', newKey);
                setIdempotencyKey(newKey);
            }
        } catch (e) {
            // Fallback for private mode or storage errors
            const newKey = uuidv4();
            setIdempotencyKey(newKey);
        }
    }, []);

    useEffect(() => {
        console.log("[Checkout Page] Component mounting. isUserLoading:", isUserLoading);
        const verifyAndFetch = async () => {
            setLoading(true);

            const isDineIn = !!tableId;
            const isLoggedInUser = !!user;
            // SIMPLIFIED: Ref presence is sufficient - no token validation needed
            const isWhatsAppSession = !!ref;

            const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');

            let derivedDeliveryType = 'delivery';
            if (tableId) {
                derivedDeliveryType = 'dine-in';
            } else {
                derivedDeliveryType = savedCart.deliveryType || 'delivery';
            }

            const deliveryType = derivedDeliveryType;
            const isAnonymousPreOrder = deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;

            console.log(`[Checkout Page] Checks: isDineIn=${isDineIn}, WS=${isWhatsAppSession}, Ref=${!!ref}`);

            if (isDineIn || isLoggedInUser || activeOrderId || isAnonymousPreOrder || isWhatsAppSession) {
                console.log("[Checkout Page] Session validated (Direct).");
                setIsTokenValid(true);
            } else {
                if (!isUserLoading) {
                    setTokenError("No session information found."); setLoading(false); return;
                }
            }

            if (activeOrderId && deliveryType !== 'delivery') {
                setDetailsConfirmed(true);
            } else if (deliveryType === 'street-vendor-pre-order') {
                setDetailsConfirmed(true);
            } else if (deliveryType === 'delivery') {
                setDetailsConfirmed(false);
            } else {
                setDetailsConfirmed(true);
            }

            const phoneToLookup = phoneFromUrl || user?.phoneNumber || '';
            setOrderPhone(phoneToLookup);

            if (!restaurantId) { router.push('/'); return; }
            setError('');

            let updatedData = { ...savedCart, phone: phoneToLookup, token, tableId, dineInTabId: tabId, deliveryType };

            // ... (Dine-in fetch logic lines 299-324 assume unchanged) ...

            // FETCH EXISTING ORDER DATA for dine-in payment (when coming from track page)
            if (tabId && deliveryType === 'dine-in') {
                console.log('[Checkout] Fetching existing dine-in order data for tabId:', tabId);
                try {
                    const orderRes = await fetch(`/api/order/active?tabId=${tabId}`);
                    if (orderRes.ok) {
                        const orderData = await orderRes.json();
                        console.log('[Checkout] Fetched dine-in order:', orderData);
                        const cartItems = orderData.items || [];
                        const totalAmount = orderData.totalAmount || orderData.grandTotal || 0;
                        updatedData = {
                            ...updatedData,
                            cart: cartItems,
                            tab_name: orderData.tab_name || orderData.customerName,
                            subtotal: orderData.subtotal || totalAmount,
                            grandTotal: totalAmount
                        };
                    }
                } catch (err) {
                    console.error('[Checkout] Failed to fetch dine-in order:', err);
                }
            }


            console.log("[Checkout Page] Setting cart data from localStorage:", updatedData);
            setCart(updatedData.cart || []);
            setAppliedCoupons(updatedData.appliedCoupons || []);
            setCartData(updatedData);


            try {
                const customerNameFromStorage = localStorage.getItem('customerName');
                setOrderName(customerNameFromStorage || user?.displayName || savedCart.tab_name || '');

                // LOOKUP USER DETAILS (Supports Cookie-based lookup for GuestID)
                // LOOKUP USER DETAILS (Uid-first via API)
                if (phoneToLookup || ref || user) {
                    const lookupPayload = {};
                    if (phoneToLookup) lookupPayload.phone = phoneToLookup;
                    if (ref) lookupPayload.ref = ref;

                    const headers = { 'Content-Type': 'application/json' };
                    // Add Auth header if user is logged in
                    if (user) {
                        try {
                            const idToken = await user.getIdToken();
                            headers['Authorization'] = `Bearer ${idToken}`;
                        } catch (e) {
                            console.warn("Failed to get ID token for lookup:", e);
                        }
                    }

                    const lookupRes = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(lookupPayload)
                    });

                    if (lookupRes.ok) {
                        const data = await lookupRes.json();
                        setOrderName(prev => prev || data.name || ''); // Fill name from profile if not set
                        if (deliveryType === 'delivery') {
                            setUserAddresses(data.addresses || []);
                            // Auto-select first address if available
                            if (data.addresses?.length > 0 && !selectedAddress) {
                                setSelectedAddress(data.addresses[0]);
                            }
                        }
                    } else if (lookupRes.status === 404) {
                        console.log("Customer profile not found (might be new).");
                    }
                }

                // ... (Payment settings fetch unchanged) ...
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
                        setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                        setOnlinePaymentEnabled(paymentData.dineInOnlinePaymentEnabled);
                    }
                    setVendorCharges({
                        gstEnabled: paymentData.gstEnabled || false,
                        gstRate: paymentData.gstPercentage || paymentData.gstRate || 0,
                        gstMinAmount: paymentData.gstMinAmount || 0,
                        convenienceFeeEnabled: paymentData.convenienceFeeEnabled || false,
                        convenienceFeeRate: paymentData.convenienceFeeRate || 2.5,
                        convenienceFeePaidBy: paymentData.convenienceFeePaidBy || 'customer',
                        convenienceFeeLabel: paymentData.convenienceFeeLabel || 'Payment Processing Fee',
                        packagingChargeEnabled: paymentData.packagingChargeEnabled || false,
                        packagingChargeAmount: paymentData.packagingChargeAmount || 0,
                    });
                }

                if (deliveryType === 'delivery' && !activeOrderId) {
                    // setDetailsConfirmed(false); // FIXED: Removed to prevent resetting Step 2 -> Step 1 on re-renders
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
    }, [restaurantId, phoneFromUrl, token, ref, tableId, tabId, user, isUserLoading, router, isPaymentConfirmed, activeOrderId, isTokenValid]); // Added isTokenValid to dep array for Ref flow


    // ... (Bundling logic unchanged) ...

    const deliveryType = useMemo(() => {
        if (tableId) return 'dine-in';
        return cartData?.deliveryType || 'delivery';
    }, [tableId, cartData]);

    const diningPreference = cartData?.diningPreference || 'dine-in';

    const handleAddNewAddress = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('returnUrl', window.location.href);
        // Ensure Ref is preserved strings
        router.push(`/add-address?${params.toString()}`);
    };

    // ... (Price calculation unchanged) ...
    const { subtotal, totalDiscount, finalDeliveryCharge, cgst, sgst, convenienceFee, grandTotal, packagingCharge, isSmartBundlingEligible } = useMemo(() => {
        // ... (Same logic as before) ...
        // Re-implementing logic to ensure no regression as I replaced a huge chunk
        const currentSubtotal = cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0);
        if (!cartData) return { subtotal: currentSubtotal, totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, convenienceFee: 0, grandTotal: currentSubtotal, packagingCharge: 0, isSmartBundlingEligible: false };

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

        // (End of appliedCoupons loop)


        // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
        /*
        // SMART BUNDLING CHECK (Checkout Phase)
        let isSmartBundlingEligible = false;
        if (bundlingOrderDetails && bundlingOrderDetails.createdAt && selectedAddress) {
            // 1. Check Time (10 mins)
            let createdAtDate = bundlingOrderDetails.createdAt;
            if (typeof createdAtDate === 'string') createdAtDate = new Date(createdAtDate);
            if (createdAtDate && createdAtDate.seconds) createdAtDate = new Date(createdAtDate.seconds * 1000);

            const now = new Date();
            const diffMinutes = (now - createdAtDate) / (1000 * 60);

            // 2. Check Status
            const status = bundlingOrderDetails.status;
            const isStatusEligible = !['out_for_delivery', 'delivered', 'cancelled', 'rejected'].includes(status);

            // 3. Check Address (CRITICAL: Must match)
            let addressMatch = false;

            // 1. Strict ID Match
            if (selectedAddress.id && bundlingOrderDetails.customerAddress?.id === selectedAddress.id) {
                addressMatch = true;
            }
            // 2. Fallback: Content Match (if distinct objects but same location)
            else if (selectedAddress && bundlingOrderDetails.customerAddress) {
                const addr1 = bundlingOrderDetails.customerAddress;
                const addr2 = selectedAddress;

                const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

                console.log("[Bundling Check] Addr1 (Active):", addr1);
                console.log("[Bundling Check] Addr2 (Selected):", addr2);
                console.log(`[Bundling Check] Comparing: '${clean(addr1.addressLine1)}' vs '${clean(addr2.addressLine1)}'`);

                // Helper to extract a comparable string from an address (string or object)
                const getAddrString = (addr) => {
                    if (!addr) return '';
                    // Case A: Address is already a string
                    if (typeof addr === 'string') return addr.trim().toLowerCase().replace(/\s+/g, ' ');

                    // Case B: Address is an object - try specific keys
                    const keys = ['full', 'addressLine1', 'street', 'line1', 'address'];
                    for (const k of keys) {
                        if (addr[k] && String(addr[k]).trim().length > 0) return String(addr[k]).trim().toLowerCase().replace(/\s+/g, ' ');
                    }

                    // Case C: Construct from components if no full string
                    const parts = [addr.addressLine1, addr.street, addr.city, addr.zipCode, addr.postcode].filter(Boolean);
                    if (parts.length > 0) return parts.join(' ').trim().toLowerCase().replace(/\s+/g, ' ');

                    return '';
                };

                const str1 = getAddrString(addr1);
                const str2 = getAddrString(addr2);

                console.log(`[Bundling Check] Match Validated? '${str1}' === '${str2}'`);

                // CRITICAL: Only match if strings are non-empty and identical
                if (str1 && str2 && str1 === str2) {
                    addressMatch = true;
                }
                // Check Full String address if available
                else if (clean(addr1.full) === clean(addr2.full) && clean(addr1.full).length > 10) {
                    addressMatch = true;
                }
            }

            if (diffMinutes <= 10 && isStatusEligible && addressMatch) {
                isSmartBundlingEligible = true;
            }
        }
        */
        const isSmartBundlingEligible = false; // Bundling disabled
        // ========== END BUNDLING FEATURE ==========

        // ========== BUNDLING FEATURE: Removed isSmartBundlingEligible from condition ==========
        const deliveryCharge = (isStreetVendor || deliveryType !== 'delivery' || isDeliveryFree || activeOrderId) ? 0 : (cartData.deliveryCharge || 0);
        const tip = (isStreetVendor || deliveryType !== 'delivery' || activeOrderId) ? 0 : (cartData.tipAmount || 0);
        const taxableAmount = currentSubtotal - couponDiscountValue;

        let cgstAmount = 0;
        let sgstAmount = 0;
        if (vendorCharges?.gstEnabled && taxableAmount > 0) {
            if (taxableAmount >= (vendorCharges.gstMinAmount || 0)) {
                const totalGstRate = vendorCharges.gstRate || 5;
                const halfGstRate = totalGstRate / 2;
                cgstAmount = taxableAmount * (halfGstRate / 100);
                sgstAmount = taxableAmount * (halfGstRate / 100);
            }
        }
        const packagingCharge = (diningPreference === 'takeaway' && vendorCharges?.packagingChargeEnabled) ? (vendorCharges.packagingChargeAmount || 0) : 0;
        const subtotalWithTaxAndCharges = taxableAmount + deliveryCharge + cgstAmount + sgstAmount + tip + packagingCharge;

        let calculatedConvenienceFee = 0;
        if (selectedPaymentMethod === 'online' && vendorCharges?.convenienceFeeEnabled) {
            if (vendorCharges.convenienceFeePaidBy === 'customer') {
                const feeRate = vendorCharges.convenienceFeeRate || 2.5;
                calculatedConvenienceFee = parseFloat((subtotalWithTaxAndCharges * (feeRate / 100)).toFixed(2));
            }
        }

        const finalGrandTotal = subtotalWithTaxAndCharges + calculatedConvenienceFee;
        return {
            subtotal: currentSubtotal,
            totalDiscount: couponDiscountValue,
            finalDeliveryCharge: deliveryCharge,
            cgst: cgstAmount,
            sgst: sgstAmount,
            convenienceFee: calculatedConvenienceFee,
            grandTotal: finalGrandTotal,
            packagingCharge,
            isSmartBundlingEligible
        };
    }, [cart, cartData, appliedCoupons, deliveryType, selectedPaymentMethod, vendorCharges, activeOrderId, diningPreference, bundlingOrderDetails, selectedAddress]);

    const fullOrderDetailsForSplit = useMemo(() => ({
        restaurantId,
        grandTotal,
        items: cart,
        tableId,
        tabId,
        activeOrderId
    }), [restaurantId, grandTotal, cart, tableId, tabId, activeOrderId]);

    const handleAddMoreToTab = () => {
        const params = new URLSearchParams({
            restaurantId,
            phone: phoneFromUrl || '',
            token: token || '',
            table: tableId,
            tabId: cartData.dineInTabId
        });
        if (ref) params.set('ref', ref); // Pass Ref
        router.push(`/order/${restaurantId}?${params.toString()}`);
    };


    const handleViewBill = () => {
        setDineInModalOpen(false);
        setDetailsConfirmed(true);
        setIsOnlinePaymentFlow(true);
    };


    const placeOrder = async (paymentMethod) => {
        // If PhonePe is selected for online payment, use 'phonepe' as payment method
        const effectivePaymentMethod = (paymentMethod === 'online' && paymentGateway === 'phonepe') ? 'phonepe' : paymentMethod;
        console.log(`[Checkout Page] placeOrder called with paymentMethod: ${paymentMethod}, effective: ${effectivePaymentMethod}`);
        if (!validateOrderDetails()) return;

        console.log('[DEBUG] idempotencyKey state:', idempotencyKey);
        console.log('[DEBUG] tabId:', tabId);
        console.log('[DEBUG] deliveryType:', deliveryType);

        const orderData = {
            idempotencyKey,
            name: orderName || selectedAddress?.name || '',
            phone: orderPhone || selectedAddress?.phone || '',
            restaurantId,
            items: cart,
            notes: cartData.notes,
            coupon: appliedCoupons.find(c => !c.customerId) || null,
            loyaltyDiscount: 0, subtotal, cgst, sgst, deliveryCharge: finalDeliveryCharge, grandTotal, paymentMethod: effectivePaymentMethod,
            deliveryType: deliveryType, pickupTime: cartData.pickupTime || '', tipAmount: cartData.tipAmount || 0,
            businessType: cartData.businessType || 'restaurant',
            tableId: (deliveryType === 'dine-in') ? (tableId || cartData.tableId) : null,
            dineInTabId: (deliveryType === 'dine-in') ? (tabId || cartData.dineInTabId) : null,
            pax_count: cartData.pax_count || null, tab_name: cartData.tab_name || null, address: selectedAddress,
            // Pass Guest Identity
            guestRef: ref || null, // Pass the obfuscated ref if available
            guestToken: token || null, // Pass the token (can be used to validate ref)

            existingOrderId: activeOrderId || undefined,
            diningPreference: diningPreference,
            packagingCharge: packagingCharge,
        };

        setOrderState(ORDER_STATE.CREATING_ORDER); // New state machine
        setIsProcessingPayment(true);
        setError('');
        setOrderError(''); // Clear previous errors

        try {
            // DINE-IN POST-PAID SETTLEMENT: Use settlement API for existing orders
            if (tabId && deliveryType === 'dine-in') {
                console.log(`[Checkout Page] POST-PAID SETTLEMENT for tabId: ${tabId}`);

                // ... (Settlement logic remains largely same, just check redirects) ...
                // Note: Settlement API might need update too, but let's assume it keeps using tabId mainly.

                // ✅ Using new dine-in settlement endpoint
                const settlementEndpoint = '/api/dine-in/initiate-payment';
                const settlementData = {
                    idempotencyKey,
                    tabId,
                    restaurantId,
                    paymentMethod: effectivePaymentMethod,
                    grandTotal
                };

                console.log(`[Checkout] Settlement endpoint: ${settlementEndpoint}`);

                const res = await fetch(settlementEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settlementData)
                });
                const data = await res.json();
                console.log("[Checkout Page] Settlement API response:", data);
                if (!res.ok) throw new Error(data.message || "Failed to settle payment.");

                // Handle PhonePe Redirect
                if (data.url && (data.method === 'phonepe' || effectivePaymentMethod === 'phonepe')) {
                    console.log("[Checkout] Redirecting to PhonePe:", data.url);
                    window.location.href = data.url;
                    return;
                }

                // Handle Split Bill
                if (data.method === 'split_bill' || effectivePaymentMethod === 'split_bill') {
                    console.log("[Checkout] Split bill approved, returning data for UI");
                    setIsProcessingPayment(false);
                    return data;
                }

                // Handle Razorpay for online payment
                if (data.razorpay_order_id) {
                    console.log("[Checkout] Opening Razorpay for settlement");

                    // Save for recovery if page refreshes
                    setOrderState(ORDER_STATE.PAYMENT_PROCESSING);
                    localStorage.setItem('payment_pending_order', tabId);
                    localStorage.setItem('payment_pending_token', token || '');

                    const options = {
                        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_live_m9PZ4ZL5ItHp9j',
                        amount: grandTotal * 100,
                        currency: "INR",
                        name: cartData.restaurantName || 'Restaurant',
                        description: `Bill Settlement - Table ${tableId} `,
                        order_id: data.razorpay_order_id,
                        handler: async function (response) {
                            console.log("[Checkout Page] Razorpay payment successful:", response);

                            setOrderState(ORDER_STATE.PAYMENT_PENDING);

                            // Redirect to pending screen for webhook confirmation
                            const pendingOrder = localStorage.getItem('payment_pending_order');
                            const pendingToken = localStorage.getItem('payment_pending_token');

                            if (pendingOrder && pendingToken) {
                                router.push(`/track/pending/${pendingOrder}?token=${pendingToken}`);
                            } else {
                                // Fallback to direct tracking
                                // Ensure Ref is passed if available
                                const params = new URLSearchParams({
                                    token: token || '',
                                    paid: 'counter'
                                });
                                if (ref) params.set('ref', ref);
                                if (phoneFromUrl) params.set('phone', phoneFromUrl); // Legacy support

                                // Actually, for Dine-In, we usually redirect to track/dine-in/[tabId]
                                // So we construct URL:
                                router.push(`/track/dine-in/${tabId}?${params.toString()}`);
                            }
                        },
                        prefill: { name: orderName, phone: orderPhone },
                        modal: {
                            ondismiss: function () {
                                console.log("[Checkout] Razorpay dismissed");
                                setIsProcessingPayment(false);
                            }
                        }
                    };
                    const rzp = new window.Razorpay(options);
                    rzp.on('payment.failed', function (response) {
                        console.error("[Checkout] Razorpay payment failed:", response);
                        setIsProcessingPayment(false);
                        setError('Payment failed: ' + response.error.description);
                    });
                    rzp.open();
                    return;
                }

                // Pay at Counter - redirect to track
                const params = new URLSearchParams({
                    token: token || '',
                    paid: 'counter'
                });
                if (ref) params.set('ref', ref);
                if (phoneFromUrl) params.set('phone', phoneFromUrl);
                router.push(`/track/dine-in/${tabId}?${params.toString()}`);
                return;
            }

            // NEW ORDER CREATION (original flow)
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

            // Handle PhonePe Payment
            // ... (Continues below, just updating options) ...

            if (paymentGateway === 'phonepe' && selectedOnlinePaymentType === 'full') {
                console.log("[Checkout Page] Initiating PhonePe payment...");
                try {
                    const phonePeRes = await fetch('/api/payment/phonepe/initiate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            amount: grandTotal,
                            orderId: data.firestore_order_id,
                            customerPhone: orderPhone
                        })
                    });
                    const phonePeData = await phonePeRes.json();

                    if (phonePeData.success && phonePeData.url) {
                        console.log("[Checkout Page] Opening PhonePe PayPage in IFrame:", phonePeData.url);

                        // Use PhonePe Checkout SDK to open payment in IFrame
                        if (window.PhonePeCheckout && window.PhonePeCheckout.transact) {
                            window.PhonePeCheckout.transact({
                                tokenUrl: phonePeData.url,
                                type: "IFRAME",
                                callback: (response) => {
                                    console.log("[Checkout Page] PhonePe callback:", response);
                                    if (response === 'USER_CANCEL') {
                                        setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You cancelled the payment. Please try again.' });
                                        setIsProcessingPayment(false);
                                    } else if (response === 'CONCLUDED') {
                                        // Payment completed, redirect to order placed page (same as Razorpay)
                                        console.log("[Checkout Page] PhonePe payment concluded, redirecting to order placed page");
                                        localStorage.removeItem(`cart_${restaurantId}`);
                                        localStorage.removeItem('current_order_key');

                                        // SAVE ACTIVE ORDER FOR TRACKING (ARRAY SUPPORT)
                                        if (typeof window !== 'undefined') {
                                            const storageKey = `liveOrder_${restaurantId}`;
                                            let existingData = [];
                                            try {
                                                const raw = localStorage.getItem(storageKey);
                                                if (raw) {
                                                    const parsed = JSON.parse(raw);
                                                    existingData = Array.isArray(parsed) ? parsed : [parsed];
                                                }
                                            } catch (e) {
                                                console.error("Error parsing live orders", e);
                                                existingData = [];
                                            }

                                            const newOrder = {
                                                orderId: data.firestore_order_id,
                                                trackingToken: data.token,
                                                restaurantId: restaurantId,
                                                status: 'placed',
                                                timestamp: Date.now()
                                            };

                                            // Add new order and ensure uniqueness
                                            const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                                            localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                                        }

                                        router.push(`/order/placed?orderId=${data.firestore_order_id}&token=${data.token}&restaurantId=${restaurantId}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}`);
                                    }
                                }
                            });
                        } else {
                            // Fallback to redirect mode if SDK not loaded
                            console.warn("[Checkout Page] PhonePe SDK not loaded, using redirect mode");
                            window.location.href = phonePeData.url;
                        }
                        return;
                    } else {
                        throw new Error(phonePeData.error || "PhonePe initiation failed");
                    }
                } catch (err) {
                    console.error("[Checkout Page] PhonePe Error:", err);
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: 'Could not initiate PhonePe payment. Try Razorpay.' });
                    setIsProcessingPayment(false);
                    return;
                }
            }

            // Handle Razorpay Payment (Default fallback or if selected)
            if (data.razorpay_order_id) {
                console.log("[Checkout Page] Razorpay order ID found. Opening payment gateway.");
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amount: grandTotal * 100, currency: "INR", name: cartData.restaurantName,
                    description: `Order from ${cartData.restaurantName}`, order_id: data.razorpay_order_id,
                    handler: async (response) => {
                        console.log(`[Checkout Page] Razorpay payment successful:`, response);
                        localStorage.removeItem(`cart_${restaurantId}`);

                        // SAVE ACTIVE ORDER FOR TRACKING (ARRAY SUPPORT)
                        if (typeof window !== 'undefined') {
                            const storageKey = `liveOrder_${restaurantId}`;
                            let existingData = [];
                            try {
                                const raw = localStorage.getItem(storageKey);
                                if (raw) {
                                    const parsed = JSON.parse(raw);
                                    existingData = Array.isArray(parsed) ? parsed : [parsed];
                                }
                            } catch (e) {
                                console.error("Error parsing live orders", e);
                                existingData = [];
                            }

                            const newOrder = {
                                orderId: data.firestore_order_id,
                                trackingToken: data.token,
                                restaurantId: restaurantId,
                                status: 'placed',
                                timestamp: Date.now()
                            };

                            // Add new order and ensure uniqueness
                            const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                            localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                        }

                        // FIXED: Use central router for all flows
                        // FIXED: Use central router for all flows
                        const phoneParam = phoneFromUrl ? `&phone=${phoneFromUrl}` : '';
                        const refParam = ref ? `&ref=${ref}` : ''; // Checked ref scope
                        const trackingUrl = (orderData.deliveryType === 'dine-in' && !!tableId)
                            ? `/track/dine-in/${data.firestore_order_id}?token=${data.token}${phoneParam}${refParam}`
                            : `/track/${data.firestore_order_id}?token=${data.token}${phoneParam}${refParam}`;
                        router.replace(trackingUrl);
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

                // ✅ CRITICAL: Use NEW order ID from response (not activeOrderId!)
                // For street vendors, even if activeOrderId exists, NEW order was created
                const finalOrderId = data.order_id || data.firestore_order_id;

                if (finalOrderId) {
                    localStorage.removeItem(`cart_${restaurantId}`);
                    localStorage.removeItem('current_order_key');
                    console.log(`[Idempotency] Key cleared after successful order creation`);

                    // ✅ Route to NEW order (not old activeOrderId!)
                    const trackingPath = cartData.businessType === 'street-vendor' ? 'pre-order' : 'delivery';
                    const redirectUrl = `/track/${trackingPath}/${finalOrderId}?token=${data.token}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}${ref ? `&ref=${ref}` : ''}`;

                    // SAVE ACTIVE ORDER FOR TRACKING BUTTON (ARRAY SUPPORT)
                    if (typeof window !== 'undefined') {
                        const storageKey = `liveOrder_${restaurantId}`;
                        let existingData = [];
                        try {
                            const raw = localStorage.getItem(storageKey);
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                existingData = Array.isArray(parsed) ? parsed : [parsed];
                            }
                        } catch (e) {
                            console.error("Error parsing live orders", e);
                            existingData = [];
                        }

                        const newOrder = {
                            orderId: finalOrderId,
                            trackingToken: data.token,
                            restaurantId: restaurantId,
                            deliveryType: deliveryType,
                            status: 'placed',
                            timestamp: Date.now()
                        };

                        // Add new order and ensure uniqueness
                        const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                        localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                        console.log(`[Checkout] Saved liveOrder to storage (Array):`, updatedOrders);
                    }

                    console.log(`[Checkout] Redirecting to NEW order: ${finalOrderId}`);
                    router.replace(redirectUrl); // CHANGED: Replaced push with replace to skip checkout on back
                    return;
                }

                localStorage.removeItem(`cart_${restaurantId}`);
                localStorage.removeItem('current_order_key'); // ← Clear idempotency key
                console.log('[Idempotency] Key cleared after successful order creation');

                if (orderData.deliveryType === 'dine-in') {
                    setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab settled at counter. Thank you!' });
                    setTimeout(() => {
                        const newUrl = `/order/${restaurantId}?table=${tableId}&tabId=${data.dine_in_tab_id || tabId}`;
                        router.replace(newUrl);
                    }, 2000);
                } else {
                    // Direct routing based on business type
                    const trackingPath = cartData.businessType === 'street-vendor' ? 'pre-order' : 'delivery';
                    router.replace(`/track/${trackingPath}/${data.firestore_order_id}?token=${data.token}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}${ref ? `&ref=${ref}` : ''}`);
                }
            }
        } catch (err) {
            console.error("[Checkout Page] placeOrder function error:", err);

            // Set ORDER_STATE.ERROR for proper UI handling
            setOrderState(ORDER_STATE.ERROR);
            setIsProcessingPayment(false);

            // Human-friendly error messages (no technical jargon)
            let friendlyError = 'Something went wrong. Please try again.';

            if (err.message.includes('network') || err.message.includes('fetch')) {
                friendlyError = 'Connection issue. Please check your internet and try again.';
            } else if (err.message.includes('429') || err.message.toLowerCase().includes('too many requests')) {
                friendlyError = 'Restaurant is busy right now. Please wait a minute and try again.';
            } else if (err.message.includes('400') || err.message.includes('invalid')) {
                friendlyError = 'Invalid order details. Please check and try again.';
            } else if (err.message.includes('timeout')) {
                friendlyError = 'Request timed out. Please try again.';
            } else if (err.message) {
                // Use backend error if it's user-friendly
                const isUserFriendly = !err.message.match(/[A-Z_]{3,}/) && err.message.length < 100;
                friendlyError = isUserFriendly ? err.message : friendlyError;
            }

            setError(friendlyError);
            setOrderError(friendlyError);
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



    const renderPaymentOptions = () => {
        if (isSplitBillActive) {
            return <SplitBillInterface totalAmount={grandTotal} onBack={() => setIsSplitBillActive(false)} orderDetails={fullOrderDetailsForSplit} onPlaceOrder={placeOrder} />
        }

        return (
            <div className="space-y-4">
                {isOnlinePaymentFlow && <Button onClick={() => setIsOnlinePaymentFlow(false)} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>}

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => placeOrder('online')}
                    disabled={
                        orderState === ORDER_STATE.CREATING_ORDER ||
                        orderState === ORDER_STATE.PAYMENT_PROCESSING ||
                        orderState === ORDER_STATE.PAYMENT_PENDING ||
                        isProcessingPayment
                    }
                    className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {(isProcessingPayment || orderState !== ORDER_STATE.IDLE) && <Loader2 className="animate-spin h-5 w-5" />}
                    {(!isProcessingPayment && orderState === ORDER_STATE.IDLE) && <CreditCard size={40} className="text-primary flex-shrink-0" />}
                    <div>
                        <h3 className="text-xl font-bold">
                            {orderState === ORDER_STATE.CREATING_ORDER
                                ? 'Processing Order...'
                                : orderState === ORDER_STATE.PAYMENT_PROCESSING
                                    ? 'Opening Payment...'
                                    : orderState === ORDER_STATE.PAYMENT_PENDING
                                        ? 'Confirming Payment...'
                                        : 'Pay Full Bill'
                            }
                        </h3>
                        <p className="text-muted-foreground">
                            {orderState === ORDER_STATE.IDLE
                                ? 'Use UPI, Card, or Netbanking'
                                : 'Please wait...'
                            }
                        </p>
                    </div>
                </motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsSplitBillActive(true)} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all">
                    <Split size={40} className="text-primary flex-shrink-0" />
                    <div>
                        <h3 className="text-xl font-bold">Split The Bill</h3>
                        <p className="text-muted-foreground">Split equally with your friends.</p>
                    </div>
                </motion.button>

                {/* ERROR STATE WITH RETRY BUTTON */}
                {orderState === ORDER_STATE.ERROR && orderError && (
                    <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
                        <div className="flex items-start gap-3 mb-3">
                            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-red-600 dark:text-red-400">Payment Failed</p>
                                <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">{orderError}</p>
                            </div>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                                setOrderState(ORDER_STATE.IDLE);
                                setOrderError('');
                                placeOrder('online'); // Retry with same idempotency key
                            }}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <RefreshCw size={16} />
                            Try Again ({retryCount}/3)
                        </motion.button>
                    </div>
                )}

                {/* Refund & Cancellation Policy */}
                <div className="mt-6 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                    <p className="text-xs font-semibold text-yellow-400 mb-2">⚠️ Refund & Cancellation Policy</p>
                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                        <li><span className="font-semibold">Vendor Discretion:</span> Refunds are processed at the vendor's sole discretion based on the cancellation reason.</li>
                        <li><span className="font-semibold">Fake/Fraudulent Orders:</span> Orders placed with wrong details, duplicate orders, or customer-initiated cancellations may not be eligible for refund.</li>
                        <li><span className="font-semibold">Processing Time:</span> Approved refunds take 5-7 business days to reflect in your account.</li>
                        <li><span className="font-semibold">ServiZephyr's Role:</span> We facilitate the transaction but do not interfere in refund decisions. Please contact the vendor directly for refund concerns.</li>
                    </ul>
                </div>
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

    // BLOCK NEW ORDERS for post-paid, but ALLOW PAYMENT for existing orders
    if (deliveryType === 'dine-in' && cartData?.dineInModel === 'post-paid' && cart.length > 0 && !tabId) {
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
            <Script src="https://mercury.phonepe.com/web/bundle/checkout.js" />
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
                        <Button variant="ghost" size="icon" onClick={() => {
                            // Preserve all params when going back
                            const params = new URLSearchParams(searchParams.toString());
                            router.push(`/cart?${params.toString()}`);
                        }} className="h-10 w-10"><ArrowLeft /></Button>
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
                                        {/* DELIVERY CHARGE ROW */}
                                        {((finalDeliveryCharge > 0) || (deliveryType === 'delivery' && activeOrderId) || isSmartBundlingEligible) && (
                                            <div className="flex justify-between text-sm">
                                                <span>Delivery Fee</span>
                                                <span className={finalDeliveryCharge === 0 ? "text-green-600 font-bold" : ""}>
                                                    {finalDeliveryCharge === 0 ? "FREE (Bundled)" : `₹${finalDeliveryCharge.toFixed(2)}`}
                                                </span>
                                            </div>
                                        )}
                                        {cgst > 0 && (
                                            <>
                                                <div className="flex justify-between text-sm">
                                                    <span>CGST ({vendorCharges?.gstEnabled ? (vendorCharges.gstRate / 2) : 2.5}%)</span>
                                                    <span>₹{cgst.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span>SGST ({vendorCharges?.gstEnabled ? (vendorCharges.gstRate / 2) : 2.5}%)</span>
                                                    <span>₹{sgst.toFixed(2)}</span>
                                                </div>
                                            </>
                                        )}

                                        {packagingCharge > 0 && (
                                            <div className="flex justify-between text-sm text-primary">
                                                <span>Packaging Charges</span>
                                                <span>₹{packagingCharge.toFixed(2)}</span>
                                            </div>
                                        )}
                                        <div className="border-t border-dashed pt-2 mt-2" />
                                        <div className="flex justify-between text-sm">
                                            <span>Order Total</span>
                                            <span className="font-semibold">₹{(subtotal + finalDeliveryCharge + cgst + sgst + packagingCharge).toFixed(2)}</span>
                                        </div>
                                        {convenienceFee > 0 && (
                                            <>
                                                <div className="flex justify-between text-sm text-orange-600">
                                                    <span>{vendorCharges?.convenienceFeeLabel || 'Payment Processing Fee'} ({vendorCharges?.convenienceFeeRate || 2.5}%)</span>
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
                                                {selectedPaymentMethod === 'online' && convenienceFee > 0 && (
                                                    <div className="ml-11 mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-xs text-orange-700 dark:text-orange-400">
                                                        ⚠️ +₹{convenienceFee.toFixed(2)} {vendorCharges?.convenienceFeeLabel?.toLowerCase() || 'payment processing fee'} will be added
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

                                                        {/* Payment Gateway Selection - Razorpay and PhonePe */}
                                                        {selectedOnlinePaymentType === 'full' && (
                                                            <div className="mt-2 p-3 bg-muted/50 rounded border border-border/50">
                                                                <p className="text-xs text-muted-foreground mb-2">Select Payment Gateway:</p>
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setPaymentGateway('razorpay');
                                                                        }}
                                                                        className={cn(
                                                                            "flex-1 px-3 py-2 text-sm font-medium rounded border transition-all",
                                                                            paymentGateway === 'razorpay'
                                                                                ? "bg-primary text-primary-foreground border-primary"
                                                                                : "bg-background border-border hover:border-primary/50"
                                                                        )}
                                                                    >
                                                                        Razorpay
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setPaymentGateway('phonepe');
                                                                        }}
                                                                        className={cn(
                                                                            "flex-1 px-3 py-2 text-sm font-medium rounded border transition-all",
                                                                            paymentGateway === 'phonepe'
                                                                                ? "bg-[#5f259f] text-white border-[#5f259f]"
                                                                                : "bg-background border-border hover:border-[#5f259f]/50"
                                                                        )}
                                                                    >
                                                                        PhonePe
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}


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

                                {/* Refund & Cancellation Policy */}
                                <div className="mt-4 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                                    <p className="text-xs font-semibold text-yellow-400 mb-2">⚠️ Refund & Cancellation Policy</p>
                                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                                        <li><span className="font-semibold">Vendor Discretion:</span> Refunds are processed at the vendor's sole discretion based on the cancellation reason.</li>
                                        <li><span className="font-semibold">Fake/Fraudulent Orders:</span> Orders placed with wrong details, duplicate orders, or customer-initiated cancellations may not be eligible for refund.</li>
                                        <li><span className="font-semibold">Processing Time:</span> Approved refunds take 5-7 business days to reflect in your account.</li>
                                        <li><span className="font-semibold">ServiZephyr's Role:</span> We facilitate the transaction but do not interfere in refund decisions. Please contact the vendor directly for refund concerns.</li>
                                    </ul>
                                </div>

                                {/* CUSTOMER DETAILS - Show ONLY for dine-in and pre-order flows */}
                                {/* Delivery flow collects details in address form, so we skip this */}
                                {selectedPaymentMethod && !activeOrderId &&
                                    (deliveryType === 'dine-in' || deliveryType === 'street-vendor-pre-order') && (
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
                                            disabled={isProcessingPayment || (!activeOrderId && (deliveryType === 'delivery' ? !selectedAddress : (!orderName.trim() || (selectedPaymentMethod === 'counter' && !orderPhone.trim()))))}
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
                                                disabled={isProcessingPayment || (!activeOrderId && (deliveryType === 'delivery' ? !selectedAddress : !orderName.trim()))}
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
