
'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';


const CustomizationDrawer = ({ item, isOpen, onClose, onAddToCart }) => {
    const [selectedPortion, setSelectedPortion] = useState(null);
    const [selectedAddOns, setSelectedAddOns] = useState({});

    useEffect(() => {
        if (item) {
            setSelectedPortion(item.portions?.[0] || null);
            // Initialize add-ons state
            const initialAddOns = {};
            (item.addOnGroups || []).forEach(group => {
                // Always initialize as an array for multi-select
                initialAddOns[group.title] = [];
            });
            setSelectedAddOns(initialAddOns);
        }
    }, [item]);

    const handleAddOnSelect = (groupTitle, addOn) => {
        setSelectedAddOns(prev => {
            const newSelections = { ...prev };
            const currentSelection = newSelections[groupTitle] || [];
            const isSelected = currentSelection.some(a => a.name === addOn.name);

            if (isSelected) {
                // If it's already selected, remove it
                newSelections[groupTitle] = currentSelection.filter(a => a.name !== addOn.name);
            } else {
                // If not selected, add it
                newSelections[groupTitle] = [...currentSelection, addOn];
            }
            return newSelections;
        });
    };
    

    const totalPrice = useMemo(() => {
        if (!selectedPortion) return 0;
        let total = selectedPortion.price;
        for (const groupTitle in selectedAddOns) {
            const selection = selectedAddOns[groupTitle];
            // Always treat selection as an array of addons
            if (Array.isArray(selection)) {
                total += selection.reduce((sum, addon) => sum + addon.price, 0);
            }
        }
        return total;
    }, [selectedPortion, selectedAddOns]);

    const handleFinalAddToCart = () => {
        const allSelectedAddOns = Object.values(selectedAddOns).flat().filter(Boolean);
        onAddToCart(item, selectedPortion, allSelectedAddOns, totalPrice);
        onClose();
    };

    if (!item) return null;
    
    const showPortions = item.portions && item.portions.length > 1;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div 
                  className="fixed inset-0 bg-black/60 z-40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={onClose}
                >
                    <motion.div
                        className="fixed bottom-0 left-0 right-0 bg-background rounded-t-2xl p-6 flex flex-col max-h-[85vh]"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex-shrink-0">
                            <h3 className="text-2xl font-bold">{item.name}</h3>
                             {(item.addOnGroups?.length > 0) && <p className="text-sm font-semibold text-muted-foreground mt-1">Customize your dish</p>}
                             {(!showPortions && item.description) && <p className="text-sm text-muted-foreground mt-1">{item.description}</p>}
                        </div>

                        <div className="py-4 space-y-6 overflow-y-auto flex-grow">
                             {/* Portions - ONLY show if there are more than 1 */}
                            {showPortions && (
                                <div className="space-y-2">
                                    <h4 className="font-semibold text-lg">Size</h4>
                                    {item.portions.map(portion => (
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
                            )}
                            
                            {/* Add-on Groups */}
                            {(item.addOnGroups || []).map(group => (
                                <div key={group.title} className="space-y-2 pt-4 border-t border-dashed border-border">
                                    <h4 className="font-semibold text-lg">{group.title}</h4>
                                     {group.options.map(option => {
                                        const isSelected = (selectedAddOns[group.title] || []).some(a => a.name === option.name);
                                        
                                        return (
                                            <div
                                                key={option.name}
                                                onClick={() => handleAddOnSelect(group.title, option)}
                                                className={cn(
                                                    "flex justify-between items-center p-3 rounded-lg border cursor-pointer transition-all",
                                                    isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("w-5 h-5 border-2 flex items-center justify-center rounded", isSelected ? 'border-primary bg-primary' : 'border-muted-foreground')}>
                                                        {isSelected && <Check className="h-4 w-4 text-primary-foreground" />}
                                                    </div>
                                                    <span className="font-medium">{option.name}</span>
                                                </div>
                                                <span className="font-bold text-foreground">+ ₹{option.price}</span>
                                            </div>
                                        );
                                     })}
                                </div>
                            ))}
                        </div>
                        
                        <div className="flex-shrink-0 pt-4 border-t border-border">
                            <Button onClick={handleFinalAddToCart} className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground" disabled={!selectedPortion}>
                                {selectedPortion ? `Add item for ₹${totalPrice}` : 'Please select a size'}
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};


const MenuItemCard = ({ item, quantity, onAdd, onIncrement, onDecrement }) => {
    const minPricePortion = useMemo(() => {
        if (!item.portions || item.portions.length === 0) {
            return { price: 0 };
        }
        return item.portions.reduce((min, p) => p.price < min.price ? p : min, item.portions[0]);
    }, [item.portions]);

    return (
        <motion.div 
            className="flex gap-4 py-6 border-b border-border"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="flex-grow flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                    <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
                        <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                    </div>
                    <h4 className="font-semibold text-foreground">{item.name}</h4>
                </div>

                <div className="flex flex-wrap gap-2 mt-1 mb-2">
                    {item.tags && item.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
                            <TagIcon size={12} /> {tag}
                        </span>
                    ))}
                </div>
                
                <p className="font-bold text-md text-foreground">₹{minPricePortion.price}</p>
                
                <p className="text-sm text-muted-foreground mt-2 flex-grow">{item.description}</p>
            </div>

            <div className="w-32 flex-shrink-0 relative">
                <div className="relative w-full h-32 rounded-md overflow-hidden bg-muted">
                    <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" data-ai-hint="food item" />
                </div>
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                    {quantity > 0 ? (
                        <div className="flex items-center justify-center bg-background border-2 border-border rounded-lg shadow-lg h-10">
                            <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-r-none" onClick={() => onDecrement(item.id)}>
                                <Minus size={16}/>
                            </Button>
                            <span className="font-bold text-lg text-primary flex-grow text-center">{quantity}</span>
                            <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-l-none" onClick={() => onIncrement(item)}>
                                <Plus size={16}/>
                            </Button>
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

const BannerCarousel = ({ images, onClick, restaurantName, logoUrl }) => {
    const [index, setIndex] = useState(0);
  
    useEffect(() => {
      if (images.length <= 1) return;
      const interval = setInterval(() => {
        setIndex(prev => (prev + 1) % images.length);
      }, 5000); // Change image every 5 seconds
      return () => clearInterval(interval);
    }, [images.length]);
  
    return (
      <div className="relative h-48 w-full group mb-12">
        <div className="absolute inset-0 overflow-hidden cursor-pointer" onClick={onClick}>
            <AnimatePresence initial={false}>
            <motion.div
                key={index}
                className="absolute inset-0"
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '-100%', opacity: 0 }}
                transition={{ duration: 0.8, ease: 'easeInOut' }}
            >
                <Image
                src={images[index]}
                alt={`Banner ${index + 1}`}
                layout="fill"
                objectFit="cover"
                unoptimized
                />
            </motion.div>
            </AnimatePresence>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
        <div className="absolute bottom-[-3rem] left-0 right-0 px-4">
             <div className="container mx-auto bg-background shadow-lg border border-border rounded-xl p-3 flex items-center justify-between">
                {logoUrl && (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-border shadow-md flex-shrink-0">
                        <Image src={logoUrl} alt={`${restaurantName} logo`} layout="fill" objectFit="cover" />
                    </div>
                )}
                <div className="text-right">
                    <span className="block text-sm font-normal text-muted-foreground">Ordering from</span>
                    <h1 className="font-sans text-2xl md:text-3xl font-bold text-foreground">
                        {restaurantName}
                    </h1>
                </div>
            </div>
        </div>
      </div>
    );
  };

const OrderPageInternal = () => {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { restaurantId } = params;
    
    // **NEW FIX**: Prioritize URL param, then localStorage, then null.
    const [phone, setPhone] = useState(null);

    useEffect(() => {
        const phoneFromUrl = searchParams.get('phone');
        const phoneFromStorage = localStorage.getItem('lastKnownPhone');
        const effectivePhone = phoneFromUrl || phoneFromStorage;
        setPhone(effectivePhone);

        // If phone is from URL, update localStorage
        if (phoneFromUrl) {
            localStorage.setItem('lastKnownPhone', phoneFromUrl);
        }

    }, [searchParams]);

    // --- STATE MANAGEMENT ---
    const [restaurantData, setRestaurantData] = useState({
        name: '',
        status: null,
        logoUrl: '',
        bannerUrls: ['/order_banner.jpg'],
        deliveryCharge: 0,
        menu: {},
        coupons: [],
    });
    const [loyaltyPoints, setLoyaltyPoints] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState("");
    const [isMenuBrowserOpen, setIsMenuBrowserOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('default');
    const [filters, setFilters] = useState({
        veg: false,
        nonVeg: false,
        recommended: false,
    });
    const [customizationItem, setCustomizationItem] = useState(null);
    const [isBannerExpanded, setIsBannerExpanded] = useState(false);
    

    // --- DATA FETCHING ---
    useEffect(() => {
      // Only fetch if phone state has been determined
      if (phone === null) return; 

      const fetchMenuData = async () => {
        if (!restaurantId) return;
        setLoading(true);
        setError(null);
        try {
          // Pass the phone number as customerId to fetch user-specific coupons
          const res = await fetch(`/api/menu/${restaurantId}?phone=${phone || ''}`);
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to fetch menu data.');
          }
          const data = await res.json();

          setRestaurantData({
              name: data.restaurantName,
              status: data.approvalStatus, // Expecting status from API
              logoUrl: data.logoUrl || '',
              bannerUrls: (data.bannerUrls && data.bannerUrls.length > 0) ? data.bannerUrls : ['/order_banner.jpg'],
              deliveryCharge: data.deliveryCharge || 0,
              menu: data.menu || {},
              coupons: data.coupons || [],
          });

        } catch (err) {
          setError(err.message);
          console.error(err);
        } finally {
          setLoading(false);
        }
      };

      fetchMenuData();
    }, [restaurantId, phone]); // Depends on phone now
    
    // --- CART PERSISTENCE ---
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
    
    const updateCart = (newCart, newNotes) => {
        setCart(newCart);
        if (newNotes !== undefined) {
            setNotes(newNotes);
        }
        const cartData = {
            cart: newCart,
            notes: newNotes !== undefined ? newNotes : notes,
            restaurantId,
            restaurantName: restaurantData.name,
            phone,
            coupons: restaurantData.coupons,
            loyaltyPoints,
            deliveryCharge: restaurantData.deliveryCharge,
        };
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(cartData));
    };


    // --- MENU PROCESSING & FILTERING ---
    const processedMenu = useMemo(() => {
        let newMenu = JSON.parse(JSON.stringify(restaurantData.menu));
        const lowercasedQuery = searchQuery.toLowerCase();

        for (const category in newMenu) {
            let items = newMenu[category];
            
            if (lowercasedQuery) {
                items = items.filter(item => item.name.toLowerCase().includes(lowercasedQuery));
            }

            if (filters.veg) items = items.filter(item => item.isVeg);
            if (filters.nonVeg) items = items.filter(item => !item.isVeg);
            if (filters.recommended) items = items.filter(item => item.isRecommended); // Assuming this data comes from API
            
            if (sortBy === 'price-asc') {
              items.sort((a, b) => (a.portions?.[0]?.price || 0) - (b.portions?.[0]?.price || 0));
            } else if (sortBy === 'price-desc') {
              items.sort((a, b) => (b.portions?.[0]?.price || 0) - (a.portions?.[0]?.price || 0));
            } else if (sortBy === 'rating-desc') {
              items.sort((a,b) => (b.rating || 0) - (a.rating || 0)); // Assuming rating comes from API
            }
            
            newMenu[category] = items;
        }
        return newMenu;
    }, [restaurantData.menu, sortBy, filters, searchQuery]);

    const menuCategories = useMemo(() => Object.keys(processedMenu)
        .map(key => ({
            key,
            title: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
            count: (processedMenu[key] || []).length
        }))
        .filter(category => category.count > 0), [processedMenu]);

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
    
    // --- CART ACTIONS ---

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);

    const handleAddToCart = (item, portion, selectedAddOns, totalPrice) => {
        const cartItemId = `${item.id}-${portion.name}-${selectedAddOns.map(a => a.name).sort().join('-')}`;
        
        const existingItemIndex = cart.findIndex(cartItem => cartItem.cartItemId === cartItemId);
        
        let newCart;
        if (existingItemIndex > -1) {
            newCart = cart.map((cartItem, index) =>
                index === existingItemIndex ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
            );
        } else {
            newCart = [...cart, { 
                ...item, 
                cartItemId, 
                portion, 
                selectedAddOns, 
                totalPrice, 
                quantity: 1 
            }];
        }
        updateCart(newCart);
    };

    const handleIncrement = (item) => {
        // Direct add if item is simple (1 portion, 0 addons)
        if (item.portions?.length === 1 && (item.addOnGroups?.length || 0) === 0) {
            const portion = item.portions[0];
            handleAddToCart(item, portion, [], portion.price);
        } else {
            // Otherwise, open customization
            setCustomizationItem(item);
        }
    };

    const handleDecrement = (itemId) => {
        let newCart = [...cart];
        
        const lastMatchingItemIndex = newCart.reduce((lastIndex, currentItem, currentIndex) => {
            if (currentItem.id === itemId) {
                return currentIndex;
            }
            return lastIndex;
        }, -1);

        if (lastMatchingItemIndex === -1) return;

        if (newCart[lastMatchingItemIndex].quantity === 1) {
            newCart.splice(lastMatchingItemIndex, 1);
        } else {
            newCart[lastMatchingItemIndex].quantity--;
        }

        updateCart(newCart);
    };

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const cartItemQuantities = useMemo(() => {
        const quantities = {};
        cart.forEach(item => {
            if (!quantities[item.id]) {
                quantities[item.id] = 0;
            }
            quantities[item.id] += item.quantity;
        });
        return quantities;
    }, [cart]);
    

    const handleCategoryClick = (categoryId) => {
        const section = document.getElementById(categoryId);
        if(section) {
            const yOffset = -120;
            const y = section.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({top: y, behavior: 'smooth'});
        }
    }

    const handleCheckout = () => {
        router.push(`/cart?restaurantId=${restaurantId}&phone=${phone}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        );
    }
    
    if (error || restaurantData.status === 'rejected' || restaurantData.status === 'suspended') {
       return (
         <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center text-destructive p-4">
            <HardHat size={48} className="mb-4" />
            <h1 className="text-2xl font-bold">Restaurant Currently Unavailable</h1>
            <p className="mt-2 text-muted-foreground">{error || "This restaurant is not accepting orders at the moment. Please check back later."}</p>
         </div>
       );
    }
    
    return (
        <>
            <AnimatePresence>
                {isBannerExpanded && (
                     <motion.div
                        className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsBannerExpanded(false)}
                    >
                        <motion.div 
                            className="relative w-full max-w-4xl"
                            style={{ aspectRatio: '16 / 9' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Image
                              src={restaurantData.bannerUrls[0]}
                              alt="Banner Expanded"
                              layout="fill"
                              objectFit="contain"
                              unoptimized
                            />
                        </motion.div>
                         <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 hover:text-white"
                            onClick={() => setIsBannerExpanded(false)}
                        >
                            <X />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="min-h-screen bg-background text-foreground green-theme">
                <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />
                <CustomizationDrawer
                    item={customizationItem}
                    isOpen={!!customizationItem}
                    onClose={() => setCustomizationItem(null)}
                    onAddToCart={handleAddToCart}
                />

                 <header>
                    <BannerCarousel images={restaurantData.bannerUrls} onClick={() => setIsBannerExpanded(true)} restaurantName={restaurantData.name} logoUrl={restaurantData.logoUrl} />
                </header>

                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border">
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
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant={sortBy === 'price-asc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('price-asc')} className={cn(sortBy === 'price-asc' && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>Price: Low to High</Button>
                                            <Button variant={sortBy === 'price-desc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('price-desc')} className={cn(sortBy === 'price-desc' && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>Price: High to Low</Button>
                                            <Button variant={sortBy === 'rating-desc' ? 'default' : 'outline'} size="sm" onClick={() => handleSortChange('rating-desc')} className={cn(sortBy === 'rating-desc' && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>Top Rated</Button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <h4 className="font-medium leading-none">Filter By</h4>
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant={filters.veg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('veg')} className={cn("flex items-center gap-2", filters.veg && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>
                                                <Utensils size={16} className={cn(filters.veg ? '' : 'text-green-500')} />Veg Only
                                            </Button>
                                            <Button variant={filters.nonVeg ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('nonVeg')} className={cn("flex items-center gap-2", filters.nonVeg && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>
                                                <Flame size={16} className={cn(filters.nonVeg ? '' : 'text-red-500')} />Non-Veg Only
                                            </Button>
                                            <Button variant={filters.recommended ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('recommended')} className={cn("flex items-center gap-2", filters.recommended && 'bg-primary hover:bg-primary/90 text-primary-foreground')}>
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
                        <div className="space-y-8">
                            {menuCategories.map(({key, title}) => (
                                <section id={key} key={key} className="scroll-mt-24">
                                    <h3 className="text-2xl font-bold mb-4">{title}</h3>
                                    <div className="flex flex-col">
                                        {processedMenu[key].map(item => (
                                            <MenuItemCard 
                                                key={item.id} 
                                                item={item} 
                                                quantity={cartItemQuantities[item.id] || 0}
                                                onAdd={handleIncrement}
                                                onIncrement={handleIncrement}
                                                onDecrement={handleDecrement}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </main>
                </div>
                
                <footer className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
                    <div className="container mx-auto px-4 relative h-28">
                        <motion.div
                            className="absolute right-4 pointer-events-auto"
                            animate={{ bottom: totalCartItems > 0 ? '6.5rem' : '1rem' }}
                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        >
                             <button
                                onClick={() => setIsMenuBrowserOpen(true)}
                                className="bg-card text-foreground h-16 w-16 rounded-2xl shadow-lg flex flex-col items-center justify-center gap-1 border border-border"
                            >
                                <BookOpen size={24} className="text-primary" />
                                <span className="text-xs font-bold">Menu</span>
                            </button>
                        </motion.div>

                        <AnimatePresence>
                            {totalCartItems > 0 && (
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t border-border pointer-events-auto"
                                    initial={{ y: "100%" }}
                                    animate={{ y: 0 }}
                                    exit={{ y: "100%" }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                >
                                    <div className="container mx-auto p-4">
                                        <Button onClick={handleCheckout} className="bg-primary hover:bg-primary/90 h-14 text-lg font-bold rounded-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
                                            <div className="flex items-center gap-2">
                                               <ShoppingCart className="h-6 w-6"/> 
                                               <span>{totalCartItems} {totalCartItems > 1 ? 'Items' : 'Item'}</span>
                                            </div>
                                            <span>View Cart | ₹{subtotal}</span>
                                        </Button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </footer>
            </div>
        </>
    );
};

const OrderPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>}>
        <OrderPageInternal />
    </Suspense>
);

export default OrderPage;

    