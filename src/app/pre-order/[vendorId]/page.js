
'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Plus, Minus, X, IndianRupee, Loader2, Utensils, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import Image from 'next/image';
import Script from 'next/script';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';


const MenuItem = ({ item, cartQuantity, onAdd, onIncrement, onDecrement }) => (
    <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex gap-4 py-4 border-b border-border last:border-b-0"
    >
        <div className="flex-grow">
            <div className="flex items-center gap-2 mb-1">
                <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
                    <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                </div>
                <h4 className="font-semibold text-foreground">{item.name}</h4>
            </div>
            <p className="text-sm text-muted-foreground">{item.description}</p>
            <p className="font-bold text-md text-primary mt-2">₹{item.portions?.[0]?.price || 'N/A'}</p>
        </div>
        <div className="w-28 flex-shrink-0 relative">
            <div className="relative w-full h-24 rounded-md overflow-hidden bg-muted">
                {item.imageUrl ? (
                    <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Utensils/></div>
                )}
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                 {cartQuantity > 0 ? (
                    <div className="flex items-center justify-center bg-background border-2 border-border rounded-lg shadow-lg h-10">
                        <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-r-none" onClick={() => onDecrement(item.cartItemId || item.id)}>-</Button>
                        <span className="font-bold text-lg text-primary flex-grow text-center">{cartQuantity}</span>
                        <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-l-none" onClick={() => onIncrement(item)}>+</Button>
                    </div>
                ) : (
                    <Button
                        onClick={() => onAdd(item)}
                        variant="outline"
                        className="w-full bg-background/80 backdrop-blur-sm text-primary font-bold border-2 border-primary hover:bg-primary/10 shadow-lg active:translate-y-px h-10"
                    >
                        ADD
                    </Button>
                )}
            </div>
        </div>
    </motion.div>
);


const CustomizationDrawer = ({ item, isOpen, onClose, onAddToCart }) => {
    const [selectedPortion, setSelectedPortion] = useState(null);

    useEffect(() => {
        if (item) {
            const defaultPortion = item.portions?.find(p => p.name.toLowerCase() === 'full') || item.portions?.[0] || null;
            setSelectedPortion(defaultPortion);
        }
    }, [item]);

    if (!item) return null;

    const handleFinalAddToCart = () => {
        onAddToCart(item, selectedPortion);
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div 
                  className="fixed inset-0 bg-black/60 z-50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={onClose}
                >
                    <motion.div
                        className="fixed bottom-0 left-0 right-0 bg-background rounded-t-2xl p-6 flex flex-col max-h-[70vh]"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex-shrink-0">
                            <h3 className="text-2xl font-bold">{item.name}</h3>
                            <p className="text-sm text-muted-foreground">Select a portion size</p>
                        </div>
                        <div className="py-4 space-y-3 overflow-y-auto">
                            {(item.portions || []).map(portion => (
                                <div
                                    key={portion.name}
                                    onClick={() => setSelectedPortion(portion)}
                                    className={cn(
                                        "flex justify-between items-center p-4 rounded-lg border-2 cursor-pointer transition-all",
                                        selectedPortion?.name === portion.name ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                                    )}
                                >
                                    <span className="font-semibold">{portion.name}</span>
                                    <span className="font-bold text-primary">₹{portion.price}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex-shrink-0 pt-4 border-t border-border">
                            <Button onClick={handleFinalAddToCart} className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground" disabled={!selectedPortion}>
                                Add Item for ₹{selectedPortion?.price || 0}
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};


const CartSheet = ({ cart, updateQuantity, onCheckout, grandTotal, onClose }) => (
    <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 bg-card border-t border-border rounded-t-2xl p-6 shadow-2xl flex flex-col max-h-[80vh] z-40"
    >
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h2 className="text-2xl font-bold">Your Order</h2>
            <Button variant="ghost" size="icon" onClick={onClose}><X/></Button>
        </div>
        <div className="flex-grow overflow-y-auto space-y-3 pr-2">
             {cart.length > 0 ? cart.map(item => (
                <div key={item.cartItemId} className="flex items-center justify-between bg-muted p-3 rounded-md">
                    <div>
                        <p className="font-semibold">{item.name} <span className="text-xs text-muted-foreground">({item.portion.name})</span></p>
                        <p className="text-sm text-primary">₹{item.portion.price}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" className="w-8 h-8" onClick={() => updateQuantity(item.cartItemId, -1)}>-</Button>
                        <span className="font-bold text-lg w-6 text-center">{item.quantity}</span>
                        <Button size="icon" variant="outline" className="w-8 h-8" onClick={() => updateQuantity(item.cartItemId, 1)}>+</Button>
                    </div>
                    <p className="font-bold w-16 text-right">₹{item.portion.price * item.quantity}</p>
                </div>
            )) : <p className="text-center text-muted-foreground py-8">Your cart is empty.</p>}
        </div>
        <div className="mt-6 pt-4 border-t border-border flex-shrink-0">
            <div className="flex justify-between text-2xl font-bold mb-4">
                <span>Total</span>
                <span>₹{grandTotal}</span>
            </div>
            <Button onClick={onCheckout} className="w-full h-14 text-lg bg-primary hover:bg-primary/80 text-primary-foreground" disabled={cart.length === 0}>Proceed to Pay</Button>
        </div>
    </motion.div>
);

const CheckoutModal = ({ isOpen, onClose, onConfirm, total, vendorName, cart, vendorId }) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const router = useRouter();

    const handlePayment = async (paymentMethod) => {
        if (!name.trim()) {
            setError("Name is required.");
            return;
        }
        if (phone.trim() && !/^\d{10}$/.test(phone.trim())) {
            setError("If providing a phone number, it must be a valid 10-digit number.");
            return;
        }

        setIsProcessing(true);
        setError('');

        const orderData = {
            name: name,
            phone: phone.trim() || null,
            restaurantId: vendorId,
            businessType: 'street-vendor',
            items: cart.map(item => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                price: item.portion.price,
                totalPrice: item.portion.price * item.quantity,
            })),
            notes: 'Pre-order from QR',
            grandTotal: total,
            subtotal: total,
            cgst: 0,
            sgst: 0,
            deliveryCharge: 0,
            paymentMethod,
            deliveryType: 'street-vendor-pre-order',
            address: { full: 'Street Vendor Pre-Order' }
        };

        try {
            const res = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.message || "Failed to process order.");
            }
            
            if (data.razorpay_order_id) {
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                    amount: total * 100,
                    currency: "INR",
                    name: vendorName || "Street Vendor",
                    description: `Order from ${vendorName}`,
                    order_id: data.razorpay_order_id,
                    handler: function (response){
                        onConfirm({ name, phone, paymentDetails: response, method: 'online', firestore_order_id: data.firestore_order_id, token: data.token });
                    },
                    prefill: { name: name, contact: phone },
                    theme: { color: "#FBBF24" }
                };
                const rzp1 = new window.Razorpay(options);
                rzp1.on('payment.failed', function (response){
                    setError(`Payment failed: ${response.error.description}`);
                    setIsProcessing(false);
                });
                rzp1.open();
            } else {
                onConfirm({ name, phone, method: 'counter', firestore_order_id: data.firestore_order_id, token: data.token });
            }

        } catch (err) {
            setError(err.message);
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Almost there!</DialogTitle>
                    <DialogDescription>Please provide your name to place the order.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <label className="text-muted-foreground">Name *</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 mt-1 bg-input border border-border rounded-md" />
                    </div>
                    <div>
                        <label className="text-muted-foreground">Phone Number (Optional)</label>
                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-2 mt-1 bg-input border border-border rounded-md" />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter className="grid grid-cols-2 gap-4">
                    <Button onClick={() => handlePayment('counter')} variant="outline" className="h-12 text-base">
                        <Wallet className="mr-2 h-5 w-5"/> Pay at Counter
                    </Button>
                    <Button onClick={() => handlePayment('razorpay')} disabled={isProcessing} className="bg-primary hover:bg-primary/80 text-primary-foreground h-12 text-base">
                        {isProcessing ? <Loader2 className="animate-spin mr-2"/> : null}
                        Pay ₹{total} Online
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default function PreOrderPage({ params }) {
    const { vendorId } = params;
    const [vendor, setVendor] = useState(null);
    const [menu, setMenu] = useState([]);
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isCartOpen, setCartOpen] = useState(false);
    const [isCheckoutOpen, setCheckoutOpen] = useState(false);
    const [customizationItem, setCustomizationItem] = useState(null);
    const [cartQuantities, setCartQuantities] = useState({});
    const router = useRouter();


    useEffect(() => {
        const fetchVendorAndMenu = async () => {
            if (!vendorId) {
                setError("Vendor not specified.");
                setLoading(false);
                return;
            }
            try {
                const res = await fetch(`/api/menu/${vendorId}`);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || "Could not load menu for this vendor.");
                }
                const data = await res.json();
                setVendor({ name: data.restaurantName, address: data.businessAddress?.full || '' });
                const allItems = Object.values(data.menu || {}).flat().filter(item => item.isAvailable === true);
                setMenu(allItems);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchVendorAndMenu();
    }, [vendorId]);

    useEffect(() => {
        const quantities = {};
        cart.forEach(item => {
            quantities[item.id] = (quantities[item.id] || 0) + item.quantity;
        });
        setCartQuantities(quantities);
    }, [cart]);


    const addToCart = (item, portion) => {
        const cartItemId = `${item.id}-${portion.name}`;
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.cartItemId === cartItemId);
            if (existingItem) {
                return prevCart.map(cartItem =>
                    cartItem.cartItemId === cartItemId ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            } else {
                return [...prevCart, { ...item, quantity: 1, portion, cartItemId }];
            }
        });
    };

    const handleAddClick = (item) => {
        if (item.portions && item.portions.length > 1) {
            setCustomizationItem(item);
        } else {
            addToCart(item, item.portions[0]);
        }
    };

    const updateQuantity = (cartItemId, change) => {
        setCart(prevCart => {
            const itemIndex = prevCart.findIndex(i => i.cartItemId === cartItemId);
            if (itemIndex === -1) return prevCart;

            const newCart = [...prevCart];
            const newQuantity = newCart[itemIndex].quantity + change;

            if (newQuantity <= 0) {
                return newCart.filter(i => i.cartItemId !== cartItemId);
            } else {
                newCart[itemIndex].quantity = newQuantity;
                return newCart;
            }
        });
    };

     const handleIncrement = (item) => {
        const cartItem = cart.find(ci => ci.id === item.id);
        if (cartItem) {
            updateQuantity(cartItem.cartItemId, 1);
        } else {
            handleAddClick(item);
        }
    };

    const handleDecrement = (itemId) => {
        const cartItem = cart.find(ci => ci.id === itemId);
        if (cartItem) {
            updateQuantity(cartItem.cartItemId, -1);
        }
    };
    
    const grandTotal = useMemo(() => {
        return cart.reduce((sum, item) => sum + (item.portion.price * item.quantity), 0);
    }, [cart]);
    
    const totalItems = useMemo(() => {
        return cart.reduce((sum, item) => sum + item.quantity, 0);
    }, [cart]);

    const handleCheckout = (details) => {
        setCheckoutOpen(false);
        setCartOpen(false);
        
        const orderId = details.paymentDetails?.razorpay_order_id || details.firestore_order_id;
        
        sessionStorage.setItem(orderId, JSON.stringify({
            vendorName: vendor.name,
            total: grandTotal,
            items: cart,
            customer: details
        }));
        
        const urlParams = new URLSearchParams({
            orderId: orderId,
            token: details.token || '',
            restaurantId: vendorId
        });
        
        router.push(`/order/placed?${urlParams.toString()}`);
    };
    
    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={48} /></div>;
    }
    
    if (error) {
         return <div className="min-h-screen bg-background flex items-center justify-center text-red-500 p-4 text-center">{error}</div>;
    }

    return (
        <div className="min-h-screen bg-background text-foreground font-body">
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <header className="text-center p-6 border-b border-border bg-card sticky top-0 z-10">
                <h1 className="text-3xl font-bold font-headline">{vendor?.name}</h1>
                <p className="text-muted-foreground">{vendor?.address}</p>
            </header>

            <main className="p-4 pb-28 container mx-auto max-w-2xl">
                 <div className="space-y-4">
                    {menu.length > 0 ? (
                        menu.map(item => (
                            <MenuItem
                                key={item.id}
                                item={item}
                                cartQuantity={cartQuantities[item.id] || 0}
                                onAdd={handleAddClick}
                                onIncrement={handleIncrement}
                                onDecrement={handleDecrement}
                            />
                        ))
                    ) : (
                         <div className="text-center py-20 text-muted-foreground">
                            <p>No menu items found for this vendor.</p>
                        </div>
                    )}
                </div>
            </main>
            
            <CustomizationDrawer 
                isOpen={!!customizationItem}
                onClose={() => setCustomizationItem(null)}
                item={customizationItem}
                onAddToCart={addToCart}
            />

            {totalItems > 0 && (
                <motion.footer
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 p-4 z-20 bg-background/80 backdrop-blur-sm border-t border-border"
                >
                  <div className="container mx-auto max-w-2xl">
                    <Button onClick={() => setCartOpen(true)} className="w-full h-14 bg-primary text-primary-foreground text-lg font-bold flex justify-between items-center shadow-lg">
                        <span>{totalItems} item{totalItems > 1 ? 's' : ''} in cart</span>
                        <span>View Cart <IndianRupee size={16} className="inline"/>{grandTotal}</span>
                    </Button>
                  </div>
                </motion.footer>
            )}

            {isCartOpen && <div className="fixed inset-0 bg-black/60 z-30" onClick={() => setCartOpen(false)}></div>}
            
            <AnimatePresence>
              {isCartOpen && (
                 <CartSheet cart={cart} updateQuantity={updateQuantity} grandTotal={grandTotal} onCheckout={() => setCheckoutOpen(true)} onClose={() => setCartOpen(false)} />
              )}
            </AnimatePresence>

            <CheckoutModal 
                isOpen={isCheckoutOpen} 
                onClose={() => setCheckoutOpen(false)} 
                total={grandTotal} 
                onConfirm={handleCheckout} 
                vendorName={vendor?.name}
                cart={cart}
                vendorId={vendorId}
            />
        </div>
    );
}
