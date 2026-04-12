

"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, PlusCircle, Filter, ArrowDownUp, Edit, Trash2, Calendar as CalendarIcon, Wand2, Ticket, IndianRupee, Percent, CheckCircle, XCircle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';

export const dynamic = 'force-dynamic';

const parseOrderMilestonesInput = (value) => {
    if (Array.isArray(value)) {
        return [...new Set(
            value
                .map((item) => Number.parseInt(item, 10))
                .filter((item) => Number.isInteger(item) && item > 0)
        )].sort((a, b) => a - b);
    }

    return [...new Set(
        String(value || '')
            .split(',')
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isInteger(item) && item > 0)
    )].sort((a, b) => a - b);
};

const formatOrderMilestones = (value) => parseOrderMilestonesInput(value).join(', ');

const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        return 'N/A';
    }
    return format(date, "dd MMM yyyy");
};

const normalizeFreeItemReward = (reward = null) => {
    if (!reward) return null;
    const source = String(reward.source || (reward.isCustom ? 'custom' : 'menu')).trim().toLowerCase();
    const itemId = String(reward.itemId || '').trim();
    const itemName = String(reward.itemName || '').trim();
    const portionName = String(reward.portionName || '').trim();
    if (source === 'custom') {
        if (!itemName) return null;
        return {
            source: 'custom',
            itemId: itemId || '',
            itemName,
            categoryId: String(reward.categoryId || 'custom-reward').trim(),
            portionName,
            quantity: Math.max(1, Number(reward.quantity) || 1),
        };
    }
    if (!itemId) return null;
    return {
        source: 'menu',
        itemId,
        itemName,
        categoryId: String(reward.categoryId || '').trim(),
        portionName,
        quantity: Math.max(1, Number(reward.quantity) || 1),
    };
};

const formatCouponHeadline = (coupon = {}) => {
    const freeItemReward = normalizeFreeItemReward(coupon.freeItemReward);
    const parts = [];

    if (coupon.type === 'free_delivery') {
        parts.push('Free Delivery');
    } else if (coupon.type === 'flat') {
        parts.push(`₹${coupon.value} OFF`);
    } else if (coupon.type === 'percentage') {
        parts.push(`${coupon.value}% OFF`);
    } else if (coupon.type === 'free_item') {
        parts.push('Free Dish');
    }

    if (freeItemReward) {
        const rewardLabel = `${freeItemReward.quantity > 1 ? `${freeItemReward.quantity}x ` : ''}${freeItemReward.itemName || 'Free Item'}`;
        if (coupon.type === 'free_item') {
            return rewardLabel;
        }
        parts.push(`+ ${rewardLabel}`);
    }

    return parts.join(' ') || 'Offer';
};

const CouponModal = ({ isOpen, setIsOpen, onSave, editingCoupon, rewardMenuItems = [] }) => {
    const [coupon, setCoupon] = useState(null);
    const [isStartDatePickerOpen, setStartDatePickerOpen] = useState(false);
    const [isEndDatePickerOpen, setEndDatePickerOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState('');
    const [isCustomRewardDialogOpen, setIsCustomRewardDialogOpen] = useState(false);
    const [customRewardDraft, setCustomRewardDraft] = useState({ itemName: '', portionName: '' });

    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setModalError('');
            setIsCustomRewardDialogOpen(false);
            setCustomRewardDraft({ itemName: '', portionName: '' });
            if (editingCoupon) {
                setCoupon({
                    ...editingCoupon
                });
            } else {
                setCoupon({
                    id: null, code: '', description: '', type: 'flat', value: '',
                    maxDiscount: '',
                    minOrder: '', startDate: new Date(), expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                    status: 'active', timesUsed: 0, customerId: null, singleUsePerCustomer: false, orderMilestones: '',
                    freeItemReward: null,
                });
            }
        }
    }, [isOpen, editingCoupon]);

    const handleChange = (field, value) => {
        const newCoupon = { ...coupon, [field]: value };

        if (field === 'type') {
            const hasFreeRewardSelected = Boolean(normalizeFreeItemReward(newCoupon.freeItemReward));
            if (hasFreeRewardSelected && value !== 'free_item') {
                newCoupon.type = 'free_item';
            } else {
                newCoupon.type = value;
            }
            if (newCoupon.type === 'free_delivery' || newCoupon.type === 'free_item') {
                newCoupon.value = 0;
                newCoupon.maxDiscount = '';
            }
        }

        if (field === 'freeItemReward') {
            newCoupon.freeItemReward = normalizeFreeItemReward(value);
            if (newCoupon.freeItemReward) {
                newCoupon.type = 'free_item';
                newCoupon.value = 0;
                newCoupon.maxDiscount = '';
            }
        }

        setCoupon(newCoupon);
    };

    const selectedRewardItem = useMemo(() => (
        rewardMenuItems.find((item) => item.id === coupon?.freeItemReward?.itemId) || null
    ), [coupon?.freeItemReward?.itemId, rewardMenuItems]);

    const selectedRewardPortions = Array.isArray(selectedRewardItem?.portions) ? selectedRewardItem.portions : [];
    const isRewardLockedToFreeDish = Boolean(normalizeFreeItemReward(coupon?.freeItemReward));

    const handleRewardItemSelection = (itemId) => {
        if (itemId === '__custom__') {
            setCustomRewardDraft({
                itemName: String(coupon?.freeItemReward?.source === 'custom' ? coupon?.freeItemReward?.itemName || '' : '').trim(),
                portionName: String(coupon?.freeItemReward?.source === 'custom' ? coupon?.freeItemReward?.portionName || '' : '').trim(),
            });
            setIsCustomRewardDialogOpen(true);
            return;
        }

        const nextItem = rewardMenuItems.find((item) => item.id === itemId) || null;
        if (!nextItem) {
            handleChange('freeItemReward', null);
            return;
        }

        const defaultPortion = Array.isArray(nextItem.portions) && nextItem.portions.length > 0
            ? nextItem.portions[0]
            : null;

        handleChange('freeItemReward', {
            source: 'menu',
            itemId: nextItem.id,
            itemName: nextItem.name,
            categoryId: nextItem.categoryId,
            portionName: defaultPortion?.name || '',
            quantity: Math.max(1, Number(coupon?.freeItemReward?.quantity) || 1),
        });
    };

    const handleSaveCustomReward = () => {
        const itemName = String(customRewardDraft.itemName || '').trim();
        const portionName = String(customRewardDraft.portionName || '').trim();
        if (!itemName) {
            setModalError('Custom reward item name is required.');
            return;
        }

        setModalError('');
        handleChange('freeItemReward', {
            source: 'custom',
            itemId: '',
            itemName,
            categoryId: 'custom-reward',
            portionName,
            quantity: Math.max(1, Number(coupon?.freeItemReward?.quantity) || 1),
        });
        setIsCustomRewardDialogOpen(false);
    };

    const generateRandomCode = () => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setModalError('');

        let requiredFieldsMet = coupon.code && coupon.minOrder !== '';
        if (!['free_delivery', 'free_item'].includes(coupon.type)) {
            requiredFieldsMet = requiredFieldsMet && coupon.value !== '';
        }
        if (coupon.type === 'free_item' && !normalizeFreeItemReward(coupon.freeItemReward)) {
            requiredFieldsMet = false;
        }

        if (!requiredFieldsMet) {
            setModalError('Please fill all required fields: code, minimum order, discount value when needed, and free reward item when selected.');
            return;
        }

        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            setModalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!coupon) return null;

    const minimumOrderValue = Number(coupon.minOrder) || 0;
    const rewardValue = Number(coupon.value) || 0;
    const maxDiscountValue = Number(coupon.maxDiscount) || 0;
    const freeItemReward = normalizeFreeItemReward(coupon.freeItemReward);
    const sampleOrderValue = Math.max(minimumOrderValue || 500, 500);
    const percentagePreviewDiscount = Math.round((sampleOrderValue * rewardValue) / 100);
    const effectivePercentageDiscount = maxDiscountValue > 0
        ? Math.min(percentagePreviewDiscount, maxDiscountValue)
        : percentagePreviewDiscount;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto bg-card border-border text-card-foreground">
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
                                    <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-input border-border w-full" />
                                    <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2" /> Generate</Button>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="description">Description</Label>
                                <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={3} placeholder="e.g., Get 20% off on your first order" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                            <div>
                                <Label htmlFor="orderMilestones">Eligible Order Numbers</Label>
                                <input
                                    id="orderMilestones"
                                    value={Array.isArray(coupon.orderMilestones) ? coupon.orderMilestones.join(', ') : (coupon.orderMilestones || '')}
                                    onChange={e => handleChange('orderMilestones', e.target.value)}
                                    placeholder="e.g., 2, 5"
                                    className="mt-1 p-2 border rounded-md bg-input border-border w-full"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Leave blank for all orders. Example: `2,5` means only the 2nd and 5th order.
                                </p>
                            </div>
                            <div>
                                <Label>Discount Type</Label>
                                <div className="grid grid-cols-4 gap-2 mt-2">
                                    <div
                                        onClick={() => !isRewardLockedToFreeDish && handleChange('type', 'flat')}
                                        className={cn('p-3 border-2 rounded-lg flex items-center justify-center gap-2 text-sm', coupon.type === 'flat' ? 'border-primary bg-primary/10' : 'border-border', isRewardLockedToFreeDish ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}
                                    >
                                        <IndianRupee size={16} /> Flat Amount
                                    </div>
                                    <div
                                        onClick={() => !isRewardLockedToFreeDish && handleChange('type', 'percentage')}
                                        className={cn('p-3 border-2 rounded-lg flex items-center justify-center gap-2 text-sm', coupon.type === 'percentage' ? 'border-primary bg-primary/10' : 'border-border', isRewardLockedToFreeDish ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}
                                    >
                                        <Percent size={16} /> Percentage
                                    </div>
                                    <div
                                        onClick={() => !isRewardLockedToFreeDish && handleChange('type', 'free_delivery')}
                                        className={cn('p-3 border-2 rounded-lg flex items-center justify-center gap-2 text-sm', coupon.type === 'free_delivery' ? 'border-primary bg-primary/10' : 'border-border', isRewardLockedToFreeDish ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}
                                    >
                                        <Truck size={16} /> Free Delivery
                                    </div>
                                    <div onClick={() => handleChange('type', 'free_item')} className={cn('p-3 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-2 text-sm', coupon.type === 'free_item' ? 'border-primary bg-primary/10' : 'border-border')}>
                                        <Ticket size={16} /> Free Dish
                                    </div>
                                </div>
                                {isRewardLockedToFreeDish && (
                                    <p className="text-xs text-amber-600 mt-2">
                                        Free reward selected, so this coupon is locked to Free Dish only.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <Label className="text-sm font-semibold">Free Dish Reward</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Attach one complimentary reward item to this coupon. Once selected, this coupon becomes a Free Dish offer only.
                                        </p>
                                    </div>
                                    <Switch
                                        checked={Boolean(freeItemReward)}
                                        onCheckedChange={(checked) => {
                                            if (!checked) {
                                                handleChange('freeItemReward', null);
                                                return;
                                            }
                                            if (rewardMenuItems[0]?.id) {
                                                handleRewardItemSelection(rewardMenuItems[0].id);
                                            } else {
                                                handleRewardItemSelection('__custom__');
                                            }
                                        }}
                                    />
                                </div>

                                {freeItemReward && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="space-y-1 md:col-span-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <Label htmlFor="reward-item">Reward Item</Label>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8"
                                                    onClick={() => handleRewardItemSelection('__custom__')}
                                                >
                                                    Custom Item
                                                </Button>
                                            </div>
                                            <select
                                                id="reward-item"
                                                value={freeItemReward.source === 'custom' ? '__custom__' : freeItemReward.itemId}
                                                onChange={(e) => handleRewardItemSelection(e.target.value)}
                                                className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                                            >
                                                <option value="">Select menu item</option>
                                                <option value="__custom__">Custom item (not in menu)</option>
                                                {rewardMenuItems.map((item) => (
                                                    <option key={item.id} value={item.id}>
                                                        {item.name} ({item.categoryId})
                                                    </option>
                                                ))}
                                            </select>
                                            {freeItemReward.source === 'custom' && (
                                                <p className="text-xs text-muted-foreground">
                                                    Custom reward: {freeItemReward.itemName}{freeItemReward.portionName ? ` • ${freeItemReward.portionName}` : ''}
                                                </p>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="reward-qty">Reward Qty</Label>
                                            <input
                                                id="reward-qty"
                                                type="number"
                                                min="1"
                                                value={freeItemReward.quantity}
                                                onChange={(e) => handleChange('freeItemReward', {
                                                    ...freeItemReward,
                                                    quantity: Math.max(1, Number(e.target.value) || 1),
                                                })}
                                                className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                                            />
                                        </div>
                                        {selectedRewardPortions.length > 0 && freeItemReward.source !== 'custom' && (
                                            <div className="space-y-1 md:col-span-3">
                                                <Label htmlFor="reward-portion">Reward Portion</Label>
                                                <select
                                                    id="reward-portion"
                                                    value={freeItemReward.portionName || selectedRewardPortions[0]?.name || ''}
                                                    onChange={(e) => handleChange('freeItemReward', {
                                                        ...freeItemReward,
                                                        portionName: e.target.value,
                                                    })}
                                                    className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                                                >
                                                    {selectedRewardPortions.map((portion) => (
                                                        <option key={portion.name} value={portion.name}>
                                                            {portion.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {coupon.type === 'percentage' && (
                                <div>
                                    <Label htmlFor="maxDiscount">Maximum Discount Cap (Rs)</Label>
                                    <input
                                        id="maxDiscount"
                                        type="number"
                                        value={coupon.maxDiscount || ''}
                                        onChange={e => handleChange('maxDiscount', e.target.value)}
                                        placeholder="e.g., 150"
                                        className="mt-1 p-2 border rounded-md bg-input border-border w-full"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Example: 20% off up to Rs 150. Leave blank for no cap.
                                    </p>
                                </div>
                            )}
                            <div>
                                <Label>Customer Usage Rule</Label>
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div onClick={() => handleChange('singleUsePerCustomer', true)} className={cn('p-3 border-2 rounded-lg cursor-pointer text-sm text-center', coupon.singleUsePerCustomer ? 'border-primary bg-primary/10' : 'border-border')}>
                                        One time per customer
                                    </div>
                                    <div onClick={() => handleChange('singleUsePerCustomer', false)} className={cn('p-3 border-2 rounded-lg cursor-pointer text-sm text-center', coupon.singleUsePerCustomer === false ? 'border-primary bg-primary/10' : 'border-border')}>
                                        Multiple times allowed
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    Choose whether the same customer can redeem this coupon only once or multiple times.
                                </p>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/40 p-3">
                                <p className="text-sm font-medium">How this coupon will work</p>
                                {coupon.type === 'free_item' ? (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Customer unlocks {freeItemReward?.quantity || 1} free {freeItemReward?.itemName || 'menu item'} on eligible orders.
                                    </p>
                                ) : coupon.type === 'free_delivery' ? (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Customer gets free delivery on orders of Rs {minimumOrderValue || 0} and above.
                                    </p>
                                ) : coupon.type === 'flat' ? (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Customer gets Rs {rewardValue || 0} off when order is Rs {minimumOrderValue || 0} or above.
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Customer gets {rewardValue || 0}% off on orders of Rs {minimumOrderValue || 0} or above.
                                            {maxDiscountValue > 0 ? ` Maximum discount Rs ${maxDiscountValue}.` : ' No maximum cap set.'}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            Example: on a Rs {sampleOrderValue} order, discount will be about Rs {effectivePercentageDiscount || 0}.
                                        </p>
                                    </>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="value">Discount Value</Label>
                                    <input
                                        id="value"
                                        type="number"
                                        value={coupon.value}
                                        onChange={e => handleChange('value', e.target.value)}
                                        placeholder={coupon.type === 'flat' ? 'e.g., 100' : 'e.g., 20'}
                                        disabled={coupon.type === 'free_delivery' || coupon.type === 'free_item'}
                                        className="mt-1 p-2 border rounded-md bg-input border-border w-full disabled:opacity-50 disabled:cursor-not-allowed" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {coupon.type === 'flat'
                                            ? 'Customer gets this exact amount off.'
                                            : coupon.type === 'percentage'
                                                ? 'For example, 20 means 20% off.'
                                                : coupon.type === 'free_item'
                                                    ? 'Free item coupons automatically keep discount value at 0.'
                                                    : 'Free delivery coupons automatically keep discount value at 0.'}
                                    </p>
                                </div>
                                <div>
                                    <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                    <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        This coupon applies only when the order total is Rs {minimumOrderValue || 0} or higher.
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Start Date</Label>
                                    <Popover open={isStartDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.startDate && "text-muted-foreground")}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {coupon.startDate ? formatDate(coupon.startDate) : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(coupon.startDate)} onSelect={(date) => { handleChange('startDate', date); setStartDatePickerOpen(false); }} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                                <div>
                                    <Label>Expiry Date</Label>
                                    <Popover open={isEndDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {coupon.expiryDate ? formatDate(coupon.expiryDate) : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(coupon.expiryDate)} onSelect={(date) => { handleChange('expiryDate', date); setEndDatePickerOpen(false); }} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                            <div>
                                <Label>Status</Label>
                                <div className="flex items-center gap-4 mt-2 bg-input p-3 rounded-md">
                                    <Switch id="status" checked={coupon.status === 'active'} onCheckedChange={(checked) => handleChange('status', checked ? 'active' : 'inactive')} />
                                    <Label htmlFor="status" className={cn(coupon.status === 'active' ? 'text-green-400' : 'text-muted-foreground')}>
                                        {coupon.status === 'active' ? 'Coupon is Active' : 'Coupon is Inactive'}
                                    </Label>
                                </div>
                            </div>
                        </div>
                    </div>
                    {modalError && <p className="text-destructive text-center text-sm mt-4">{modalError}</p>}
                    <DialogFooter className="pt-6">
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                            {isSaving ? 'Saving...' : (editingCoupon ? 'Save Changes' : 'Create Coupon')}
                        </Button>
                    </DialogFooter>
                </form>
                {isCustomRewardDialogOpen && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold">Add Custom Reward Item</h3>
                                <p className="text-sm text-muted-foreground">
                                    Enter the free item name and optional portion label like Half, Full, 500 ml, Large, or Medium.
                                </p>
                            </div>
                            <div className="space-y-4 py-4">
                                <div>
                                    <Label htmlFor="custom-reward-name">Item Name</Label>
                                    <input
                                        id="custom-reward-name"
                                        value={customRewardDraft.itemName}
                                        onChange={(e) => setCustomRewardDraft((prev) => ({ ...prev, itemName: e.target.value }))}
                                        placeholder="e.g., Cold Drink"
                                        className="mt-1 p-2 border rounded-md bg-input border-border w-full"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="custom-reward-portion">Portion / Size</Label>
                                    <input
                                        id="custom-reward-portion"
                                        value={customRewardDraft.portionName}
                                        onChange={(e) => setCustomRewardDraft((prev) => ({ ...prev, portionName: e.target.value }))}
                                        placeholder="e.g., 500 ml, Full, Large"
                                        className="mt-1 p-2 border rounded-md bg-input border-border w-full"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
                                <Button type="button" variant="secondary" onClick={() => setIsCustomRewardDialogOpen(false)}>Cancel</Button>
                                <Button type="button" onClick={handleSaveCustomReward}>Use Custom Item</Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

const CouponCard = ({ coupon, onStatusToggle, onEdit, onDelete }) => {
    const expiryDate = new Date(coupon.expiryDate);
    const isExpired = expiryDate < new Date();
    const status = isExpired ? 'Expired' : coupon.status;
    const orderMilestoneLabel = formatOrderMilestones(coupon.orderMilestones);

    const statusConfig = {
        'active': { text: 'text-green-400', bg: 'bg-green-500/10', icon: <CheckCircle />, label: 'Active' },
        'inactive': { text: 'text-gray-400', bg: 'bg-muted', icon: <XCircle />, label: 'Inactive' },
        'Expired': { text: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle />, label: 'Expired' },
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-card border border-border rounded-xl flex flex-col overflow-hidden shadow-lg hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300"
        >
            <div className="p-5 bg-card">
                <div className="flex justify-between items-start">
                    <p className="font-mono text-2xl font-bold tracking-widest text-foreground bg-muted px-4 py-2 rounded-lg border-2 border-dashed border-border">{coupon.code}</p>
                    <div className={cn('flex items-center gap-2 text-sm font-semibold px-3 py-1 rounded-full', statusConfig[status]?.bg, statusConfig[status]?.text)}>
                        {statusConfig[status]?.icon}
                        {statusConfig[status]?.label || status}
                    </div>
                </div>
                <p className="text-3xl font-bold text-primary mt-4">
                    {formatCouponHeadline(coupon)}
                </p>
            </div>

            <div className="p-5 flex-grow">
                <p className="text-sm text-muted-foreground mb-4">{coupon.description}</p>
                <div className="text-sm space-y-2">
                    <p><span className="font-semibold text-muted-foreground">Min. Order:</span> ₹{coupon.minOrder}</p>
                    <p><span className="font-semibold text-muted-foreground">Eligible Orders:</span> {orderMilestoneLabel || 'All orders'}</p>
                    <p><span className="font-semibold text-muted-foreground">Expires:</span> {formatDate(expiryDate)}</p>
                    <p><span className="font-semibold text-muted-foreground">Times Used:</span> {coupon.timesUsed}</p>
                    <p><span className="font-semibold text-muted-foreground">Usage Rule:</span> {coupon.singleUsePerCustomer ? 'One time per customer' : 'Multiple times allowed'}</p>
                    {normalizeFreeItemReward(coupon.freeItemReward) && (
                        <p>
                            <span className="font-semibold text-muted-foreground">Free Reward:</span> {coupon.freeItemReward.quantity || 1}x {coupon.freeItemReward.itemName}
                        </p>
                    )}
                </div>
            </div>

            <div className="p-4 bg-muted/30 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Switch
                        checked={coupon.status === 'active' && !isExpired}
                        onCheckedChange={(checked) => onStatusToggle(coupon, checked ? 'active' : 'inactive')}
                        disabled={status === 'Expired'}
                        id={`switch-${coupon.id}`}
                    />
                    <Label htmlFor={`switch-${coupon.id}`} className="text-sm text-muted-foreground">
                        {status === 'Expired' ? 'Expired' : (coupon.status === 'active' ? 'Active' : 'Inactive')}
                    </Label>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(coupon)}><Edit size={16} /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80 hover:bg-destructive/10" onClick={() => onDelete(coupon.id)}><Trash2 size={16} /></Button>
                </div>
            </div>
        </motion.div>
    );
};

export default function CouponsPage() {
    const [coupons, setCoupons] = useState([]);
    const [rewardMenuItems, setRewardMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState(null);
    const [filter, setFilter] = useState('All');
    const [sort, setSort] = useState('expiryDate-asc');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const handleApiCall = async (method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL('/api/owner/coupons', window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }

        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: body ? JSON.stringify(body) : undefined,
        });

        // Check if response has content
        const text = await res.text();
        console.log('[API CALL] Response status:', res.status, 'text length:', text.length);

        if (!text) {
            throw new Error('Empty response from server');
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            console.error('[API CALL] JSON parse error. Response text:', text);
            throw new Error('Invalid response from server: ' + parseError.message);
        }

        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }

    const fetchCoupons = async () => {
        setLoading(true);
        try {
            const data = await handleApiCall('GET');
            console.log('[COUPON FETCH] Raw API response:', data);
            console.log('[COUPON FETCH] Number of coupons:', data.coupons?.length || 0);

            const processedCoupons = (data.coupons || []).map((c, index) => {
                console.log(`[COUPON FETCH] Processing coupon ${index}:`, c);
                console.log(`[COUPON FETCH] Coupon ${index} startDate raw:`, c.startDate);
                console.log(`[COUPON FETCH] Coupon ${index} expiryDate raw:`, c.expiryDate);

                const processed = {
                    ...c,
                    startDate: c.startDate ? (
                        c.startDate._seconds ? new Date(c.startDate._seconds * 1000) :
                            c.startDate.seconds ? new Date(c.startDate.seconds * 1000) :
                                new Date(c.startDate)
                    ) : new Date(),
                    expiryDate: c.expiryDate ? (
                        c.expiryDate._seconds ? new Date(c.expiryDate._seconds * 1000) :
                            c.expiryDate.seconds ? new Date(c.expiryDate.seconds * 1000) :
                                new Date(c.expiryDate)
                    ) : new Date()
                };

                console.log(`[COUPON FETCH] Coupon ${index} startDate processed:`, processed.startDate);
                console.log(`[COUPON FETCH] Coupon ${index} expiryDate processed:`, processed.expiryDate);
                return processed;
            });

            console.log('[COUPON FETCH] Final processed coupons:', processedCoupons);
            setCoupons(processedCoupons);
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not load coupons: " + error.message });
        } finally {
            setLoading(false);
        }
    };

    const fetchRewardMenuItems = async () => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const url = new URL('/api/owner/menu', window.location.origin);
            url.searchParams.set('compact', '1');
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            } else if (employeeOfOwnerId) {
                url.searchParams.append('employee_of', employeeOfOwnerId);
            }

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to load menu items');

            const flattened = Object.values(data.menu || {})
                .flatMap((categoryItems) => (Array.isArray(categoryItems) ? categoryItems : []))
                .filter((item) => item && item.id && item.isAvailable !== false)
                .map((item) => ({
                    id: item.id,
                    name: String(item.name || 'Unnamed Item'),
                    categoryId: String(item.categoryId || 'general'),
                    portions: Array.isArray(item.portions) ? item.portions : [],
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            setRewardMenuItems(flattened);
        } catch (error) {
            console.error('[COUPON MENU FETCH]', error);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchCoupons();
                fetchRewardMenuItems();
            }
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const handleSaveCoupon = async (couponData) => {
        try {
            console.log('[COUPON SAVE] Original coupon data:', couponData);
            console.log('[COUPON SAVE] Start Date:', couponData.startDate);
            console.log('[COUPON SAVE] Expiry Date:', couponData.expiryDate);

            const isEditing = !!couponData.id;
            const payload = {
                ...couponData,
                orderMilestones: parseOrderMilestonesInput(couponData.orderMilestones),
                startDate: couponData.startDate.toISOString(),
                expiryDate: couponData.expiryDate.toISOString(),
            };

            console.log('[COUPON SAVE] Payload being sent to API:', payload);
            console.log('[COUPON SAVE] Start Date ISO:', payload.startDate);
            console.log('[COUPON SAVE] Expiry Date ISO:', payload.expiryDate);

            const data = await handleApiCall(isEditing ? 'PATCH' : 'POST', { coupon: payload });
            console.log('[COUPON SAVE] API Response:', data);
            setInfoDialog({ isOpen: true, title: "Success", message: data.message });
            await fetchCoupons();
        } catch (error) {
            console.error("Error saving coupon:", error);
            throw new Error(`Error saving coupon: ${error.message}`);
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
        if (window.confirm('Are you sure you want to delete this coupon? This action cannot be undone.')) {
            try {
                const data = await handleApiCall('DELETE', { couponId: id });
                setInfoDialog({ isOpen: true, title: "Success", message: data.message });
                await fetchCoupons();
            } catch (error) {
                setInfoDialog({ isOpen: true, title: "Error", message: `Error deleting coupon: ${error.message}` });
            }
        }
    };

    const handleStatusToggle = async (coupon, newStatus) => {
        try {
            await handleApiCall('PATCH', { coupon: { id: coupon.id, status: newStatus } });
            setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, status: newStatus } : c));
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
            await fetchCoupons();
        }
    };

    const filteredAndSortedCoupons = useMemo(() => {
        let items = [...coupons].map(c => {
            const expiryDate = new Date(c.expiryDate);
            return { ...c, isExpired: expiryDate < new Date() };
        });

        if (filter !== 'All') {
            items = items.filter(c => (c.isExpired ? 'Expired' : c.status) === filter);
        }

        const [sortKey, sortDir] = sort.split('-');
        items.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (sortKey.includes('Date')) {
                valA = new Date(a[sortKey]);
                valB = new Date(b[sortKey]);
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [coupons, filter, sort]);


    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <CouponModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} onSave={handleSaveCoupon} editingCoupon={editingCoupon} rewardMenuItems={rewardMenuItems} />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Coupon & Offer Hub</h1>
                    <p className="text-muted-foreground mt-1">Create, manage, and track your promotional offers.</p>
                </div>
                <Button onClick={handleCreateNew} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    <PlusCircle size={20} className="mr-2" /> Create New Coupon
                </Button>
            </div>

            <div className="flex flex-col md:flex-row justify-end items-center gap-4 mb-6 p-4 bg-card rounded-xl border border-border">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-muted-foreground" />
                    <Label htmlFor="filter-status">Filter by Status:</Label>
                    <select id="filter-status" value={filter} onChange={e => setFilter(e.target.value)} className="p-2 text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary">
                        <option value="All">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="Expired">Expired</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <ArrowDownUp size={16} className="text-muted-foreground" />
                    <Label htmlFor="sort-by">Sort by:</Label>
                    <select id="sort-by" value={sort} onChange={e => setSort(e.target.value)} className="p-2 text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary">
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
                        <div key={i} className="bg-card border border-border rounded-xl h-80"></div>
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
                <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg font-semibold">No coupons found.</p>
                    <p>Try adjusting your filters or create a new coupon!</p>
                </div>
            )}
        </div>
    );
}
