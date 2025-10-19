
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Bike, Home, Star, Phone, Navigation, RefreshCw, Loader2, ArrowLeft, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot, GeoPoint } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import dynamic from 'next/dynamic';

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
});

const statusConfig = {
  pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0 },
  paid: { title: 'Order Placed', icon: <Check size={24} />, step: 0 },
  confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1 },
  preparing: { title: 'Preparing', icon: <CookingPot size={24} />, step: 2 },
  dispatched: { title: 'Out for Delivery', icon: <Bike size={24} />, step: 3 },
  delivered: { title: 'Delivered', icon: <Home size={24} />, step: 4 },
  rejected: { title: 'Rejected', icon: <XCircle size={24} />, step: 4, isError: true },
};

const StatusTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid') ? 'pending' : currentStatus;
    const currentStep = statusConfig[activeStatus]?.step || 0;
    const isError = statusConfig[activeStatus]?.isError || false;
  
    const uniqueSteps = Object.values(statusConfig)
        .filter((value, index, self) => 
            !value.isError && self.findIndex(v => v.step === value.step) === index
        );

    return (
      <div className="flex justify-between items-center w-full px-2 sm:px-4 pt-4">
        {uniqueSteps.map(({ title, icon, step }) => {
          const isCompleted = step <= currentStep;
          const isCurrent = step === currentStep;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center text-center w-16">
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
              {step < 4 && (
                <div className="flex-1 h-1 mx-1 sm:mx-2 rounded-full bg-border">
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

const RiderDetails = ({ rider }) => {
    if (!rider) return null;
    return (
        <Card className="shadow-lg">
            <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 border-2 border-primary">
                        <AvatarImage src={rider.photoUrl || `https://picsum.photos/seed/${rider.id}/100`} />
                        <AvatarFallback>{rider.name?.charAt(0) || 'R'}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-bold text-lg text-foreground">{rider.name}</p>
                        <div className="flex items-center gap-1 text-sm text-yellow-400">
                            <Star size={16} className="fill-current"/> <span>{rider.rating?.toFixed(1) || '4.5'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button asChild variant="outline" size="icon" className="h-11 w-11">
                        <a href={`tel:${rider.phone}`}><Phone /></a>
                    </Button>
                     <Button asChild size="icon" className="h-11 w-11 bg-primary text-primary-foreground">
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${rider.location?.latitude},${rider.location?.longitude}`} target="_blank" rel="noopener noreferrer"><Navigation /></a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};


export default function OrderTrackingPage() {
    const { orderId } = useParams();
    const router = useRouter();

    const [order, setOrder] = useState(null);
    const [restaurant, setRestaurant] = useState(null);
    const [deliveryBoy, setDeliveryBoy] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!orderId) {
            setError("No order ID provided.");
            setLoading(false);
            return;
        }

        const orderRef = doc(db, 'orders', orderId);

        const unsubscribeOrder = onSnapshot(orderRef, 
            (orderSnap) => {
                if (!orderSnap.exists()) {
                    setError('Order not found.');
                    setLoading(false);
                    return;
                }
                const orderData = { id: orderSnap.id, ...orderSnap.data() };
                setOrder(orderData);
            },
            (err) => {
                console.error("Order snapshot error:", err);
                setError('Failed to load order details.');
                setLoading(false);
            }
        );

        return () => unsubscribeOrder();
    }, [orderId]);


    useEffect(() => {
        if (!order) return;

        let unsubRestaurant;
        let unsubRider;

        const businessCollection = order.businessType === 'shop' ? 'shops' : 'restaurants';
        const restaurantRef = doc(db, businessCollection, order.restaurantId);

        unsubRestaurant = onSnapshot(restaurantRef, 
            (restaurantSnap) => {
                if (restaurantSnap.exists()) {
                    setRestaurant({ id: restaurantSnap.id, ...restaurantSnap.data() });
                } else {
                    setError('Associated business not found.');
                }
                setLoading(false); 
            },
            (err) => {
                setError('Failed to load business details.');
                setLoading(false);
            }
        );

        if (order.deliveryBoyId) {
            // **THE FIX**: This assumes delivery boys are in a top-level collection.
            // Adjust this path if riders are in a sub-collection of the restaurant.
            const riderRef = doc(db, 'deliveryBoys', order.deliveryBoyId);
            unsubRider = onSnapshot(riderRef,
                (riderSnap) => {
                    setDeliveryBoy(riderSnap.exists() ? { id: riderSnap.id, ...riderSnap.data() } : null);
                },
                (err) => console.warn("Rider snapshot error:", err)
            );
        } else {
            setDeliveryBoy(null);
        }

        return () => {
            if (unsubRestaurant) unsubRestaurant();
            if (unsubRider) unsubRider();
        };

    }, [order]);


    const restaurantLocation = useMemo(() => {
        // **THE FIX**: Correct path to location GeoPoint
        const loc = restaurant?.address?.location;
        if (loc instanceof GeoPoint) {
            return { latitude: loc.latitude, longitude: loc.longitude };
        }
        return null;
    }, [restaurant]);

    const customerLocation = useMemo(() => {
        // **THE FIX**: Get location from the order document itself
        const loc = order?.customerLocation;
        if (loc instanceof GeoPoint) {
            return { latitude: loc.latitude, longitude: loc.longitude };
        }
        return null;
    }, [order]);

    const riderLocation = useMemo(() => {
        const loc = deliveryBoy?.location;
        if (loc instanceof GeoPoint) {
            return { latitude: loc.latitude, longitude: loc.longitude };
        }
        return null;
    }, [deliveryBoy]);


    if (loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
                <h1 className="text-2xl font-bold mt-4">Finding Your Order...</h1>
            </div>
        );
    }

    if (error) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{error}</p>
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }

    if (!order) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                 <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4"/> Go Back</Button>
            </div>
        )
    }
    
    const showRiderDetails = order.status === 'dispatched' || order.status === 'delivered';


    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="p-4 border-b border-border flex justify-between items-center">
                <div>
                    <p className="text-xs text-muted-foreground">Tracking Order</p>
                    <h1 className="font-bold text-lg">{orderId}</h1>
                </div>
                <Button onClick={() => window.location.reload()} variant="outline" size="icon">
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </header>

            <main className="flex-grow flex flex-col">
                 <div className="p-4 bg-card border-b border-border">
                    <StatusTimeline currentStatus={order.status} />
                </div>

                <div className="flex-grow relative h-64 md:h-auto">
                    <LiveTrackingMap 
                        restaurantLocation={restaurantLocation}
                        customerLocation={customerLocation}
                        riderLocation={riderLocation}
                    />
                </div>
                
                <div className="p-4">
                   {showRiderDetails && <RiderDetails rider={deliveryBoy} />}
                </div>
            </main>
        </div>
    );
}
