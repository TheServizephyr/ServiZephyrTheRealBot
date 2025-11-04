'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin, IndianRupee, ArrowLeft, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useReactToPrint } from 'react-to-print';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CustomBillPage = () => {
    const [menu, setMenu] = useState({});
    const [restaurant, setRestaurant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState([]);
    const [customerDetails, setCustomerDetails] = useState({ name: '', phone: '', address: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const router = useRouter();
    const billPrintRef = useRef();

    useEffect(() => {
        const fetchMenuAndRestaurant = async () => {
            const user = auth.currentUser;
            if (!user) {
                router.push('/');
                return;
            }
            setLoading(true);
            try {
                const idToken = await user.getIdToken();
                const [menuRes, settingsRes] = await Promise.all([
                    fetch('/api/owner/menu', { headers: { 'Authorization': `Bearer ${idToken}` } }),
                    fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } })
                ]);
                
                if (!menuRes.ok || !settingsRes.ok) throw new Error('Failed to fetch data');
                
                const menuData = await menuRes.json();
                const settingsData = await settingsRes.json();

                setMenu(menuData.menu || {});
                setRestaurant({
                    name: settingsData.restaurantName,
                    address: settingsData.address,
                    gstin: settingsData.gstin,
                });
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load data: ${error.message}` });
            } finally {
                setLoading(false);
            }
        };
        
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchMenuAndRestaurant();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router]);

    const handleCartUpdate = (item, portion, quantity) => {
        const cartItemId = `${item.id}-${portion.name}`;
        setCart(currentCart => {
            const existingItemIndex = currentCart.findIndex(cartItem => cartItem.cartItemId === cartItemId);
            
            if (quantity <= 0) {
                return currentCart.filter(cartItem => cartItem.cartItemId !== cartItemId);
            }

            if (existingItemIndex > -1) {
                const newCart = [...currentCart];
                newCart[existingItemIndex].quantity = quantity;
                return newCart;
            } else {
                return [...currentCart, { ...item, portion, quantity, cartItemId }];
            }
        });
    };
    
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
        documentTitle: `Bill-${customerDetails.name || 'Custom'}`,
    });
    
    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.portion.price * item.quantity, 0), [cart]);
    const tax = subtotal * 0.1; // Example 10% tax
    const grandTotal = subtotal + tax;

    const filteredMenu = useMemo(() => {
        if (!searchQuery) return menu;
        const lowerCaseQuery = searchQuery.toLowerCase();
        const newMenu = {};
        for (const category in menu) {
            const filteredItems = menu[category].filter(item => item.name.toLowerCase().includes(lowerCaseQuery));
            if (filteredItems.length > 0) {
                newMenu[category] = filteredItems;
            }
        }
        return newMenu;
    }, [menu, searchQuery]);

    const handleCustomerDetailChange = (field, value) => {
        setCustomerDetails(prev => ({ ...prev, [field]: value }));
    };
    
    return (
        <div className="h-screen flex flex-col bg-background text-foreground">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false})} title={infoDialog.title} message={infoDialog.message} />
             <header className="p-4 border-b border-border flex justify-between items-center flex-shrink-0">
                 <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft/></Button>
                    <div>
                        <h1 className="text-xl font-bold">Create Custom Bill</h1>
                        <p className="text-sm text-muted-foreground">For phone calls or walk-in orders.</p>
                    </div>
                </div>
                 <Button onClick={handlePrint} className="bg-primary hover:bg-primary/90">
                    <Printer className="mr-2 h-4 w-4"/> Print Bill
                </Button>
            </header>
            <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
                {/* Left Panel: Menu */}
                <div className="w-full md:w-2/3 p-4 space-y-4 overflow-y-auto">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"/>
                        <Input placeholder="Search menu items..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                    {loading ? (
                        <p>Loading menu...</p>
                    ) : (
                        Object.entries(filteredMenu).map(([category, items]) => items.length > 0 && (
                            <div key={category}>
                                <h3 className="font-bold text-lg capitalize mb-2">{category.replace('-', ' ')}</h3>
                                <div className="space-y-2">
                                    {items.map(item => (
                                        <Card key={item.id} className="p-3">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="font-semibold">{item.name}</p>
                                                    <p className="text-xs text-muted-foreground">{item.description}</p>
                                                </div>
                                                <div className="flex-shrink-0">
                                                    {item.portions.map(portion => {
                                                        const cartItem = cart.find(ci => ci.cartItemId === `${item.id}-${portion.name}`);
                                                        const quantity = cartItem ? cartItem.quantity : 0;
                                                        return (
                                                            <div key={portion.name} className="flex items-center gap-2 justify-end mt-1">
                                                                <span className="text-sm w-20 truncate">{portion.name}</span>
                                                                <span className="font-semibold text-sm w-20 text-right">{formatCurrency(portion.price)}</span>
                                                                <div className="flex items-center gap-1">
                                                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleCartUpdate(item, portion, quantity - 1)} disabled={quantity === 0}>-</Button>
                                                                    <span className="font-bold w-6 text-center">{quantity}</span>
                                                                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleCartUpdate(item, portion, quantity + 1)}>+</Button>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </Card>
                                    ))
                                }
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Right Panel: Bill */}
                <div className="w-full md:w-1/3 bg-card border-l border-border p-4 flex flex-col">
                    <h2 className="text-2xl font-bold mb-4">Live Bill Preview</h2>
                    <div ref={billPrintRef} className="font-mono text-black bg-white p-4 rounded-lg flex-grow flex flex-col">
                        {restaurant && (
                            <div className="text-center mb-4 border-b-2 border-dashed border-black pb-2">
                                <h3 className="text-xl font-bold uppercase">{restaurant.name}</h3>
                                <p className="text-xs">{restaurant.address?.full || `${restaurant.address?.street}, ${restaurant.address?.city}`}</p>
                                {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
                            </div>
                        )}
                         <div className="mb-4 text-xs">
                            <p><strong>To:</strong> {customerDetails.name || 'Walk-in Customer'}</p>
                            {customerDetails.phone && <p><strong>Ph:</strong> {customerDetails.phone}</p>}
                            {customerDetails.address && <p><strong>Add:</strong> {customerDetails.address}</p>}
                        </div>
                        <div className="flex-grow">
                             <table className="w-full text-xs mb-4">
                                <thead className="border-y-2 border-dashed border-black">
                                    <tr>
                                        <th className="text-left font-bold py-1">ITEM</th>
                                        <th className="text-center font-bold py-1">QTY</th>
                                        <th className="text-right font-bold py-1">PRICE</th>
                                        <th className="text-right font-bold py-1">AMOUNT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cart.map((item, index) => (
                                        <tr key={index} className="border-b border-dotted border-black">
                                            <td className="py-1">{item.name} ({item.portion.name})</td>
                                            <td className="text-center py-1">{item.quantity}</td>
                                            <td className="text-right py-1">{item.portion.price.toFixed(2)}</td>
                                            <td className="text-right py-1">{(item.portion.price * item.quantity).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="text-xs space-y-1 pt-2 border-t border-dashed">
                             <div className="flex justify-between font-semibold"><span>SUBTOTAL</span><span>{subtotal.toFixed(2)}</span></div>
                             <div className="flex justify-between"><span>TAX</span><span>{tax.toFixed(2)}</span></div>
                             <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t-2 border-dashed border-black">
                                <span>GRAND TOTAL</span>
                                <span>{formatCurrency(grandTotal)}</span>
                            </div>
                        </div>
                         <div className="text-center mt-4 pt-2 border-t border-dashed border-black">
                            <p className="text-xs italic">For exclusive offers and faster ordering, visit the ServiZephyr Customer Hub!</p>
                            <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                        </div>
                    </div>
                     <div className="mt-4 space-y-3 flex-shrink-0">
                        <h3 className="font-semibold">Customer Details (Optional)</h3>
                        <Input placeholder="Customer Name" value={customerDetails.name} onChange={e => handleCustomerDetailChange('name', e.target.value)} />
                        <Input placeholder="Customer Phone" value={customerDetails.phone} onChange={e => handleCustomerDetailChange('phone', e.target.value)} />
                        <Textarea placeholder="Customer Address" value={customerDetails.address} onChange={e => handleCustomerDetailChange('address', e.target.value)} rows={2}/>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomBillPage;
