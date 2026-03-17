'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    UtensilsCrossed,
    Plus,
    Minus,
    Loader2,
    RefreshCw,
    Search,
    X,
    Send,
    Trash2,
    Pencil,
    Maximize2,
    Minimize2
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
const formatCategoryLabel = (categoryId = '') =>
    String(categoryId || '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
const normalizePortionName = (portionName = '') => String(portionName || '').trim().toLowerCase() || 'default';
const getAddonSignature = (selectedAddOns = []) => {
    if (!Array.isArray(selectedAddOns) || selectedAddOns.length === 0) return 'noaddon';
    return selectedAddOns
        .map((addon) => `${String(addon?.groupTitle || '').trim()}|${String(addon?.name || '').trim()}|${Number(addon?.price || 0)}|${Number(addon?.quantity || 1)}`)
        .sort()
        .join('||');
};
const buildCartKey = (itemId, portionName = '', addonSignature = 'noaddon') =>
    `${String(itemId)}__${normalizePortionName(portionName)}__${String(addonSignature || 'noaddon')}`;

// Table status badge component - Premium Style
const TableBadge = ({ table, isSelected, onClick }) => {
    const stateConfig = {
        available: { bg: 'bg-green-500/10', border: 'border-green-500/60', text: 'text-green-500', label: 'Free' },
        occupied: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/60', text: 'text-yellow-500', label: 'Busy' },
        needs_cleaning: { bg: 'bg-red-500/10', border: 'border-red-500/60', text: 'text-red-500', label: 'Clean' },
    };
    const config = stateConfig[table.state] || stateConfig.available;

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex-shrink-0 p-3 rounded-2xl border-2 transition-all duration-200 text-center min-w-[88px]",
                config.bg, config.border,
                isSelected
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg shadow-primary/20 scale-105"
                    : "hover:scale-102 hover:shadow-md"
            )}
        >
            <p className={cn("text-2xl font-black tracking-tight", config.text)}>{table.id}</p>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">{table.current_pax || 0}/{table.max_capacity} seats</p>
            <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1 inline-block", config.text, config.bg)}>{config.label}</span>
        </button>
    );
};

// Menu Item Card — Exact copy of custom-bill card style. Click = instant add.
const MenuItemCard = ({ item, quantity, onIncrement, onDecrement, getVariantQuantity }) => {
    const portions = Array.isArray(item?.portions) ? item.portions.filter((p) => p?.name) : [];
    const hasQuantity = quantity > 0;

    return (
        <motion.div
            whileHover={{ y: -4, scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={cn(
                'p-5 rounded-2xl border-2 transition-all shadow-md min-h-[130px] flex flex-col backdrop-blur-sm',
                hasQuantity
                    ? 'bg-gradient-to-br from-primary/15 via-primary/8 to-primary/5 border-primary shadow-primary/20 hover:shadow-xl hover:shadow-primary/30'
                    : 'bg-gradient-to-br from-card via-card to-card/90 border-border/40 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10'
            )}
        >
            {/* Item name + qty badge */}
            <div className="flex-1 mb-3 flex items-start justify-between gap-2">
                <p className="font-bold text-foreground text-base leading-tight">{item.name}</p>
                {hasQuantity && (
                    <span className="bg-primary text-primary-foreground text-xs font-black px-2 py-0.5 rounded-full min-w-[24px] text-center flex-shrink-0">
                        {quantity}
                    </span>
                )}
            </div>

            {/* Portion buttons */}
            <div className={`grid gap-2.5 mt-auto ${portions.length === 1 ? 'grid-cols-1' : portions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {portions.map((portion) => {
                    const portionQty = getVariantQuantity(item.id, portion.name);
                    return (
                        <motion.button
                            key={`${item.id}-${portion.name}`}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => onIncrement(item, portion)}
                            className={cn(
                                'px-3 py-3 rounded-xl border-2 flex flex-col items-center justify-center gap-1.5 font-bold group shadow-sm hover:shadow-lg min-h-[70px] relative overflow-hidden transition-all',
                                portionQty > 0
                                    ? 'bg-primary text-primary-foreground border-primary shadow-primary/30'
                                    : 'bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border-primary/40 hover:from-primary hover:via-primary hover:to-primary/90 hover:text-primary-foreground hover:border-primary hover:shadow-primary/30'
                            )}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none" />
                            {portions.length > 1 && (
                                <span className="text-xs opacity-70 group-hover:opacity-100 uppercase tracking-wider font-black relative z-10">
                                    {portion.name}
                                </span>
                            )}
                            <div className="flex items-center justify-center relative z-10">
                                <span className="text-base font-black">{formatCurrency(Number(portion.price || 0))}</span>
                            </div>
                            {portionQty > 0 && (
                                <span className="text-[10px] font-bold opacity-80 relative z-10">×{portionQty}</span>
                            )}
                        </motion.button>
                    );
                })}
            </div>
        </motion.div>
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
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [restaurantId, setRestaurantId] = useState(null);
    const [taxSettings, setTaxSettings] = useState({ gstEnabled: false, gstRate: 5, gstCalculationMode: 'included' });

    // UI state
    const [selectedTable, setSelectedTable] = useState(null);
    const [selectedTab, setSelectedTab] = useState(null);
    const [cart, setCart] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isSending, setIsSending] = useState(false);
    const [isCreatingTab, setIsCreatingTab] = useState(false);
    const [closingTabId, setClosingTabId] = useState('');
    const [showNewTabModal, setShowNewTabModal] = useState(false);
    const [newTabName, setNewTabName] = useState('');
    const [newTabPax, setNewTabPax] = useState(2);
    const [activeCategory, setActiveCategory] = useState('');
    const [mobilePanel, setMobilePanel] = useState('menu');
    const [showTables, setShowTables] = useState(true);
    const [menuExpanded, setMenuExpanded] = useState(false);
    const [customizeState, setCustomizeState] = useState({
        isOpen: false,
        item: null,
        portion: null,
        selectedAddOns: [],
        itemNote: ''
    });
    const [noteEditor, setNoteEditor] = useState({ isOpen: false, cartKey: '', note: '' });

    const audioRef = useRef(null);
    const menuScrollRef = useRef(null);
    const categorySectionRefs = useRef({});
    const hasLoadedOnceRef = useRef(false);

    // Build query string for API calls
    const buildQueryString = useCallback(() => {
        const params = new URLSearchParams();
        if (impersonatedOwnerId) params.append('impersonate_owner_id', impersonatedOwnerId);
        if (employeeOfOwnerId) params.append('employee_of', employeeOfOwnerId);
        return params.toString() ? `?${params.toString()}` : '';
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    // Fetch tables and menu
    const fetchData = useCallback(async () => {
        const showFullScreenLoader = !hasLoadedOnceRef.current;
        if (showFullScreenLoader) {
            setLoading(true);
        } else {
            setIsRefreshing(true);
        }
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');

            const idToken = await user.getIdToken();
            const queryString = buildQueryString();

            // Fetch tables
            const tablesEndpoint = `/api/owner/dine-in-tables${queryString ? `${queryString}&include_empty_tabs=1` : '?include_empty_tabs=1'}`;
            const tablesRes = await fetch(tablesEndpoint, {
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
                    gstCalculationMode: settingsData.gstCalculationMode || (settingsData.gstIncludedInPrice === false ? 'excluded' : 'included'),
                });
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to load data: ' + error.message });
        } finally {
            hasLoadedOnceRef.current = true;
            if (showFullScreenLoader) {
                setLoading(false);
            } else {
                setIsRefreshing(false);
            }
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

    const menuCategoryIds = useMemo(() => {
        return Object.keys(menu || {})
            .filter((categoryId) => Array.isArray(menu?.[categoryId]) && menu[categoryId].length > 0)
            .sort((a, b) => String(a).localeCompare(String(b)));
    }, [menu]);

    useEffect(() => {
        if (!menuCategoryIds.length) {
            setActiveCategory('');
            return;
        }
        if (!activeCategory || !menuCategoryIds.includes(activeCategory)) {
            setActiveCategory(menuCategoryIds[0]);
        }
    }, [menuCategoryIds, activeCategory]);

    const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

    const visibleMenuEntries = useMemo(() => {
        const entries = [];
        for (const categoryId of menuCategoryIds) {
            const categoryItems = Array.isArray(menu[categoryId]) ? menu[categoryId] : [];
            const filtered = categoryItems
                .filter((item) => item?.isAvailable !== false)
                .filter((item) => {
                    if (!normalizedSearchQuery) return true;
                    const itemName = String(item?.name || '').toLowerCase();
                    return itemName.includes(normalizedSearchQuery);
                })
                .map((item) => ({
                    ...item,
                    categoryName: categoryId,
                    price: item?.portions?.[0]?.price || item?.price || 0
                }));

            if (filtered.length > 0) {
                entries.push([categoryId, filtered]);
            }
        }
        return entries;
    }, [menu, menuCategoryIds, normalizedSearchQuery]);

    const scopedMenuEntries = useMemo(() => visibleMenuEntries, [visibleMenuEntries]);

    const totalVisibleItems = useMemo(() => {
        return scopedMenuEntries.reduce((sum, [, items]) => sum + items.length, 0);
    }, [scopedMenuEntries]);

    useEffect(() => {
        if (!scopedMenuEntries.length) {
            setActiveCategory('');
            return;
        }
        const firstCategory = scopedMenuEntries[0][0];
        if (!activeCategory || !scopedMenuEntries.some(([categoryId]) => categoryId === activeCategory)) {
            setActiveCategory(firstCategory);
        }
    }, [scopedMenuEntries, activeCategory]);

    useEffect(() => {
        if (!selectedTable) return;
        if (mobilePanel !== 'menu') return;
        if (!scopedMenuEntries.length) return;

        let cleanup = () => { };
        const raf = requestAnimationFrame(() => {
            const container = menuScrollRef.current;
            if (!container) return;

            const handleScroll = () => {
                const containerRect = container.getBoundingClientRect();
                let currentCategory = scopedMenuEntries[0][0];

                for (const [categoryId] of scopedMenuEntries) {
                    const section = categorySectionRefs.current[categoryId];
                    if (!section) continue;
                    const sectionTop = section.getBoundingClientRect().top - containerRect.top;
                    // Activate only when section heading reaches near top of scroll container.
                    if (sectionTop <= 24) {
                        currentCategory = categoryId;
                    }
                }

                setActiveCategory((prev) => (prev === currentCategory ? prev : currentCategory));
            };

            container.addEventListener('scroll', handleScroll, { passive: true });
            handleScroll();
            cleanup = () => container.removeEventListener('scroll', handleScroll);
        });

        return () => {
            cancelAnimationFrame(raf);
            cleanup();
        };
    }, [scopedMenuEntries, selectedTable, mobilePanel]);

    const handleCategoryJump = useCallback((categoryId) => {
        setActiveCategory(categoryId);
        const container = menuScrollRef.current;
        const section = categorySectionRefs.current[categoryId];
        if (!container || !section) return;
        const containerRect = container.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const targetTop = container.scrollTop + (sectionRect.top - containerRect.top) - 8;
        container.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
        });
    }, []);

    // Cart functions — NO add-on dialogs, always direct add for speed
    const handleIncrement = useCallback((item, selectedPortion = null, options = {}) => {

        const selectedAddOns = Array.isArray(options?.selectedAddOns) ? options.selectedAddOns : [];
        const itemNote = String(options?.itemNote || '');
        const addOnTotal = selectedAddOns.reduce((sum, addon) => sum + (Number(addon?.price || 0) * Number(addon?.quantity || 1)), 0);
        const effectivePortion = selectedPortion
            || (Array.isArray(item?.portions) && item.portions.length === 1 ? item.portions[0] : null);
        const portionName = effectivePortion?.name || 'default';
        const baseUnitPrice = Number(effectivePortion?.price ?? item?.price ?? item?.portions?.[0]?.price ?? 0);
        const unitPrice = baseUnitPrice + addOnTotal;
        const addOnSignature = getAddonSignature(selectedAddOns);
        const cartKey = buildCartKey(item.id, portionName, addOnSignature);

        setCart(prev => {
            const existing = prev[cartKey];
            return {
                ...prev,
                [cartKey]: {
                    ...(existing || {}),
                    ...item,
                    cartKey,
                    price: unitPrice,
                    portion: effectivePortion ? { name: effectivePortion.name, price: unitPrice } : null,
                    selectedAddOns,
                    itemNote,
                    addOnSignature,
                    quantity: (existing?.quantity || 0) + 1
                }
            };
        });
    }, []);

    const handleDecrement = useCallback((cartKey) => {
        setCart(prev => {
            const item = prev[cartKey];
            if (!item || item.quantity <= 1) {
                const { [cartKey]: removed, ...rest } = prev;
                return rest;
            }
            return {
                ...prev,
                [cartKey]: { ...item, quantity: item.quantity - 1 }
            };
        });
    }, []);

    const cartTotal = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }, [cart]);

    const cartCount = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
    }, [cart]);

    const cartItems = useMemo(() => Object.values(cart), [cart]);
    const getEffectiveTabId = useCallback((tab, fallbackId = null) => {
        const resolvedId = tab?.dineInTabId || tab?.id || fallbackId || null;
        return resolvedId ? String(resolvedId) : null;
    }, []);
    const selectedTabId = useMemo(() => getEffectiveTabId(selectedTab), [selectedTab, getEffectiveTabId]);
    const getItemTotalQuantity = useCallback((itemId) => (
        Object.values(cart).reduce((sum, cartItem) => (
            cartItem?.id === itemId ? sum + Number(cartItem?.quantity || 0) : sum
        ), 0)
    ), [cart]);

    const getVariantQuantity = useCallback((itemId, portionName) => {
        return Object.values(cart).reduce((sum, cartItem) => {
            const sameItem = cartItem?.id === itemId;
            const samePortion = normalizePortionName(cartItem?.portion?.name || 'default') === normalizePortionName(portionName);
            return sameItem && samePortion ? sum + Number(cartItem?.quantity || 0) : sum;
        }, 0);
    }, [cart]);

    // Handle table selection
    const handleTableClick = (table) => {
        setSelectedTable(table);
        setSelectedTab(null);
        setCart({});
        setMobilePanel('menu');

        // If table has active tabs, show them - auto select if only 1 group exists
        const activeTabs = table.tabs ? Object.values(table.tabs) : [];
        const pendingOrders = table.pendingOrders || [];
        const totalGroups = activeTabs.length + pendingOrders.length;

        if (totalGroups === 1) {
            if (activeTabs.length === 1) {
                // Auto-select the single active tab
                const tabId = Object.keys(table.tabs)[0];
                const activeTab = table.tabs[tabId];
                const effectiveTabId = getEffectiveTabId(activeTab, tabId);
                setSelectedTab({ ...activeTab, id: effectiveTabId, dineInTabId: effectiveTabId });
            } else if (pendingOrders.length === 1) {
                // Auto-select the single pending order group
                // Pending orders usually have ID as group ID, but we need to ensure dineInTabId is used if available
                const order = pendingOrders[0];
                const effectiveTabId = getEffectiveTabId(order, order.id);
                setSelectedTab({ ...order, id: effectiveTabId, dineInTabId: effectiveTabId });
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

        setIsCreatingTab(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await user.getIdToken();
            const queryString = buildQueryString();

            const res = await fetch(`/api/owner/dine-in-tables${queryString}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    action: 'create_tab',
                    tableId: selectedTable.id,
                    pax_count: newTabPax,
                    tab_name: newTabName.trim()
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            // Auto-select the newly created tab so subsequent orders are attached to it
            setSelectedTab({
                id: data.tabId,
                dineInTabId: data.tabId,
                tab_name: newTabName.trim() || 'Guest',
                pax_count: newTabPax,
                orders: {},
                orderBatches: []
            });

            setShowNewTabModal(false);
            setNewTabName('');
            setNewTabPax(2);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab created successfully!' });

            // Refresh data
            fetchData();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setIsCreatingTab(false);
        }
    };

    const handleCloseEmptyTab = async (tab) => {
        const effectiveTabId = getEffectiveTabId(tab);
        const tableId = selectedTable?.id || tab?.tableId;
        if (!effectiveTabId || !tableId || !restaurantId) return;

        const confirmClose = window.confirm(`Close tab "${tab?.tab_name || 'Guest'}" and free these seats?`);
        if (!confirmClose) return;

        setClosingTabId(effectiveTabId);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await user.getIdToken();

            const res = await fetch('/api/dine-in/clean-table', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    tabId: effectiveTabId,
                    dineInTabId: effectiveTabId,
                    tableId,
                    restaurantId
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to close tab');

            if (selectedTabId === effectiveTabId) {
                setSelectedTab(null);
                setCart({});
            }

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab closed and seats released.' });
            fetchData();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message || 'Failed to close tab.' });
        } finally {
            setClosingTabId('');
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
                portion: item.portion || null,
                selectedAddOns: item.selectedAddOns || [],
                itemNote: item.itemNote || '',
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
            const gstCalculationMode = taxSettings.gstCalculationMode || 'included';

            if (taxSettings.gstEnabled) {
                const rate = taxSettings.gstRate || 5;
                if (gstCalculationMode === 'included') {
                    const baseAmount = subtotal / (1 + (rate / 100));
                    const gstTotal = subtotal - baseAmount;
                    const halfGst = gstTotal / 2;
                    cgst = Math.round(halfGst * 100) / 100;
                    sgst = Math.round(halfGst * 100) / 100;
                } else {
                    const halfRate = rate / 2;
                    cgst = Math.round(subtotal * (halfRate / 100) * 100) / 100;
                    sgst = Math.round(subtotal * (halfRate / 100) * 100) / 100;
                }
            }

            const grandTotal = gstCalculationMode === 'included'
                ? subtotal
                : (subtotal + cgst + sgst);

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
                dineInTabId: selectedTab?.dineInTabId || selectedTab?.id || null,
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

            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

            // Redirect back to dine-in page with success toast
            const queryString = buildQueryString();
            router.push(`/owner-dashboard/dine-in${queryString}`);
        } catch (error) {
            console.error('Error sending order:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setIsSending(false);
        }
    };

    const toggleCustomizeAddon = (group, option) => {
        if (!group || !option) return;
        setCustomizeState((prev) => {
            const current = Array.isArray(prev.selectedAddOns) ? prev.selectedAddOns : [];
            const groupTitle = String(group?.title || '').trim();
            const optionName = String(option?.name || '').trim();
            const optionPrice = Number(option?.price || 0);
            const isRadio = String(group?.type || '').toLowerCase() === 'radio';
            const exists = current.some((addon) => addon.groupTitle === groupTitle && addon.name === optionName);

            let next = current;
            if (isRadio) {
                next = current.filter((addon) => addon.groupTitle !== groupTitle);
                if (!exists) {
                    next = [...next, { groupTitle, name: optionName, price: optionPrice, quantity: 1 }];
                }
            } else {
                if (exists) {
                    next = current.filter((addon) => !(addon.groupTitle === groupTitle && addon.name === optionName));
                } else {
                    next = [...current, { groupTitle, name: optionName, price: optionPrice, quantity: 1 }];
                }
            }
            return { ...prev, selectedAddOns: next };
        });
    };

    const confirmCustomization = () => {
        if (!customizeState?.item) return;
        handleIncrement(customizeState.item, customizeState.portion, {
            skipCustomize: true,
            selectedAddOns: customizeState.selectedAddOns,
            itemNote: customizeState.itemNote
        });
        setCustomizeState({ isOpen: false, item: null, portion: null, selectedAddOns: [], itemNote: '' });
    };

    const openNoteEditor = (cartItem) => {
        setNoteEditor({
            isOpen: true,
            cartKey: cartItem?.cartKey || '',
            note: String(cartItem?.itemNote || '')
        });
    };

    const saveItemNote = () => {
        if (!noteEditor?.cartKey) return;
        setCart((prev) => {
            const current = prev[noteEditor.cartKey];
            if (!current) return prev;
            return {
                ...prev,
                [noteEditor.cartKey]: {
                    ...current,
                    itemNote: String(noteEditor.note || '').trim()
                }
            };
        });
        setNoteEditor({ isOpen: false, cartKey: '', note: '' });
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
                        <Button onClick={handleCreateTab} disabled={isCreatingTab || !newTabName.trim()}>
                            {isCreatingTab ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                            {isCreatingTab ? 'Creating...' : 'Create Tab'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={customizeState.isOpen}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setCustomizeState({ isOpen: false, item: null, portion: null, selectedAddOns: [], itemNote: '' });
                    }
                }}
            >
                <DialogContent className="bg-card border-border text-foreground max-w-md">
                    <DialogHeader>
                        <DialogTitle>Customize Item</DialogTitle>
                        <DialogDescription>
                            {customizeState?.item?.name || 'Item'}
                            {customizeState?.portion?.name ? ` (${customizeState.portion.name})` : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                        {(customizeState?.item?.addOnGroups || []).map((group, groupIndex) => (
                            <div key={`${group?.title || 'group'}-${groupIndex}`} className="rounded-lg border border-border p-3">
                                <p className="font-semibold text-sm mb-2">
                                    {group?.title || 'Add-on'}
                                    <span className="ml-2 text-xs text-muted-foreground uppercase">{String(group?.type || 'checkbox')}</span>
                                </p>
                                <div className="grid grid-cols-1 gap-2">
                                    {(group?.options || []).map((option, optionIndex) => {
                                        const isSelected = (customizeState.selectedAddOns || []).some((addon) =>
                                            addon.groupTitle === String(group?.title || '').trim() &&
                                            addon.name === String(option?.name || '').trim()
                                        );
                                        return (
                                            <button
                                                key={`${option?.name || 'opt'}-${optionIndex}`}
                                                type="button"
                                                onClick={() => toggleCustomizeAddon(group, option)}
                                                className={cn(
                                                    "h-10 rounded-md border px-3 text-sm font-medium flex items-center justify-between transition-colors",
                                                    isSelected
                                                        ? "border-primary bg-primary/15 text-primary"
                                                        : "border-border bg-background text-foreground hover:bg-muted"
                                                )}
                                            >
                                                <span>{option?.name || 'Option'}</span>
                                                <span>{formatCurrency(Number(option?.price || 0))}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <div>
                            <label className="text-sm font-medium">Item Note (Optional)</label>
                            <Input
                                value={customizeState.itemNote}
                                onChange={(e) => setCustomizeState((prev) => ({ ...prev, itemNote: e.target.value }))}
                                placeholder="e.g. less spicy, no onion"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCustomizeState({ isOpen: false, item: null, portion: null, selectedAddOns: [], itemNote: '' })}>
                            Cancel
                        </Button>
                        <Button onClick={confirmCustomization}>Add to Cart</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={noteEditor.isOpen} onOpenChange={(isOpen) => !isOpen && setNoteEditor({ isOpen: false, cartKey: '', note: '' })}>
                <DialogContent className="bg-card border-border text-foreground max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Item Note</DialogTitle>
                        <DialogDescription>Add a specific note for this cart item.</DialogDescription>
                    </DialogHeader>
                    <Input
                        value={noteEditor.note}
                        onChange={(e) => setNoteEditor((prev) => ({ ...prev, note: e.target.value }))}
                        placeholder="e.g. less spicy, no onion"
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNoteEditor({ isOpen: false, cartKey: '', note: '' })}>Cancel</Button>
                        <Button onClick={saveItemNote}>Save Note</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Header — compact single row with optional tables strip */}
            <div className={cn("border-b border-border bg-card/50 backdrop-blur-sm", menuExpanded && "hidden")}>
                {/* Top bar */}
                <div className="flex items-center gap-2 px-3 py-2">
                    <Link
                        href={`/owner-dashboard/dine-in${buildQueryString()}`}
                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-background hover:bg-muted transition-colors flex-shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </Link>
                    <div className="w-7 h-7 bg-primary/15 rounded-lg flex items-center justify-center flex-shrink-0">
                        <UtensilsCrossed className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-bold text-sm text-foreground flex-1">Create Dine-In Order</span>

                    {/* Toggle tables visibility */}
                    <button
                        onClick={() => setShowTables(v => !v)}
                        className={cn(
                            "flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                            showTables
                                ? "bg-primary/10 border-primary/40 text-primary"
                                : "bg-muted border-border text-muted-foreground"
                        )}
                    >
                        {showTables ? 'Hide Tables' : 'Show Tables'}
                    </button>

                    <Button variant="ghost" size="icon" onClick={fetchData} disabled={isRefreshing} className="h-8 w-8 flex-shrink-0">
                        <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                    </Button>
                </div>

                {/* Tables Scroll — collapsible */}
                {showTables && (
                    <div className="flex gap-2 overflow-x-auto px-3 pb-2 no-scrollbar">
                        {tables.length === 0 ? (
                            <p className="text-muted-foreground text-xs py-1">No tables found.</p>
                        ) : (
                            tables.map(table => (
                                <TableBadge
                                    key={table.id}
                                    table={table}
                                    isSelected={selectedTable?.id === table.id}
                                    onClick={() => handleTableClick(table)}
                                />
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {selectedTable ? (
                    <>
                        {/* Selected Table Info — single compact strip */}
                        <div className={cn("flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/20 overflow-x-auto no-scrollbar", menuExpanded && "hidden")}>
                            {/* Table badge */}
                            <span className="font-black text-base text-primary flex-shrink-0">T{selectedTable.id}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">{selectedTable.current_pax || 0}/{selectedTable.max_capacity}💺</span>

                            {/* Tab pills */}
                            {Object.entries(selectedTable.tabs || {}).map(([tabId, tab]) => {
                                const effectiveTabId = getEffectiveTabId(tab, tabId);
                                const tabWithId = { ...tab, id: effectiveTabId, dineInTabId: effectiveTabId };
                                const hasOrders = (Array.isArray(tab?.orderBatches) && tab.orderBatches.length > 0) ||
                                    (tab?.orders && Object.keys(tab.orders).length > 0) ||
                                    Number(tab?.totalAmount || 0) > 0;
                                return (
                                    <div key={effectiveTabId || tabId} className={cn(
                                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border flex-shrink-0",
                                        selectedTabId === effectiveTabId
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                                    )}>
                                        <button onClick={() => setSelectedTab(tabWithId)}>
                                            {tab.tab_name} ({tab.pax_count})
                                        </button>
                                        {!hasOrders && (
                                            <button onClick={(e) => { e.stopPropagation(); handleCloseEmptyTab(tabWithId); }}
                                                disabled={closingTabId === effectiveTabId}
                                                className="ml-0.5 opacity-60 hover:opacity-100">
                                                {closingTabId === effectiveTabId ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                            {(selectedTable.pendingOrders || []).map(order => (
                                <button key={order.id}
                                    onClick={() => { const eid = getEffectiveTabId(order, order.id); setSelectedTab({ ...order, id: eid, dineInTabId: eid }); }}
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border-2 border-dashed flex-shrink-0",
                                        selectedTabId === getEffectiveTabId(order, order.id)
                                            ? "bg-yellow-500 text-black border-yellow-500"
                                            : "bg-yellow-500/10 text-yellow-500 border-yellow-500/50"
                                    )}>
                                    {order.tab_name || 'Pending'} ⏳
                                </button>
                            ))}

                            {/* Divider + New Tab */}
                            <div className="ml-auto flex-shrink-0">
                                <button
                                    onClick={() => setShowNewTabModal(true)}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 border border-primary/40 text-primary text-xs font-bold hover:bg-primary hover:text-primary-foreground transition-all"
                                >
                                    <Plus size={12} /> New Tab
                                </button>
                            </div>
                        </div>

                        {/* Menu + Cart Layout — Menu takes full left space */}
                        <div className="flex-1 overflow-hidden p-3">
                            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 h-full">

                                {/* MENU PANEL — full width */}
                                <div className={cn("rounded-xl border border-border bg-card p-3 flex flex-col min-h-0", mobilePanel !== 'menu' && "hidden md:flex")}>
                                    {/* Horizontal category pills + expand button */}
                                    <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar mb-2 border-b border-border">
                                        {menuCategoryIds.map((categoryId) => (
                                            <button
                                                key={categoryId}
                                                onClick={() => handleCategoryJump(categoryId)}
                                                className={cn(
                                                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap",
                                                    activeCategory === categoryId
                                                        ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30"
                                                        : "bg-muted/30 text-foreground border-border hover:border-primary/50 hover:bg-muted"
                                                )}
                                            >
                                                {formatCategoryLabel(categoryId)}
                                            </button>
                                        ))}
                                        {/* Expand / Collapse menu to full height */}
                                        <button
                                            onClick={() => setMenuExpanded(v => !v)}
                                            title={menuExpanded ? 'Restore view' : 'Expand menu (hide top bar)'}
                                            className={cn(
                                                "ml-auto flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border transition-all",
                                                menuExpanded
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-muted/30 border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                                            )}
                                        >
                                            {menuExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                        </button>
                                    </div>

                                    {/* Search */}
                                    <div className="relative mb-3">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                                        <Input
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search menu..."
                                            className="pl-9 h-9 text-sm"
                                        />
                                        {searchQuery && (
                                            <button
                                                onClick={() => setSearchQuery('')}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>

                                    <div ref={menuScrollRef} className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                        {totalVisibleItems === 0 ? (
                                            <p className="text-center text-muted-foreground py-12">No items found</p>
                                        ) : (
                                            <div className="space-y-5">
                                                {scopedMenuEntries.map(([categoryId, items]) => (
                                                    <section key={categoryId} ref={(node) => { categorySectionRefs.current[categoryId] = node; }}>
                                                        <h5 className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 px-3 z-10 mb-3 border-l-4 border-primary font-bold text-base capitalize text-foreground tracking-wide">
                                                            {formatCategoryLabel(categoryId)}
                                                        </h5>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                                            {items.map((item) => (
                                                                <MenuItemCard
                                                                    key={item.id}
                                                                    item={item}
                                                                    quantity={getItemTotalQuantity(item.id)}
                                                                    onIncrement={handleIncrement}
                                                                    onDecrement={handleDecrement}
                                                                    getVariantQuantity={getVariantQuantity}
                                                                />
                                                            ))}
                                                        </div>
                                                    </section>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className={cn("rounded-xl border border-border bg-card p-4 flex flex-col min-h-0", mobilePanel !== 'order' && "hidden md:flex")}>
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-bold text-lg">Current Order</h4>
                                        {cartCount > 0 && (
                                            <Button variant="outline" size="sm" onClick={() => setCart({})}>
                                                <Trash2 size={14} className="mr-1" /> Clear
                                            </Button>
                                        )}
                                    </div>

                                    <div className="text-sm text-muted-foreground mb-3">
                                        {selectedTab?.tab_name ? `Tab: ${selectedTab.tab_name}` : 'No active tab selected'}
                                    </div>

                                    <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                                        {cartItems.length === 0 ? (
                                            <p className="text-sm text-muted-foreground py-6 text-center">No items added yet</p>
                                        ) : (
                                            cartItems.map((item) => (
                                                <div key={item.cartKey} className="rounded-lg border border-border bg-background px-3 py-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="font-medium text-sm truncate">
                                                            {item.name}
                                                            {item?.portion?.name ? <span className="ml-1 text-xs text-muted-foreground">({item.portion.name})</span> : null}
                                                        </p>
                                                        <p className="text-sm font-semibold">{formatCurrency(item.price * item.quantity)}</p>
                                                    </div>
                                                    {Array.isArray(item.selectedAddOns) && item.selectedAddOns.length > 0 && (
                                                        <p className="mt-1 text-xs text-muted-foreground truncate">
                                                            Add-ons: {item.selectedAddOns.map((addon) => addon.name).join(', ')}
                                                        </p>
                                                    )}
                                                    {item.itemNote && (
                                                        <p className="mt-1 text-xs text-primary truncate">Note: {item.itemNote}</p>
                                                    )}
                                                    <div className="mt-2 flex items-center justify-between">
                                                        <p className="text-xs text-muted-foreground">{formatCurrency(item.price)} each</p>
                                                        <div className="flex items-center gap-1">
                                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openNoteEditor(item)}>
                                                                <Pencil size={13} />
                                                            </Button>
                                                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleDecrement(item.cartKey)}>
                                                                <Minus size={14} />
                                                            </Button>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={item.quantity}
                                                                onChange={(e) => {
                                                                    const val = parseInt(e.target.value, 10);
                                                                    if (isNaN(val) || val < 1) return;
                                                                    setCart(prev => {
                                                                        const existing = prev[item.cartKey];
                                                                        if (!existing) return prev;
                                                                        return { ...prev, [item.cartKey]: { ...existing, quantity: val } };
                                                                    });
                                                                }}
                                                                onClick={(e) => e.target.select()}
                                                                className="w-10 text-center text-sm font-bold bg-transparent border-b border-primary/50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            />
                                                            <Button size="icon" className="h-7 w-7" onClick={() => handleIncrement(item, item?.portion || null)}>
                                                                <Plus size={14} />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div className="pt-3 mt-3 border-t border-border space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Items</span>
                                            <span className="font-semibold">{cartCount}</span>
                                        </div>
                                        <div className="flex justify-between text-lg font-bold">
                                            <span>Total</span>
                                            <span>{formatCurrency(cartTotal)}</span>
                                        </div>
                                        <Button
                                            onClick={handleSendOrder}
                                            disabled={isSending || cartCount === 0}
                                            className="w-full h-11 text-base bg-primary hover:bg-primary/90"
                                        >
                                            {isSending ? <Loader2 className="animate-spin mr-2" size={18} /> : <Send className="mr-2" size={18} />}
                                            Send Order
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Custom Scrollbar Styles */}
                            <style jsx>{`
                                .custom-scrollbar::-webkit-scrollbar {
                                    width: 6px;
                                }
                                .custom-scrollbar::-webkit-scrollbar-track {
                                    background: transparent;
                                }
                                .custom-scrollbar::-webkit-scrollbar-thumb {
                                    background: hsl(var(--muted-foreground) / 0.3);
                                    border-radius: 3px;
                                }
                                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                                    background: hsl(var(--muted-foreground) / 0.5);
                                }
                            `}</style>
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
