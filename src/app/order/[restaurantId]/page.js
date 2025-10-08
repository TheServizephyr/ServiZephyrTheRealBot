

'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';


// --- START: DUMMY DATA FOR UI DEMO ---
const dummyData = {
    restaurantName: 'ServiZephyr Demo Restaurant',
    deliveryCharge: 30,
    rating: 4.1,
    menu: {
        "starters": [
            { id: 'item-1', name: 'Paneer Tikka', description: 'Tandoor-cooked cottage cheese', fullPrice: 280, isVeg: true, isAvailable: true, categoryId: 'starters', imageUrl: 'https://picsum.photos/seed/paneertikka/100/100', rating: 4.5, isRecommended: true },
            { id: 'item-2', name: 'Chilli Chicken', description: 'Spicy diced chicken', fullPrice: 320, isVeg: false, isAvailable: true, categoryId: 'starters', imageUrl: 'https://picsum.photos/seed/chillichicken/100/100', rating: 4.7, isRecommended: true },
        ],
        "main-course": [
            { id: 'item-3', name: 'Dal Makhani', description: 'Creamy black lentils', fullPrice: 250, isVeg: true, isAvailable: true, categoryId: 'main-course', imageUrl: 'https://picsum.photos/seed/dalmakhani/100/100', rating: 4.2, isRecommended: false },
            { id: 'item-4', name: 'Butter Chicken', description: 'Classic creamy chicken curry', fullPrice: 450, isVeg: false, isAvailable: true, categoryId: 'main-course', imageUrl: 'https://picsum.photos/seed/butterchicken/100/100', rating: 3.8, isRecommended: false },
        ],
        "momos": [
            { id: 'item-5', name: 'Veg Steamed Momos', description: '8 Pcs, served with chutney', fullPrice: 120, isVeg: true, isAvailable: true, categoryId: 'momos', imageUrl: 'https://picsum.photos/seed/vegmomos/100/100', rating: 4.8, isRecommended: true },
        ],
         "desserts": [
            { id: 'item-6', name: 'Gulab Jamun', description: '2 Pcs, served hot', fullPrice: 80, isVeg: true, isAvailable: true, categoryId: 'desserts', imageUrl: 'https://picsum.photos/seed/gulabjamun/100/100', rating: 4.0, isRecommended: false },
        ],
    },
    coupons: [
        { id: 'coupon-1', code: 'SAVE100', description: 'Get flat ₹100 off on orders above ₹599', type: 'flat', value: 100, minOrder: 599 },
        { id: 'coupon-2', code: 'FREEDEL', description: 'Free delivery on all orders above ₹299', type: 'free_delivery', value: 0, minOrder: 299 },
    ],
    loyaltyPoints: 250, // Example loyalty points for a logged-in user
};
// --- END: DUMMY DATA ---


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
        <p className="font-bold text-lg text-green-600">₹{item.fullPrice}</p>
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
            className="w-24 bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            ADD
          </Button>
        )}
      </div>
    </motion.div>
  );
};


const CartDrawer = ({ cart, onUpdateCart, onClose, onCheckout, notes, setNotes, coupons, loyaltyPointsData, deliveryCharge, appliedCoupon, setAppliedCoupon, loyaltyDiscount, setLoyaltyDiscount, couponDiscount, finalDeliveryCharge, grandTotal, subtotal, cgst, sgst }) => {

    const handleApplyCoupon = (couponToApply) => {
        if (subtotal >= couponToApply.minOrder) {
            setAppliedCoupon(couponToApply);
        } else {
             // Silently fail or show a subtle message, but no alert
             console.log(`Min order for ${couponToApply.code} not met.`);
        }
    };
    
    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
    };
    
    const handleRedeemPoints = () => {
        if(loyaltyPointsData >= 100) {
            const redeemableAmount = Math.floor(loyaltyPointsData * 0.5); // 1 point = 0.5 Rs, floor to avoid paise issues
            setLoyaltyDiscount(redeemableAmount);
        } else {
            console.log("Not enough points to redeem.");
        }
    }

    return (
        <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 h-[90vh] bg-background border-t border-border rounded-t-2xl z-40 flex flex-col"
        >
            <div className="p-4 border-b border-border flex justify-between items-center flex-shrink-0">
                <h2 className="text-xl font-bold">Your Order Summary</h2>
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
                 {cart.length > 0 && (
                     <>
                        <div className="p-4 border-t border-border bg-card/50 flex-shrink-0 mt-4 rounded-lg">
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

                         <div className="p-4 border-t border-border bg-card/50 flex-shrink-0 mt-4 rounded-lg">
                            <h4 className="font-semibold mb-3 flex items-center gap-2"><Ticket/> Available Coupons</h4>
                            <div className="space-y-2">
                                {coupons && coupons.length > 0 ? coupons.map(coupon => (
                                    <div key={coupon.id} className="flex justify-between items-center bg-background p-3 rounded-md border border-dashed border-primary/30">
                                        <div>
                                            <p className="font-bold text-primary">{coupon.code}</p>
                                            <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                        </div>
                                        {appliedCoupon?.id === coupon.id ? (
                                            <Button variant="outline" size="sm" onClick={handleRemoveCoupon} className="text-red-400 border-red-400 hover:bg-red-400 hover:text-white">
                                                Remove
                                            </Button>
                                        ) : (
                                            <Button 
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleApplyCoupon(coupon)} 
                                                disabled={!!appliedCoupon}
                                                className="text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                                            >
                                                Apply
                                            </Button>
                                        )}
                                    </div>
                                )) : (
                                    <p className="text-sm text-muted-foreground text-center py-2">No coupons available at the moment.</p>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-border bg-card/50 flex-shrink-0 mt-4 rounded-lg">
                            <h4 className="font-semibold mb-2 flex items-center gap-2"><Gift/> Loyalty Points</h4>
                            <div className="flex justify-between items-center">
                                <p className="text-muted-foreground">You have <span className="font-bold text-primary">{loyaltyPointsData || 0}</span> points.</p>
                                <Button variant="outline" onClick={handleRedeemPoints} disabled={(loyaltyPointsData || 0) < 100 || loyaltyDiscount > 0}>
                                    {loyaltyDiscount > 0 ? "Redeemed!" : "Redeem Now"}
                                </Button>
                            </div>
                        </div>
                    </>
                 )}
            </div>

            {cart.length > 0 && (
                <div className="p-4 border-t-2 border-primary bg-background flex-shrink-0 shadow-lg">
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
                     <Button onClick={onCheckout} className="w-full bg-primary hover:bg-primary/90 h-12 text-lg font-bold">
                        Proceed to Checkout
                    </Button>
                </div>
            )}
        </motion.div>
    )
};


const CheckoutModal = ({ isOpen, onClose, restaurantId, phone, cart, notes, appliedCoupon, couponDiscount, loyaltyDiscount }) => {
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddress, setSelectedAddress] = useState(null);
    const [isAddingNew, setIsAddingNew] = useState(true); // Default to adding new for demo

    // Simplified effect for demo: just reset the form on open
    useEffect(() => {
        if (isOpen) {
            setLoading(false);
            setError('');
            setIsAddingNew(true);
            // Simulate a returning user with saved addresses for demo purposes
            if (phone === '9876543210') {
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

        if (!finalAddress) {
            setError('Please select or add a delivery address.');
            return;
        }
        if (!name.trim()) {
            setError('Please enter your name.');
            return;
        }

        setError('');
        setLoading(true);
        
        // Simulate API call
        setTimeout(() => {
            alert("Success! (Demo) - Your order has been placed.");
            setLoading(false);
            onClose();
             window.location.reload(); // Simulate page refresh after order
        }, 1500);
    };

    const renderContent = () => {
        return (
            <div className="space-y-4">
                {(isExistingUser && savedAddresses.length > 0) && (
                     <div className="space-y-4">
                        <h3 className="font-semibold">Welcome back, {name}! Select an address:</h3>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                            {savedAddresses.map((addr) => (
                                <div key={addr.id} onClick={() => { setSelectedAddress(addr.full); setIsAddingNew(false); }}
                                     className={cn("p-3 rounded-lg border cursor-pointer", selectedAddress === addr.full && !isAddingNew ? "border-primary bg-primary/10" : "border-border")}>
                                    {addr.full}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {isAddingNew ? (
                     <div className="space-y-4 pt-2">
                         {!isExistingUser && (
                            <div>
                                <Label htmlFor="checkout-name">Full Name</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                    <input id="checkout-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full name" />
                                </div>
                            </div>
                         )}
                        <div>
                            <Label htmlFor="checkout-address">Delivery Address</Label>
                            <div className="relative">
                                <Home className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <textarea id="checkout-address" value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border" placeholder="Enter your full delivery address" />
                            </div>
                        </div>
                    </div>
                ) : (
                    <Button variant="outline" className="w-full" onClick={() => { setIsAddingNew(true); setSelectedAddress(null); }}>
                        <PlusCircle className="mr-2 h-4 w-4"/> Add New Address
                    </Button>
                )}
            </div>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Confirm Your Details</DialogTitle>
                    <DialogDescription>Please provide your delivery details to place the order.</DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {renderContent()}
                    {error && <p className="text-red-500 text-sm text-center mt-4">{error}</p>}
                </div>

                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={loading}>Cancel</Button></DialogClose>
                    <Button onClick={handlePlaceOrder} className="bg-primary hover:bg-primary/90" disabled={loading}>
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

const RatingBadge = ({ rating }) => {
    const getRatingColor = () => {
        if (rating >= 4) return 'bg-green-500/10 text-green-300 border-green-500/20';
        if (rating >= 3) return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20';
        return 'bg-red-500/10 text-red-300 border-red-500/20';
    };

    return (
        <div className={cn("flex items-center gap-1 px-2 py-1 rounded-full text-sm border", getRatingColor())}>
            <Star size={14} className="fill-current"/> {rating.toFixed(1)}
        </div>
    );
};


const OrderPageInternal = () => {
    const params = useParams();
    const searchParams = useSearchParams();
    const { restaurantId } = params;
    const phone = searchParams.get('phone');

    // State now initialized with dummy data
    const [restaurantName, setRestaurantName] = useState(dummyData.restaurantName);
    const [deliveryCharge, setDeliveryCharge] = useState(dummyData.deliveryCharge);
    const [rating, setRating] = useState(dummyData.rating);
    const [rawMenu, setRawMenu] = useState(dummyData.menu);
    const [loading, setLoading] = useState(false); // No loading from backend
    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isMenuBrowserOpen, setIsMenuBrowserOpen] = useState(false);
    const [notes, setNotes] = useState("");
    
    // Filters and Sorting State
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('default'); // 'default', 'price-asc', 'price-desc'
    const [filters, setFilters] = useState({
        veg: false,
        nonVeg: false,
        recommended: false,
        topRated: false,
    });

    // Coupon and Discount State
    const [coupons, setCoupons] = useState(dummyData.coupons);
    const [loyaltyPoints, setLoyaltyPoints] = useState(dummyData.loyaltyPoints);
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);

    // Removed useEffect for fetching data
    
    const processedMenu = useMemo(() => {
        let newMenu = JSON.parse(JSON.stringify(rawMenu));
        const lowercasedQuery = searchQuery.toLowerCase();

        for (const category in newMenu) {
            let items = newMenu[category];
            
            // Apply search first
            if (lowercasedQuery) {
                items = items.filter(item => item.name.toLowerCase().includes(lowercasedQuery));
            }

            // Apply filters
            if (filters.veg) items = items.filter(item => item.isVeg);
            if (filters.nonVeg) items = items.filter(item => !item.isVeg);
            if (filters.recommended) items = items.filter(item => item.isRecommended);
            if (filters.topRated) items = items.filter(item => item.rating >= 4.5);
            
            // Apply sorting
            if (sortBy === 'price-asc') items.sort((a, b) => a.fullPrice - b.fullPrice);
            else if (sortBy === 'price-desc') items.sort((a, b) => b.fullPrice - a.fullPrice);
            
            newMenu[category] = items;
        }
        return newMenu;
    }, [rawMenu, sortBy, filters, searchQuery]);

    const handleFilterChange = (filterKey) => {
        setFilters(prev => {
            const newValue = !prev[filterKey];
            const newFilters = { ...prev, [filterKey]: newValue };
            // Ensure veg and non-veg are mutually exclusive
            if (filterKey === 'veg' && newValue) newFilters.nonVeg = false;
            if (filterKey === 'nonVeg' && newValue) newFilters.veg = false;
            return newFilters;
        });
    };
    
    const handleSortChange = (sortValue) => {
        setSortBy(prev => prev === sortValue ? 'default' : sortValue);
    }

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.fullPrice * item.quantity, 0), [cart]);

    const couponDiscount = useMemo(() => {
        if (!appliedCoupon) return 0;
        if (subtotal < appliedCoupon.minOrder) {
            setAppliedCoupon(null);
            return 0;
        }
        if (appliedCoupon.type === 'flat') return appliedCoupon.value;
        if (appliedCoupon.type === 'percentage') return (subtotal * appliedCoupon.value) / 100;
        return 0;
    }, [appliedCoupon, subtotal]);

    const finalDeliveryCharge = useMemo(() => appliedCoupon?.type === 'free_delivery' ? 0 : deliveryCharge, [appliedCoupon, deliveryCharge]);

    const { cgst, sgst, grandTotal } = useMemo(() => {
        const taxableAmount = subtotal - couponDiscount - loyaltyDiscount;
        const tax = taxableAmount > 0 ? taxableAmount * 0.05 : 0;
        const total = taxableAmount + finalDeliveryCharge + (tax * 2);
        return { cgst: tax, sgst: tax, grandTotal: total };
    }, [subtotal, couponDiscount, loyaltyDiscount, finalDeliveryCharge]);

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
            const yOffset = -120;
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
    
    return (
        <div className="min-h-screen bg-background text-foreground">
            <CheckoutModal isOpen={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} restaurantId={restaurantId} phone={phone} cart={cart} notes={notes} appliedCoupon={appliedCoupon} couponDiscount={couponDiscount} loyaltyDiscount={loyaltyDiscount} />
            <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />
            
            <AnimatePresence>
                {isCartOpen && <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 bg-black/60 z-30" onClick={() => setIsCartOpen(false)} />}
                {isCartOpen && <CartDrawer cart={cart} onUpdateCart={handleCartUpdate} onClose={() => setIsCartOpen(false)} onCheckout={handleCheckout} notes={notes} setNotes={setNotes} coupons={coupons} loyaltyPointsData={loyaltyPoints} deliveryCharge={deliveryCharge} appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon} loyaltyDiscount={loyaltyDiscount} setLoyaltyDiscount={setLoyaltyDiscount} couponDiscount={couponDiscount} finalDeliveryCharge={finalDeliveryCharge} grandTotal={grandTotal} subtotal={subtotal} cgst={cgst} sgst={sgst} />}
            </AnimatePresence>

            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-muted-foreground">Ordering from</p>
                        <h1 className="text-xl font-bold">{restaurantName}</h1>
                    </div>
                     <RatingBadge rating={rating} />
                </div>
            </header>

            {/* Search and Filter Bar */}
            <div className="sticky top-[65px] z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border">
                <div className="container mx-auto px-4 flex items-center gap-4">
                    <div className="relative flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search for dishes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-input border border-border rounded-lg pl-10 pr-4 py-2 h-10 text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                        />
                    </div>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex items-center gap-2 flex-shrink-0">
                                <SlidersHorizontal size={16} /> Filter
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                            <div className="grid gap-4">
                               <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Sort by</h4>
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="sort-asc">Price: Low to High</Label>
                                        <Switch id="sort-asc" checked={sortBy === 'price-asc'} onCheckedChange={() => handleSortChange('price-asc')} />
                                    </div>
                                     <div className="flex items-center justify-between">
                                        <Label htmlFor="sort-desc">Price: High to Low</Label>
                                        <Switch id="sort-desc" checked={sortBy === 'price-desc'} onCheckedChange={() => handleSortChange('price-desc')} />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Filter By</h4>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant={filters.veg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('veg')} className="flex items-center gap-2">
                                            <Utensils size={16} className={cn(filters.veg ? '' : 'text-green-500')} />Veg Only
                                        </Button>
                                        <Button variant={filters.nonVeg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('nonVeg')} className="flex items-center gap-2">
                                            <Flame size={16} className={cn(filters.nonVeg ? '' : 'text-red-500')} />Non-Veg Only
                                        </Button>
                                        <Button variant={filters.recommended ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('recommended')} className="flex items-center gap-2">
                                            <Sparkles size={16} className={cn(filters.recommended ? '' : 'text-yellow-500')} />Highly reordered
                                        </Button>
                                        <Button variant={filters.topRated ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('topRated')} className="flex items-center gap-2">
                                            <Star size={16} className={cn(filters.topRated ? '' : 'text-primary')} />Top Rated
                                        </Button>
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
                        {menuCategories.length > 0 ? menuCategories.map(({key, title}) => {
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
                        }) : (
                            <div className="text-center py-16 text-muted-foreground">
                                <p className="text-lg font-semibold">No dishes match your search.</p>
                                <p>Try clearing the search or filters to see more options.</p>
                            </div>
                        )}
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
                                <Button onClick={() => setIsCartOpen(true)} className="bg-primary hover:bg-primary/90 h-14 text-lg font-bold rounded-xl shadow-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
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
