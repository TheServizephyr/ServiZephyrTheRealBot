'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Home, User, ShoppingCart, ArrowLeft, Wallet, IndianRupee, Truck, ChevronsUpDown, Check, PlusCircle, CreditCard, Landmark, Split, Users as UsersIcon, Bell } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getAuth } from 'firebase/auth';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';


const CheckoutModal = ({ isOpen, onClose, onConfirm, grandTotal, loading, name, onNameChange, address, onAddressChange, error, isExistingUser, savedAddresses, selectedAddress, onSelectAddress, isAddingNew, onSetIsAddingNew, deliveryType, paxCount, onPaxCountChange, tabName, onTabNameChange, cartData }) => {
    
    const isDineIn = deliveryType === 'dine-in';
    const isNewTab = isDineIn && !cartData?.dineInTabId;
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl">{isNewTab ? "Start a New Tab" : "Confirm Your Details"}</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {loading && !isExistingUser && name === '' ? (
                        <div className="flex justify-center items-center h-48">
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    ) : (
                        <>
                            <div>
                                <Label htmlFor="checkout-name">{isDineIn ? "Your Name" : "Full Name"}</Label>
                                <div className="relative mt-1">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input id="checkout-name" type="text" value={name} onChange={(e) => onNameChange(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" />
                                </div>
                            </div>
                           
                            {!isDineIn && (
                                <div>
                                    <Label htmlFor="checkout-address">Delivery Address</Label>
                                    <div className="relative mt-1">
                                        <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                        <textarea id="checkout-address" value={address} onChange={(e) => onAddressChange(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border-border" placeholder="Enter your full delivery address" />
                                    </div>
                                </div>
                            )}

                            {isNewTab && (
                                <div className="grid grid-cols-2 gap-4">
                                     <div>
                                        <Label htmlFor="tab-name">Tab Name</Label>
                                        <input id="tab-name" value={tabName} onChange={e => onTabNameChange(e.target.value)} className="w-full mt-1 p-2 rounded-md bg-input border border-border" placeholder="e.g., Rohan's Group"/>
                                    </div>
                                    <div>
                                        <Label htmlFor="pax-count">Guests</Label>
                                        <input id="pax-count" type="number" min="1" value={paxCount} onChange={e => onPaxCountChange(parseInt(e.target.value, 10))} className="w-full mt-1 p-2 rounded-md bg-input border border-border" />
                                    </div>
                                </div>
                            )}

                            {error && <p className="text-red-500 text-sm text-center pt-2">{error}</p>}
                        </>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={onConfirm} className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled={loading}>
                        {loading ? 'Processing...' : (isNewTab ? 'Start Tab & Order' : `Confirm & Place Order`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const DineInPostOrderModal = ({ isOpen, onClose, onAddMore, onViewBill, tableId }) => {
    
    // Placeholder function for calling waiter
    const handleCallWaiter = () => {
        alert(`Notification sent: "SERVICE REQUEST: TABLE ${tableId}"`);
        // In a real app, this would trigger a WebSocket or Firebase event.
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Order Sent!</DialogTitle>
                    <DialogDescription>Your order has been sent to the kitchen. What would you like to do next?</DialogDescription>
                </DialogHeader>
                <div className="py-6 space-y-4">
                    <Button onClick={onAddMore} className="w-full h-14 text-lg bg-primary/20 text-primary hover:bg-primary/30 border-2 border-primary">
                        <PlusCircle className="mr-2"/> Add More to My Tab
                    </Button>
                     <Button onClick={onViewBill} className="w-full h-14 text-lg">
                        <Wallet className="mr-2"/> View Bill & Pay
                    </Button>
                </div>
                 <DialogFooter className="!justify-center">
                    <Button variant="outline" onClick={handleCallWaiter} className="flex items-center gap-2">
                        <Bell size={16}/> Call Waiter
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const CheckoutPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    const phone = searchParams.get('phone');
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');
    
    const [cart, setCart] = useState([]);
    const [cartData, setCartData] = useState(null);
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [paxCount, setPaxCount] = useState(1);
    const [tabName, setTabName] = useState('');
    
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [codEnabled, setCodEnabled] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);
    const [splitBillOptions, setSplitBillOptions] = useState(null);
    
    // Fetch cart and restaurant settings
    useEffect(() => {
        const fetchInitialData = async () => {
            if (!restaurantId) {
                router.push('/');
                return;
            }

            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                const parsedData = JSON.parse(savedCartData);
                const finalPhone = phone || parsedData.phone;
                
                const deliveryType = tableId ? 'dine-in' : (parsedData.deliveryType || 'delivery');

                const updatedData = { ...parsedData, phone: finalPhone, tableId: tableId || null, dineInTabId: tabId || null, deliveryType };

                setCart(updatedData.cart || []);
                setAppliedCoupons(updatedData.appliedCoupons || []);
                setCartData(updatedData);

                const locationStr = localStorage.getItem('customerLocation');
                if (locationStr) {
                    try {
                        const parsedLocation = JSON.parse(locationStr);
                        setAddress(parsedLocation.full || '');
                    } catch (e) { console.error("Could not parse location."); }
                }

            } else {
                 if (tabId) {
                    setCartData({ dineInTabId: tabId, deliveryType: 'dine-in', phone: phone });
                    // If no cart, but tabId exists, it means they want to pay
                    setSplitBillOptions({ active: true });
                } else {
                    router.push(`/order/${restaurantId}${tableId ? `?table=${tableId}`: ''}`);
                    return;
                }
            }
            
            try {
                 const res = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
                 if (res.ok) {
                    const data = await res.json();
                    const deliveryType = tableId ? 'dine-in' : (cartData?.deliveryType || 'delivery');
                    const isPickup = deliveryType === 'pickup';

                    if (deliveryType === 'delivery') {
                        setCodEnabled(data.deliveryCodEnabled || false);
                    } else if (isPickup) {
                         setCodEnabled(data.pickupPodEnabled || false);
                    } else { // dine-in
                        setCodEnabled(data.dineInPayAtCounterEnabled || false);
                    }

                 }
            } catch (err) {
                console.error("Could not fetch restaurant settings for COD:", err);
                setCodEnabled(false);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, [restaurantId, router, phone, tableId, tabId]);


    useEffect(() => {
        const fetchUserData = async () => {
            if (isModalOpen && cartData?.phone) {
                setLoading(true);
                setError('');
                try {
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: cartData.phone }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setName(data.name);
                        setTabName(`${data.name}'s Group`);
                        setIsExistingUser(true);
                    } else {
                        setIsExistingUser(false);
                        setName('');
                        setTabName('');
                    }
                } catch (err) {
                    setError('Could not fetch user details. Please enter manually.');
                    setIsExistingUser(false);
                } finally {
                    setLoading(false);
                }
            }
        };
        fetchUserData();
    }, [isModalOpen, cartData?.phone]);
    
    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);
    
    const { totalDiscount, finalDeliveryCharge, cgst, sgst, grandTotal } = useMemo(() => {
        if (!cartData) return { totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, grandTotal: subtotal };

        const deliveryType = cartData.tableId ? 'dine-in' : (cartData.deliveryType || 'delivery');

        let couponDiscountValue = 0;
        appliedCoupons.forEach(coupon => {
            if (subtotal >= coupon.minOrder) {
                if (coupon.type === 'flat') couponDiscountValue += coupon.value;
                else if (coupon.type === 'percentage') couponDiscountValue += (subtotal * coupon.value) / 100;
            }
        });
        
        const hasFreeDelivery = appliedCoupons.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        const deliveryCharge = (deliveryType !== 'delivery' || hasFreeDelivery) ? 0 : (cartData.deliveryCharge || 0);

        const tip = (deliveryType === 'delivery' ? (cartData.tipAmount || 0) : 0);

        const taxableAmount = subtotal - couponDiscountValue;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const finalGrandTotal = taxableAmount + deliveryCharge + (tax * 2) + tip;
        
        return { 
            totalDiscount: couponDiscountValue, 
            finalDeliveryCharge: deliveryCharge, 
            cgst: tax, sgst: tax, grandTotal: finalGrandTotal
        };
    }, [cartData, cart, appliedCoupons, subtotal]);


    const handlePaymentMethodSelect = (method) => {
        setSelectedPaymentMethod(method);
        setIsModalOpen(true);
    };
    
    const handleAddMoreToTab = () => {
        router.push(`/order/${restaurantId}?table=${tableId}&phone=${phone}&tabId=${tabId}`);
    };

    const handleViewBill = () => {
        setDineInModalOpen(false);
        setSplitBillOptions({ active: true });
    };

    const handleConfirmOrder = async () => {
        const deliveryType = cartData.tableId ? 'dine-in' : (cartData.deliveryType || 'delivery');
        const finalAddress = deliveryType !== 'delivery' ? 'Self Pickup / Dine-In' : address;
        
        if (deliveryType === 'delivery' && !address.trim()) {
            setError('Please enter your delivery address.');
            return;
        }
        if (!name.trim()) {
            setError('Please enter your name.');
            return;
        }
        if (deliveryType === 'dine-in' && !cartData.dineInTabId && (!tabName.trim() || paxCount < 1)) {
            setError('Please provide a name for your tab and the number of guests.');
            return;
        }

        setError('');
        setLoading(true);

        const finalItems = cart.map(item => ({
            name: `${item.name} (${item.portion.name})${item.selectedAddOns.map(a => ` + ${a.name}`).join('')}`,
            qty: item.quantity,
            price: item.totalPrice,
        }));
        
        const orderPayload = {
            name: name.trim(),
            address: finalAddress,
            phone: cartData.phone,
            restaurantId,
            items: finalItems,
            notes: cartData.notes || '',
            coupon: appliedCoupons.length > 0 ? { code: appliedCoupons.map(c => c.code).join(', '), discount: totalDiscount } : null,
            loyaltyDiscount: 0,
            grandTotal,
            paymentMethod: selectedPaymentMethod,
            businessType: cartData.businessType || 'restaurant',
            deliveryType: deliveryType,
            tableId: cartData.tableId || null,
            dineInTabId: cartData.dineInTabId || null,
            pax_count: cartData.dineInTabId ? null : paxCount,
            tab_name: cartData.dineInTabId ? null : tabName,
            pickupTime: cartData.pickupTime || '',
            tipAmount: deliveryType === 'delivery' ? cartData.tipAmount || 0 : 0,
            subtotal, cgst, sgst, deliveryCharge: finalDeliveryCharge,
        };

        try {
            const orderCreationResponse = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload),
            });

            const orderCreationResult = await orderCreationResponse.json();
            if (!orderCreationResponse.ok) throw new Error(orderCreationResult.message || "Failed to create order.");
            
            const { firestore_order_id, razorpay_order_id, dine_in_tab_id } = orderCreationResult;

            // Important: Update tabId for subsequent actions
            if (dine_in_tab_id) {
                const currentCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
                localStorage.setItem(`cart_${restaurantId}`, JSON.stringify({ ...currentCart, dineInTabId: dine_in_tab_id }));
                setCartData(prev => ({ ...prev, dineInTabId: dine_in_tab_id }));
            }


            if (selectedPaymentMethod === 'razorpay') {
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amount: Math.round(grandTotal * 100), currency: "INR",
                    name: "ServiZephyr (Pvt. Ltd.)", description: `Payment for Order`, order_id: razorpay_order_id,
                    handler: function (response) {
                        if (deliveryType === 'dine-in') {
                            setIsModalOpen(false);
                            setDineInModalOpen(true);
                            const currentCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
                            localStorage.setItem(`cart_${restaurantId}`, JSON.stringify({ ...currentCart, cart: [] }));
                            setCart([]);
                        } else {
                             localStorage.removeItem(`cart_${restaurantId}`);
                            router.push(`/track/${firestore_order_id}`);
                        }
                    },
                    prefill: { name: name.trim(), contact: cartData.phone }, theme: { color: "#4f46e5" }
                };
                
                setIsModalOpen(false);
                setTimeout(() => {
                    const rzp1 = new window.Razorpay(options);
                    rzp1.on('payment.failed', function (response) {
                        setIsModalOpen(true);
                        setError(`Payment Failed: ${response.error.description}`);
                        setLoading(false);
                    });
                    rzp1.open();
                }, 200);

            } else { // COD, POD or Pay at Counter
                 if (deliveryType === 'dine-in') {
                      setIsModalOpen(false);
                      setDineInModalOpen(true);
                      const currentCart = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
                      localStorage.setItem(`cart_${restaurantId}`, JSON.stringify({ ...currentCart, cart: [] }));
                      setCart([]);
                 } else {
                     localStorage.removeItem(`cart_${restaurantId}`);
                     router.push(`/track/${firestore_order_id}`);
                 }
            }

        } catch (err) {
            setError(err.message || 'An unexpected error occurred.');
            setLoading(false);
        }
    };
    
    if (loading && !cartData) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        );
    }
    
    const deliveryType = tableId ? 'dine-in' : (cartData?.deliveryType || 'delivery');
    
    return (
        <>
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <CheckoutModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={handleConfirmOrder}
                grandTotal={grandTotal}
                loading={loading}
                name={name} onNameChange={setName}
                address={address} onAddressChange={setAddress}
                error={error}
                isExistingUser={isExistingUser}
                deliveryType={deliveryType}
                paxCount={paxCount} onPaxCountChange={setPaxCount}
                tabName={tabName} onTabNameChange={setTabName}
                cartData={cartData}
            />
             <DineInPostOrderModal
                isOpen={isDineInModalOpen}
                onClose={() => setDineInModalOpen(false)}
                onAddMore={handleAddMoreToTab}
                onViewBill={handleViewBill}
                tableId={tableId}
            />
            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10">
                            <ArrowLeft />
                        </Button>
                        <div>
                            <p className="text-xs text-muted-foreground">Step 2 of 2</p>
                            <h1 className="text-xl font-bold">{splitBillOptions?.active ? 'Pay Your Bill' : 'Choose Payment Method'}</h1>
                        </div>
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                         <div className="bg-card p-4 rounded-lg border border-border mb-6">
                            <div className="flex justify-between items-center text-lg font-bold">
                                <span>Total Amount Payable</span>
                                <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span>
                            </div>
                        </div>

                        {splitBillOptions?.active ? (
                             <div className="space-y-4">
                                <h2 className="text-xl font-bold text-center">How would you like to pay?</h2>
                                <Button className="w-full h-16 text-lg"><Wallet className="mr-2"/>Pay Full Bill</Button>
                                <Button variant="outline" className="w-full h-16 text-lg"><Split className="mr-2"/>Split The Bill</Button>
                            </div>
                        ) : (
                             <div className="space-y-4">
                                 <motion.button
                                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                    onClick={() => handlePaymentMethodSelect('razorpay')}
                                    className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all"
                                >
                                    <div className="flex items-center gap-2">
                                        <CreditCard size={24} className="text-primary"/>
                                        <Landmark size={24} className="text-primary"/>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold">Pay Online</h3>
                                        <p className="text-muted-foreground">UPI, Credit/Debit Card, Netbanking</p>
                                    </div>
                                </motion.button>
                                
                                {loading ? (
                                    <div className="w-full p-6 bg-card border-2 border-border rounded-lg animate-pulse h-[116px]"><div className="h-6 bg-muted rounded w-3/4"></div></div>
                                ) : codEnabled ? (
                                    <motion.button
                                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                        onClick={() => handlePaymentMethodSelect('cod')}
                                        className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all"
                                    >
                                        <IndianRupee size={40} className="text-primary flex-shrink-0"/>
                                        <div>
                                            <h3 className="text-xl font-bold">{deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' ? 'Pay at Counter' : 'Pay on Delivery')}</h3>
                                            <p className="text-muted-foreground">Pay with cash or UPI when you receive your order</p>
                                        </div>
                                    </motion.button>
                                ) : (
                                    <div className="w-full text-left p-6 bg-muted/50 border-2 border-dashed border-border rounded-lg flex items-center gap-6 opacity-60">
                                        <IndianRupee size={40} className="text-muted-foreground flex-shrink-0"/>
                                        <div>
                                            <h3 className="text-xl font-bold text-muted-foreground">{deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' ? 'Pay at Counter' : 'Pay on Delivery')}</h3>
                                            <p className="text-muted-foreground">This restaurant is not currently accepting this payment method.</p>
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
