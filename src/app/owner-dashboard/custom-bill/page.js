"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin, RotateCcw, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import InfoDialog from '@/components/InfoDialog';
import BillToPrint from '@/components/BillToPrint';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { connectSerialPrinter, printSerialData } from '@/services/printer/webSerialPrinter';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const createBillDraftId = () => `cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

function CustomBillPage() {
    const [menu, setMenu] = useState({});
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restaurant, setRestaurant] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const billPrintRef = useRef();

    const [customerDetails, setCustomerDetails] = useState({
        name: '',
        phone: '',
        address: ''
    });

    // State to control modal visibility
    const [isBillModalOpen, setIsBillModalOpen] = useState(false);
    const [usbDevice, setUsbDevice] = useState(null);
    const [serialPort, setSerialPort] = useState(null);
    const [activeCategory, setActiveCategory] = useState('');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [isSavingBillHistory, setIsSavingBillHistory] = useState(false);
    const [isNoAddressDialogOpen, setIsNoAddressDialogOpen] = useState(false);
    const [itemHistory, setItemHistory] = useState([]); // Track addition order for Undo
    const [billDraftId, setBillDraftId] = useState(() => createBillDraftId());
    const scrollContainerRef = useRef(null);
    const categoryRefs = useRef({});
    const accessQuery = impersonatedOwnerId
        ? `impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '';
    const historyUrl = impersonatedOwnerId
        ? `/owner-dashboard/custom-bill-history?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `/owner-dashboard/custom-bill-history?employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '/owner-dashboard/custom-bill-history';

    // useReactToPrint hook setup
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
        onAfterPrint: () => setIsBillModalOpen(false), // Close modal after printing
    });

    useEffect(() => {
        let isMounted = true;

        const fetchMenuAndSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("Authentication required.");
                const idToken = await user.getIdToken();

                const menuUrl = accessQuery ? `/api/owner/menu?compact=1&${accessQuery}` : '/api/owner/menu?compact=1';
                const settingsUrl = accessQuery ? `/api/owner/settings?${accessQuery}` : '/api/owner/settings';
                const headers = { 'Authorization': `Bearer ${idToken}` };

                const menuPromise = fetch(menuUrl, { headers });
                const settingsPromise = fetch(settingsUrl, { headers });

                settingsPromise
                    .then(async (settingsRes) => {
                        if (!settingsRes.ok) {
                            const settingsError = await settingsRes.json().catch(() => ({}));
                            throw new Error(settingsError?.message || 'Failed to fetch settings.');
                        }
                        const settingsData = await settingsRes.json();
                        if (!isMounted) return;
                        setRestaurant({
                            name: settingsData.restaurantName,
                            address: settingsData.address,
                            gstin: settingsData.gstin,
                            gstEnabled: !!settingsData.gstEnabled,
                            gstPercentage: Number(settingsData.gstPercentage ?? settingsData.gstRate ?? 0),
                            gstMinAmount: Number(settingsData.gstMinAmount ?? 0),
                        });
                    })
                    .catch((settingsError) => {
                        if (!isMounted) return;
                        setInfoDialog((prev) => {
                            if (prev.isOpen) return prev;
                            return {
                                isOpen: true,
                                title: 'Warning',
                                message: `Menu loaded, but restaurant details could not load: ${settingsError.message}`,
                            };
                        });
                    });

                const menuRes = await menuPromise;
                if (!menuRes.ok) {
                    const menuError = await menuRes.json().catch(() => ({}));
                    throw new Error(menuError?.message || 'Failed to fetch menu.');
                }

                const menuData = await menuRes.json();
                if (isMounted) {
                    setMenu(menuData.menu || {});
                }

            } catch (error) {
                if (isMounted) {
                    setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load menu: ${error.message}` });
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchMenuAndSettings();
            else setLoading(false);
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [accessQuery]);

    // Handle Scroll Spy
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const categories = Object.keys(menu);
            let current = categories[0];

            for (const catId of categories) {
                const element = document.getElementById(`cat-${catId}`);
                if (element) {
                    const rect = element.getBoundingClientRect();
                    const containerRect = container.getBoundingClientRect();
                    // If the element is near the top of the container
                    if (rect.top <= containerRect.top + 100) {
                        current = catId;
                    }
                }
            }
            setActiveCategory(current);
        };

        container.addEventListener('scroll', handleScroll);
        // Set initial active category
        if (Object.keys(menu).length > 0) {
            setActiveCategory((prev) => prev || Object.keys(menu)[0]);
        }
        return () => container.removeEventListener('scroll', handleScroll);
    }, [menu]);

    const scrollToCategory = (catId) => {
        const element = document.getElementById(`cat-${catId}`);
        if (element && scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const top = element.offsetTop - container.offsetTop;
            container.scrollTo({ top, behavior: 'smooth' });
            setActiveCategory(catId);
        }
    };

    const addToCart = (item, portion) => {
        const cartItemId = `${item.id}-${portion.name}`;
        setItemHistory(prev => [...prev, cartItemId]); // Record history
        const existingItem = cart.find(i => i.cartItemId === cartItemId);
        if (existingItem) {
            setCart(cart.map(i => i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1, totalPrice: (i.totalPrice / i.quantity) * (i.quantity + 1) } : i));
        } else {
            // Check if item has multiple portions
            const hasMultiplePortions = item.portions && item.portions.length > 1;

            // Exclude portions array from cart item to avoid confusion
            const { portions, ...itemWithoutPortions } = item;

            const cartItem = {
                ...itemWithoutPortions,
                quantity: 1,
                cartItemId,
                price: portion.price,
                totalPrice: portion.price
            };

            // Only add portion data if there are multiple portions
            if (hasMultiplePortions) {
                cartItem.portion = portion;
            }

            setCart([...cart, cartItem]);
        }
    };

    const handleUndo = () => {
        if (itemHistory.length === 0) return;

        const newHistory = [...itemHistory];
        const lastItemId = newHistory.pop();
        setItemHistory(newHistory);

        setCart(currentCart => {
            const itemIndex = currentCart.findIndex(i => i.cartItemId === lastItemId);
            if (itemIndex === -1) return currentCart;

            const newCart = [...currentCart];
            const item = newCart[itemIndex];

            if (item.quantity > 1) {
                newCart[itemIndex] = { ...item, quantity: item.quantity - 1, totalPrice: item.price * (item.quantity - 1) };
                return newCart;
            } else {
                return newCart.filter(i => i.cartItemId !== lastItemId);
            }
        });
    };

    const resetCurrentBill = () => {
        setCart([]);
        setItemHistory([]);
        setBillDraftId(createBillDraftId());
    };

    const handleClear = () => {
        resetCurrentBill();
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
        const gstEnabled = !!restaurant?.gstEnabled;
        const gstPercentage = Number(restaurant?.gstPercentage || 0);
        const gstMinAmount = Number(restaurant?.gstMinAmount || 0);

        const shouldApplyGst = gstEnabled && gstPercentage > 0 && sub >= gstMinAmount;
        if (!shouldApplyGst) {
            return { subtotal: sub, cgst: 0, sgst: 0, grandTotal: sub };
        }

        const halfRate = gstPercentage / 2;
        const localCgst = Math.round((sub * halfRate) / 100);
        const localSgst = Math.round((sub * halfRate) / 100);
        const total = sub + localCgst + localSgst;
        return { subtotal: sub, cgst: localCgst, sgst: localSgst, grandTotal: total };
    }, [cart, restaurant]);

    const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
    const visibleMenuEntries = useMemo(() => {
        const entries = [];
        for (const [categoryId, items] of Object.entries(menu || {})) {
            if (!Array.isArray(items) || items.length === 0) continue;
            const filteredItems = normalizedSearchQuery
                ? items.filter((item) => String(item?.name || '').toLowerCase().includes(normalizedSearchQuery))
                : items;
            if (filteredItems.length > 0) {
                entries.push([categoryId, filteredItems]);
            }
        }
        return entries;
    }, [menu, normalizedSearchQuery]);

    const printReceiptToUsb = async ({
        items,
        customer,
        billDetails,
        orderDate = new Date(),
        closeBillModalOnSuccess = false,
        notifyUser = false,
        silentOnNoDeviceSelection = false,
    }) => {
        const encoder = new EscPosEncoder();

        // Header
        encoder.initialize().align('center')
            .bold(true).text(restaurant?.name || 'Restaurant').newline()
            .bold(false).text(restaurant?.address?.street || restaurant?.address || '').newline()
            .text('--------------------------------').newline()
            .align('left').bold(true)
            .text(`Bill To: ${customer?.name || 'Guest'}`).newline()
            .bold(false)
            .text(`Date: ${new Date(orderDate).toLocaleString('en-IN')}`).newline()
            .text('--------------------------------').newline();

        // Items
        items.forEach(item => {
            const qty = Number(item?.quantity || 0);
            const safeQty = qty > 0 ? qty : 1;
            const itemTotal = Number(item?.totalPrice || 0);
            const unitPrice = (itemTotal / safeQty).toFixed(0);
            const total = itemTotal.toFixed(0);
            const portionLabel = String(
                item?.portion?.name ||
                item?.selectedPortion?.name ||
                item?.variant ||
                ''
            ).trim();
            const displayName = portionLabel
                ? `${item?.name || 'Item'} (${portionLabel})`
                : (item?.name || 'Item');

            encoder.text(displayName).newline();
            encoder.text(`  ${safeQty} x ${unitPrice}`).align('right').text(total).align('left').newline();
        });

        const safeSubtotal = Number(billDetails?.subtotal || 0);
        const safeCgst = Number(billDetails?.cgst || 0);
        const safeSgst = Number(billDetails?.sgst || 0);
        const safeGrandTotal = Number(billDetails?.grandTotal || safeSubtotal + safeCgst + safeSgst);

        // Totals
        encoder.text('--------------------------------').newline()
            .align('right');

        encoder.text(`Subtotal: ${safeSubtotal.toFixed(0)}`).newline();
        if (safeCgst > 0) encoder.text(`CGST: ${safeCgst.toFixed(0)}`).newline();
        if (safeSgst > 0) encoder.text(`SGST: ${safeSgst.toFixed(0)}`).newline();

        encoder.bold(true).size('large')
            .text(`TOTAL: ${safeGrandTotal.toFixed(0)}`).newline()
            .size('normal').bold(false).align('center')
            .newline()
            .text('Thank you!').newline()
            .newline().newline().newline()
            .cut();

        const payload = encoder.encode();
        const transportErrors = [];

        try {
            let device = usbDevice;
            if (!device || !device.opened) {
                device = await connectPrinter();
                setUsbDevice(device);
            }
            await printData(device, payload);

            if (closeBillModalOnSuccess) {
                setIsBillModalOpen(false);
            }
            if (notifyUser) {
                setInfoDialog({ isOpen: true, title: 'Printed', message: 'Receipt sent to thermal printer (USB).' });
            }
            return { ok: true, transport: 'usb' };
        } catch (usbError) {
            transportErrors.push(usbError);
            console.warn('[Custom Bill] USB print failed, trying serial fallback:', usbError?.message || usbError);
        }

        try {
            let port = serialPort;
            if (!port || !port.writable) {
                port = await connectSerialPrinter();
                setSerialPort(port);
            }
            await printSerialData(port, payload);

            if (closeBillModalOnSuccess) {
                setIsBillModalOpen(false);
            }
            if (notifyUser) {
                setInfoDialog({ isOpen: true, title: 'Printed', message: 'Receipt sent to thermal printer (Serial).' });
            }
            return { ok: true, transport: 'serial' };
        } catch (serialError) {
            transportErrors.push(serialError);
            console.error('[Custom Bill] Serial print failed:', serialError);
        }

        const lastError = transportErrors[transportErrors.length - 1];
        const lastMessage = String(lastError?.message || '').toLowerCase();
        const firstMessage = String(transportErrors[0]?.message || '').toLowerCase();
        const ignoredSelection = lastMessage === 'no serial port selected' || lastMessage === 'no device selected' || firstMessage === 'no device selected';

        if (silentOnNoDeviceSelection && ignoredSelection) {
            return { ok: false, error: lastError, ignored: true };
        }

        if (notifyUser) {
            const readableError = transportErrors.map((err, idx) => `${idx === 0 ? 'USB' : 'Serial'}: ${err?.message || 'Unknown error'}`).join('\n');
            setInfoDialog({
                isOpen: true,
                title: 'Print Failed',
                message: `Could not print using USB or Serial.\n${readableError}`,
            });
        }

        return { ok: false, error: lastError };
    };

    const saveCustomBillHistory = async (printedVia = 'browser') => {
        const user = auth.currentUser;
        if (!user) throw new Error('Authentication required.');
        const idToken = await user.getIdToken();

        const historyItems = cart.map((item) => ({
            id: item.id,
            name: item.name,
            categoryId: item.categoryId,
            quantity: item.quantity,
            price: item.price,
            totalPrice: item.totalPrice,
            portion: item.portion || null,
        }));

        const endpoint = accessQuery ? `/api/owner/custom-bill/history?${accessQuery}` : '/api/owner/custom-bill/history';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                billDraftId,
                printedVia,
                customerDetails,
                items: historyItems,
                billDetails: {
                    subtotal,
                    cgst,
                    sgst,
                    grandTotal,
                },
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.message || 'Failed to save bill history.');
        }
        if (!data?.duplicateRequest) {
            setBillDraftId(createBillDraftId());
        }
        return data;
    };

    const submitCreateOrder = async () => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Authentication required.');
            const idToken = await user.getIdToken();

            setIsCreatingOrder(true);

            const orderItems = cart.map((item) => ({
                id: item.id,
                name: item.name,
                categoryId: item.categoryId,
                isVeg: item.isVeg,
                quantity: item.quantity,
                price: item.price,
                totalPrice: item.totalPrice,
                cartItemId: item.cartItemId,
                portion: item.portion,
                selectedAddOns: item.selectedAddOns || [],
            }));

            const endpoint = accessQuery ? `/api/owner/custom-bill/create-order?${accessQuery}` : '/api/owner/custom-bill/create-order';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    customerDetails,
                    items: orderItems,
                    notes: '',
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.message || 'Failed to create order.');
            }

            if (!data?.duplicateRequest) {
                if (billPrintRef.current && handlePrint) {
                    handlePrint();
                }
            }

            resetCurrentBill();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Create Order Failed', message: error.message });
        } finally {
            setIsCreatingOrder(false);
        }
    };

    const handleCreateOrder = async () => {
        if (!cart.length) {
            setInfoDialog({ isOpen: true, title: 'Missing Items', message: 'At least one item is required to create an order.' });
            return;
        }

        const phoneDigits = String(customerDetails.phone || '').replace(/\D/g, '');
        if (phoneDigits.length < 10) {
            setInfoDialog({ isOpen: true, title: 'Invalid Phone', message: 'Please enter a valid customer phone number.' });
            return;
        }

        const hasAddress = !!String(customerDetails.address || '').trim();
        if (!hasAddress) {
            setIsNoAddressDialogOpen(true);
            return;
        }

        await submitCreateOrder();
    };


    const handleBrowserPrintForBill = async () => {
        if (!cart.length) return;

        setIsSavingBillHistory(true);
        let saveError = null;
        try {
            await saveCustomBillHistory('browser');
        } catch (error) {
            saveError = error;
            console.error('[Custom Bill] Failed to save browser-print history:', error);
        } finally {
            setIsSavingBillHistory(false);
        }

        if (billPrintRef.current && handlePrint) {
            handlePrint();
        }

        if (saveError) {
            setInfoDialog({
                isOpen: true,
                title: 'Printed (History Pending)',
                message: `Bill print ho gaya, lekin history save nahi hui: ${saveError.message}`,
            });
        }
    };

    const handleDirectPrint = async () => {
        if (!cart.length) return;

        setIsSavingBillHistory(true);
        try {
            const printResult = await printReceiptToUsb({
                items: cart,
                customer: customerDetails,
                billDetails: { subtotal, cgst, sgst, grandTotal },
                orderDate: new Date(),
                closeBillModalOnSuccess: true,
                notifyUser: false,
                silentOnNoDeviceSelection: true,
            });

            if (!printResult?.ok) {
                if (!printResult?.ignored) {
                    throw new Error(printResult?.error?.message || 'Could not print via USB/Serial.');
                }
                return;
            }

            try {
                await saveCustomBillHistory('direct_usb');
                setInfoDialog({ isOpen: true, title: 'Printed', message: 'Receipt printed and saved in bill history.' });
            } catch (historyError) {
                console.error('[Custom Bill] Failed to save direct-print history:', historyError);
                setInfoDialog({
                    isOpen: true,
                    title: 'Printed (History Pending)',
                    message: `Receipt print ho gaya, lekin history save nahi hui: ${historyError.message}`,
                });
            }
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Print Failed', message: error.message });
        } finally {
            setIsSavingBillHistory(false);
        }
    };

    return (
        <div className="text-foreground bg-background min-h-screen">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <Dialog open={isNoAddressDialogOpen} onOpenChange={setIsNoAddressDialogOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-md">
                    <DialogHeader>
                        <DialogTitle>Address Not Added</DialogTitle>
                        <DialogDescription>
                            Owner ko customer address manually dalna zaroori nahi hai. Order create karne par customer ko WhatsApp par location add karne ka link chala jayega.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsNoAddressDialogOpen(false)}
                            disabled={isCreatingOrder}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="bg-primary hover:bg-primary/90"
                            onClick={async () => {
                                setIsNoAddressDialogOpen(false);
                                await submitCreateOrder();
                            }}
                            disabled={isCreatingOrder}
                        >
                            Continue
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isBillModalOpen} onOpenChange={setIsBillModalOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-md p-0">
                    <div>
                        <BillToPrint
                            order={{ orderDate: new Date() }}
                            restaurant={restaurant}
                            billDetails={{ subtotal, cgst, sgst, grandTotal, discount: 0, deliveryCharge: 0 }}
                            items={cart}
                            customerDetails={customerDetails}
                        />
                    </div>
                    <div className="p-4 bg-muted border-t border-border flex justify-end gap-2 no-print">
                        <Button
                            onClick={handleDirectPrint}
                            variant="secondary"
                            className="bg-slate-800 text-white hover:bg-slate-700"
                            disabled={isSavingBillHistory}
                        >
                            {isSavingBillHistory ? 'Saving...' : '⚡ Direct Print (USB)'}
                        </Button>
                        <Button
                            onClick={handleBrowserPrintForBill}
                            className="bg-primary hover:bg-primary/90"
                            disabled={isSavingBillHistory}
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            {isSavingBillHistory ? 'Saving...' : 'Browser Print'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-md p-0 overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Edit size={20} className="text-primary" /> Edit Bill Items
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Adjust quantities or remove items from the current bill.</p>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar">
                        {cart.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <p>No items in the bill to edit.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {cart.map((item) => (
                                    <div key={item.cartItemId} className="flex items-center justify-between p-3 bg-muted/20 border border-border/50 rounded-xl">
                                        <div className="flex-grow">
                                            <p className="font-semibold text-sm">{item.name}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {item.portion ? `${item.portion.name} • ` : ''}{formatCurrency(item.price)}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center border border-border rounded-lg bg-background overflow-hidden h-8">
                                                <button
                                                    onClick={() => updateQuantity(item.cartItemId, -1)}
                                                    className="w-8 h-full flex items-center justify-center hover:bg-muted transition-colors border-r border-border"
                                                >
                                                    <Minus size={14} />
                                                </button>
                                                <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                                                <button
                                                    onClick={() => updateQuantity(item.cartItemId, 1)}
                                                    className="w-8 h-full flex items-center justify-center hover:bg-muted transition-colors border-l border-border"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </div>

                                            <button
                                                onClick={() => updateQuantity(item.cartItemId, -item.quantity)}
                                                className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                                title="Remove item"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-muted/30 border-t border-border flex justify-end">
                        <Button onClick={() => setIsEditModalOpen(false)} className="bg-primary hover:bg-primary/90">
                            Done Editing
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #888;
                    border-radius: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #555;
                }
            `}</style>

            <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
                {/* Left Side: Menu Selection (70%) */}
                <div className="lg:col-span-7 bg-card border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                            <h1 className="text-lg font-bold tracking-tight">Manual Billing</h1>
                            <Link href={historyUrl}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 px-3 text-xs font-semibold"
                                >
                                    View Bill History
                                </Button>
                            </Link>
                        </div>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                            <input
                                type="text"
                                placeholder="Search menu..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 h-10 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            />
                        </div>
                        <Button
                            onClick={handleClear}
                            disabled={cart.length === 0}
                            variant="outline"
                            className="h-10 px-4 gap-2 border-2 border-destructive/60 text-destructive hover:bg-destructive/10 font-bold transition-all shadow-sm whitespace-nowrap"
                            title="Clear entire cart"
                        >
                            <Trash2 size={16} /> Clear
                        </Button>
                        <Button
                            onClick={handleUndo}
                            disabled={itemHistory.length === 0}
                            variant="outline"
                            className="h-10 px-4 gap-2 border-2 border-primary/60 text-foreground hover:bg-primary/10 font-bold transition-all shadow-sm whitespace-nowrap"
                            title="Undo last item added"
                        >
                            <RotateCcw size={16} /> Undo
                        </Button>
                    </div>

                    <div className="flex gap-4 h-[70vh]">
                        {/* CATEGORY NAVIGATION SIDEBAR */}
                        <div className="w-1/4 flex-shrink-0 border-r border-border pr-2 overflow-y-auto custom-scrollbar hidden md:block">
                            <div className="space-y-1">
                                {visibleMenuEntries.map(([categoryId]) => (
                                    <button
                                        key={categoryId}
                                        onClick={() => scrollToCategory(categoryId)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                                            activeCategory === categoryId
                                                ? "bg-primary text-primary-foreground shadow-md scale-[1.02]"
                                                : "text-muted-foreground hover:bg-muted"
                                        )}
                                    >
                                        {categoryId.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ITEM LIST */}
                        <div
                            ref={scrollContainerRef}
                            className="flex-grow overflow-y-auto pr-2 custom-scrollbar"
                        >
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                    <p>Loading menu...</p>
                                </div>
                            ) : visibleMenuEntries.map(([categoryId, filteredItems]) => (
                                <div key={categoryId} id={`cat-${categoryId}`} className="mb-5 pt-1">
                                    <h3 className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 px-3 z-10 mb-3 border-l-4 border-primary font-bold text-base capitalize text-foreground tracking-wide">
                                        {categoryId.replace('-', ' ')}
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {filteredItems.map(item => (
                                            <motion.div
                                                key={item.id}
                                                whileHover={{ y: -4, scale: 1.02 }}
                                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                className="p-5 bg-gradient-to-br from-card via-card to-card/90 hover:from-card hover:via-muted/20 hover:to-card rounded-2xl border-2 border-border/40 hover:border-primary/50 transition-all shadow-md hover:shadow-xl hover:shadow-primary/10 min-h-[130px] flex flex-col backdrop-blur-sm"
                                            >
                                                <div className="flex-1 mb-3">
                                                    <p className="font-bold text-foreground text-base leading-tight">
                                                        {item.name}
                                                    </p>
                                                </div>
                                                <div className={`grid gap-2.5 mt-auto ${item.portions.length === 1 ? 'grid-cols-1' :
                                                    item.portions.length === 2 ? 'grid-cols-2' :
                                                        'grid-cols-3'
                                                    }`}>
                                                    {item.portions.map(portion => (
                                                        <motion.button
                                                            key={portion.name}
                                                            whileHover={{ scale: 1.05 }}
                                                            whileTap={{ scale: 0.95 }}
                                                            onClick={() => addToCart(item, portion)}
                                                            className="px-3 py-3 rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border-2 border-primary/40 hover:from-primary hover:via-primary hover:to-primary/90 hover:text-primary-foreground hover:border-primary transition-all flex flex-col items-center justify-center gap-1.5 font-bold group shadow-sm hover:shadow-lg hover:shadow-primary/30 min-h-[70px] relative overflow-hidden"
                                                        >
                                                            {/* Subtle gradient overlay on hover */}
                                                            <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>

                                                            {item.portions.length > 1 && (
                                                                <span className="text-xs opacity-70 group-hover:opacity-100 uppercase tracking-wider font-black relative z-10">
                                                                    {portion.name}
                                                                </span>
                                                            )}
                                                            <div className="flex items-center justify-center relative z-10">
                                                                <span className="text-base font-black">
                                                                    {formatCurrency(portion.price)}
                                                                </span>
                                                            </div>
                                                        </motion.button>
                                                    ))}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Side: Live Bill Preview (30%) */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                    <div className="bg-card border border-border rounded-xl p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><User size={16} /> Customer Name</Label>
                                <input value={customerDetails.name} onChange={e => setCustomerDetails({ ...customerDetails, name: e.target.value })} className="w-full p-2 border rounded-md bg-input border-border" />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Phone size={16} /> Customer Phone</Label>
                                <input value={customerDetails.phone} onChange={e => setCustomerDetails({ ...customerDetails, phone: e.target.value })} className="w-full p-2 border rounded-md bg-input border-border" />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label className="flex items-center gap-2"><MapPin size={16} /> Customer Address</Label>
                                <textarea value={customerDetails.address} onChange={e => setCustomerDetails({ ...customerDetails, address: e.target.value })} className="w-full p-2 border rounded-md bg-input border-border min-h-[60px]" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl flex-grow flex flex-col">
                        <div className="font-mono text-black bg-white p-4 rounded-t-lg flex-grow flex flex-col">
                            <div ref={billPrintRef} className="preview-bill">
                                <BillToPrint
                                    order={{ orderDate: new Date() }}
                                    restaurant={restaurant}
                                    billDetails={{ subtotal, cgst, sgst, grandTotal, discount: 0, deliveryCharge: 0 }}
                                    items={cart}
                                    customerDetails={customerDetails}
                                />
                            </div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-b-lg border-t border-border grid grid-cols-3 gap-2 no-print">
                            <Button
                                onClick={handleCreateOrder}
                                className="w-full h-10 px-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-900/30 transition-all"
                                disabled={cart.length === 0 || isCreatingOrder}
                            >
                                {isCreatingOrder ? 'Creating...' : 'Create Order'}
                            </Button>
                            <Button
                                onClick={() => setIsEditModalOpen(true)}
                                variant="outline"
                                className="w-full h-10 px-2 text-sm border-2 border-primary/50 text-foreground hover:bg-primary/10 font-bold transition-all shadow-sm"
                                disabled={cart.length === 0 || isCreatingOrder}
                            >
                                <Edit className="mr-1 h-4 w-4 text-primary" /> IDT
                            </Button>
                            <Button
                                onClick={() => setIsBillModalOpen(true)}
                                className="w-full h-10 px-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20 transition-all"
                                disabled={cart.length === 0 || isCreatingOrder}
                            >
                                <Printer className="mr-1 h-4 w-4" /> Print
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}

export default CustomBillPage;

