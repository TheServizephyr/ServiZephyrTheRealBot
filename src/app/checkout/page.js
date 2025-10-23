
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, IndianRupee, CreditCard, Landmark, Split, Users as UsersIcon, QrCode, PlusCircle } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { Input } from '@/components/ui/input';

// Main component for the split bill interface
const SplitBillInterface = ({ totalAmount, onBack, orderDetails }) => {
    const [mode, setMode] = useState(null); // 'equally' or 'items'
    const [splitCount, setSplitCount] = useState(2);
    const [shares, setShares] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleGenerateSplitLinks = async () => {
        if (splitCount < 2) {
            setError("Must split between at least 2 people.");
            return;
        }
        setLoading(true);
        setError('');
        setShares([]);
        const amountPerShare = totalAmount / splitCount;

        try {
            const newShares = [];
            for (let i = 0; i < splitCount; i++) {
                const res = await fetch('/api/payment/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: amountPerShare }),
                });
                if (!res.ok) throw new Error("Failed to create a payment link.");
                const order = await res.json();
                newShares.push({ id: order.id, amount: amountPerShare, status: 'pending' });
            }
            setShares(newShares);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    // Placeholder for item selection logic
    const [selectedItems, setSelectedItems] = useState({});
    const handleItemSelection = (itemId) => {
        setSelectedItems(prev => ({...prev, [itemId]: !prev[itemId]}));
    }
    const selectedItemsTotal = useMemo(() => {
        return 0; // Placeholder
    }, [selectedItems]);


    if (!mode) {
        return (
            <div className="space-y-4 text-center">
                <h3 className="text-xl font-bold">How do you want to split the bill?</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Button onClick={() => setMode('equally')} className="w-full h-24 text-lg" variant="outline"><UsersIcon className="mr-2"/> Split Equally</Button>
                    <Button onClick={() => setMode('items')} className="w-full h-24 text-lg" variant="outline"><CreditCard className="mr-2"/> Split by Item</Button>
                </div>
                 <Button onClick={onBack} variant="link">Or, go back to pay full</Button>
            </div>
        );
    }
    
    if (mode === 'equally') {
        return (
            <div className="space-y-4">
                <h3 className="text-lg font-bold">Split Equally</h3>
                <div className="flex items-center gap-4">
                    <Label htmlFor="split-count">Split between how many people?</Label>
                    <input id="split-count" type="number" min="2" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value))} className="w-24 p-2 rounded-md bg-input border border-border" />
                </div>
                <Button onClick={handleGenerateSplitLinks} disabled={loading} className="w-full">
                    {loading ? 'Generating...' : 'Generate Payment Links'}
                </Button>
                {error && <p className="text-red-500 text-sm">{error}</p>}

                {shares.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        {shares.map((share, index) => (
                            <div key={share.id} className="bg-muted p-4 rounded-lg text-center">
                                <p className="font-bold">Share {index + 1}: ₹{share.amount.toFixed(2)}</p>
                                <div className="p-2 bg-white inline-block mt-2 rounded-lg">
                                    <QRCode value={JSON.stringify({order_id: share.id, amount: share.amount})} size={128} />
                                </div>
                                <p className="text-sm mt-2 font-semibold text-yellow-500">Status: {share.status}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (mode === 'items') {
        return (
             <div className="space-y-4">
                 <h3 className="text-lg font-bold">Split by Item</h3>
                 <p className="text-sm text-muted-foreground">Select the items you want to pay for.</p>
                 {/* Placeholder for item list */}
                 <div className="max-h-60 overflow-y-auto space-y-2 p-2 bg-muted rounded-lg">
                     <p className="text-center py-8 text-muted-foreground">Item selection UI coming soon.</p>
                 </div>
                 <Button disabled={true} className="w-full">
                    Pay My Share (₹{selectedItemsTotal.toFixed(2)})
                </Button>
             </div>
        )
    }

    return null;
};

const AddAddressModal = ({ isOpen, onClose, onSave }) => {
    const [label, setLabel] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [phone, setPhone] = useState('');
    const [alternatePhone, setAlternatePhone] = useState('');
    const [address, setAddress] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = () => {
        if (!label.trim() || !recipientName.trim() || !phone.trim() || !address.trim()) {
            setError('Please fill all required fields: Label, Recipient Name, Phone, and Address.');
            return;
        }
        if (!/^\d{10}$/.test(phone.trim())) {
            setError('Please enter a valid 10-digit primary phone number.');
            return;
        }
        if (alternatePhone && !/^\d{10}$/.test(alternatePhone.trim())) {
            setError('Please enter a valid 10-digit alternate phone number.');
            return;
        }
        setIsSaving(true);
        const newAddress = {
            id: `addr_${Date.now()}`,
            label,
            name: recipientName,
            phone,
            alternatePhone,
            full: address,
        };
        onSave(newAddress).finally(() => setIsSaving(false));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Add a New Address</DialogTitle>
                    <DialogDescription>Save an address to your address book for future orders.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                     {error && <p className="text-destructive text-sm bg-destructive/10 p-2 rounded-md">{error}</p>}
                    <div>
                        <Label htmlFor="addr-label">Address Label (e.g., Home, Office)</Label>
                        <Input id="addr-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
                    </div>
                    <div>
                        <Label htmlFor="addr-name">Recipient Name</Label>
                        <Input id="addr-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required />
                    </div>
                    <div>
                        <Label htmlFor="addr-phone">Primary Phone Number</Label>
                        <Input id="addr-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required/>
                    </div>
                     <div>
                        <Label htmlFor="addr-alt-phone">Alternate Phone Number (Optional)</Label>
                        <Input id="addr-alt-phone" type="tel" value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />
                    </div>
                    <div>
                        <Label htmlFor="addr-full">Full Address</Label>
                        <Input id="addr-full" value={address} onChange={(e) => setAddress(e.target.value)} required/>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Address'}
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
    
    // Order details state
    const [orderName, setOrderName] = useState('');
    const [orderPhone, setOrderPhone] = useState('');
    const [selectedAddress, setSelectedAddress] = useState(null);
    
    const [userAddresses, setUserAddresses] = useState([]);
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [codEnabled, setCodEnabled] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAddAddressModalOpen, setIsAddAddressModalOpen] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);
    const [isSplitBillActive, setIsSplitBillActive] = useState(false);
    
    // Fetch cart and restaurant settings
    useEffect(() => {
        const fetchInitialData = async () => {
            if (!restaurantId) {
                router.push('/');
                return;
            }

            let parsedData;
            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                parsedData = JSON.parse(savedCartData);
                const finalPhone = phone || parsedData.phone;
                
                const deliveryType = tableId ? 'dine-in' : (parsedData.deliveryType || 'delivery');

                const updatedData = { ...parsedData, phone: finalPhone, tableId: tableId || null, dineInTabId: tabId || null, deliveryType };

                setCart(updatedData.cart || []);
                setAppliedCoupons(updatedData.appliedCoupons || []);
                setCartData(updatedData);
                setOrderPhone(finalPhone); // Set initial order phone

            } else {
                 if (tabId) { // User is here to pay an existing tab
                    parsedData = { dineInTabId: tabId, deliveryType: 'dine-in', phone: phone };
                    setCartData(parsedData);
                } else {
                    router.push(`/order/${restaurantId}${tableId ? `?table=${tableId}`: ''}`);
                    return;
                }
            }
            
            try {
                 const res = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
                 if (res.ok) {
                    const data = await res.json();
                     const deliveryType = tableId ? 'dine-in' : (parsedData.deliveryType || 'delivery');

                    if (deliveryType === 'delivery') {
                        setCodEnabled(data.deliveryCodEnabled);
                    } else if (deliveryType === 'pickup') {
                         setCodEnabled(data.pickupPodEnabled);
                    } else if (deliveryType === 'dine-in') {
                        setCodEnabled(data.dineInPayAtCounterEnabled);
                    } else {
                        setCodEnabled(false);
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
                        setOrderName(data.name);
                        setUserAddresses(data.addresses || []);
                        if (data.addresses && data.addresses.length > 0) {
                            setSelectedAddress(data.addresses[0].id); // Default to first address ID
                            setOrderName(data.addresses[0].name || data.name);
                            setOrderPhone(data.addresses[0].phone || cartData.phone);
                        }
                        setIsExistingUser(true);
                    } else {
                        setIsExistingUser(false);
                        setOrderName('');
                        setUserAddresses([]);
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

    useEffect(() => {
        if (selectedAddress) {
            const address = userAddresses.find(a => a.id === selectedAddress);
            if (address) {
                setOrderName(address.name);
                setOrderPhone(address.phone);
            }
        }
    }, [selectedAddress, userAddresses]);
    
    const handleAddNewAddress = async (newAddress) => {
        // Here you would typically call an API to save the new address to the user's profile.
        // For this demo, we'll just update the local state.
        const updatedAddresses = [...userAddresses, newAddress];
        setUserAddresses(updatedAddresses);
        setSelectedAddress(newAddress.id);
        setIsAddAddressModalOpen(false);
    };

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
        router.push(`/order/${restaurantId}?table=${tableId}&phone=${phone}&tabId=${cartData.dineInTabId}`);
    };

    const handleViewBill = () => {
        setDineInModalOpen(false);
        setIsSplitBillActive(true);
    };

    const handleConfirmOrder = async () => {
        if (!orderName.trim()) {
            setError("Please enter your name.");
            return;
        }

        const deliveryAddress = userAddresses.find(a => a.id === selectedAddress);

        const orderData = {
            name: orderName,
            phone: orderPhone,
            restaurantId,
            items: cart,
            notes: cartData.notes,
            coupon: appliedCoupons.find(c => !c.customerId) || null,
            loyaltyDiscount: 0, // This logic can be added later
            subtotal,
            cgst,
            sgst,
            deliveryCharge: finalDeliveryCharge,
            grandTotal,
            paymentMethod: selectedPaymentMethod,
            deliveryType: cartData.deliveryType,
            pickupTime: cartData.pickupTime || '',
            tipAmount: cartData.tipAmount || 0,
            businessType: cartData.businessType || 'restaurant',
            tableId: cartData.tableId || null,
            dineInTabId: cartData.dineInTabId || null,
            pax_count: cartData.pax_count || null,
            tab_name: cartData.tab_name || null,
        };

        if (orderData.deliveryType === 'delivery') {
            if (!deliveryAddress) {
                setError("Please select or add a delivery address.");
                return;
            }
            orderData.address = deliveryAddress.full;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || "Failed to place order.");
            }

            // If Razorpay, initiate payment
            if (data.razorpay_order_id) {
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                    amount: data.amount,
                    currency: "INR",
                    name: cartData.restaurantName,
                    description: `Order from ${cartData.restaurantName}`,
                    order_id: data.razorpay_order_id,
                    handler: function (response) {
                        localStorage.removeItem(`cart_${restaurantId}`);
                        if (orderData.deliveryType === 'dine-in') {
                           router.push(`/order/${restaurantId}?table=${tableId}&tabId=${data.dine_in_tab_id || tabId}&phone=${phone}`);
                        } else {
                           router.push(`/order/placed?orderId=${data.firestore_order_id}`);
                        }
                    },
                    prefill: {
                        name: orderName,
                        email: "customer@servizephyr.com",
                        contact: orderPhone,
                    },
                };
                const rzp = new window.Razorpay(options);
                rzp.open();
            } else { // For COD/POD/Dine-In
                localStorage.removeItem(`cart_${restaurantId}`);
                if (orderData.deliveryType === 'dine-in') {
                   // Redirect back to the order page with the new tabId
                   router.push(`/order/${restaurantId}?table=${tableId}&tabId=${data.dine_in_tab_id || tabId}&phone=${phone}`);
                } else {
                   router.push(`/order/placed?orderId=${data.firestore_order_id}`);
                }
            }

        } catch (err) {
            setError(err.message);
        } finally {
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
    const cameToPay = !cart || cart.length === 0 && tabId;

    return (
        <>
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <AddAddressModal isOpen={isAddAddressModalOpen} onClose={() => setIsAddAddressModalOpen(false)} onSave={handleAddNewAddress} />
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                 <DialogContent className="bg-background border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle>Confirm Details</DialogTitle>
                        {error && <p className="text-destructive text-sm bg-destructive/10 p-2 rounded-md mt-2">{error}</p>}
                    </DialogHeader>
                    <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                        {deliveryType === 'delivery' ? (
                             <div>
                                <Label htmlFor="address">Delivery Address</Label>
                                <div className="space-y-2 mt-2">
                                    {userAddresses.map(addr => (
                                        <div key={addr.id} className="flex items-center space-x-2 p-3 rounded-md bg-muted has-[:checked]:bg-primary/10 has-[:checked]:border-primary border border-transparent">
                                            <input
                                                type="radio"
                                                id={addr.id}
                                                name="address"
                                                value={addr.id}
                                                checked={selectedAddress === addr.id}
                                                onChange={(e) => setSelectedAddress(e.target.value)}
                                                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                                            />
                                            <Label htmlFor={addr.id} className="flex-1 cursor-pointer">
                                                <p className="font-semibold">{addr.label} <span className="font-normal text-muted-foreground">({addr.name})</span></p>
                                                <p className="text-xs text-muted-foreground">{addr.full}</p>
                                                <p className="text-xs text-muted-foreground">Ph: {addr.phone} {addr.alternatePhone && ` / ${addr.alternatePhone}`}</p>
                                            </Label>
                                        </div>
                                    ))}
                                    <Button variant="outline" className="w-full" onClick={() => setIsAddAddressModalOpen(true)}>
                                        <PlusCircle className="mr-2 h-4 w-4" /> Add New Address
                                    </Button>
                                </div>
                            </div>
                        ) : (
                             <div>
                                <Label htmlFor="name">Your Name</Label>
                                <Input id="name" value={orderName} onChange={(e) => setOrderName(e.target.value)} disabled={loading} />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                        <Button onClick={handleConfirmOrder} disabled={loading} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {loading ? 'Processing...' : 'Confirm Order'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={isDineInModalOpen} onOpenChange={setDineInModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>What would you like to do?</DialogTitle>
                    </DialogHeader>
                     <div className="grid grid-cols-1 gap-4 py-4">
                        <Button onClick={handleAddMoreToTab} variant="outline" className="h-16 text-lg">Add More Items</Button>
                        <Button onClick={handleViewBill} className="h-16 text-lg">View Bill & Pay</Button>
                    </div>
                </DialogContent>
            </Dialog>
            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10">
                            <ArrowLeft />
                        </Button>
                        <div>
                            <p className="text-xs text-muted-foreground">{cameToPay ? 'Final Step' : 'Step 2 of 2'}</p>
                            <h1 className="text-xl font-bold">{cameToPay ? 'Pay Your Bill' : 'Choose Payment Method'}</h1>
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

                        {isSplitBillActive ? (
                            <SplitBillInterface totalAmount={grandTotal} onBack={() => setIsSplitBillActive(false)} orderDetails={{cart, subtotal, ...cartData}}/>
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
                                        <h3 className="text-xl font-bold">Pay Full Bill Online</h3>
                                        <p className="text-muted-foreground">UPI, Credit/Debit Card, Netbanking</p>
                                    </div>
                                </motion.button>
                                
                                {deliveryType === 'dine-in' && (
                                     <motion.button
                                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                        onClick={() => setIsSplitBillActive(true)}
                                        className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all"
                                    >
                                        <Split size={40} className="text-primary flex-shrink-0"/>
                                        <div>
                                            <h3 className="text-xl font-bold">Split The Bill</h3>
                                            <p className="text-muted-foreground">Split equally or by items with your friends.</p>
                                        </div>
                                    </motion.button>
                                )}
                                
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
                                    !isSplitBillActive && <div className="w-full text-left p-6 bg-muted/50 border-2 border-dashed border-border rounded-lg flex items-center gap-6 opacity-60">
                                        <IndianRupee size={40} className="text-muted-foreground flex-shrink-0"/>
                                        <div>
                                            <h3 className="text-xl font-bold text-muted-foreground">{deliveryType === 'pickup' ? 'Pay at Store' : (deliveryType === 'dine-in' ? 'Pay at Counter' : 'Pay on Delivery')}</h3>
                                            <p className="text-muted-foreground">This payment method is not available right now.</p>
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
