'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, MapPin, Bike, Store, ConciergeBell, QrCode, CalendarClock, Wallet, Users, Camera, BookMarked, Calendar as CalendarIcon, Bell, CheckCircle, AlertTriangle, ExternalLink, ShoppingBag, Sun, Moon, ChevronUp, Lock, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Link from 'next/link';
import { format, isToday, setHours, setMinutes, getHours, getMinutes } from 'date-fns';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';
import { Input } from '@/components/ui/input';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { ThemeProvider } from '@/components/ThemeProvider';


const QrScanner = dynamic(() => import('@/components/QrScanner'), { 
    ssr: false,
    loading: () => <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>
});

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);


const CustomizationDrawer = ({ item, isOpen, onClose, onAddToCart }) => {
    const [selectedPortion, setSelectedPortion] = useState(null);
    const [addOnQuantities, setAddOnQuantities] = useState({});

    useEffect(() => {
        if (item) {
            const minPricePortion = item.portions?.reduce((min, p) => p.price < min.price ? p : min, item.portions[0]) || null;
            setSelectedPortion(minPricePortion);
            
            const initialQuantities = {};
             (item.addOnGroups || []).forEach(group => {
                group.options.forEach(option => {
                    initialQuantities[`${group.title}-${option.name}`] = 0;
                });
            });
            setAddOnQuantities(initialQuantities);
        }
    }, [item]);

    const handleAddOnQuantityChange = (groupTitle, addOnName, action) => {
        const key = `${groupTitle}-${addOnName}`;
        setAddOnQuantities(prev => {
            const currentQty = prev[key] || 0;
            const newQty = action === 'increment' ? currentQty + 1 : Math.max(0, currentQty - 1);
            return { ...prev, [key]: newQty };
        });
    };

    const totalPrice = useMemo(() => {
        if (!selectedPortion || !item) return 0;
        let total = selectedPortion.price;
        
        (item.addOnGroups || []).forEach(group => {
            group.options.forEach(option => {
                const key = `${group.title}-${option.name}`;
                const quantity = addOnQuantities[key] || 0;
                total += quantity * option.price;
            });
        });
        
        return total;
    }, [selectedPortion, addOnQuantities, item]);

    const handleFinalAddToCart = () => {
        const selectedAddOns = [];
        (item.addOnGroups || []).forEach(group => {
            group.options.forEach(option => {
                const key = `${group.title}-${option.name}`;
                const quantity = addOnQuantities[key] || 0;
                if (quantity > 0) {
                    selectedAddOns.push({ ...option, quantity });
                }
            });
        });
        onAddToCart(item, selectedPortion, selectedAddOns, totalPrice);
        onClose();
    };

    if (!item) return null;
    
    const sortedPortions = item.portions ? [...item.portions].sort((a, b) => a.price - b.price) : [];
    const showPortions = sortedPortions.length > 1;

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
                            {showPortions && (
                                <div className="space-y-2">
                                    <h4 className="font-semibold text-lg">Size</h4>
                                    {sortedPortions.map(portion => (
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
                            
                            {(item.addOnGroups || []).map(group => (
                                <div key={group.title} className="space-y-2 pt-4 border-t border-dashed border-border">
                                    <h4 className="font-semibold text-lg">{group.title}</h4>
                                     {group.options.map(option => {
                                        const key = `${group.title}-${option.name}`;
                                        const quantity = addOnQuantities[key] || 0;
                                        
                                        return (
                                            <div
                                                key={option.name}
                                                className="flex justify-between items-center p-3 rounded-lg border border-border"
                                            >
                                                <div>
                                                    <span className="font-medium">{option.name}</span>
                                                    <p className="text-sm text-muted-foreground">+ ₹{option.price}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500" onClick={() => handleAddOnQuantityChange(group.title, option.name, 'decrement')} disabled={quantity === 0}>-</Button>
                                                    <span className="font-bold w-5 text-center">{quantity}</span>
                                                    <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-green-500/10 hover:text-green-500 hover:border-green-500" onClick={() => handleAddOnQuantityChange(group.title, option.name, 'increment')}>+</Button>
                                                </div>
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

const DineInModal = ({ isOpen, onClose, onBookTable, tableStatus, onStartNewTab, onJoinTab, setIsQrScannerOpen }) => {
    const [activeModal, setActiveModal] = useState('main'); // 'main', 'book', 'success'
    const [bookingDetails, setBookingDetails] = useState({ name: '', phone: '', guests: 2, date: new Date(), time: '19:00' });
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    
    const [hour, setHour] = useState(19);
    const [minute, setMinute] = useState(0);

    useEffect(() => {
        if (isOpen) {
            const now = new Date();
            const initialTime = new Date(now.getTime() + 30 * 60000);
            
            setHour(initialTime.getHours());
            setMinute(Math.ceil(getMinutes(initialTime) / 15) * 15 % 60);

            setBookingDetails(prev => ({
                ...prev,
                date: now,
            }));
        }
    }, [isOpen]);

     useEffect(() => {
        const dateWithTime = setHours(setMinutes(bookingDetails.date, minute), hour);
        setBookingDetails(prev => ({
            ...prev,
            time: format(dateWithTime, 'HH:mm'),
        }));
    }, [hour, minute, bookingDetails.date]);

    useEffect(() => {
        if (isOpen) {
            const phoneFromStorage = localStorage.getItem('lastKnownPhone');
            if (phoneFromStorage) {
                setBookingDetails(prev => ({...prev, phone: phoneFromStorage}));
            }
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
    
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 30);
    
    const [newTabPax, setNewTabPax] = useState(1);
    const [newTabName, setNewTabName] = useState('');


    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message} />
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="bg-background border-border text-foreground p-0 max-w-lg">
                    <AnimatePresence mode="wait">
                    {activeModal === 'main' && (
                         <motion.div key="main">
                            <DialogHeader className="p-6 text-center">
                                <DialogTitle className="text-2xl">Dine-In Options</DialogTitle>
                                <DialogDescription>To dine in, please scan a QR code at your table or book a table in advance.</DialogDescription>
                            </DialogHeader>
                            <div className="grid md:grid-cols-2 gap-4 px-6 pb-8">
                                <button
                                    onClick={() => setActiveModal('book')}
                                    className="p-6 border-2 border-border rounded-lg text-center flex flex-col items-center justify-center gap-3 hover:bg-muted hover:border-primary transition-all group"
                                >
                                    <CalendarClock className="w-12 h-12 text-foreground transition-colors group-hover:text-primary" />
                                    <div>
                                        <h4 className="font-bold text-lg text-foreground">Book a Table</h4>
                                        <p className="text-sm text-muted-foreground">Reserve for a future date or time.</p>
                                    </div>
                                </button>
                                 <button
                                    onClick={() => {
                                        onClose();
                                        setIsQrScannerOpen(true);
                                    }}
                                    className="p-6 border-2 border-border rounded-lg text-center flex flex-col items-center justify-center gap-3 hover:bg-muted hover:border-primary transition-all group"
                                >
                                    <QrCode className="w-12 h-12 text-foreground transition-colors group-hover:text-primary" />
                                    <div>
                                        <h4 className="font-bold text-lg text-foreground">I'm at the Restaurant</h4>
                                        <p className="text-sm text-muted-foreground">Scan the QR code on your table.</p>
                                    </div>
                                </button>
                            </div>
                        </motion.div>
                    )}
                    {activeModal === 'book' && (
                         <motion.div key="book">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Book a Table</DialogTitle>
                                <DialogDescription>Reserve your table in advance to avoid waiting.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-4">
                               <Input placeholder="Your Name" value={bookingDetails.name} onChange={(e) => handleBookingChange('name', e.target.value)} />
                               <div className="grid grid-cols-2 gap-4">
                                   <div>
                                       <Label>Guests</Label>
                                       <div className="flex items-center gap-2 mt-1 border border-input rounded-md p-1">
                                           <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleBookingChange('guests', Math.max(1, bookingDetails.guests - 1))}>-</Button>
                                           <span className="font-bold text-lg w-8 text-center">{bookingDetails.guests}</span>
                                           <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleBookingChange('guests', bookingDetails.guests + 1)}>+</Button>
                                       </div>
                                   </div>
                                   <div>
                                       <Label>Phone Number</Label>
                                       <Input type="tel" placeholder="10-digit number" value={bookingDetails.phone} onChange={(e) => handleBookingChange('phone', e.target.value)} className="mt-1 h-10"/>
                                   </div>
                               </div>
                                <div className="grid grid-cols-1 gap-4">
                                   <div>
                                       <Label>Date</Label>
                                       <Popover>
                                           <PopoverTrigger asChild>
                                               <Button variant="outline" className="w-full justify-start font-normal mt-1">
                                                   <CalendarIcon className="mr-2 h-4 w-4" />
                                                   {bookingDetails.date ? format(bookingDetails.date, 'PPP') : <span>Pick a date</span>}
                                               </Button>
                                           </PopoverTrigger>
                                           <PopoverContent className="w-auto p-0">
                                               <CalendarUI mode="single" selected={bookingDetails.date} onSelect={(d) => handleBookingChange('date', d)} fromDate={today} toDate={maxDate}/>
                                           </PopoverContent>
                                       </Popover>
                                   </div>
                                   <div>
                                       <Label>Time</Label>
                                       <div className="flex justify-center gap-4 mt-2">
                                            <div className="flex flex-col items-center">
                                                <Button variant="ghost" size="icon" onClick={() => setHour(prev => (prev === 0 ? 23 : (prev || 1) - 1))}><ChevronUp/></Button>
                                                <span className="text-4xl font-bold w-20 text-center">{hour !== null ? String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0') : '--'}</span>
                                                <Button variant="ghost" size="icon" onClick={() => setHour(prev => ((prev || 0) + 1) % 24)}><ChevronDown/></Button>
                                            </div>
                                            <span className="text-4xl font-bold">:</span>
                                            <div className="flex flex-col items-center">
                                                <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 45) % 60)}><ChevronUp/></Button>
                                                <span className="text-4xl font-bold w-20 text-center">{minute !== null ? String(minute).padStart(2, '0') : '--'}</span>
                                                <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 15) % 60)}><ChevronDown/></Button>
                                            </div>
                                            <div className="flex flex-col items-center justify-center text-2xl font-semibold">
                                                <span>{hour !== null && hour >= 12 ? 'PM' : 'AM'}</span>
                                            </div>
                                        </div>
                                   </div>
                               </div>
                                <Button onClick={handleConfirmBooking} disabled={isSaving} className="w-full h-12 text-lg">
                                    {isSaving ? 'Booking...' : 'Confirm Booking'}
                                </Button>
                            </div>
                         </motion.div>
                    )}
                    {activeModal === 'success' && (
                         <motion.div key="success" className="p-8 text-center">
                            <DialogHeader>
                              <DialogTitle className="text-2xl">Booking Confirmed!</DialogTitle>
                              <DialogDescription>Your table has been requested. You will receive a confirmation on WhatsApp shortly.</DialogDescription>
                            </DialogHeader>
                             <DialogFooter className="mt-6">
                                <Button onClick={onClose} className="w-full">Done</Button>
                             </DialogFooter>
                         </motion.div>
                    )}
                    {activeModal === 'new_tab' && (
                        <motion.div key="new_tab">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Start a New Tab</DialogTitle>
                                <DialogDescription>Welcome to Table {tableStatus?.tableId}! (Max {tableStatus?.max_capacity} guests). Let's get your tab started.</DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-6 space-y-4">
                                <div>
                                    <Label>How many people are in your group?</Label>
                                    <Input type="number" value={newTabPax} onChange={e => setNewTabPax(parseInt(e.target.value))} min="1" max={tableStatus?.max_capacity - tableStatus?.current_pax} className="mt-1" />
                                </div>
                                <div>
                                    <Label>What's a name for your tab? (Optional)</Label>
                                    <Input value={newTabName} onChange={e => setNewTabName(e.target.value)} placeholder="e.g., Rohan's Group" className="mt-1" />
                                </div>
                                <Button onClick={() => onStartNewTab(newTabPax, newTabName || 'Guest')} className="w-full">Start Ordering</Button>
                            </div>
                        </motion.div>
                    )}
                    {activeModal === 'join_or_new' && (
                         <motion.div key="join_or_new">
                             <DialogHeader className="p-6 pb-4">
                                <DialogTitle>Welcome to Table {tableStatus?.tableId}</DialogTitle>
                                <DialogDescription>This table has {tableStatus?.current_pax} of {tableStatus?.max_capacity} seats taken. Join an existing tab or start a new one.</DialogDescription>
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
    const { theme, setTheme } = useTheme();
  
    useEffect(() => {
      if (images.length <= 1) return;
      const interval = setInterval(() => {
        setIndex(prev => (prev + 1) % images.length);
      }, 5000);
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
             <div className="container mx-auto bg-card shadow-lg border border-border rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {logoUrl && (
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-border shadow-md flex-shrink-0">
                            <Image src={logoUrl} alt={`${restaurantName} logo`} layout="fill" objectFit="cover" />
                        </div>
                    )}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                        className="h-10 w-10 rounded-full"
                    >
                        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        <span className="sr-only">Toggle theme</span>
                    </Button>
                </div>
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
    
    // --- START: MODIFIED TOKEN VERIFICATION LOGIC ---
    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');
    const tableIdFromUrl = searchParams.get('table');

    useEffect(() => {
        const verifyToken = async () => {
            // If tableId is present, this is a QR code scan. Bypass token check.
            if (tableIdFromUrl) {
                setIsTokenValid(true);
                return;
            }

            // Otherwise, proceed with the original phone/token check for WhatsApp users.
            if (!phone || !token) {
                setTokenError("No session information found. Please start your order from WhatsApp.");
                return;
            }

            try {
                const res = await fetch('/api/auth/verify-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, token }),
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || "Session validation failed.");
                }
                setIsTokenValid(true);
            } catch (err) {
                setTokenError(err.message);
            }
        };

        verifyToken();
    }, [phone, token, tableIdFromUrl]);
    // --- END: MODIFIED TOKEN VERIFICATION LOGIC ---

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
        dineInEnabled: true,
        businessAddress: null,
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
    const [isDineInModalOpen, setIsDineInModalOpen] = useState(false);
    const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    
    const [dineInState, setDineInState] = useState('loading');
    const [activeTabInfo, setActiveTabInfo] = useState({ id: null, name: '', total: 0 });

    const tabIdFromUrl = searchParams.get('tabId');


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
        setActiveTabInfo({ id: null, name: tabName, total: 0 });
        setDineInState('ready');
        setIsDineInModalOpen(false);
    };

    const handleJoinTab = (tabId) => {
        localStorage.setItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`, JSON.stringify({ join_tab_id: tabId }));
        const joinedTab = tableStatus.activeTabs.find(t => t.id === tabId);
        setActiveTabInfo({ id: tabId, name: joinedTab?.tab_name || 'Existing Tab', total: 0 });
        setDineInState('ready');
        setIsDineInModalOpen(false);
    };


    useEffect(() => {
        // This effect now runs only after token verification is successful
        const fetchInitialData = async () => {
            if (!restaurantId || restaurantId === 'undefined') {
                setError("Restaurant ID is invalid.");
                setLoading(false);
                return;
            }
            
            let locationStr = localStorage.getItem('customerLocation');
            if(locationStr) {
                try { setCustomerLocation(JSON.parse(locationStr)); } catch (e) {}
            }

            try {
                const url = `/api/menu/${restaurantId}${phone ? `?phone=${phone}`: ''}`;
                const menuRes = await fetch(url);
                const menuData = await menuRes.json();

                if (!menuRes.ok) throw new Error(menuData.message || 'Failed to fetch menu');

                setRestaurantData({
                    name: menuData.restaurantName, status: menuData.approvalStatus,
                    logoUrl: menuData.logoUrl || '', bannerUrls: (menuData.bannerUrls?.length > 0) ? menuData.bannerUrls : ['/order_banner.jpg'],
                    deliveryCharge: menuData.deliveryCharge || 0, menu: menuData.menu || {}, coupons: menuData.coupons || [],
                    deliveryEnabled: menuData.deliveryEnabled, pickupEnabled: menuData.pickupEnabled,
                    dineInEnabled: menuData.dineInEnabled, businessAddress: menuData.businessAddress || null,
                    businessType: menuData.businessType || 'restaurant',
                });
                setLoyaltyPoints(menuData.loyaltyPoints || 0);

                if (tableIdFromUrl) {
                    setDeliveryType('dine-in');
                    const dineInSetup = localStorage.getItem(`dineInSetup_${restaurantId}_${tableIdFromUrl}`);
                    if (dineInSetup || tabIdFromUrl) {
                        const setup = dineInSetup ? JSON.parse(dineInSetup) : {};
                        const currentTabId = tabIdFromUrl || setup.join_tab_id;
                        if (currentTabId) setActiveTabInfo({ id: currentTabId, name: setup.tab_name || 'Active Tab', total: 0 });
                        setDineInState('ready');
                    } else {
                        const tableRes = await fetch(`/api/owner/tables?restaurantId=${restaurantId}&tableId=${tableIdFromUrl}`);
                        const tableData = await tableRes.json();
                        let state = 'available';
                        if (tableData.current_pax >= tableData.max_capacity) state = 'full';
                        else if (tableData.current_pax > 0) state = 'partially_occupied';
                        setTableStatus({ ...tableData, tableId: tableIdFromUrl, state });
                        setDineInState('needs_setup');
                        setIsDineInModalOpen(true);
                    }
                } else {
                    setDeliveryType(menuData.deliveryEnabled ? 'delivery' : (menuData.pickupEnabled ? 'pickup' : 'delivery'));
                    setDineInState('ready');
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        if (isTokenValid) {
            fetchInitialData();
        } else if (!tokenError) {
            setLoading(true); // Show loader while token is being verified
        } else {
            setLoading(false); // Stop loading if there's a token error
        }
    }, [isTokenValid, tokenError, restaurantId, phone, tableIdFromUrl, tabIdFromUrl]);
    
    const cartPersistenceDependencies = [
        restaurantId,
        restaurantData.name,
        restaurantData.deliveryCharge,
        restaurantData.businessType,
        loyaltyPoints,
        phone,
        token
    ];

    useEffect(() => {
        if (!restaurantId || loading || !isTokenValid) return;

        const expiryTimestamp = new Date().getTime() + (24 * 60 * 60 * 1000);
        
        const cartDataToSave = {
            cart, notes, deliveryType, restaurantId,
            restaurantName: restaurantData.name,
            phone: phone, 
            token: token,
            deliveryCharge: restaurantData.deliveryCharge,
            ...restaurantData, 
            loyaltyPoints,
            expiryTimestamp,
        };
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(cartDataToSave));
    }, [cart, notes, deliveryType, ...cartPersistenceDependencies, loading, isTokenValid]);

    useEffect(() => {
        if (restaurantId && isTokenValid) {
            const savedCartData = localStorage.getItem(`cart_${restaurantId}`);
            if (savedCartData) {
                const parsedData = JSON.parse(savedCartData);
                const now = new Date().getTime();
                if (parsedData.expiryTimestamp && now > parsedData.expiryTimestamp) {
                    localStorage.removeItem(`cart_${restaurantId}`);
                    setCart([]); setNotes('');
                } else {
                    setCart(parsedData.cart || []);
                    setNotes(parsedData.notes || '');
                    if (parsedData.deliveryType && !tableIdFromUrl) setDeliveryType(parsedData.deliveryType);
                }
            }
        }
    }, [restaurantId, tableIdFromUrl, isTokenValid, phone, token]);

    const searchPlaceholder = useMemo(() => {
        return restaurantData.businessType === 'shop' ? 'Search for a product...' : 'Search for a dish...';
    }, [restaurantData.businessType]);

    const processedMenu = useMemo(() => {
        let newMenu = JSON.parse(JSON.stringify(restaurantData.menu));
        const lowercasedQuery = searchQuery.toLowerCase();

        for (const category in newMenu) {
            let items = newMenu[category];
            if (lowercasedQuery) items = items.filter(item => item.name.toLowerCase().includes(lowercasedQuery));
            if (filters.veg) items = items.filter(item => item.isVeg);
            if (filters.nonVeg) items = items.filter(item => !item.isVeg);
            if (filters.recommended) items = items.filter(item => item.isRecommended);
            if (sortBy === 'price-asc') items.sort((a, b) => (a.portions?.[0]?.price || 0) - (b.portions?.[0]?.price || 0));
            else if (sortBy === 'price-desc') items.sort((a, b) => (b.portions?.[0]?.price || 0) - (a.portions?.[0]?.price || 0));
            else if (sortBy === 'rating-desc') items.sort((a,b) => (b.rating || 0) - (a.rating || 0));
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
    
    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);
    
    const handleAddToCart = useCallback((item, portion, selectedAddOns, totalPrice) => {
        const cartItemId = `${item.id}-${portion.name}-${(selectedAddOns || []).map(a => `${a.name}x${a.quantity}`).sort().join('-')}`;
        setCart(currentCart => {
            const existingItemIndex = currentCart.findIndex(cartItem => cartItem.cartItemId === cartItemId);
            if (existingItemIndex > -1) {
                return currentCart.map((cartItem, index) =>
                    index === existingItemIndex ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            } else {
                return [...currentCart, { ...item, cartItemId, portion, selectedAddOns, totalPrice, quantity: 1 }];
            }
        });
    }, []);

    const handleIncrement = (item) => {
        if (item.portions?.length === 1 && (item.addOnGroups?.length || 0) === 0) {
            const portion = item.portions[0];
            handleAddToCart(item, portion, [], portion.price);
        } else {
            setCustomizationItem(item);
        }
    };

    const handleDecrement = (itemId) => {
        let newCart = [...cart];
        const lastMatchingItemIndex = newCart.reduce((lastIndex, currentItem, currentIndex) => (currentItem.id === itemId) ? currentIndex : lastIndex, -1);
        if (lastMatchingItemIndex === -1) return;
        if (newCart[lastMatchingItemIndex].quantity === 1) newCart.splice(lastMatchingItemIndex, 1);
        else newCart[lastMatchingItemIndex].quantity--;
        setCart(newCart);
    };
    
    const handleDeliveryTypeChange = (type) => {
        if (type === 'dine-in' && !tableIdFromUrl) {
            setDineInState('needs_setup');
            setIsDineInModalOpen(true);
            return;
        }
        setDeliveryType(type);
    };

    const handleBookTable = async (bookingDetails) => {
        const { date, time } = bookingDetails;
        let localDate;
        if(date){
            localDate = setMinutes(setHours(date, parseInt(time.split(':')[0])), parseInt(time.split(':')[1]));
        } else {
            setInfoDialog({isOpen: true, title: "Booking Failed", message: "Please select a date."});
            return;
        }
        const payload = { restaurantId, name: bookingDetails.name, phone: bookingDetails.phone, guests: bookingDetails.guests, bookingDateTime: localDate.toISOString() };
        const res = await fetch('/api/owner/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).message || "Failed to create booking.");
    };

    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    const cartItemQuantities = useMemo(() => {
        const quantities = {};
        cart.forEach(item => {
            if (!quantities[item.id]) quantities[item.id] = 0;
            quantities[item.id] += item.quantity;
        });
        return quantities;
    }, [cart]);
    
    const handleCallWaiter = async () => {
        try {
            await fetch('/api/owner/service-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, tableId: tableIdFromUrl, dineInTabId: activeTabInfo.id }) });
            setInfoDialog({ isOpen: true, title: "Request Sent!", message: "A waiter has been notified and will be with you shortly." });
        } catch (error) {
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
        const params = new URLSearchParams({
            restaurantId,
            phone: phone || '', // Ensure it's not null
            token: token || '', // Ensure it's not null
        });
        if (tableIdFromUrl) params.append('table', tableIdFromUrl);

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

        if (currentCartData.dineInTabId) params.append('tabId', currentCartData.dineInTabId);
        
        const url = `/cart?${params.toString()}`;
        router.push(url);
    };
    
    const handleCloseDineInModal = () => {
        setIsDineInModalOpen(false);
        setDineInState('ready');
    }

    useEffect(() => {
        if (isQrScannerOpen) {
            const timer = setTimeout(() => setIsDineInModalOpen(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isQrScannerOpen]);
    
    // --- START: MODIFIED RENDER LOGIC ---
    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }
    
    if (!isTokenValid) {
        // This state occurs between the component mounting and the token being verified.
        // It's a good place to show a loader.
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }
    // --- END: MODIFIED RENDER LOGIC ---
    
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
                    onClose={handleCloseDineInModal}
                    tableStatus={tableStatus}
                    onStartNewTab={handleStartNewTab}
                    onJoinTab={handleJoinTab}
                    onBookTable={handleBookTable}
                    setIsQrScannerOpen={setIsQrScannerOpen}
                />
            </div>
         )
    }
    
    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message} />
            
            {isQrScannerOpen && <QrScanner onClose={() => setIsQrScannerOpen(false)} onScanSuccess={(decodedText) => { setIsQrScannerOpen(false); window.location.href = decodedText; }} />}

            <AnimatePresence>
                {isBannerExpanded && (
                     <motion.div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsBannerExpanded(false)}>
                        <motion.div className="relative w-full max-w-4xl" style={{ aspectRatio: '16 / 9' }} onClick={(e) => e.stopPropagation()}>
                            <Image src={restaurantData.bannerUrls[0]} alt="Banner Expanded" layout="fill" objectFit="contain" unoptimized />
                        </motion.div>
                         <Button variant="ghost" size="icon" className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 hover:text-white" onClick={() => setIsBannerExpanded(false)}><X /></Button>
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="min-h-screen bg-background text-foreground green-theme">
                 <DineInModal isOpen={isDineInModalOpen} onClose={handleCloseDineInModal} onBookTable={handleBookTable} tableStatus={tableStatus} onStartNewTab={handleStartNewTab} onJoinTab={handleJoinTab} setIsQrScannerOpen={setIsQrScannerOpen} />
                <CustomizationDrawer item={customizationItem} isOpen={!!customizationItem} onClose={() => setCustomizationItem(null)} onAddToCart={handleAddToCart} />

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
                                        <ShoppingBag size={16} /> Pickup
                                    </button>
                                )}
                                {restaurantData.dineInEnabled && (
                                    <button onClick={() => handleDeliveryTypeChange('dine-in')} className={cn("flex-1 p-2 rounded-md flex items-center justify-center gap-2 font-semibold transition-all", deliveryType === 'dine-in' && 'bg-primary text-primary-foreground')}>
                                        <ConciergeBell size={16} /> Dine-In
                                    </button>
                                )}
                            </div>
                            <div className="bg-card border-t border-dashed border-border mt-4 pt-4 flex items-center justify-between w-full">
                                {deliveryType === 'delivery' ? (
                                    <>
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <MapPin className="text-primary flex-shrink-0" size={20}/>
                                            <p className="text-sm text-muted-foreground truncate">{customerLocation?.full || 'No location set'}</p>
                                        </div>
                                        <Link href={`/location?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}&phone=${phone || ''}&token=${token || ''}`}>
                                            <Button variant="link" className="text-primary p-0 h-auto font-semibold flex-shrink-0">Change</Button>
                                        </Link>
                                    </>
                                ) : deliveryType === 'pickup' ? (
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <Store className="text-primary flex-shrink-0" size={20}/>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Pick your order from</p>
                                            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantData.businessAddress?.full || restaurantData.name)}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-foreground truncate flex items-center gap-1 hover:underline text-primary">
                                                {restaurantData.businessAddress?.full || 'N/A'} <ExternalLink size={12}/>
                                            </a>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    <div className="relative w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
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
                                    <SlidersHorizontal size={16} /> Filter & Sort
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
                                        {deliveryType === 'dine-in' ? (
                                            totalCartItems > 0 ? (
                                                <Button onClick={handleCheckout} className="bg-primary hover:bg-primary/90 h-14 text-lg font-bold rounded-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
                                                    <span>{totalCartItems} New Item{totalCartItems > 1 ? 's' : ''}</span>
                                                    <span>Add to Tab | ₹{subtotal}</span>
                                                </Button>
                                            ) : (
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
                                            )
                                        ) : ( totalCartItems > 0 &&
                                            <Button onClick={handleCheckout} className="bg-primary hover:bg-primary/90 h-14 text-lg font-bold rounded-lg shadow-primary/30 flex justify-between items-center text-primary-foreground w-full">
                                                <span>{totalCartItems} Item{totalCartItems > 1 ? 's' : ''} in Cart</span>
                                                <span>View Cart | ₹{subtotal}</span>
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
            <MenuBrowserModal 
                isOpen={false} // This needs to be controlled by state
                onClose={() => {}} 
                categories={[]} 
                onCategoryClick={() => {}} 
            />
            <OrderPageInternal />
        </ThemeProvider>
    </Suspense>
);

export default OrderPage;
