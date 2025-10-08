

'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => onDecrement(item)}><Minus size={16}/></Button>
            <span className="font-bold w-6 text-center text-foreground">{quantity}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => onIncrement(item)}><Plus size={16}/></Button>
          </div>
        ) : (
          <Button
            onClick={() => onIncrement(item)}
            className="w-24 bg-green-600 text-white font-bold border border-green-600 hover:bg-green-700 shadow-md active:translate-y-px"
          >
            ADD
          </Button>
        )}
      </div>
    </motion.div>
  );
};

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
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { restaurantId } = params;
    const phone = searchParams.get('phone');

    const [restaurantName, setRestaurantName] = useState(dummyData.restaurantName);
    const [deliveryCharge, setDeliveryCharge] = useState(dummyData.deliveryCharge);
    const [rating, setRating] = useState(dummyData.rating);
    const [rawMenu, setRawMenu] = useState(dummyData.menu);
    const [loading, setLoading] = useState(false);
    const [cart, setCart] = useState([]);
    const [isMenuBrowserOpen, setIsMenuBrowserOpen] = useState(false);
    const [notes, setNotes] = useState("");
    const [isClearCartDialogOpen, setIsClearCartDialogOpen] = useState(false);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('default');
    const [filters, setFilters] = useState({
        veg: false,
        nonVeg: false,
        recommended: false,
    });
    
    const [openCategory, setOpenCategory] = useState(null);

    const [coupons, setCoupons] = useState(dummyData.coupons);
    const [loyaltyPoints, setLoyaltyPoints] = useState(dummyData.loyaltyPoints);
    
    // Load cart from localStorage on initial render
    useEffect(() => {
        if (restaurantId) {
            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                const parsedData = JSON.parse(savedCartData);
                setCart(parsedData.cart || []);
                setNotes(parsedData.notes || '');
            }
        }
    }, [restaurantId]);
    
    const processedMenu = useMemo(() => {
        let newMenu = JSON.parse(JSON.stringify(rawMenu));
        const lowercasedQuery = searchQuery.toLowerCase();

        for (const category in newMenu) {
            let items = newMenu[category];
            
            if (lowercasedQuery) {
                items = items.filter(item => item.name.toLowerCase().includes(lowercasedQuery));
            }

            if (filters.veg) items = items.filter(item => item.isVeg);
            if (filters.nonVeg) items = items.filter(item => !item.isVeg);
            if (filters.recommended) items = items.filter(item => item.isRecommended);
            
            if (sortBy === 'price-asc') items.sort((a, b) => a.fullPrice - b.fullPrice);
            else if (sortBy === 'price-desc') items.sort((a, b) => b.fullPrice - a.fullPrice);
            else if (sortBy === 'rating-desc') items.sort((a,b) => (b.rating || 0) - (a.rating || 0));
            
            newMenu[category] = items;
        }
        return newMenu;
    }, [rawMenu, sortBy, filters, searchQuery]);

    const menuCategories = useMemo(() => Object.keys(processedMenu)
        .map(key => ({
            key,
            title: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
            count: (processedMenu[key] || []).length
        }))
        .filter(category => category.count > 0), [processedMenu]);

    useEffect(() => {
        if(menuCategories.length > 0 && openCategory === null) {
            setOpenCategory(menuCategories[0].key);
        }
    }, [menuCategories, openCategory]);


    const handleFilterChange = (filterKey) => {
        setFilters(prev => {
            const newValue = !prev[filterKey];
            const newFilters = { ...prev, [filterKey]: newValue };
            if (filterKey === 'veg' && newValue) newFilters.nonVeg = false;
            if (filterKey === 'nonVeg' && newValue) newFilters.veg = false;
            return newFilters;
        });
    };
    
    const handleSortChange = (sortValue) => {
        setSortBy(prev => prev === sortValue ? 'default' : sortValue);
    }

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.fullPrice * item.quantity, 0), [cart]);

    const updateCart = (newCart, newNotes) => {
        setCart(newCart);
        if (newNotes !== undefined) {
            setNotes(newNotes);
        }
        const cartData = {
            cart: newCart,
            notes: newNotes !== undefined ? newNotes : notes,
            restaurantId,
            restaurantName,
            phone,
            coupons,
            loyaltyPoints,
            deliveryCharge,
        };
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(cartData));
    };

    const handleIncrement = (item) => {
        let newCart;
        const existingItem = cart.find(cartItem => cartItem.id === item.id);
        if (existingItem) {
            newCart = cart.map(cartItem =>
                cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
            );
        } else {
            newCart = [...cart, { ...item, quantity: 1 }];
        }
        updateCart(newCart);
    };
    
    const handleDecrement = (item) => {
        let newCart;
        const existingItem = cart.find(cartItem => cartItem.id === item.id);
        if (!existingItem) return;

        if (existingItem.quantity === 1) {
            newCart = cart.filter(cartItem => cartItem.id !== item.id);
        } else {
            newCart = cart.map(cartItem =>
                cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity - 1 } : cartItem
            );
        }
        updateCart(newCart);
    };
    
    const handleClearCart = () => {
        localStorage.removeItem(`cart_${restaurantId}`);
        setCart([]);
        setIsClearCartDialogOpen(false);
    };

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    

    const handleCategoryClick = (categoryId) => {
        const section = document.getElementById(categoryId);
        if(section) {
            const yOffset = -120;
            const y = section.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({top: y, behavior: 'smooth'});
        }
    }

    const handleCheckout = () => {
        router.push(`/cart?restaurantId=${restaurantId}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600"></div>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-background text-foreground">
            <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />
            <ClearCartDialog 
                isOpen={isClearCartDialogOpen}
                onClose={() => setIsClearCartDialogOpen(false)}
                onConfirm={handleClearCart}
            />

            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-muted-foreground">Ordering from</p>
                        <h1 className="text-xl font-bold">{restaurantName}</h1>
                    </div>
                     <RatingBadge rating={rating} />
                </div>
            </header>

            <div className="sticky top-[65px] z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border">
                <div className="container mx-auto px-4 flex items-center gap-4">
                    <div className="relative flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search for dishes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-input border border-border rounded-lg pl-10 pr-4 py-2 h-10 text-sm focus:ring-2 focus:ring-green-600 focus:border-green-600 outline-none"
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
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant={sortBy === 'price-asc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('price-asc')} className={cn(sortBy === 'price-asc' && 'bg-green-600 hover:bg-green-700 text-white')}>Price: Low to High</Button>
                                        <Button variant={sortBy === 'price-desc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('price-desc')} className={cn(sortBy === 'price-desc' && 'bg-green-600 hover:bg-green-700 text-white')}>Price: High to Low</Button>
                                        <Button variant={sortBy === 'rating-desc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('rating-desc')} className={cn(sortBy === 'rating-desc' && 'bg-green-600 hover:bg-green-700 text-white')}>Top Rated</Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Filter By</h4>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant={filters.veg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('veg')} className={cn("flex items-center gap-2", filters.veg && 'bg-green-600 hover:bg-green-700 text-white')}>
                                            <Utensils size={16} className={cn(filters.veg ? '' : 'text-green-500')} />Veg Only
                                        </Button>
                                        <Button variant={filters.nonVeg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('nonVeg')} className={cn("flex items-center gap-2", filters.nonVeg && 'bg-green-600 hover:bg-green-700 text-white')}>
                                            <Flame size={16} className={cn(filters.nonVeg ? '' : 'text-red-500')} />Non-Veg Only
                                        </Button>
                                        <Button variant={filters.recommended ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('recommended')} className={cn("flex items-center gap-2", filters.recommended && 'bg-green-600 hover:bg-green-700 text-white')}>
                                            <Sparkles size={16} className={cn(filters.recommended ? '' : 'text-yellow-500')} />Highly reordered
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
                    <div className="space-y-4">
                        {menuCategories.length > 0 ? menuCategories.map(({key, title}) => {
                             const isExpanded = openCategory === key;
                            return (
                                <motion.section layout id={key} key={key} className="scroll-mt-24 bg-card border border-border rounded-xl overflow-hidden">
                                     <button className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors" onClick={() => setOpenCategory(isExpanded ? null : key)}>
                                        <h3 className="text-2xl font-bold flex items-center gap-3">{title}</h3>
                                        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                                            <ChevronDown size={24}/>
                                        </motion.div>
                                    </button>
                                     <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="grid grid-cols-1 gap-4 p-4 pt-0">
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
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.section>
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

             <footer className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
                <div className="container mx-auto p-4 w-full relative">
                    <div className="flex justify-end w-full">
                        
                        <div className="flex-grow-0 flex-shrink-0">
                             <motion.button
                                onClick={() => setIsMenuBrowserOpen(true)}
                                className="absolute right-4 bg-black text-white h-16 w-16 rounded-2xl shadow-lg flex flex-col items-center justify-center gap-1 border border-gray-700 pointer-events-auto"
                                animate={{ bottom: totalCartItems > 0 ? 96 : 16 }}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                             >
                                <BookOpen size={24} className="text-primary" />
                                <span className="text-xs font-bold">Menu</span>
                            </motion.button>
                        </div>
                    </div>
                    
                    <AnimatePresence>
                        {totalCartItems > 0 && (
                             <motion.div
                                className="w-full pointer-events-auto absolute bottom-4"
                                initial={{ y: 100 }}
                                animate={{ y: 0 }}
                                exit={{ y: 100 }}
                                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            >
                                <Button onClick={handleCheckout} className="bg-green-600 hover:bg-green-700 h-14 text-lg font-bold rounded-lg shadow-green-500/30 flex justify-between items-center text-white w-full">
                                    <div className="flex items-center gap-2">
                                       <ShoppingCart className="h-6 w-6"/> 
                                       <span>{totalCartItems} {totalCartItems > 1 ? 'Items' : 'Item'}</span>
                                    </div>
                                    <span>View Cart | ₹{subtotal}</span>
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </footer>
        </div>
    );
};

const OrderPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600"></div></div>}>
        <OrderPageInternal />
    </Suspense>
);

export default OrderPage;
