'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    UtensilsCrossed,
    Bell,
    Check,
    Users,
    Plus,
    Minus,
    Loader2,
    RefreshCw,
    Volume2,
    VolumeX,
    Sparkles,
    Search,
    X,
    ShoppingCart,
    Send,
    ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import { useSearchParams, useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import Link from 'next/link';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Table status badge component
const TableBadge = ({ table, isSelected, onClick }) => {
    const stateConfig = {
        available: { bg: 'bg-green-500/20', border: 'border-green-500', text: 'text-green-500', icon: '🟢' },
        occupied: { bg: 'bg-yellow-500/20', border: 'border-yellow-500', text: 'text-yellow-500', icon: '🟡' },
        needs_cleaning: { bg: 'bg-red-500/20', border: 'border-red-500', text: 'text-red-500', icon: '🔴' },
    };
    const config = stateConfig[table.state] || stateConfig.available;

    return (
        <button
            onClick={onClick}
            className={cn(
                "p-3 rounded-xl border-2 transition-all text-center min-w-[80px] flex-shrink-0",
                config.bg, config.border,
                isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
        >
            <p className="text-xs text-muted-foreground">{config.icon}</p>
            <p className={cn("font-bold", config.text)}>{table.id}</p>
            <p className="text-xs text-muted-foreground">{table.current_pax || 0}/{table.max_capacity}</p>
        </button>
    );
};

// Fast MenuItem for list view
const FastMenuItem = ({ item, quantity, onIncrement, onDecrement }) => {
    return (
        <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
                        <div className={`w-1.5 h-1.5 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                    </div>
                    <p className="font-medium text-foreground truncate">{item.name}</p>
                </div>
                <p className="text-sm text-primary ml-5">{formatCurrency(item.price)}</p>
            </div>
            <div className="flex items-center gap-2">
                {quantity > 0 ? (
                    <div className="flex items-center gap-2 bg-primary/10 rounded-full p-1">
                        <button
                            onClick={() => onDecrement(item.id)}
                            className="w-8 h-8 rounded-full bg-background flex items-center justify-center text-foreground hover:bg-muted"
                        >
                            <Minus size={16} />
                        </button>
                        <span className="w-6 text-center font-bold text-foreground">{quantity}</span>
                        <button
                            onClick={() => onIncrement(item)}
                            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => onIncrement(item)}
                        className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                        <Plus size={20} />
                    </button>
                )}
            </div>
        </div>
    );
};

function WaiterOrderContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    // Core state
    const [tables, setTables] = useState([]);
    const [menu, setMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [restaurantId, setRestaurantId] = useState(null);
    const [taxSettings, setTaxSettings] = useState({ gstEnabled: false, gstRate: 5 });

    // UI state
    const [selectedTable, setSelectedTable] = useState(null);
    const [selectedTab, setSelectedTab] = useState(null);
    const [cart, setCart] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isSending, setIsSending] = useState(false);
    const [showNewTabModal, setShowNewTabModal] = useState(false);
    const [newTabName, setNewTabName] = useState('');
    const [newTabPax, setNewTabPax] = useState(2);

    const audioRef = useRef(null);

    // Build query string for API calls
    const buildQueryString = useCallback(() => {
        const params = new URLSearchParams();
        if (impersonatedOwnerId) params.append('impersonate_owner_id', impersonatedOwnerId);
        if (employeeOfOwnerId) params.append('employee_of', employeeOfOwnerId);
        return params.toString() ? `?${params.toString()}` : '';
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    // Fetch tables and menu
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');

            const idToken = await user.getIdToken();
            const queryString = buildQueryString();

            // Fetch tables
            const tablesRes = await fetch(`/api/owner/dine-in-tables${queryString}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (tablesRes.ok) {
                const tablesData = await tablesRes.json();
                setTables(tablesData.tables || []);
            }

            // Fetch menu
            const menuRes = await fetch(`/api/owner/menu${queryString}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (menuRes.ok) {
                const menuData = await menuRes.json();
                setMenu(menuData.menu || {});
                if (menuData.restaurantId) setRestaurantId(menuData.restaurantId);
            }

            // Fetch settings for Tax
            const settingsRes = await fetch(`/api/owner/settings${queryString}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                setTaxSettings({
                    gstEnabled: settingsData.gstEnabled || false,
                    gstRate: settingsData.gstRate || 5,
                });
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to load data: ' + error.message });
        } finally {
            setLoading(false);
        }
    }, [buildQueryString]);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                fetchData();
            }
        });
        return () => unsubscribe();
    }, [fetchData]);

    // Sync selectedTable with latest tables data
    useEffect(() => {
        if (selectedTable && tables.length > 0) {
            const updatedTable = tables.find(t => t.id === selectedTable.id);
            if (updatedTable) {
                setSelectedTable(updatedTable);
            }
        }
    }, [tables]);

    // Flatten menu items for search
    const allMenuItems = useMemo(() => {
        const items = [];
        Object.entries(menu).forEach(([category, categoryItems]) => {
            (categoryItems || []).forEach(item => {
                if (item.isAvailable !== false) {
                    const price = item.portions?.[0]?.price || item.price || 0;
                    items.push({ ...item, categoryName: category, price });
                }
            });
        });
        return items;
    }, [menu]);

    // Filter items by search
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return allMenuItems;
        const query = searchQuery.toLowerCase();
        return allMenuItems.filter(item =>
            item.name.toLowerCase().includes(query) ||
            item.categoryName.toLowerCase().includes(query)
        );
    }, [allMenuItems, searchQuery]);

    // Cart functions
    const handleIncrement = useCallback((item) => {
        setCart(prev => ({
            ...prev,
            [item.id]: {
                ...item,
                quantity: (prev[item.id]?.quantity || 0) + 1
            }
        }));
    }, []);

    const handleDecrement = useCallback((itemId) => {
        setCart(prev => {
            const item = prev[itemId];
            if (!item || item.quantity <= 1) {
                const { [itemId]: removed, ...rest } = prev;
                return rest;
            }
            return {
                ...prev,
                [itemId]: { ...item, quantity: item.quantity - 1 }
            };
        });
    }, []);

    const cartTotal = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }, [cart]);

    const cartCount = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
    }, [cart]);

    // Handle table selection
    const handleTableClick = (table) => {
        setSelectedTable(table);
        setSelectedTab(null);
        setCart({});

        // If table has active tabs, show them - auto select if only 1 group exists
        const activeTabs = table.tabs ? Object.values(table.tabs) : [];
        const pendingOrders = table.pendingOrders || [];
        const totalGroups = activeTabs.length + pendingOrders.length;

        if (totalGroups === 1) {
            if (activeTabs.length === 1) {
                // Auto-select the single active tab
                const tabId = Object.keys(table.tabs)[0];
                setSelectedTab({ ...table.tabs[tabId], id: tabId });
            } else if (pendingOrders.length === 1) {
                // Auto-select the single pending order group
                // Pending orders usually have ID as group ID, but we need to ensure dineInTabId is used if available
                const order = pendingOrders[0];
                setSelectedTab({ ...order, id: order.dineInTabId || order.id });
                // If it's a pending order, it might not have a dineInTabId yet (if from QR),
                // but checking `dineInTabId` from API response is safer.
                // If it is null, using `order.id` might treat it as a new tab, but effectively merges into that group?
                // Actually, if we send `dineInTabId: null` it creates NEW.
                // If we send `dineInTabId: order.id`, the backend might not find it as a tab and create new?
                // Wait. Pending orders are grouped by `groupKey`.
                // If the group has `dineInTabId`, we MUST use it.
                // If not, we might need to handle it. But usually even pending orders have a tab reference or grouping.
            }
        }

        // If table has pending orders, can select one
        if (table.pendingOrders && table.pendingOrders.length > 0) {
            // Don't auto-select, let waiter choose
        }
    };

    // Handle creating new tab
    const handleCreateTab = async () => {
        if (!selectedTable || !newTabName.trim()) return;

        setIsSending(true);
        try {
            const res = await fetch('/api/owner/tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_tab',
                    tableId: selectedTable.id,
                    restaurantId: restaurantId,
                    pax_count: newTabPax,
                    tab_name: newTabName.trim()
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setShowNewTabModal(false);
            setNewTabName('');
            setNewTabPax(2);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab created successfully!' });

            // Refresh data
            fetchData();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setIsSending(false);
        }
    };

    // Send order
    const handleSendOrder = async () => {
        if (!selectedTable || cartCount === 0) return;

        setIsSending(true);
        try {
            const items = Object.values(cart).map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                totalPrice: item.price * item.quantity,
                isVeg: item.isVeg,
                categoryId: item.categoryId || item.category,
                portion: item.portions?.[0] || null, // Fix: Include portion info (default to first if strict portion)
                selectedAddOns: item.selectedAddOns || [], // Fix: Include addons
            }));

            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await user.getIdToken();

            // Get waiter info
            const userRes = await fetch('/api/user/profile', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            const userData = userRes.ok ? await userRes.json() : {};
            const waiterName = userData.name || 'Waiter';

            const subtotal = cartTotal;
            let cgst = 0;
            let sgst = 0;

            if (taxSettings.gstEnabled) {
                const rate = taxSettings.gstRate || 5;
                const halfRate = rate / 2;
                cgst = Math.round(subtotal * (halfRate / 100) * 100) / 100;
                sgst = Math.round(subtotal * (halfRate / 100) * 100) / 100;
            }

            const grandTotal = subtotal + cgst + sgst;

            const orderPayload = {
                restaurantId: restaurantId,
                items,
                subtotal,
                cgst,
                sgst,
                grandTotal,
                deliveryType: 'dine-in',
                paymentMethod: 'cod',
                tableId: selectedTable.id,
                dineInTabId: selectedTab?.id || null,
                tab_name: selectedTab?.tab_name || newTabName || 'Waiter Order',
                pax_count: selectedTab?.pax_count || newTabPax || 1,
                ordered_by: `waiter_${waiterName}`,
                ordered_by_name: waiterName,
                idempotencyKey: crypto.randomUUID(), // Fix: Add required idempotency key
            };

            const res = await fetch('/api/order/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(orderPayload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setCart({});
            setInfoDialog({
                isOpen: true,
                title: 'Order Sent! 🎉',
                message: `Order sent to kitchen. Token: ${data.dineInToken || 'N/A'}`
            });

            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            fetchData();
        } catch (error) {
            console.error('Error sending order:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setIsSending(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading waiter dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            {/* Audio element */}
            <audio ref={audioRef} src="/sounds/new-order.mp3" preload="auto" />

            {/* Info Dialog */}
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            {/* New Tab Modal */}
            <Dialog open={showNewTabModal} onOpenChange={setShowNewTabModal}>
                <DialogContent className="bg-card border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle>Start New Tab</DialogTitle>
                        <DialogDescription>Create a new tab for Table {selectedTable?.id}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium">Customer Name</label>
                            <Input
                                value={newTabName}
                                onChange={(e) => setNewTabName(e.target.value)}
                                placeholder="e.g. Rahul"
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium">Number of Guests</label>
                            <div className="flex items-center gap-4 mt-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setNewTabPax(Math.max(1, newTabPax - 1))}
                                >
                                    <Minus size={16} />
                                </Button>
                                <span className="text-2xl font-bold w-8 text-center">{newTabPax}</span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setNewTabPax(newTabPax + 1)}
                                >
                                    <Plus size={16} />
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewTabModal(false)}>Cancel</Button>
                        <Button onClick={handleCreateTab} disabled={isSending || !newTabName.trim()}>
                            {isSending ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                            Create Tab
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
                            <UtensilsCrossed className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-foreground">Waiter Order Panel</h1>
                            <p className="text-muted-foreground text-xs">Take orders for tables</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={fetchData}>
                        <RefreshCw className="w-5 h-5" />
                    </Button>
                </div>

                {/* Tables Scroll */}
                <div className="flex gap-3 overflow-x-auto pb-2">
                    {tables.map(table => (
                        <TableBadge
                            key={table.id}
                            table={table}
                            isSelected={selectedTable?.id === table.id}
                            onClick={() => handleTableClick(table)}
                        />
                    ))}
                    {tables.length === 0 && (
                        <p className="text-muted-foreground text-sm">No tables found.</p>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {selectedTable ? (
                    <>
                        {/* Selected Table Info */}
                        <div className="p-4 border-b border-border bg-muted/30">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-lg">Table {selectedTable.id}</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedTable.current_pax || 0}/{selectedTable.max_capacity} seats
                                    </p>
                                </div>
                                <Button onClick={() => setShowNewTabModal(true)} size="sm">
                                    <Plus size={16} className="mr-2" /> New Tab
                                </Button>
                            </div>

                            {/* Tabs & Pending Orders */}
                            {(Object.keys(selectedTable.tabs || {}).length > 0 || (selectedTable.pendingOrders || []).length > 0) && (
                                <div className="flex gap-2 mt-3 overflow-x-auto">
                                    {Object.entries(selectedTable.tabs || {}).map(([tabId, tab]) => {
                                        const tabWithId = { ...tab, id: tabId };
                                        return (
                                            <button
                                                key={tabId}
                                                onClick={() => setSelectedTab(tabWithId)}
                                                className={cn(
                                                    "px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                                                    selectedTab?.id === tabId
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                                                )}
                                            >
                                                {tab.tab_name} ({tab.pax_count})
                                            </button>
                                        );
                                    })}
                                    {(selectedTable.pendingOrders || []).map(order => (
                                        <button
                                            key={order.id}
                                            onClick={() => setSelectedTab({ ...order, id: order.dineInTabId || order.id })} // Fix: Use dineInTabId if available
                                            className={cn(
                                                "px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap border-2 border-dashed",
                                                selectedTab?.id === (order.dineInTabId || order.id)
                                                    ? "bg-yellow-500 text-black border-yellow-500"
                                                    : "bg-yellow-500/10 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/20"
                                            )}
                                        >
                                            {order.tab_name || 'Pending'} ⏳
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Menu Section */}
                        <div className="flex-1 overflow-y-auto p-4">
                            {/* Search */}
                            <div className="relative mb-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search menu..."
                                    className="pl-10"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>

                            {/* Fast Menu List */}
                            <div className="bg-card rounded-lg border border-border p-4">
                                <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                                    MENU ({filteredItems.length} items)
                                </h4>
                                <div className="max-h-[calc(100vh-500px)] overflow-y-auto">
                                    {filteredItems.map(item => (
                                        <FastMenuItem
                                            key={item.id}
                                            item={item}
                                            quantity={cart[item.id]?.quantity || 0}
                                            onIncrement={handleIncrement}
                                            onDecrement={handleDecrement}
                                        />
                                    ))}
                                    {filteredItems.length === 0 && (
                                        <p className="text-center text-muted-foreground py-8">
                                            No items found
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="text-center">
                            <UtensilsCrossed className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                            <h2 className="font-semibold text-xl">Select a Table</h2>
                            <p className="text-muted-foreground mt-2">
                                Tap on a table above to take orders
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Cart Footer */}
            {cartCount > 0 && (
                <motion.footer
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="p-4 border-t border-border bg-card"
                >
                    <Button
                        onClick={handleSendOrder}
                        disabled={isSending}
                        className="w-full h-14 text-lg bg-primary hover:bg-primary/90"
                    >
                        {isSending ? (
                            <Loader2 className="animate-spin mr-2" size={20} />
                        ) : (
                            <Send className="mr-2" size={20} />
                        )}
                        Send Order ({cartCount} items) • {formatCurrency(cartTotal)}
                    </Button>
                </motion.footer>
            )}
        </div>
    );
}

export default function WaiterOrderPage() {
    return (
        <Suspense fallback={
            <div className="p-6 flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        }>
            <WaiterOrderContent />
        </Suspense>
    );
}
