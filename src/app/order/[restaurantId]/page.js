
'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Plus, Minus, X, Home, User, Edit2, ShoppingCart, Star, CookingPot, BookOpen, Check, SlidersHorizontal, ArrowUpDown, PlusCircle, Ticket, Gift, Sparkles, Flame, Search, Trash2, ChevronDown, Tag as TagIcon, RadioGroup, IndianRupee, HardHat, MapPin, Bike, Store, ConciergeBell, QrCode, CalendarClock, Wallet, Users, Camera, BookMarked, Calendar as CalendarIcon, Bell, CheckCircle, AlertTriangle, AlertCircle, ExternalLink, ShoppingBag, Sun, Moon, ChevronUp, Lock, Loader2, Navigation, ArrowRight, Clock } from 'lucide-react';
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
import ThemeColorUpdater from '@/components/ThemeColorUpdater';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';


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

const DineInModal = ({ isOpen, onClose, onBookTable, tableStatus, onStartNewTab, onJoinTab, setIsQrScannerOpen, setInfoDialog }) => {
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
                setNewTabPax(1);
                setNewTabName('');
            }, 300);
        } else {
            if (tableStatus?.state === 'available') {
                setActiveModal('new_tab');
            } else if (tableStatus?.state === 'occupied') {
                setActiveModal('join_or_new');
            } else if (tableStatus?.state === 'full') {
                setActiveModal('full');
            } else {
                setActiveModal('main');
            }
        }
    }, [isOpen, tableStatus]);

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

    const [newTabPax, setNewTabPax] = useState(1);
    const [newTabName, setNewTabName] = useState('');

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
        const availableCapacity = tableStatus.max_capacity - (tableStatus.current_pax || 0);
        if (pax > availableCapacity) {
            setInfoDialog({ isOpen: true, title: "Capacity Exceeded", message: `This table can only accommodate ${availableCapacity} more guest(s).` });
            return;
        }

        onStartNewTab(pax, name);
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
                                    <DialogTitle>Start a New Tab</DialogTitle>
                                    <DialogDescription>Welcome to Table {tableStatus?.tableId}! (Capacity: {tableStatus?.max_capacity}). Let's get your tab started.</DialogDescription>
                                </DialogHeader>
                                <div className="px-6 pb-6 space-y-4">
                                    <div>
                                        <Label>How many people are in your group?</Label>
                                        <Input type="number" value={newTabPax} onChange={e => setNewTabPax(parseInt(e.target.value))} min="1" max={tableStatus?.max_capacity - (tableStatus?.current_pax || 0)} className="mt-1" />
                                    </div>
                                    <div>
                                        <Label>What's a name for your tab?</Label>
                                        <Input value={newTabName} onChange={e => setNewTabName(e.target.value)} placeholder="e.g., Rohan's Group" className="mt-1" />
                                    </div>
                                    <Button onClick={handleStartTab} className="w-full">Start Ordering</Button>
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
    const tableIdFromUrl = searchParams.get('table');
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const activeOrderId = searchParams.get('activeOrderId');
    const activeOrderToken = searchParams.get('token');
    const [liveOrder, setLiveOrder] = useState(null);

    useEffect(() => {
        const liveOrderKey = `liveOrder_${restaurantId}`;
        const liveOrderDataStr = localStorage.getItem(liveOrderKey);

        if (liveOrderDataStr) {
            const liveOrderData = JSON.parse(liveOrderDataStr);
            const pollStatus = async () => {
                try {
                    const res = await fetch(`/api/order/status/${liveOrderData.orderId}`);
                    if (res.ok) {
                        const statusData = await res.json();
                        const status = statusData.order?.status;
                        if (['delivered', 'picked_up', 'rejected', 'cancelled', 'completed'].includes(status)) {
                            localStorage.removeItem(liveOrderKey);
                            setLiveOrder(null);
                        } else {
                            setLiveOrder(liveOrderData);
                        }
                    } else {
                        localStorage.removeItem(liveOrderKey);
                        setLiveOrder(null);
                    }
                } catch (e) {
                    console.error("Failed to poll live order status", e);
                    localStorage.removeItem(liveOrderKey);
                    setLiveOrder(null);
                }
            };
            pollStatus();
        } else if (activeOrderId && activeOrderToken) {
            // Check if the order from URL is still active before showing track button
            const checkOrderStatus = async () => {
                try {
                    const res = await fetch(`/api/order/status/${activeOrderId}`);
                    if (res.ok) {
                        const statusData = await res.json();
                        const status = statusData.order?.status;
                        // Only set liveOrder if status is active
                        if (!['delivered', 'picked_up', 'rejected', 'cancelled', 'completed'].includes(status)) {
                            setLiveOrder({ orderId: activeOrderId, trackingToken: activeOrderToken, restaurantId: restaurantId });
                        }
                    }
                } catch (e) {
                    console.error("Failed to check order status from URL", e);
                }
            };
            checkOrderStatus();
        } else if (phone && token && restaurantId) {
            // FIX: Check for active order on server if not in local storage
            const checkActiveOrder = async () => {
                try {
                    const res = await fetch('/api/order/active', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, token, restaurantId })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.activeOrder) {
                            setLiveOrder(data.activeOrder);
                            localStorage.setItem(liveOrderKey, JSON.stringify(data.activeOrder));
                        }
                    }
                } catch (e) {
                    console.error("Failed to check active order", e);
                }
            };
            checkActiveOrder();
        }
    }, [activeOrderId, activeOrderToken, restaurantId, phone, token]);


    const [customerLocation, setCustomerLocation] = useState(null);
    const [restaurantData, setRestaurantData] = useState({
        name: '', status: null, logoUrl: '', bannerUrls: ['/order_banner.jpg'],
        deliveryCharge: 0, menu: {}, coupons: [], deliveryEnabled: true,
        pickupEnabled: false, dineInEnabled: true, businessAddress: null,
        dineInModel: 'post-paid',
        dineInOnlinePaymentEnabled: true,
        dineInPayAtCounterEnabled: true,
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

    const tabIdFromUrl = searchParams.get('tabId');


    const handleStartNewTab = async (paxCount, tabName) => {
        try {
            const payload = {
                action: 'create_tab',
                tableId: tableIdFromUrl,
                restaurantId,
                pax_count: paxCount,
                tab_name: tabName,
            };

            const res = await fetch('/api/owner/dine-in-tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setActiveTabInfo({ id: data.tabId, name: tabName, pax_count: paxCount });
            setDineInState('ready');
            setIsDineInModalOpen(false);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error Creating Tab", message: error.message });
            throw error;
        }
    };

    const handleJoinTab = (tabId) => {
        const joinedTab = tableStatus.activeTabs.find(t => t.id === tabId);
        setActiveTabInfo({ id: tabId, name: joinedTab?.tab_name || 'Existing Tab', total: 0 });
        setDineInState('ready');
        setIsDineInModalOpen(false);
    };

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

                const onlinePaymentEnabled = settingsData?.onlinePaymentEnabled ?? true;
                const codEnabled = settingsData?.codEnabled ?? true;

                const fetchedSettings = {
                    name: menuData.restaurantName, status: menuData.approvalStatus,
                    logoUrl: menuData.logoUrl || '', bannerUrls: (menuData.bannerUrls?.length > 0) ? menuData.bannerUrls : ['/order_banner.jpg'],
                    deliveryCharge: menuData.deliveryCharge || 0,
                    deliveryFreeThreshold: menuData.deliveryFreeThreshold,
                    menu: menuData.menu || {}, coupons: menuData.coupons || [],
                    deliveryEnabled: menuData.deliveryEnabled, pickupEnabled: menuData.pickupEnabled,
                    dineInEnabled: menuData.dineInEnabled, businessAddress: menuData.businessAddress || null,
                    businessType: menuData.businessType || 'restaurant',
                    dineInModel: menuData.dineInModel || 'post-paid',
                    dineInOnlinePaymentEnabled: settingsData.dineInOnlinePaymentEnabled !== false,
                    dineInPayAtCounterEnabled: settingsData.dineInPayAtCounterEnabled !== false,
                    onlinePaymentEnabled: onlinePaymentEnabled,
                    codEnabled: codEnabled,
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
    }, [restaurantId, phone]);


    useEffect(() => {
        const verifySession = async () => {
            const isStreetVendorPage = restaurantData.businessType === 'street-vendor';
            if (isStreetVendorPage && !tableIdFromUrl && !phone && !token && !activeOrderId) {
                setIsTokenValid(true);
                return;
            }

            if (tableIdFromUrl || activeOrderId) {
                setIsTokenValid(true);
                return;
            }

            if (phone && token) {
                try {
                    const res = await fetch('/api/auth/verify-token', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, token }),
                    });
                    if (!res.ok) throw new Error((await res.json()).message || "Session validation failed.");
                    setIsTokenValid(true);
                } catch (err) {
                    setTokenError(err.message);
                }
                return;
            }
            setTokenError("No valid session information found. Please start a new session.");
        };

        if (!loading && restaurantData.businessType) {
            verifySession();
        }
    }, [restaurantId, tableIdFromUrl, phone, token, activeOrderId, restaurantData.businessType, loading]);

    useEffect(() => {
        const handleDineInSetup = async () => {
            if (tableIdFromUrl) {
                setDeliveryType('dine-in');

                if (tabIdFromUrl) {
                    setActiveTabInfo({ id: tabIdFromUrl, name: 'Active Tab', total: 0 });
                    setDineInState('ready');
                } else {
                    try {
                        const tableRes = await fetch(`/api/owner/tables?restaurantId=${restaurantId}&tableId=${tableIdFromUrl}`);
                        if (!tableRes.ok) throw new Error((await tableRes.json()).message);
                        const tableData = await tableRes.json();

                        let state = 'available';
                        const occupiedSeats = tableData.current_pax || 0;
                        if (occupiedSeats >= tableData.max_capacity) state = 'full';
                        else if (occupiedSeats > 0) state = 'occupied';

                        setTableStatus({ ...tableData, tableId: tableIdFromUrl, state });
                        setDineInState('needs_setup');
                        setIsDineInModalOpen(true);
                    } catch (err) {
                        setError(err.message);
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
            handleDineInSetup();
        }
    }, [isTokenValid, restaurantId, tableIdFromUrl, tabIdFromUrl, restaurantData.businessType, restaurantData.deliveryEnabled, restaurantData.pickupEnabled]);

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
        const params = new URLSearchParams();
        if (restaurantId) params.append('restaurantId', restaurantId);
        if (phone) params.append('phone', phone);
        if (token) params.append('token', token);
        if (tableIdFromUrl) params.append('table', tableIdFromUrl);

        if (deliveryType === 'dine-in' && activeTabInfo.id) {
            params.append('tabId', activeTabInfo.id);
        }
        if (liveOrder && liveOrder.restaurantId === restaurantId) {
            params.append('activeOrderId', liveOrder.orderId);
            params.append('token', liveOrder.trackingToken);
        }

        const url = `/cart?${params.toString()}`;
        router.push(url);
    };

    const handleCloseDineInModal = () => {
        setIsDineInModalOpen(false);
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
                    setInfoDialog={setInfoDialog}
                />
            </div>
        )
    }

    const getTrackingUrl = () => {
        if (!liveOrder || liveOrder.restaurantId !== restaurantId) return null;

        const businessType = restaurantData.businessType || 'restaurant';

        let path;
        if (businessType === 'street-vendor') {
            path = `/track/pre-order/${liveOrder.orderId}`;
        } else if (deliveryType === 'dine-in') {
            path = `/track/dine-in/${liveOrder.orderId}`;
        } else {
            path = `/track/${liveOrder.orderId}`;
        }

        return `${path}?token=${liveOrder.trackingToken}${phone ? `&phone=${phone}` : ''}`;
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
                    setInfoDialog={setInfoDialog} />
                <CustomizationDrawer item={customizationItem} isOpen={!!customizationItem} onClose={() => setCustomizationItem(null)} onAddToCart={handleAddToCart} />
                <MenuBrowserModal isOpen={isMenuBrowserOpen} onClose={() => setIsMenuBrowserOpen(false)} categories={menuCategories} onCategoryClick={handleCategoryClick} />

                <header>
                    <BannerCarousel images={restaurantData.bannerUrls} onClick={() => setIsBannerExpanded(true)} restaurantName={restaurantData.name} logoUrl={restaurantData.logoUrl} />
                </header>

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

                    {restaurantData.businessType !== 'street-vendor' && !tableIdFromUrl && (
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
                                        <Link href={`/location?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}&phone=${phone || ''}&token=${token || ''}`}>
                                            <Button variant="link" className="text-primary p-0 h-auto font-semibold flex-shrink-0">Change</Button>
                                        </Link>
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
                    )}
                    {tableIdFromUrl && (
                        <div className="bg-card p-4 rounded-lg border border-border flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <ConciergeBell className="text-primary" />
                                <h2 className="text-lg font-bold text-foreground">Ordering for: Table {tableIdFromUrl}</h2>
                            </div>
                            <Button onClick={handleCallWaiter} variant="outline" className="flex items-center gap-2 text-base font-semibold">
                                <Bell size={20} className="text-primary" /> Call Waiter
                            </Button>
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

                {/* Only show menu if restaurant is open */}
                {restaurantData.isOpen ? (
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
                                        We're Currently Closed
                                    </h2>

                                    {/* Message */}
                                    <p className="text-muted-foreground text-base leading-relaxed">
                                        {restaurantData.name} is not accepting orders at the moment.
                                        Please check back later or contact us for more information.
                                    </p>

                                    {/* Decorative element */}
                                    <div className="pt-4 flex items-center gap-2 text-sm text-muted-foreground">
                                        <Clock className="w-4 h-4" />
                                        <span>We'll be back soon!</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
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

            </div>
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
