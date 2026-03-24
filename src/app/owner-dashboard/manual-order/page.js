"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin, RotateCcw, Edit, Trash2, PlusCircle, CheckCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BillToPrint from '@/components/BillToPrint';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from "@/components/ui/use-toast";

import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { connectSerialPrinter, printSerialData } from '@/services/printer/webSerialPrinter';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const createBillDraftId = () => `cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const formatCategoryLabel = (categoryId = '') => String(categoryId).replace(/-/g, ' ').trim();
const dedupeOpenItems = (items = []) => {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = `${String(item?.name || '').trim().toLowerCase()}|${Number(item?.price || 0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
};
const isEditableTarget = (target) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    if (target.isContentEditable) return true;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
};

function ManualOrderPage() {
    const { toast } = useToast();
    const [menu, setMenu] = useState({});
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restaurant, setRestaurant] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSavingBillHistory, setIsSavingBillHistory] = useState(false);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const billPrintRef = useRef();
    const tablePrintRef = useRef(null);

    const [customerDetails, setCustomerDetails] = useState({
        name: '',
        phone: '',
        address: ''
    });
    const [orderType, setOrderType] = useState('delivery'); // 'delivery', 'dine-in', 'pickup'
    const [activeTable, setActiveTable] = useState(null);
    const [manualTables, setManualTables] = useState([]);
    const [isLoadingTables, setIsLoadingTables] = useState(false);
    const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
    const [newTableName, setNewTableName] = useState('');
    const [selectedOccupiedTable, setSelectedOccupiedTable] = useState(null);
    const [tableActionLoading, setTableActionLoading] = useState(false);
    const [tableToPrint, setTableToPrint] = useState(null); // Holds table data briefly for printing
    const [deliveryChargeInput, setDeliveryChargeInput] = useState('0');
    const [additionalChargeNameInput, setAdditionalChargeNameInput] = useState('');
    const [additionalChargeInput, setAdditionalChargeInput] = useState('0');

    // State to control modal visibility
    const [isBillModalOpen, setIsBillModalOpen] = useState(false);
    const [usbDevice, setUsbDevice] = useState(null);
    const [serialPort, setSerialPort] = useState(null);
    const [activeCategory, setActiveCategory] = useState('');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [isNoAddressDialogOpen, setIsNoAddressDialogOpen] = useState(false);
    const [qtyInputMap, setQtyInputMap] = useState({}); // local display value per cartItemId
    const [itemHistory, setItemHistory] = useState([]); // Track addition order for Undo
    const [billDraftId, setBillDraftId] = useState(() => createBillDraftId());
    const [openItems, setOpenItems] = useState([]); // Open items from Firestore
    const [cacheStatus, setCacheStatus] = useState('checking');
    const hasHydratedFromCacheRef = useRef(false);
    const scrollContainerRef = useRef(null);
    const categoryRefs = useRef({});
    const searchInputRef = useRef(null);
    const sidebarRef = useRef(null);
    const isResizing = useRef(false);
    const [manualSidebarWidth, setManualSidebarWidth] = useState(null); // null means use dynamic default
    
    const billContainerRef = useRef(null);
    const isResizingBill = useRef(false);
    const [billSidebarWidth, setBillSidebarWidth] = useState(340);
    const [isCustomerDetailsOpen, setIsCustomerDetailsOpen] = useState(true);
    const accessQuery = impersonatedOwnerId
        ? `impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '';
    const historyUrl = impersonatedOwnerId
        ? `/owner-dashboard/manual-order-history?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `/owner-dashboard/manual-order-history?employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '/owner-dashboard/manual-order-history';
    // Auto-collapse customer details when first item is added to cart
    const prevCartLengthRef = useRef(0);
    useEffect(() => {
        if (prevCartLengthRef.current === 0 && cart.length > 0) {
            setIsCustomerDetailsOpen(false);
        }
        prevCartLengthRef.current = cart.length;
    }, [cart.length]);

    const cacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_custom_bill_cache_v2_${scope}`;
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const buildScopedUrl = useCallback((endpoint) => {
        const url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }
        return url.toString();
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const readCachedPayload = useCallback(() => {
        try {
            const raw = localStorage.getItem(cacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.data ? parsed : null;
        } catch {
            return null;
        }
    }, [cacheKey]);

    const writeCachedPayload = useCallback((data = {}) => {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                ts: Date.now(),
                data,
            }));
        } catch {
            // Ignore storage errors
        }
    }, [cacheKey]);

    // useReactToPrint hook setup
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
        documentTitle: `Bill-${Date.now()}`,
        onAfterPrint: () => setIsBillModalOpen(false), // Close modal after printing
    });

    const handleTablePrint = useReactToPrint({
        content: () => tablePrintRef.current,
        documentTitle: `Table-Bill-${Date.now()}`,
    });

    useEffect(() => {
        if (tableToPrint && handleTablePrint) {
            handleTablePrint();
            // Automatically clear after a short delay so consecutive prints work
            const timer = setTimeout(() => setTableToPrint(null), 1000);
            return () => clearTimeout(timer);
        }
    }, [tableToPrint, handleTablePrint]);

    useEffect(() => {
        if (hasHydratedFromCacheRef.current) return;
        hasHydratedFromCacheRef.current = true;
        const cached = readCachedPayload();
        if (!cached) {
            setCacheStatus('empty');
            return;
        }
        const payload = cached.data || {};
        if (payload.menu && typeof payload.menu === 'object') setMenu(payload.menu);
        if (Array.isArray(payload.openItems)) setOpenItems(dedupeOpenItems(payload.openItems));
        if (payload.restaurant) setRestaurant(payload.restaurant);
        setCacheStatus('local-hit');
        setLoading(false);
    }, [readCachedPayload]);

    useEffect(() => {
        let isMounted = true;

        const fetchMenuAndSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("Authentication required.");
                const idToken = await user.getIdToken();

                const headers = { 'Authorization': `Bearer ${idToken}` };
                const menuUrl = buildScopedUrl('/api/owner/menu?compact=1&includeOpenItems=1');
                const settingsUrl = buildScopedUrl('/api/owner/settings');
                const versionUrl = buildScopedUrl('/api/owner/menu?versionOnly=1');

                const cached = readCachedPayload();
                let shouldFetchFullMenu = true;
                try {
                    const versionRes = await fetch(versionUrl, { headers });
                    if (versionRes.ok) {
                        const versionData = await versionRes.json();
                        const latestVersion = Number(versionData?.menuVersion || 0);
                        const cachedVersion = Number(cached?.data?.menuVersion ?? -1);
                        if (
                            cached &&
                            cachedVersion === latestVersion &&
                            cached?.data?.menu &&
                            typeof cached.data.menu === 'object'
                        ) {
                            setMenu(cached.data.menu || {});
                            setOpenItems(Array.isArray(cached.data.openItems) ? dedupeOpenItems(cached.data.openItems) : []);
                            if (cached?.data?.restaurant) setRestaurant(cached.data.restaurant);
                            setCacheStatus('version-hit');
                            setLoading(false);
                            shouldFetchFullMenu = false;
                        }
                    }
                } catch {
                    // Version check failure should not block menu loading.
                    setCacheStatus('check-failed');
                }

                if (!shouldFetchFullMenu) {
                    const settingsPromise = fetch(settingsUrl, { headers });
                    // Keep settings fresh in background when menu version is unchanged.
                    try {
                        const settingsRes = await settingsPromise;
                        if (settingsRes.ok && isMounted) {
                            const settingsData = await settingsRes.json();
                            const nextRestaurantPayload = {
                                name: settingsData.restaurantName,
                                address: settingsData.address,
                                gstin: settingsData.gstin,
                                gstEnabled: !!settingsData.gstEnabled,
                                gstPercentage: Number(settingsData.gstPercentage ?? settingsData.gstRate ?? 0),
                                gstMinAmount: Number(settingsData.gstMinAmount ?? 0),
                                gstCalculationMode: settingsData.gstCalculationMode || (settingsData.gstIncludedInPrice === false ? 'excluded' : 'included'),
                                serviceFeeEnabled: !!settingsData.serviceFeeEnabled,
                                serviceFeeLabel: settingsData.serviceFeeLabel || 'Additional Charge',
                                serviceFeeType: settingsData.serviceFeeType || 'fixed',
                                serviceFeeValue: Number(settingsData.serviceFeeValue) || 0,
                                serviceFeeApplyOn: settingsData.serviceFeeApplyOn || 'all',
                                serviceFeeApplyOnManualOrders: !!settingsData.serviceFeeApplyOnManualOrders,
                            };
                            setRestaurant(nextRestaurantPayload);
                            writeCachedPayload({
                                ...(cached?.data || {}),
                                restaurant: nextRestaurantPayload,
                            });
                        }
                    } catch {
                        // Non-blocking
                    }
                    return;
                }

                const menuPromise = fetch(menuUrl, { headers });
                const settingsPromise = fetch(settingsUrl, { headers });
                const menuRes = await menuPromise;

                if (!menuRes.ok) {
                    const menuError = await menuRes.json().catch(() => ({}));
                    throw new Error(menuError?.message || 'Failed to fetch menu.');
                }

                const menuData = await menuRes.json();
                const restaurantPayload = null;

                const openItemsData = { items: Array.isArray(menuData.openItems) ? menuData.openItems : [] };

                if (isMounted) {
                    setMenu(menuData.menu || {});
                    setOpenItems(dedupeOpenItems(openItemsData.items || []));
                    // Unblock UI as soon as menu is ready; settings can hydrate in background.
                    setCacheStatus('network-refresh');
                    setLoading(false);
                    if (restaurantPayload) {
                        setRestaurant(restaurantPayload);
                    }
                }

                writeCachedPayload({
                    menu: menuData.menu || {},
                    openItems: dedupeOpenItems(openItemsData.items || []),
                    restaurant: restaurantPayload,
                    menuVersion: Number(menuData?.menuVersion || 0),
                });

                // Hydrate settings after menu render (non-blocking for menu UI).
                try {
                    const settingsRes = await settingsPromise;
                    if (!isMounted) return;
                    if (!settingsRes.ok) {
                        const settingsError = await settingsRes.json().catch(() => ({}));
                        toast({
                            title: 'Warning',
                            description: `Menu loaded, but restaurant details could not load: ${settingsError?.message || 'Failed to fetch settings.'}`,
                            variant: 'warning'
                        });
                        return;
                    }

                    const settingsData = await settingsRes.json();
                    const nextRestaurantPayload = {
                        name: settingsData.restaurantName,
                        address: settingsData.address,
                        gstin: settingsData.gstin,
                        gstEnabled: !!settingsData.gstEnabled,
                        gstPercentage: Number(settingsData.gstPercentage ?? settingsData.gstRate ?? 0),
                        gstMinAmount: Number(settingsData.gstMinAmount ?? 0),
                        gstCalculationMode: settingsData.gstCalculationMode || (settingsData.gstIncludedInPrice === false ? 'excluded' : 'included'),
                        serviceFeeEnabled: !!settingsData.serviceFeeEnabled,
                        serviceFeeLabel: settingsData.serviceFeeLabel || 'Additional Charge',
                        serviceFeeType: settingsData.serviceFeeType || 'fixed',
                        serviceFeeValue: Number(settingsData.serviceFeeValue) || 0,
                        serviceFeeApplyOn: settingsData.serviceFeeApplyOn || 'all',
                        serviceFeeApplyOnManualOrders: !!settingsData.serviceFeeApplyOnManualOrders,
                    };
                    if (isMounted) setRestaurant(nextRestaurantPayload);

                    writeCachedPayload({
                        ...(readCachedPayload()?.data || {}),
                        menu: menuData.menu || {},
                        openItems: dedupeOpenItems(openItemsData.items || []),
                        restaurant: nextRestaurantPayload,
                        menuVersion: Number(menuData?.menuVersion || 0),
                    });
                } catch {
                    // Settings request is non-blocking; ignore failures here.
                }
            } catch (error) {
                if (isMounted) {
                    setCacheStatus('error');
                    toast({ title: 'Error', description: `Could not load menu: ${error.message}`, variant: 'destructive' });
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
    }, [accessQuery, buildScopedUrl, cacheKey, readCachedPayload, writeCachedPayload, toast]);

    const fetchManualTables = useCallback(async () => {
        setIsLoadingTables(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch(buildScopedUrl('/api/owner/manual-tables'), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                setManualTables(data.tables || []);
            }
        } catch (error) {
            console.error('Error fetching manual tables:', error);
            // Ignore toast or define later if we missed it
        } finally {
            setIsLoadingTables(false);
        }
    }, [buildScopedUrl]);

    useEffect(() => {
        if (orderType === 'dine-in') {
            fetchManualTables();
        }
    }, [orderType, fetchManualTables]);

    // Compute normalized search query
    const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

    // Define visibleMenuEntries BEFORE the scroll spy effect
    const visibleMenuEntries = useMemo(() => {
        const entries = [];

        // Keep regular categories in ascending order and reserve "open-items" for manual billing only.
        const sortedCategoryIds = Object.keys(menu || {})
            .filter((categoryId) => categoryId !== 'open-items')
            .sort((a, b) => formatCategoryLabel(a).localeCompare(formatCategoryLabel(b)));

        for (const categoryId of sortedCategoryIds) {
            const items = menu[categoryId];
            if (!Array.isArray(items) || items.length === 0) continue;
            const filteredItems = normalizedSearchQuery
                ? items.filter((item) => String(item?.name || '').toLowerCase().includes(normalizedSearchQuery))
                : items;
            if (filteredItems.length > 0) {
                const sortedItems = [...filteredItems].sort((a, b) => {
                    const nameA = String(a?.name || '').toLowerCase();
                    const nameB = String(b?.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });
                entries.push([categoryId, sortedItems]);
            }
        }

        const filteredOpenItems = normalizedSearchQuery
            ? openItems.filter((item) => String(item?.name || '').toLowerCase().includes(normalizedSearchQuery))
            : openItems;
        const sortedOpenItems = [...filteredOpenItems].sort((a, b) => {
            const nameA = String(a?.name || '').toLowerCase();
            const nameB = String(b?.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Always keep Open Items as the final section in manual billing sidebar.
        entries.push(['open-items', sortedOpenItems]);
        return entries;
    }, [menu, openItems, normalizedSearchQuery]);

    // Calculate dynamic default width based on the longest category name
    const defaultSidebarWidth = useMemo(() => {
        if (!visibleMenuEntries || visibleMenuEntries.length === 0) return 150;
        let maxLen = 0;
        for (const [categoryId] of visibleMenuEntries) {
            const label = formatCategoryLabel(categoryId);
            if (label.length > maxLen) {
                maxLen = label.length;
            }
        }
        // Estimate width: 8.5px per char (text-sm) + 50px for padding, scrollbar, margins
        return Math.max(130, Math.min(maxLen * 8.5 + 50, 400));
    }, [visibleMenuEntries]);

    const sidebarWidth = manualSidebarWidth !== null ? manualSidebarWidth : defaultSidebarWidth;

    // Handle Scroll Spy
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            // Use visibleMenuEntries to get all categories including open-items
            const categories = visibleMenuEntries.map(([catId]) => catId);
            if (categories.length === 0) return;

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
        const availableCategoryIds = visibleMenuEntries.map(([categoryId]) => categoryId);
        if (availableCategoryIds.length > 0) {
            setActiveCategory((prev) => (availableCategoryIds.includes(prev) ? prev : availableCategoryIds[0]));
        }
        return () => container.removeEventListener('scroll', handleScroll);
    }, [visibleMenuEntries]);

    const scrollToCategory = (catId) => {
        const element = document.getElementById(`cat-${catId}`);
        if (element && scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const top = element.offsetTop - container.offsetTop;
            container.scrollTo({ top, behavior: 'smooth' });
            setActiveCategory(catId);
        }
    };

    // --- Sidebar Resizing Logic ---
    const startResizing = useCallback((e) => {
        e.preventDefault(); // Prevent text selection while dragging
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // Prevent selection on body
    }, []);

    const stopResizing = useCallback(() => {
        if (!isResizing.current) return;
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left;
        const minWidth = 130;
        const maxWidth = Math.min(800, window.innerWidth * 0.5);
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            setManualSidebarWidth(newWidth);
        }
    }, []);

    // --- Bill Sidebar Resizing Logic ---
    const startResizingBill = useCallback((e) => {
        e.preventDefault();
        isResizingBill.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    const stopResizingBill = useCallback(() => {
        if (!isResizingBill.current) return;
        isResizingBill.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    const handleMouseMoveBill = useCallback((e) => {
        if (!isResizingBill.current || !billContainerRef.current) return;
        const rect = billContainerRef.current.getBoundingClientRect();
        const newWidth = rect.right - e.clientX;
        const minWidth = 280;
        const maxWidth = Math.min(800, window.innerWidth * 0.5);
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            setBillSidebarWidth(newWidth);
        }
    }, []);

    useEffect(() => {
        const onMouseMove = (e) => {
            if (isResizing.current) handleMouseMove(e);
            if (isResizingBill.current) handleMouseMoveBill(e);
        };
        const onMouseUp = () => {
            if (isResizing.current) stopResizing();
            if (isResizingBill.current) stopResizingBill();
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [handleMouseMove, stopResizing, handleMouseMoveBill, stopResizingBill]);
    // ------------------------------


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

    const handleUndo = useCallback(() => {
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
    }, [itemHistory]);

    useEffect(() => {
        const handleBackspaceUndo = (event) => {
            if (event.key !== 'Backspace' || event.repeat) return;

            const target = event.target;
            // Search bar should keep normal text delete behavior.
            if (searchInputRef.current && target === searchInputRef.current) return;
            // Keep native behavior in all other editable elements too.
            if (isEditableTarget(target)) return;
            if (itemHistory.length === 0) return;

            event.preventDefault();
            handleUndo();
        };

        window.addEventListener('keydown', handleBackspaceUndo);
        return () => window.removeEventListener('keydown', handleBackspaceUndo);
    }, [itemHistory, handleUndo]);

    const resetCurrentBill = () => {
        setCart([]);
        setItemHistory([]);
        setBillDraftId(createBillDraftId());
        setCustomerDetails({ name: '', phone: '', address: '' });
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

    const { subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, grandTotal } = useMemo(() => {
        const sub = cart.reduce((sum, item) => sum + item.totalPrice, 0);
        
        const normalizedDeliveryCharge = orderType === 'delivery' ? Math.max(0, Number(deliveryChargeInput) || 0) : 0;
        
        let normalizedAdditionalCharge = 0;
        let normalizedAdditionalChargeLabel = 'Additional Charge';

        const applyServiceFee = restaurant?.serviceFeeEnabled && restaurant?.serviceFeeApplyOnManualOrders && (restaurant?.serviceFeeApplyOn === 'all' || restaurant?.serviceFeeApplyOn === orderType);

        if (applyServiceFee) {
            normalizedAdditionalChargeLabel = restaurant.serviceFeeLabel || 'Additional Charge';
            if (restaurant.serviceFeeType === 'percentage') {
                normalizedAdditionalCharge = Math.round((sub * (Number(restaurant.serviceFeeValue) || 0)) / 100);
            } else {
                normalizedAdditionalCharge = Number(restaurant.serviceFeeValue) || 0;
            }
        }

        const gstEnabled = !!restaurant?.gstEnabled;
        const gstPercentage = Number(restaurant?.gstPercentage || 0);
        const gstMinAmount = Number(restaurant?.gstMinAmount || 0);
        const gstCalculationMode = restaurant?.gstCalculationMode || 'included';

        const shouldApplyGst = gstEnabled && gstPercentage > 0 && sub >= gstMinAmount;
        if (!shouldApplyGst) {
            return {
                subtotal: sub,
                cgst: 0,
                sgst: 0,
                deliveryCharge: normalizedDeliveryCharge,
                additionalCharge: normalizedAdditionalCharge,
                additionalChargeLabel: normalizedAdditionalChargeLabel,
                grandTotal: sub + normalizedDeliveryCharge + normalizedAdditionalCharge
            };
        }

        const halfRate = gstPercentage / 2;
        let localCgst = 0;
        let localSgst = 0;

        if (gstCalculationMode === 'included') {
            const baseAmount = sub / (1 + (gstPercentage / 100));
            const gstTotal = sub - baseAmount;
            localCgst = Math.round((gstTotal / 2) * 100) / 100;
            localSgst = Math.round((gstTotal / 2) * 100) / 100;
        } else {
            localCgst = Math.round((sub * halfRate) / 100);
            localSgst = Math.round((sub * halfRate) / 100);
        }

        const total = gstCalculationMode === 'included'
            ? (sub + normalizedDeliveryCharge + normalizedAdditionalCharge)
            : (sub + localCgst + localSgst + normalizedDeliveryCharge + normalizedAdditionalCharge);
        return {
            subtotal: sub,
            cgst: localCgst,
            sgst: localSgst,
            deliveryCharge: normalizedDeliveryCharge,
            additionalCharge: normalizedAdditionalCharge,
            additionalChargeLabel: normalizedAdditionalChargeLabel,
            grandTotal: total
        };
    }, [cart, restaurant, deliveryChargeInput, orderType]);

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
        const safeDeliveryCharge = Number(billDetails?.deliveryCharge || 0);
        const safeServiceFee = Number(billDetails?.serviceFee || 0);
        const safeServiceFeeLabel = String(billDetails?.serviceFeeLabel || 'Additional Charge').trim() || 'Additional Charge';
        const safeGrandTotal = Number(billDetails?.grandTotal || safeSubtotal + safeCgst + safeSgst + safeDeliveryCharge + safeServiceFee);

        // Totals
        encoder.text('--------------------------------').newline()
            .align('right');

        encoder.text(`Subtotal: ${safeSubtotal.toFixed(0)}`).newline();
        if (safeCgst > 0) encoder.text(`CGST: ${safeCgst.toFixed(0)}`).newline();
        if (safeSgst > 0) encoder.text(`SGST: ${safeSgst.toFixed(0)}`).newline();
        if (safeDeliveryCharge > 0) encoder.text(`Delivery: ${safeDeliveryCharge.toFixed(0)}`).newline();
        if (safeServiceFee > 0) encoder.text(`${safeServiceFeeLabel}: ${safeServiceFee.toFixed(0)}`).newline();

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
                toast({ title: 'Printed', description: 'Receipt sent to thermal printer (USB).' });
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
                toast({ title: 'Printed', description: 'Receipt sent to thermal printer (Serial).' });
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
            toast({
                title: 'Print Failed',
                description: `Could not print using USB or Serial.\n${readableError}`,
                variant: 'destructive'
            });
        }

        return { ok: false, error: lastError };
    };

    const saveCustomBillHistory = async (printedVia = 'browser', typeOverride = null) => {
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
                printedVia: typeOverride || orderType, // Use printedVia/orderType to distinguish offline types
                customerDetails,
                items: historyItems,
                billDetails: {
                    subtotal,
                    cgst,
                    sgst,
                    deliveryCharge,
                    serviceFee: additionalCharge,
                    serviceFeeLabel: additionalChargeLabel,
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

    const handleOccupyTable = async () => {
        if (!activeTable) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            
            const currentOrder = {
                items: cart,
                customerDetails,
                subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, grandTotal,
                orderType: 'dine-in'
            };

            const res = await fetch(buildScopedUrl(`/api/owner/manual-tables/${activeTable.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'occupy', currentOrder })
            });
            
            if (!res.ok) throw new Error('Failed to save to table');
            
            toast({ title: 'Saved', description: `Order saved to ${activeTable.name}` });
            setActiveTable(null);
            handleClear(); // Clear cart
            fetchManualTables();
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setTableActionLoading(false);
        }
    };

    const handleCreateTable = async () => {
        if (!newTableName.trim()) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            const res = await fetch(buildScopedUrl('/api/owner/manual-tables'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ name: newTableName })
            });
            
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to create table');
            }
            
            toast({ title: 'Success', description: 'Table created' });
            setIsCreateTableModalOpen(false);
            setNewTableName('');
            fetchManualTables();
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setTableActionLoading(false);
        }
    };

    const handleSettleTable = async (tableData = null) => {
        const tableToSettle = tableData?.id ? tableData : selectedOccupiedTable;
        if (!tableToSettle || !tableToSettle.currentOrder) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            
            const historyItems = tableToSettle.currentOrder.items.map((item) => ({
                id: item.id, name: item.name, categoryId: item.categoryId,
                quantity: item.quantity, price: item.price, totalPrice: item.totalPrice, portion: item.portion || null,
            }));

            const historyRes = await fetch(buildScopedUrl('/api/owner/custom-bill/history'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({
                    billDraftId: createBillDraftId(),
                    printedVia: 'dine-in',
                    customerDetails: tableToSettle.currentOrder.customerDetails || {},
                    items: historyItems,
                    billDetails: {
                        subtotal: tableToSettle.currentOrder.subtotal,
                        cgst: tableToSettle.currentOrder.cgst,
                        sgst: tableToSettle.currentOrder.sgst,
                        deliveryCharge: tableToSettle.currentOrder.deliveryCharge,
                        serviceFee: tableToSettle.currentOrder.additionalCharge,
                        serviceFeeLabel: tableToSettle.currentOrder.additionalChargeLabel,
                        grandTotal: tableToSettle.currentOrder.grandTotal,
                    },
                }),
            });

            if (!historyRes.ok) throw new Error('Failed to save bill history');

            // 2. Free the table
            const freeRes = await fetch(buildScopedUrl(`/api/owner/manual-tables/${tableToSettle.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'free' })
            });

            if (!freeRes.ok) throw new Error('Failed to free table');

            toast({ title: 'Settled', description: `Table ${tableToSettle.name} settled and freed.` });
            if (!tableData?.id) {
                setSelectedOccupiedTable(null);
            }
            fetchManualTables();
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setTableActionLoading(false);
        }
    };


    const handleBrowserPrintForBill = async () => {
        if (!cart.length) return;

        setIsSavingBillHistory(true);
        let saveError = null;
        try {
            await saveCustomBillHistory('browser', orderType);
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
            toast({ title: 'Printed', description: `Printed, but history failed: ${saveError.message}`, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: 'Bill printed and saved.' });
            handleClear(); // Automatically clear cart after success for Delivery/Pickup
        }
    };

    const handleDirectPrint = async () => {
        if (!cart.length) return;

        setIsSavingBillHistory(true);
        try {
            const printResult = await printReceiptToUsb({
                items: cart,
                customer: customerDetails,
                billDetails: { subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, grandTotal },
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
                toast({ title: 'Printed', description: 'Receipt printed and saved in bill history.' });
            } catch (historyError) {
                console.error('[Custom Bill] Failed to save direct-print history:', historyError);
                toast({
                    title: 'Printed (History Pending)',
                    description: `Receipt print ho gaya, lekin history save nahi hui: ${historyError.message}`,
                    variant: 'warning'
                });
            }
        } catch (error) {
            toast({ title: 'Print Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsSavingBillHistory(false);
        }
    };

    return (
        <div className="text-foreground bg-background min-h-screen overflow-y-auto lg:min-h-0 lg:h-[calc(100dvh-88px)] lg:overflow-hidden">
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
                            billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, grandTotal, discount: 0 }}
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

            {/* Create Table Modal */}
            <Dialog open={isCreateTableModalOpen} onOpenChange={setIsCreateTableModalOpen}>
                <DialogContent className="bg-card border-border max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Create New Table</DialogTitle>
                        <DialogDescription>Enter a name or identifier for the new table.</DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Label>Table Name / DB</Label>
                        <input
                            type="text"
                            value={newTableName}
                            onChange={(e) => setNewTableName(e.target.value)}
                            placeholder="e.g. Table 1, T2"
                            className="w-full mt-2 p-2 border rounded-md bg-input border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateTableModalOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreateTable} disabled={!newTableName.trim() || tableActionLoading} className="bg-primary hover:bg-primary/90">
                            {tableActionLoading ? 'Creating...' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Occupied Table Modal */}
            <Dialog open={!!selectedOccupiedTable} onOpenChange={(open) => !open && setSelectedOccupiedTable(null)}>
                <DialogContent className="bg-card border-border text-foreground max-w-sm">
                    {selectedOccupiedTable && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{selectedOccupiedTable.name}</DialogTitle>
                                <DialogDescription className="text-primary font-medium">Currently Occupied</DialogDescription>
                            </DialogHeader>
                            <div className="py-2 space-y-3">
                                {selectedOccupiedTable.currentOrder?.items?.length > 0 && (
                                    <div className="max-h-[30vh] overflow-y-auto pr-2 custom-scrollbar space-y-3">
                                        {selectedOccupiedTable.currentOrder.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                                                <div>
                                                    <span className="font-medium">{item.name}</span>
                                                    {item.portion && <span className="text-xs text-muted-foreground ml-1">({item.portion.name})</span>}
                                                    <div className="text-xs text-muted-foreground mt-0.5">Qty: {item.quantity} × {formatCurrency(item.price)}</div>
                                                </div>
                                                <span className="font-semibold">{formatCurrency(item.totalPrice)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="p-3 bg-muted rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Items:</span>
                                        <span className="font-semibold">{selectedOccupiedTable.currentOrder?.items?.length || 0}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Subtotal:</span>
                                        <span className="font-semibold">{formatCurrency(selectedOccupiedTable.currentOrder?.subtotal || 0)}</span>
                                    </div>
                                    <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
                                        <span>Total:</span>
                                        <span className="text-primary">{formatCurrency(selectedOccupiedTable.currentOrder?.grandTotal || 0)}</span>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter className="flex-col sm:flex-col gap-2 mt-2" style={{ display: 'flex' }}>
                                <Button
                                    onClick={() => {
                                        const order = selectedOccupiedTable.currentOrder;
                                        if (order) {
                                            setCart(order.items || []);
                                            if (order.customerDetails) setCustomerDetails(order.customerDetails);
                                            if (order.deliveryCharge) setDeliveryChargeInput(order.deliveryCharge.toString());
                                            if (order.additionalCharge) setAdditionalChargeInput(order.additionalCharge.toString());
                                            if (order.additionalChargeLabel) setAdditionalChargeNameInput(order.additionalChargeLabel);
                                        }
                                        setActiveTable(selectedOccupiedTable);
                                        setSelectedOccupiedTable(null);
                                    }}
                                    variant="outline"
                                    className="w-full border-2 border-primary/20 hover:bg-primary/10"
                                    disabled={tableActionLoading}
                                >
                                    <Edit className="w-4 h-4 mr-2" /> Add/Edit Items
                                </Button>
                                <Button
                                    onClick={() => {
                                        setTableToPrint(selectedOccupiedTable); // Triggers print
                                        handleSettleTable();
                                    }}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold"
                                    disabled={tableActionLoading}
                                >
                                    <Printer className="w-4 h-4 mr-2" /> Settle, Print & Free
                                </Button>
                            </DialogFooter>
                        </>
                    )}
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

            <div className="flex flex-col lg:flex-row gap-4 lg:h-full lg:overflow-hidden">
                {/* Left Side: Menu Selection (Flexible) */}
                <div className="flex-1 min-w-0 bg-card border border-border rounded-xl p-3 flex flex-col h-full lg:min-h-0">
                    <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center flex-wrap gap-2">
                            <h1 className="text-lg font-bold tracking-tight">Manual Billing</h1>

                            <div className="flex bg-muted p-1 rounded-lg ml-0 sm:ml-2">
                                {['delivery', 'dine-in', 'pickup'].map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => {
                                            setOrderType(mode);
                                            if (mode !== 'dine-in') setActiveTable(null);
                                        }}
                                        className={cn(
                                            "px-3 py-1.5 text-sm font-semibold rounded-md capitalize transition-colors",
                                            orderType === mode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10"
                                        )}
                                    >
                                        {mode.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>

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
                        <div className="w-full grid grid-cols-[1fr_auto_auto] gap-2 sm:w-auto sm:flex sm:items-center">
                            <div className="relative min-w-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Search menu..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full min-w-0 pl-9 pr-4 py-2 h-10 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                                />
                            </div>
                            <Button
                                onClick={handleClear}
                                disabled={cart.length === 0}
                                variant="outline"
                                className="h-10 px-2 sm:px-4 gap-1 sm:gap-2 border-2 border-destructive/60 text-destructive hover:bg-destructive/10 font-bold transition-all shadow-sm"
                                title="Clear entire cart"
                            >
                                <Trash2 size={16} />
                                <span className="hidden sm:inline">Clear</span>
                            </Button>
                            <Button
                                onClick={handleUndo}
                                disabled={itemHistory.length === 0}
                                variant="outline"
                                className="h-10 px-2 sm:px-4 gap-1 sm:gap-2 border-2 border-primary/60 text-foreground hover:bg-primary/10 font-bold transition-all shadow-sm"
                                title="Undo last item added"
                            >
                                <RotateCcw size={16} />
                                <span className="hidden sm:inline">Undo</span>
                            </Button>
                        </div>
                    </div>

                    {orderType === 'dine-in' && !activeTable ? (
                        <div className="flex-1 overflow-y-auto p-4 bg-muted/20 border-t border-border mt-4 rounded-xl">
                            {isLoadingTables ? (
                                <div className="flex justify-center items-center h-full">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {manualTables.map(table => {
                                        if (table.status === 'occupied') {
                                            return (
                                                <div 
                                                    key={table.id}
                                                    className="relative flex flex-col p-4 rounded-xl border-2 border-amber-500 bg-[#1e1e1e] shadow-md min-h-[140px] text-center overflow-hidden"
                                                    onClick={() => setSelectedOccupiedTable(table)}
                                                >
                                                    <h3 className="font-bold text-3xl mb-1 text-white">{table.name}</h3>
                                                    <div className="flex flex-col items-center mb-2">
                                                        <span className="text-xl font-bold text-amber-500">{formatCurrency(table.currentOrder?.grandTotal || 0)}</span>
                                                        <span className="text-sm text-gray-400 mt-1">{table.currentOrder?.items?.length || 0} {table.currentOrder?.items?.length === 1 ? 'item' : 'items'}</span>
                                                    </div>
                                                    
                                                    <div className="mt-auto pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                                                        <button 
                                                           onClick={(e) => {
                                                               e.stopPropagation();
                                                               const order = table.currentOrder;
                                                               if (order) {
                                                                   setCart(order.items || []);
                                                                   if (order.customerDetails) setCustomerDetails(order.customerDetails);
                                                                   if (order.deliveryCharge) setDeliveryChargeInput(order.deliveryCharge.toString());
                                                                   if (order.additionalCharge) setAdditionalChargeInput(order.additionalCharge.toString());
                                                                   if (order.additionalChargeLabel) setAdditionalChargeNameInput(order.additionalChargeLabel);
                                                               }
                                                               setActiveTable(table);
                                                               setSelectedOccupiedTable(null);
                                                           }}
                                                           className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#2a2a2a] text-amber-500 hover:bg-[#333] transition-colors"
                                                           title="Add/Edit Items"
                                                        >
                                                            <Plus size={18} />
                                                        </button>
                                                        <button 
                                                           onClick={async (e) => {
                                                               e.stopPropagation();
                                                               setTableToPrint(table); // Triggers direct browser print via useEffect
                                                               await handleSettleTable(table);
                                                           }}
                                                           disabled={tableActionLoading}
                                                           className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#2a2a2a] text-white hover:bg-[#333] transition-colors"
                                                           title="Settle & Free Table"
                                                        >
                                                            {tableActionLoading ? (
                                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                            ) : (
                                                                <Printer size={18} />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div 
                                                key={table.id}
                                                onClick={() => {
                                                    setActiveTable(table);
                                                    handleClear(); // Reset cart for new table safely
                                                }}
                                                className="cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col items-center justify-center min-h-[140px] text-center bg-card border-border hover:border-primary/50 hover:shadow-md"
                                            >
                                                <h3 className="font-bold text-lg mb-1">{table.name}</h3>
                                                <span className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1"><CheckCircle size={12} /> Available</span>
                                            </div>
                                        );
                                    })}
                                    
                                    {/* Create Table Card */}
                                    <div 
                                        onClick={() => setIsCreateTableModalOpen(true)}
                                        className="cursor-pointer p-4 rounded-xl border-2 border-dashed border-border bg-muted/10 hover:bg-muted/30 hover:border-primary/50 transition-all flex flex-col items-center justify-center min-h-[120px] text-center text-muted-foreground hover:text-foreground"
                                    >
                                        <PlusCircle className="w-8 h-8 mb-2" />
                                        <span className="font-semibold text-sm">Create Table</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                    <div className="flex gap-4 flex-1 min-h-0 relative">
                        {/* CATEGORY NAVIGATION SIDEBAR */}
                        <div
                            ref={sidebarRef}
                            style={{ width: `${sidebarWidth}px` }}
                            className="flex-shrink-0 border-r border-border pr-2 overflow-y-auto overscroll-contain custom-scrollbar hidden md:block"
                        >
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
                                        {formatCategoryLabel(categoryId)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* RESIZE HANDLE */}
                        <div
                            onMouseDown={startResizing}
                            className="hidden md:block absolute top-0 bottom-0 z-10 w-2 cursor-col-resize flex items-center justify-center group"
                            style={{ left: `${sidebarWidth - 1}px`, transform: 'translateX(-50%)' }}
                            title="Drag to resize sidebar"
                        >
                            <div className="h-10 w-1 bg-border rounded-full group-hover:bg-primary transition-colors"></div>
                        </div>

                        {/* ITEM LIST */}
                        <div
                            ref={scrollContainerRef}
                            className="flex-grow min-h-0 overflow-y-auto overscroll-contain pr-2 custom-scrollbar"
                        >
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                    <p>Loading menu...</p>
                                </div>
                            ) : visibleMenuEntries.map(([categoryId, filteredItems]) => (
                                <div key={categoryId} id={`cat-${categoryId}`} className="mb-5 pt-1">
                                    <h3 className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 px-3 z-10 mb-3 border-l-4 border-primary font-bold text-base capitalize text-foreground tracking-wide">
                                        {formatCategoryLabel(categoryId)}
                                    </h3>
                                    {categoryId === 'open-items' && filteredItems.length === 0 ? (
                                        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-900/10 text-sm text-muted-foreground">
                                            No open items yet. Add them from Menu Management to use in manual billing.
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {filteredItems.map(item => {
                                                // Handle Open Items (no portions)
                                                if (categoryId === 'open-items' || !item.portions) {
                                                    return (
                                                        <motion.div
                                                            key={item.id}
                                                            whileHover={{ y: -4, scale: 1.02 }}
                                                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                            className="p-5 bg-gradient-to-br from-amber-900/20 via-amber-800/10 to-amber-900/5 hover:from-amber-900/30 hover:via-amber-800/15 hover:to-amber-900/10 rounded-2xl border-2 border-amber-600/30 hover:border-amber-500/60 transition-all shadow-md hover:shadow-xl hover:shadow-amber-900/20 min-h-[130px] flex flex-col backdrop-blur-sm"
                                                        >
                                                            <div className="flex-1 mb-3">
                                                                <p className="font-bold text-foreground text-base leading-tight">
                                                                    {item.name}
                                                                </p>
                                                            </div>
                                                            <motion.button
                                                                whileHover={{ scale: 1.05 }}
                                                                whileTap={{ scale: 0.95 }}
                                                                onClick={() => addToCart(item, { name: 'Regular', price: item.price })}
                                                                className="px-3 py-3 rounded-xl bg-gradient-to-br from-amber-500/20 via-amber-500/15 to-amber-500/10 border-2 border-amber-500/40 hover:from-amber-500 hover:via-amber-500 hover:to-amber-400 hover:text-white hover:border-amber-500 transition-all flex flex-col items-center justify-center gap-1.5 font-bold group shadow-sm hover:shadow-lg hover:shadow-amber-900/30 min-h-[70px] relative overflow-hidden"
                                                            >
                                                                <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>
                                                                <span className="text-base font-black relative z-10">
                                                                    {formatCurrency(item.price)}
                                                                </span>
                                                            </motion.button>
                                                        </motion.div>
                                                    );
                                                }

                                                // Handle Regular Menu Items
                                                return (
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
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                    )}
                </div>

                {/* Bill Sidebar Resizer Handle */}
                <div
                    onMouseDown={startResizingBill}
                    className="hidden lg:flex group w-2 hover:w-3 -ml-3 -mr-3 z-30 cursor-col-resize items-center justify-center transition-all bg-transparent"
                    title="Drag to resize bill preview"
                >
                    <div className="h-10 w-1 bg-border rounded-full group-hover:bg-primary transition-colors"></div>
                </div>

                {/* Right Side: Live Bill Preview (Resizable) */}
                <div 
                    ref={billContainerRef}
                    style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${billSidebarWidth}px` : '100%' }}
                    className="flex-shrink-0 flex flex-col gap-4 h-full lg:min-h-0 overflow-y-auto overscroll-contain pr-1"
                >
                    {/* Collapsible Customer Details */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden flex-shrink-0">
                        {/* Accordion Header — always visible, click to toggle */}
                        <button
                            type="button"
                            onClick={() => setIsCustomerDetailsOpen(p => !p)}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-muted/40 transition-colors"
                        >
                            <span className="flex items-center gap-2">
                                <User size={14} />
                                {customerDetails.name ? customerDetails.name : 'Customer Details'}
                                {customerDetails.phone && <span className="text-muted-foreground font-normal">· {customerDetails.phone}</span>}
                            </span>
                            <ChevronDown size={14} className={cn('transition-transform duration-200', isCustomerDetailsOpen ? 'rotate-180' : '')} />
                        </button>

                        {/* Collapsible Body */}
                        <div className={cn('transition-all duration-200 overflow-hidden', isCustomerDetailsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0')}>
                            <div className="p-2 border-t border-border">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1.5 text-xs"><User size={13} /> Name</Label>
                                        <input value={customerDetails.name} onChange={e => setCustomerDetails({ ...customerDetails, name: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1.5 text-xs"><Phone size={13} /> Phone</Label>
                                        <input value={customerDetails.phone} onChange={e => setCustomerDetails({ ...customerDetails, phone: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" />
                                    </div>
                                    {orderType === 'delivery' && (
                                        <>
                                            <div className="space-y-1 col-span-2">
                                                <Label className="flex items-center gap-1.5 text-xs"><MapPin size={13} /> Address</Label>
                                                <textarea rows={2} value={customerDetails.address} onChange={e => setCustomerDetails({ ...customerDetails, address: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border resize-none" />
                                            </div>
                                            <div className="space-y-1 col-span-2">
                                                <Label className="text-xs">Delivery Charge (Optional)</Label>
                                                <input type="number" min="0" step="1" value={deliveryChargeInput} onChange={(e) => setDeliveryChargeInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="0" />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Hidden ref for actual printing — never visible */}
                    <div className="hidden">
                        <div ref={billPrintRef} className="preview-bill">
                            <BillToPrint
                                order={{ orderDate: new Date() }}
                                restaurant={restaurant}
                                billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, grandTotal, discount: 0 }}
                                items={cart}
                                customerDetails={customerDetails}
                            />
                        </div>
                    </div>

                    {/* Current Order Panel */}
                    <div className="bg-card border border-border rounded-xl flex flex-col flex-grow min-h-0 overflow-hidden">
                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                            <h2 className="font-bold text-base">Current Order</h2>
                            <button
                                onClick={handleClear}
                                disabled={cart.length === 0}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                            >
                                <Trash2 size={13} /> Clear
                            </button>
                        </div>

                        {/* Cart Items — scrollable */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-2">
                            {cart.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground text-sm">
                                    <p>No items added yet.</p>
                                    <p className="text-xs mt-1">Tap a menu item to add it here.</p>
                                </div>
                            ) : (
                                cart.map((item) => (
                                    <div key={item.cartItemId} className="flex items-center justify-between gap-2 p-2.5 bg-muted/20 border border-border/50 rounded-xl">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm leading-tight truncate">{item.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {item.portion ? `${item.portion.name} · ` : ''}{formatCurrency(item.price)} each
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-xs font-semibold text-right w-14">{formatCurrency(item.totalPrice)}</span>
                                            <div className="flex items-center border border-border rounded-lg bg-background overflow-hidden h-7">
                                                <button
                                                    onClick={() => updateQuantity(item.cartItemId, -1)}
                                                    className="w-7 h-full flex items-center justify-center hover:bg-muted transition-colors border-r border-border"
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={qtyInputMap[item.cartItemId] ?? item.quantity}
                                                    onChange={e => {
                                                        const raw = e.target.value;
                                                        setQtyInputMap(prev => ({ ...prev, [item.cartItemId]: raw }));
                                                        const newVal = parseInt(raw, 10);
                                                        if (!isNaN(newVal) && newVal >= 1) {
                                                            updateQuantity(item.cartItemId, newVal - item.quantity);
                                                        }
                                                    }}
                                                    onBlur={e => {
                                                        const raw = e.target.value;
                                                        const newVal = parseInt(raw, 10);
                                                        const safeVal = (!isNaN(newVal) && newVal >= 1) ? newVal : 1;
                                                        if (safeVal !== item.quantity) {
                                                            updateQuantity(item.cartItemId, safeVal - item.quantity);
                                                        }
                                                        // Clear local override so it syncs back from cart
                                                        setQtyInputMap(prev => { const n = { ...prev }; delete n[item.cartItemId]; return n; });
                                                    }}
                                                    onWheel={e => e.currentTarget.blur()}
                                                    className="w-10 h-full text-center text-sm font-bold bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                />
                                                <button
                                                    onClick={() => updateQuantity(item.cartItemId, 1)}
                                                    className="w-7 h-full flex items-center justify-center hover:bg-muted transition-colors border-l border-border"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => updateQuantity(item.cartItemId, -item.quantity)}
                                                className="p-1 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                                title="Remove item"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Totals */}
                        <div className="px-4 py-2.5 border-t border-border space-y-1 flex-shrink-0 text-sm">
                            <div className="flex justify-between text-muted-foreground text-xs">
                                <span>{cart.reduce((s, i) => s + i.quantity, 0)} item(s)</span>
                                <span>{formatCurrency(subtotal)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                                <span>Total</span><span>{formatCurrency(grandTotal)}</span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="p-3 border-t border-border flex gap-2 flex-shrink-0">
                            {orderType === 'dine-in' ? (
                                <Button
                                    onClick={handleOccupyTable}
                                    className="flex-1 h-10 px-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-900/30 transition-all"
                                    disabled={cart.length === 0 || tableActionLoading}
                                >
                                    {tableActionLoading ? 'Saving...' : 'Save to Table'}
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleBrowserPrintForBill}
                                    className="flex-1 h-10 px-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-900/30 transition-all"
                                    disabled={cart.length === 0 || isSavingBillHistory}
                                >
                                    <Printer className="mr-2 h-4 w-4" /> {isSavingBillHistory ? 'Saving...' : 'Save & Print'}
                                </Button>
                            )}
                        </div>
                    </div>

                </div>{/* end billContainerRef */}
            </div>{/* end flex flex-col lg:flex-row */}
            
            {/* Hidden Table Print Component */}
            <div className="hidden">
                <div ref={tablePrintRef} className="preview-bill">
                    {tableToPrint && tableToPrint.currentOrder && (
                        <BillToPrint
                            order={{ orderDate: new Date() }}
                            restaurant={restaurant}
                            billDetails={{ 
                                subtotal: tableToPrint.currentOrder.subtotal, 
                                cgst: tableToPrint.currentOrder.cgst, 
                                sgst: tableToPrint.currentOrder.sgst, 
                                deliveryCharge: tableToPrint.currentOrder.deliveryCharge, 
                                serviceFee: tableToPrint.currentOrder.additionalCharge, 
                                serviceFeeLabel: tableToPrint.currentOrder.additionalChargeLabel, 
                                grandTotal: tableToPrint.currentOrder.grandTotal, 
                                discount: 0 
                            }}
                            items={tableToPrint.currentOrder.items || []}
                            customerDetails={tableToPrint.currentOrder.customerDetails || {}}
                        />
                    )}
                </div>
            </div>

        </div>
    );
}

export default ManualOrderPage;
