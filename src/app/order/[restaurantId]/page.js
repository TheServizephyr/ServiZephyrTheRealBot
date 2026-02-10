
'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, MapPin, Bike, Store, ConciergeBell, QrCode, CalendarClock, Wallet, Users, Camera, BookMarked, Calendar as CalendarIcon, Bell, CheckCircle, CheckCircle2, AlertTriangle, AlertCircle, ExternalLink, ShoppingBag, Sun, Moon, ChevronUp, Lock, Loader2, Navigation, ArrowRight, Clock, RefreshCw, Wind } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import ThemeColorUpdater from '@/components/ThemeColorUpdater';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

import AddressSelectionList from '@/components/AddressSelectionList';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import { getDineInDetails, saveDineInDetails, updateDineInDetails } from '@/lib/dineInStorage';


const QrScanner = dynamic(() => import('@/components/QrScanner'), {
    ssr: false,
    loading: () => <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div></div>
});

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid or Table Occupied</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">If you have an ongoing order, please use the original device. Otherwise, please see the host for assistance.</p>
    </div>
);

// ✅ NEW: Helper for managing Back Button state for modals
const BackButtonHandler = ({ onClose }) => {
    useEffect(() => {
        // Push state on mount
        const state = { modalOpen: true, timestamp: Date.now() };
        window.history.pushState(state, '', window.location.href);

        const handlePopState = (event) => {
            // If popstate fires, it means user pressed back (or forward)
            // We should close the modal
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            // We assume if we unmount without popstate (e.g. manual close), 
            // the parent handles the history.back() or we don't care about the stale state 
            // (actually we DO care, but manual check is harder here without ref)
        };
    }, []);

    return null;
};


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

    const isOutOfStock = item.isAvailable === false;

    return (
        <motion.div
            layout
            className={cn(
                "flex gap-4 py-6 border-b border-border bg-card rounded-xl p-4 shadow-md transition-all duration-300",
                "max-w-full overflow-hidden",
                isOutOfStock ? "opacity-40 grayscale" : "hover:-translate-y-1 hover:shadow-primary/20"
            )}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="flex-grow flex flex-col min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
                        <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                    </div>
                    <h4 className="font-semibold text-foreground">{item.name}</h4>
                </div>

                <div className="flex flex-wrap gap-2 mt-1 mb-2 max-w-full">
                    {item.tags && item.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center gap-1 shrink-0">
                            <TagIcon size={12} /> {tag}
                        </span>
                    ))}
                </div>

                <p className="font-bold text-md text-foreground">₹{minPricePortion.price}</p>

                <p className="text-sm text-muted-foreground mt-2 flex-grow line-clamp-2 break-words">{item.description}</p>
            </div>

            <div className="w-32 flex-shrink-0 relative">
                <div className="relative w-full h-32 rounded-md overflow-hidden bg-muted">
                    {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" data-ai-hint="food item" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                            <Utensils size={32} />
                        </div>
                    )}
                </div>
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                    {isOutOfStock ? (
                        <div className="flex items-center justify-center bg-destructive text-destructive-foreground rounded-lg shadow-lg h-10 font-bold text-sm">
                            Out of Stock
                        </div>
                    ) : quantity > 0 ? (
                        <div className="flex items-center justify-center bg-background border-2 border-border rounded-lg shadow-lg h-10">
                            <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-r-none" onClick={() => onDecrement(item.id)}>
                                <Minus size={16} />
                            </Button>
                            <span className="font-bold text-lg text-primary flex-grow text-center">{quantity}</span>
                            <Button variant="ghost" size="icon" className="h-full w-10 text-primary rounded-l-none" onClick={() => onIncrement(item)}>
                                <Plus size={16} />
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
            <DialogContent className="bg-background border-border text-foreground max-w-sm w-[90vw] rounded-2xl p-0 overflow-hidden shadow-xl gap-0">
                <div className="p-5 border-b border-border/40 shrink-0 z-20 bg-background relative">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">
                            Browse Menu
                        </DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground">
                            Quickly jump to any category.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* Wrapper with relative positioning for the blur effect */}
                <div className="relative">
                    {/* Scrollable List with Explicit Max-Height */}
                    <div className="overflow-y-auto max-h-[60vh] py-2 px-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                        {categories.map((category, index) => (
                            <button
                                key={category.key}
                                onClick={() => {
                                    onCategoryClick(category.key);
                                    onClose();
                                }}
                                className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors group border-b border-border/30 last:border-0"
                            >
                                <span className="text-base font-medium text-foreground group-hover:text-primary transition-colors text-left">
                                    {category.title}
                                </span>
                                <span className="text-xs text-muted-foreground font-medium bg-muted px-2.5 py-1 rounded-full flex items-center justify-center min-w-[2rem]">
                                    {category.count}
                                </span>
                            </button>
                        ))}
                        {/* Spacer for bottom blur */}
                        <div className="h-12" />
                    </div>

                    {/* Bottom Blur/Gradient Fade */}
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10" />
                </div>

                <div className="p-4 border-t border-border/40 bg-background shrink-0 z-20 relative shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
                    <Button
                        onClick={onClose}
                        className="w-full rounded-xl font-semibold bg-foreground text-background hover:bg-foreground/90 h-12"
                    >
                        <X className="w-4 h-4 mr-2" /> Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const DineInModal = ({ isOpen, onClose, onBookTable, tableStatus, onStartNewTab, onJoinTab, setIsQrScannerOpen, setInfoDialog, newTabPax, setNewTabPax, newTabName, setNewTabName, isEditing, onUpdateTab }) => {
    const [activeModal, setActiveModal] = useState('main');
    const [bookingDetails, setBookingDetails] = useState({ name: '', phone: '', guests: 2, date: new Date(), time: '19:00' });
    const [isSaving, setIsSaving] = useState(false);

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
        if (!bookingDetails.date) return;
        const dateWithTime = setHours(setMinutes(bookingDetails.date, minute), hour);
        setBookingDetails(prev => ({
            ...prev,
            time: format(dateWithTime, 'HH:mm'),
        }));
    }, [hour, minute, bookingDetails.date]);

    useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setActiveModal('main');
                setIsSaving(false);
                // Reset is handled by parent if needed, or we keep values for edit
            }, 300);
        } else {
            if (isEditing) {
                setActiveModal('new_tab');
            } else if (tableStatus?.state === 'available') {
                setActiveModal('new_tab');
            } else if (tableStatus?.state === 'occupied') {
                setActiveModal('join_or_new');
            } else if (tableStatus?.state === 'full') {
                setActiveModal('full');
            } else {
                setActiveModal('new_tab');
            }
        }
    }, [isOpen, tableStatus, isEditing]);

    const handleBookingChange = (field, value) => {
        setBookingDetails(prev => ({ ...prev, [field]: value }));
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
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Booking Failed", message: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 30);

    // Removed internal newTabPax/newTabName state - now using props

    const handleStartTab = () => {
        const pax = Number(newTabPax);
        const name = newTabName.trim();
        if (pax < 1) {
            setInfoDialog({ isOpen: true, title: "Input Error", message: "Number of guests must be at least 1." });
            return;
        }
        if (!name) {
            setInfoDialog({ isOpen: true, title: "Input Error", message: "Please enter a name for your tab." });
            return;
        }
        // Use availableSeats from backend (includes uncleaned pax subtraction)
        const availableCapacity = tableStatus.availableSeats !== undefined
            ? tableStatus.availableSeats
            : tableStatus.max_capacity - (tableStatus.current_pax || 0);

        // Skip capacity check if editing (since they are already seated)
        if (!isEditing && pax > availableCapacity) {
            setInfoDialog({ isOpen: true, title: "Capacity Exceeded", message: `This table can only accommodate ${availableCapacity} more guest(s). ${tableStatus.hasUncleanedOrders ? 'Some seats are being cleaned.' : ''}` });
            return;
        }

        if (isEditing) {
            onUpdateTab(pax, name);
        } else {
            onStartNewTab(pax, name);
        }
    };


    return (
        <>
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
                                            <h4 className="font-bold text-lg text-foreground">I&apos;m at the Restaurant</h4>
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
                                            <Input type="tel" placeholder="10-digit number" value={bookingDetails.phone} onChange={(e) => handleBookingChange('phone', e.target.value)} className="mt-1 h-10" />
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
                                                    <CalendarUI mode="single" selected={bookingDetails.date} onSelect={(d) => handleBookingChange('date', d)} fromDate={today} toDate={maxDate} />
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                        <div>
                                            <Label>Time</Label>
                                            <div className="flex justify-center gap-4 mt-2">
                                                <div className="flex flex-col items-center">
                                                    <Button variant="ghost" size="icon" onClick={() => setHour(prev => (prev === 0 ? 23 : (prev || 1) - 1))}><ChevronUp /></Button>
                                                    <span className="text-4xl font-bold w-20 text-center">{hour !== null ? String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0') : '--'}</span>
                                                    <Button variant="ghost" size="icon" onClick={() => setHour(prev => ((prev || 0) + 1) % 24)}><ChevronDown /></Button>
                                                </div>
                                                <span className="text-4xl font-bold">:</span>
                                                <div className="flex flex-col items-center">
                                                    <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 45) % 60)}><ChevronUp /></Button>
                                                    <span className="text-4xl font-bold w-20 text-center">{minute !== null ? String(minute).padStart(2, '0') : '--'}</span>
                                                    <Button variant="ghost" size="icon" onClick={() => setMinute(prev => (prev + 15) % 60)}><ChevronDown /></Button>
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
                                    <DialogTitle>{isEditing ? 'Update Details' : 'Start a New Tab'}</DialogTitle>
                                    <DialogDescription asChild>
                                        <div className="space-y-3">
                                            <div className="text-base">
                                                Welcome to Table {tableStatus?.tableId}! (Capacity: {tableStatus?.max_capacity})
                                            </div>

                                            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                                                <Users className="h-5 w-5 text-muted-foreground" />
                                                <div className="flex-1">
                                                    <div className="text-sm font-medium">Current Occupancy</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {tableStatus?.current_pax || 0} / {tableStatus?.max_capacity} seats occupied
                                                        {tableStatus?.current_pax >= tableStatus?.max_capacity && (
                                                            <span className="ml-2 text-destructive font-semibold">Table Full!</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col text-xs">
                                                    <span className="font-semibold text-amber-600">{tableStatus?.current_pax || 0} Occupied</span>
                                                    <span className="font-semibold text-green-600">
                                                        {tableStatus?.availableSeats !== undefined
                                                            ? tableStatus.availableSeats
                                                            : (tableStatus?.max_capacity || 0) - (tableStatus?.current_pax || 0)
                                                        } Available
                                                    </span>
                                                </div>
                                            </div>

                                            {/* NEW: Show cleaning warning if uncleaned orders exist */}
                                            {tableStatus?.hasUncleanedOrders && tableStatus?.uncleanedOrdersCount > 0 && (
                                                <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 px-3 py-2 rounded-md text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <Wind className="h-4 w-4" />
                                                        <span className="font-medium">
                                                            {tableStatus.uncleanedOrdersCount} seat{tableStatus.uncleanedOrdersCount > 1 ? 's' : ''} being cleaned
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            {(tableStatus?.availableSeats !== undefined ? tableStatus.availableSeats : (tableStatus?.max_capacity || 0) - (tableStatus?.current_pax || 0)) <= 0 && (
                                                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm font-medium">
                                                    ⚠️ Table is at full capacity!
                                                </div>
                                            )}
                                        </div>
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="px-6 pb-6 space-y-4">
                                    <div>
                                        <Label>How many people are in your group?</Label>
                                        <Input type="number" value={newTabPax} onChange={e => setNewTabPax(parseInt(e.target.value))} min="1" max={tableStatus?.max_capacity - (tableStatus?.current_pax || 0)} className="mt-1" />
                                    </div>
                                    <div>
                                        <Label>What&apos;s a name for your tab?</Label>
                                        <Input value={newTabName} onChange={e => setNewTabName(e.target.value)} placeholder="e.g., Rohan&apos;s Group" className="mt-1" />
                                    </div>
                                    <Button onClick={handleStartTab} className="w-full">{isEditing ? 'Save Changes' : 'Start Ordering'}</Button>
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

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const OrderPageInternal = () => {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { restaurantId } = params;


    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');

    // ✅ FIX: Persist Ref to LocalStorage to survive reloads/navigation
    const refParam = searchParams.get('ref');
    const [ref, setRef] = useState(refParam);

    useEffect(() => {
        if (refParam) {
            localStorage.setItem('guest_ref', refParam);
            setRef(refParam);
        } else {
            // Try to recover from local storage
            const storedRef = localStorage.getItem('guest_ref');
            if (storedRef) setRef(storedRef);
        }
    }, [refParam]);

    const tableIdFromUrl = searchParams.get('table');
    const tabIdFromUrl = searchParams.get('tabId');
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const activeOrderId = searchParams.get('activeOrderId');
    const activeOrderToken = searchParams.get('token');
    const [liveOrder, setLiveOrder] = useState(null);

    // ADDRESS SELECTION STATE
    const [isAddressSelectorOpen, setIsAddressSelectorOpen] = useState(false);
    const [userAddresses, setUserAddresses] = useState([]);
    const [addressLoading, setAddressLoading] = useState(false);

    // NEW: Delivery Distance Validation
    const [deliveryValidation, setDeliveryValidation] = useState(null);
    const [isValidatingDelivery, setIsValidatingDelivery] = useState(false);

    // NEW: Ref to track if we've attempted auto-open (prevents multiple triggers)
    const hasAttemptedAutoOpen = useRef(false);

    // FETCH ADDRESSES FOR DRAWER
    useEffect(() => {
        const loadAddresses = async () => {
            if (isAddressSelectorOpen && customerLocation?.id) {
                // Only fetch if we are opening it and have basic profile info
                // Actually, we need to fetch if we have phone/ref
                // Simplification: Fetch on Open if needed, or rely on passed data 
            }
        }
    }, [isAddressSelectorOpen]);

    // Handler to close address selector with validation
    const handleCloseAddressSelector = () => {
        // Simple check: Only prevent close if this is first-time WhatsApp delivery AND no address saved ANYWHERE
        const savedLocation = localStorage.getItem('customerLocation');
        const hasAnyAddress = savedLocation || customerLocation?.lat;
        const isFromWhatsApp = !!ref || !!phone;
        const isFirstTimeDelivery = isFromWhatsApp && deliveryType === 'delivery' && !hasAnyAddress;

        if (isFirstTimeDelivery) {
            console.log('[Address Selector] ⚠️ First-time user must select address');
            setInfoDialog({
                isOpen: true,
                title: 'Warning: Address Required', // InfoDialog detects "warning" in title!
                message: 'Please select a delivery address to continue. We need it to calculate charges and verify delivery availability.'
            });
            return;
        }

        // Otherwise allow close
        console.log('[Address Selector] ✅ Closing (address exists or not required)');
        setIsAddressSelectorOpen(false);
    };


    const handleOpenAddressDrawer = async () => {
        console.log('[handleOpenAddressDrawer] 🚀 CALLED');
        setIsAddressSelectorOpen(true);
        setAddressLoading(true);

        try {
            // Re-use logic to resolve user/guest
            const savedName = localStorage.getItem('customerName');
            const lookupPayload = {};
            if (phone) lookupPayload.phone = phone;
            if (ref) lookupPayload.ref = ref;

            console.log('[handleOpenAddressDrawer] 📋 Payload:', lookupPayload, 'auth.currentUser:', auth.currentUser ? 'YES' : 'NO');

            // Simpler: Call lookup just like checkout
            const headers = { 'Content-Type': 'application/json' };
            if (auth.currentUser) {
                headers['Authorization'] = `Bearer ${await auth.currentUser.getIdToken()}`;
            }

            if (Object.keys(lookupPayload).length > 0 || auth.currentUser) {
                console.log('[handleOpenAddressDrawer] ✅ Calling /api/customer/lookup...');
                const res = await fetch('/api/customer/lookup', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(lookupPayload)
                });
                console.log('[handleOpenAddressDrawer] 📡 Response status:', res.status);
                if (res.ok) {
                    const data = await res.json();
                    console.log('[handleOpenAddressDrawer] ✅ Addresses received:', data.addresses?.length || 0);
                    setUserAddresses(data.addresses || []);
                } else {
                    console.error('[handleOpenAddressDrawer] ❌ API error:', res.status);
                }
            } else {
                console.warn('[handleOpenAddressDrawer] ⚠️ NO lookup - no payload & no auth');
            }
        } catch (e) {
            console.error("[handleOpenAddressDrawer] Failed to load addresses", e);
        } finally {
            setAddressLoading(false);
        }
    };

    // ✅ NEW: Reusable validation function (separated from UI logic)
    const validateDelivery = async (addr, currentSubtotal) => {
        const toFiniteNumber = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        };

        // ✅ FIXED: Support both latitude/longitude AND lat/lng
        const customerLat = toFiniteNumber(addr.latitude ?? addr.lat);
        const customerLng = toFiniteNumber(addr.longitude ?? addr.lng);

        // ✅ FIXED: Restaurant coordinates - check all possible field structures
        const restaurantLat = toFiniteNumber(
            restaurantData?.coordinates?.lat ??
            restaurantData?.address?.latitude ??
            restaurantData?.businessAddress?.latitude
        );
        const restaurantLng = toFiniteNumber(
            restaurantData?.coordinates?.lng ??
            restaurantData?.address?.longitude ??
            restaurantData?.businessAddress?.longitude
        );

        if (customerLat !== null && customerLng !== null && restaurantLat !== null && restaurantLng !== null) {
            setIsValidatingDelivery(true);
            try {
                const payload = {
                    restaurantId,
                    addressLat: customerLat,
                    addressLng: customerLng,
                    subtotal: currentSubtotal // Use passed subtotal which might be newer than state
                };

                const response = await fetch('/api/delivery/calculate-charge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const result = await response.json();
                    setDeliveryValidation(result);

                    if (result.allowed && result.charge !== undefined) {
                        console.log(`[Delivery Validation] 💵 Charge updated: ₹${result.charge} (Subtotal: ₹${currentSubtotal})`);
                    }
                }
            } catch (error) {
                console.error('[Delivery Validation] ❌ Failed:', error);
            } finally {
                setIsValidatingDelivery(false);
            }
        }
    };

    // Moved useEffect to later in file after cart initialization

    const handleSelectNewAddress = async (addr) => {
        console.log('[handleSelectNewAddress] 📍 Address selected:', addr);

        // Update Local State
        setCustomerLocation(addr);
        localStorage.setItem('customerLocation', JSON.stringify(addr));
        setIsAddressSelectorOpen(false);

        // Call validation with current subtotal
        await validateDelivery(addr, subtotal);
    };

    useEffect(() => {
        const liveOrderKey = `liveOrder_${restaurantId}`;

        const pollStatus = async () => {
            const raw = localStorage.getItem(liveOrderKey);
            if (!raw) return;

            let allOrders = [];
            try {
                const parsed = JSON.parse(raw);
                allOrders = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                console.error("Failed to parse live orders", e);
                localStorage.removeItem(liveOrderKey);
                return;
            }

            if (allOrders.length === 0) {
                localStorage.removeItem(liveOrderKey);
                return;
            }

            const activeOrders = [];
            let latestActiveOrder = null;

            for (const order of allOrders) {
                try {
                    const res = await fetch(`/api/order/status/${order.orderId}`);
                    if (res.ok) {
                        const statusData = await res.json();
                        const status = statusData.order?.status;
                        const finalStates = ['delivered', 'picked_up', 'rejected', 'cancelled', 'completed'];

                        if (!finalStates.includes(status)) {
                            activeOrders.push(order);
                            latestActiveOrder = order;
                        }
                    } else {
                        if (res.status === 404) {
                            console.log(`[Poll] Order ${order.orderId} not found, removing.`);
                        } else {
                            activeOrders.push(order);
                            latestActiveOrder = order;
                        }
                    }
                } catch (e) {
                    console.error(`[Poll] Error checking ${order.orderId}`, e);
                    activeOrders.push(order);
                    latestActiveOrder = order;
                }
            }

            if (activeOrders.length !== allOrders.length) {
                console.log("[Poll] Cleaning up completed orders. Remaining:", activeOrders.length);
                if (activeOrders.length === 0) {
                    localStorage.removeItem(liveOrderKey);
                    setLiveOrder(null);
                } else {
                    localStorage.setItem(liveOrderKey, JSON.stringify(activeOrders));
                }
            }

            if (activeOrders.length > 0) {
                if (!activeOrderId && latestActiveOrder) {
                    console.log("[Order Page] Auto-redirecting to latest active order:", latestActiveOrder.orderId);
                    const newParams = new URLSearchParams(searchParams.toString());
                    newParams.set('activeOrderId', latestActiveOrder.orderId);
                    if (latestActiveOrder.trackingToken) {
                        newParams.set('token', latestActiveOrder.trackingToken);
                    }
                    router.replace(`/order/${restaurantId}?${newParams.toString()}`, { scroll: false });
                }
                const matchingOrder = activeOrders.find(o => o.orderId === activeOrderId) || latestActiveOrder;
                setLiveOrder(matchingOrder);
            } else {
                if (!activeOrderId) setLiveOrder(null);
            }
        };

        const checkActiveOrder = async () => {
            const storedRaw = localStorage.getItem(liveOrderKey);
            let storedOrders = [];
            try {
                const parsed = storedRaw ? JSON.parse(storedRaw) : [];
                storedOrders = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn("Error parsing stored orders, resetting:", e);
                storedOrders = [];
            }

            // Check if we have identifiers (Phone OR Ref)
            const identifierParam = ref ? `ref=${ref}` : (phone ? `phone=${phone}` : null);

            if (identifierParam) {
                console.log("[Order Page] Identity found. Checking server for active orders...");
                try {
                    // Update API call to support ref
                    const res = await fetch(`/api/order/active?${identifierParam}&token=${token || ''}&restaurantId=${restaurantId}`);
                    if (res.ok) {
                        const data = await res.json();
                        let serverOrders = [];
                        if (data.activeOrders) serverOrders = data.activeOrders;
                        else if (data.order) serverOrders = [data.order];
                        else if (data.orders) serverOrders = data.orders;

                        if (serverOrders.length > 0) {
                            console.log("[Order Page] Found active orders from server:", serverOrders);
                            const formattedOrders = serverOrders.map(o => ({
                                orderId: o.orderId || o.id,
                                trackingToken: o.trackingToken || token,
                                restaurantId: restaurantId,
                                status: o.status,
                                deliveryType: o.deliveryType || 'delivery',
                                timestamp: Date.now()
                            }));
                            const deliveryOrder = formattedOrders.find(o => o.deliveryType?.toLowerCase() === 'delivery');
                            if (deliveryOrder) {
                                console.log("%c[Restore] ✅ Found Active DELIVERY Order:", "color: green; font-weight: bold;", deliveryOrder);
                                const mergedOrders = [...storedOrders.filter(so => !formattedOrders.find(fo => fo.orderId === so.orderId)), ...formattedOrders];
                                localStorage.setItem(liveOrderKey, JSON.stringify(mergedOrders));
                                setLiveOrder(deliveryOrder);
                            } else {
                                console.log("%c[Restore] ❌ No Standard Delivery Order Found.", "color: orange; font-weight: bold;");
                            }
                        } else {
                            console.log("[Order Page] No active orders found on server.");
                        }
                    }
                } catch (e) {
                    console.error("[Order Page] Error checking server for active orders:", e);
                }
            }
        };

        pollStatus();
        checkActiveOrder();

    }, [restaurantId, searchParams, activeOrderId, router, phone, token, ref]);


    // ... (Existing state hooks: location, restaurantData, etc.) ...
    // Note: I'm skipping unchanged lines to keep this concise, matching the tool usage rules.

    // ... Lines 902 to 1188 skipped (assume unchanged unless context forces reload) ...



    // ... DineIn Setup (Lines 1224-1379 ignored) ...
    // Note: Can't ignore effectively in replace block without matching content.
    // I will try to target specific blocks if possible or just replace the verifySession effect mostly.

    // Actually, I can replace the HUGE block including OrderPageInternal definition start?
    // No, I should use valid context.

    // Let's scroll down to handleCheckout.







    const [customerLocation, setCustomerLocation] = useState(null);
    const [restaurantData, setRestaurantData] = useState({
        name: '', status: null, logoUrl: '', bannerUrls: ['/order_banner.jpg'],
        deliveryCharge: 0, menu: {}, coupons: [], deliveryEnabled: true,
        pickupEnabled: false, dineInEnabled: true, businessAddress: null,
        dineInModel: 'post-paid',
        dineInOnlinePaymentEnabled: true,
        dineInPayAtCounterEnabled: true,
        deliveryOnlinePaymentEnabled: true,
        deliveryCodEnabled: true,
        pickupOnlinePaymentEnabled: true,
        pickupPodEnabled: true,
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
    const [filters, setFilters] = useState({ veg: false, nonVeg: false, recommended: false });
    const [customizationItem, setCustomizationItem] = useState(null);
    const [isBannerExpanded, setIsBannerExpanded] = useState(false);
    const [isDineInModalOpen, setIsDineInModalOpen] = useState(false);
    const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [dineInState, setDineInState] = useState('loading');
    const [activeTabInfo, setActiveTabInfo] = useState({ id: null, name: '', total: 0 });

    // NEW: Persistent user details management
    const [userDetails, setUserDetails] = useState(null);
    const [detailsProvided, setDetailsProvided] = useState(false);

    const [showWelcome, setShowWelcome] = useState(false);

    // FIX: Lifted state to parent to allow Edit functionality
    const [newTabPax, setNewTabPax] = useState(1);
    const [newTabName, setNewTabName] = useState('');
    const [isEditingModal, setIsEditingModal] = useState(false);

    // ✅ NEW: Effect to re-validate when cart/subtotal changes (relocated here)
    useEffect(() => {
        if (deliveryType === 'delivery' && customerLocation) {
            // Keep delivery validation subtotal identical to billing subtotal formula.
            const currentSubtotal = cart.reduce(
                (total, item) => total + ((Number(item.totalPrice) || 0) * (item.quantity || 1)),
                0
            );

            const timer = setTimeout(() => {
                validateDelivery(customerLocation, currentSubtotal);
            }, 500); // Debounce
            return () => clearTimeout(timer);
        }
    }, [cart, deliveryType, customerLocation?.id]); // Re-run if cart, delivery mode, or address changes

    useEffect(() => {
        const verifySession = async () => {
            // FIX: Ensure restaurantData is available
            if (!restaurantData || !restaurantData.businessType) return;

            const isStreetVendorPage = restaurantData.businessType === 'street-vendor';
            if (isStreetVendorPage && !tableIdFromUrl && !ref && !token && !activeOrderId) {
                setIsTokenValid(true);
                return;
            }

            if (tableIdFromUrl || activeOrderId) {
                setIsTokenValid(true);
                return;
            }

            // RELAXED SESSION CHECK: Don't hard-block with an error if no session info is found
            // This allows anyone with the link to browse the menu.
            // (Strict validation still happens at the API level during Checkout/Order creation).
            setIsTokenValid(true);
            setTokenError(null);
        };

        if (!loading && restaurantData.businessType) {
            verifySession();
        }
    }, [restaurantId, tableIdFromUrl, phone, token, ref, activeOrderId, restaurantData.businessType, loading]);



    const handleStartNewTab = async (paxCount, tabName) => {
        try {
            const payload = {
                action: 'create_tab',
                tableId: tableIdFromUrl,
                restaurantId,
                pax_count: paxCount,
                tab_name: tabName,
            };

            // Use public tables API (no auth required for customers)
            const res = await fetch('/api/owner/tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            const tabInfo = { id: data.tabId, name: tabName, pax_count: paxCount };
            setActiveTabInfo(tabInfo);

            // Save to localStorage for session persistence
            const dineInTabKey = `dineInTab_${restaurantId}_${tableIdFromUrl}`;
            localStorage.setItem(dineInTabKey, JSON.stringify(tabInfo));
            console.log('[Dine-In] Saved tab to localStorage:', tabInfo);

            // NEW: Save to PERMANENT storage (persists across sessions)
            saveDineInDetails(restaurantId, tableIdFromUrl, {
                tab_name: tabName,
                pax_count: paxCount,
                tabId: data.tabId
            });

            // NEW: Update UI states
            setUserDetails({ tab_name: tabName, pax_count: paxCount });
            setDetailsProvided(true);
            setShowWelcome(true);

            setDineInState('ready');
            setIsDineInModalOpen(false);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error Creating Tab", message: error.message });
            throw error;
        }
    };

    const handleStartTab = () => {
        // Generate new tab ID
        const newTabId = `tab_${Date.now()}`;

        // Create tab info
        const newTabInfo = {
            id: newTabId,
            name: newTabName || 'Guest',
            pax_count: newTabPax || 1
        };

        // Save to localStorage
        const dineInTabKey = `dineInTab_${restaurantId}_${tableIdFromUrl}`;
        localStorage.setItem(dineInTabKey, JSON.stringify(newTabInfo));
        console.log('[Dine-In] New tab created:', newTabInfo);

        // Update state
        setActiveTabInfo(newTabInfo);
        setDineInState('ready');
        setIsDineInModalOpen(false);
    };

    const handleJoinTab = (tabId) => {
        const joinedTab = tableStatus.activeTabs.find(t => t.id === tabId);
        const tabName = joinedTab?.tab_name || 'Existing Tab';
        const tabPax = joinedTab?.pax_count || 1;

        // Create local session details matching the joined tab
        const details = {
            tab_name: tabName,
            pax_count: tabPax,
            tabId: tabId
        };

        // Update state
        setActiveTabInfo({ id: tabId, name: tabName, pax_count: tabPax });
        setUserDetails(details);
        setDetailsProvided(true);
        setShowWelcome(true); // Show the welcome banner

        // Persist session
        if (tableIdFromUrl && restaurantId) {
            saveDineInDetails(restaurantId, tableIdFromUrl, details);
            const dineInTabKey = `dineInTab_${restaurantId}_${tableIdFromUrl}`;
            localStorage.setItem(dineInTabKey, JSON.stringify({ id: tabId, name: tabName, pax_count: tabPax }));
        }

        setDineInState('ready');
        setIsDineInModalOpen(false);
    };

    const handleUpdateTab = (pax, name) => {
        // Update local details
        const updatedDetails = { ...userDetails, tab_name: name, pax_count: pax };
        setUserDetails(updatedDetails);
        setActiveTabInfo(prev => ({ ...prev, name: name, pax_count: pax }));

        // Update persistence
        if (tableIdFromUrl) {
            saveDineInDetails(restaurantId, tableIdFromUrl, {
                tab_name: name,
                pax_count: pax,
                tabId: activeTabInfo.id
            });
        }

        // Close modal
        setDineInState('ready');
        setIsDineInModalOpen(false);
        setIsEditingModal(false);
    };

    // Force re-fetch on every page mount by using a timestamp key
    const [fetchKey, setFetchKey] = useState(Date.now());
    const intervalRef = useRef(null);

    // Auto-refresh: Immediate fetch on tab return + 2-min interval while visible
    useEffect(() => {
        const TWO_MINUTES = 2 * 60 * 1000;

        const startInterval = () => {
            // Clear any existing interval first
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }

            // Start 2-minute interval
            intervalRef.current = setInterval(() => {
                if (!document.hidden) {
                    console.log('[Order Page] 2-min auto-refresh (tab visible)');
                    setFetchKey(Date.now());
                }
            }, TWO_MINUTES);
            console.log('[Order Page] Auto-refresh interval started');
        };

        const stopInterval = () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                console.log('[Order Page] Auto-refresh interval stopped');
            }
        };

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                // Tab became visible
                console.log('[Order Page] Tab visible - fetching fresh data immediately');
                setFetchKey(Date.now());
                startInterval(); // Start interval for future refreshes
            } else {
                // Tab became hidden
                console.log('[Order Page] Tab hidden - stopping auto-refresh');
                stopInterval(); // Stop interval to save resources
            }
        };

        // Initial setup
        setFetchKey(Date.now()); // Initial fetch on mount
        if (!document.hidden) {
            startInterval(); // Start interval if tab is visible
        }

        // Listen for visibility changes
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Cleanup on unmount
        return () => {
            stopInterval();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        const fetchInitialData = async () => {
            if (!restaurantId || restaurantId === 'undefined') {
                setError("Restaurant ID is invalid.");
                setLoading(false);
                return;
            }

            let locationStr = localStorage.getItem('customerLocation');
            if (locationStr) { try { setCustomerLocation(JSON.parse(locationStr)); } catch (e) { } }

            try {
                const url = `/api/public/menu/${restaurantId}${phone ? `?phone=${phone}` : ''}`;
                const menuRes = await fetch(url, { cache: 'no-store' }); // Force fresh data
                const menuData = await menuRes.json();

                if (!menuRes.ok) throw new Error(menuData.message || 'Failed to fetch menu');

                const settingsRes = await fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
                const settingsData = settingsRes.ok ? await settingsRes.json() : {};

                // Map specific payment settings (fallback to true if undefined)
                const deliveryOnlinePaymentEnabled = settingsData.deliveryOnlinePaymentEnabled !== false;
                const deliveryCodEnabled = settingsData.deliveryCodEnabled !== false;
                const pickupOnlinePaymentEnabled = settingsData.pickupOnlinePaymentEnabled !== false;
                const pickupPodEnabled = settingsData.pickupPodEnabled !== false;
                const dineInOnlinePaymentEnabled = settingsData.dineInOnlinePaymentEnabled !== false;
                const dineInPayAtCounterEnabled = settingsData.dineInPayAtCounterEnabled !== false;

                const fetchedSettings = {
                    name: menuData.restaurantName, status: menuData.approvalStatus,
                    logoUrl: menuData.logoUrl || '', bannerUrls: (menuData.bannerUrls?.length > 0) ? menuData.bannerUrls : ['/order_banner.jpg'],
                    deliveryCharge: menuData.deliveryCharge || 0,
                    deliveryFreeThreshold: menuData.deliveryFreeThreshold,
                    menu: menuData.menu || {}, coupons: menuData.coupons || [],

                    // FIXED: Use fresh settingsData for Order Types (overriding cached menuData)
                    deliveryEnabled: settingsData.deliveryEnabled !== undefined ? settingsData.deliveryEnabled : menuData.deliveryEnabled,
                    pickupEnabled: settingsData.pickupEnabled !== undefined ? settingsData.pickupEnabled : menuData.pickupEnabled,
                    dineInEnabled: settingsData.dineInEnabled !== undefined ? settingsData.dineInEnabled : menuData.dineInEnabled,

                    businessAddress: menuData.businessAddress || null,
                    businessType: menuData.businessType || 'restaurant',
                    dineInModel: menuData.dineInModel || 'post-paid',

                    // Detailed Payment Settings
                    deliveryOnlinePaymentEnabled,
                    deliveryCodEnabled,
                    pickupOnlinePaymentEnabled,
                    pickupPodEnabled,
                    dineInOnlinePaymentEnabled,
                    dineInPayAtCounterEnabled,

                    isOpen: menuData.isOpen === true, // Restaurant open/closed status
                    // Add-on Charges
                    gstEnabled: settingsData.gstEnabled,
                    gstRate: settingsData.gstRate,
                    gstMinAmount: settingsData.gstMinAmount,
                    convenienceFeeEnabled: settingsData.convenienceFeeEnabled,
                    convenienceFeeRate: settingsData.convenienceFeeRate,
                    convenienceFeePaidBy: settingsData.convenienceFeePaidBy,
                    convenienceFeeLabel: settingsData.convenienceFeeLabel,
                };

                setRestaurantData(fetchedSettings);
                setLoyaltyPoints(menuData.loyaltyPoints || 0);

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, [restaurantId, phone, fetchKey]); // Added fetchKey to force re-fetch on mount




    useEffect(() => {
        const handleDineInSetup = async () => {
            console.log('🚀 [DEBUG] handleDineInSetup STARTED - tableIdFromUrl:', tableIdFromUrl);
            if (tableIdFromUrl) {
                setDeliveryType('dine-in');

                if (tabIdFromUrl) {
                    setActiveTabInfo({ id: tabIdFromUrl, name: 'Active Tab', total: 0 });
                    setDineInState('ready');
                } else {
                    // First fetch table data from server
                    try {
                        console.log('📞 [DEBUG] Fetching table data for:', tableIdFromUrl);
                        const tableRes = await fetch(`/api/owner/tables?restaurantId=${restaurantId}&tableId=${tableIdFromUrl}`);
                        console.log('📞 [DEBUG] Table API response status:', tableRes.status, tableRes.ok);

                        if (!tableRes.ok) {
                            const errorData = await tableRes.json();
                            console.error('❌ [DEBUG] Table API error:', errorData);
                            // Table doesn't exist
                            setError(`Table "${tableIdFromUrl}" does not exist at this restaurant. Please check the QR code or contact the staff.`);
                            setLoading(false);
                            setDineInState('error');
                            return;
                        }

                        const tableData = await tableRes.json();
                        console.log('📊 [DEBUG] Table data received:', tableData);

                        // NEW: Smart cleaning status handling
                        if (tableData.hasUncleanedOrders) {
                            console.log('🧹 [DEBUG] Table has uncleaned orders:', tableData.uncleanedOrdersCount);
                            // ONLY block if NO seats available
                            if (tableData.availableSeats <= 0) {
                                console.log('❌ [DEBUG] No available seats - BLOCKING');
                                const message = `This table is fully occupied and being cleaned. Please wait or choose another table.\n\n📊 Table Status:\n• Available seats: ${tableData.availableSeats}\n• Orders awaiting cleanup: ${tableData.uncleanedOrdersCount}`;
                                setError(message);
                                setLoading(false);
                                setDineInState('cleaning_pending');
                                console.log(`[Dine-In] Table ${tableIdFromUrl} BLOCKED - No available seats while cleaning`);
                                return;
                            } else {
                                // Seats available - show info but ALLOW ordering
                                console.log('✅ [DEBUG] Seats available despite cleaning - ALLOWING');
                                console.log(`[Dine-In] Table ${tableIdFromUrl} has ${tableData.availableSeats} available seats, ${tableData.uncleanedOrdersCount} orders cleaning - ALLOWING order`);
                                // Optional: Store cleaning info to show later as warning banner
                                setTableStatus(prev => ({
                                    ...prev,
                                    cleaningWarning: {
                                        availableSeats: tableData.availableSeats,
                                        uncleanedCount: tableData.uncleanedOrdersCount
                                    }
                                }));
                            }
                        }

                        // Check localStorage for existing tab AFTER fetching server data
                        const dineInTabKey = `dineInTab_${restaurantId}_${tableIdFromUrl}`;
                        const savedTabData = localStorage.getItem(dineInTabKey);

                        if (savedTabData) {
                            try {
                                const tabInfo = JSON.parse(savedTabData);
                                console.log('[Dine-In] Found existing tab in localStorage:', tabInfo);

                                // SERVER-SIDE VALIDATION: Check if this tab is still active on server
                                const isTabStillActive = tableData.activeTabs?.some(tab => tab.id === tabInfo.id);

                                if (isTabStillActive) {
                                    console.log('[Dine-In] Tab validated as active on server, auto-loading');
                                    // Auto-load existing tab
                                    setActiveTabInfo(tabInfo);
                                    setDineInState('ready');
                                    return; // Skip modal
                                } else {
                                    console.log('[Dine-In] Tab no longer active on server, clearing localStorage');
                                    localStorage.removeItem(dineInTabKey);
                                    // Continue to show modal
                                }
                            } catch (e) {
                                console.error('[Dine-In] Error parsing saved tab:', e);
                                localStorage.removeItem(dineInTabKey);
                            }
                        }
                        // Calculate table state
                        let state = 'available';
                        const occupiedSeats = tableData.current_pax || 0;
                        if (occupiedSeats >= tableData.max_capacity) state = 'full';
                        else if (occupiedSeats > 0) state = 'occupied';

                        console.log('📊 [DEBUG] Table state calculated:', state);

                        setTableStatus({
                            ...tableData,
                            state,
                            activeTabs: tableData.activeTabs || [],
                            tableId: tableIdFromUrl,
                        });

                        console.log('💾 [DEBUG] Table status set, now checking table state:', state);
                        if (state === 'full') {
                            console.log('❌ [DEBUG] Table FULL - will NOT open modal');
                            setDineInState('full');
                        } else {
                            console.log('✅ [DEBUG] Table not full, proceeding to persistent details check...');
                            // NEW: Check if we already have persistent details (e.g. from previous visit)
                            // If yes, we skip the modal so the user lands directly on the menu with the Welcome banner
                            const persistentDetails = getDineInDetails(restaurantId, tableIdFromUrl);

                            console.log('🔍 [DEBUG] persistentDetails:', persistentDetails);
                            console.log('🔍 [DEBUG] restaurantId:', restaurantId, 'tableId:', tableIdFromUrl);

                            if (persistentDetails) {
                                console.log('❌ [Dine-In] Persistent details found - SKIPPING MODAL');
                                setDineInState('ready');
                                setIsDineInModalOpen(false);
                            } else {
                                console.log('✅ [Dine-In] NO persistent details - OPENING MODAL');
                                setDineInState('ready_to_select'); // Allow starting new tab or joining
                                setIsDineInModalOpen(true);
                            }
                        }
                    } catch (error) {
                        console.error('[Dine-In] Error fetching table:', error);
                        setError(`Unable to load table information: ${error.message}`);
                        setLoading(false);
                        setDineInState('error');
                    }
                }

            } else {
                if (restaurantData.businessType === 'street-vendor') {
                    setDeliveryType('street-vendor-pre-order');
                } else {
                    setDeliveryType(restaurantData.deliveryEnabled ? 'delivery' : (restaurantData.pickupEnabled ? 'pickup' : 'delivery'));
                }
                setDineInState('ready');
            }
        };

        console.log('🔍 [DEBUG handleDineInSetup TRIGGER] isTokenValid:', isTokenValid, 'tableIdFromUrl:', tableIdFromUrl);
        if (isTokenValid) {
            console.log('✅ [DEBUG] Calling handleDineInSetup...');
            handleDineInSetup();
        } else {
            console.log('❌ [DEBUG] NOT calling handleDineInSetup - isTokenValid is false');
        }
    }, [isTokenValid, restaurantId, tableIdFromUrl, tabIdFromUrl, restaurantData.businessType, restaurantData.deliveryEnabled, restaurantData.pickupEnabled]);

    // NEW: Load persistent user details on mount (for dine-in only)
    useEffect(() => {
        if (tableIdFromUrl && restaurantId && isTokenValid) {
            const savedDetails = getDineInDetails(restaurantId, tableIdFromUrl);

            if (savedDetails) {
                console.log('[Dine-In] Found saved user details:', savedDetails);

                // Auto-populate details
                setUserDetails(savedDetails);
                setDetailsProvided(true);
                setShowWelcome(true);

                // Auto-populate tab info
                setActiveTabInfo({
                    id: savedDetails.tabId || `tab_${Date.now()}`,
                    name: savedDetails.tab_name,
                    pax_count: savedDetails.pax_count
                });

                // Prevent modal from auto-opening
                // setDineInState('ready'); // ❌ COMMENTED: This causes race condition with handleDineInSetup
                // Modal control now handled by handleDineInSetup only
            } else {
                console.log('[Dine-In] No saved details found - will show modal');
                // Modal will open from handleDineInSetup
            }
        }
    }, [tableIdFromUrl, restaurantId, isTokenValid]);

    useEffect(() => {
        if (isTokenValid) {
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
                    if (parsedData.dineInTabId) {
                        setActiveTabInfo({ id: parsedData.dineInTabId, name: parsedData.tab_name || 'Active Tab', pax_count: parsedData.pax_count || 1 });
                    }
                }
            }
        }
    }, [isTokenValid, restaurantId, tableIdFromUrl]);

    // ✅ Auto-open address selector for WhatsApp users (EXACTLY ONCE on first load)
    // Placed HERE after deliveryType state is loaded from cart
    useEffect(() => {
        // Skip if we've already attempted auto-open in this component lifecycle
        if (hasAttemptedAutoOpen.current) {
            console.log('[Auto-Open] Already attempted - skipping');
            return;
        }

        // ⏳ Wait for token validation and data load
        if (!isTokenValid || loading) {
            console.log('[Auto-Open] Waiting for data load...');
            return;
        }

        // Access customerLocation
        const savedLocation = localStorage.getItem('customerLocation');
        const hasSelectedAddress = savedLocation ? JSON.parse(savedLocation)?.lat : false;
        const isFromWhatsApp = !!ref || !!phone;

        // ✅ Use deliveryType from STATE (not localStorage!)
        const currentDeliveryType = deliveryType;

        // Check if we've already auto-opened in a previous session
        const autoOpenFlag = localStorage.getItem(`addressAutoOpened_${restaurantId}`);
        const hasAlreadyAutoOpened = autoOpenFlag === 'true';

        console.log('[Auto-Open] 🔍 Checking:', {
            isTokenValid,
            loading,
            isFromWhatsApp,
            hasSelectedAddress,
            deliveryTypeState: currentDeliveryType,
            hasAlreadyAutoOpened
        });

        // Auto-open ONLY if: WhatsApp user + No address + delivery type + NOT already opened
        if (isFromWhatsApp && !hasSelectedAddress && currentDeliveryType === 'delivery' && !hasAlreadyAutoOpened) {
            // Mark that we've attempted (prevents re-runs)
            hasAttemptedAutoOpen.current = true;

            // Delay to let page fully render
            setTimeout(() => {
                console.log('[Auto-Open] ✅ OPENING address selector!');
                localStorage.setItem(`addressAutoOpened_${restaurantId}`, 'true');
                handleOpenAddressDrawer();
            }, 800);
        } else {
            console.log('[Auto-Open] ❌ NOT opening:', {
                reason: !isFromWhatsApp ? 'Not WhatsApp' :
                    hasSelectedAddress ? 'Has address' :
                        currentDeliveryType !== 'delivery' ? `Wrong type: ${currentDeliveryType}` :
                            hasAlreadyAutoOpened ? 'Already opened' : 'Unknown'
            });
        }
    }, [ref, phone, restaurantId, isTokenValid, loading, deliveryType]);

    useEffect(() => {
        if (!restaurantId || loading || !isTokenValid) return;

        const expiryTimestamp = new Date().getTime() + (24 * 60 * 60 * 1000);

        const cartDataToSave = {
            cart, notes, deliveryType, restaurantId,
            restaurantName: restaurantData.name,
            phone: phone, token: token,
            tableId: tableIdFromUrl,
            dineInTabId: activeTabInfo.id,
            pax_count: activeTabInfo.pax_count,
            tab_name: activeTabInfo.name,
            deliveryCharge: restaurantData.deliveryCharge,
            deliveryFreeThreshold: restaurantData.deliveryFreeThreshold,
            businessType: restaurantData.businessType,
            dineInModel: restaurantData.dineInModel,
            loyaltyPoints, expiryTimestamp,
            menu: restaurantData.menu, // Save the full menu for availability check
            // Detailed Payment Settings
            deliveryOnlinePaymentEnabled: restaurantData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: restaurantData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: restaurantData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: restaurantData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: restaurantData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: restaurantData.dineInPayAtCounterEnabled,

            // Add-on Charges
            gstEnabled: restaurantData.gstEnabled,
            gstRate: restaurantData.gstRate,
            gstMinAmount: restaurantData.gstMinAmount,
            convenienceFeeEnabled: restaurantData.convenienceFeeEnabled,
            convenienceFeeRate: restaurantData.convenienceFeeRate,
            convenienceFeePaidBy: restaurantData.convenienceFeePaidBy,
            convenienceFeeLabel: restaurantData.convenienceFeeLabel,
        };
        localStorage.setItem(`cart_${restaurantId}`, JSON.stringify(cartDataToSave));

        const liveOrderKey = `liveOrder_${restaurantId}`;
        if (liveOrder && liveOrder.orderId) {
            localStorage.setItem(liveOrderKey, JSON.stringify(liveOrder));
        }

    }, [cart, notes, deliveryType, restaurantData, loyaltyPoints, loading, isTokenValid, restaurantId, phone, token, tableIdFromUrl, activeTabInfo, liveOrder]);

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

            // --- START FIX: Sort by availability first, then by the selected criteria ---
            items.sort((a, b) => {
                // Out of stock items go to the bottom
                if (a.isAvailable && !b.isAvailable) return -1;
                if (!a.isAvailable && b.isAvailable) return 1;

                // Then apply the user's selected sort
                if (sortBy === 'price-asc') return (a.portions?.[0]?.price || 0) - (b.portions?.[0]?.price || 0);
                if (sortBy === 'price-desc') return (b.portions?.[0]?.price || 0) - (a.portions?.[0]?.price || 0);
                if (sortBy === 'rating-desc') return (b.rating || 0) - (a.rating || 0);

                return 0; // Default order
            });
            // --- END FIX ---

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
        // 🚨 CRITICAL: Block adding to cart if delivery not allowed
        if (deliveryType === 'delivery' && deliveryValidation && !deliveryValidation.allowed) {
            setInfoDialog({
                isOpen: true,
                title: '🚫 Delivery Not Available',
                message: deliveryValidation.message || 'Your selected address is beyond our delivery range. Please select a different address or choose pickup/dine-in.'
            });
            return; // Block add to cart
        }

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
    }, [deliveryType, deliveryValidation]);

    const handleIncrement = (item) => {
        // NEW: Block item selection for dine-in if details not provided
        if (deliveryType === 'dine-in' && tableIdFromUrl && !detailsProvided) {
            setInfoDialog({
                isOpen: true,
                title: "Details Required",
                message: "Please enter your name and party size before ordering. The modal will open automatically."
            });
            setIsDineInModalOpen(true); // Force modal open
            return;
        }

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
        if (date) {
            localDate = setMinutes(setHours(date, parseInt(time.split(':')[0])), parseInt(time.split(':')[1]));
        } else {
            setInfoDialog({ isOpen: true, title: "Booking Failed", message: "Please select a date." });
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
        if (section) {
            const yOffset = -120;
            const y = section.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    }

    const handleCheckout = () => {
        if (deliveryType === 'delivery' && deliveryValidation && !deliveryValidation.allowed) {
            setInfoDialog({
                isOpen: true,
                title: '🚫 Delivery Not Available',
                message: deliveryValidation.message || 'Your selected address is beyond our delivery range. Please select a different address.'
            });
            return;
        }

        const params = new URLSearchParams();
        if (restaurantId) params.set('restaurantId', restaurantId);

        // Pass GUEST Identity
        if (ref) params.set('ref', ref);
        // Pass Phone (Legacy - fallback)
        if (phone && !ref) params.set('phone', phone);

        if (token) params.set('token', token);
        if (tableIdFromUrl) params.set('table', tableIdFromUrl);

        // Use tabIdFromUrl (from Add More button) if present, otherwise use activeTabInfo.id
        if (deliveryType === 'dine-in') {
            const tabId = tabIdFromUrl || activeTabInfo.id;
            if (tabId) {
                params.set('tabId', tabId);
            }
        }
        // ✅ Keep liveOrder for Track button (works for ALL business types)
        // - For street vendors: Shows LATEST order, track page has tabs for all orders
        // - For restaurants: Can be used for add-on orders
        if (liveOrder && liveOrder.restaurantId === restaurantId) {
            params.set('activeOrderId', liveOrder.orderId);
            // Overwrite/Ensure the token matches the active order if present, or just use it.
            // Using 'set' avoids duplicates.
            const activeToken = liveOrder.trackingToken || token;
            if (activeToken) params.set('token', activeToken);
        }

        // Route to appropriate page based on delivery type
        const targetPage = deliveryType === 'dine-in' ? '/cart' : '/checkout';
        const url = `${targetPage}?${params.toString()}`;
        router.push(url);
    };

    const handleCloseDineInModal = () => {
        // NEW: Block closing if dine-in user hasn't provided details yet
        if (tableIdFromUrl && !detailsProvided) {
            console.log('[Dine-In] Cannot close modal - details required');
            setInfoDialog({
                isOpen: true,
                title: "Details Required",
                message: "Please enter your name and party size to continue. This helps us provide better service!"
            });
            return; // Prevent closing
        }

        setIsDineInModalOpen(false);
        setIsEditingModal(false);
        if (dineInState === 'needs_setup') {
            setDeliveryType('delivery');
            setDineInState('ready');
        }
    }

    useEffect(() => {
        if (isQrScannerOpen) {
            const timer = setTimeout(() => setIsDineInModalOpen(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isQrScannerOpen]);


    if (loading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (error || restaurantData.status === 'rejected' || restaurantData.status === 'suspended') {
        // NEW: Special handling for cleaning_pending state
        if (dineInState === 'cleaning_pending') {
            return (
                <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                    <div className="max-w-md w-full space-y-6">
                        <div className="flex flex-col items-center">
                            <Wind size={64} className="mb-4 text-orange-500 animate-pulse" />
                            <h1 className="text-2xl font-bold text-foreground">Table Being Cleaned</h1>
                        </div>
                        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                            <p className="text-muted-foreground whitespace-pre-line">{error}</p>
                            <Button
                                onClick={() => window.location.reload()}
                                className="w-full"
                                size="lg"
                            >
                                <RefreshCw className="mr-2 h-5 w-5" />
                                Refresh to Check Again
                            </Button>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Please wait for staff to finish cleaning the table. This usually takes just a few minutes.
                        </p>
                    </div>
                </div>
            );
        }

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
                    setIsQrScannerOpen={setIsQrScannerOpen}
                    setInfoDialog={setInfoDialog}
                    newTabPax={newTabPax}
                    setNewTabPax={setNewTabPax}
                    newTabName={newTabName}
                    setNewTabName={setNewTabName}
                    isEditing={isEditingModal}
                    onUpdateTab={handleUpdateTab}
                />
            </div>
        )
    }

    const getTrackingUrl = () => {
        if (!liveOrder) return null;

        // ✅ FIX: Route based on delivery type stored in liveOrder
        const orderDeliveryType = liveOrder.deliveryType || 'delivery';

        if (orderDeliveryType === 'dine-in') {
            let url = `/track/dine-in/${liveOrder.orderId}?token=${liveOrder.trackingToken}`;
            if (ref) url += `&ref=${ref}`;
            return url;
        }

        const trackingPath = (restaurantData.businessType === 'street-vendor' || orderDeliveryType === 'street-vendor-pre-order')
            ? `/track/pre-order/${liveOrder.orderId}`
            : `/track/delivery/${liveOrder.orderId}`; // ✅ Explicitly use /delivery/ path

        let url = `${trackingPath}?token=${liveOrder.trackingToken}`;
        if (ref) url += `&ref=${ref}`;
        if (phone) url += `&phone=${phone}`;
        // Also send activeOrderId just in case for back navigation
        url += `&activeOrderId=${liveOrder.orderId}`;

        return url;
    };

    const trackingUrl = getTrackingUrl();

    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />

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
            <div className="min-h-screen bg-background text-foreground green-theme overflow-x-hidden max-w-full">
                <DineInModal
                    isOpen={isDineInModalOpen}
                    onClose={handleCloseDineInModal}
                    onBookTable={handleBookTable}
                    tableStatus={tableStatus}
                    onStartNewTab={handleStartNewTab}
                    onJoinTab={handleJoinTab}
                    setIsQrScannerOpen={setIsQrScannerOpen}
                    setInfoDialog={setInfoDialog}
                    newTabPax={newTabPax}
                    setNewTabPax={setNewTabPax}
                    newTabName={newTabName}
                    setNewTabName={setNewTabName}
                    isEditing={isEditingModal}
                    onUpdateTab={handleUpdateTab}
                />
                <CustomizationDrawer item={customizationItem} isOpen={!!customizationItem} onClose={() => setCustomizationItem(null)} onAddToCart={handleAddToCart} />
                <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />

                {/* ADDRESS SELECTION DRAWER - TOP SHEET */}
                <AnimatePresence>
                    {isAddressSelectorOpen && (
                        <>
                            <motion.div
                                className="fixed inset-0 bg-black/50 z-[60]"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => window.history.back()}
                            />
                            <motion.div
                                className="fixed top-0 left-0 right-0 h-screen bg-background z-[70] shadow-2xl flex flex-col overflow-hidden"
                                initial={{ y: '-100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '-100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                drag="y"
                                dragConstraints={{ top: -1000, bottom: 0 }}
                                dragElastic={{ top: 0.1, bottom: 0.05 }}
                                onDragEnd={(e, { offset, velocity }) => {
                                    if (offset.y < -100 || velocity.y < -500) {
                                        window.history.back();
                                    }
                                }}
                            >
                                <div className="p-4 border-b flex items-center justify-between shrink-0 bg-background z-10">
                                    <h2 className="font-bold text-lg">Select Address</h2>
                                    <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
                                        <ChevronUp />
                                    </Button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 overscroll-contain">
                                    <AddressSelectionList
                                        addresses={userAddresses}
                                        selectedAddressId={customerLocation?.id}
                                        onSelect={(addr) => {
                                            window.history.back(); // Close first (pops state)
                                            // Small timeout to allow state pop before setting new address
                                            setTimeout(() => handleSelectNewAddress(addr), 50);
                                        }}
                                        loading={addressLoading}
                                        onUseCurrentLocation={() => {
                                            // Pass useCurrent=true to trigger auto-fetch
                                            router.push(`/add-address?useCurrent=true&returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
                                        }}
                                        onAddNewAddress={() => {
                                            router.push(`/add-address?useCurrent=true&returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
                                        }}
                                        onDelete={async (id) => {
                                            if (confirm('Are you sure you want to delete this address?')) {
                                                setAddressLoading(true);
                                                try {
                                                    await fetch(`/api/user/addresses?id=${id}`, { method: 'DELETE' });
                                                    // Refresh logic (simplified: close and reopen or just refetch if logic separated)
                                                    // ideally we should have a refetch function, but for now we might need to close/open
                                                    // or just manually remove from local state
                                                    setUserAddresses(prev => prev.filter(a => a.id !== id));
                                                } catch (e) { console.error(e) } finally { setAddressLoading(false); }
                                            }
                                        }}
                                    />
                                    {/* Drag Handle Indicator - Pull Up to Close */}
                                    <div className="w-full flex flex-col items-center justify-center py-6 opacity-50 space-y-2 pointer-events-none">
                                        <ChevronUp size={16} className="animate-bounce" />
                                        <span className="text-xs font-medium">Pull up to close</span>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {/* Back Button Handler Effect */}
                {isAddressSelectorOpen && (
                    <BackButtonHandler onClose={handleCloseAddressSelector} />
                )}

                <header>
                    <BannerCarousel images={restaurantData.bannerUrls} onClick={() => setIsBannerExpanded(true)} restaurantName={restaurantData.name} logoUrl={restaurantData.logoUrl} />
                </header>

                {/* NEW: Welcome Message for Dine-In Users */}
                {showWelcome && detailsProvided && userDetails && tableIdFromUrl && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="container mx-auto px-4 mt-4"
                    >
                        <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Users className="h-6 w-6 text-green-600 dark:text-green-400" />
                                <div>
                                    <h3 className="font-semibold text-lg text-foreground">
                                        Welcome back, {userDetails.tab_name}!
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        Party of {userDetails.pax_count} • Table {tableIdFromUrl}
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    // Pre-fill modal fields with current details
                                    setNewTabPax(userDetails.pax_count || 1);
                                    setNewTabName(userDetails.tab_name || '');
                                    setIsEditingModal(true);
                                    setIsDineInModalOpen(true);
                                }}
                                className="gap-2"
                            >
                                <Edit2 className="h-4 w-4" />
                                Edit
                            </Button>
                        </div>
                    </motion.div>
                )}

                <div className="container mx-auto px-4 mt-6 space-y-4">

                    {/* Restaurant Closed Warning */}
                    {restaurantData.isOpen === false && (
                        <Alert className="border-red-500 bg-red-500/10">
                            <AlertCircle className="h-4 w-4 text-red-500" />
                            <AlertTitle className="text-red-500 font-bold">Restaurant Currently Closed</AlertTitle>
                            <AlertDescription className="text-red-400">
                                Sorry, {restaurantData.name} is currently closed and not accepting orders. Please check back later or contact the restaurant for more information.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* ✅ NEW: Delivery Distance Validation Status - HIDDEN AS PER USER REQUEST
                    {deliveryType === 'delivery' && deliveryValidation && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-4"
                        >
                            <Alert className={deliveryValidation.allowed ? "border-green-500 bg-green-500/10" : "border-red-500 bg-red-500/10"}>
                                {deliveryValidation.allowed ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                ) : (
                                    <AlertCircle className="h-4 w-4 text-red-500" />
                                )}
                                <AlertTitle className={deliveryValidation.allowed ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
                                    {deliveryValidation.allowed ? "✓ Delivery Available" : "✗ Delivery Not Available"}
                                </AlertTitle>
                                <AlertDescription className={deliveryValidation.allowed ? "text-green-400" : "text-red-400"}>
                                    {deliveryValidation.allowed ? (
                                        <div className="space-y-1">
                                            <p>📍 Distance: {deliveryValidation.roadDistance} km {deliveryValidation.roadFactor > 1 && `(${deliveryValidation.aerialDistance}km aerial × ${deliveryValidation.roadFactor})`}</p>
                                            {subtotal > 0 ? (
                                                <p>💰 Delivery Charge: ₹{deliveryValidation.charge}</p>
                                            ) : (
                                                <p className="text-xs italic opacity-80">Add items to see final delivery charge</p>
                                            )}
                                        </div>
                                    ) : (
                                        <p>{deliveryValidation.message || "Address beyond delivery range."}</p>
                                    )}
                                </AlertDescription>
                            </Alert>
                        </motion.div>
                    )}
                    */}


                    {/* NEW: Cleaning Info Banner - When seats available but cleaning pending */}
                    {
                        tableStatus?.cleaningWarning && (
                            <Alert className="border-orange-500 bg-orange-500/10">
                                <Wind className="h-4 w-4 text-orange-500" />
                                <AlertTitle className="text-orange-600 dark:text-orange-400 font-bold">Table Partially Occupied</AlertTitle>
                                <AlertDescription className="text-orange-600/90 dark:text-orange-400/90">
                                    Some guests are finishing up. <strong>{tableStatus.cleaningWarning.availableSeats} seat{tableStatus.cleaningWarning.availableSeats > 1 ? 's' : ''} available</strong> for you to order. {tableStatus.cleaningWarning.uncleanedCount} order{tableStatus.cleaningWarning.uncleanedCount > 1 ? 's' : ''} being cleaned.
                                </AlertDescription>
                            </Alert>
                        )
                    }


                    {
                        restaurantData.businessType !== 'street-vendor' && !tableIdFromUrl && (
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
                                                <MapPin className="text-primary flex-shrink-0" size={20} />
                                                <p className="text-sm text-muted-foreground truncate">{customerLocation?.full || 'No location set'}</p>
                                            </div>
                                            <Button
                                                variant="link"
                                                className="text-primary p-0 h-auto font-semibold flex-shrink-0"
                                                onClick={handleOpenAddressDrawer}
                                            >
                                                Change
                                            </Button>
                                        </>
                                    ) : deliveryType === 'pickup' ? (
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <Store className="text-primary flex-shrink-0" size={20} />
                                            <div>
                                                <p className="text-xs text-muted-foreground">Pick your order from</p>
                                                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantData.businessAddress?.full || restaurantData.name)}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-foreground truncate flex items-center gap-1 hover:underline text-primary">
                                                    {restaurantData.businessAddress?.full || 'N/A'} <ExternalLink size={12} />
                                                </a>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        )
                    }
                    {
                        tableIdFromUrl && (
                            <div className="bg-card p-4 rounded-lg border border-border flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <ConciergeBell className="text-primary" />
                                    <h2 className="text-lg font-bold text-foreground">Ordering for: Table {tableIdFromUrl}</h2>
                                </div>
                                <Button onClick={handleCallWaiter} variant="outline" className="flex items-center gap-2 text-base font-semibold">
                                    <Bell size={20} className="text-primary" /> Call Waiter
                                </Button>
                            </div>
                        )
                    }

                    {/* Track Live Order Button - Only for Dine-In with existing order */}
                    {
                        deliveryType === 'dine-in' && liveOrder && liveOrder.restaurantId === restaurantId && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-gradient-to-r from-yellow-400 to-orange-400 p-4 rounded-lg border-2 border-yellow-500 shadow-lg"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                                            <Navigation className="text-white" size={20} />
                                        </div>
                                        <div>
                                            <p className="text-white font-bold text-sm">Your Order is Active</p>
                                            <p className="text-white/80 text-xs">Track your order status</p>
                                        </div>
                                    </div>
                                    <Button
                                        asChild
                                        className="bg-white text-black hover:bg-white/90 font-bold"
                                    >
                                        <a href={`/track/dine-in/${liveOrder.orderId}?tabId=${searchParams.get('tabId') || ''}&token=${liveOrder.trackingToken}`}>
                                            Track Order
                                        </a>
                                    </Button>
                                </div>
                            </motion.div>
                        )
                    }

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
                </div >

                {/* Only show menu if restaurant is open */}
                {
                    restaurantData.isOpen ? (
                        <>

                            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 border-b border-border mt-4 shadow-sm">
                                <div className="container mx-auto px-4">
                                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-1">
                                        {liveOrder && trackingUrl && (
                                            <div className="flex items-center gap-1">
                                                <Link href={trackingUrl} className="flex-shrink-0">
                                                    <motion.div
                                                        className={cn("p-2 rounded-lg text-black flex items-center animate-pulse", liveOrder.status === 'Ready' || liveOrder.status === 'ready_for_pickup' ? 'bg-green-400 hover:bg-green-500' : 'bg-yellow-400 hover:bg-yellow-500')}
                                                        whileHover={{ scale: 1.05 }}
                                                    >
                                                        <Navigation size={16} className="mr-2" />
                                                        <span className="text-sm font-bold hidden sm:inline">Track</span>
                                                    </motion.div>
                                                </Link>
                                            </div>
                                        )}

                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card whitespace-nowrap text-sm font-medium shadow-sm flex-shrink-0 hover:bg-muted transition-colors">
                                                    <SlidersHorizontal size={14} /> Filters <ChevronDown size={14} />
                                                </button>
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
                                                </div>
                                            </PopoverContent>
                                        </Popover>

                                        <button
                                            onClick={() => handleFilterChange('veg')}
                                            className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium whitespace-nowrap shadow-sm transition-colors flex-shrink-0", filters.veg ? "bg-green-50 border-green-500 text-green-700" : "bg-card border-border hover:bg-muted")}
                                        >
                                            <div className="w-4 h-4 border border-green-500 flex items-center justify-center rounded-[2px]"><div className="w-2 h-2 bg-green-500 rounded-full"></div></div>
                                            Veg
                                        </button>

                                        <button
                                            onClick={() => handleFilterChange('nonVeg')}
                                            className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium whitespace-nowrap shadow-sm transition-colors flex-shrink-0", filters.nonVeg ? "bg-red-50 border-red-500 text-red-700" : "bg-card border-border hover:bg-muted")}
                                        >
                                            <div className="w-4 h-4 border border-red-500 flex items-center justify-center rounded-[2px]"><div className="w-2 h-2 bg-red-500 rounded-full"></div></div>
                                            Non-veg
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="container mx-auto px-4 mt-6 pb-40">
                                <main>
                                    <div className="space-y-8">
                                        {menuCategories.map(({ key, title }) => (
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
                        </>
                    ) : (
                        <div className="container mx-auto px-4 mt-6 pb-40">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="max-w-md mx-auto"
                            >
                                <div className="bg-card border-2 border-red-500/30 rounded-2xl p-8 shadow-2xl">
                                    <div className="flex flex-col items-center text-center space-y-4">
                                        {/* Icon */}
                                        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                                            <AlertCircle className="w-12 h-12 text-red-500" />
                                        </div>

                                        {/* Title */}
                                        <h2 className="text-2xl font-bold text-foreground">
                                            We&apos;re Currently Closed
                                        </h2>

                                        {/* Message */}
                                        <p className="text-muted-foreground text-base leading-relaxed">
                                            {restaurantData.name} is not accepting orders at the moment.
                                            Please check back later or contact us for more information.
                                        </p>

                                        {/* Decorative element */}
                                        <div className="pt-4 flex items-center gap-2 text-sm text-muted-foreground">
                                            <Clock className="w-4 h-4" />
                                            <span>We&apos;ll be back soon!</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    )
                }
                <AnimatePresence>
                    {totalCartItems > 0 && (
                        <motion.div
                            className="fixed bottom-0 left-0 right-0 z-30"
                            initial={{ y: 100, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 100, opacity: 0 }}
                        >
                            <div className="bg-background/80 backdrop-blur-sm border-t border-border">
                                <Button onClick={handleCheckout} className="h-16 w-full text-lg font-bold rounded-none shadow-lg shadow-primary/30 flex justify-between items-center text-primary-foreground px-6 bg-primary hover:bg-primary/90">
                                    <span>{totalCartItems} Item{totalCartItems > 1 ? 's' : ''} | {formatCurrency(subtotal)}</span>
                                    <span className="flex items-center">
                                        {(liveOrder && liveOrder.restaurantId === restaurantId) ? 'Add to Order' : 'View Cart'} <ArrowRight className="ml-2 h-5 w-5" />
                                    </span>
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <motion.div
                    className="fixed bottom-4 right-4 z-20"
                    animate={{ y: totalCartItems > 0 ? -80 : 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                >
                    <Button size="icon" className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg" onClick={() => setIsMenuBrowserOpen(true)}>
                        <BookOpen size={28} />
                    </Button>
                </motion.div>

            </div >
        </>
    );
};

const OrderPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
        >
            <ThemeColorUpdater />
            <GlobalHapticHandler />
            <OrderPageInternal />
        </ThemeProvider>
    </Suspense>
);

export default OrderPage;
