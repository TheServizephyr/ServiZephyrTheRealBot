
'use client';

import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, ShoppingCart, CookingPot, Ticket, Gift, ArrowLeft, Sparkles, Check, PlusCircle, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, Bike, Store, Heart, Wallet, Clock, ChevronUp, Edit2, Lock, Loader2, Navigation, BookOpen, ArrowRight, AlertTriangle, ShoppingBag } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import InfoDialog from '@/components/InfoDialog';
import { format, setHours, setMinutes, getHours, getMinutes, addMinutes } from 'date-fns';
import { useUser } from '@/firebase';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { v4 as uuidv4 } from 'uuid';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ORDER_STATE = {
    IDLE: 'idle',
    CREATING_ORDER: 'creating_order',
    SUCCESS: 'success',
    ERROR: 'error'
};


const ClearCartDialog = ({ isOpen, onClose, onConfirm }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl flex items-center gap-2"><Trash2 className="text-destructive" /> Clear Cart?</DialogTitle>
                    <DialogDescription>Are you sure you want to remove all items from your cart? This action cannot be undone.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button variant="destructive" onClick={onConfirm}>Yes, Clear It</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const PickupTimeModal = ({ isOpen, onClose, onConfirm, pickupTime, setPickupTime }) => {
    const timeOptions = ["In 15 mins", "In 30 mins", "In 45 mins"];
    const [showCustomTimePicker, setShowCustomTimePicker] = useState(false);
    const [customHour, setCustomHour] = useState(null);
    const [customMinute, setCustomMinute] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setShowCustomTimePicker(false);
            setCustomHour(null);
            setCustomMinute(null);
        }
    }, [isOpen]);

    const handleQuickSelect = (time) => {
        setPickupTime(time);
        setShowCustomTimePicker(false);
    };

    const handleCustomClick = () => {
        const now = new Date();
        const initialTime = addMinutes(now, 15);
        setCustomHour(getHours(initialTime));
        setCustomMinute(Math.ceil(getMinutes(initialTime) / 15) * 15 % 60);
        setPickupTime(''); // Clear quick selection
        setShowCustomTimePicker(true);
    };

    useEffect(() => {
        if (customHour !== null && customMinute !== null) {
            const date = setHours(setMinutes(new Date(), customMinute), customHour);
            setPickupTime(format(date, 'p'));
        }
    }, [customHour, customMinute, setPickupTime]);

    const renderTimePicker = () => {
        return (
            <div className="flex justify-center gap-4 mt-4">
                <div className="flex flex-col items-center">
                    <Button variant="ghost" size="icon" onClick={() => setCustomHour(prev => (prev === 0 ? 23 : (prev || 1) - 1))}><ChevronUp /></Button>
                    <span className="text-4xl font-bold w-20 text-center">{customHour !== null ? String(customHour % 12 === 0 ? 12 : customHour % 12).padStart(2, '0') : '--'}</span>
                    <Button variant="ghost" size="icon" onClick={() => setCustomHour(prev => ((prev || 0) + 1) % 24)}><ChevronDown /></Button>
                </div>
                <span className="text-4xl font-bold">:</span>
                <div className="flex flex-col items-center">
                    <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 45) % 60)}><ChevronUp /></Button>
                    <span className="text-4xl font-bold w-20 text-center">{customMinute !== null ? String(customMinute).padStart(2, '0') : '--'}</span>
                    <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 15) % 60)}><ChevronDown /></Button>
                </div>
                <div className="flex flex-col items-center justify-center text-2xl font-semibold">
                    <span>{customHour !== null && customHour >= 12 ? 'PM' : 'AM'}</span>
                </div>
            </div>
        )
    };


    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Confirm Pickup Time</DialogTitle>
                    <DialogDescription>Let the restaurant know when you'll be arriving so they can prepare your order accordingly.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {timeOptions.map(time => (
                            <button
                                key={time}
                                onClick={() => handleQuickSelect(time)}
                                className={cn(
                                    "p-4 rounded-lg border-2 font-semibold transition-all h-20",
                                    pickupTime === time ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                                )}
                            >
                                {time}
                            </button>
                        ))}
                        <button
                            onClick={handleCustomClick}
                            className={cn(
                                "p-4 rounded-lg border-2 font-semibold transition-all h-20 flex flex-col items-center justify-center",
                                showCustomTimePicker ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                            )}
                        >
                            <Clock size={20} className="mb-1" />
                            Custom
                        </button>
                    </div>

                    <AnimatePresence>
                        {showCustomTimePicker && (
                            <motion.div
                                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                                animate={{ height: 'auto', opacity: 1, marginTop: '1rem' }}
                                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="border-t border-border pt-4">
                                    <p className="text-center font-semibold text-muted-foreground">Select a time:</p>
                                    {renderTimePicker()}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button onClick={onConfirm} disabled={!pickupTime.trim()}>Confirm Time</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);


const CartPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isUserLoading } = useUser();

    const restaurantId = searchParams.get('restaurantId');

    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');

    const [cartData, setCartData] = useState(null);
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [isClearCartDialogOpen, setIsClearCartDialogOpen] = useState(false);
    const [isBillExpanded, setIsBillExpanded] = useState(false);
    const [tipAmount, setTipAmount] = useState(0);
    const [isCouponPopoverOpen, setCouponPopoverOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isPickupTimeModalOpen, setIsPickupTimeModalOpen] = useState(false);
    const [pickupTime, setPickupTime] = useState('');
    const [isCheckoutFlow, setIsCheckoutFlow] = useState(false);
    const [loadingPage, setLoadingPage] = useState(true);

    // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
    // const activeOrderId = searchParams.get('activeOrderId') || searchParams.get('bundlingRef');
    const activeOrderId = null; // Bundling disabled
    // ========== END BUNDLING FEATURE ==========
    const [liveOrder, setLiveOrder] = useState(null);

    const [outOfStockItems, setOutOfStockItems] = useState([]);
    const [diningPreference, setDiningPreference] = useState(null);
    const [packagingConfig, setPackagingConfig] = useState({ enabled: false, amount: 0 });
    const [orderState, setOrderState] = useState(ORDER_STATE.IDLE);
    const [orderError, setOrderError] = useState(null);
    const [activeOrderDetails, setActiveOrderDetails] = useState(null); // NEW: Store full details for bundling check

    useEffect(() => {
        const liveOrderKey = `liveOrder_${restaurantId}`;
        const liveOrderData = localStorage.getItem(liveOrderKey);
        if (liveOrderData) {
            setLiveOrder(JSON.parse(liveOrderData));
        } else if (activeOrderId) {
            setLiveOrder({ orderId: activeOrderId, trackingToken: token });
        }

        // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
        /*
        // NEW: Fetch active order details for Bundling Logic
        if (activeOrderId) {
            console.log("[Cart Page] Fetching active order details for bundling check:", activeOrderId);
            fetch(`/api/order/status/${activeOrderId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.order) {
                        console.log("[Cart Page] Active order details fetched:", data.order);
                        setActiveOrderDetails(data.order);
                    }
                })
                .catch(err => console.error("[Cart Page] Failed to fetch active order:", err));
        }
        */
        // ========== END BUNDLING FEATURE ==========
    }, [activeOrderId, token, restaurantId]);

    useEffect(() => {
        console.log("[Cart Page] Component mounting. User loading:", isUserLoading);
        const verifyToken = async () => {
            console.log("[Cart Page] Verifying token. Table ID:", tableId, "User:", !!user);

            const isDineIn = !!tableId;
            const isLoggedInUser = !!user;
            const isWhatsAppSession = !!phone && !!token;

            let isAnonymousPreOrder = false;
            try {
                const savedCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`) || '{}');
                isAnonymousPreOrder = savedCart.deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;
            } catch (e) {
                // Ignore parsing errors, isAnonymousPreOrder will remain false
            }

            if (isDineIn || isLoggedInUser || isAnonymousPreOrder || activeOrderId) {
                console.log(`[Cart Page] Session validated. Reason: ${isDineIn ? 'Dine-in' : isLoggedInUser ? 'Logged in' : activeOrderId ? 'Add-on Order' : 'Anonymous Pre-order'}`);
                setIsTokenValid(true);
            } else if (isWhatsAppSession) {
                console.log("[Cart Page] Phone and token found in URL. Verifying with API...");
                try {
                    const res = await fetch('/api/auth/verify-token', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, token }),
                    });
                    if (!res.ok) throw new Error((await res.json()).message || "Session validation failed.");
                    console.log("[Cart Page] API verification successful. Token is valid.");
                    setIsTokenValid(true);
                } catch (err) {
                    console.error("[Cart Page] Token verification failed:", err.message);
                    setTokenError(err.message);
                    setLoadingPage(false);
                }
            } else if (!isUserLoading) {
                console.log("[Cart Page] No session info found and user is not loading. Setting error.");
                setTokenError("No session token found. Please start your order from WhatsApp or log in.");
                setLoadingPage(false);
            }

        };

        if (!restaurantId) {
            console.log("[Cart Page] No restaurantId found. Redirecting to home.");
            router.push('/');
            return;
        }

        if (!isUserLoading) {
            verifyToken();
        } else {
            // If user is loading, we are still loading the page
        }
    }, [phone, token, tableId, user, isUserLoading, restaurantId, router, activeOrderId]);

    useEffect(() => {
        if (isTokenValid && restaurantId) {
            console.log("[Cart Page] Token is valid. Loading cart data from localStorage for restaurant:", restaurantId);
            const data = localStorage.getItem(`cart_${restaurantId}`);
            if (data) {
                const parsedData = JSON.parse(data);
                const now = new Date().getTime();
                if (parsedData.expiryTimestamp && now > parsedData.expiryTimestamp) {
                    console.log("[Cart Page] Cart data expired. Clearing cart.");
                    localStorage.removeItem(`cart_${restaurantId}`);
                    setCartData(null); setCart([]); setNotes('');
                    setAppliedCoupons([]); setTipAmount(0);
                } else {
                    console.log("[Cart Page] Found valid cart data:", parsedData);

                    const fullMenu = parsedData.menu || {};
                    const availableItems = [];
                    const unavailableItemIds = [];
                    (parsedData.cart || []).forEach(cartItem => {
                        let isAvailable = false;
                        for (const category in fullMenu) {
                            const menuItem = fullMenu[category].find(m => m.id === cartItem.id);
                            if (menuItem && menuItem.isAvailable) {
                                isAvailable = true;
                                break;
                            }
                        }
                        if (isAvailable) {
                            availableItems.push(cartItem);
                        } else {
                            unavailableItemIds.push(cartItem.cartItemId);
                        }
                    });
                    setOutOfStockItems(unavailableItemIds);

                    // Fetch fresh vendor settings (GST, payment toggles) and merge
                    fetch(`/api/owner/settings?restaurantId=${restaurantId}`)
                        .then(res => res.json())
                        .then(freshSettings => {
                            console.log("[Cart Page] Fetched fresh vendor settings:", freshSettings);
                            const updatedData = {
                                ...parsedData,
                                // Update with fresh settings
                                gstEnabled: freshSettings.gstEnabled,
                                gstRate: freshSettings.gstRate,
                                gstMinAmount: freshSettings.gstMinAmount,
                                convenienceFeeEnabled: freshSettings.convenienceFeeEnabled,
                                convenienceFeeRate: freshSettings.convenienceFeeRate,
                                convenienceFeePaidBy: freshSettings.convenienceFeePaidBy,
                                convenienceFeeLabel: freshSettings.convenienceFeeLabel,
                                packagingChargeEnabled: freshSettings.packagingChargeEnabled,
                                packagingChargeAmount: freshSettings.packagingChargeAmount,
                                // NEW: Update coupons from fresh settings
                                coupons: freshSettings.coupons || [],
                                // FIXED: Update delivery settings from fresh server data
                                deliveryFeeType: freshSettings.deliveryFeeType,
                                deliveryFixedFee: freshSettings.deliveryFixedFee,
                                deliveryPerKmFee: freshSettings.deliveryPerKmFee,
                                deliveryFreeThreshold: freshSettings.deliveryFreeThreshold,
                                deliveryCharge: freshSettings.deliveryCharge, // Crucial: Update the calculated charge
                            };

                            setPackagingConfig({
                                enabled: freshSettings.packagingChargeEnabled || false,
                                amount: freshSettings.packagingChargeAmount || 0
                            });

                            setCartData(updatedData);
                            setCart(availableItems); // Only set available items in cart
                            setNotes(parsedData.notes || '');
                            setAppliedCoupons(parsedData.appliedCoupons || []);
                            setTipAmount(parsedData.tipAmount || 0);
                            setPickupTime(parsedData.pickupTime || '');

                            setPickupTime(parsedData.pickupTime || '');

                            // FIXED: Persist fresh data (including coupons) to localStorage
                            // This ensures updateCartInStorage doesn't overwrite it with stale data
                            localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(updatedData));
                        })
                        .catch(err => {
                            console.error("[Cart Page] Failed to fetch fresh settings:", err);
                            // Fallback to cached data if API fails
                            setCartData(parsedData);
                            setCart(availableItems);
                            setNotes(parsedData.notes || '');
                            setAppliedCoupons(parsedData.appliedCoupons || []);
                            setTipAmount(parsedData.tipAmount || 0);
                            setPickupTime(parsedData.pickupTime || '');
                        })
                        .finally(() => {
                            setLoadingPage(false);
                        });
                }
            } else {
                console.log("[Cart Page] No cart data found in localStorage.");
                setCart([]);
                setCartData(null);
                setLoadingPage(false);
            }
        }
    }, [isTokenValid, restaurantId]);


    const deliveryType = useMemo(() => {
        if (tableId) return 'dine-in';
        return cartData?.deliveryType || 'delivery';
    }, [tableId, cartData]);

    const updateCartInStorage = (updates) => {
        console.log("[Cart Page] Updating cart in localStorage with:", updates);
        const currentData = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
        const expiryTimestamp = new Date().getTime() + (24 * 60 * 60 * 1000);
        const updatedData = { ...currentData, ...updates, expiryTimestamp };

        setCartData(updatedData);
        if (updates.cart !== undefined) setCart(updates.cart);
        if (updates.notes !== undefined) setNotes(updates.notes);
        if (updates.appliedCoupons !== undefined) setAppliedCoupons(updates.appliedCoupons);
        if (updates.tipAmount !== undefined) setTipAmount(updates.tipAmount);
        if (updates.pickupTime !== undefined) setPickupTime(updates.pickupTime);
        if (updates.diningPreference !== undefined) setDiningPreference(updates.diningPreference);

        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(updatedData));
    };

    const handleUpdateCart = (item, action) => {
        let newCart = [...cart];
        const cartItemId = item.cartItemId;
        const existingItemIndex = newCart.findIndex(cartItem => cartItem.cartItemId === cartItemId);

        if (existingItemIndex > -1) {
            if (action === 'increment') {
                newCart[existingItemIndex].quantity++;
            } else if (action === 'decrement') {
                if (newCart[existingItemIndex].quantity === 1) {
                    newCart.splice(existingItemIndex, 1);
                } else {
                    newCart[existingItemIndex].quantity--;
                }
            }
        }
        updateCartInStorage({ cart: newCart });
    };

    const handleNotesChange = (e) => {
        const newNotes = e.target.value;
        updateCartInStorage({ notes: newNotes });
    }

    const handleCutleryClick = () => {
        const cutleryNote = "Don't send cutlery.";
        if (!notes.includes(cutleryNote)) {
            const newNotes = notes ? `${notes.trim()} ${cutleryNote}` : cutleryNote;
            updateCartInStorage({ notes: newNotes });
        }
    };

    const handleClearCart = () => {
        setIsClearCartDialogOpen(false);
        updateCartInStorage({ cart: [], appliedCoupons: [], tipAmount: 0 });
    };

    const handlePostPaidCheckout = async () => {
        console.log("[Cart Page] Initiating post-paid checkout.");

        // ✅ Haptic feedback on click
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(50); // Quick tap feedback
        }

        // Prevent double-click
        if (orderState !== ORDER_STATE.IDLE) {
            console.log('[Cart Page] ⚠️ Order already in progress, ignoring click');
            return;
        }

        setOrderState(ORDER_STATE.CREATING_ORDER);
        setOrderError(null);
        setIsCheckoutFlow(true);
        setInfoDialog({ isOpen: true, title: "Processing...", message: "Placing your order. Please wait." });

        try {
            // Generate idempotency key for this order
            const idempotencyKey = typeof window !== 'undefined'
                ? (localStorage.getItem('current_order_key') || `order_${uuidv4()}`)
                : `order_${uuidv4()}`;

            if (typeof window !== 'undefined') {
                localStorage.setItem('current_order_key', idempotencyKey);
            }

            const orderData = {
                idempotencyKey,  // ← Idempotency key
                restaurantId,
                items: cart,
                notes: cartData?.notes || '',
                subtotal: subtotal,
                cgst: cgst,
                sgst: sgst,
                grandTotal: grandTotal,
                deliveryType: deliveryType, // FIXED: Use dynamic deliveryType instead of hardcoded
                tableId: tableId,
                businessType: cartData?.businessType || 'restaurant',
                pax_count: cartData?.pax_count || 1,
                tab_name: cartData?.tab_name || cartData?.name || 'Guest',
                diningPreference: diningPreference,
                packagingCharge: (diningPreference === 'takeaway' && packagingConfig.enabled) ? packagingConfig.amount : 0,
                dineInTabId: cartData?.dineInTabId || null, // Use cartData.dineInTabId
                paymentMethod: 'post-paid', // ✅ CRITICAL FIX: Required for post-paid orders
                paymentStatus: 'pending', // Will be settled at counter later
                // ✅ Customer details for post-paid
                customerName: cartData?.tab_name || cartData?.name || 'Guest',
                customerPhone: cartData?.phone || null,
            };

            console.log("[Cart Page] Sending post-paid order to /api/order/create:", orderData);
            const res = await fetch('/api/order/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            console.log("[Cart Page] Post-paid order successful. Response:", data);

            setOrderState(ORDER_STATE.SUCCESS);

            // Clear idempotency key on success
            if (typeof window !== 'undefined') {
                localStorage.removeItem('current_order_key');
            }

            // Save liveOrder to localStorage so track button shows on order page
            const liveOrderData = {
                orderId: data.order_id,
                trackingToken: data.token,
                restaurantId: restaurantId,
                deliveryType: deliveryType
            };
            localStorage.setItem(`liveOrder_${restaurantId}`, JSON.stringify(liveOrderData));
            console.log("[Cart Page] Saved liveOrder for dine-in:", liveOrderData);

            localStorage.removeItem(`cart_${restaurantId}`);

            // Redirect to tracking page with only token (no tabId needed)
            router.push(`/track/dine-in/${data.order_id}?token=${data.token}`);
        } catch (err) {
            console.error("[Cart Page] Post-paid checkout error:", err.message);

            // Set ORDER_STATE.ERROR
            setOrderState(ORDER_STATE.ERROR);
            setIsCheckoutFlow(false);

            // Human-friendly error messages
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
                const isUserFriendly = !err.message.match(/[A-Z_]{3,}/) && err.message.length < 100;
                friendlyError = isUserFriendly ? err.message : friendlyError;
            }
            setInfoDialog({
                isOpen: true,
                title: "Error",
                message: friendlyError
            });

            // ✅ Haptic feedback on error
            if (typeof window !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate([100, 50, 100]); // Error pattern
            }

            setOrderError(friendlyError);
            setInfoDialog({ isOpen: true, title: "Error", message: friendlyError });
        }
    };

    const handleConfirmOrder = () => {
        console.log(`[Cart Page] Confirm order clicked. Delivery type: ${deliveryType}, Dine-in model: ${cartData?.dineInModel}`);
        if (deliveryType === 'dine-in' && cartData?.dineInModel === 'post-paid') {
            handlePostPaidCheckout();
            return;
        }

        if (deliveryType === 'pickup' && !pickupTime) {
            setIsCheckoutFlow(true);
            setIsPickupTimeModalOpen(true);
            return;
        }

        const params = new URLSearchParams(searchParams.toString());

        // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
        /*
        // SMART BUNDLING: For delivery, we DO NOT pass activeOrderId (avoids legacy merge).
        // Instead, we pass 'bundlingRef' so Checkout can validate 10-min rule.
        if (deliveryType === 'delivery' && params.get('activeOrderId')) {
            const aId = params.get('activeOrderId');
            params.delete('activeOrderId');
            params.append('bundlingRef', aId);
        }
        */
        // ========== END BUNDLING FEATURE ==========

        let checkoutUrl = `/checkout?${params.toString()}`;

        console.log("[Cart Page] Proceeding to checkout URL:", checkoutUrl);

        if (deliveryType === 'dine-in' && !tabId) {
            const dineInSetupStr = localStorage.getItem(`dineInSetup_${restaurantId}_${tableId}`);
            if (dineInSetupStr) {
                const dineInSetup = JSON.parse(dineInSetupStr);
                console.log("[Cart Page] Found dine-in setup for new tab:", dineInSetup);
                updateCartInStorage({ pax_count: dineInSetup.pax_count, tab_name: dineInSetup.tab_name });
            }
        }
        router.push(checkoutUrl);
    };


    const handleConfirmPickupTime = () => {
        setIsPickupTimeModalOpen(false);
        if (!pickupTime.trim()) {
            setInfoDialog({ isOpen: true, title: "Time Required", message: "Please select a pickup time to continue." });
            setIsCheckoutFlow(false);
            return;
        }
        updateCartInStorage({ pickupTime });

        if (isCheckoutFlow) {
            const params = new URLSearchParams({
                restaurantId, phone: phone || '', token: token || '',
            });
            if (tableId) params.append('table', tableId);
            let checkoutUrl = `/checkout?${params.toString()}`;
            router.push(checkoutUrl);
        }
        setIsCheckoutFlow(false);
    };

    const handleEditPickupTime = () => {
        setIsCheckoutFlow(false);
        setIsPickupTimeModalOpen(true);
    }

    const handleGoBack = () => {
        const params = new URLSearchParams();
        if (restaurantId) params.append('restaurantId', restaurantId);
        if (phone) params.append('phone', phone);
        if (token) params.append('token', token);
        if (tableId) params.append('table', tableId);
        if (tabId) params.append('tabId', tabId);

        // FIXED: Always pass activeOrderId if present (supports Smart Bundling for delivery)
        if (activeOrderId) {
            params.append('activeOrderId', activeOrderId);
        }

        let backUrl = `/order/${restaurantId}`;
        const paramsString = params.toString();
        if (paramsString) {
            backUrl += `?${paramsString}`;
        }
        router.push(backUrl);
    };

    const handleTipChange = (amount) => {
        const newTip = Number(amount);
        if (newTip === tipAmount) {
            handleTipChange(0);
        } else {
            setTipAmount(newTip);
            updateCartInStorage({ tipAmount: newTip });
        }
    };

    // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
    /*
    // SMART BUNDLING LOGIC (10-Minute Rule)
    const isBundleEligible = useMemo(() => {
        if (!activeOrderDetails || !activeOrderDetails.createdAt) return false;

        // Check 10 minute window
        // Ensure accurate date parsing
        let createdAtDate = activeOrderDetails.createdAt;
        if (typeof createdAtDate === 'string') createdAtDate = new Date(createdAtDate);
        if (createdAtDate && createdAtDate.seconds) createdAtDate = new Date(createdAtDate.seconds * 1000); // Firestore timestamp fallback

        const now = new Date();
        const diffMinutes = (now - createdAtDate) / (1000 * 60);

        // Check Status
        const status = activeOrderDetails.status;
        const isStatusEligible = !['out_for_delivery', 'delivered', 'cancelled', 'rejected'].includes(status);

        console.log(`[Cart Page Bundling Check] Time Diff: ${diffMinutes.toFixed(2)} mins, Status: ${status}, Eligible: ${diffMinutes <= 10 && isStatusEligible}`);

        return diffMinutes <= 10 && isStatusEligible;
    }, [activeOrderDetails]);
    */
    const isBundleEligible = false; // Bundling disabled
    // ========== END BUNDLING FEATURE ==========

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);

    const { totalDiscount, couponDiscount, specialCouponDiscount, isDeliveryFree } = useMemo(() => {
        let couponDiscount = 0;
        let specialCouponDiscount = 0;

        const isFreeDeliveryApplied = appliedCoupons.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        const isFreeDeliveryThresholdMet = cartData?.deliveryFreeThreshold && subtotal >= cartData.deliveryFreeThreshold;

        const isDeliveryFree = isFreeDeliveryApplied || isFreeDeliveryThresholdMet;


        appliedCoupons.forEach(coupon => {
            if (subtotal < coupon.minOrder) return;
            if (coupon.type === 'free_delivery') return;

            let currentDiscount = 0;
            if (coupon.type === 'flat') {
                currentDiscount = coupon.value;
            } else if (coupon.type === 'percentage') {
                currentDiscount = (subtotal * coupon.value) / 100;
            }

            if (coupon.customerId) {
                specialCouponDiscount += currentDiscount;
            } else {
                couponDiscount += currentDiscount;
            }
        });

        return {
            totalDiscount: couponDiscount + specialCouponDiscount,
            couponDiscount,
            specialCouponDiscount,
            isDeliveryFree,
        };
    }, [appliedCoupons, subtotal, cartData?.deliveryFreeThreshold]);

    const finalDeliveryCharge = useMemo(() => {
        if (deliveryType === 'pickup' || deliveryType === 'dine-in' || !cartData || deliveryType === 'street-vendor-pre-order') return 0;

        // ========== BUNDLING FEATURE DISABLED ==========
        // if (isBundleEligible && cartData.deliveryCharge > 0) return 0;

        return isDeliveryFree ? 0 : (cartData.deliveryCharge || 0);
    }, [isDeliveryFree, cartData, deliveryType]); // Removed isBundleEligible from deps

    const { cgst, sgst, grandTotal } = useMemo(() => {
        // Removed hardcoded 0 tax for street vendors. Now respects cartData.gstEnabled.

        const taxableAmount = subtotal - totalDiscount;
        let cgstAmount = 0;
        let sgstAmount = 0;

        // Apply GST based on vendor configuration (from cartData)
        if (cartData?.gstEnabled && taxableAmount > 0) {
            // Check if order amount meets minimum threshold
            if (taxableAmount >= (cartData.gstMinAmount || 0)) {
                // GST rate is total (e.g., 12%), split equally between CGST and SGST
                const totalGstRate = cartData.gstRate || 5;
                const halfGstRate = totalGstRate / 2;
                cgstAmount = taxableAmount * (halfGstRate / 100);
                sgstAmount = taxableAmount * (halfGstRate / 100);
            }
        }

        const finalTip = deliveryType === 'delivery' ? tipAmount : 0;
        const packagingCharge = (diningPreference === 'takeaway' && packagingConfig.enabled) ? packagingConfig.amount : 0;
        const total = taxableAmount + finalDeliveryCharge + cgstAmount + sgstAmount + finalTip + packagingCharge;
        return { cgst: cgstAmount, sgst: sgstAmount, grandTotal: total, packagingCharge };
    }, [subtotal, totalDiscount, finalDeliveryCharge, tipAmount, deliveryType, cartData, diningPreference, packagingConfig]);


    const handleToggleCoupon = (couponToToggle) => {
        let newAppliedCoupons;
        const isApplied = appliedCoupons.some(c => c.id === couponToToggle.id);

        if (isApplied) {
            newAppliedCoupons = appliedCoupons.filter(c => c.id !== couponToToggle.id);
        } else {
            if (subtotal < couponToToggle.minOrder) {
                setInfoDialog({ isOpen: true, title: "Minimum Order Not Met", message: `You need to spend at least ₹${couponToToggle.minOrder} to use this coupon.`, type: 'error' });
                return;
            }
            const isSpecial = !!couponToToggle.customerId;
            let currentAppliedCoupons = [...appliedCoupons];
            if (!isSpecial) {
                currentAppliedCoupons = currentAppliedCoupons.filter(c => !!c.customerId);
            }
            newAppliedCoupons = [...currentAppliedCoupons, couponToToggle];
        }

        updateCartInStorage({ appliedCoupons: newAppliedCoupons });
        setTimeout(() => setCouponPopoverOpen(false), 1000);
    };

    const allCoupons = cartData?.coupons || [];
    const specialCoupons = allCoupons.filter(c => c.customerId);
    const normalCoupons = allCoupons.filter(c => !c.customerId);
    const isStreetVendor = deliveryType === 'street-vendor-pre-order';

    if (loadingPage) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-destructive">Session could not be verified.</p></div>;
    }

    const getTrackingUrl = () => {
        if (!liveOrder || liveOrder.restaurantId !== restaurantId) return null;

        // FIXED: Check delivery type to generate correct tracking URL
        const orderDeliveryType = liveOrder.deliveryType || (liveOrder.orderId === activeOrderId ? deliveryType : null);

        // Check if it's a dine-in order
        const isDineIn = orderDeliveryType === 'dine-in' || (tableId && !orderDeliveryType);

        if (isDineIn) {
            return `/track/dine-in/${liveOrder.orderId}?token=${liveOrder.trackingToken}`;
        }

        if (orderDeliveryType === 'street-vendor-pre-order') {
            return `/track/pre-order/${liveOrder.orderId}?token=${liveOrder.trackingToken}`;
        }

        const path = `/track/${liveOrder.orderId}`;
        return `${path}?token=${liveOrder.trackingToken}`;
    };
    const trackingUrl = getTrackingUrl();

    if (loadingPage) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (!cartData || cart.length === 0) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-muted-foreground p-4">
                {(liveOrder) && trackingUrl && (
                    <motion.div
                        className="fixed bottom-4 left-4 right-4 z-20"
                        initial={{ y: 100 }}
                        animate={{ y: 0 }}
                        transition={{ type: 'spring', stiffness: 100 }}
                    >
                        <div className={cn("p-3 rounded-lg text-black flex justify-between items-center", liveOrder?.status === 'Ready' || liveOrder?.status === 'ready_for_pickup' ? 'bg-green-400' : 'bg-yellow-400')}>
                            <div>
                                <p className="font-bold">Your order is {liveOrder?.status || 'active'}</p>
                                <p className="text-xs opacity-80">ID: #{(liveOrder?.orderId).substring(0, 8)}</p>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => router.push(trackingUrl)}
                                className="bg-black text-white"
                            >
                                <Navigation size={16} className="mr-2" /> Track
                            </Button>
                        </div>
                    </motion.div>
                )}
                <ShoppingCart size={48} className="mb-4" />
                <h1 className="text-2xl font-bold">Your Cart is Empty</h1>
                <p className="mt-2">Looks like you haven't added anything to your cart yet.</p>
                <Button onClick={handleGoBack} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
                </Button>
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
                type={infoDialog.type}
            />
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <ClearCartDialog
                isOpen={isClearCartDialogOpen}
                onClose={() => setIsClearCartDialogOpen(false)}
                onConfirm={handleClearCart}
            />
            <PickupTimeModal
                isOpen={isPickupTimeModalOpen}
                onClose={() => {
                    setIsPickupTimeModalOpen(false);
                    setIsCheckoutFlow(false);
                }}
                onConfirm={handleConfirmPickupTime}
                pickupTime={pickupTime}
                setPickupTime={setPickupTime}
            />

            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={handleGoBack} className="h-10 w-10">
                                <ArrowLeft />
                            </Button>
                            <div>
                                <p className="text-xs text-muted-foreground">{activeOrderId ? 'Adding to your order for' : 'Reviewing Your Order from'}</p>
                                <h1 className="text-xl font-bold">{cartData.restaurantName}</h1>
                            </div>
                        </div>
                        {(liveOrder) && trackingUrl && (
                            <Button asChild variant="secondary" className={cn("flex-shrink-0 animate-pulse text-black", liveOrder?.status === 'Ready' || liveOrder?.status === 'ready_for_pickup' ? 'bg-green-400 hover:bg-green-500' : 'bg-yellow-400 hover:bg-yellow-500')}>
                                <a href={trackingUrl}>
                                    <Navigation size={16} /> <span className="ml-2 hidden sm:inline">Track Live Order</span>
                                </a>
                            </Button>
                        )}
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto pb-40">
                    {outOfStockItems.length > 0 && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Items Out of Stock</AlertTitle>
                            <AlertDescription>
                                Some items in your cart are no longer available and have been automatically removed. Please review your updated cart.
                            </AlertDescription>
                        </Alert>
                    )}
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <ShoppingCart size={48} className="mb-4" />
                            <h1 className="text-2xl font-bold">Your Cart is Empty</h1>
                            <p className="mt-2">Looks like you haven't added anything to your cart yet.</p>
                            <Button onClick={handleGoBack} className="mt-6">
                                <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Menu
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="bg-card p-4 rounded-lg border border-border mt-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="font-bold text-lg">{deliveryType === 'dine-in' ? `Adding to Tab` : `Your Items`}</h3>
                                    <Button variant="destructive" size="sm" onClick={() => setIsClearCartDialogOpen(true)}><Trash2 className="mr-2 h-4 w-4" /> Clear</Button>
                                </div>
                                <div className="space-y-4">
                                    {cart.map(item => (
                                        <motion.div
                                            layout
                                            key={item.cartItemId}
                                            className={cn("flex items-center gap-4 relative p-3 rounded-md")}
                                        >
                                            <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center flex-shrink-0`}>
                                                <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                                            </div>
                                            <div className="flex-grow">
                                                <p className={cn("font-semibold text-foreground")}>{item.name}</p>
                                                <p className="text-xs text-muted-foreground">{item.portion.name}</p>
                                                {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                                    <ul className="mt-1 pl-4">
                                                        {item.selectedAddOns.map(addon => (
                                                            <li key={addon.name} className="text-xs text-muted-foreground list-disc list-inside">
                                                                {addon.name} (+₹{addon.price})
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500" onClick={() => handleUpdateCart(item, 'decrement')}>-</Button>
                                                <span className="font-bold w-5 text-center">{item.quantity}</span>
                                                <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-green-500/10 hover:text-green-500 hover:border-green-500" onClick={() => handleUpdateCart(item, 'increment')}>+</Button>
                                            </div>
                                            <p className={cn("w-20 text-right font-bold")}>₹{item.totalPrice * item.quantity}</p>
                                        </motion.div>
                                    ))}
                                </div>

                                <Button variant="outline" onClick={handleGoBack} className="w-full mt-4 border-green-500 text-green-500 bg-green-500/10 hover:bg-green-500/20 hover:text-green-500">
                                    <PlusCircle className="mr-2 h-4 w-4" /> Add more items
                                </Button>

                                {deliveryType === 'pickup' && (
                                    <div className="mt-4 p-3 bg-muted rounded-lg flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Clock size={16} className="text-primary" />
                                            <span className="text-sm">Pickup Time: <span className="font-bold text-foreground">{pickupTime || 'Not set'}</span></span>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={handleEditPickupTime} className="text-primary h-auto p-1">
                                            <Edit2 size={14} className="mr-1" /> {pickupTime ? 'Edit' : 'Set Time'}
                                        </Button>
                                    </div>
                                )}

                                {cartData?.businessType === 'street-vendor' && (
                                    <div className="mt-4 pt-4 border-t border-dashed border-border">
                                        <h3 className="font-bold text-base mb-3 flex items-center gap-2">
                                            <Utensils className="h-4 w-4" /> Dining Preference
                                        </h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div
                                                onClick={() => updateCartInStorage({ diningPreference: 'dine-in' })}
                                                className={cn(
                                                    "border-2 rounded-lg p-3 flex flex-col items-center justify-center cursor-pointer transition-all",
                                                    diningPreference === 'dine-in' ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                                                )}
                                            >
                                                <Utensils className={cn("mb-2 h-6 w-6", diningPreference === 'dine-in' ? "text-primary" : "text-muted-foreground")} />
                                                <span className={cn("font-semibold", diningPreference === 'dine-in' ? "text-primary" : "text-foreground")}>Dine-In</span>
                                                <span className="text-xs text-muted-foreground">Eat Here</span>
                                            </div>
                                            <div
                                                onClick={() => updateCartInStorage({ diningPreference: 'takeaway' })}
                                                className={cn(
                                                    "border-2 rounded-lg p-3 flex flex-col items-center justify-center cursor-pointer transition-all",
                                                    diningPreference === 'takeaway' ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                                                )}
                                            >
                                                <ShoppingBag className={cn("mb-2 h-6 w-6", diningPreference === 'takeaway' ? "text-primary" : "text-muted-foreground")} />
                                                <span className={cn("font-semibold", diningPreference === 'takeaway' ? "text-primary" : "text-foreground")}>Takeaway</span>
                                                <span className="text-xs text-muted-foreground">Pack & Go</span>
                                            </div>
                                        </div>
                                        {diningPreference === 'takeaway' && packagingConfig.enabled && packagingConfig.amount > 0 && (
                                            <p className="text-xs text-muted-foreground mt-2 text-center bg-muted/50 p-2 rounded">
                                                *Packaging charges of ₹{packagingConfig.amount} will be applied.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="relative mt-4 pt-4 border-t border-dashed border-border">
                                    <CookingPot className="absolute left-0 top-7 h-5 w-5 text-muted-foreground" />
                                    <textarea
                                        value={notes}
                                        onChange={handleNotesChange}
                                        placeholder="Add cooking instructions... (e.g. No onion, less spicy etc.)"
                                        rows={2}
                                        className="w-full pl-7 pr-4 py-2 rounded-md bg-input border border-foreground text-sm focus:ring-1 focus:ring-primary"
                                    />
                                    <div className="mt-2 flex justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCutleryClick}
                                            className={cn("flex items-center", notes.includes("Don't send cutlery.") && "bg-primary/20 text-primary border-primary")}
                                        >
                                            <Utensils className="mr-2 h-4 w-4" />
                                            Don't send cutlery
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                                <h3 className="font-bold text-lg mb-2">Coupons & Offers</h3>
                                <Popover open={isCouponPopoverOpen} onOpenChange={setCouponPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                                            {appliedCoupons.length > 0 ? (
                                                <span className="flex items-center text-primary font-semibold"><Check className="mr-2 h-4 w-4" /> {appliedCoupons.length} Coupon(s) Applied</span>
                                            ) : (
                                                <span className="flex items-center"><Ticket className="mr-2 h-4 w-4" /> View Available Coupons</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80 p-0" align="start">
                                        <div className="p-4 border-b border-border">
                                            <h4 className="font-medium leading-none">Available Coupons</h4>
                                            <p className="text-sm text-muted-foreground">Select one normal and any special coupons.</p>
                                        </div>
                                        <div className="max-h-60 overflow-y-auto space-y-2 p-4">
                                            {specialCoupons.length > 0 && (
                                                <div className="space-y-2">
                                                    <p className="text-sm font-semibold flex items-center gap-2 text-primary"><Sparkles size={16} /> Special for you</p>
                                                    {specialCoupons.map(coupon => {
                                                        const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                                        return (
                                                            <div key={coupon.id} onClick={() => handleToggleCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", isApplied ? "border-primary bg-primary/10" : "border-dashed border-primary/50 bg-background")}>
                                                                <div className="flex justify-between items-center">
                                                                    <p className="font-bold text-foreground">{coupon.code}</p>
                                                                    {isApplied ? <button onClick={(e) => { e.stopPropagation(); handleToggleCoupon(coupon); }} className="p-1 rounded-full hover:bg-destructive/20"><X size={14} className="text-destructive" /></button> : <Check size={16} className="text-muted-foreground" />}
                                                                </div>
                                                                <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                            </div>
                                                        )
                                                    })}
                                                    <hr className="my-4 border-border" />
                                                </div>
                                            )}

                                            {normalCoupons.length > 0 ? normalCoupons.map(coupon => {
                                                const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                                return (
                                                    <div key={coupon.id} onClick={() => handleToggleCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", isApplied ? "border-primary bg-primary/10" : "border-border bg-background")}>
                                                        <div className="flex justify-between items-center">
                                                            <p className="font-bold text-foreground">{coupon.code}</p>
                                                            {isApplied ? <button onClick={(e) => { e.stopPropagation(); handleToggleCoupon(coupon); }} className="p-1 rounded-full hover:bg-destructive/20"><X size={14} className="text-destructive" /></button> : <Check size={16} className="text-muted-foreground" />}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                    </div>
                                                )
                                            }) : (specialCoupons.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No coupons available right now.</p>)}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            <AnimatePresence>
                                {deliveryType === 'delivery' && !activeOrderId && (
                                    <motion.div
                                        className="p-4 mt-4 bg-card rounded-lg border border-border"
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Heart size={16} className="text-primary" />
                                            <h4 className="font-bold text-lg">Tip for your delivery hero</h4>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1">A small tip makes a big difference. 100% of the tip goes directly to the rider.</p>
                                        <div className="flex gap-2 mt-3">
                                            {[10, 20, 50].map(tip => (
                                                <Button key={tip} variant={tipAmount === tip ? "default" : "outline"} onClick={() => handleTipChange(tip)} className="flex-1">₹{tip}</Button>
                                            ))}
                                            <Input
                                                type="number"
                                                placeholder="Custom"
                                                onChange={(e) => handleTipChange(e.target.value ? Number(e.target.value) : 0)}
                                                className={cn("flex-1", tipAmount !== 0 && ![10, 20, 50].includes(tipAmount) && "border-primary ring-2 ring-primary")}
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>


                            <div className="mt-6 p-4 border-t-2 border-primary bg-card rounded-lg shadow-lg">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xl font-bold">{activeOrderId ? 'Amount to Add' : 'Bill Summary'}</h3>
                                    <Button variant="ghost" size="sm" onClick={() => setIsBillExpanded(!isBillExpanded)} className="text-primary">
                                        {isBillExpanded ? 'Hide Details' : 'View Detailed Bill'}
                                        <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", isBillExpanded && "rotate-180")} />
                                    </Button>
                                </div>

                                <AnimatePresence>
                                    {isBillExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="space-y-1 text-sm mt-4 pt-4 border-t border-dashed">
                                                <div className="flex justify-between">
                                                    <span>Subtotal:</span>
                                                    <span className="font-medium">₹{subtotal.toFixed(2)}</span>
                                                </div>
                                                {couponDiscount > 0 && <div className="flex justify-between text-green-400"><span>Coupon Discount:</span> <span className="font-medium">- ₹{couponDiscount.toFixed(2)}</span></div>}
                                                {specialCouponDiscount > 0 && <div className="flex justify-between text-primary"><span>Special Discount:</span> <span className="font-medium">- ₹{specialCouponDiscount.toFixed(2)}</span></div>}

                                                {!isStreetVendor && deliveryType === 'delivery' && (
                                                    <div className="flex justify-between">
                                                        <span>Delivery Fee:</span>
                                                        <span className={cn(isDeliveryFree && "font-bold text-green-400")}>
                                                            {isDeliveryFree ? 'FREE' : (
                                                                isBundleEligible ? <><span className="line-through text-muted-foreground mr-2">₹{cartData.deliveryCharge}</span> <span className="text-green-500 font-bold">FREE (Bundled)</span></> : (
                                                                    (cartData?.deliveryFeeType === 'per-km' && finalDeliveryCharge === 0)
                                                                        ? <span className="text-xs text-muted-foreground">Calculated at Checkout</span>
                                                                        : `₹${finalDeliveryCharge.toFixed(2)}`
                                                                )
                                                            )}
                                                        </span>
                                                    </div>
                                                )}

                                                {!isStreetVendor && tipAmount > 0 && !activeOrderId && <div className="flex justify-between text-green-400"><span>Rider Tip:</span> <span className="font-medium">+ ₹{tipAmount.toFixed(2)}</span></div>}
                                                {cgst > 0 && <div className="flex justify-between"><span>CGST ({cartData?.gstRate || 5}%):</span> <span className="font-medium">₹{cgst.toFixed(2)}</span></div>}
                                                {cgst > 0 && <div className="flex justify-between"><span>CGST ({cartData?.gstRate || 5}%):</span> <span className="font-medium">₹{cgst.toFixed(2)}</span></div>}
                                                {sgst > 0 && <div className="flex justify-between"><span>SGST ({cartData?.gstRate || 5}%):</span> <span className="font-medium">₹{sgst.toFixed(2)}</span></div>}
                                                {diningPreference === 'takeaway' && packagingConfig.enabled && packagingConfig.amount > 0 && (
                                                    <div className="flex justify-between text-primary">
                                                        <span>Packaging Charges:</span>
                                                        <span className="font-medium">₹{packagingConfig.amount.toFixed(2)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <div className="border-t border-dashed my-3"></div>

                                <div className="flex justify-between items-center text-lg font-bold">
                                    <span>{activeOrderId ? 'To Pay:' : (deliveryType === 'dine-in' ? 'Total to be Added:' : 'Grand Total:')}</span>
                                    <div className="flex items-center gap-3">
                                        {totalDiscount > 0 && !activeOrderId && (
                                            <span className="text-muted-foreground line-through text-base font-medium">₹{(subtotal + finalDeliveryCharge + (isStreetVendor ? 0 : (cgst * 2)) + (deliveryType === 'delivery' ? tipAmount : 0)).toFixed(2)}</span>
                                        )}
                                        <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span>
                                    </div>
                                </div>

                                {totalDiscount > 0 && (
                                    <div className="text-right text-sm font-semibold text-green-400 mt-1">
                                        You saved ₹{totalDiscount.toFixed(2)}!
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </main>

                <div className="fixed bottom-0 left-0 w-full z-30 bg-background/80 backdrop-blur-sm border-t border-border">
                    <div className="container mx-auto p-4">
                        {cart.length > 0 ? (
                            <Button
                                onClick={handleConfirmOrder}
                                className="flex-grow bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg font-bold w-full"
                                disabled={
                                    cart.length === 0 ||
                                    isCheckoutFlow ||
                                    orderState === ORDER_STATE.CREATING_ORDER ||
                                    outOfStockItems.length > 0 ||
                                    (cartData?.businessType === 'street-vendor' && !diningPreference)
                                }
                            >
                                {orderState === ORDER_STATE.CREATING_ORDER ? <Loader2 className="animate-spin mr-2" /> : null}
                                {orderState === ORDER_STATE.CREATING_ORDER
                                    ? 'Processing Order...'
                                    : (liveOrder && liveOrder.restaurantId === restaurantId)
                                        ? cartData?.businessType === 'street-vendor'
                                            ? <> <ShoppingBag size={20} className="mr-2" /> Place New Order </>
                                            // FIXED: For delivery, always "Place New Order" unless existing order logic is desired (now disabled)
                                            : deliveryType === 'delivery'
                                                ? 'Proceed to Checkout'
                                                : <> <PlusCircle size={20} className="mr-2" /> Add to Existing Order </>
                                        : (deliveryType === 'dine-in' ? (cartData?.dineInModel === 'post-paid' ? 'Place Order' : 'Add to Tab') : 'Proceed to Checkout')
                                }
                            </Button>
                        ) : deliveryType === 'dine-in' ? (
                            <Button onClick={() => router.push(`/checkout?restaurantId=${restaurantId}&phone=${phone || ''}&token=${token || ''}&table=${tableId}&tabId=${tabId}`)} className="flex-grow bg-green-600 hover:bg-green-700 text-white h-12 text-lg font-bold w-full">
                                <Wallet className="mr-2" /> View Bill & Pay
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div >
        </>
    );
}

const CartPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <CartPageInternal />
    </Suspense>
);

export default CartPage;
