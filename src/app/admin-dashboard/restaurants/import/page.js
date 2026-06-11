'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, ShieldCheck, Sparkles, Copy, Check, ArrowLeft, Utensils } from 'lucide-react';
import { getBestEffortIdToken } from '@/lib/client-session';
import { useUser } from '@/firebase';

export default function AdminOnboardPage() {
    const router = useRouter();
    const { user } = useUser();

    // Outlet Details
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [addressText, setAddressText] = useState('');
    const [city, setCity] = useState('');
    const [lat, setLat] = useState('');
    const [lng, setLng] = useState('');
    const [businessType, setBusinessType] = useState('restaurant');

    // Menu Items
    const [menuItems, setMenuItems] = useState([
        { name: '', description: '', price: '', isVeg: true, categoryId: 'general' }
    ]);

    // UI States
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [claimDetails, setClaimDetails] = useState(null);
    const [copied, setCopied] = useState(false);

    const handleAddMenuItem = () => {
        setMenuItems([...menuItems, { name: '', description: '', price: '', isVeg: true, categoryId: 'general' }]);
    };

    const handleRemoveMenuItem = (index) => {
        if (menuItems.length <= 1) return;
        const updated = [...menuItems];
        updated.splice(index, 1);
        setMenuItems(updated);
    };

    const handleMenuItemChange = (index, field, value) => {
        const updated = [...menuItems];
        updated[index][field] = value;
        setMenuItems(updated);
    };

    const copyToken = () => {
        if (!claimDetails?.claimToken) return;
        navigator.clipboard.writeText(claimDetails.claimToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        setError(null);

        // Validations
        if (!name.trim()) return setError('Restaurant Name is required.');
        if (!phone.trim()) return setError('Phone Number is required.');
        if (!addressText.trim()) return setError('Address Text is required.');
        if (!lat || isNaN(parseFloat(lat))) return setError('Valid Latitude is required.');
        if (!lng || isNaN(parseFloat(lng))) return setError('Valid Longitude is required.');

        // Validate menu items
        const cleanedMenu = [];
        for (let i = 0; i < menuItems.length; i++) {
            const item = menuItems[i];
            if (!item.name.trim()) return setError(`Menu Item ${i + 1} Name is required.`);
            const priceNum = parseFloat(item.price);
            if (isNaN(priceNum) || priceNum < 0) return setError(`Menu Item ${i + 1} Price must be a positive number.`);

            cleanedMenu.push({
                name: item.name.trim(),
                description: item.description.trim(),
                price: priceNum,
                isVeg: item.isVeg === true,
                categoryId: item.categoryId.trim() || 'general'
            });
        }

        setLoading(true);
        try {
            const idToken = await getBestEffortIdToken(user);

            const response = await fetch('/api/admin/onboard-restaurant', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    name: name.trim(),
                    phone: phone.trim(),
                    addressText: addressText.trim(),
                    city: city.trim(),
                    coordinates: {
                        lat: parseFloat(lat),
                        lng: parseFloat(lng)
                    },
                    businessType,
                    menu: cleanedMenu
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.message || 'Onboarding failed.');
            }

            setClaimDetails(data);
            setSuccess(true);
        } catch (err) {
            console.error('[Onboard] Error:', err);
            setError(err.message || 'An error occurred during onboarding.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="p-6 max-w-2xl mx-auto">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-xl">
                    <div className="h-16 w-16 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldCheck className="h-8 w-8" />
                    </div>

                    <h2 className="text-2xl font-black text-slate-100 mb-2 font-headline">
                        Onboard Success!
                    </h2>
                    <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
                        Restaurant profile and catalog created. Share this 6-digit claim token with the owner to verify ownership.
                    </p>

                    {/* Claim Token Card */}
                    <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800 max-w-sm mx-auto mb-8">
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider block mb-2">Claim Token</span>
                        <div className="flex items-center justify-center gap-3">
                            <span className="text-3xl font-black tracking-widest text-emerald-400 font-mono">
                                {claimDetails?.claimToken}
                            </span>
                            <button
                                onClick={copyToken}
                                className="p-2 bg-slate-900 border border-slate-700 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-all"
                                title="Copy Token"
                            >
                                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-4 justify-center">
                        <button
                            onClick={() => {
                                setSuccess(false);
                                setClaimDetails(null);
                                // reset form
                                setName('');
                                setPhone('');
                                setAddressText('');
                                setCity('');
                                setLat('');
                                setLng('');
                                setMenuItems([{ name: '', description: '', price: '', isVeg: true, categoryId: 'general' }]);
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold py-2.5 px-6 rounded-full transition-all"
                        >
                            Onboard Another
                        </button>
                        <button
                            onClick={() => router.push('/admin-dashboard/restaurants')}
                            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-sm font-black py-2.5 px-6 rounded-full transition-all"
                        >
                            Back to Listings
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto text-slate-100">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <button
                    onClick={() => router.back()}
                    className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-850 rounded-lg text-slate-400"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-2xl font-black font-headline text-slate-100 leading-tight">
                        Onboard Unclaimed Store
                    </h1>
                    <p className="text-xs text-slate-400">
                        Create shadow profiles for restaurants, shops, and vendors to bootstrap directory content.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left side: Restaurant details */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-sm h-fit">
                    <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                        <Utensils className="h-4 w-4" /> Outlet Profile
                    </h2>

                    <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">Outlet Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Chai Point"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">Scraped Phone Number</label>
                        <input
                            type="tel"
                            placeholder="e.g. 919027872803"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">Business Type</label>
                        <select
                            value={businessType}
                            onChange={(e) => setBusinessType(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 text-sm focus:outline-none"
                        >
                            <option value="restaurant">Restaurant / Eatery</option>
                            <option value="shop">Store / Shop</option>
                            <option value="street-vendor">Street Food Vendor</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">Address Details (Street)</label>
                        <input
                            type="text"
                            placeholder="e.g. Sector 62, Noida"
                            value={addressText}
                            onChange={(e) => setAddressText(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[11px] font-bold text-slate-400 block mb-1">Latitude</label>
                            <input
                                type="text"
                                placeholder="e.g. 28.6289"
                                value={lat}
                                onChange={(e) => setLat(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-400 block mb-1">Longitude</label>
                            <input
                                type="text"
                                placeholder="e.g. 77.3821"
                                value={lng}
                                onChange={(e) => setLng(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">City (Optional)</label>
                        <input
                            type="text"
                            placeholder="e.g. Noida"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-sm focus:outline-none"
                        />
                    </div>
                </div>

                {/* Right side: Catalog Items details */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                                <Sparkles className="h-4 w-4" /> Menu Catalog
                            </h2>
                            <button
                                type="button"
                                onClick={handleAddMenuItem}
                                className="bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold py-1 px-3 rounded-full flex items-center gap-1 transition-all"
                            >
                                <Plus className="h-3 w-3" /> Add Item
                            </button>
                        </div>

                        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                            {menuItems.map((item, index) => (
                                <div key={index} className="bg-slate-950 border border-slate-850 p-3 rounded-2xl space-y-2 relative">
                                    {menuItems.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveMenuItem(index)}
                                            className="absolute top-2 right-2 text-slate-600 hover:text-red-400"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}

                                    <div className="grid grid-cols-2 gap-2 pr-6">
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-500 block mb-0.5">Item Name</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Butter Toast"
                                                value={item.name}
                                                onChange={(e) => handleMenuItemChange(index, 'name', e.target.value)}
                                                className="w-full bg-slate-900 border border-slate-800 rounded-lg py-1 px-2 text-slate-100 placeholder-slate-600 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-500 block mb-0.5">Price (₹)</label>
                                            <input
                                                type="number"
                                                placeholder="e.g. 50"
                                                value={item.price}
                                                onChange={(e) => handleMenuItemChange(index, 'price', e.target.value)}
                                                className="w-full bg-slate-900 border border-slate-800 rounded-lg py-1 px-2 text-slate-100 placeholder-slate-600 text-xs"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-500 block mb-0.5">Description (Opt)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Toasted slices"
                                                value={item.description}
                                                onChange={(e) => handleMenuItemChange(index, 'description', e.target.value)}
                                                className="w-full bg-slate-900 border border-slate-800 rounded-lg py-1 px-2 text-slate-100 placeholder-slate-600 text-xs"
                                            />
                                        </div>
                                        <div className="flex items-center gap-3 pt-2">
                                            <label className="text-[9px] font-bold text-slate-500 flex items-center gap-1.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={item.isVeg}
                                                    onChange={(e) => handleMenuItemChange(index, 'isVeg', e.target.checked)}
                                                    className="rounded border-slate-800 text-emerald-500 bg-slate-900 focus:ring-0 cursor-pointer"
                                                />
                                                Veg Only
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800">
                        {error && (
                            <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-xs text-red-400 mb-3">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 disabled:opacity-50 text-slate-950 font-black py-3 px-6 rounded-full transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-5 w-5 animate-spin" /> Onboarding...
                                </>
                            ) : (
                                <>
                                    Publish Unclaimed Profile
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
