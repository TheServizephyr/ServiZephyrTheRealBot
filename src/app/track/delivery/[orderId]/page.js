'use client';

import React, { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Bike, Home, Star, Phone, Navigation, RefreshCw, Loader2, ArrowLeft, XCircle, Wallet, Split, ConciergeBell, ShoppingBag, MapPin, CheckCircle, PackageCheck, Maximize, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { isFinalState, getPollingInterval, getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';
import dynamic from 'next/dynamic';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { rtdb } from '@/lib/firebase'; // ✅ RTDB for real-time tracking
import { ref, onValue, off } from 'firebase/database'; // ✅ RTDB listeners

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    paid: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "Your meal is being prepared." },
    dispatched: { title: 'Rider Assigned', icon: <Bike size={24} />, step: 3, description: "A delivery partner has been assigned to your order." },
    on_the_way: { title: 'Out for Delivery', icon: <Bike size={24} />, step: 4, description: "Our delivery hero is on their way." },
    rider_arrived: { title: 'Rider Reached', icon: <MapPin size={24} />, step: 5, description: "Your delivery partner has arrived at your location!" },
    delivered: { title: 'Delivered', icon: <Home size={24} />, step: 6, description: "Enjoy your meal!" },
    rejected: { title: 'Order Cancelled', icon: <XCircle size={24} />, step: 6, isError: true, description: "The restaurant could not accept your order." },
    picked_up: { title: 'Picked Up', icon: <ShoppingBag size={24} />, step: 6, description: "You have picked up your order." },
    ready_for_pickup: { title: 'Ready for Pickup', icon: <PackageCheck size={24} />, step: 4, description: 'Your order is ready for pickup.' }
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
        { key: 'dispatched', label: 'Rider Assigned', icon: <Bike size={16} /> },
        { key: 'on_the_way', label: 'Out for Delivery', icon: <Bike size={16} /> },
        { key: 'rider_arrived', label: 'Rider Reached', icon: <MapPin size={16} /> },
        { key: 'delivered', label: 'Delivered', icon: <Home size={16} /> },
    ];

    // 🎯 CRITICAL: Map ALL database statuses to timeline steps
    const getTimelineStep = (status) => {
        switch (status) {
            // Initial states
            case 'pending':
            case 'paid':
            case 'placed':
                return -1; // Before timeline starts

            case 'confirmed':
                return 0; // Order Confirmed

            case 'preparing':
                return 1; // Cooking

            // Rider assignment & restaurant pickup (all show as "Rider Assigned")
            case 'ready_for_pickup': // ✅ Added support for new flow
            case 'reached_restaurant':
            case 'picked_up':
                return 2; // Rider Assigned (rider collecting food)

            // Delivery in progress
            case 'dispatched': // ✅ MOVED `dispatched` here (Step 3: Out for Delivery)
            case 'on_the_way':
                return 3; // Out for Delivery (rider clicked START DELIVERY)

            // Rider reached customer
            case 'rider_arrived':
                return 4; // Rider Reached (rider clicked REACHED LOCATION)

            // Final states
            case 'delivered':
            case 'picked_up_by_customer':
                return 5; // Delivered

            // Error/cancelled states
            case 'rejected':
            case 'cancelled':
            case 'failed_delivery':
                return 5; // Show as final state

            default:
                console.warn('[Timeline] Unknown status:', status);
                return -1;
        }
    };

    const currentStepIndex = getTimelineStep(currentStatus);

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
    const [isMapExpanded, setIsMapExpanded] = useState(false);

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

    // ✅ RULE 1: Visibility API Removed
    // RTDB listener handles real-time updates efficiently. 
    // Re-fetching on visibility change is redundant and causes confusing cache logs.

    // ✅ BROWSER BACK BUTTON INTERCEPTION
    useEffect(() => {
        // Push state functionality to trap back button
        const preventBack = () => {
            window.history.pushState(null, document.title, window.location.href);
            const restaurantId = orderData?.order?.restaurantId;
            if (restaurantId) {
                console.log('[DeliveryTrack] Back intercepted -> going to menu');
                // Persist session tokens
                const token = searchParams.get('token');
                const phone = searchParams.get('phone');
                let targetUrl = `/order/${restaurantId}`;
                const params = new URLSearchParams();
                if (token) params.set('token', token);
                if (phone) params.set('phone', phone);
                if (orderId) params.set('activeOrderId', orderId); // ✅ Keep Track Button Alive
                if (params.toString()) targetUrl += `?${params.toString()}`;

                router.replace(targetUrl);
            }
        };

        // Initialize history stack
        window.history.pushState(null, document.title, window.location.href);
        window.addEventListener('popstate', preventBack);

        return () => {
            window.removeEventListener('popstate', preventBack);
        };
    }, [orderData, router]);

    // ✅ FIX: Payment Verification - Stable Dependencies
    const paymentStatus = searchParams.get('payment_status'); // Extract value

    useEffect(() => {
        const verifyPayment = async () => {
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
    }, [orderId, paymentStatus, fetchData]); // ✅ Depend on primitive string, not object

    // ✅ RTDB LISTENER: Real-time status updates (NO POLLING!)
    // ✅ RTDB LISTENER: Real-time status updates (NO POLLING!)
    useEffect(() => {
        if (!orderId || !orderData) return;

        const currentStatus = orderData.order?.status;

        // Don't listen if already in final state
        if (isFinalState(currentStatus)) {
            console.log('[DeliveryTrack] Final state - no listener needed');
            return;
        }

        console.log('[RTDB] Attaching status listener for', orderId);
        const statusRef = ref(rtdb, `delivery_tracking/${orderId}`);

        const unsubscribe = onValue(statusRef, (snapshot) => {
            const rtdbData = snapshot.val();
            // Only update if status implies a change and data exists
            if (rtdbData && rtdbData.status && rtdbData.status !== currentStatus) {
                console.log('[RTDB] Status updated:', rtdbData.status);

                setOrderData(prev => ({
                    ...prev,
                    order: {
                        ...prev.order,
                        status: rtdbData.status
                    }
                }));
            }
        }, (error) => {
            console.error('[RTDB] Listener error:', error);
        });

        return () => {
            console.log('[RTDB] Cleaning up status listener');
            off(statusRef, 'value', unsubscribe);
        };
    }, [orderId, orderData?.order?.status]); // ✅ Dependency on primitive STATUS, not full object loop

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
        <div className="h-[100dvh] w-full flex flex-col bg-gradient-to-br from-indigo-50 via-white to-purple-50 overflow-hidden font-sans">
            {/* MAIN SCROLLABLE AREA */}
            <div className={`flex-1 overflow-y-auto overflow-x-hidden w-full ${isMapExpanded ? 'overflow-hidden' : ''}`}> {/* Allow page scroll */}

                {/* HEADER & STATUS CARD - VERTICAL STACK (No longer floating over map) */}
                <div className="px-5 pt-6 pb-4 z-20">
                    <motion.div
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="bg-white/90 backdrop-blur-sm shadow-sm rounded-2xl p-4 border border-gray-100"
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-0.5">ORDER #{orderId?.slice(0, 8) || '...'}</p>
                                <h1 className="text-xl font-black text-gray-900 leading-tight line-clamp-1">{orderData?.restaurant?.name || 'Restaurant'}</h1>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="sm" onClick={() => {
                                    if (orderData?.restaurant?.id) {
                                        const token = searchParams.get('token');
                                        const phone = searchParams.get('phone');
                                        let targetUrl = `/order/${orderData.restaurant.id}`;
                                        const params = new URLSearchParams();
                                        if (token) params.set('token', token);
                                        if (phone) params.set('phone', phone);
                                        if (orderId) params.set('activeOrderId', orderId); // ✅ Keep Track Button Alive
                                        if (params.toString()) targetUrl += `?${params.toString()}`;

                                        router.push(targetUrl);
                                    } else {
                                        router.back();
                                    }
                                }} className="text-gray-500 hover:bg-gray-50 h-8 w-8 p-0 rounded-full">
                                    <ArrowLeft size={18} />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => fetchData(true)} className="text-gray-400 h-8 w-8 p-0 rounded-full hover:bg-gray-50">
                                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                </Button>
                            </div>
                        </div>

                        {/* DYNAMIC STATUS BAR */}
                        {(() => {
                            const status = orderData?.order?.status || 'pending';
                            let statusText = "Order In Progress";
                            let statusColor = "bg-gray-100 text-gray-600";
                            let icon = <Loader2 size={16} className="animate-spin" />;

                            // Determine if it's a delivery order to adjust 'ready' status text
                            const isDelivery = orderData.deliveryBoy ||
                                (orderData.order.deliveryMode === 'delivery') ||
                                (orderData.order.type === 'delivery');

                            // Custom Status Logic
                            switch (status) {
                                case 'pending':
                                case 'placed':
                                case 'paid':
                                    statusText = "Order Placed";
                                    statusColor = "bg-blue-50 text-blue-700";
                                    icon = <CheckCircle size={18} />;
                                    break;

                                case 'confirmed':
                                case 'accepted':
                                    statusText = "Order Confirmed";
                                    statusColor = "bg-green-50 text-green-700";
                                    icon = <Check size={18} />;
                                    break;

                                case 'preparing':
                                case 'cooking':
                                    statusText = "Preparing Your Food";
                                    statusColor = "bg-orange-50 text-orange-700";
                                    icon = <CookingPot size={18} className="animate-pulse" />;
                                    break;

                                case 'dispatched':
                                case 'reached_restaurant':
                                case 'rider_assigned':
                                    // User requested explicit "Rider Assigned" for these states
                                    statusText = "Rider Assigned";
                                    statusColor = "bg-indigo-50 text-indigo-700"; // Distinct color
                                    icon = <Bike size={18} />;
                                    break;

                                case 'ready':
                                case 'ready_for_pickup':
                                    if (isDelivery) {
                                        // Delivery: Food is ready, waiting for rider pickup -> Show "Rider Assigned" (or "Food Ready")
                                        // User preferred "Rider Assigned"
                                        statusText = "Rider Assigned";
                                        statusColor = "bg-indigo-50 text-indigo-700 text-sm";
                                        icon = <Bike size={18} />;
                                    } else {
                                        // Pickup: Customer picks up
                                        statusText = "Ready for Pickup";
                                        statusColor = "bg-blue-100 text-blue-800";
                                        icon = <PackageCheck size={18} />;
                                    }
                                    break;

                                case 'picked_up':
                                case 'out_for_delivery':
                                case 'on_the_way':
                                    statusText = "Out for Delivery";
                                    statusColor = "bg-green-100 text-green-800";
                                    icon = <Bike size={18} className="animate-bounce" />;
                                    break;

                                case 'reached':
                                case 'rider_arrived':
                                    statusText = "Rider Reached";
                                    statusColor = "bg-teal-50 text-teal-700";
                                    icon = <MapPin size={18} />;
                                    break;

                                case 'delivered':
                                case 'picked_up_by_customer':
                                    statusText = "Food Delivered";
                                    statusColor = "bg-green-600 text-white shadow-green-200";
                                    icon = <PackageCheck size={18} />;
                                    break;

                                case 'cancelled':
                                case 'rejected':
                                case 'failed_delivery':
                                    statusText = "Order Cancelled";
                                    statusColor = "bg-red-50 text-red-700";
                                    icon = <XCircle size={18} />;
                                    break;

                                default:
                                    // Fallback for unknown states
                                    statusText = "Order In Progress";
                                    statusColor = "bg-gray-50 text-gray-500";
                                    icon = <RefreshCw size={16} className="animate-spin opacity-50" />;
                            }

                            return (
                                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${statusColor} font-bold shadow-sm transition-colors duration-300`}>
                                    <div className="shrink-0">{icon}</div>
                                    <span className="text-sm tracking-wide truncate">{statusText}</span>
                                </div>
                            );
                        })()}
                    </motion.div>
                </div>

                {/* MAP SECTION - BOXED */}
                <div
                    className={`relative w-full transition-all duration-300 ease-in-out ${isMapExpanded ? 'fixed inset-0 h-[100dvh] z-50' : 'h-[50vh] px-4 py-1'}`}
                >
                    <div className={`relative w-full h-full overflow-hidden shadow-2xl border-4 border-white ring-1 ring-gray-200 ${isMapExpanded ? '' : 'rounded-3xl'}`}>

                        {/* LIVE BADGE */}
                        {!isMapExpanded && (
                            <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full shadow-sm flex items-center gap-2 pointer-events-none border border-white/50">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                </span>
                                <span className="text-xs font-bold text-gray-700">Live Tracking</span>
                            </div>
                        )}

                        {/* MAP CONTAINER - Pointer events disabled when collapsed to allow page scroll */}
                        <div className={`w-full h-full ${!isMapExpanded ? 'pointer-events-none' : ''}`}>
                            <LiveTrackingMap {...mapLocations} mapRef={mapRef} isInteractive={isMapExpanded} />
                        </div>

                        {/* EXPAND / COLLAPSE BUTTON - pointer-events-auto needed explicitly since parent might propagate none? No, siblings are fine, but good practice */}
                        <Button
                            onClick={() => setIsMapExpanded(!isMapExpanded)}
                            className="absolute bottom-4 right-4 z-10 bg-white text-gray-800 shadow-xl rounded-full p-3 h-12 w-12 hover:bg-gray-50 border border-gray-100 pointer-events-auto"
                        >
                            {isMapExpanded ? <X size={24} /> : <Maximize size={24} />}
                        </Button>

                        {!isMapExpanded && (
                            <div className="absolute bottom-20 right-4 z-10 pointer-events-auto">
                                <Button
                                    onClick={handleRecenter}
                                    size="sm"
                                    className="rounded-full shadow-xl bg-white text-gray-800 hover:bg-gray-50 h-12 w-12 p-0 border border-gray-100"
                                >
                                    <Navigation size={22} />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* DETAILS SECTION - Scrolls with the page */}
                {!isMapExpanded && (
                    <div className="w-full px-4 pb-32 pt-2">

                        {/* RIDER OFFLINE WARNING */}
                        {orderData.deliveryBoy && orderData.deliveryBoy.isOnline === false && (
                            <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-xl mb-4 flex items-start gap-3 text-sm">
                                <span className="text-xl">⚠️</span>
                                <div>
                                    <p className="font-bold">Signal Lost</p>
                                    <p className="text-xs opacity-80 mt-0.5">Rider's location isn't updating. Don't worry, they are moving!</p>
                                </div>
                            </div>
                        )}

                        {/* RIDER CARD */}
                        {orderData.deliveryBoy && (
                            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-4 mb-6 flex items-center gap-4">
                                <img
                                    src={orderData.deliveryBoy.photoUrl || 'https://cdn-icons-png.flaticon.com/512/10664/10664883.png'}
                                    alt={orderData.deliveryBoy.name}
                                    className="w-14 h-14 rounded-full object-cover border-2 border-gray-100"
                                />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-gray-900 truncate">{orderData.deliveryBoy.name}</h3>
                                    <p className="text-xs text-blue-600 font-bold">Delivery Partner</p>
                                </div>
                                <a href={`tel:${orderData.deliveryBoy.phone}`} className="no-underline">
                                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white rounded-full px-4 h-9 shadow-green-200 shadow-lg">
                                        <Phone size={14} className="mr-2" /> Call
                                    </Button>
                                </a>
                            </div>
                        )}

                        {/* STATUS TIMELINE - REMOVED */}

                        {/* ORDER SUMMARY */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
                            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-50">
                                <h3 className="font-bold text-gray-800 text-sm">Summary</h3>
                                {/* PAYMENT STATUS BADGE */}
                                {(() => {
                                    const paymentStatus = (orderData.order.paymentStatus || '').toLowerCase();

                                    // Logic: If explicitly PAID -> Online. Else (pending/pay_at_counter) -> Pay on Delivery
                                    const isPaidOnline = paymentStatus === 'paid' || paymentStatus === 'success';

                                    return !isPaidOnline ? (
                                        <div className="flex items-center gap-1.5 bg-yellow-50 px-2.5 py-1 rounded-lg border border-yellow-100">
                                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                                            <span className="text-[10px] text-yellow-700 font-extrabold uppercase tracking-wide">Pay on Delivery</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 bg-green-50 px-2.5 py-1 rounded-lg border border-green-100">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                            <span className="text-[10px] text-green-700 font-extrabold uppercase tracking-wide">Paid Online</span>
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="space-y-3">
                                {orderData.order.items?.map((item, i) => {
                                    let unitPrice = Number(item.price) || Number(item.itemPrice) || 0;
                                    const quantity = Number(item.quantity) || 1;
                                    if (unitPrice === 0) {
                                        const totalField = Number(item.totalPrice) || Number(item.total) || 0;
                                        if (totalField > 0) unitPrice = totalField / quantity;
                                    }
                                    const totalItemPrice = unitPrice * quantity;

                                    return (
                                        <div key={i} className="flex justify-between text-sm text-gray-600">
                                            <div className="flex items-start gap-2">
                                                <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center">{quantity}x</span>
                                                <span className="font-medium">{item.name}</span>
                                            </div>
                                            <span className="font-bold text-gray-800">₹{totalItemPrice}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="border-t border-dashed border-gray-200 mt-4 pt-3 flex justify-between items-center">
                                <span className="text-gray-500 text-sm font-medium">Total Bill</span>
                                <span className="text-xl font-black text-gray-900">₹{orderData.order.totalAmount}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* FOOTER ACTION - Only visible if map is NOT expanded */}
            {!isMapExpanded && (
                <div className="p-4 bg-white border-t border-gray-100 sticky bottom-0 z-30 pb-safe">
                    <a href={`tel:${orderData.restaurant.phone}`} className="block w-full">
                        <Button className="w-full h-12 text-base font-bold bg-gray-900 text-white hover:bg-black shadow-lg rounded-xl flex items-center justify-center gap-2">
                            <Phone size={18} />
                            Call Restaurant
                        </Button>
                    </a>
                </div>
            )}
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
