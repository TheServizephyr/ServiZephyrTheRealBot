
'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, LayoutDashboard, MessageCircle, ShoppingCart, Utensils, Pizza, Soup, Drumstick, Salad, CakeSlice, GlassWater, Plus, Minus, X, Home, User, MapPin } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";

// --- MOCK DATA (will be replaced by API call) ---
const mockMenuData = {
    restaurantName: "The Curry Cloud",
    categories: {
      "starters": { title: "Starters", icon: Utensils, items: [
        { id: 's1', name: 'Paneer Tikka', description: 'Smoky, grilled cottage cheese cubes.', price: 280, isVeg: true, imageUrl: 'https://picsum.photos/seed/paneertikka/100/100' },
        { id: 's2', name: 'Chilli Chicken', description: 'Spicy chicken with peppers and onions.', price: 320, isVeg: false, imageUrl: 'https://picsum.photos/seed/chillichicken/100/100' },
        { id: 's3', name: 'Veg Manchurian Dry', description: 'Fried vegetable balls in a tangy sauce.', price: 240, isVeg: true, imageUrl: 'https://picsum.photos/seed/manchurian/100/100' },
      ]},
      "main-course": { title: "Main Course", icon: Soup, items: [
        { id: 'm1', name: 'Dal Makhani', description: 'Creamy black lentils, a house specialty.', price: 250, isVeg: true, imageUrl: 'https://picsum.photos/seed/dalmakhani/100/100' },
        { id: 'm2', name: 'Butter Chicken', description: 'Rich tomato and butter gravy with chicken.', price: 450, isVeg: false, imageUrl: 'https://picsum.photos/seed/butterchicken/100/100' },
        { id: 'm3', name: 'Kadhai Paneer', description: 'Cottage cheese in a spicy tomato-onion gravy.', price: 350, isVeg: true, imageUrl: 'https://picsum.photos/seed/kadhaipaneer/100/100' },
      ]},
      "desserts": { title: "Desserts", icon: CakeSlice, items: [
        { id: 'd1', name: 'Gulab Jamun', description: 'Sweet milk solids dumplings in syrup.', price: 120, isVeg: true, imageUrl: 'https://picsum.photos/seed/gulabjamun/100/100' },
        { id: 'd2', name: 'Moong Dal Halwa', description: 'A rich, classic Indian dessert.', price: 150, isVeg: true, imageUrl: 'https://picsum.photos/seed/halwa/100/100' },
      ]},
       "beverages": { title: "Beverages", icon: GlassWater, items: [
        { id: 'b1', name: 'Coke', description: '300ml Can', price: 60, isVeg: true, imageUrl: 'https://picsum.photos/seed/coke/100/100' },
      ]},
    },
};

const mockExistingUser = {
  name: 'Ashwani Kumar',
  addresses: [
    { id: 'addr1', full: '123, ABC Society, Near Park, Pune' },
    { id: 'addr2', full: 'Work, Tower 4, Hinjewadi, Pune' },
  ]
};

// --- Sub-components for clean structure ---

const MenuItemCard = ({ item, onAddToCart }) => {
  return (
    <motion.div 
        className="flex items-start gap-4 p-4 bg-gray-800/50 rounded-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
    >
      <div className="relative w-20 h-20 rounded-md overflow-hidden bg-gray-700 flex-shrink-0">
         <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" data-ai-hint="food item" />
      </div>
      <div className="flex-grow">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-3 h-3 border-2 ${item.isVeg ? 'border-green-500' : 'border-red-500'} rounded-sm flex items-center justify-center`}>
            <div className={`w-1.5 h-1.5 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
          </div>
          <h4 className="font-semibold text-white">{item.name}</h4>
        </div>
        <p className="text-xs text-gray-400 mb-2">{item.description}</p>
        <p className="font-bold text-gray-200">₹{item.price}</p>
      </div>
      <Button 
        onClick={() => onAddToCart(item)}
        variant="outline" 
        size="sm"
        className="self-center bg-gray-700 hover:bg-indigo-600 hover:text-white border-gray-600"
      >
        ADD
      </Button>
    </motion.div>
  );
};


const CartDrawer = ({ cart, onUpdateCart, onClose }) => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return (
        <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 h-[85vh] bg-gray-900 border-t border-gray-700 rounded-t-2xl z-40 flex flex-col"
        >
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h2 className="text-xl font-bold">Your Order</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
            </div>

            <div className="flex-grow p-4 overflow-y-auto">
                {cart.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-500">Your cart is empty</div>
                ) : (
                    <div className="space-y-3">
                        {cart.map(item => (
                            <div key={item.id} className="flex items-center gap-4 bg-gray-800 p-3 rounded-lg">
                                <p className="flex-grow font-semibold text-white">{item.name}</p>
                                <div className="flex items-center gap-2">
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onUpdateCart(item, 'decrement')}>-</Button>
                                    <span className="font-bold w-5 text-center">{item.quantity}</span>
                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onUpdateCart(item, 'increment')}>+</Button>
                                </div>
                                <p className="w-20 text-right font-bold">₹{item.price * item.quantity}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {cart.length > 0 && (
                <div className="p-4 border-t border-gray-700 bg-gray-900">
                    <div className="flex justify-between items-center mb-4 text-lg">
                        <span className="font-semibold text-gray-300">Subtotal:</span>
                        <span className="font-bold text-white">₹{subtotal}</span>
                    </div>
                </div>
            )}
        </motion.div>
    )
};


const CheckoutModal = ({ isOpen, onClose, restaurantId, phone, cart }) => {
    // In a real app, this would be fetched from a backend
    const [isExistingUser] = useState(false); // mock this for now
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [selectedAddress, setSelectedAddress] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handlePlaceOrder = async () => {
        setError('');
        
        if (isExistingUser) {
            if (!selectedAddress) {
                setError('Please select a delivery address.');
                return;
            }
        } else {
            if (!name.trim() || !address.trim()) {
                setError('Please fill in your name and address.');
                return;
            }
        }
        
        setLoading(true);
        // Simulate API call to place order and register user if new
        try {
            const payload = {
                name: isExistingUser ? mockExistingUser.name : name,
                address: isExistingUser ? selectedAddress.full : address,
                phone,
                restaurantId,
                items: cart
            };

            const res = await fetch('/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            alert("Order Placed Successfully!");
            onClose(); // Close modal on success
            window.location.reload(); // Reset state for now
            
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-gray-900 border-gray-700 text-white">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Confirm Your Details</DialogTitle>
                    <DialogDescription>Almost there! Just confirm your details to place the order.</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {isExistingUser ? (
                        <div>
                            <h3 className="font-semibold mb-2">Select a Delivery Address</h3>
                            <div className="space-y-2">
                                {mockExistingUser.addresses.map(addr => (
                                    <div key={addr.id} onClick={() => setSelectedAddress(addr)} className={cn("p-3 rounded-lg border-2 cursor-pointer transition-colors", selectedAddress?.id === addr.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-600 hover:bg-gray-700')}>
                                        <p>{addr.full}</p>
                                    </div>
                                ))}
                            </div>
                            <Button variant="link" className="mt-2 p-0 h-auto">+ Add New Address</Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                                <div className="relative">
                                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-gray-800 border border-gray-600" placeholder="Enter your full name" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Delivery Address</label>
                                <div className="relative">
                                  <Home className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-gray-800 border border-gray-600" placeholder="Enter your full delivery address" />
                                </div>
                            </div>
                        </div>
                    )}
                    {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                </div>

                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={handlePlaceOrder} className="bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                        {loading ? 'Placing Order...' : 'Confirm & Place Order'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const OrderPageInternal = () => {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { restaurantId } = params;
    const phone = searchParams.get('phone');

    const [menu, setMenu] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState(null);
    const sectionRefs = useRef({});

    useEffect(() => {
        setLoading(true);
        setTimeout(() => {
            setMenu(mockMenuData);
            const firstCategory = Object.keys(mockMenuData.categories)[0];
            setActiveCategory(firstCategory);
            Object.keys(mockMenuData.categories).forEach(key => {
                sectionRefs.current[key] = React.createRef();
            });
            setLoading(false);
        }, 1000);
    }, [restaurantId]);

    const handleAddToCart = (item) => {
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
    
    const handleUpdateCart = (item, action) => {
        setCart(prevCart => {
            const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
            if (!existingItem) return prevCart;

            if (action === 'increment') {
                 return prevCart.map(cartItem =>
                    cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            }
            if (action === 'decrement') {
                if (existingItem.quantity === 1) {
                    return prevCart.filter(cartItem => cartItem.id !== item.id);
                }
                return prevCart.map(cartItem =>
                    cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity - 1 } : cartItem
                );
            }
            return prevCart;
        });
    };

    const handleCategoryClick = (key) => {
        setActiveCategory(key);
        const element = document.getElementById(key);
        if (element) {
            const headerOffset = 140; // height of sticky headers
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
            window.scrollTo({ top: offsetPosition, behavior: "smooth" });
        }
    }

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    const handleViewCart = () => {
        if (totalCartItems === 0) {
            alert("Your cart is empty. Please add items to proceed.");
            return;
        }
        setIsCheckoutOpen(true);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (!menu) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
                <p>Could not load menu for this restaurant.</p>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-gray-900 text-white">
            <CheckoutModal isOpen={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} restaurantId={restaurantId} phone={phone} cart={cart} />

            <header className="sticky top-0 z-20 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-gray-400">Ordering from</p>
                        <h1 className="text-xl font-bold">{menu.restaurantName}</h1>
                    </div>
                </div>
            </header>
            
            <div className="sticky top-[69px] z-20 bg-gray-900/80 backdrop-blur-lg py-2 overflow-x-auto">
                 <div className="container mx-auto px-4 flex gap-2">
                     {Object.entries(menu.categories).map(([key, { title, icon: Icon }]) => (
                         <button 
                            key={key}
                            onClick={() => handleCategoryClick(key)}
                            className={cn(
                                "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors",
                                activeCategory === key 
                                ? "bg-indigo-500 text-white" 
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            )}
                         >
                            <Icon size={16} />
                            {title}
                         </button>
                     ))}
                 </div>
            </div>


            <div className="container mx-auto px-4 mt-6">
                <main>
                    <div className="space-y-10">
                        {Object.entries(menu.categories).map(([key, { title, items }]) => (
                            <section id={key} key={key} className="pt-2 scroll-mt-20">
                                <h3 className="text-2xl font-bold mb-4">{title}</h3>
                                <div className="grid grid-cols-1 gap-4">
                                    {items.map(item => (
                                        <MenuItemCard key={item.id} item={item} onAddToCart={handleAddToCart} />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </main>
            </div>

            <AnimatePresence>
                {isCartOpen && <CartDrawer cart={cart} onUpdateCart={handleUpdateCart} onClose={() => setIsCartOpen(false)} />}
            </AnimatePresence>

             <footer className="sticky bottom-0 z-30 bg-gray-900/80 backdrop-blur-lg border-t border-gray-700 p-4">
                <Button onClick={handleViewCart} className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 text-lg font-bold">
                    <ShoppingCart className="mr-2 h-5 w-5"/> 
                    {totalCartItems > 0 ? `View Cart (${totalCartItems})` : 'View Cart'}
                </Button>
            </footer>
        </div>
    );
};

// This wrapper component is needed to use useSearchParams
const OrderPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-500"></div></div>}>
        <OrderPageInternal />
    </Suspense>
);

export default OrderPage;
