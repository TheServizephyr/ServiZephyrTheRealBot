
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, ShoppingCart, CookingPot, Ticket, Gift, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const CheckoutModal = ({ isOpen, onClose, restaurantId, phone, cart, notes, appliedCoupon, couponDiscount, loyaltyDiscount }) => {
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddress, setSelectedAddress] = useState(null);
    const [isAddingNew, setIsAddingNew] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setLoading(false);
            setError('');
            setIsAddingNew(true);
            if (phone === '9876543210') { // Demo existing user
                setName('Rohan Sharma (Demo)');
                setSavedAddresses([{ id: 'addr_1', full: '123, Cyber Street, Tech City' }]);
                setSelectedAddress('123, Cyber Street, Tech City');
                setIsAddingNew(false);
                setIsExistingUser(true);
            } else {
                 setName('');
                 setAddress('');
                 setSavedAddresses([]);
                 setSelectedAddress(null);
                 setIsAddingNew(true);
                 setIsExistingUser(false);
            }
        }
    }, [isOpen, phone]);

    const handlePlaceOrder = async () => {
        const finalAddress = isAddingNew ? address : selectedAddress;
        if (!finalAddress || !name.trim()) {
            setError('Please enter your name and address.');
            return;
        }
        setError('');
        setLoading(true);
        setTimeout(() => {
            alert("Success! (Demo) - Your order has been placed.");
            setLoading(false);
            onClose();
            localStorage.removeItem('cartData');
            window.location.href = `/order/${restaurantId}`;
        }, 1500);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Confirm Your Details</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {!isExistingUser && (
                        <div>
                            <Label htmlFor="checkout-name">Full Name</Label>
                            <div className="relative mt-1">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <input id="checkout-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" />
                            </div>
                        </div>
                    )}
                    <div>
                        <Label htmlFor="checkout-address">Delivery Address</Label>
                        <div className="relative mt-1">
                            <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <textarea id="checkout-address" value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full delivery address" />
                        </div>
                    </div>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={handlePlaceOrder} className="bg-green-600 hover:bg-green-700 text-white" disabled={loading}>
                        {loading ? 'Placing Order...' : 'Confirm & Place Order'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function CartPage() {
    const router = useRouter();
    const [cartData, setCartData] = useState(null);
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

    useEffect(() => {
        const data = localStorage.getItem('cartData');
        if (data) {
            const parsedData = JSON.parse(data);
            setCartData(parsedData);
            setCart(parsedData.cart || []);
            setNotes(parsedData.notes || '');
        } else {
            // Handle case where cart is empty or not found, maybe redirect
            // For now, just show empty state
        }
    }, []);

    const updateCartInStorage = (newCart) => {
        const updatedData = { ...cartData, cart: newCart };
        setCartData(updatedData);
        localStorage.setItem('cartData', JSON.stringify(updatedData));
    };
    
    const handleUpdateCart = (item, action) => {
        let newCart = [...cart];
        const existingItemIndex = newCart.findIndex(cartItem => cartItem.id === item.id);

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
        updateCartInStorage(newCart);
    };

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.fullPrice * item.quantity, 0), [cart]);

    const couponDiscount = useMemo(() => {
        if (!appliedCoupon) return 0;
        if (subtotal < appliedCoupon.minOrder) {
            setAppliedCoupon(null); // Coupon no longer valid
            return 0;
        }
        if (appliedCoupon.type === 'flat') return appliedCoupon.value;
        if (appliedCoupon.type === 'percentage') return (subtotal * appliedCoupon.value) / 100;
        return 0;
    }, [appliedCoupon, subtotal]);

    const finalDeliveryCharge = useMemo(() => {
        if (!cartData) return 0;
        return appliedCoupon?.type === 'free_delivery' ? 0 : cartData.deliveryCharge;
    }, [appliedCoupon, cartData]);

    const { cgst, sgst, grandTotal } = useMemo(() => {
        const taxableAmount = subtotal - couponDiscount - loyaltyDiscount;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const total = taxableAmount + finalDeliveryCharge + (tax * 2);
        return { cgst: tax, sgst: tax, grandTotal: total };
    }, [subtotal, couponDiscount, loyaltyDiscount, finalDeliveryCharge]);

    const handleApplyCoupon = (couponToApply) => {
        if (subtotal >= couponToApply.minOrder) {
            setAppliedCoupon(couponToApply);
        }
    };
    
    const handleRedeemPoints = () => {
        if(cartData?.loyaltyPoints >= 100) {
            const redeemableAmount = Math.floor(cartData.loyaltyPoints * 0.5);
            setLoyaltyDiscount(redeemableAmount);
        }
    };

    if (!cartData) {
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
        <CheckoutModal 
            isOpen={isCheckoutOpen} 
            onClose={() => setIsCheckoutOpen(false)}
            restaurantId={cartData.restaurantId}
            phone={cartData.phone}
            cart={cart}
            notes={notes}
            appliedCoupon={appliedCoupon}
            couponDiscount={couponDiscount}
            loyaltyDiscount={loyaltyDiscount}
        />
        <div className="min-h-screen bg-background text-foreground flex flex-col">
             <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                     <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10">
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
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        Your cart is empty.
                    </div>
                ) : (
                    <>
                        <div className="space-y-3">
                            {cart.map(item => (
                                <motion.div 
                                    layout
                                    key={item.id} 
                                    className="flex items-center gap-4 bg-card p-3 rounded-lg border border-border"
                                >
                                    <p className="flex-grow font-semibold text-foreground">{item.name}</p>
                                    <div className="flex items-center gap-2">
                                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleUpdateCart(item, 'decrement')}>-</Button>
                                        <span className="font-bold w-5 text-center">{item.quantity}</span>
                                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleUpdateCart(item, 'increment')}>+</Button>
                                    </div>
                                    <p className="w-20 text-right font-bold">₹{item.fullPrice * item.quantity}</p>
                                </motion.div>
                            ))}
                        </div>

                        <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                            <div className="relative">
                                <CookingPot className="absolute left-3 top-3 h-5 w-5 text-muted-foreground"/>
                                <textarea 
                                  value={notes}
                                  onChange={(e) => setNotes(e.target.value)}
                                  placeholder="Add cooking instructions..."
                                  rows={2}
                                  className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border text-sm"
                                />
                            </div>
                        </div>

                        <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                            <h4 className="font-semibold mb-3 flex items-center gap-2"><Ticket/> Available Coupons</h4>
                            <div className="space-y-2">
                                {cartData.coupons && cartData.coupons.length > 0 ? cartData.coupons.map(coupon => (
                                    <div key={coupon.id} className="flex justify-between items-center bg-background p-3 rounded-md border border-dashed border-green-600/30">
                                        <div>
                                            <p className="font-bold text-green-600">{coupon.code}</p>
                                            <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                        </div>
                                        {appliedCoupon?.id === coupon.id ? (
                                            <Button variant="outline" size="sm" onClick={() => setAppliedCoupon(null)} className="text-red-400 border-red-400 hover:bg-red-400 hover:text-white">
                                                Remove
                                            </Button>
                                        ) : (
                                            <Button 
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleApplyCoupon(coupon)} 
                                                disabled={!!appliedCoupon}
                                                className="text-green-600 border-green-600 hover:bg-green-600 hover:text-white disabled:opacity-50"
                                            >
                                                Apply
                                            </Button>
                                        )}
                                    </div>
                                )) : (
                                    <p className="text-sm text-muted-foreground text-center py-2">No coupons available.</p>
                                )}
                            </div>
                        </div>

                        <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                            <h4 className="font-semibold mb-2 flex items-center gap-2"><Gift/> Loyalty Points</h4>
                            <div className="flex justify-between items-center">
                                <p className="text-muted-foreground">You have <span className="font-bold text-green-600">{cartData.loyaltyPoints || 0}</span> points.</p>
                                <Button variant="outline" onClick={handleRedeemPoints} disabled={(cartData.loyaltyPoints || 0) < 100 || loyaltyDiscount > 0}>
                                    {loyaltyDiscount > 0 ? "Redeemed!" : "Redeem Now"}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 p-4 border-t-2 border-primary bg-card rounded-lg shadow-lg">
                            <h3 className="text-xl font-bold mb-4">Bill Summary</h3>
                            <div className="space-y-1 text-sm mb-4">
                                <div className="flex justify-between"><span>Subtotal:</span> <span className="font-medium">₹{subtotal.toFixed(2)}</span></div>
                                {couponDiscount > 0 && <div className="flex justify-between text-green-400"><span>Coupon Discount:</span> <span className="font-medium">- ₹{couponDiscount.toFixed(2)}</span></div>}
                                {loyaltyDiscount > 0 && <div className="flex justify-between text-green-400"><span>Loyalty Discount:</span> <span className="font-medium">- ₹{loyaltyDiscount.toFixed(2)}</span></div>}
                                <div className="flex justify-between"><span>Delivery Fee:</span> {finalDeliveryCharge > 0 ? <span>₹{finalDeliveryCharge.toFixed(2)}</span> : <span className="text-green-400 font-bold">FREE</span>}</div>
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
                <div className="container mx-auto p-4">
                    <Button onClick={() => setIsCheckoutOpen(true)} className="w-full bg-green-600 hover:bg-green-700 h-12 text-lg font-bold text-white">
                        Proceed to Checkout
                    </Button>
                </div>
            </footer>
        </div>
        </>
    );
}

    