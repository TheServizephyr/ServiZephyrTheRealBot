

"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, PlusCircle, Filter, ArrowDownUp, Edit, Trash2, Calendar as CalendarIcon, Wand2, Ticket, IndianRupee, Percent, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { auth } from '@/lib/firebase';


const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) { // Invalid date
       // Handle Firestore timestamp object
       if(dateStr.seconds) {
         return format(new Date(dateStr.seconds * 1000), "dd MMM yyyy");
       }
       return 'N/A';
    }
    return format(date, "dd MMM yyyy");
};

const CouponModal = ({ isOpen, setIsOpen, onSave, editingCoupon }) => {
    const [coupon, setCoupon] = useState(null);
    const [isStartDatePickerOpen, setStartDatePickerOpen] = useState(false);
    const [isEndDatePickerOpen, setEndDatePickerOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if(isOpen) {
            setIsSaving(false);
            if (editingCoupon) {
                // Ensure dates are Date objects for the calendar
                setCoupon({
                    ...editingCoupon,
                    startDate: new Date(editingCoupon.startDate),
                    expiryDate: new Date(editingCoupon.expiryDate),
                });
            } else {
                setCoupon({
                    id: null, code: '', description: '', type: 'flat', value: '',
                    minOrder: '', startDate: new Date(), expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                    status: 'Active', timesUsed: 0
                });
            }
        }
    }, [isOpen, editingCoupon]);

    const handleChange = (field, value) => {
        setCoupon(prev => ({ ...prev, [field]: value }));
    };
    
    const generateRandomCode = () => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!coupon.code || !coupon.value || !coupon.minOrder) {
            alert('Please fill all required fields: Code, Value, and Minimum Order.');
            return;
        }
        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            // alert is handled by onSave
        } finally {
            setIsSaving(false);
        }
    };

    if(!coupon) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl bg-gray-900 border-gray-700 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-2xl">
                            <Ticket /> {editingCoupon ? 'Edit Coupon' : 'Create New Coupon'}
                        </DialogTitle>
                        <DialogDescription>Fill in the details for your new promotional offer.</DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-6 py-6">
                        <div className="space-y-6">
                            <div>
                                <Label htmlFor="code">Coupon Code</Label>
                                <div className="flex items-center gap-2 mt-1">
                                    <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                                    <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2"/> Generate</Button>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="description">Description</Label>
                                <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={3} placeholder="e.g., Get 20% off on your first order" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                            </div>
                             <div>
                                <Label>Discount Type</Label>
                                <div className="flex gap-4 mt-2">
                                     <div onClick={() => handleChange('type', 'flat')} className={cn('flex-1 p-4 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-3', coupon.type === 'flat' ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-600')}>
                                        <IndianRupee /> Flat Amount
                                     </div>
                                     <div onClick={() => handleChange('type', 'percentage')} className={cn('flex-1 p-4 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-3', coupon.type === 'percentage' ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-600')}>
                                        <Percent /> Percentage
                                     </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="value">Discount Value</Label>
                                    <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder={coupon.type === 'flat' ? 'e.g., 100' : 'e.g., 20'} className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                                </div>
                                <div>
                                    <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                    <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                                </div>
                            </div>
                           <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Start Date</Label>
                                    <Popover open={isStartDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                                        <PopoverTrigger asChild>
                                           <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.startDate && "text-muted-foreground")}>
                                              <CalendarIcon className="mr-2 h-4 w-4" />
                                              {coupon.startDate ? format(coupon.startDate, "dd MMM yyyy") : <span>Pick a date</span>}
                                           </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.startDate} onSelect={(date) => {handleChange('startDate', date); setStartDatePickerOpen(false);}} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                                <div>
                                    <Label>Expiry Date</Label>
                                    <Popover open={isEndDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                                         <PopoverTrigger asChild>
                                           <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                              <CalendarIcon className="mr-2 h-4 w-4" />
                                              {coupon.expiryDate ? format(coupon.expiryDate, "dd MMM yyyy") : <span>Pick a date</span>}
                                           </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.expiryDate} onSelect={(date) => {handleChange('expiryDate', date); setEndDatePickerOpen(false);}} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                           </div>
                           <div>
                                <Label>Status</Label>
                                <div className="flex items-center gap-4 mt-2 bg-gray-800 p-3 rounded-md">
                                    <Switch id="status" checked={coupon.status === 'Active'} onCheckedChange={(checked) => handleChange('status', checked ? 'Active' : 'Inactive')} />
                                    <Label htmlFor="status" className={cn(coupon.status === 'Active' ? 'text-green-400' : 'text-gray-400')}>
                                        {coupon.status === 'Active' ? 'Coupon is Active' : 'Coupon is Inactive'}
                                    </Label>
                                </div>
                           </div>
                        </div>
                    </div>

                    <DialogFooter className="pt-6">
                        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isSaving}>
                            {isSaving ? 'Saving...' : (editingCoupon ? 'Save Changes' : 'Create Coupon')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const CouponCard = ({ coupon, onStatusToggle, onEdit, onDelete }) => {
    const isExpired = new Date(coupon.expiryDate) < new Date();
    const status = isExpired ? 'Expired' : coupon.status;
    
    const statusConfig = {
        'Active': { text: 'text-green-400', bg: 'bg-green-500/10', icon: <CheckCircle/> },
        'Inactive': { text: 'text-gray-400', bg: 'bg-gray-500/10', icon: <XCircle/> },
        'Expired': { text: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle/> },
    };
    
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-gray-800/50 border border-gray-700 rounded-xl flex flex-col overflow-hidden shadow-lg hover:shadow-indigo-500/20 hover:-translate-y-1 transition-all duration-300"
        >
            <div className="p-5 bg-gray-800">
                <div className="flex justify-between items-start">
                    <p className="font-mono text-2xl font-bold tracking-widest text-white bg-gray-700 px-4 py-2 rounded-lg border-2 border-dashed border-gray-500">{coupon.code}</p>
                    <div className={cn('flex items-center gap-2 text-sm font-semibold px-3 py-1 rounded-full', statusConfig[status].bg, statusConfig[status].text)}>
                        {statusConfig[status].icon}
                        {status}
                    </div>
                </div>
                <p className="text-3xl font-bold text-indigo-400 mt-4">
                    {coupon.type === 'flat' ? `₹${coupon.value} OFF` : `${coupon.value}% OFF`}
                </p>
            </div>
            
            <div className="p-5 flex-grow">
                 <p className="text-sm text-gray-300 mb-4">{coupon.description}</p>
                 <div className="text-sm space-y-2">
                     <p><span className="font-semibold text-gray-400">Min. Order:</span> ₹{coupon.minOrder}</p>
                     <p><span className="font-semibold text-gray-400">Expires:</span> {formatDate(coupon.expiryDate)}</p>
                     <p><span className="font-semibold text-gray-400">Times Used:</span> {coupon.timesUsed}</p>
                 </div>
            </div>

            <div className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-between items-center">
                 <div className="flex items-center gap-2">
                     <Switch 
                        checked={status === 'Active'} 
                        onCheckedChange={() => onStatusToggle(coupon, status === 'Active' ? 'Inactive' : 'Active')}
                        disabled={status === 'Expired'}
                        id={`switch-${coupon.id}`}
                     />
                     <Label htmlFor={`switch-${coupon.id}`} className="text-sm text-gray-400">
                        {status === 'Active' ? 'Active' : 'Inactive'}
                     </Label>
                 </div>
                 <div className="flex items-center gap-1">
                     <Button variant="ghost" size="icon" onClick={() => onEdit(coupon)}><Edit size={16}/></Button>
                     <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => onDelete(coupon.id)}><Trash2 size={16}/></Button>
                 </div>
            </div>
        </motion.div>
    );
};

export default function CouponsPage() {
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState(null);
    const [filter, setFilter] = useState('All');
    const [sort, setSort] = useState('expiryDate-asc');

    const fetchCoupons = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/coupons', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch coupons');
            }
            const data = await res.json();
            // Process dates from Firestore Timestamps to JS Dates
            const processedCoupons = (data.coupons || []).map(c => ({
                ...c,
                startDate: c.startDate.seconds ? new Date(c.startDate.seconds * 1000) : new Date(c.startDate),
                expiryDate: c.expiryDate.seconds ? new Date(c.expiryDate.seconds * 1000) : new Date(c.expiryDate)
            }));
            setCoupons(processedCoupons);
        } catch (error) {
            console.error(error);
            alert("Could not load coupons: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchCoupons();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleAPICall = async (method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        const res = await fetch('/api/owner/coupons', {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }

    const handleSaveCoupon = async (couponData) => {
        try {
            const isEditing = !!couponData.id;
            // Convert dates to ISO strings for JSON serialization
            const payload = {
                ...couponData,
                startDate: couponData.startDate.toISOString(),
                expiryDate: couponData.expiryDate.toISOString(),
            };
            const data = await handleAPICall(isEditing ? 'PATCH' : 'POST', { coupon: payload });
            alert(data.message);
            await fetchCoupons(); // Refresh list
        } catch (error) {
            alert(`Error saving coupon: ${error.message}`);
            throw error; // Re-throw to keep modal open
        }
    };

    const handleEdit = (coupon) => {
        setEditingCoupon(coupon);
        setIsModalOpen(true);
    };

    const handleCreateNew = () => {
        setEditingCoupon(null);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if(window.confirm('Are you sure you want to delete this coupon? This action cannot be undone.')) {
            try {
                const data = await handleAPICall('DELETE', { couponId: id });
                alert(data.message);
                await fetchCoupons(); // Refresh list
            } catch (error) {
                alert(`Error deleting coupon: ${error.message}`);
            }
        }
    };
    
    const handleStatusToggle = async (coupon, newStatus) => {
        try {
            await handleAPICall('PATCH', { coupon: { id: coupon.id, status: newStatus } });
            // Optimistic update
            setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, status: newStatus } : c));
        } catch (error) {
            alert(`Error updating status: ${error.message}`);
            await fetchCoupons(); // Re-fetch to correct state
        }
    };

    const filteredAndSortedCoupons = useMemo(() => {
        let items = [...coupons].map(c => ({...c, isExpired: new Date(c.expiryDate) < new Date()}));

        if (filter !== 'All') {
            items = items.filter(c => (c.isExpired ? 'Expired' : c.status) === filter);
        }
        
        const [sortKey, sortDir] = sort.split('-');
        items.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (sortKey.includes('Date')) {
                valA = new Date(valA);
                valB = new Date(valB);
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [coupons, filter, sort]);


    return (
        <div className="p-4 md:p-6 text-white min-h-screen bg-gray-900">
            <CouponModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} onSave={handleSaveCoupon} editingCoupon={editingCoupon} />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Coupon & Offer Hub</h1>
                    <p className="text-gray-400 mt-1">Create, manage, and track your promotional offers.</p>
                </div>
                <Button onClick={handleCreateNew} className="bg-indigo-600 hover:bg-indigo-700">
                    <PlusCircle size={20} className="mr-2"/> Create New Coupon
                </Button>
            </div>

            <div className="flex flex-col md:flex-row justify-end items-center gap-4 mb-6 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-gray-400"/>
                    <Label htmlFor="filter-status">Filter by Status:</Label>
                    <select id="filter-status" value={filter} onChange={e => setFilter(e.target.value)} className="p-2 text-sm border rounded-md bg-gray-800 border-gray-600 focus:ring-indigo-500 focus:border-indigo-500">
                        <option value="All">All</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Expired">Expired</option>
                    </select>
                </div>
                 <div className="flex items-center gap-2">
                    <ArrowDownUp size={16} className="text-gray-400"/>
                    <Label htmlFor="sort-by">Sort by:</Label>
                    <select id="sort-by" value={sort} onChange={e => setSort(e.target.value)} className="p-2 text-sm border rounded-md bg-gray-800 border-gray-600 focus:ring-indigo-500 focus:border-indigo-500">
                        <option value="expiryDate-asc">Expiry Date (Soonest)</option>
                        <option value="expiryDate-desc">Expiry Date (Latest)</option>
                        <option value="timesUsed-desc">Usage (Most First)</option>
                        <option value="timesUsed-asc">Usage (Least First)</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-xl h-80"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {filteredAndSortedCoupons.map(coupon => (
                            <CouponCard 
                                key={coupon.id} 
                                coupon={coupon}
                                onStatusToggle={handleStatusToggle}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
             {!loading && filteredAndSortedCoupons.length === 0 && (
                <div className="text-center py-16 text-gray-500">
                    <p className="text-lg font-semibold">No coupons found.</p>
                    <p>Try adjusting your filters or create a new coupon!</p>
                </div>
            )}
        </div>
    );
}
