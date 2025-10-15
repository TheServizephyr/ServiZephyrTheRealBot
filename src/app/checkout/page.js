
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Home, User, ShoppingCart, ArrowLeft, Wallet, IndianRupee, Truck } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getAuth } from 'firebase/auth';


const CheckoutModal = ({ isOpen, onClose, onConfirm, grandTotal, loading, name, onNameChange, address, onAddressChange, error, isExistingUser, savedAddresses, selectedAddress, onSelectAddress, isAddingNew, onSetIsAddingNew }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Confirm Your Details</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {loading && !isExistingUser && name === '' ? (
                        <div className="flex justify-center items-center h-48">
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    ) : (
                        <>
                            <div>
                                <Label htmlFor="checkout-name">Full Name</Label>
                                <div className="relative mt-1">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input id="checkout-name" type="text" value={name} onChange={(e) => onNameChange(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" disabled={isExistingUser && !isAddingNew} />
                                </div>
                            </div>
                           
                            {isExistingUser && savedAddresses.length > 0 && (
                                <div>
                                    <Label>Select Address</Label>
                                    <div className="space-y-2 mt-1">
                                        {savedAddresses.map(addr => (
                                            <div key={addr.id} onClick={() => onSelectAddress(addr.full)} className={cn("p-3 rounded-md border-2 cursor-pointer", !isAddingNew && selectedAddress === addr.full ? 'border-primary bg-primary/10' : 'border-border')}>
                                                {addr.full}
                                            </div>
                                        ))}
                                         <div onClick={() => onSetIsAddingNew(true)} className={cn("p-3 rounded-md border-2 cursor-pointer flex items-center gap-2", isAddingNew ? 'border-primary bg-primary/10' : 'border-border')}>
                                            <Wallet size={16}/> Add a new address
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(isAddingNew || !isExistingUser || savedAddresses.length === 0) && (
                                 <div>
                                    <Label htmlFor="checkout-address">Delivery Address</Label>
                                    <div className="relative mt-1">
                                        <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                        <textarea id="checkout-address" value={address} onChange={(e) => onAddressChange(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border-border" placeholder="Enter your full delivery address" />
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
                        {loading ? 'Processing...' : `Confirm & Place Order`}
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
    
    // States for cart and user details
    const [cart, setCart] = useState([]);
    const [cartData, setCartData] = useState(null);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddress, setSelectedAddress] = useState('');
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [isExistingUser, setIsExistingUser] = useState(false);

    // States for page logic
    const [codEnabled, setCodEnabled] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Fetch cart and restaurant settings
    useEffect(() => {
        const fetchInitialData = async () => {
            if (!restaurantId) {
                router.push('/');
                return;
            }

            // 1. Fetch Cart from Local Storage
            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                const parsedData = JSON.parse(savedCartData);
                setCart(parsedData.cart || []);
                setCartData(parsedData);
            } else {
                // If no cart, redirect back
                router.push(`/order/${restaurantId}`);
                return;
            }
            
            // 2. Fetch Restaurant Settings (for COD status)
            try {
                const auth = getAuth();
                // This part doesn't need auth, so we can call it directly
                // In a real app, you might want to protect this if settings are sensitive
                 const res = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`); // This is a public API now
                 if (res.ok) {
                    const data = await res.json();
                    setCodEnabled(data.codEnabled || false);
                 }
            } catch (err) {
                console.error("Could not fetch restaurant settings for COD:", err);
                // Assume COD is disabled if fetch fails
                setCodEnabled(false);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, [restaurantId, router]);


    // Fetch user details when modal is about to open
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
                        setSavedAddresses(data.addresses);
                        if (data.addresses && data.addresses.length > 0) {
                            setSelectedAddress(data.addresses[0].full);
                            setIsAddingNew(false);
                        } else {
                            setIsAddingNew(true);
                        }
                        setIsExistingUser(true);
                    } else {
                        setIsExistingUser(false);
                        setIsAddingNew(true);
                        setName('');
                        setAddress('');
                        setSavedAddresses([]);
                        setSelectedAddress('');
                    }
                } catch (err) {
                    setError('Could not fetch user details. Please enter manually.');
                    setIsExistingUser(false);
                    setIsAddingNew(true);
                } finally {
                    setLoading(false);
                }
            }
        };
        fetchUserData();
    }, [isModalOpen, cartData?.phone]);
    
    // --- CALCULATIONS (from cart page) ---
    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);
    const { totalDiscount, finalDeliveryCharge, grandTotal } = useMemo(() => {
        let couponDiscount = 0;
        const hasFreeDelivery = cartData?.appliedCoupons?.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        const finalDeliveryCharge = hasFreeDelivery ? 0 : (cartData?.deliveryCharge || 0);

        // This is a simplified discount calculation. In a real app, it would be more complex.
        const totalDiscount = couponDiscount;
        const taxableAmount = subtotal - totalDiscount;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const grandTotal = taxableAmount + finalDeliveryCharge + (tax * 2);
        
        return { totalDiscount, finalDeliveryCharge, grandTotal };
    }, [cart, cartData, subtotal]);

    const handlePaymentMethodSelect = (method) => {
        setSelectedPaymentMethod(method);
        setIsModalOpen(true);
    };

    const handleConfirmOrder = async () => {
        const finalAddress = isAddingNew ? address : selectedAddress;
        if (!finalAddress || !name.trim()) {
            setError('Please enter your name and address.');
            return;
        }
        setError('');
        setLoading(true);

        const finalItems = cart.map(item => ({
            name: `${item.name} (${item.portion.name})${item.selectedAddOns.map(a => ` + ${a.name}`).join('')}`,
            quantity: item.quantity,
            price: item.totalPrice,
        }));
        
        const orderPayload = {
            name: name.trim(),
            address: finalAddress,
            phone: cartData.phone,
            restaurantId,
            items: finalItems,
            notes: cartData.notes || '',
            coupon: cartData.appliedCoupons?.length > 0 ? {
                code: cartData.appliedCoupons[0].code,
                discount: totalDiscount, // Simplified
            } : null,
            loyaltyDiscount: 0, // Simplified
            grandTotal,
            paymentMethod: selectedPaymentMethod,
        };

        try {
            const orderCreationResponse = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload),
            });

            const orderCreationResult = await orderCreationResponse.json();

            if (!orderCreationResponse.ok) {
                throw new Error(orderCreationResult.message || "Failed to create order.");
            }
            
            const { firestore_order_id, razorpay_order_id } = orderCreationResult;

            if (selectedPaymentMethod === 'razorpay') {
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                    amount: grandTotal * 100,
                    currency: "INR",
                    name: "ServiZephyr (Pvt. Ltd.)",
                    description: `Payment for Order`,
                    order_id: razorpay_order_id,
                    handler: function (response) {
                        localStorage.removeItem(`cart_${restaurantId}`);
                        router.push(`/track/${firestore_order_id}`);
                    },
                    prefill: { name: name.trim(), contact: cartData.phone },
                    theme: { color: "#4f46e5" }
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

            } else { // COD
                 localStorage.removeItem(`cart_${restaurantId}`);
                 router.push(`/track/${firestore_order_id}`);
                 setIsModalOpen(false);
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
    
    return (
        <>
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <CheckoutModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={handleConfirmOrder}
                grandTotal={grandTotal}
                loading={loading}
                name={name}
                onNameChange={setName}
                address={address}
                onAddressChange={setAddress}
                error={error}
                isExistingUser={isExistingUser}
                savedAddresses={savedAddresses}
                selectedAddress={selectedAddress}
                onSelectAddress={setSelectedAddress}
                isAddingNew={isAddingNew}
                onSetIsAddingNew={setIsAddingNew}
            />
            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10">
                            <ArrowLeft />
                        </Button>
                        <div>
                            <p className="text-xs text-muted-foreground">Step 2 of 2</p>
                            <h1 className="text-xl font-bold">Choose Payment Method</h1>
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

                        <div className="space-y-4">
                             <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handlePaymentMethodSelect('razorpay')}
                                className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all"
                            >
                                <Wallet size={40} className="text-primary flex-shrink-0"/>
                                <div>
                                    <h3 className="text-xl font-bold">Pay Online</h3>
                                    <p className="text-muted-foreground">UPI, Credit/Debit Card, Netbanking</p>
                                </div>
                            </motion.button>
                            
                            {loading ? (
                                <div className="w-full p-6 bg-card border-2 border-border rounded-lg animate-pulse h-[116px]">
                                    <div className="h-6 bg-muted rounded w-3/4"></div>
                                </div>
                            ) : codEnabled ? (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => handlePaymentMethodSelect('cod')}
                                    className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all"
                                >
                                    <IndianRupee size={40} className="text-primary flex-shrink-0"/>
                                    <div>
                                        <h3 className="text-xl font-bold">Cash on Delivery (COD)</h3>
                                        <p className="text-muted-foreground">Pay with cash when your order arrives</p>
                                    </div>
                                </motion.button>
                            ) : (
                                <div className="w-full text-left p-6 bg-muted/50 border-2 border-dashed border-border rounded-lg flex items-center gap-6 opacity-60">
                                    <IndianRupee size={40} className="text-muted-foreground flex-shrink-0"/>
                                    <div>
                                        <h3 className="text-xl font-bold text-muted-foreground">Cash on Delivery</h3>
                                        <p className="text-muted-foreground">This restaurant is not currently accepting COD.</p>
                                    </div>
                                </div>
                            )}
                        </div>
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
