

'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';


const MenuItemCard = ({ item, quantity, onIncrement, onDecrement }) => {
  return (
    <motion.div 
        className="flex items-start gap-4 p-4 bg-card rounded-lg border border-border"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
    >
      <div className="relative w-24 h-24 rounded-md overflow-hidden bg-muted flex-shrink-0">
         <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" data-ai-hint="food item" />
      </div>
      <div className="flex-grow">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
            <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
          </div>
          <h4 className="font-semibold text-foreground">{item.name}</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
        <p className="font-bold text-lg text-foreground">₹{item.fullPrice}</p>
      </div>
      <div className="flex flex-col items-center justify-center h-24">
        {quantity > 0 ? (
          <div className="flex items-center gap-1 bg-background p-1 rounded-lg border border-border">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" onClick={() => onDecrement(item)}><Minus size={16}/></Button>
            <span className="font-bold w-6 text-center text-foreground">{quantity}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" onClick={() => onIncrement(item)}><Plus size={16}/></Button>
          </div>
        ) : (
          <Button 
            onClick={() => onIncrement(item)}
            variant="outline"
            className="w-24 bg-muted hover:bg-primary hover:text-primary-foreground border-primary/20 text-primary font-bold"
          >
            ADD
          </Button>
        )}
      </div>
    </motion.div>
  );
};


const CartDrawer = ({ cart, onUpdateCart, onClose, onCheckout, notes, setNotes }) => {
    const subtotal = cart.reduce((sum, item) => sum + item.fullPrice * item.quantity, 0);

    return (
        <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 h-[85vh] bg-background border-t border-border rounded-t-2xl z-40 flex flex-col"
        >
            <div className="p-4 border-b border-border flex justify-between items-center flex-shrink-0">
                <h2 className="text-xl font-bold">Your Order</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
            </div>

            <div className="flex-grow p-4 overflow-y-auto">
                {cart.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">Your cart is empty</div>
                ) : (
                    <div className="space-y-3">
                        {cart.map(item => (
                            <div key={item.id} className="flex items-center gap-4 bg-card p-3 rounded-lg">
                                <p className="flex-grow font-semibold text-foreground">{item.name}</p>
                                <div className="flex items-center gap-2">
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onUpdateCart(item, 'decrement')}>-</Button>
                                    <span className="font-bold w-5 text-center">{item.quantity}</span>
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onUpdateCart(item, 'increment')}>+</Button>
                                </div>
                                <p className="w-20 text-right font-bold">₹{item.fullPrice * item.quantity}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <div className="p-4 border-t border-border bg-card/50 flex-shrink-0">
                <div className="relative">
                    <CookingPot className="absolute left-3 top-3 h-5 w-5 text-muted-foreground"/>
                    <textarea 
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add cooking instructions... (e.g., make it extra spicy)"
                      rows={2}
                      className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border text-sm"
                    />
                </div>
            </div>

            {cart.length > 0 && (
                <div className="p-4 border-t border-border bg-background flex-shrink-0">
                    <div className="flex justify-between items-center mb-4 text-lg">
                        <span className="font-semibold text-muted-foreground">Subtotal:</span>
                        <span className="font-bold text-foreground">₹{subtotal}</span>
                    </div>
                     <Button onClick={onCheckout} className="w-full bg-gradient-to-r from-primary to-accent h-12 text-lg font-bold">
                        Proceed to Checkout
                    </Button>
                </div>
            )}
        </motion.div>
    )
};


const CheckoutModal = ({ isOpen, onClose, restaurantId, phone, cart, notes }) => {
    const [existingUser, setExistingUser] = useState(null);
    const [isUserLoading, setIsUserLoading] = useState(true);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [selectedAddress, setSelectedAddress] = useState(null);
    const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      const fetchUser = async () => {
        if (!isOpen) return;
        setIsUserLoading(true);
        setError('');

        if (!phone) {
            setError("Could not verify your details. Phone number is missing.");
            setIsUserLoading(false);
            // Don't show new user form if phone is missing, as it's required.
            return;
        };

        try {
            const normalizedPhone = phone.startsWith('91') ? phone.substring(2) : phone;

            const usersRef = collection(db, "users");
            const q = query(usersRef, where("phone", "==", normalizedPhone), limit(1));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                const userDoc = querySnapshot.docs[0];
                const userData = userDoc.data();
                setExistingUser(userData);
                setName(userData.name);
                if (userData.addresses && userData.addresses.length > 0) {
                    setSelectedAddress(userData.addresses[0]);
                    setIsAddingNewAddress(false);
                } else {
                    setIsAddingNewAddress(true);
                }
            } else {
                setExistingUser(null);
                setIsAddingNewAddress(true);
            }
        } catch(e) {
            console.error("Error fetching user by phone", e);
            setError("Could not verify your details. Please try again.");
            setExistingUser(null);
        } finally {
            setIsUserLoading(false);
        }
      }
      fetchUser();
    }, [isOpen, phone]);

    const handlePlaceOrder = async () => {
        setError('');
        
        let finalAddress = '';
        if (existingUser && !isAddingNewAddress) {
            if (!selectedAddress) {
                setError('Please select a delivery address.');
                return;
            }
            finalAddress = selectedAddress.full;
        } else {
            if (!name.trim() || !address.trim()) {
                setError('Please fill in your name and a valid address.');
                return;
            }
            finalAddress = address;
        }
        
        setLoading(true);
        try {
            const payload = {
                name: name,
                address: finalAddress,
                phone: phone.startsWith('91') ? phone.substring(2) : phone, // Send normalized phone to backend
                restaurantId,
                items: cart.map(item => ({ name: item.name, quantity: item.quantity, price: item.fullPrice })),
                notes
            };
            
            const res = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            alert("Order Placed Successfully!");
            onClose();
            window.location.reload();
            
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    if (isUserLoading) {
        return (
            <Dialog open={isOpen} onOpenChange={onClose}>
                 <DialogContent className="bg-background border-border text-foreground">
                    <div className="flex justify-center items-center h-48">
                        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
                    </div>
                 </DialogContent>
            </Dialog>
        )
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Confirm Your Details</DialogTitle>
                    <DialogDescription>Almost there! Just confirm your details to place the order.</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {existingUser && !isAddingNewAddress ? (
                        <div>
                            <h3 className="font-semibold mb-2">Welcome back, {name}! Select a delivery address:</h3>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {(existingUser.addresses || []).map(addr => (
                                    <div key={addr.id} onClick={() => setSelectedAddress(addr)} className={cn("p-3 rounded-lg border-2 cursor-pointer transition-colors", selectedAddress?.id === addr.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted')}>
                                        <p>{addr.full}</p>
                                    </div>
                                ))}
                            </div>
                            <Button variant="link" className="mt-2 p-0 h-auto text-primary" onClick={() => setIsAddingNewAddress(true)}>+ Add New Address</Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {!existingUser && (
                                <div>
                                    <label className="block text-sm font-medium text-muted-foreground mb-1">Full Name</label>
                                    <div className="relative">
                                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                      <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" />
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-1">
                                    {existingUser ? "New Delivery Address" : "Delivery Address"}
                                </label>
                                <div className="relative">
                                  <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full delivery address" />
                                </div>
                                {existingUser && existingUser.addresses && existingUser.addresses.length > 0 && (
                                    <Button variant="link" className="text-sm p-0 h-auto text-muted-foreground mt-2" onClick={() => setIsAddingNewAddress(false)}>← Back to saved addresses</Button>
                                )}
                            </div>
                        </div>
                    )}
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                </div>

                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={handlePlaceOrder} className="bg-gradient-to-r from-primary to-accent" disabled={loading}>
                        {loading ? 'Placing Order...' : 'Confirm & Place Order'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const MenuBrowserModal = ({ isOpen, onClose, categories, onCategoryClick }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-2xl">Browse Menu</DialogTitle>
          <DialogDescription>Quickly jump to any category.</DialogDescription>
        </DialogHeader>
        <div className="py-4 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
          {categories.map(category => (
            <button
              key={category.key}
              onClick={() => {
                onCategoryClick(category.key);
                onClose();
              }}
              className="p-4 rounded-lg text-left bg-card hover:bg-muted border border-border transition-colors"
            >
              <h4 className="font-semibold text-foreground">{category.title}</h4>
              <p className="text-sm text-muted-foreground">{category.count} items</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};


const OrderPageInternal = () => {
    const params = useParams();
    const searchParams = useSearchParams();
    const { restaurantId } = params;
    const phone = searchParams.get('phone');

    const [restaurantName, setRestaurantName] = useState('');
    const [rawMenu, setRawMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isMenuBrowserOpen, setIsMenuBrowserOpen] = useState(false);
    const [notes, setNotes] = useState("");
    
    // Filters and Sorting State
    const [sortBy, setSortBy] = useState('default'); // 'default', 'price-asc', 'price-desc'
    const [vegOnly, setVegOnly] = useState(false);


    useEffect(() => {
        const fetchMenuData = async () => {
            if (!restaurantId) return;
            setLoading(true);
            try {
                const res = await fetch(`/api/menu/${restaurantId}`);
                if (!res.ok) {
                    throw new Error('Failed to fetch menu data');
                }
                const data = await res.json();
                
                setRestaurantName(data.restaurantName);
                setRawMenu(data.menu);
            } catch (error) {
                console.error("Failed to fetch menu:", error);
                setRestaurantName('');
            } finally {
                setLoading(false);
            }
        };
        fetchMenuData();
    }, [restaurantId]);
    
    const processedMenu = useMemo(() => {
        let newMenu = JSON.parse(JSON.stringify(rawMenu)); // Deep copy

        for (const category in newMenu) {
            let items = newMenu[category];

            // 1. Filter by Veg/Non-Veg
            if (vegOnly) {
                items = items.filter(item => item.isVeg);
            }

            // 2. Sort items
            if (sortBy === 'price-asc') {
                items.sort((a, b) => a.fullPrice - b.fullPrice);
            } else if (sortBy === 'price-desc') {
                items.sort((a, b) => b.fullPrice - a.fullPrice);
            }
            // 'default' sort is by 'order' property, which is already handled by backend.
            
            newMenu[category] = items;
        }
        return newMenu;
    }, [rawMenu, sortBy, vegOnly]);


    const handleIncrement = (item) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (existingItem) {
                return prevCart.map(cartItem =>
                    cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            }
            return [...prevCart, { ...item, quantity: 1 }];
        });
    };
    
    const handleDecrement = (item) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (!existingItem) return prevCart;

            if (existingItem.quantity === 1) {
                return prevCart.filter(cartItem => cartItem.id !== item.id);
            }
            return prevCart.map(cartItem =>
                cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity - 1 } : cartItem
            );
        });
    };
    
    const handleCartUpdate = (item, action) => {
        if(action === 'increment') handleIncrement(item);
        if(action === 'decrement') handleDecrement(item);
    }

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + item.fullPrice * item.quantity, 0);
    
    const menuCategories = Object.keys(processedMenu)
        .map(key => ({
            key,
            title: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
            count: (processedMenu[key] || []).length
        }))
        .filter(category => category.count > 0);

    const handleCategoryClick = (categoryId) => {
        const section = document.getElementById(categoryId);
        if(section) {
            const yOffset = -120; // height of sticky headers
            const y = section.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({top: y, behavior: 'smooth'});
        }
    }

    const handleCheckout = () => {
        setIsCartOpen(false);
        setIsCheckoutOpen(true);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!restaurantName && !loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col gap-4 items-center justify-center text-foreground text-center">
                <Utensils size={48} className="text-destructive" />
                <h1 className="text-2xl font-bold">Could not load menu</h1>
                <p className="text-muted-foreground">This restaurant might not be available. Please try again later.</p>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-background text-foreground">
            <CheckoutModal isOpen={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} restaurantId={restaurantId} phone={phone} cart={cart} notes={notes} />
            <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />
            
            <AnimatePresence>
                {isCartOpen && <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 bg-black/60 z-30" onClick={() => setIsCartOpen(false)} />}
                {isCartOpen && <CartDrawer cart={cart} onUpdateCart={handleCartUpdate} onClose={() => setIsCartOpen(false)} onCheckout={handleCheckout} notes={notes} setNotes={setNotes} />}
            </AnimatePresence>

            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-muted-foreground">Ordering from</p>
                        <h1 className="text-xl font-bold">{restaurantName}</h1>
                    </div>
                     <div className="flex items-center gap-1 bg-green-500/10 text-green-300 px-2 py-1 rounded-full text-sm border border-green-500/20">
                        <Star size={14} className="fill-current"/> 4.1
                    </div>
                </div>
            </header>

            {/* Sort and Filter Bar */}
            <div className="sticky top-[65px] z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border">
                <div className="container mx-auto px-4 flex justify-between items-center">
                    <Popover>
                        <PopoverTrigger asChild>
                           <Button variant="outline" className="flex items-center gap-2">
                                <ArrowUpDown size={16} /> Sort
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56">
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Sort by</h4>
                                    <p className="text-sm text-muted-foreground">Sort dishes by price.</p>
                                </div>
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="sort-default">Default</Label>
                                        <Switch id="sort-default" checked={sortBy === 'default'} onCheckedChange={() => setSortBy('default')} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="sort-asc">Price: Low to High</Label>
                                        <Switch id="sort-asc" checked={sortBy === 'price-asc'} onCheckedChange={() => setSortBy('price-asc')} />
                                    </div>
                                     <div className="flex items-center justify-between">
                                        <Label htmlFor="sort-desc">Price: High to Low</Label>
                                        <Switch id="sort-desc" checked={sortBy === 'price-desc'} onCheckedChange={() => setSortBy('price-desc')} />
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex items-center gap-2">
                                <SlidersHorizontal size={16} /> Filter
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56">
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Filter</h4>
                                    <p className="text-sm text-muted-foreground">Filter by dietary preference.</p>
                                </div>
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="veg-only">Veg Only</Label>
                                        <Switch id="veg-only" checked={vegOnly} onCheckedChange={setVegOnly} />
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            <div className="container mx-auto px-4 mt-6 pb-32">
                <main>
                    <div className="space-y-10">
                        {menuCategories.map(({key, title}) => {
                            return (
                                <section id={key} key={key} className="scroll-mt-24">
                                    <h3 className="text-2xl font-bold mb-4 flex items-center gap-3"><Utensils /> {title}</h3>
                                    <div className="grid grid-cols-1 gap-4">
                                        {processedMenu[key].map(item => {
                                            const cartItem = cart.find(ci => ci.id === item.id);
                                            return (
                                                <MenuItemCard 
                                                    key={item.id} 
                                                    item={item} 
                                                    quantity={cartItem ? cartItem.quantity : 0}
                                                    onIncrement={handleIncrement}
                                                    onDecrement={handleDecrement}
                                                />
                                            )
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </main>
            </div>

            <footer className="fixed bottom-0 z-30 w-full p-4">
                <div className="container mx-auto flex justify-between items-center gap-4">
                    <AnimatePresence>
                        {totalCartItems > 0 && (
                            <motion.div
                                className="flex-grow"
                                initial={{ y: 100 }}
                                animate={{ y: 0 }}
                                exit={{ y: 100 }}
                                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            >
                                <Button onClick={() => setIsCartOpen(true)} className="bg-gradient-to-r from-primary to-accent h-14 text-lg font-bold rounded-xl shadow-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
                                    <div className="flex items-center gap-2">
                                       <ShoppingCart className="h-6 w-6"/> 
                                       <span>{totalCartItems} {totalCartItems > 1 ? 'Items' : 'Item'}</span>
                                    </div>
                                    <span>View Cart | ₹{subtotal}</span>
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <motion.div
                         initial={{ y: 100 }}
                         animate={{ y: 0 }}
                         transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 }}
                    >
                        <Button
                            onClick={() => setIsMenuBrowserOpen(true)}
                            className="bg-card text-foreground h-14 w-14 rounded-full shadow-lg flex items-center justify-center gap-2 border border-border"
                        >
                            <BookOpen size={24} />
                        </Button>
                    </motion.div>
                </div>
            </footer>
        </div>
    );
};

const OrderPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>}>
        <OrderPageInternal />
    </Suspense>
);

export default OrderPage;

    

    

