

'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, ShoppingCart, CookingPot, Ticket, Gift, ArrowLeft, Sparkles, Check, PlusCircle, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, Bike, Store, Heart } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

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
    const timeOptions = ["In 15 mins", "In 30 mins", "In 45 mins", "In 1 hour", "Tomorrow"];

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Confirm Pickup Time</DialogTitle>
                    <DialogDescription>Let the restaurant know when you'll be arriving so they can prepare your order accordingly.</DialogDescription>
                </DialogHeader>
                <div className="py-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {timeOptions.map(time => (
                        <button
                            key={time}
                            onClick={() => setPickupTime(time)}
                            className={cn(
                                "p-4 rounded-lg border-2 font-semibold transition-all",
                                pickupTime === time ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                            )}
                        >
                            {time}
                        </button>
                    ))}
                    <Input 
                        placeholder="Or type custom time..."
                        value={timeOptions.includes(pickupTime) ? '' : pickupTime}
                        onChange={(e) => setPickupTime(e.target.value)}
                        className={cn(
                            "sm:col-span-3 p-4 rounded-lg border-2 font-semibold transition-all h-auto text-base",
                            !timeOptions.includes(pickupTime) && pickupTime ? "border-primary bg-primary/10 text-primary" : "border-border"
                        )}
                    />
                </div>
                <DialogFooter>
                     <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button onClick={onConfirm} disabled={!pickupTime.trim()}>Confirm Time</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const CartPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    
    const phoneFromUrl = searchParams.get('phone');
    const phoneFromStorage = typeof window !== 'undefined' ? localStorage.getItem('lastKnownPhone') : null;
    const initialPhone = phoneFromUrl || phoneFromStorage;

    const [cartData, setCartData] = useState(null);
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [isClearCartDialogOpen, setIsClearCartDialogOpen] = useState(false);
    const [phone, setPhone] = useState(initialPhone);
    const [isBillExpanded, setIsBillExpanded] = useState(false);

    // New state for delivery type and tip
    const [deliveryType, setDeliveryType] = useState('delivery');
    const [tipAmount, setTipAmount] = useState(0);
    const [customTip, setCustomTip] = useState('');
    const [isPickupModalOpen, setIsPickupModalOpen] = useState(false);
    const [pickupTime, setPickupTime] = useState('');

    // State for coupon popover
    const [isCouponPopoverOpen, setCouponPopoverOpen] = useState(false);
    
    useEffect(() => {
        if (!restaurantId) return;

        const phoneToUse = phoneFromUrl || phoneFromStorage;
        if (phoneToUse) {
            setPhone(phoneToUse);
            if (typeof window !== 'undefined') {
                localStorage.setItem('lastKnownPhone', phoneToUse);
            }
        }

        const data = localStorage.getItem(`cart_${restaurantId}`);
        if (data) {
            const parsedData = JSON.parse(data);
            setCartData(parsedData);
            setCart(parsedData.cart || []);
            setNotes(parsedData.notes || '');
            setAppliedCoupons(parsedData.appliedCoupons || []);
            
            // Set initial delivery type based on restaurant settings
            if (parsedData.deliveryEnabled && !parsedData.pickupEnabled) {
                setDeliveryType('delivery');
            } else if (!parsedData.deliveryEnabled && parsedData.pickupEnabled) {
                setDeliveryType('pickup');
            } else {
                setDeliveryType(parsedData.deliveryType || 'delivery');
            }

            setTipAmount(parsedData.tipAmount || 0);
            setPickupTime(parsedData.pickupTime || '');
        } else {
            setCart([]);
            setAppliedCoupons([]);
        }

    }, [restaurantId, phoneFromUrl, phoneFromStorage]);

    const updateCartInStorage = (updates) => {
        const currentData = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
        const updatedData = { ...currentData, ...updates };

        setCartData(updatedData);
        if(updates.cart !== undefined) setCart(updates.cart);
        if(updates.notes !== undefined) setNotes(updates.notes);
        if(updates.appliedCoupons !== undefined) setAppliedCoupons(updates.appliedCoupons);
        if(updates.deliveryType !== undefined) setDeliveryType(updates.deliveryType);
        if(updates.tipAmount !== undefined) setTipAmount(updates.tipAmount);
        if(updates.pickupTime !== undefined) setPickupTime(updates.pickupTime);

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
        updateCartInStorage({ cart: [], appliedCoupons: [], tipAmount: 0, deliveryType: 'delivery' });
    };

    const handleConfirmOrder = () => {
        // The data is already saved in localStorage, just navigate
        router.push(`/checkout?restaurantId=${restaurantId}&phone=${phone}`);
    };

    const handleGoBack = () => {
        router.push(`/order/${restaurantId}?phone=${phone}`);
    };

    const handleDeliveryTypeChange = (type) => {
        if (type === 'pickup') {
            setIsPickupModalOpen(true);
        } else {
            updateCartInStorage({ deliveryType: 'delivery', tipAmount: tipAmount, pickupTime: '' });
        }
    };
    
    const handleConfirmPickup = () => {
        updateCartInStorage({ deliveryType: 'pickup', pickupTime: pickupTime, tipAmount: 0 }); // Reset tip for pickup
        setIsPickupModalOpen(false);
    };

    const handleTipChange = (amount) => {
        const newTip = Number(amount);
        setTipAmount(newTip);
        if(customTip && newTip !== Number(customTip)) setCustomTip('');
        updateCartInStorage({ tipAmount: newTip });
    };

    const handleCustomTipChange = (e) => {
        const value = e.target.value;
        setCustomTip(value);
        if (value === '' || isNaN(value)) {
            if(tipAmount !== 0 && tipAmount !== 10 && tipAmount !== 20 && tipAmount !== 50) handleTipChange(0);
        } else {
            handleTipChange(Number(value));
        }
    };

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);

    const { totalDiscount, couponDiscount, specialCouponDiscount } = useMemo(() => {
        let couponDiscount = 0;
        let specialCouponDiscount = 0;

        appliedCoupons.forEach(coupon => {
            if (subtotal < coupon.minOrder) return;
            
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
        };
    }, [appliedCoupons, subtotal]);

    const finalDeliveryCharge = useMemo(() => {
        if (deliveryType === 'pickup' || !cartData) return 0;
        const hasFreeDelivery = appliedCoupons.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        return hasFreeDelivery ? 0 : cartData.deliveryCharge;
    }, [appliedCoupons, cartData, subtotal, deliveryType]);

    const { cgst, sgst, grandTotal } = useMemo(() => {
        const taxableAmount = subtotal - totalDiscount;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const finalTip = deliveryType === 'delivery' ? tipAmount : 0;
        const total = taxableAmount + finalDeliveryCharge + (tax * 2) + finalTip;
        return { cgst: tax, sgst: tax, grandTotal: total };
    }, [subtotal, totalDiscount, finalDeliveryCharge, tipAmount, deliveryType]);


    const handleToggleCoupon = (couponToToggle) => {
        let newAppliedCoupons;
        const isApplied = appliedCoupons.some(c => c.id === couponToToggle.id);

        if (isApplied) {
            newAppliedCoupons = appliedCoupons.filter(c => c.id !== couponToToggle.id);
        } else {
            if (subtotal < couponToToggle.minOrder) {
                alert(`You need to spend at least ₹${couponToToggle.minOrder} to use this coupon.`);
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

    const isDeliveryEnabled = cartData?.deliveryEnabled ?? true;
    const isPickupEnabled = cartData?.pickupEnabled ?? false;

    if (!cartData || !restaurantId) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-muted-foreground p-4">
                <ShoppingCart size={48} className="mb-4" />
                <h1 className="text-2xl font-bold">Your Cart is Empty</h1>
                <p className="mt-2">Looks like you haven't added anything to your cart yet.</p>
                <Button onClick={() => router.back()} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
                </Button>
            </div>
        );
    }
    
    return (
        <>
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />
        <ClearCartDialog 
            isOpen={isClearCartDialogOpen}
            onClose={() => setIsClearCartDialogOpen(false)}
            onConfirm={handleClearCart}
        />
        <PickupTimeModal 
            isOpen={isPickupModalOpen}
            onClose={() => setIsPickupModalOpen(false)}
            onConfirm={handleConfirmPickup}
            pickupTime={pickupTime}
            setPickupTime={setPickupTime}
        />
        <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
             <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                     <Button variant="ghost" size="icon" onClick={handleGoBack} className="h-10 w-10">
                        <ArrowLeft />
                    </Button>
                    <div>
                        <p className="text-xs text-muted-foreground">Reviewing Your Order from</p>
                        <h1 className="text-xl font-bold">{cartData.restaurantName}</h1>
                    </div>
                </div>
            </header>

            <main className="flex-grow p-4 container mx-auto pb-28">
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
                        <div className="p-4 bg-card rounded-lg border border-border">
                            <div className="flex bg-muted p-1 rounded-lg">
                                <button 
                                    onClick={() => isDeliveryEnabled && handleDeliveryTypeChange('delivery')} 
                                    className={cn(
                                        "flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all",
                                        deliveryType === 'delivery' && 'bg-background shadow-sm',
                                        !isDeliveryEnabled && 'opacity-50 cursor-not-allowed'
                                    )}
                                    disabled={!isDeliveryEnabled}
                                    title={!isDeliveryEnabled ? "Delivery not available" : ""}
                                >
                                    <Bike size={16} /> Delivery
                                </button>
                                <button 
                                    onClick={() => isPickupEnabled && handleDeliveryTypeChange('pickup')} 
                                    className={cn(
                                        "flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all",
                                        deliveryType === 'pickup' && 'bg-background shadow-sm',
                                        !isPickupEnabled && 'opacity-50 cursor-not-allowed'
                                    )}
                                    disabled={!isPickupEnabled}
                                    title={!isPickupEnabled ? "Pickup not available" : ""}
                                >
                                    <Store size={16} /> Pickup
                                </button>
                            </div>
                        </div>

                        <div className="bg-card p-4 rounded-lg border border-border mt-4">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-bold text-lg">Your Items</h3>
                                 <Button variant="destructive" size="sm" onClick={() => setIsClearCartDialogOpen(true)}><Trash2 className="mr-2 h-4 w-4"/> Clear</Button>
                            </div>
                            <div className="space-y-4">
                                {cart.map(item => (
                                    <motion.div 
                                        layout
                                        key={item.cartItemId}
                                        className="flex items-center gap-4"
                                    >
                                        <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center flex-shrink-0`}>
                                            <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                                        </div>
                                        <div className="flex-grow">
                                          <p className="font-semibold text-foreground">{item.name}</p>
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
                                        <p className="w-20 text-right font-bold">₹{item.totalPrice * item.quantity}</p>
                                    </motion.div>
                                ))}
                            </div>

                            <Button variant="outline" onClick={handleGoBack} className="w-full mt-4 border-green-500 text-green-500 bg-green-500/10 hover:bg-green-500/20 hover:text-green-500">
                                <PlusCircle className="mr-2 h-4 w-4" /> Add more items
                            </Button>
                            
                            <div className="relative mt-4 pt-4 border-t border-dashed border-border">
                                <CookingPot className="absolute left-0 top-7 h-5 w-5 text-muted-foreground"/>
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
                                            <span className="flex items-center text-primary font-semibold"><Check className="mr-2 h-4 w-4"/> {appliedCoupons.length} Coupon(s) Applied</span>
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
                                              <p className="text-sm font-semibold flex items-center gap-2 text-primary"><Sparkles size={16}/> Special for you</p>
                                              {specialCoupons.map(coupon => {
                                                  const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                                  return (
                                                      <div key={coupon.id} onClick={() => handleToggleCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", isApplied ? "border-primary bg-primary/10" : "border-dashed border-primary/50 bg-background")}>
                                                          <div className="flex justify-between items-center">
                                                              <p className="font-bold text-foreground">{coupon.code}</p>
                                                              {isApplied ? <button onClick={(e) => {e.stopPropagation(); handleToggleCoupon(coupon);}} className="p-1 rounded-full hover:bg-destructive/20"><X size={14} className="text-destructive" /></button> : <Check size={16} className="text-muted-foreground" />}
                                                          </div>
                                                          <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                      </div>
                                                  )
                                              })}
                                              <hr className="my-4 border-border"/>
                                          </div>
                                      )}
                                      
                                      {normalCoupons.length > 0 ? normalCoupons.map(coupon => {
                                           const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                           return (
                                              <div key={coupon.id} onClick={() => handleToggleCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", isApplied ? "border-primary bg-primary/10" : "border-border bg-background")}>
                                                  <div className="flex justify-between items-center">
                                                      <p className="font-bold text-foreground">{coupon.code}</p>
                                                      {isApplied ? <button onClick={(e) => {e.stopPropagation(); handleToggleCoupon(coupon);}} className="p-1 rounded-full hover:bg-destructive/20"><X size={14} className="text-destructive" /></button> : <Check size={16} className="text-muted-foreground" />}
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
                        {deliveryType === 'delivery' && (
                            <motion.div 
                                className="p-4 mt-4 bg-card rounded-lg border border-border"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                            >
                                <div className="flex items-center gap-2">
                                     <Heart size={16} className="text-primary"/>
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
                                        value={customTip}
                                        onChange={handleCustomTipChange}
                                        className={cn("flex-1", tipAmount !== 0 && ![10,20,50].includes(tipAmount) && "border-primary ring-2 ring-primary")} 
                                    />
                                </div>
                            </motion.div>
                        )}
                        </AnimatePresence>


                        <div className="mt-6 p-4 border-t-2 border-primary bg-card rounded-lg shadow-lg">
                             <div className="flex justify-between items-center">
                                <h3 className="text-xl font-bold">Bill Summary</h3>
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
                                            {deliveryType === 'delivery' && (
                                                <div className="flex justify-between"><span>Delivery Fee:</span> {finalDeliveryCharge > 0 ? <span>₹{finalDeliveryCharge.toFixed(2)}</span> : <span className="text-primary font-bold">FREE</span>}</div>
                                            )}
                                            {tipAmount > 0 && <div className="flex justify-between text-green-400"><span>Rider Tip:</span> <span className="font-medium">+ ₹{tipAmount.toFixed(2)}</span></div>}
                                            <div className="flex justify-between"><span>CGST ({5}%):</span> <span className="font-medium">₹{cgst.toFixed(2)}</span></div>
                                            <div className="flex justify-between"><span>SGST ({5}%):</span> <span className="font-medium">₹{sgst.toFixed(2)}</span></div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            
                            <div className="border-t border-dashed border-border my-3"></div>
                            
                            <div className="flex justify-between items-center text-lg font-bold">
                                 <span>Grand Total:</span>
                                <div className="flex items-center gap-3">
                                {totalDiscount > 0 && (
                                    <span className="text-muted-foreground line-through text-base font-medium">₹{(subtotal + finalDeliveryCharge + (cgst*2) + (deliveryType === 'delivery' ? tipAmount : 0)).toFixed(2)}</span>
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

            <footer className="fixed bottom-0 left-0 w-full bg-background/80 backdrop-blur-lg border-t border-border z-30">
                <div className="container mx-auto p-4 flex items-center justify-center gap-4">
                    <Button onClick={handleConfirmOrder} className="flex-grow bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg font-bold" disabled={cart.length === 0}>
                        Confirm Order
                    </Button>
                </div>
            </footer>
        </div>
        </>
    );
}

const CartPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>}>
        <CartPageInternal />
    </Suspense>
);

export default CartPage;



    