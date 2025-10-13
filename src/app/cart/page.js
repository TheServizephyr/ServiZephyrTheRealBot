

'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, ShoppingCart, CookingPot, Ticket, Gift, ArrowLeft, Sparkles, Check, PlusCircle, Trash2 } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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

const CheckoutModal = ({ isOpen, onClose, restaurantId, phone, cart, notes, appliedCoupons, subtotal, loyaltyPoints, grandTotal }) => {
    const router = useRouter();
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddress, setSelectedAddress] = useState('');
    const [isAddingNew, setIsAddingNew] = useState(false);
    
    // Fetch User Data when Modal Opens
    useEffect(() => {
        const fetchUserData = async () => {
            if (isOpen && phone) {
                setLoading(true);
                setError('');
                try {
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone }),
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
    }, [isOpen, phone]);
    

    const handlePlaceOrder = async () => {
        const finalAddress = isAddingNew ? address : selectedAddress;
        if (!finalAddress || !name.trim()) {
            setError('Please enter your name and address.');
            return;
        }
        setError('');
        setLoading(true);
        
        try {
            // Step 1: Create a Razorpay Order
            const orderCreationResponse = await fetch('/api/payment/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: grandTotal }),
            });

            if (!orderCreationResponse.ok) {
                const errorData = await orderCreationResponse.json();
                 if (errorData.message === 'Payment gateway is not configured.') {
                    throw new Error("Could not connect to payment gateway. Please try again later.");
                }
                throw new Error(errorData.message || "Failed to create payment order.");
            }
            const razorpayOrder = await orderCreationResponse.json();

            // Step 2: Open Razorpay Checkout
            const options = {
                key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, 
                amount: razorpayOrder.amount, 
                currency: "INR",
                name: "ServiZephyr (Pvt. Ltd.)",
                description: `Payment for Order`,
                order_id: razorpayOrder.id,
                handler: async function (response){
                    // Step 3: Verify payment and place final order
                    await verifyPaymentAndPlaceOrder(response);
                },
                prefill: {
                    name: name.trim(),
                    contact: phone,
                },
                theme: {
                    color: "#3399cc"
                }
            };
            const rzp1 = new window.Razorpay(options);
            rzp1.on('payment.failed', function (response){
                setError(`Payment Failed: ${response.error.description}`);
                setLoading(false);
            });
            rzp1.open();

        } catch (err) {
            setError(err.message || 'An unexpected error occurred.');
            setLoading(false);
        }
    };
    
    const verifyPaymentAndPlaceOrder = async (razorpayResponse) => {
        try {
            const finalAddress = isAddingNew ? address : selectedAddress;
            const finalItems = cart.map(item => ({
                name: `${item.name} (${item.portion.name})${item.selectedAddOns.map(a => ` + ${a.name}`).join('')}`,
                quantity: item.quantity,
                price: item.totalPrice,
            }));

            const orderPayload = {
                name: name.trim(),
                address: finalAddress,
                phone,
                restaurantId,
                items: finalItems,
                notes,
                coupon: appliedCoupons.length > 0 ? {
                    code: appliedCoupons[0].code,
                    discount: appliedCoupons.reduce((total, coupon) => {
                        if (coupon.type === 'flat') return total + coupon.value;
                        if (coupon.type === 'percentage') return total + (subtotal * coupon.value / 100);
                        return total;
                    }, 0)
                } : null,
                loyaltyDiscount: 0,
                ...razorpayResponse
            };

            const res = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload),
            });
            
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.message || "Failed to place final order after payment.");
            }

            localStorage.removeItem(`cart_${restaurantId}`);
            router.push(`/order/placed?restaurantId=${restaurantId}`);
            onClose();

        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    }
    
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
                                    <input id="checkout-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" disabled={isExistingUser && !isAddingNew} />
                                </div>
                            </div>
                           
                            {isExistingUser && savedAddresses.length > 0 && (
                                <div>
                                    <Label>Select Address</Label>
                                    <div className="space-y-2 mt-1">
                                        {savedAddresses.map(addr => (
                                            <div key={addr.id} onClick={() => { setSelectedAddress(addr.full); setIsAddingNew(false); }} className={cn("p-3 rounded-md border-2 cursor-pointer", !isAddingNew && selectedAddress === addr.full ? 'border-primary bg-primary/10' : 'border-border')}>
                                                {addr.full}
                                            </div>
                                        ))}
                                         <div onClick={() => { setIsAddingNew(true); setSelectedAddress(''); }} className={cn("p-3 rounded-md border-2 cursor-pointer flex items-center gap-2", isAddingNew ? 'border-primary bg-primary/10' : 'border-border')}>
                                            <PlusCircle size={16}/> Add a new address
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(isAddingNew || !isExistingUser || savedAddresses.length === 0) && (
                                 <div>
                                    <Label htmlFor="checkout-address">Delivery Address</Label>
                                    <div className="relative mt-1">
                                        <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                        <textarea id="checkout-address" value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border-border" placeholder="Enter your full delivery address" />
                                    </div>
                                </div>
                            )}

                            {error && <p className="text-red-500 text-sm text-center pt-2">{error}</p>}
                        </>
                     )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={handlePlaceOrder} className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled={loading}>
                        {loading ? 'Processing...' : `Pay ${grandTotal > 0 ? `₹${grandTotal.toFixed(2)}` : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const CartPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    const [phone, setPhone] = useState('');
    
    const [cartData, setCartData] = useState(null);
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isClearCartDialogOpen, setIsClearCartDialogOpen] = useState(false);

    useEffect(() => {
        if (restaurantId) {
            const data = localStorage.getItem(`cart_${restaurantId}`);
            if (data) {
                const parsedData = JSON.parse(data);
                setCartData(parsedData);
                setCart(parsedData.cart || []);
                setNotes(parsedData.notes || '');
                setPhone(parsedData.phone || '');
            } else {
                setCart([]);
            }
        }
    }, [restaurantId]);

    const updateCartInStorage = (newCart, newNotes) => {
        const updatedData = { ...cartData, cart: newCart, notes: newNotes };
        setCartData(updatedData);
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
        setCart(newCart);
        updateCartInStorage(newCart, notes);
    };


    const handleNotesChange = (e) => {
        const newNotes = e.target.value;
        setNotes(newNotes);
        updateCartInStorage(cart, newNotes);
    }
    
    const handleClearCart = () => {
        localStorage.removeItem(`cart_${restaurantId}`);
        setCart([]);
        setAppliedCoupons([]);
        setCartData(prev => ({...prev, cart: []}));
        setIsClearCartDialogOpen(false);
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
        if (!cartData) return 0;
        const hasFreeDelivery = appliedCoupons.some(c => c.type === 'free_delivery' && subtotal >= c.minOrder);
        return hasFreeDelivery ? 0 : cartData.deliveryCharge;
    }, [appliedCoupons, cartData, subtotal]);

    const { cgst, sgst, grandTotal } = useMemo(() => {
        const taxableAmount = subtotal - totalDiscount;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const total = taxableAmount + finalDeliveryCharge + (tax * 2);
        return { cgst: tax, sgst: tax, grandTotal: total };
    }, [subtotal, totalDiscount, finalDeliveryCharge]);

    const handleApplyCoupon = (couponToApply) => {
        if (appliedCoupons.some(c => c.id === couponToApply.id)) {
            setAppliedCoupons(prev => prev.filter(c => c.id !== couponToApply.id));
            return;
        }

        if (subtotal < couponToApply.minOrder) {
            alert(`You need to spend at least ₹${couponToApply.minOrder} to use this coupon.`);
            return;
        }
        
        const isSpecial = !!couponToApply.customerId;

        setAppliedCoupons(prev => {
            let newCoupons = [...prev];
            if (!isSpecial) {
                newCoupons = newCoupons.filter(c => !!c.customerId);
            }
            return [...newCoupons, couponToApply];
        });
    };

    const allCoupons = cartData?.coupons || [];
    const specialCoupons = allCoupons.filter(c => c.customerId);
    const normalCoupons = allCoupons.filter(c => !c.customerId);


    if (!cartData || !restaurantId) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-muted-foreground p-4">
                <ShoppingCart size={48} className="mb-4" />
                <h1 className="text-2xl font-bold">Your Cart is Empty</h1>
                <p className="mt-2">Looks like you haven't added anything to your cart yet.</p>
                <Button onClick={() => router.back()} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Menu
                </Button>
            </div>
        );
    }
    
    return (
        <>
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />
        <CheckoutModal 
            isOpen={isCheckoutOpen} 
            onClose={() => setIsCheckoutOpen(false)}
            restaurantId={restaurantId}
            phone={phone}
            cart={cart}
            notes={notes}
            appliedCoupons={appliedCoupons}
            subtotal={subtotal}
            loyaltyPoints={cartData.loyaltyPoints}
            grandTotal={grandTotal}
        />
        <ClearCartDialog 
            isOpen={isClearCartDialogOpen}
            onClose={() => setIsClearCartDialogOpen(false)}
            onConfirm={handleClearCart}
        />
        <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
             <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                     <Button variant="ghost" size="icon" onClick={() => router.push(`/order/${restaurantId}`)} className="h-10 w-10">
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
                         <Button onClick={() => router.push(`/order/${restaurantId}`)} className="mt-6">
                            <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Menu
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="bg-card p-4 rounded-lg border border-border">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-bold text-lg">Your Items</h3>
                            </div>
                            <div className="space-y-4">
                                {cart.map(item => (
                                    <motion.div 
                                        layout
                                        key={item.cartItemId}
                                        className="flex items-center gap-4"
                                    >
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
                                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleUpdateCart(item, 'decrement')}>-</Button>
                                            <span className="font-bold w-5 text-center">{item.quantity}</span>
                                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleUpdateCart(item, 'increment')}>+</Button>
                                        </div>
                                        <p className="w-20 text-right font-bold">₹{item.totalPrice * item.quantity}</p>
                                    </motion.div>
                                ))}
                            </div>

                            <Button variant="outline" onClick={() => router.push(`/order/${restaurantId}`)} className="w-full mt-4">
                                <PlusCircle className="mr-2 h-4 w-4" /> Add more items
                            </Button>
                            
                            <div className="relative mt-4 pt-4 border-t border-dashed border-border">
                                <CookingPot className="absolute left-0 top-7 h-5 w-5 text-muted-foreground"/>
                                <textarea 
                                  value={notes}
                                  onChange={handleNotesChange}
                                  placeholder="Add cooking instructions... (e.g. No onion, less spicy etc.)"
                                  rows={2}
                                  className="w-full pl-7 pr-4 py-2 rounded-md bg-input border-border text-sm focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        </div>
                        
                        <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                             <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                                      <Ticket className="mr-2 h-4 w-4" />
                                      {appliedCoupons.length > 0 ? `${appliedCoupons.length} Coupon(s) Applied` : 'View Available Coupons'}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-0" align="start">
                                     <div className="p-4">
                                        <h4 className="font-medium leading-none">Available Coupons</h4>
                                     </div>
                                     <div className="max-h-60 overflow-y-auto space-y-2 p-4 pt-0">
                                      {specialCoupons.length > 0 && (
                                          <div className="space-y-2">
                                              <p className="text-sm font-semibold flex items-center gap-2 text-primary"><Sparkles size={16}/> Special for you</p>
                                              {specialCoupons.map(coupon => (
                                                  <div key={coupon.id} onClick={() => handleApplyCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", appliedCoupons.some(c=>c.id === coupon.id) ? "border-primary bg-primary/10" : "border-dashed border-primary/50 bg-background")}>
                                                      <div className="flex justify-between items-center">
                                                          <p className="font-bold text-foreground">{coupon.code}</p>
                                                          {appliedCoupons.some(c=>c.id === coupon.id) && <Check size={16} className="text-primary" />}
                                                      </div>
                                                      <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                  </div>
                                              ))}
                                              <hr className="my-4 border-border"/>
                                          </div>
                                      )}
                                      
                                      {normalCoupons.length > 0 ? normalCoupons.map(coupon => (
                                          <div key={coupon.id} onClick={() => handleApplyCoupon(coupon)} className={cn("p-2 rounded-md border-2 cursor-pointer", appliedCoupons.some(c=>c.id === coupon.id) ? "border-primary bg-primary/10" : "border-border bg-background")}>
                                              <div className="flex justify-between items-center">
                                                  <p className="font-bold text-foreground">{coupon.code}</p>
                                                  {appliedCoupons.some(c=>c.id === coupon.id) && <Check size={16} className="text-primary" />}
                                              </div>
                                              <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                          </div>
                                      )) : <p className="text-xs text-muted-foreground text-center">No other coupons available.</p>}

                                     </div>
                                </PopoverContent>
                            </Popover>
                        </div>


                        <div className="mt-6 p-4 border-t-2 border-primary bg-card rounded-lg shadow-lg">
                            <h3 className="text-xl font-bold mb-4">Bill Summary</h3>
                            <div className="space-y-1 text-sm mb-4">
                                <div className="flex justify-between"><span>Subtotal:</span> <span className="font-medium">₹{subtotal.toFixed(2)}</span></div>
                                {couponDiscount > 0 && <div className="flex justify-between text-green-400"><span>Coupon Discount:</span> <span className="font-medium">- ₹{couponDiscount.toFixed(2)}</span></div>}
                                {specialCouponDiscount > 0 && <div className="flex justify-between text-primary"><span>Special Discount:</span> <span className="font-medium">- ₹{specialCouponDiscount.toFixed(2)}</span></div>}
                                <div className="flex justify-between"><span>Delivery Fee:</span> {finalDeliveryCharge > 0 ? <span>₹{finalDeliveryCharge.toFixed(2)}</span> : <span className="text-primary font-bold">FREE</span>}</div>
                                <div className="flex justify-between"><span>CGST ({5}%):</span> <span className="font-medium">₹{cgst.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span>SGST ({5}%):</span> <span className="font-medium">₹{sgst.toFixed(2)}</span></div>
                                <div className="border-t border-dashed border-border my-2"></div>
                                <div className="flex justify-between items-center text-lg font-bold"><span>Grand Total:</span> <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span></div>
                            </div>
                        </div>
                    </>
                )}
            </main>

            <footer className="fixed bottom-0 left-0 w-full bg-background/80 backdrop-blur-lg border-t border-border z-30">
                <div className="container mx-auto p-4 flex items-center justify-center gap-4">
                    <Button onClick={() => setIsCheckoutOpen(true)} className="flex-grow bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg font-bold" disabled={cart.length === 0}>
                        Proceed to Checkout
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

    

    

