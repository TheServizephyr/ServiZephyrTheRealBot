'use client';

import React, { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Bike, Home, Star, Phone, Navigation, RefreshCw, Loader2, ArrowLeft, XCircle, Wallet, Split, ConciergeBell, ShoppingBag, MapPin, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
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
  ready_for_pickup: { title: 'Ready for Pickup', icon: <PackageCheck size={24}/>, step: 3, description: 'Your order is ready for pickup.' }
};


const StatusTimeline = ({ currentStatus, deliveryType }) => {
    const activeStatus = (currentStatus === 'paid') ? 'pending' : currentStatus;
    const currentStepConfig = statusConfig[activeStatus] || { step: 0, isError: false };
    const currentStep = currentStepConfig.step;
    const isError = currentStepConfig.isError;
  
    const flow = deliveryType === 'pickup' ? ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'] : ['pending', 'confirmed', 'preparing', 'dispatched', 'delivered'];
    const uniqueSteps = flow.map(statusKey => statusConfig[statusKey]);

    return (
      <div className="flex justify-between items-start w-full px-2 sm:px-4 pt-4">
        {uniqueSteps.map(({ title, icon, step }, index) => {
          const isCompleted = step <= currentStep;
          const isCurrent = step === currentStep;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center text-center w-20">
                <motion.div
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                    isError ? 'bg-destructive border-destructive text-destructive-foreground' :
                    isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                  }`}
                  animate={{ scale: isCurrent ? 1.1 : 1 }}
                  transition={{ type: 'spring' }}
                >
                  {icon}
                </motion.div>
                <p className={`mt-2 text-xs font-semibold ${
                    isError ? 'text-destructive' :
                    isCompleted ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {isError ? statusConfig[currentStatus].title : title}
                </p>
              </div>
              {index < uniqueSteps.length - 1 && (
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


function OrderTrackingContent() {
    const { orderId } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const sessionToken = searchParams.get('token');

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
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
            if (status === 'delivered' || status === 'picked_up' || status === 'rejected') {
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

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(true), 30000); // Poll every 30 seconds
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleRecenter = () => {
        if (!mapRef.current) return;
        const bounds = new window.google.maps.LatLngBounds();
        if (orderData.restaurant?.restaurantLocation) bounds.extend(orderData.restaurant.restaurantLocation);
        if (orderData.deliveryBoy?.location) bounds.extend(orderData.deliveryBoy.location);
        if (orderData.order?.customerLocation) bounds.extend(orderData.order.customerLocation);
        
        if (!bounds.isEmpty()) {
            mapRef.current.fitBounds(bounds, 80);
        }
    };
    
    const handleBackToMenu = () => {
        if (orderData?.restaurant?.id) {
            router.push(`/order/${orderData.restaurant.id}`);
        } else {
            router.push('/');
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
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }

    if (!orderData || !orderData.order) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }
    
    const currentStatusKey = (orderData.order.status === 'paid') ? 'pending' : orderData.order.status;
    const currentStatusInfo = statusConfig[currentStatusKey] || statusConfig.pending;
    
    const mapLocations = {
        restaurantLocation: orderData.restaurant.restaurantLocation,
        customerLocation: orderData.order.customerLocation,
        riderLocation: orderData.deliveryBoy?.location,
    };
    
    const isCompleted = ['delivered', 'picked_up'].includes(orderData.order.status);
    const isRejected = orderData.order.status === 'rejected';

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row green-theme">
            <div className="w-full md:w-1/2 lg:w-2/3 h-64 md:h-screen relative">
                <LiveTrackingMap {...mapLocations} mapRef={mapRef}/>
                <Button onClick={handleRecenter} variant="secondary" size="icon" className="absolute top-4 right-4 z-10 h-12 w-12 rounded-full shadow-lg" aria-label="Recenter map"><Navigation /></Button>
            </div>
            <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className="w-full md:w-1/2 lg:w-1/3 flex-shrink-0 p-4 md:p-8 space-y-6 overflow-y-auto">
                <div className="flex justify-between items-center">
                    <div>
                        <p className="text-xs text-muted-foreground">Order from</p>
                        <h1 className="font-bold text-2xl">{orderData.restaurant.name}</h1>
                    </div>
                    <Button onClick={() => fetchData(true)} variant="outline" size="icon" disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
                
                <div className="p-4 bg-card border-b border-border text-center">
                    <h2 className="text-lg font-semibold text-muted-foreground">Order ID</h2>
                    <p className="text-xl font-mono tracking-widest text-foreground">{orderId}</p>
                </div>

                <div className="p-6 bg-card rounded-lg border">
                    <StatusTimeline currentStatus={orderData.order.status} deliveryType={orderData.order.deliveryType}/>
                </div>
                
                {(isCompleted || isRejected) ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`text-center bg-card p-6 rounded-lg border-2 ${isRejected ? 'border-destructive' : 'border-primary'}`}
                    >
                         {isRejected ? (
                            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1, rotate: [0, -10, 10, -5, 5, 0] }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}>
                                <XCircle size={40} className="mx-auto text-destructive" />
                            </motion.div>
                         ) : (
                            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                                <CheckCircle size={40} className="mx-auto text-primary" />
                            </motion.div>
                         )}
                         <h3 className="text-2xl font-bold mt-4">{currentStatusInfo.title}</h3>
                         <p className="mt-2 text-muted-foreground">
                            {isRejected ? `Reason: ${orderData.order.rejectionReason || currentStatusInfo.description}` : currentStatusInfo.description}
                         </p>
                         <Button onClick={handleBackToMenu} className="mt-6 bg-primary hover:bg-primary/90">
                            {isRejected ? 'Try Ordering Again' : 'Order Something Else'}
                         </Button>
                    </motion.div>
                ) : (
                    <motion.div
                        key={orderData.order.status}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-center bg-card p-6 rounded-lg border border-border"
                    >
                         <h3 className="text-xl font-bold">{currentStatusInfo.title}</h3>
                         <p className="mt-2 text-muted-foreground text-sm">{currentStatusInfo.description}</p>
                    </motion.div>
                )}

                {orderData.deliveryBoy && (
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <h4 className="font-semibold mb-2">Your Delivery Hero</h4>
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <img src={orderData.deliveryBoy.photoUrl || 'https://picsum.photos/seed/rider/100'} alt="Delivery Boy" className="w-12 h-12 rounded-full object-cover"/>
                                <div>
                                    <p className="font-bold text-foreground">{orderData.deliveryBoy.name}</p>
                                    <div className="flex items-center gap-1 text-xs text-yellow-400"><Star size={12} className="fill-current"/> {orderData.deliveryBoy.rating}</div>
                                </div>
                            </div>
                            <Button asChild variant="outline">
                                <a href={`tel:${orderData.deliveryBoy.phone}`}><Phone className="mr-2 h-4 w-4"/> Call</a>
                            </Button>
                        </div>
                    </div>
                )}
                 {!isCompleted && !isRejected && (
                    <div className="pt-4 text-center">
                        <Button onClick={handleBackToMenu} variant="ghost" className="text-muted-foreground">
                           <ArrowLeft className="mr-2 h-4 w-4"/> Back to Menu
                        </Button>
                    </div>
                )}
            </motion.div>
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
