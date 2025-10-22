
'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, MapPin, Bike, Store, ConciergeBell, QrCode, Calendar, Clock, UserCheck, ArrowLeft, CheckCircle, AlertTriangle, Bell, CalendarClock, Wallet, Users } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Link from 'next/link';
import { format, isToday, setHours, setMinutes } from 'date-fns';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';
import { Input } from '@/components/ui/input';
import dynamic from 'next/dynamic';

const QrScanner = dynamic(() => import('@/components/QrScanner'), { 
    ssr: false,
    loading: () => <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>
});


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

const DineInModal = ({ isOpen, onClose, onBookTable, tableStatus, onStartNewTab, onJoinTab, onScanRequest }) => {
    const [activeModal, setActiveModal] = useState('main'); // 'main', 'book', 'success'
    const [bookingDetails, setBookingDetails] = useState({ name: '', phone: '', guests: 2, date: new Date(), time: '19:00' });
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [minTime, setMinTime] = useState('00:00');
    
    // New states for New Tab flow
    const [newTabPax, setNewTabPax] = useState(1);
    const [newTabName, setNewTabName] = useState('');

    useEffect(() => {
        if (bookingDetails.date && isToday(bookingDetails.date)) {
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            setMinTime(`${hours}:${minutes}`);
        } else {
            setMinTime('00:00');
        }
    }, [bookingDetails.date]);

    const handleBookingChange = (field, value) => {
        setBookingDetails(prev => ({...prev, [field]: value}));
    };

    const handleConfirmBooking = async () => {
        if (!bookingDetails.name.trim() || !bookingDetails.phone.trim()) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Please enter your name and phone number.' });
            return;
        }
        if (!/^\d{10}$/.test(bookingDetails.phone.trim())) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Please enter a valid 10-digit phone number.' });
            return;
        }

        setIsSaving(true);
        try {
            await onBookTable(bookingDetails);
            setActiveModal('success');
        } catch(error) {
            setInfoDialog({isOpen: true, title: "Booking Failed", message: error.message});
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        const phoneFromStorage = localStorage.getItem('lastKnownPhone');
        if (phoneFromStorage) {
            setBookingDetails(prev => ({...prev, phone: phoneFromStorage}));
        }
        if (!isOpen) {
            setTimeout(() => {
                setActiveModal('main');
                setIsSaving(false);
                setNewTabPax(1);
                setNewTabName('');
            }, 300);
        } else {
            if (tableStatus?.state === 'available') {
                setActiveModal('new_tab');
            } else if (tableStatus?.state === 'partially_occupied') {
                setActiveModal('join_or_new');
            } else if (tableStatus?.state === 'full') {
                 setActiveModal('full');
            } else {
                setActiveModal('main');
            }
        }
    }, [isOpen, tableStatus]);
    
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 30);


    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message} />
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="bg-background border-border text-foreground p-0 max-w-md">
                    <AnimatePresence mode="wait">
                    {activeModal === 'main' && (
                         <motion.div key="main">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Dine-In Options</DialogTitle>
                                <DialogDescription>To dine in, please scan a QR code at your table or book a table in advance.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-3">
                                <Button onClick={onScanRequest} className="w-full h-16 text-lg"><QrCode className="mr-2"/> Scan Table QR</Button>
                                <Button onClick={() => setActiveModal('book')} className="w-full h-16 text-lg" variant="outline"><Calendar className="mr-2"/> Book a Table</Button>
                            </div>
                        </motion.div>
                    )}
                    {activeModal === 'book' && (
                         <motion.div key="book">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Book a Table</DialogTitle>
                                <DialogDescription>Reserve your table in advance.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-4">
                               <Input placeholder="Your Name" value={bookingDetails.name} onChange={(e) => handleBookingChange('name', e.target.value)} />
                               <Input type="tel" placeholder="Your Phone Number" value={bookingDetails.phone} onChange={(e) => handleBookingChange('phone', e.target.value)} />
                               <div className="flex items-center gap-4">
                                 <Label>Guests:</Label>
                                 <Input type="number" min="1" value={bookingDetails.guests} onChange={(e) => handleBookingChange('guests', parseInt(e.target.value))} className="w-20" />
                               </div>
                               <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start">{format(bookingDetails.date, 'PPP')}</Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <CalendarUI mode="single" selected={bookingDetails.date} onSelect={(d) => handleBookingChange('date', d)} fromDate={today} toDate={maxDate}/>
                                    </PopoverContent>
                                </Popover>
                                <Input type="time" value={bookingDetails.time} onChange={(e) => handleBookingChange('time', e.target.value)} min={minTime} />
                                <Button onClick={handleConfirmBooking} disabled={isSaving} className="w-full">{isSaving ? 'Booking...' : 'Confirm Booking'}</Button>
                            </div>
                         </motion.div>
                    )}
                    {activeModal === 'success' && (
                         <motion.div key="success" className="p-8 text-center">
                            <CheckCircle size={48} className="mx-auto text-green-500 mb-4"/>
                            <DialogTitle className="text-2xl">Booking Confirmed!</DialogTitle>
                            <DialogDescription>Your table has been requested. You will receive a confirmation on WhatsApp shortly.</DialogDescription>
                             <DialogFooter className="mt-6">
                                <Button onClick={onClose} className="w-full">Done</Button>
                             </DialogFooter>
                         </motion.div>
                    )}
                    {activeModal === 'new_tab' && (
                        <motion.div key="new_tab">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Start a New Tab</DialogTitle>
                                <DialogDescription>Welcome! Let's get your tab started for Table {tableStatus?.tableId}.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-4">
                                <div>
                                    <Label>How many people are in your group?</Label>
                                    <Input type="number" value={newTabPax} onChange={e => setNewTabPax(parseInt(e.target.value))} min="1" max={tableStatus?.max_capacity - tableStatus?.current_pax} className="mt-1" />
                                </div>
                                <div>
                                    <Label>What's a name for your tab?</Label>
                                    <Input value={newTabName} onChange={e => setNewTabName(e.target.value)} placeholder="e.g., Rohan's Group" className="mt-1" />
                                </div>
                                <Button onClick={() => onStartNewTab(newTabPax, newTabName)} className="w-full">Start Ordering</Button>
                            </div>
                        </motion.div>
                    )}
                    {activeModal === 'join_or_new' && (
                         <motion.div key="join_or_new">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Welcome to Table {tableStatus?.tableId}</DialogTitle>
                                <DialogDescription>This table is partially occupied. Join an existing tab or start a new one.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-4">
                                <h4 className="font-semibold text-sm text-muted-foreground">Active Tabs:</h4>
                                <div className="space-y-2">
                                {(tableStatus.activeTabs || []).map(tab => (
                                    <Button key={tab.id} variant="outline" className="w-full justify-between h-14" onClick={() => onJoinTab(tab.id)}>
                                        <span>{tab.tab_name}</span>
                                        <span className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full"><Users size={12} /> {tab.pax_count}</span>
                                    </Button>
                                ))}
                                </div>
                                <div className="flex items-center gap-4 my-4">
                                    <div className="flex-grow h-px bg-border"></div>
                                    <span className="text-xs text-muted-foreground">OR</span>
                                    <div className="flex-grow h-px bg-border"></div>
                                </div>
                                <Button onClick={() => setActiveModal('new_tab')} className="w-full">Start a New, Separate Tab</Button>
                            </div>
                        </motion.div>
                    )}
                    {activeModal === 'full' && (
                         <motion.div key="full" className="p-8 text-center">
                            <DialogHeader>
                                <DialogTitle className="text-2xl text-destructive">Table is Full</DialogTitle>
                                <DialogDescription>Sorry, all {tableStatus?.max_capacity} seats at this table are occupied. Please see the host for another available table.</DialogDescription>
                            </DialogHeader>
                             <DialogFooter className="mt-6">
                                <Button onClick={onClose} className="w-full">Okay</Button>
                             </DialogFooter>
                         </motion.div>
                    )}
                    </AnimatePresence>
                </DialogContent>
            </Dialog>
        </>
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
      <div className="relative h-48 w-full group">
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
        <div className="absolute bottom-[-0.5rem] left-0 right-0 px-4">
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
    
    const phoneFromUrl = searchParams.get('phone');
    const tableIdFromUrl = searchParams.get('table');
    const tabIdFromUrl = searchParams.get('tabId');
    
    // --- STATE MANAGEMENT ---
    const [customerLocation, setCustomerLocation] = useState(null);
    const [restaurantData, setRestaurantData] = useState({
        name: '',
        status: null,
        logoUrl: '',
        bannerUrls: ['/order_banner.jpg'],
        deliveryCharge: 0,
        menu: {},
        coupons: [],
        deliveryEnabled: true,
        pickupEnabled: false,
        dineInEnabled: false,
    });
    const [tableStatus, setTableStatus] = useState(null);
    const [loyaltyPoints, setLoyaltyPoints] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [deliveryType, setDeliveryType] = useState('delivery');

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
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);
    const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    
    // --- DINE-IN GATEWAY LOGIC ---
    const [dineInState, setDineInState] = useState('loading'); // loading, needs_setup, ready
    const [activeTabInfo, setActiveTabInfo] = useState({ id: null, name: '', total: 0 });


    const handleStartNewTab = (paxCount, tabName) => {
        if (!paxCount || paxCount < 1) {
            setInfoDialog({ isOpen: true, title: "Invalid Input", message: "Please enter a valid number of guests." });
            return;
        }
        if (!tabName.trim()) {
            setInfoDialog({ isOpen: true, title: "Invalid Input", message: "Please enter a name for your tab." });
            return;
        }
        if (paxCount > (tableStatus.max_capacity - tableStatus.current_pax)) {
            setInfoDialog({ isOpen: true, title: "Capacity Exceeded", message: `This table can only accommodate ${tableStatus.max_capacity - tableStatus.current_pax} more guests.` });
            return;
        }

        localStorage.setItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`, JSON.stringify({ pax_count: paxCount, tab_name: tabName }));
        setActiveTabInfo({ id: null, name: tabName, total: 0 }); // Temporarily set name
        setDineInState('ready');
        setDineInModalOpen(false);
    };

    const handleJoinTab = (tabId) => {
        localStorage.setItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`, JSON.stringify({ join_tab_id: tabId }));
        const joinedTab = tableStatus.activeTabs.find(t => t.id === tabId);
        setActiveTabInfo({ id: tabId, name: joinedTab?.tab_name || 'Existing Tab', total: 0 });
        setDineInState('ready');
        setDineInModalOpen(false);
    };


    // --- LOCATION & DATA FETCHING ---
    useEffect(() => {
        console.log("[DEBUG] OrderPage: Initial render/dependencies changed. restaurantId:", restaurantId);
        const phone = phoneFromUrl || localStorage.getItem('lastKnownPhone');
        if (phone && !localStorage.getItem('lastKnownPhone')) {
            localStorage.setItem('lastKnownPhone', phone);
        }
        
        let locationStr = localStorage.getItem('customerLocation');
        if(locationStr) {
            try {
                setCustomerLocation(JSON.parse(locationStr));
            } catch (e) {
                console.error("Failed to parse location.", e);
            }
        }
        const fetchInitialData = async () => {
            if (!restaurantId || restaurantId === 'undefined') {
                console.error("[DEBUG] OrderPage: Invalid restaurantId detected:", restaurantId);
                setError("Restaurant ID is invalid. Please scan the QR code again.");
                setLoading(false);
                return;
            }
            console.log(`[DEBUG] OrderPage: Starting to fetch data for restaurantId: ${restaurantId}`);
            setLoading(true);
            setError(null);
            try {
                const url = `/api/menu/${restaurantId}${phone ? `?phone=${phone}`: ''}`;
                console.log(`[DEBUG] OrderPage: Fetching URL: ${url}`);
                const menuRes = await fetch(url);
                console.log(`[DEBUG] OrderPage: API response status: ${menuRes.status}`);

                const responseText = await menuRes.text();
                let menuData;
                try {
                    menuData = JSON.parse(responseText);
                } catch(e) {
                    console.error("[DEBUG] OrderPage: Failed to parse JSON response. Raw text:", responseText);
                    throw new Error("Received an invalid response from the server.");
                }

                if (!menuRes.ok) {
                    console.error("[DEBUG] OrderPage: API call failed. Status:", menuRes.status, "Data:", menuData);
                    throw new Error(menuData.message || 'Failed to fetch menu');
                }
                
                console.log("[DEBUG] OrderPage: API call successful. Data received:", menuData);

                setRestaurantData({
                    name: menuData.restaurantName, status: menuData.approvalStatus,
                    logoUrl: menuData.logoUrl || '', bannerUrls: (menuData.bannerUrls?.length > 0) ? menuData.bannerUrls : ['/order_banner.jpg'],
                    deliveryCharge: menuData.deliveryCharge || 0, menu: menuData.menu || {}, coupons: menuData.coupons || [],
                    deliveryEnabled: menuData.deliveryEnabled, pickupEnabled: menuData.pickupEnabled,
                    dineInEnabled: menuData.dineInEnabled !== undefined ? menuData.dineInEnabled : true,
                });

                if (tableIdFromUrl) {
                    setDeliveryType('dine-in');
                    const dineInSetup = localStorage.getItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`);
                    
                    if (dineInSetup) {
                        const setup = JSON.parse(dineInSetup);
                        if (setup.join_tab_id || tabIdFromUrl) {
                           // Logic to fetch tab total can be added here if needed
                           setActiveTabInfo({ id: setup.join_tab_id || tabIdFromUrl, name: 'Active Tab', total: 0 }); // Placeholder
                        }
                        setDineInState('ready');
                    } else {
                        const tableRes = await fetch(`/api/owner/tables?restaurantId=${restaurantId}&tableId=${tableIdFromUrl}`);
                        const tableData = await tableRes.json();
                        
                        let state = 'available';
                        if (tableData.current_pax >= tableData.max_capacity) state = 'full';
                        else if (tableData.current_pax > 0) state = 'partially_occupied';
                        
                        setTableStatus({ ...tableData, tableId: tableIdFromUrl, state });
                        setDineInState('needs_setup');
                        setDineInModalOpen(true);
                    }
                } else if (menuData.deliveryEnabled) {
                    setDeliveryType('delivery');
                    setDineInState('ready');
                } else if (menuData.pickupEnabled) {
                    setDeliveryType('pickup');
                    setDineInState('ready');
                } else {
                     setDineInState('ready'); // Default to ready if no other option
                }
            } catch (err) {
                console.error("[DEBUG] OrderPage: Error in fetchInitialData:", err);
                setError(err.message);
            } finally {
                console.log("[DEBUG] OrderPage: fetchInitialData finished.");
                setLoading(false);
            }
        };

        fetchInitialData();
    }, [restaurantId, phoneFromUrl, tableIdFromUrl, tabIdFromUrl]);
    
    // --- CART PERSISTENCE ---
    const updateCart = useCallback((newCart, newNotes, newDeliveryType) => {
        setCart(newCart);
        if (newNotes !== undefined) {
            setNotes(newNotes);
        }
        if (newDeliveryType !== undefined) {
            setDeliveryType(newDeliveryType);
        }
        
        const cartDataToSave = {
            cart: newCart,
            notes: newNotes !== undefined ? newNotes : notes,
            deliveryType: newDeliveryType !== undefined ? newDeliveryType : deliveryType,
            restaurantId,
            restaurantName: restaurantData.name,
            phone: phoneFromUrl || localStorage.getItem('lastKnownPhone'),
            coupons: restaurantData.coupons,
            loyaltyPoints,
            deliveryCharge: restaurantData.deliveryCharge,
            deliveryEnabled: restaurantData.deliveryEnabled,
            pickupEnabled: restaurantData.pickupEnabled,
        };
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(cartDataToSave));
    }, [notes, restaurantId, restaurantData, loyaltyPoints, phoneFromUrl, deliveryType]);
    
    useEffect(() => {
        if (restaurantId) {
            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                const parsedData = JSON.parse(savedCartData);
                setCart(parsedData.cart || []);
                setNotes(parsedData.notes || '');
                if (parsedData.deliveryType && !tableIdFromUrl) {
                    setDeliveryType(parsedData.deliveryType);
                }
            }
        }
    }, [restaurantId, tableIdFromUrl]);


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
            if (filters.recommended) items = items.filter(item => item.isRecommended);
            
            if (sortBy === 'price-asc') {
              items.sort((a, b) => (a.portions?.[0]?.price || 0) - (b.portions?.[0]?.price || 0));
            } else if (sortBy === 'price-desc') {
              items.sort((a, b) => (b.portions?.[0]?.price || 0) - (a.portions?.[0]?.price || 0));
            } else if (sortBy === 'rating-desc') {
              items.sort((a,b) => (b.rating || 0) - (a.rating || 0));
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

    const handleAddToCart = useCallback((item, portion, selectedAddOns, totalPrice) => {
        const cartItemId = `${item.id}-${portion.name}-${(selectedAddOns || []).map(a => a.name).sort().join('-')}`;
        
        setCart(currentCart => {
            const existingItemIndex = currentCart.findIndex(cartItem => cartItem.cartItemId === cartItemId);
            let newCart;
            if (existingItemIndex > -1) {
                newCart = currentCart.map((cartItem, index) =>
                    index === existingItemIndex ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            } else {
                newCart = [...currentCart, { 
                    ...item, 
                    cartItemId, 
                    portion, 
                    selectedAddOns, 
                    totalPrice, 
                    quantity: 1 
                }];
            }
            updateCart(newCart, notes, deliveryType);
            return newCart;
        });
    }, [notes, deliveryType, updateCart]);

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
    
    const handleDeliveryTypeChange = (type) => {
        if (type === 'dine-in' && !tableIdFromUrl) {
            setDineInState('needs_setup');
            setDineInModalOpen(true);
            return;
        }
        updateCart(cart, notes, type);
    };

    const handleBookTable = async (bookingDetails) => {
        const { date, time } = bookingDetails;
        const localDate = setMinutes(setHours(date, parseInt(time.split(':')[0])), parseInt(time.split(':')[1]));

        const payload = {
            restaurantId: restaurantId,
            name: bookingDetails.name,
            phone: bookingDetails.phone,
            guests: bookingDetails.guests,
            bookingDateTime: localDate,
        };

        const res = await fetch('/api/owner/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || "Failed to create booking.");
        }
    };

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const isTabActive = tableIdFromUrl && !tabIdFromUrl;


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
    
    const handleCallWaiter = async () => {
        try {
            const user = auth.currentUser;
            
            const payload = {
                restaurantId: restaurantId,
                tableId: tableIdFromUrl,
            };

            const response = await fetch('/api/owner/service-requests', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || "Failed to send request.");
            }
            
            setInfoDialog({ isOpen: true, title: "Request Sent!", message: "A waiter has been notified and will be with you shortly." });
        } catch (error) {
            console.error("Failed to send service request:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not send request. " + error.message });
        }
    };

    const handleCategoryClick = (categoryId) => {
        const section = document.getElementById(categoryId);
        if(section) {
            const yOffset = -120;
            const y = section.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({top: y, behavior: 'smooth'});
        }
    }

    const handleCheckout = () => {
        const phone = phoneFromUrl || localStorage.getItem('lastKnownPhone');
        let currentCartData = JSON.parse(localStorage.getItem(`cart_${restaurantId}`)) || {};
        
        if (deliveryType === 'dine-in') {
            const setupStr = localStorage.getItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`);
            if (setupStr) {
                const dineInSetup = JSON.parse(setupStr);
                currentCartData.dineInTabId = tabIdFromUrl || dineInSetup.join_tab_id || null;
                currentCartData.pax_count = dineInSetup.pax_count;
                currentCartData.tab_name = dineInSetup.tab_name;
            }
        }
        
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(currentCartData));

        let url = `/cart?restaurantId=${restaurantId}&phone=${phone}`;
        if (tableIdFromUrl) url += `&table=${tableIdFromUrl}`;
        if (currentCartData.dineInTabId) url += `&tabId=${currentCartData.dineInTabId}`;

        router.push(url);
    };

    if (loading || dineInState === 'loading') {
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

    if (dineInState === 'needs_setup') {
         return (
            <div className="min-h-screen bg-background">
                 <DineInModal 
                    isOpen={isDineInModalOpen} 
                    onClose={() => setDineInModalOpen(false)}
                    tableStatus={tableStatus}
                    onStartNewTab={handleStartNewTab}
                    onJoinTab={handleJoinTab}
                    onScanRequest={() => {
                        setDineInModalOpen(false);
                        setIsQrScannerOpen(true);
                    }}
                    onBookTable={handleBookTable}
                />
            </div>
         )
    }
    
    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message} />
            <AnimatePresence>
                {isQrScannerOpen && (
                    <QrScanner 
                        onClose={() => setIsQrScannerOpen(false)}
                        onScanSuccess={(decodedText) => {
                            setIsQrScannerOpen(false);
                            router.push(decodedText);
                        }}
                    />
                )}
            </AnimatePresence>
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
                <DineInModal
                  isOpen={isDineInModalOpen}
                  onClose={() => setDineInModalOpen(false)}
                  onBookTable={handleBookTable}
                  tableStatus={tableStatus}
                  onStartNewTab={handleStartNewTab}
                  onJoinTab={handleJoinTab}
                  onScanRequest={() => {
                      setDineInModalOpen(false);
                      setIsQrScannerOpen(true);
                  }}
                />
                <CustomizationDrawer
                    item={customizationItem}
                    isOpen={!!customizationItem}
                    onClose={() => setCustomizationItem(null)}
                    onAddToCart={handleAddToCart}
                />

                 <header>
                    <BannerCarousel images={restaurantData.bannerUrls} onClick={() => setIsBannerExpanded(true)} restaurantName={restaurantData.name} logoUrl={restaurantData.logoUrl} />
                </header>

                <div className="container mx-auto px-4 mt-6 space-y-4">
                     
                    {tableIdFromUrl ? (
                        <div className="bg-card p-4 rounded-lg border border-border flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <ConciergeBell className="text-primary"/>
                                <h2 className="text-lg font-bold text-foreground">Ordering for: Table {tableIdFromUrl}</h2>
                            </div>
                            <Button onClick={handleCallWaiter} variant="outline" className="flex items-center gap-2 text-base font-semibold">
                                <Bell size={20} className="text-primary"/> Call Waiter
                            </Button>
                        </div>
                    ) : (
                        <div className="bg-card p-4 rounded-lg border border-border">
                            <div className="flex bg-muted p-1 rounded-lg">
                                {restaurantData.deliveryEnabled && (
                                    <button onClick={() => handleDeliveryTypeChange('delivery')} className={cn("flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all", deliveryType === 'delivery' && 'bg-primary text-primary-foreground')}>
                                        <Bike size={16} /> Delivery
                                    </button>
                                )}
                                {restaurantData.pickupEnabled && (
                                    <button onClick={() => handleDeliveryTypeChange('pickup')} className={cn("flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all", deliveryType === 'pickup' && 'bg-primary text-primary-foreground')}>
                                        <Store size={16} /> Pickup
                                    </button>
                                )}
                                {restaurantData.dineInEnabled && (
                                    <button onClick={() => handleDeliveryTypeChange('dine-in')} className={cn("flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all", deliveryType === 'dine-in' && 'bg-primary text-primary-foreground')}>
                                        <ConciergeBell size={16} /> Dine-In
                                    </button>
                                )}
                            </div>
                             <div className="bg-card border-t border-dashed border-border mt-4 pt-4 flex items-center justify-between w-full">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <MapPin className="text-primary flex-shrink-0" size={20}/>
                                    <p className="text-sm text-muted-foreground truncate">{customerLocation?.full || 'No location set'}</p>
                                </div>
                                <Link href={`/location?restaurantId=${restaurantId}&returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
                                    <Button variant="link" className="text-primary p-0 h-auto font-semibold flex-shrink-0">Change</Button>
                                </Link>
                            </div>
                        </div>
                    )}

                    <div className="relative w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search for dishes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-input border border-border rounded-lg pl-10 pr-4 py-2 h-12 text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                        />
                    </div>
                </div>

                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border mt-4">
                    <div className="container mx-auto px-4 flex items-center justify-end gap-4">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="flex items-center gap-2 flex-shrink-0">
                                    <SlidersHorizontal size={16} /> Filter &amp; Sort
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
                            animate={{ bottom: totalCartItems > 0 || tabIdFromUrl ? '6.5rem' : '1rem' }}
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
                           {(totalCartItems > 0 || tabIdFromUrl) && (
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t border-border pointer-events-auto"
                                    initial={{ y: "100%" }}
                                    animate={{ y: 0 }}
                                    exit={{ y: "100%" }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                >
                                    <div className="container mx-auto p-4">
                                        {totalCartItems > 0 ? (
                                            <Button onClick={handleCheckout} className="bg-primary hover:bg-primary/90 h-14 text-lg font-bold rounded-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
                                                <span>{totalCartItems} Item{totalCartItems > 1 ? 's' : ''} in Cart</span>
                                                <span>{deliveryType === 'dine-in' ? 'Add to Tab' : 'View Cart'} | ₹{subtotal}</span>
                                            </Button>
                                        ) : (tabIdFromUrl &&
                                            <Button onClick={handleCheckout} className="bg-green-600 hover:bg-green-700 h-14 text-lg font-bold rounded-lg shadow-lg flex justify-between items-center text-white w-full">
                                                <div className="flex items-center gap-2">
                                                    <Users size={20}/>
                                                    <span>{activeTabInfo.name || 'Your Tab'}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span>View Bill & Pay</span>
                                                    <Wallet size={20}/>
                                                </div>
                                            </Button>
                                        )}
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
