
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Bike, Home, Star, Phone, MapPin, Navigation, RefreshCw, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useParams, useRouter } from 'next/navigation';
import { useDoc } from '@/firebase/firestore/use-doc';
import { doc, getDoc, GeoPoint } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import dynamic from 'next/dynamic';

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), { ssr: false });

const statusConfig = {
  confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1 },
  preparing: { title: 'Food is being prepared', icon: <CookingPot size={24} />, step: 2 },
  dispatched: { title: 'Out for Delivery', icon: <Bike size={24} />, step: 3 },
  delivered: { title: 'Delivered', icon: <Home size={24} />, step: 4 },
};

const StatusTimeline = ({ currentStatus }) => {
    const currentStep = statusConfig[currentStatus]?.step || 0;
  
    return (
      <div className="flex justify-between items-center w-full px-4 pt-4">
        {Object.values(statusConfig).map(({ title, icon, step }) => {
          const isCompleted = step <= currentStep;
          const isCurrent = step === currentStep;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center text-center">
                <motion.div
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                    isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                  }`}
                  animate={{ scale: isCurrent ? 1.1 : 1 }}
                  transition={{ type: 'spring' }}
                >
                  {icon}
                </motion.div>
                <p className={`mt-2 text-xs font-semibold ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {title}
                </p>
              </div>
              {step < 4 && (
                <div className="flex-1 h-1 mx-2 rounded-full bg-border">
                  <motion.div
                    className="h-full bg-primary rounded-full"
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
                        <AvatarFallback>{rider.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-bold text-lg text-foreground">{rider.name}</p>
                        <div className="flex items-center gap-1 text-sm text-yellow-400">
                            <Star size={16} className="fill-current"/> <span>{rider.rating?.toFixed(1) || '4.5'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" className="h-11 w-11">
                        <a href={`tel:${rider.phone}`}><Phone /></a>
                    </Button>
                     <Button size="icon" className="h-11 w-11 bg-primary text-primary-foreground">
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
    const firestore = useFirestore();

    const [order, setOrder] = useState(null);
    const [restaurant, setRestaurant] = useState(null);
    const [deliveryBoy, setDeliveryBoy] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    // Real-time listener for the order
    const { data: orderData, isLoading: isOrderLoading, error: orderError } = useDoc(
        orderId ? doc(firestore, 'orders', orderId) : null
    );

    // This effect now logs the specific error from the API
    useEffect(() => {
        if(orderError) {
            console.error("Firestore Order Hook Error:", orderError);
        }
    }, [orderError]);
    
    // Fetch related data when order data is available
    useEffect(() => {
        if (orderData) {
            setOrder(orderData);
            const fetchRelatedData = async () => {
                try {
                    // Fetch restaurant details
                    const restaurantRef = doc(firestore, 'restaurants', orderData.restaurantId);
                    const restaurantSnap = await getDoc(restaurantRef);
                    if (restaurantSnap.exists()) {
                        setRestaurant({ id: restaurantSnap.id, ...restaurantSnap.data()});
                    } else {
                        throw new Error("Restaurant not found");
                    }

                } catch (err) {
                    console.error("Error fetching related data:", err);
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
            };
            fetchRelatedData();
        }
    }, [orderData, firestore]);
    
    // Real-time listener for the delivery boy
    const { data: deliveryBoyData } = useDoc(
        order?.deliveryBoyId ? doc(firestore, 'deliveryBoys', order.deliveryBoyId) : null
    );
    
    useEffect(() => {
        if(deliveryBoyData){
            setDeliveryBoy(deliveryBoyData);
        }
    }, [deliveryBoyData]);


    const handleRefresh = () => {
        // This function can be expanded later if needed, but onSnapshot handles real-time.
        // For now, it provides user feedback.
        setLoading(true);
        setTimeout(() => setLoading(false), 1000);
    };

    if (isOrderLoading || loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
                <h1 className="text-2xl font-bold mt-4">Loading Your Order...</h1>
            </div>
        );
    }

    if (orderError || error) {
        return (
             <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{orderError?.message || error}</p>
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

    const restaurantLocation = new GeoPoint(restaurant?.location?.latitude || 28.7041, restaurant?.location?.longitude || 77.1025);
    const customerLocation = new GeoPoint(order.customerLocation?.latitude || 28.7041, order.customerLocation?.longitude || 77.1025);
    const riderLocation = deliveryBoy?.location || null;


    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="p-4 border-b border-border flex justify-between items-center">
                <div>
                    <p className="text-xs text-muted-foreground">Tracking Order</p>
                    <h1 className="font-bold text-lg">{orderId}</h1>
                </div>
                <Button onClick={handleRefresh} variant="outline" size="icon">
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>

            <main className="flex-grow flex flex-col">
                 <div className="p-4 bg-card border-b border-border">
                    <StatusTimeline currentStatus={order.status} />
                </div>

                <div className="flex-grow relative">
                    <LiveTrackingMap 
                        restaurantLocation={restaurantLocation}
                        customerLocation={customerLocation}
                        riderLocation={riderLocation}
                    />
                </div>
                
                <div className="p-4">
                    <RiderDetails rider={deliveryBoy} />
                </div>
            </main>
        </div>
    );
}

const getDoc = async (ref) => {
  const { getDoc: fsGetDoc } = await import("firebase/firestore");
  return fsGetDoc(ref);
};
