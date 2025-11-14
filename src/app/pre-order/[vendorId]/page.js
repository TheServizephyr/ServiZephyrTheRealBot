'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Plus, Minus, X, IndianRupee, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const MenuItem = ({ item, addToCart }) => (
    <div className="flex justify-between items-center p-4 bg-slate-800 rounded-lg">
        <div>
            <p className="font-bold text-white">{item.name}</p>
            {item.portions.map(p => (
                 <p key={p.name} className="text-slate-400">₹{p.price}</p>
            ))}
        </div>
        <Button onClick={() => addToCart(item, item.portions[0])} size="sm" className="bg-primary hover:bg-primary/80 text-primary-foreground">Add</Button>
    </div>
);


const CartSheet = ({ cart, updateQuantity, onCheckout, grandTotal, onClose }) => (
    <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t-2 border-primary rounded-t-2xl p-6 shadow-2xl flex flex-col max-h-[80vh]"
    >
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">Your Order</h2>
            <Button variant="ghost" size="icon" onClick={onClose}><X/></Button>
        </div>
        <div className="flex-grow overflow-y-auto space-y-3">
            {cart.map(item => (
                <div key={item.cartItemId} className="flex items-center justify-between bg-slate-700 p-3 rounded-md">
                    <div>
                        <p className="font-semibold">{item.name} <span className="text-xs text-slate-400">({item.portion.name})</span></p>
                        <p className="text-sm text-slate-400">₹{item.portion.price}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => updateQuantity(item.cartItemId, -1)}>-</Button>
                        <span className="font-bold text-lg w-6 text-center">{item.quantity}</span>
                        <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => updateQuantity(item.cartItemId, 1)}>+</Button>
                    </div>
                    <p className="font-bold w-16 text-right">₹{item.portion.price * item.quantity}</p>
                </div>
            ))}
        </div>
        <div className="mt-6 pt-4 border-t border-slate-700">
            <div className="flex justify-between text-2xl font-bold mb-4">
                <span>Total</span>
                <span>₹{grandTotal}</span>
            </div>
            <Button onClick={onCheckout} className="w-full h-14 text-lg bg-primary hover:bg-primary/80 text-primary-foreground">Proceed to Pay</Button>
        </div>
    </motion.div>
);

const CheckoutModal = ({ isOpen, onClose, onConfirm, total }) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');

    const handleSubmit = () => {
        if (name && phone) {
            onConfirm({ name, phone });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-800 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Almost there!</DialogTitle>
                    <DialogDescription>Please provide your details to place the order.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <label className="text-slate-400">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 mt-1 bg-slate-700 border border-slate-600 rounded-md" />
                    </div>
                    <div>
                        <label className="text-slate-400">Phone Number</label>
                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-2 mt-1 bg-slate-700 border border-slate-600 rounded-md" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-primary hover:bg-primary/80 text-primary-foreground">Pay ₹{total}</Button>
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
                
                // --- START FIX ---
                // The API returns an 'approvalStatus' string, not a boolean 'approved'.
                // Check this status correctly before proceeding.
                if (data.approvalStatus !== 'approved' && data.approvalStatus !== 'approve') {
                     throw new Error(data.message || 'This business is currently not accepting orders.');
                }
                // --- END FIX ---
                
                setVendor({ name: data.restaurantName, address: data.businessAddress?.full || '' });

                const menuItems = Object.values(data.menu).flat();
                setMenu(menuItems);

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchVendorAndMenu();
    }, [vendorId]);

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
    
    const grandTotal = useMemo(() => {
        return cart.reduce((sum, item) => sum + (item.portion.price * item.quantity), 0);
    }, [cart]);
    
    const totalItems = useMemo(() => {
        return cart.reduce((sum, item) => sum + item.quantity, 0);
    }, [cart]);

    const handleCheckout = async (customerDetails) => {
        setCheckoutOpen(false);
        // Integrate with Razorpay and Firestore order creation
        alert(`Placing order for ${customerDetails.name} totalling ₹${grandTotal}. This will be replaced with payment gateway.`);
    };
    
    if (loading) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={48} /></div>;
    }
    
    if (error) {
         return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400 p-4 text-center">{error}</div>;
    }

    return (
        <div className="min-h-screen bg-slate-900 text-white font-body p-4">
            <header className="text-center mb-6">
                <h1 className="text-3xl font-bold font-headline">{vendor?.name}</h1>
                <p className="text-slate-400">{vendor?.address}</p>
            </header>

            <main className="pb-28">
                 <div className="space-y-4">
                    {menu.map(item => (
                        <MenuItem key={item.id} item={item} addToCart={addToCart} />
                    ))}
                </div>
            </main>

            {totalItems > 0 && (
                <motion.footer
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 p-4"
                >
                    <Button onClick={() => setCartOpen(true)} className="w-full h-14 bg-primary text-primary-foreground text-lg font-bold flex justify-between items-center shadow-lg">
                        <span>{totalItems} item{totalItems > 1 ? 's' : ''} in cart</span>
                        <span>View Cart <IndianRupee size={16} className="inline"/>{grandTotal}</span>
                    </Button>
                </motion.footer>
            )}

            {isCartOpen && <div className="fixed inset-0 bg-black/60 z-10" onClick={() => setCartOpen(false)}></div>}
            
            <AnimatePresence>
              {isCartOpen && (
                 <CartSheet cart={cart} updateQuantity={updateQuantity} grandTotal={grandTotal} onCheckout={() => setCheckoutOpen(true)} onClose={() => setCartOpen(false)} />
              )}
            </AnimatePresence>

            <CheckoutModal isOpen={isCheckoutOpen} onClose={() => setCheckoutOpen(false)} total={grandTotal} onConfirm={handleCheckout} />
        </div>
    );
}
