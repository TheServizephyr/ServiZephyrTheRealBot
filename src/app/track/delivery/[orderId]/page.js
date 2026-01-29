'use client';

import React, { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Bike, Home, Star, Phone, Navigation, RefreshCw, Loader2, ArrowLeft, XCircle, Wallet, Split, ConciergeBell, ShoppingBag, MapPin, CheckCircle, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { isFinalState, getPollingInterval, getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';
import dynamic from 'next/dynamic';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    paid: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "Your meal is being prepared." },
    dispatched: { title: 'Out for Delivery', icon: <Bike size={24} />, step: 3, description: "Our delivery hero is on their way." },
    delivered: { title: 'Delivered', icon: <Home size={24} />, step: 4, description: "Enjoy your meal!" },
    rejected: { title: 'Order Cancelled', icon: <XCircle size={24} />, step: 4, isError: true, description: "The restaurant could not accept your order." },
    picked_up: { title: 'Picked Up', icon: <ShoppingBag size={24} />, step: 4, description: "You have picked up your order." },
    ready_for_pickup: { title: 'Ready for Pickup', icon: <PackageCheck size={24} />, step: 3, description: 'Your order is ready for pickup.' }
};

// Internal Components
const RiderCard = ({ rider }) => {
    if (!rider) return null;
    return (
        <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white/80 backdrop-blur-md border border-white/20 shadow-xl rounded-2xl p-5 mb-6"
        >
            <div className="flex items-center gap-4">
                <div className="relative">
                    <img
                        src={rider.photoUrl || 'https://cdn-icons-png.flaticon.com/512/10664/10664883.png'}
                        alt={rider.name}
                        className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-white">
                        4.8 ★
                    </div>
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-800">{rider.name}</h3>
                    <p className="text-xs text-gray-500 font-medium">Delivery Partner • <span className="text-green-600">Vaccinated</span></p>
                    <div className="flex items-center gap-2 mt-2">
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 rounded-full px-4 text-xs">
                            <Phone size={12} className="mr-1" /> Call
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 rounded-full px-4 text-xs border-gray-200">
                            Message
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const EnhancedTimeline = ({ currentStatus }) => {
    const steps = [
        { key: 'confirmed', label: 'Order Confirmed', icon: <CheckCircle size={16} /> },
        { key: 'preparing', label: 'Cooking', icon: <CookingPot size={16} /> },
        { key: 'dispatched', label: 'Out for Delivery', icon: <Bike size={16} /> },
        { key: 'delivered', label: 'Delivered', icon: <Home size={16} /> },
    ];

    const currentStepIndex = steps.findIndex(s => s.key === currentStatus) === -1
        ? (currentStatus === 'placed' || currentStatus === 'pending' || currentStatus === 'paid' ? -1 : 3)
        : steps.findIndex(s => s.key === currentStatus);

    return (
        <div className="relative pl-4 border-l-2 border-gray-100 space-y-8 my-8 ml-2">
            {steps.map((step, index) => {
                const isActive = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;

                return (
                    <div key={step.key} className="relative flex items-center group">
                        <motion.div
                            initial={false}
                            animate={{
                                scale: isCurrent ? 1.2 : 1,
                                backgroundColor: isActive ? '#10B981' : '#E5E7EB',
                                borderColor: isActive ? '#059669' : '#D1D5DB'
                            }}
                            className={`absolute -left-[21px] w-10 h-10 rounded-full border-4 flex items-center justify-center text-white shadow-sm z-10 transition-colors duration-300`}
                        >
                            {step.icon}
                        </motion.div>
                        <div className={`ml-8 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-40'}`}>
                            <p className="font-bold text-sm text-gray-800">{step.label}</p>
                            {isCurrent && <p className="text-xs text-green-600 font-medium animate-pulse">In Progress</p>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

function OrderTrackingContent() {
    const { orderId } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const sessionToken = searchParams.get('token');

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isVisible, setIsVisible] = useState(true); // RULE 1: Visibility tracking
    const mapRef = useRef(null);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!orderId || !sessionToken) {
            setError("Order ID or tracking token is missing.");
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
            const status = data.order?.status;

            // Clean up live order if finalized
            if (['delivered', 'picked_up', 'rejected'].includes(status)) {
                const liveOrderKey = `liveOrder_${data.restaurant?.id}`;
                localStorage.removeItem(liveOrderKey);
            }

            setOrderData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [orderId, sessionToken]);

    // RULE 1: Visibility API
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            setIsVisible(visible);

            if (visible) {
                console.log('[DeliveryTrack] Page visible - resuming polling');
                fetchData(true); // Immediate fetch on return
            } else {
                console.log('[DeliveryTrack] Page hidden - pausing polling');
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);

    // ✅ BROWSER BACK BUTTON INTERCEPTION
    useEffect(() => {
        const handlePopState = (event) => {
            event.preventDefault();
            const restaurantId = orderData?.order?.restaurantId;
            if (restaurantId) {
                console.log('[DeliveryTrack] Browser back intercepted → redirecting to order page');
                router.replace(`/order/${restaurantId}`);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [orderData, router]);

    useEffect(() => {
        // Payment Verification Logic
        const verifyPayment = async () => {
            const paymentStatus = searchParams.get('payment_status');
            if (paymentStatus === 'success' && orderId) {
                try {
                    await fetch(`/api/payment/phonepe/status/${orderId}`);
                    await fetchData();
                } catch (e) {
                    console.error("Error verifying payment:", e);
                }
            } else {
                fetchData();
            }
        };
        verifyPayment();
    }, [orderId, searchParams, fetchData]);

    // RULE 2, 3, 4: Adaptive polling with final state detection and timeout
    useEffect(() => {
        // RULE 2: Don't poll if order is in final state
        if (orderData && isFinalState(orderData.order?.status)) {
            console.log('[DeliveryTrack] Final state reached - stopping polling');
            clearPollingTimer(orderId);
            return;
        }

        // Don't poll if page is hidden
        if (!isVisible) {
            console.log('[DeliveryTrack] Page hidden - skipping polling setup');
            return;
        }

        // RULE 4: Get polling start time (localStorage-based, refresh-safe)
        const pollingStartTime = getPollingStartTime(orderId);

        // RULE 3: Get adaptive interval based on order status
        const pollingInterval = orderData?.order?.status
            ? getPollingInterval(orderData.order.status)
            : 30000; // Default 30s if no status yet

        if (!pollingInterval) {
            // Final state - no polling needed
            console.log('[DeliveryTrack] No polling interval for status:', orderData?.order?.status);
            clearPollingTimer(orderId);
            return;
        }

        console.log(`[DeliveryTrack] Polling every ${pollingInterval / 1000}s for status:`, orderData?.order?.status);

        const interval = setInterval(() => {
            // Check visibility and timeout before each poll
            if (document.hidden) {
                console.log('[DeliveryTrack] Skipping poll - page hidden');
                return;
            }

            // RULE 4: Check hard timeout
            if (Date.now() - pollingStartTime > POLLING_MAX_TIME) {
                console.warn('[DeliveryTrack] Max polling time (60min) exceeded - stopping');
                clearInterval(interval);
                clearPollingTimer(orderId);
                return;
            }

            fetchData(true);
        }, pollingInterval);

        return () => clearInterval(interval);
    }, [orderData, orderId, fetchData, isVisible]);

    const handleRecenter = () => {
        if (!mapRef.current) return;
        const bounds = new window.google.maps.LatLngBounds();
        if (orderData.restaurant?.address) bounds.extend({ lat: orderData.restaurant.address.latitude, lng: orderData.restaurant.address.longitude });
        if (orderData.deliveryBoy?.location) bounds.extend(orderData.deliveryBoy.location);
        if (orderData.order?.customerLocation) bounds.extend({
            lat: orderData.order.customerLocation._latitude || orderData.order.customerLocation.lat,
            lng: orderData.order.customerLocation._longitude || orderData.order.customerLocation.lng
        });

        if (!bounds.isEmpty()) {
            mapRef.current.fitBounds(bounds, 80);
        }
    };

    if (loading && !orderData) return <div className="h-screen flex items-center justify-center bg-gray-50"><GoldenCoinSpinner /></div>;
    if (error) return <div className="h-screen flex items-center justify-center text-red-500">{error}</div>;
    if (!orderData) return null;

    // Location Logic
    const mapLocations = {
        restaurantLocation: orderData.restaurant?.address
            ? { lat: orderData.restaurant.address.latitude, lng: orderData.restaurant.address.longitude }
            : orderData.restaurant?.restaurantLocation,
        customerLocation: orderData.order?.customerLocation
            ? {
                lat: orderData.order.customerLocation._latitude || orderData.order.customerLocation.lat,
                lng: orderData.order.customerLocation._longitude || orderData.order.customerLocation.lng
            }
            : null,
        riderLocation: orderData.deliveryBoy?.location,
    };

    return (
        <div className="h-screen w-full flex flex-col md:flex-row bg-gray-50 overflow-hidden font-sans">
            {/* LEFT: Live Map Section */}
            <div className="relative w-full md:w-[60%] h-[50vh] md:h-full bg-gray-200">
                <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span className="text-sm font-bold text-gray-700">Live Tracking</span>
                </div>

                <LiveTrackingMap {...mapLocations} mapRef={mapRef} />

                <Button
                    onClick={handleRecenter}
                    className="absolute bottom-6 right-6 z-10 rounded-full w-12 h-12 shadow-xl bg-white text-gray-700 hover:bg-gray-100"
                >
                    <Navigation size={20} />
                </Button>
            </div>

            {/* RIGHT: Info Panel */}
            <div className="w-full md:w-[40%] h-[50vh] md:h-full bg-white shadow-2xl z-20 flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                    <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Order #{orderId.slice(0, 8)}</p>
                        <h1 className="text-xl font-bold text-gray-800 mt-1">{orderData.restaurant.name}</h1>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => fetchData(true)} className="text-gray-400 hover:text-gray-600">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">

                    {/* ✅ STEP 3C: Rider Offline Warning */}
                    {orderData.deliveryBoy && orderData.deliveryBoy.isOnline === false && (
                        <div className="bg-red-100 border border-red-300 text-red-700 p-4 rounded-lg mb-4 flex items-start gap-3">
                            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="font-semibold text-sm">⚠️ Rider Network Issue</p>
                                <p className="text-xs mt-1">Delivery partner's location hasn't updated recently. Delivery may be delayed.</p>
                            </div>
                        </div>
                    )}

                    {/* Rider Card (Only if assigned) */}
                    {orderData.deliveryBoy && (
                        <RiderCard rider={orderData.deliveryBoy} />
                    )}

                    {/* ✅ STEP 7C: Distance & ETA Display */}
                    {orderData.deliveryBoy && orderData.deliveryBoy.distanceKm !== null && orderData.deliveryBoy.eta && (
                        <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg mb-4 flex items-start gap-3">
                            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1">
                                <p className="font-semibold text-sm">🚴 Rider is {orderData.deliveryBoy.distanceKm} km away</p>
                                <p className="text-xs mt-1">⏱ Estimated arrival: {orderData.deliveryBoy.eta}</p>
                            </div>
                        </div>
                    )}

                    {/* Order Status */}
                    <div className="mb-8">
                        <div className="flex justify-between items-end mb-4">
                            <h2 className="text-lg font-bold text-gray-800">Delivery Status</h2>
                        </div>

                        {/* Custom Timeline */}
                        <EnhancedTimeline currentStatus={orderData.order.status} />
                    </div>

                    {/* Order Items Summary */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-gray-600 text-sm">Order Summary</h3>
                            {/* Dynamic Payment Status Badge */}
                            {(() => {
                                // FIXED: Access nested paymentDetails from Firestore structure
                                const paymentDetails = orderData.order.paymentDetails || {};
                                const method = (paymentDetails.method || orderData.order.paymentMethod || '').toLowerCase();

                                console.log('[Page] Resolved Method:', method, 'from:', orderData.order);

                                const isPOD = method.includes('cod') ||
                                    method.includes('cash') ||
                                    method.includes('delivery') ||
                                    method === 'pay_on_delivery' ||
                                    method === 'pay_at_counter';

                                return isPOD ? (
                                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-bold">Pay on Delivery</span>
                                ) : (
                                    <div className="flex flex-col items-end">
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Paid Online</span>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="space-y-2">
                            {orderData.order.items?.map((item, i) => {
                                console.log(`[OrderTracking] Item ${i}:`, item); // DEBUG ITEM

                                // Price Calculation Strategy:
                                // 1. Try unit price fields (price, itemPrice)
                                // 2. If 0, try total fields (totalPrice, total) and divide by quantity
                                // 3. Ensure we don't divide by zero

                                let unitPrice = Number(item.price) || Number(item.itemPrice) || 0;
                                const quantity = Number(item.quantity) || 1;

                                if (unitPrice === 0) {
                                    const totalField = Number(item.totalPrice) || Number(item.total) || 0;
                                    if (totalField > 0) {
                                        unitPrice = totalField / quantity;
                                    }
                                }

                                const totalItemPrice = unitPrice * quantity;

                                return (
                                    <div key={i} className="flex justify-between text-sm text-gray-600">
                                        <span>{quantity}x {item.name}</span>
                                        <span className="font-medium">₹{totalItemPrice}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between font-bold text-gray-800">
                            <span>Total Bill</span>
                            <span>₹{orderData.order.totalAmount}</span>
                        </div>
                    </div>
                </div>

                {/* Footer Actions - Stick to bottom on mobile */}
                <div className="p-4 border-t border-gray-100 bg-white sticky bottom-0 z-30">
                    <Button className="w-full h-12 text-lg font-bold bg-gray-900 text-white hover:bg-black shadow-lg rounded-xl">
                        Need Help?
                    </Button>
                </div>
            </div>
        </div>
    );
}

export default function OrderTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <OrderTrackingContent />
        </Suspense>
    )
}
