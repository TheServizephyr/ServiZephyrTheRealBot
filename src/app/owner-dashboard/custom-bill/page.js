"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import BillToPrint from '@/components/BillToPrint';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent } from "@/components/ui/dialog";

export const dynamic = 'force-dynamic';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function CustomBillPage() {
    const [menu, setMenu] = useState({});
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restaurant, setRestaurant] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const billPrintRef = useRef();

    const [customerDetails, setCustomerDetails] = useState({
        name: '',
        phone: '',
        address: ''
    });
    
    // State to control modal visibility
    const [isBillModalOpen, setIsBillModalOpen] = useState(false);

    // useReactToPrint hook setup
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
        onAfterPrint: () => setIsBillModalOpen(false), // Close modal after printing
    });

    useEffect(() => {
        const fetchMenuAndSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("Authentication required.");
                const idToken = await user.getIdToken();
                
                let menuUrl = `/api/owner/menu?impersonate_owner_id=${impersonatedOwnerId || ''}`;
                let settingsUrl = `/api/owner/settings?impersonate_owner_id=${impersonatedOwnerId || ''}`;
                
                const [menuRes, settingsRes] = await Promise.all([
                    fetch(menuUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }),
                    fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } })
                ]);
                
                if (!menuRes.ok || !settingsRes.ok) throw new Error('Failed to fetch data.');

                const menuData = await menuRes.json();
                const settingsData = await settingsRes.json();

                setMenu(menuData.menu || {});
                setRestaurant({
                    name: settingsData.restaurantName,
                    address: settingsData.address,
                    gstin: settingsData.gstin
                });

            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load menu: ${error.message}` });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchMenuAndSettings();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [impersonatedOwnerId]);

    const addToCart = (item, portion) => {
        const cartItemId = `${item.id}-${portion.name}`;
        const existingItem = cart.find(i => i.cartItemId === cartItemId);
        if (existingItem) {
            setCart(cart.map(i => i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1, totalPrice: (i.totalPrice / i.quantity) * (i.quantity + 1) } : i));
        } else {
            setCart([...cart, { ...item, portion, quantity: 1, cartItemId, price: portion.price, totalPrice: portion.price }]);
        }
    };

    const updateQuantity = (cartItemId, change) => {
        setCart(currentCart => {
            const itemIndex = currentCart.findIndex(i => i.cartItemId === cartItemId);
            if (itemIndex === -1) return currentCart;

            const newCart = [...currentCart];
            const item = newCart[itemIndex];
            
            const newQuantity = item.quantity + change;
            if (newQuantity <= 0) {
                return newCart.filter(i => i.cartItemId !== cartItemId);
            } else {
                newCart[itemIndex] = { ...item, quantity: newQuantity, totalPrice: item.price * newQuantity };
                return newCart;
            }
        });
    };
    
    const { subtotal, cgst, sgst, grandTotal } = useMemo(() => {
        const sub = cart.reduce((sum, item) => sum + item.totalPrice, 0);
        const tax = sub * 0.025; // 2.5% CGST and 2.5% SGST
        const total = sub + (tax * 2);
        return { subtotal: sub, cgst: tax, sgst: tax, grandTotal: total };
    }, [cart]);


    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
             <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <Dialog open={isBillModalOpen} onOpenChange={setIsBillModalOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-md p-0">
                    <div ref={billPrintRef}>
                         <BillToPrint
                            order={{}}
                            restaurant={restaurant}
                            billDetails={{ subtotal, cgst, sgst, grandTotal, discount: 0, deliveryCharge: 0 }}
                            items={cart}
                            customerDetails={customerDetails}
                        />
                    </div>
                    <div className="p-4 bg-muted border-t border-border flex justify-end no-print">
                        <Button onClick={handlePrint} className="bg-primary hover:bg-primary/90">
                            <Printer className="mr-2 h-4 w-4" /> Print Bill
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <h1 className="text-3xl font-bold tracking-tight">Manual Bill Generator</h1>
            <p className="text-muted-foreground mt-1">Create a bill for orders taken over the phone or in-person.</p>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
                {/* Left Side: Menu Selection */}
                <div className="bg-card border border-border rounded-xl p-4">
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search menu..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                        />
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto pr-2">
                        {loading ? <p>Loading menu...</p> : Object.entries(menu).filter(([_, items]) => items.length > 0).map(([categoryId, items]) => (
                            <div key={categoryId}>
                                <h3 className="font-bold text-lg my-3 capitalize">{categoryId.replace('-', ' ')}</h3>
                                {items.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase())).map(item => (
                                    <div key={item.id} className="mb-2 p-2 bg-muted/50 rounded-md">
                                        <p className="font-semibold">{item.name}</p>
                                        <div className="flex justify-between items-center mt-1">
                                            {item.portions.map(portion => (
                                                <button key={portion.name} onClick={() => addToCart(item, portion)} className="text-sm p-2 rounded-md bg-background border border-border hover:bg-primary/10 hover:border-primary transition-all">
                                                    {portion.name} - {formatCurrency(portion.price)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Side: Live Bill Preview */}
                <div className="flex flex-col">
                    <div className="bg-card border border-border rounded-xl p-4 mb-4">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><User size={16}/> Customer Name</Label>
                                <input value={customerDetails.name} onChange={e => setCustomerDetails({...customerDetails, name: e.target.value})} className="w-full p-2 border rounded-md bg-input border-border" />
                            </div>
                             <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Phone size={16}/> Customer Phone</Label>
                                <input value={customerDetails.phone} onChange={e => setCustomerDetails({...customerDetails, phone: e.target.value})} className="w-full p-2 border rounded-md bg-input border-border" />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label className="flex items-center gap-2"><MapPin size={16}/> Customer Address</Label>
                                <textarea value={customerDetails.address} onChange={e => setCustomerDetails({...customerDetails, address: e.target.value})} className="w-full p-2 border rounded-md bg-input border-border min-h-[60px]" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl flex-grow flex flex-col">
                         <div className="font-mono text-black bg-white p-4 rounded-t-lg flex-grow flex flex-col">
                           <div className="preview-bill">
                               <BillToPrint
                                    order={{}}
                                    restaurant={restaurant}
                                    billDetails={{ subtotal, cgst, sgst, grandTotal, discount: 0, deliveryCharge: 0 }}
                                    items={cart}
                                    customerDetails={customerDetails}
                                />
                           </div>
                        </div>
                        <div className="p-4 bg-muted/50 rounded-b-lg border-t border-border flex justify-end no-print">
                            <Button onClick={() => setIsBillModalOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                                <Printer className="mr-2 h-4 w-4" /> Finalize & Print Bill
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CustomBillPage;

    