"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { isKioskPrintMode, resolvePreferredPrintMode } from '@/lib/printMode';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';
import { silentPrintElement } from '@/lib/desktop/print';

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
const getItemAvailableStock = (item = {}) => {
    const raw = item?.availableStock ?? item?.available;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const mergeMenuWithInventory = (menu = {}, inventoryMap = {}) => (
    Object.fromEntries(
        Object.entries(menu || {}).map(([categoryId, items]) => [
            categoryId,
            Array.isArray(items)
                ? items.map((menuItem) => {
                    const stockInfo = inventoryMap[menuItem?.id] || null;
                    return {
                        ...menuItem,
                        availableStock: stockInfo ? getItemAvailableStock(stockInfo) : getItemAvailableStock(menuItem),
                        stockOnHand: stockInfo?.stockOnHand ?? menuItem?.stockOnHand,
                        reservedStock: stockInfo?.reserved ?? menuItem?.reservedStock,
                    };
                })
                : [],
        ])
    )
);
const isStoreBusinessType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'shop' || normalized === 'store';
};
const getItemSearchTokens = (item = {}) => [
    item?.name,
    item?.sku,
    item?.barcode,
    ...(Array.isArray(item?.extraBarcodes) ? item.extraBarcodes : []),
].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
const itemMatchesSearch = (item = {}, normalizedQuery = '') => {
    if (!normalizedQuery) return true;
    return getItemSearchTokens(item).some((token) => token.includes(normalizedQuery));
};
const buildSaleOption = (name, price, label = name) => ({
    name,
    label,
    price: Number(price || 0),
});
const getItemSaleOptions = (item = {}, isStoreOutlet = false) => {
    if (isStoreOutlet) {
        const fallbackPrice = Number(item?.price ?? item?.portions?.[0]?.price ?? 0);
        return [buildSaleOption('unit', fallbackPrice, 'Add')];
    }
    if (Array.isArray(item?.portions) && item.portions.length > 0) {
        return item.portions.map((portion) => buildSaleOption(portion.name, portion.price, portion.name));
    }
    return [buildSaleOption('regular', item?.price, 'Add')];
};

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
    const [deliveryChargeInput, setDeliveryChargeInput] = useState('0');
    const [additionalChargeNameInput, setAdditionalChargeNameInput] = useState('');
    const [additionalChargeInput, setAdditionalChargeInput] = useState('0');
    const [discountInput, setDiscountInput] = useState('0');
    const [paymentMode, setPaymentMode] = useState('cash');
    const [businessType, setBusinessType] = useState('restaurant');

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
    const [openItems, setOpenItems] = useState([]); // Open items from Firestore
    const [inventoryByItemId, setInventoryByItemId] = useState({});
    const [preferredPrintMode, setPreferredPrintMode] = useState('browser');
    const [cacheStatus, setCacheStatus] = useState('checking');
    const hasHydratedFromCacheRef = useRef(false);
    const scrollContainerRef = useRef(null);
    const categoryRefs = useRef({});
    const searchInputRef = useRef(null);
    const sidebarRef = useRef(null);
    const isResizing = useRef(false);
    const [manualSidebarWidth, setManualSidebarWidth] = useState(null); // null means use dynamic default
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
    const cacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_custom_bill_cache_v2_${scope}`;
    }, [impersonatedOwnerId, employeeOfOwnerId]);
    const desktopCacheScope = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_custom_bill::${scope}`;
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

    const readDesktopCachedPayload = useCallback(async () => {
        if (!isDesktopApp()) return null;
        const payload = await getOfflineNamespace('owner_custom_bill', desktopCacheScope, null);
        return payload?.data ? payload : null;
    }, [desktopCacheScope]);

    const readCombinedCachedPayload = useCallback(async () => {
        return readCachedPayload() || await readDesktopCachedPayload();
    }, [readCachedPayload, readDesktopCachedPayload]);

    const persistCachedPayload = useCallback(async (data = {}) => {
        const payload = { ts: Date.now(), data };
        writeCachedPayload(data);
        if (isDesktopApp()) {
            await setOfflineNamespace('owner_custom_bill', desktopCacheScope, payload);
        }
        return payload;
    }, [desktopCacheScope, writeCachedPayload]);

    // useReactToPrint hook setup
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
        onAfterPrint: () => setIsBillModalOpen(false), // Close modal after printing
    });

    useEffect(() => {
        setPreferredPrintMode(resolvePreferredPrintMode(searchParams));
    }, [searchParams]);

    useEffect(() => {
        if (hasHydratedFromCacheRef.current) return;
        hasHydratedFromCacheRef.current = true;
        let cancelled = false;
        (async () => {
            const cached = await readCombinedCachedPayload();
            if (cancelled || !cached) {
                setCacheStatus('empty');
                return;
            }
            const payload = cached.data || {};
            if (payload.menu && typeof payload.menu === 'object') setMenu(payload.menu);
            if (Array.isArray(payload.openItems)) setOpenItems(dedupeOpenItems(payload.openItems));
            if (payload.restaurant) setRestaurant(payload.restaurant);
            if (payload.businessType) setBusinessType(payload.businessType);
            if (payload.businessType) setInventoryByItemId(payload.inventoryByItemId || {});
            if (payload.businessType === 'store' || payload.businessType === 'shop') {
                (async () => {
                    try {
                        const user = auth.currentUser;
                        if (!user) return;
                        const idToken = await user.getIdToken();
                        const inventoryRes = await fetch(buildScopedUrl('/api/owner/inventory?limit=500'), {
                            headers: { Authorization: `Bearer ${idToken}` },
                        });
                        if (!inventoryRes.ok) return;
                        const inventoryData = await inventoryRes.json();
                        const inventoryMap = Array.isArray(inventoryData?.items)
                            ? inventoryData.items.reduce((acc, inventoryItem) => {
                                if (inventoryItem?.id) acc[inventoryItem.id] = inventoryItem;
                                return acc;
                            }, {})
                            : {};
                        setInventoryByItemId(inventoryMap);
                        setMenu((prev) => mergeMenuWithInventory(prev, inventoryMap));
                    } catch {
                        // Non-blocking
                    }
                })();
            }
            setCacheStatus('local-hit');
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [buildScopedUrl, readCombinedCachedPayload]);

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
                const inventoryUrl = buildScopedUrl('/api/owner/inventory?limit=500');
                const settingsUrl = buildScopedUrl('/api/owner/settings');
                const versionUrl = buildScopedUrl('/api/owner/menu?versionOnly=1');

                const cached = await readCombinedCachedPayload();
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
                    if (cached?.data?.businessType === 'store' || cached?.data?.businessType === 'shop') {
                        try {
                            const inventoryRes = await fetch(inventoryUrl, { headers });
                            if (inventoryRes.ok && isMounted) {
                                const inventoryData = await inventoryRes.json();
                                const inventoryMap = Array.isArray(inventoryData?.items)
                                    ? inventoryData.items.reduce((acc, inventoryItem) => {
                                        if (inventoryItem?.id) acc[inventoryItem.id] = inventoryItem;
                                        return acc;
                                    }, {})
                                    : {};
                                setInventoryByItemId(inventoryMap);
                                setMenu(mergeMenuWithInventory(cached?.data?.menu || {}, inventoryMap));
                            }
                        } catch {
                            // Non-blocking
                        }
                    }

                    const settingsPromise = fetch(settingsUrl, { headers });
                    // Keep settings fresh in background when menu version is unchanged.
                    try {
                        const settingsRes = await settingsPromise;
                        if (settingsRes.ok && isMounted) {
                            const settingsData = await settingsRes.json();
                            const nextRestaurantPayload = {
                                name: settingsData.restaurantName,
                                address: settingsData.address,
                                botDisplayNumber: settingsData.botDisplayNumber || '',
                                gstin: settingsData.gstin,
                                gstEnabled: !!settingsData.gstEnabled,
                                gstPercentage: Number(settingsData.gstPercentage ?? settingsData.gstRate ?? 0),
                                gstMinAmount: Number(settingsData.gstMinAmount ?? 0),
                                gstCalculationMode: settingsData.gstCalculationMode || (settingsData.gstIncludedInPrice === false ? 'excluded' : 'included'),
                            };
                            setRestaurant(nextRestaurantPayload);
                            await persistCachedPayload({
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
                const inventoryPromise = fetch(inventoryUrl, { headers });
                const menuRes = await menuPromise;

                if (!menuRes.ok) {
                    const menuError = await menuRes.json().catch(() => ({}));
                    throw new Error(menuError?.message || 'Failed to fetch menu.');
                }

                const menuData = await menuRes.json();
                const resolvedBusinessType = menuData?.businessType || 'restaurant';
                setBusinessType(resolvedBusinessType);
                const isStoreOutlet = resolvedBusinessType === 'store' || resolvedBusinessType === 'shop';
                const restaurantPayload = null;

                const openItemsData = { items: Array.isArray(menuData.openItems) ? menuData.openItems : [] };
                let inventoryMap = {};

                if (isStoreOutlet) {
                    try {
                        const inventoryRes = await inventoryPromise;
                        if (inventoryRes.ok) {
                            const inventoryData = await inventoryRes.json();
                            inventoryMap = Array.isArray(inventoryData?.items)
                                ? inventoryData.items.reduce((acc, inventoryItem) => {
                                    if (inventoryItem?.id) acc[inventoryItem.id] = inventoryItem;
                                    return acc;
                                }, {})
                                : {};
                        }
                    } catch {
                        inventoryMap = {};
                    }
                }

                const menuWithInventory = isStoreOutlet
                    ? mergeMenuWithInventory(menuData.menu || {}, inventoryMap)
                    : (menuData.menu || {});

                if (isMounted) {
                    setMenu(menuWithInventory);
                    setOpenItems(dedupeOpenItems(openItemsData.items || []));
                    setInventoryByItemId(inventoryMap);
                    // Unblock UI as soon as menu is ready; settings can hydrate in background.
                    setCacheStatus('network-refresh');
                    setLoading(false);
                    if (restaurantPayload) {
                        setRestaurant(restaurantPayload);
                    }
                }

                await persistCachedPayload({
                    menu: menuWithInventory,
                    openItems: dedupeOpenItems(openItemsData.items || []),
                    restaurant: restaurantPayload,
                    businessType: resolvedBusinessType,
                    inventoryByItemId: inventoryMap,
                    menuVersion: Number(menuData?.menuVersion || 0),
                });

                // Hydrate settings after menu render (non-blocking for menu UI).
                try {
                    const settingsRes = await settingsPromise;
                    if (!isMounted) return;
                    if (!settingsRes.ok) {
                        const settingsError = await settingsRes.json().catch(() => ({}));
                        setInfoDialog((prev) => {
                            if (prev.isOpen) return prev;
                            return {
                                isOpen: true,
                                title: 'Warning',
                                message: `Menu loaded, but restaurant details could not load: ${settingsError?.message || 'Failed to fetch settings.'}`,
                            };
                        });
                        return;
                    }

                    const settingsData = await settingsRes.json();
                    const nextRestaurantPayload = {
                        name: settingsData.restaurantName,
                        address: settingsData.address,
                        botDisplayNumber: settingsData.botDisplayNumber || '',
                        gstin: settingsData.gstin,
                        gstEnabled: !!settingsData.gstEnabled,
                        gstPercentage: Number(settingsData.gstPercentage ?? settingsData.gstRate ?? 0),
                        gstMinAmount: Number(settingsData.gstMinAmount ?? 0),
                        gstCalculationMode: settingsData.gstCalculationMode || (settingsData.gstIncludedInPrice === false ? 'excluded' : 'included'),
                    };
                    if (isMounted) setRestaurant(nextRestaurantPayload);

                    const latestCached = await readCombinedCachedPayload();
                    await persistCachedPayload({
                        ...(latestCached?.data || {}),
                        menu: menuWithInventory,
                        openItems: dedupeOpenItems(openItemsData.items || []),
                        restaurant: nextRestaurantPayload,
                        businessType: resolvedBusinessType,
                        inventoryByItemId: inventoryMap,
                        menuVersion: Number(menuData?.menuVersion || 0),
                    });
                } catch {
                    // Settings request is non-blocking; ignore failures here.
                }
            } catch (error) {
                if (isMounted) {
                    setCacheStatus('error');
                    const cached = await readCombinedCachedPayload();
                    if (cached?.data?.menu) {
                        const payload = cached.data || {};
                        setMenu(payload.menu || {});
                        setOpenItems(Array.isArray(payload.openItems) ? dedupeOpenItems(payload.openItems) : []);
                        setRestaurant(payload.restaurant || null);
                        setBusinessType(payload.businessType || 'restaurant');
                        setInventoryByItemId(payload.inventoryByItemId || {});
                        setCacheStatus('offline-hit');
                        setInfoDialog({ isOpen: true, title: 'Offline Cache Active', message: 'Live menu fetch failed, so cached desktop billing data is being shown.' });
                    } else {
                        setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load menu: ${error.message}` });
                    }
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
    }, [accessQuery, buildScopedUrl, cacheKey, readCombinedCachedPayload, persistCachedPayload]);

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
                ? items.filter((item) => itemMatchesSearch(item, normalizedSearchQuery))
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
            ? openItems.filter((item) => itemMatchesSearch(item, normalizedSearchQuery))
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
        // Calculate new width relative to the left edge of the sidebar container
        const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left;
        // Constrain width: min 130px, max 800px (or half screen)
        const minWidth = 130;
        const maxWidth = Math.min(800, window.innerWidth * 0.5);
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            setManualSidebarWidth(newWidth);
        }
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);
    // ------------------------------


    const enforceCartStockLimit = useCallback((candidateItem, nextQuantity) => {
        const availableStock = getItemAvailableStock(candidateItem);
        if (availableStock === null) return true;
        if (nextQuantity <= availableStock) return true;

        setInfoDialog({
            isOpen: true,
            title: 'Stock Limit Reached',
            message: `Only ${availableStock} unit(s) of "${candidateItem?.name || 'this item'}" are available right now.`,
        });
        return false;
    }, []);

    const addToCart = (item, portion) => {
        const normalizedOption = portion || buildSaleOption('regular', item?.price, 'Add');
        const cartItemId = `${item.id}-${normalizedOption.name}`;
        const existingItem = cart.find(i => i.cartItemId === cartItemId);
        if (existingItem) {
            const nextQuantity = existingItem.quantity + 1;
            if (!enforceCartStockLimit(item, nextQuantity)) return;
            setItemHistory(prev => [...prev, cartItemId]);
            setCart(cart.map(i => i.cartItemId === cartItemId ? { ...i, quantity: nextQuantity, totalPrice: (i.totalPrice / i.quantity) * nextQuantity } : i));
        } else {
            if (!enforceCartStockLimit(item, 1)) return;
            setItemHistory(prev => [...prev, cartItemId]);
            // Check if item has multiple portions
            const hasMultiplePortions = item.portions && item.portions.length > 1;

            // Exclude portions array from cart item to avoid confusion
            const { portions, ...itemWithoutPortions } = item;

            const cartItem = {
                ...itemWithoutPortions,
                quantity: 1,
                cartItemId,
                price: normalizedOption.price,
                totalPrice: normalizedOption.price
            };

            const portionCount = Array.isArray(portions) ? portions.length : 0;
            if (portionCount > 0) {
                cartItem.portionCount = portionCount;
            }

            // Only add portion data if there are multiple portions
            if (hasMultiplePortions) {
                cartItem.portion = normalizedOption;
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
        setDiscountInput('0');
        setPaymentMode('cash');
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
                if (!enforceCartStockLimit(item, newQuantity)) {
                    return currentCart;
                }
                newCart[itemIndex] = { ...item, quantity: newQuantity, totalPrice: item.price * newQuantity };
                return newCart;
            }
        });
    };

    const { subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, discount, grandTotal } = useMemo(() => {
        const sub = cart.reduce((sum, item) => sum + item.totalPrice, 0);
        const normalizedDeliveryCharge = Math.max(0, Number(deliveryChargeInput) || 0);
        const normalizedAdditionalCharge = Math.max(0, Number(additionalChargeInput) || 0);
        const normalizedAdditionalChargeLabel = String(additionalChargeNameInput || 'Additional Charge').trim() || 'Additional Charge';
        const normalizedDiscount = Math.max(0, Number(discountInput) || 0);
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
                discount: normalizedDiscount,
                grandTotal: Math.max(0, sub + normalizedDeliveryCharge + normalizedAdditionalCharge - normalizedDiscount)
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
            discount: normalizedDiscount,
            grandTotal: Math.max(0, total - normalizedDiscount)
        };
    }, [cart, restaurant, deliveryChargeInput, additionalChargeInput, additionalChargeNameInput, discountInput]);

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
        const safeDiscount = Number(billDetails?.discount || 0);
        const safeGrandTotal = Number(billDetails?.grandTotal || safeSubtotal + safeCgst + safeSgst + safeDeliveryCharge + safeServiceFee - safeDiscount);

        // Totals
        encoder.text('--------------------------------').newline()
            .align('right');

        encoder.text(`Subtotal: ${safeSubtotal.toFixed(0)}`).newline();
        if (safeCgst > 0) encoder.text(`CGST: ${safeCgst.toFixed(0)}`).newline();
        if (safeSgst > 0) encoder.text(`SGST: ${safeSgst.toFixed(0)}`).newline();
        if (safeDeliveryCharge > 0) encoder.text(`Delivery: ${safeDeliveryCharge.toFixed(0)}`).newline();
        if (safeServiceFee > 0) encoder.text(`${safeServiceFeeLabel}: ${safeServiceFee.toFixed(0)}`).newline();
        if (safeDiscount > 0) encoder.text(`Discount: -${safeDiscount.toFixed(0)}`).newline();
        if (billDetails?.paymentMode) encoder.text(`Payment: ${String(billDetails.paymentMode).toUpperCase()}`).newline();

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
                    deliveryCharge,
                    serviceFee: additionalCharge,
                    serviceFeeLabel: additionalChargeLabel,
                    discount,
                    paymentMode,
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
                    deliveryCharge,
                    serviceFee: additionalCharge,
                    serviceFeeLabel: additionalChargeLabel,
                    discount,
                    paymentMode,
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

        if (billPrintRef.current) {
            if (isDesktopApp()) {
                try {
                    await silentPrintElement(billPrintRef.current, {
                        documentTitle: `Bill-${Date.now()}`,
                    });
                    setIsBillModalOpen(false);
                } catch (printError) {
                    console.error('[Custom Bill] Silent print failed, falling back to browser print:', printError);
                    if (handlePrint) handlePrint();
                }
            } else if (handlePrint) {
                handlePrint();
            }
        }

        if (saveError) {
            setInfoDialog({
                isOpen: true,
                title: 'Partial Success',
                message: `Bill printed successfully, but history could not be saved: ${saveError.message}`,
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
                billDetails: { subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, discount, paymentMode, grandTotal },
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
                    title: 'Partial Success',
                    message: `Receipt printed successfully, but history could not be saved: ${historyError.message}`,
                });
            }
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Print Failed', message: error.message });
        } finally {
            setIsSavingBillHistory(false);
        }
    };

    return (
        <div className="text-foreground bg-background min-h-screen overflow-y-auto lg:min-h-0 lg:h-[calc(100dvh-88px)] lg:overflow-hidden">
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
                            The owner does not need to manually enter the customer address. Upon creating the order, a link to add the location will be sent to the customer via WhatsApp.
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
                            billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, discount, paymentMode, grandTotal }}
                            items={cart}
                            customerDetails={customerDetails}
                        />
                    </div>
                    {(isKioskPrintMode(preferredPrintMode) || isDesktopApp()) && (
                        <div className="px-4 py-2 text-xs text-emerald-700 bg-emerald-50 border-t border-emerald-200 no-print">
                            Silent print mode active. System popups will not appear when printing from the desktop app or Kiosk browser.
                        </div>
                    )}
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
                            title={isDesktopApp() || isKioskPrintMode(preferredPrintMode) ? 'Silent print to the saved/default printer' : 'Standard browser print dialog'}
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            {isSavingBillHistory ? 'Saving...' : (isDesktopApp() || isKioskPrintMode(preferredPrintMode)) ? 'Silent Print' : 'Browser Print'}
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

            <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 lg:h-full lg:overflow-hidden">
                {/* Left Side: Menu Selection (70%) */}
                <div className="lg:col-span-7 bg-card border border-border rounded-xl p-3 flex flex-col h-full lg:min-h-0">
                    <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center flex-wrap gap-2">
                            <h1 className="text-lg font-bold tracking-tight">
                                {isStoreBusinessType(businessType) ? 'Store POS Billing' : 'Manual Billing'}
                            </h1>
                            <OfflineDesktopStatus />

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
                                    placeholder={isStoreBusinessType(businessType) ? 'Search item, SKU, or barcode...' : 'Search menu...'}
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
                                                const saleOptions = getItemSaleOptions(item, isStoreBusinessType(businessType));
                                                if (categoryId === 'open-items' || !item.portions || isStoreBusinessType(businessType)) {
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
                                                                    {isStoreBusinessType(businessType) && (item?.sku || item?.barcode) && (
                                                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                                                            {[item?.sku ? `SKU: ${item.sku}` : '', item?.barcode ? `Barcode: ${item.barcode}` : ''].filter(Boolean).join(' • ')}
                                                                        </p>
                                                                    )}
                                                                    {getItemAvailableStock(item) !== null && (
                                                                        <p className="mt-2 text-xs text-muted-foreground">
                                                                            In stock: {getItemAvailableStock(item)}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            <motion.button
                                                                whileHover={{ scale: 1.05 }}
                                                                whileTap={{ scale: 0.95 }}
                                                                onClick={() => addToCart(item, saleOptions[0])}
                                                                className="px-3 py-3 rounded-xl bg-gradient-to-br from-amber-500/20 via-amber-500/15 to-amber-500/10 border-2 border-amber-500/40 hover:from-amber-500 hover:via-amber-500 hover:to-amber-400 hover:text-white hover:border-amber-500 transition-all flex flex-col items-center justify-center gap-1.5 font-bold group shadow-sm hover:shadow-lg hover:shadow-amber-900/30 min-h-[70px] relative overflow-hidden"
                                                            >
                                                                <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>
                                                                {isStoreBusinessType(businessType) && (
                                                                    <span className="text-[10px] uppercase tracking-[0.18em] opacity-70 relative z-10">
                                                                        {saleOptions[0].label}
                                                                    </span>
                                                                )}
                                                                <span className="text-base font-black relative z-10">
                                                                    {formatCurrency(saleOptions[0].price)}
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
                                                                {getItemAvailableStock(item) !== null && (
                                                                    <p className="mt-2 text-xs text-muted-foreground">
                                                                        In stock: {getItemAvailableStock(item)}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        <div className={`grid gap-2.5 mt-auto ${saleOptions.length === 1 ? 'grid-cols-1' :
                                                            saleOptions.length === 2 ? 'grid-cols-2' :
                                                                'grid-cols-3'
                                                            }`}>
                                                            {saleOptions.map(portion => (
                                                                <motion.button
                                                                    key={portion.name}
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                    onClick={() => addToCart(item, portion)}
                                                                    className="px-3 py-3 rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border-2 border-primary/40 hover:from-primary hover:via-primary hover:to-primary/90 hover:text-primary-foreground hover:border-primary transition-all flex flex-col items-center justify-center gap-1.5 font-bold group shadow-sm hover:shadow-lg hover:shadow-primary/30 min-h-[70px] relative overflow-hidden"
                                                                >
                                                                    {/* Subtle gradient overlay on hover */}
                                                                    <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>

                                                                    {saleOptions.length > 1 && (
                                                                        <span className="text-xs opacity-70 group-hover:opacity-100 uppercase tracking-wider font-black relative z-10">
                                                                            {portion.label}
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
                </div>

                {/* Right Side: Live Bill Preview (30%) */}
                <div className="lg:col-span-3 flex flex-col gap-4 h-full lg:min-h-0 overflow-y-auto overscroll-contain pr-1">
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
                            <div className="space-y-2 md:col-span-2">
                                <Label className="flex items-center gap-2">Delivery Charge (Optional)</Label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={deliveryChargeInput}
                                    onChange={(e) => setDeliveryChargeInput(e.target.value)}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="w-full p-2 border rounded-md bg-input border-border"
                                    placeholder="Enter delivery charge"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label className="flex items-center gap-2">Additional Charge Name (Optional)</Label>
                                <input
                                    type="text"
                                    value={additionalChargeNameInput}
                                    onChange={(e) => setAdditionalChargeNameInput(e.target.value)}
                                    className="w-full p-2 border rounded-md bg-input border-border"
                                    placeholder="e.g. Inflation Charge, Convenience Fee"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label className="flex items-center gap-2">Additional Charge Amount (Optional)</Label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={additionalChargeInput}
                                    onChange={(e) => setAdditionalChargeInput(e.target.value)}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="w-full p-2 border rounded-md bg-input border-border"
                                    placeholder="Enter additional charge amount"
                                />
                            </div>
                            {isStoreBusinessType(businessType) && (
                                <>
                                    <div className="space-y-2">
                                        <Label>Discount</Label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={discountInput}
                                            onChange={(e) => setDiscountInput(e.target.value)}
                                            onWheel={(e) => e.currentTarget.blur()}
                                            className="w-full p-2 border rounded-md bg-input border-border"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Payment Mode</Label>
                                        <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full p-2 border rounded-md bg-input border-border">
                                            <option value="cash">Cash</option>
                                            <option value="upi">UPI</option>
                                            <option value="card">Card</option>
                                        </select>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl flex-grow flex flex-col min-h-0">
                        <div className="font-mono text-black bg-white p-4 rounded-t-lg flex-grow">
                            <div ref={billPrintRef} className="preview-bill">
                                <BillToPrint
                                    order={{ orderDate: new Date() }}
                                    restaurant={restaurant}
                                    billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, discount, paymentMode, grandTotal }}
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
                                onClick={handleBrowserPrintForBill}
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

