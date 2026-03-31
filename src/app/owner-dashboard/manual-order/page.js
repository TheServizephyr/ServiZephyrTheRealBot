"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin, RotateCcw, Edit, Trash2, PlusCircle, CheckCircle, ChevronDown, Lock, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { auth, rtdb } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BillToPrint from '@/components/BillToPrint';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from "@/components/ui/use-toast";
import { onValue, ref as rtdbRef } from 'firebase/database';
import { isKioskPrintMode, resolvePreferredPrintMode } from '@/lib/printMode';
import { generateCustomerOrderId } from '@/utils/generateCustomerOrderId';
import { buildActiveCallSyncPath, isCallSyncEventFresh, normalizeIndianPhoneLoose } from '@/lib/call-sync';
import {
    buildOwnerDashboardShortcutPath,
    navigateToShortcutPath,
    OwnerDashboardShortcutsDialog,
    useOwnerDashboardShortcuts,
} from '@/lib/ownerDashboardShortcuts';

import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { connectSerialPrinter, printSerialData } from '@/services/printer/webSerialPrinter';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const createBillDraftId = () => `cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const formatCategoryLabel = (categoryId = '') => String(categoryId).replace(/-/g, ' ').trim();
const getTableCustomerName = (table = {}) => {
    const customerName = table?.currentOrder?.customerDetails?.name;
    return String(customerName || '').trim();
};
const formatElapsedTableTime = (value) => {
    if (!value) return '';

    const startedAt = new Date(value);
    if (Number.isNaN(startedAt.getTime())) return '';

    const diffMs = Date.now() - startedAt.getTime();
    if (diffMs < 0) return '';

    const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
};
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
const isStoreBusinessType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'shop' || normalized === 'store';
};
const getItemAvailableStock = (item = {}) => {
    const raw = item?.availableStock ?? item?.available;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const isItemOutOfStock = (item = {}) => {
    if (item?.isAvailable === false) return true;
    const availableStock = getItemAvailableStock(item);
    return availableStock !== null && availableStock <= 0;
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
        address: '',
        notes: ''
    });
    const [orderType, setOrderType] = useState('dine-in'); // 'delivery', 'dine-in', 'pickup'
    const [phoneError, setPhoneError] = useState(false);
    const [activeTable, setActiveTable] = useState(null);
    const [manualTables, setManualTables] = useState([]);
    const [isLoadingTables, setIsLoadingTables] = useState(false);
    const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
    const [isEditTableModalOpen, setIsEditTableModalOpen] = useState(false);
    const [tableToEdit, setTableToEdit] = useState(null);
    const [tableToDelete, setTableToDelete] = useState(null);
    const [newTableName, setNewTableName] = useState('');
    const [selectedOccupiedTable, setSelectedOccupiedTable] = useState(null);
    const [tableActionLoading, setTableActionLoading] = useState(false);
    const [tableToPrint, setTableToPrint] = useState(null); // Holds table data briefly for printing
    const [deliveryChargeInput, setDeliveryChargeInput] = useState('0');
    const [additionalChargeNameInput, setAdditionalChargeNameInput] = useState('');
    const [additionalChargeInput, setAdditionalChargeInput] = useState('0');
    const [discountInput, setDiscountInput] = useState('0');
    const [paymentMode, setPaymentMode] = useState('cash');
    const [lastSavedOrderData, setLastSavedOrderData] = useState(null);

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
    const [currentBillCustomerOrderId, setCurrentBillCustomerOrderId] = useState(() => generateCustomerOrderId());
    const [openItems, setOpenItems] = useState([]); // Open items from Firestore
    const [inventoryByItemId, setInventoryByItemId] = useState({});
    const [preferredPrintMode, setPreferredPrintMode] = useState('browser');

    // Parse orderType from URL query params
    useEffect(() => {
        const typeParam = searchParams.get('type');
        if (typeParam && ['delivery', 'dine-in', 'pickup'].includes(typeParam)) {
            setOrderType(typeParam);
        }
    }, [searchParams]);

    // Category Drag & Drop State
    const [isMounted, setIsMounted] = useState(false);
    const [categoryOrder, setCategoryOrder] = useState([]);

    useEffect(() => {
        setIsMounted(true);
        if (typeof window === 'undefined') return;
        const uid = impersonatedOwnerId || employeeOfOwnerId || auth?.currentUser?.uid || 'default';
        try {
            const saved = localStorage.getItem(`manual_order_category_order_${uid}`);
            if (saved) setCategoryOrder(JSON.parse(saved));
        } catch (e) { }
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const onCategoryDragEnd = (result) => {
        if (!result.destination) return;
        const { source, destination } = result;
        if (source.droppableId !== destination.droppableId) return;

        setCategoryOrder(prev => {
            // Ensure visibleMenuEntries is defined before using it
            const currentEntries = typeof visibleMenuEntries !== 'undefined' ? visibleMenuEntries : [];
            const sortedIds = (
                prev.length > 0
                    ? [...currentEntries].sort((a, b) => {
                        const idxA = prev.indexOf(a[0]);
                        const idxB = prev.indexOf(b[0]);
                        if (idxA === -1 && idxB === -1) return 0;
                        if (idxA === -1) return 1;
                        if (idxB === -1) return -1;
                        return idxA - idxB;
                    })
                    : currentEntries
            ).map(e => e[0]);

            const [reorderedItem] = sortedIds.splice(source.index, 1);
            sortedIds.splice(destination.index, 0, reorderedItem);

            try {
                const uid = impersonatedOwnerId || employeeOfOwnerId || auth?.currentUser?.uid || 'default';
                localStorage.setItem(`manual_order_category_order_${uid}`, JSON.stringify(sortedIds));
            } catch (e) { }
            return sortedIds;
        });
    };
    const [cacheStatus, setCacheStatus] = useState('checking');
    const [businessType, setBusinessType] = useState('restaurant');
    const [isBusinessTypeResolved, setIsBusinessTypeResolved] = useState(false);
    const [callSyncTarget, setCallSyncTarget] = useState({ businessId: '', collectionName: '' });
    const [callSyncStatus, setCallSyncStatus] = useState('inactive');
    const [lastLiveCallPhone, setLastLiveCallPhone] = useState('');
    const [isCustomOpenItemModalOpen, setIsCustomOpenItemModalOpen] = useState(false);
    const [customOpenItemName, setCustomOpenItemName] = useState('');
    const [customOpenItemPrice, setCustomOpenItemPrice] = useState('');
    const hasHydratedFromCacheRef = useRef(false);
    const phoneInputFocusRef = useRef(false);
    const lastAutoFilledPhoneRef = useRef('');
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
    const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
    const [, setTableTimeTick] = useState(0);
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
        setPreferredPrintMode(resolvePreferredPrintMode(searchParams));
    }, [searchParams]);

    useEffect(() => {
        if (tableToPrint && handleTablePrint) {
            handleTablePrint();
            // Automatically clear after a short delay so consecutive prints work
            const timer = setTimeout(() => setTableToPrint(null), 1000);
            return () => clearTimeout(timer);
        }
    }, [tableToPrint, handleTablePrint]);

    useEffect(() => {
        if (orderType !== 'dine-in') return undefined;

        const timer = setInterval(() => {
            setTableTimeTick((tick) => tick + 1);
        }, 60000);

        return () => clearInterval(timer);
    }, [orderType]);

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
        if (payload.businessType) {
            setBusinessType(payload.businessType);
            setIsBusinessTypeResolved(true);
        }
        if (payload.callSyncTarget?.businessId && payload.callSyncTarget?.collectionName) {
            setCallSyncTarget(payload.callSyncTarget);
        }

        if (isStoreBusinessType(payload.businessType)) {
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
    }, [buildScopedUrl, readCachedPayload]);

    useEffect(() => {
        let isMounted = true;

        const fetchMenuAndSettings = async () => {
            // Only show loading spinner when there's no local cache yet
            // This prevents the loading flicker on every re-visit
            const hasCachedMenu = !!readCachedPayload()?.data?.menu;
            if (!hasCachedMenu) setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("Authentication required.");
                const idToken = await user.getIdToken();

                const headers = { 'Authorization': `Bearer ${idToken}` };
                const menuUrl = buildScopedUrl('/api/owner/menu?compact=1&includeOpenItems=1');
                const inventoryUrl = buildScopedUrl('/api/owner/inventory?limit=500');
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
                            if (cached?.data?.businessType) {
                                setBusinessType(cached.data.businessType);
                                setIsBusinessTypeResolved(true);
                            }
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
                    if (isStoreBusinessType(cached?.data?.businessType)) {
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
                            const resolvedBusinessType = settingsData.businessType || cached?.data?.businessType || 'restaurant';
                            const nextCallSyncTarget = {
                                businessId: String(settingsData.businessId || '').trim(),
                                collectionName: String(settingsData.collectionName || '').trim(),
                            };
                            setBusinessType(resolvedBusinessType);
                            setIsBusinessTypeResolved(true);
                            setCallSyncTarget(nextCallSyncTarget);
                            const nextRestaurantPayload = {
                                name: settingsData.restaurantName,
                                address: settingsData.address,
                                botDisplayNumber: settingsData.botDisplayNumber || '',
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
                                businessType: resolvedBusinessType,
                                callSyncTarget: nextCallSyncTarget,
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
                const isStoreOutlet = isStoreBusinessType(resolvedBusinessType);
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
                    setBusinessType(resolvedBusinessType);
                    setIsBusinessTypeResolved(true);
                    // Unblock UI as soon as menu is ready; settings can hydrate in background.
                    setCacheStatus('network-refresh');
                    setLoading(false);
                    if (restaurantPayload) {
                        setRestaurant(restaurantPayload);
                    }
                }

                writeCachedPayload({
                    menu: menuWithInventory,
                    openItems: dedupeOpenItems(openItemsData.items || []),
                    restaurant: restaurantPayload,
                    businessType: resolvedBusinessType,
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
                    const settingsBusinessType = settingsData.businessType || resolvedBusinessType;
                    const nextCallSyncTarget = {
                        businessId: String(settingsData.businessId || '').trim(),
                        collectionName: String(settingsData.collectionName || '').trim(),
                    };
                    setBusinessType(settingsBusinessType);
                    setIsBusinessTypeResolved(true);
                    setCallSyncTarget(nextCallSyncTarget);
                    const nextRestaurantPayload = {
                        name: settingsData.restaurantName,
                        address: settingsData.address,
                        botDisplayNumber: settingsData.botDisplayNumber || '',
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
                        menu: menuWithInventory,
                        openItems: dedupeOpenItems(openItemsData.items || []),
                        restaurant: nextRestaurantPayload,
                        businessType: settingsBusinessType,
                        callSyncTarget: nextCallSyncTarget,
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

    useEffect(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();

        if (!businessId || !collectionName) {
            setCallSyncStatus('inactive');
            return undefined;
        }

        setCallSyncStatus('listening');
        const streamRef = rtdbRef(rtdb, buildActiveCallSyncPath({ businessId, collectionName }));
        const unsubscribe = onValue(streamRef, (snapshot) => {
            const payload = snapshot.val();
            if (!payload) {
                setCallSyncStatus('listening');
                return;
            }

            const phone = normalizeIndianPhoneLoose(payload.phone);
            const state = String(payload.state || '').trim().toLowerCase();
            const timestampMs = Number(payload.timestampMs || payload.updatedAt || 0);
            const isIncoming = state === 'ringing' || state === 'incoming';

            if (!isIncoming || phone.length !== 10 || !isCallSyncEventFresh(timestampMs)) {
                setCallSyncStatus('listening');
                return;
            }

            setLastLiveCallPhone(phone);
            setCallSyncStatus('incoming');
            setCustomerDetails((prev) => {
                const currentPhone = normalizeIndianPhoneLoose(prev.phone);
                const canReplaceExisting = !currentPhone || currentPhone === lastAutoFilledPhoneRef.current;
                if (phoneInputFocusRef.current && !canReplaceExisting && currentPhone !== phone) return prev;
                if (!canReplaceExisting && currentPhone !== phone) return prev;

                lastAutoFilledPhoneRef.current = phone;
                if (prev.phone === phone) return prev;
                return { ...prev, phone };
            });
        }, (error) => {
            console.error('[ManualOrder] Call sync listener failed:', error);
            setCallSyncStatus('error');
        });

        return () => unsubscribe();
    }, [callSyncTarget?.businessId, callSyncTarget?.collectionName]);

    const enforceCartStockLimit = useCallback((candidateItem, nextQuantity) => {
        if (candidateItem?.isAvailable === false) {
            toast({
                title: 'Item Unavailable',
                description: `"${candidateItem?.name || 'This item'}" is marked out of stock right now.`,
                variant: 'destructive',
            });
            return false;
        }

        const availableStock = getItemAvailableStock(candidateItem);
        if (availableStock !== null && availableStock <= 0) {
            toast({
                title: 'Out of Stock',
                description: `"${candidateItem?.name || 'This item'}" is not available right now.`,
                variant: 'destructive',
            });
            return false;
        }
        if (availableStock === null) return true;
        if (nextQuantity <= availableStock) return true;

        toast({
            title: 'Stock Limit Reached',
            description: `Only ${availableStock} unit(s) of "${candidateItem?.name || 'this item'}" are available right now.`,
            variant: 'destructive',
        });
        return false;
    }, [toast]);

    useEffect(() => {
        if (isStoreBusinessType(businessType) && orderType === 'dine-in') {
            setOrderType('delivery');
            setActiveTable(null);
        }
    }, [businessType, orderType]);

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
                // Sort ascending by name (numeric sort)
                const sortedTables = (data.tables || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
                setManualTables(sortedTables);
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
            container.scrollTop = top;
            setActiveCategory(catId);
        }
    };

    const handleEditTableSubmit = async (e) => {
        e.preventDefault();
        if (!newTableName.trim() || !tableToEdit) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const idToken = await user.getIdToken();
            const res = await fetch(buildScopedUrl('/api/owner/manual-tables'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ id: tableToEdit.id, name: newTableName.trim() })
            });

            if (res.ok) {
                toast({ title: 'Success', description: 'Table updated successfully.', variant: 'success' });
                setIsEditTableModalOpen(false);
                setTableToEdit(null);
                setNewTableName('');
                fetchManualTables();
            } else {
                const data = await res.json();
                throw new Error(data.message || 'Failed to update table');
            }
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setTableActionLoading(false);
        }
    };

    const handleDeleteTable = (table) => {
        setTableToDelete(table);
    };

    const executeDeleteTable = async () => {
        if (!tableToDelete) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const idToken = await user.getIdToken();
            const res = await fetch(buildScopedUrl(`/api/owner/manual-tables?tableId=${tableToDelete.id}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (res.ok) {
                toast({ title: 'Success', description: 'Table deleted successfully.', variant: 'success' });
                fetchManualTables();
                setTableToDelete(null);
            } else {
                const data = await res.json();
                throw new Error(data.message || 'Failed to delete table');
            }
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setTableActionLoading(false);
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
        const normalizedOption = portion || buildSaleOption('regular', item?.price, 'Add');
        const cartItemId = `${item.id}-${normalizedOption.name}`;
        const existingItem = cart.find(i => i.cartItemId === cartItemId);
        if (existingItem) {
            const nextQuantity = existingItem.quantity + 1;
            if (!enforceCartStockLimit(item, nextQuantity)) return;
            setItemHistory(prev => [...prev, cartItemId]); // Record history
            setCart(cart.map(i => i.cartItemId === cartItemId ? { ...i, quantity: nextQuantity, totalPrice: (i.totalPrice / i.quantity) * nextQuantity } : i));
        } else {
            if (!enforceCartStockLimit(item, 1)) return;
            setItemHistory(prev => [...prev, cartItemId]); // Record history
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
        setLastSavedOrderData(null);
        setCurrentBillCustomerOrderId(generateCustomerOrderId());
        setCustomerDetails({ name: '', phone: '', address: '', notes: '' });
        setPhoneError(false);
        setDiscountInput('0');
        setPaymentMode('cash');
    };

    const handleClear = () => {
        resetCurrentBill();
    };

    const shortcutScope = useMemo(() => ({
        impersonatedOwnerId,
        employeeOfOwnerId,
    }), [employeeOfOwnerId, impersonatedOwnerId]);

    const navigateWithShortcut = useCallback((basePath) => {
        navigateToShortcutPath(buildOwnerDashboardShortcutPath(basePath, shortcutScope));
    }, [shortcutScope]);

    const focusManualSearch = useCallback(() => {
        if (!searchInputRef.current) return;
        searchInputRef.current.focus();
        searchInputRef.current.select?.();
    }, []);

    const switchOrderMode = useCallback((mode) => {
        setOrderType(mode);
        if (mode !== 'dine-in') setActiveTable(null);
    }, []);

    const openPrintShortcut = useCallback(() => {
        if (!cart.length) return;
        setIsBillModalOpen(true);
    }, [cart.length]);

    const shortcutSections = useMemo(() => ([
        {
            title: 'Page Navigation',
            shortcuts: [
                { combo: 'Alt+M', description: 'Open Manual Billing' },
                { combo: 'Alt+O', description: 'Open Live Orders' },
                { combo: 'Alt+A', description: 'Open Analytics' },
                { combo: 'Alt+D', description: 'Open Dine In' },
                { combo: 'Alt+W', description: 'Open WhatsApp Direct' },
            ],
        },
        {
            title: 'Manual Billing',
            shortcuts: [
                { combo: 'Alt+1', description: 'Switch to Delivery tab' },
                { combo: 'Alt+2', description: 'Switch to Dine In tab' },
                { combo: 'Alt+3', description: 'Switch to Pickup tab' },
                { combo: '/', description: 'Focus search' },
                { combo: 'Alt+Z', description: 'Undo last added item' },
                { combo: 'Alt+X', description: 'Clear current bill' },
                { combo: 'Alt+P', description: 'Open print bill dialog' },
                { combo: '?', description: 'Show shortcut help' },
            ],
        },
    ]), []);

    const ownerDashboardShortcuts = useMemo(() => ([
        { key: 'm', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/manual-order') },
        { key: 'o', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/live-orders') },
        { key: 'a', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/analytics') },
        { key: 'd', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/dine-in') },
        { key: 'w', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/whatsapp-direct') },
        { key: '1', altKey: true, action: () => switchOrderMode('delivery') },
        { key: '2', altKey: true, action: () => switchOrderMode('dine-in') },
        { key: '3', altKey: true, action: () => switchOrderMode('pickup') },
        { key: '/', action: focusManualSearch },
        { key: 'z', altKey: true, action: handleUndo },
        { key: 'x', altKey: true, action: handleClear },
        { key: 'p', altKey: true, action: openPrintShortcut },
    ]), [focusManualSearch, handleClear, handleUndo, navigateWithShortcut, openPrintShortcut, switchOrderMode]);

    useOwnerDashboardShortcuts({
        shortcuts: ownerDashboardShortcuts,
        onOpenHelp: () => setIsShortcutHelpOpen(true),
    });

    const resetCustomOpenItemForm = useCallback(() => {
        setCustomOpenItemName('');
        setCustomOpenItemPrice('');
    }, []);

    const handleCustomOpenItemModalChange = useCallback((open) => {
        setIsCustomOpenItemModalOpen(open);
        if (!open) {
            resetCustomOpenItemForm();
        }
    }, [resetCustomOpenItemForm]);

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

    const addCustomOpenItemToCart = useCallback(() => {
        const trimmedName = customOpenItemName.trim();
        const normalizedPrice = Math.round((Number(customOpenItemPrice) || 0) * 100) / 100;

        if (!trimmedName) {
            toast({ title: 'Item Name Required', description: 'Please enter the name of the one-time item.', variant: 'destructive' });
            return;
        }

        if (!(normalizedPrice > 0)) {
            toast({ title: 'Valid Price Required', description: 'Please enter a valid price for the one-time item.', variant: 'destructive' });
            return;
        }

        const cartItemId = `custom-open-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const cartItem = {
            id: cartItemId,
            name: trimmedName,
            categoryId: 'open-items',
            quantity: 1,
            cartItemId,
            price: normalizedPrice,
            totalPrice: normalizedPrice,
            isCustomOpenItem: true,
        };

        setItemHistory(prev => [...prev, cartItemId]);
        setCart(currentCart => [...currentCart, cartItem]);
        handleCustomOpenItemModalChange(false);
    }, [customOpenItemName, customOpenItemPrice, handleCustomOpenItemModalChange, toast]);

    const { subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, discount, grandTotal } = useMemo(() => {
        const sub = cart.reduce((sum, item) => sum + item.totalPrice, 0);

        const normalizedDeliveryCharge = orderType === 'delivery' ? Math.max(0, Number(deliveryChargeInput) || 0) : 0;
        const normalizedDiscount = Math.max(0, Number(discountInput) || 0);

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
    }, [cart, restaurant, deliveryChargeInput, orderType, discountInput]);

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
            portionName: item.portionName || item.portion?.name || '',
            selectedPortion: item.selectedPortion || null,
            variant: item.variant || item.portion?.name || '',
            portionCount: Number(item.portionCount || (Array.isArray(item.portions) ? item.portions.length : 0)) || 0,
            portions: Array.isArray(item.portions)
                ? item.portions.map((portion) => ({
                    name: String(portion?.name || '').trim(),
                    price: Number(portion?.price || 0),
                }))
                : [],
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
                customerOrderId: currentBillCustomerOrderId,
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
            if (data?.historyId) {
                setLastSavedOrderData({
                    historyId: data.historyId,
                    customerOrderId: data.customerOrderId || currentBillCustomerOrderId
                });
            }
        }
        return data;
    };

    const validatePhoneNumber = () => {
        const phone = customerDetails.phone?.trim() || '';
        const isDelivery = orderType === 'delivery';
        const hasNonDigits = /[^0-9]/.test(phone);

        if (hasNonDigits) {
            setPhoneError(true);
            setIsCustomerDetailsOpen(true);
            toast({ title: 'Invalid Phone Number', description: 'Only Numeric values are allowed.', variant: 'destructive' });
            return false;
        }

        if (isDelivery) {
            if (phone.length !== 10) {
                setPhoneError(true);
                setIsCustomerDetailsOpen(true);
                toast({ title: 'Invalid Phone Number', description: 'For Delivery order 10 digit number is mandatory.', variant: 'destructive' });
                return false;
            }
        } else {
            if (phone.length > 0 && phone.length !== 10) {
                setPhoneError(true);
                setIsCustomerDetailsOpen(true);
                toast({ title: 'Invalid Phone Number', description: 'Phone number should be 10 digits.', variant: 'destructive' });
                return false;
            }
        }
        setPhoneError(false);
        return true;
    };

    const handleOccupyTable = async () => {
        if (!activeTable) return;
        if (activeTable?.currentOrder?.isFinalized) {
            toast({ title: 'Order Locked', description: 'This order is finalized and cannot be edited.', variant: 'destructive' });
            return;
        }
        if (!validatePhoneNumber()) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            const idToken = await user.getIdToken();

            const currentOrder = {
                items: cart,
                customerDetails,
                subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, grandTotal,
                orderType: 'dine-in',
                orderDate: activeTable?.currentOrder?.orderDate || new Date().toISOString(),
                occupiedAt: activeTable?.currentOrder?.occupiedAt || new Date().toISOString(),
            };

            const res = await fetch(buildScopedUrl(`/api/owner/manual-tables/${activeTable.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'occupy', currentOrder })
            });

            if (!res.ok) throw new Error('Failed to save to table');

            toast({ title: 'Saved', description: `Order saved to ${activeTable.name}` });

            // Auto-print bill after saving to table
            const savedTableData = { ...activeTable, currentOrder };
            setTableToPrint(savedTableData);

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

    const handleFinalizeTable = async (tableData = null) => {
        const tableToFinalize = tableData?.id ? tableData : selectedOccupiedTable;
        if (!tableToFinalize || !tableToFinalize.currentOrder) return;
        if (tableToFinalize.currentOrder?.isFinalized) return;
        setTableActionLoading(true);
        try {
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            const res = await fetch(buildScopedUrl(`/api/owner/manual-tables/${tableToFinalize.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'finalize' })
            });
            if (!res.ok) throw new Error('Failed to lock order');
            toast({ title: 'Order Locked', description: `${tableToFinalize.name} order is now finalized. No further edits allowed.` });
            setSelectedOccupiedTable(null);
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

            // Auto-settle the dine-in order right away
            const historyData = await historyRes.json();
            const savedHistoryId = historyData?.historyId;
            if (savedHistoryId) {
                await fetch(buildScopedUrl('/api/owner/custom-bill/history'), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    body: JSON.stringify({ action: 'settle', historyIds: [savedHistoryId] }),
                });
            }

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
        if (!validatePhoneNumber()) return;

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
        if (!validatePhoneNumber()) return;

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
                toast({ title: 'Printed', description: 'Receipt printed and saved in bill history.' });
            } catch (historyError) {
                console.error('[Custom Bill] Failed to save direct-print history:', historyError);
                toast({
                    title: 'Partial Success',
                    description: `Receipt printed successfully, but history could not be saved: ${historyError.message}`,
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
        <div className="text-foreground bg-background h-full overflow-hidden flex flex-col">
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
                            order={{ 
                                orderDate: new Date(), 
                                orderType,
                                customerOrderId: lastSavedOrderData?.customerOrderId || currentBillCustomerOrderId,
                                id: lastSavedOrderData?.historyId
                            }}
                            restaurant={restaurant}
                            billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, discount, paymentMode, grandTotal }}
                            items={cart}
                            customerDetails={customerDetails}
                        />
                    </div>
                    {isKioskPrintMode(preferredPrintMode) && (
                        <div className="px-4 py-2 text-xs text-emerald-700 bg-emerald-50 border-t border-emerald-200 no-print">
                            Silent print mode active. System popups will not appear when printing from the Kiosk browser.
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
                            title={isKioskPrintMode(preferredPrintMode) ? 'Silent print via kiosk browser' : 'Standard browser print dialog'}
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            {isSavingBillHistory ? 'Saving...' : isKioskPrintMode(preferredPrintMode) ? 'Silent Print' : 'Browser Print'}
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

            <Dialog open={isCustomOpenItemModalOpen} onOpenChange={handleCustomOpenItemModalChange}>
                <DialogContent className="bg-card border-border text-foreground max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add One-Time Item</DialogTitle>
                        <DialogDescription>
                            This item will only be added to the current bill. It will not be saved in the menu.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <Label htmlFor="custom-open-item-name">Item Name</Label>
                            <input
                                id="custom-open-item-name"
                                type="text"
                                value={customOpenItemName}
                                onChange={(e) => setCustomOpenItemName(e.target.value)}
                                placeholder="e.g. Special Packing Charge"
                                className="w-full mt-2 p-2 border rounded-md bg-input border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                                autoFocus
                            />
                        </div>
                        <div>
                            <Label htmlFor="custom-open-item-price">Price</Label>
                            <input
                                id="custom-open-item-price"
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={customOpenItemPrice}
                                onChange={(e) => setCustomOpenItemPrice(e.target.value)}
                                placeholder="e.g. 120"
                                className="w-full mt-2 p-2 border rounded-md bg-input border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => handleCustomOpenItemModalChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={addCustomOpenItemToCart} className="bg-primary hover:bg-primary/90">
                            Add to Bill
                        </Button>
                    </DialogFooter>
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

            {/* Delete Table Modal */}
            <Dialog open={!!tableToDelete} onOpenChange={(open) => !open && setTableToDelete(null)}>
                <DialogContent className="bg-card border-border max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-destructive font-bold">Delete Table</DialogTitle>
                        <DialogDescription className="pt-2 text-[15px]">
                            Are you sure you want to delete <strong className="text-foreground">&quot;{tableToDelete?.name}&quot;</strong>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-2">
                        <Button variant="outline" onClick={() => setTableToDelete(null)}>Cancel</Button>
                        <Button variant="destructive" className="bg-destructive hover:bg-destructive/90" onClick={executeDeleteTable} disabled={tableActionLoading}>
                            {tableActionLoading ? 'Deleting...' : 'Delete'}
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
                                    {(selectedOccupiedTable.currentOrder?.cgst > 0 || selectedOccupiedTable.currentOrder?.sgst > 0) && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">GST:</span>
                                            <span className="font-semibold">{formatCurrency((selectedOccupiedTable.currentOrder?.cgst || 0) + (selectedOccupiedTable.currentOrder?.sgst || 0))}</span>
                                        </div>
                                    )}
                                    {selectedOccupiedTable.currentOrder?.deliveryCharge > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Delivery Charge:</span>
                                            <span className="font-semibold">{formatCurrency(selectedOccupiedTable.currentOrder?.deliveryCharge || 0)}</span>
                                        </div>
                                    )}
                                    {selectedOccupiedTable.currentOrder?.additionalCharge > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">{selectedOccupiedTable.currentOrder?.additionalChargeLabel || 'Additional Charge'}:</span>
                                            <span className="font-semibold">{formatCurrency(selectedOccupiedTable.currentOrder?.additionalCharge || 0)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
                                        <span>Total:</span>
                                        <span className="text-primary">{formatCurrency(selectedOccupiedTable.currentOrder?.grandTotal || 0)}</span>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter className="mt-2" style={{ display: 'block' }}>
                                {(() => {
                                    const isFinalized = !!selectedOccupiedTable?.currentOrder?.isFinalized;
                                    return (
                                        <div className="grid grid-cols-2 gap-2">
                                            {/* Edit — hidden when finalized */}
                                            {!isFinalized && (
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
                                                    className="border-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                                                    disabled={tableActionLoading}
                                                >
                                                    <Edit className="w-4 h-4 mr-1.5" /> Edit
                                                </Button>
                                            )}
                                            {/* Print Bill */}
                                            <Button
                                                onClick={() => setTableToPrint(selectedOccupiedTable)}
                                                className={cn(
                                                    "bg-indigo-600 hover:bg-indigo-700 font-semibold",
                                                    isFinalized && "col-span-1"
                                                )}
                                                disabled={tableActionLoading}
                                            >
                                                <Printer className="w-4 h-4 mr-1.5" /> Print
                                            </Button>
                                            {/* Lock Order  hidden when finalized */}
                                            {!isFinalized && (
                                                <Button
                                                    onClick={() => handleFinalizeTable()}
                                                    className="bg-orange-500 hover:bg-orange-600 font-semibold"
                                                    disabled={tableActionLoading}
                                                >
                                                    <Lock className="w-4 h-4 mr-1.5" /> Lock Order
                                                </Button>
                                            )}
                                            {/* Settle & Free */}
                                            <Button
                                                onClick={() => handleSettleTable()}
                                                className={cn(
                                                    "bg-emerald-600 hover:bg-emerald-700 font-bold",
                                                    isFinalized && "col-span-1"
                                                )}
                                                disabled={tableActionLoading}
                                            >
                                                <CheckCircle className="w-4 h-4 mr-1.5" /> Settle & Free
                                            </Button>
                                        </div>
                                    );
                                })()}
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

            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
                {/* Left Side: Menu Selection (Flexible) */}
                <div className="flex-1 min-w-0 min-h-0 bg-card flex flex-col overflow-hidden">
                    <div className="flex flex-col gap-2 mb-2 sm:flex-row sm:items-center sm:justify-between px-3 pt-2 pb-2 border-b border-border shrink-0">
                        <div className="flex items-center flex-wrap gap-2">
                            <h1 className="text-lg font-bold tracking-tight">
                                {isStoreBusinessType(businessType) ? 'Store POS Billing' : 'Manual Billing'}
                            </h1>

                            <div className="flex bg-muted p-1 rounded-lg ml-0 sm:ml-2">
                                {(isStoreBusinessType(businessType) ? ['delivery', 'pickup'] : ['delivery', 'dine-in', 'pickup']).map(mode => (
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

                        {/* Only show Search, Clear, Undo if NOT in Dine In OR if a specific table is active */}
                        {(orderType !== 'dine-in' || activeTable) && (
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
                        )}
                    </div>

                    {orderType === 'dine-in' && !activeTable ? (
                        <div className="flex-1 overflow-y-auto p-4 bg-muted/20 border-t border-border mt-4 rounded-xl">
                            {isLoadingTables ? (
                                <div className="flex justify-center items-center h-full">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 auto-rows-fr">
                                    {manualTables.map(table => {
                                        if (table.status === 'occupied') {
                                            const customerName = getTableCustomerName(table);
                                            const occupiedTime = formatElapsedTableTime(table.currentOrder?.occupiedAt || table.currentOrder?.orderDate);
                                            const isFinalized = !!table.currentOrder?.isFinalized;
                                            return (
                                                <div
                                                    key={table.id}
                                                    className={cn(
                                                        "relative flex flex-col p-3 rounded-xl border-2 shadow-md min-h-[132px] text-center overflow-hidden cursor-pointer group",
                                                        isFinalized
                                                            ? "border-emerald-500 bg-[#1a2a1e]"
                                                            : "border-amber-500 bg-[#1e1e1e]"
                                                    )}
                                                    onClick={() => setSelectedOccupiedTable(table)}
                                                >
                                                    {/* Large status dot — centered top, ~half card width */}
                                                    <div className="flex justify-center mb-2 mt-1">
                                                        <span
                                                            className={cn(
                                                                "block w-1/2 h-4 rounded-full",
                                                                isFinalized
                                                                    ? "bg-emerald-400"
                                                                    : "bg-yellow-400 animate-pulse"
                                                            )}
                                                            title={isFinalized ? 'Order Locked' : 'Order Active'}
                                                        />
                                                    </div>
                                                    {/* Rename button (hover) */}
                                                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setTableToEdit(table); setNewTableName(table.name); setIsEditTableModalOpen(true); }}
                                                            className="p-1.5 bg-amber-500/20 text-amber-500 hover:bg-amber-500/40 rounded-md transition-colors"
                                                            title="Rename Table">
                                                            <Edit size={12} />
                                                        </button>
                                                    </div>
                                                    {occupiedTime ? (
                                                        <span className={cn("text-sm font-semibold mb-1", isFinalized ? "text-emerald-200/90" : "text-amber-200/90")}>
                                                            {occupiedTime}
                                                        </span>
                                                    ) : (
                                                        <span className="mb-1 block h-5" />
                                                    )}
                                                    <h3 className="font-bold text-2xl leading-none mb-2 text-white">{table.name}</h3>
                                                    <div className="flex flex-col items-center gap-1 mb-2">
                                                        {customerName && (
                                                            <span className="max-w-full truncate text-sm font-semibold text-white/90">{customerName}</span>
                                                        )}
                                                        <span className="text-sm text-gray-300">{table.currentOrder?.items?.length || 0} {table.currentOrder?.items?.length === 1 ? 'item' : 'items'}</span>
                                                    </div>
                                                    <div className="mt-auto mb-2">
                                                        <span className={cn("text-3xl font-bold leading-none", isFinalized ? "text-emerald-400" : "text-amber-500")}>
                                                            {formatCurrency(table.currentOrder?.grandTotal || 0)}
                                                        </span>
                                                    </div>

                                                    {/* 2-button row: Edit + Print */}
                                                    <div className="mt-auto pt-2 border-t border-white/10 flex items-center justify-between gap-1.5">
                                                        {!isFinalized && (
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
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2a2a2a] text-amber-500 hover:bg-[#333] transition-colors"
                                                                title="Add/Edit Items"
                                                            >
                                                                <Edit size={15} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                // Print first
                                                                setTableToPrint(table);
                                                                // Lock the order if not already locked
                                                                if (!table?.currentOrder?.isFinalized) {
                                                                    await handleFinalizeTable(table);
                                                                }
                                                            }}
                                                            disabled={tableActionLoading}
                                                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2a2a2a] text-white hover:bg-[#333] transition-colors"
                                                            title={table?.currentOrder?.isFinalized ? 'Reprint Bill' : 'Print & Lock Bill'}
                                                        >
                                                            <Printer size={15} />
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
                                                className="cursor-pointer relative p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center min-h-[120px] text-center bg-card border-border hover:border-primary/50 hover:shadow-md group"
                                            >
                                                <div className="absolute top-1.5 right-1.5 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setTableToEdit(table); setNewTableName(table.name); setIsEditTableModalOpen(true); }}
                                                        className="p-1 bg-muted/80 text-foreground hover:bg-muted-foreground/20 rounded-md transition-colors"
                                                        title="Rename Table">
                                                        <Edit size={12} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteTable(table); }}
                                                        className="p-1 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md transition-colors"
                                                        title="Delete Table">
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                                <h3 className="font-bold text-base mb-0.5">{table.name}</h3>
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1"><CheckCircle size={10} /> Available</span>
                                            </div>
                                        );
                                    })}

                                    {/* Create Table Card */}
                                    <div
                                        onClick={() => setIsCreateTableModalOpen(true)}
                                        className="cursor-pointer p-3 rounded-xl border-2 border-dashed border-border bg-muted/10 hover:bg-muted/30 hover:border-primary/50 transition-all flex flex-col items-center justify-center min-h-[120px] text-center text-muted-foreground hover:text-foreground"
                                    >
                                        <PlusCircle className="w-6 h-6 mb-1.5" />
                                        <span className="font-semibold text-xs">Create Table</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-1 min-h-0 relative">
                            {/* CATEGORY NAVIGATION SIDEBAR */}
                            <div
                                ref={sidebarRef}
                                style={{ width: `${sidebarWidth}px` }}
                                className="flex-shrink-0 border-r border-border pr-2 overflow-y-auto overscroll-contain custom-scrollbar hidden md:block"
                            >
                                <DragDropContext onDragEnd={onCategoryDragEnd}>
                                    <Droppable droppableId="manual-categories">
                                        {(provided) => {
                                            const sortedMenuEntries = [...visibleMenuEntries].sort((a, b) => {
                                                if (categoryOrder.length === 0) return 0;
                                                const idxA = categoryOrder.indexOf(a[0]);
                                                const idxB = categoryOrder.indexOf(b[0]);
                                                if (idxA === -1 && idxB === -1) return 0;
                                                if (idxA === -1) return 1;
                                                if (idxB === -1) return -1;
                                                return idxA - idxB;
                                            });

                                            return (
                                                <div className="space-y-0.5 p-0.5" ref={provided.innerRef} {...provided.droppableProps}>
                                                    {isMounted && sortedMenuEntries.map(([categoryId], index) => (
                                                        <Draggable key={`cat-${categoryId}`} draggableId={`cat-${categoryId}`} index={index}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    className="relative flex items-center group border border-border/40 rounded overflow-hidden bg-background"
                                                                    style={{ ...provided.draggableProps.style }}
                                                                >
                                                                    <div
                                                                        {...provided.dragHandleProps}
                                                                        className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center bg-muted/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing border-r border-border/50 text-muted-foreground z-10"
                                                                    >
                                                                        <GripVertical size={16} />
                                                                    </div>
                                                                    <button
                                                                        onClick={() => scrollToCategory(categoryId)}
                                                                        className={cn(
                                                                            "w-full text-left pl-6 pr-2 py-1.5 text-base font-medium transition-all capitalize",
                                                                            activeCategory === categoryId
                                                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                                                : "text-muted-foreground hover:bg-muted/50"
                                                                        )}
                                                                    >
                                                                        {formatCategoryLabel(categoryId)}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            );
                                        }}
                                    </Droppable>
                                </DragDropContext>
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
                                className="flex-grow min-h-0 overflow-y-auto overscroll-contain pl-5 pr-6 lg:pr-8 custom-scrollbar pt-2"
                            >
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                                        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                        <p>Loading menu...</p>
                                    </div>
                                ) : visibleMenuEntries.map(([categoryId, filteredItems]) => (
                                    <div key={categoryId} id={`cat-${categoryId}`} className="mb-4 pt-1">
                                        <h3 className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 px-3 z-10 mb-3 border-l-4 border-primary font-bold text-base capitalize text-foreground tracking-wide">
                                            {formatCategoryLabel(categoryId)}
                                        </h3>
                                        {categoryId === 'open-items' ? (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                                    <motion.button
                                                        type="button"
                                                        whileHover={{ y: -4, scale: 1.02 }}
                                                        whileTap={{ scale: 0.98 }}
                                                        onClick={() => setIsCustomOpenItemModalOpen(true)}
                                                        className="group relative overflow-hidden p-4 text-left bg-gradient-to-br from-emerald-950/30 via-emerald-900/15 to-emerald-900/5 hover:from-emerald-900/35 hover:via-emerald-800/20 hover:to-emerald-900/10 rounded-2xl border border-emerald-500/35 hover:border-emerald-400/70 transition-all shadow-md hover:shadow-xl hover:shadow-emerald-950/20 min-h-[130px] flex flex-col justify-between"
                                                    >
                                                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.14),transparent_55%)] pointer-events-none"></div>
                                                        <div className="relative flex items-start justify-between gap-3">
                                                            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                                                                <PlusCircle size={22} className="text-emerald-400" />
                                                            </div>
                                                            <span className="text-[10px] uppercase tracking-[0.22em] font-bold text-emerald-300/80">
                                                                Quick Add
                                                            </span>
                                                        </div>
                                                        <div className="relative flex-1 mt-4">
                                                            <p className="font-bold text-foreground text-lg leading-tight">
                                                                Add One-Time Item
                                                            </p>
                                                            <p className="text-sm text-muted-foreground mt-2 leading-snug max-w-[16rem]">
                                                                Just enter the name and price. The item will be added directly to the current bill and will not be saved in the menu.
                                                            </p>
                                                        </div>
                                                    </motion.button>

                                                    {filteredItems.map(item => {
                                                        const isUnavailable = isItemOutOfStock(item);
                                                        return (
                                                            <motion.div
                                                                key={item.id}
                                                                whileHover={{ y: -4, scale: 1.02 }}
                                                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                                className={cn(
                                                                    "p-5 bg-gradient-to-br from-amber-900/20 via-amber-800/10 to-amber-900/5 rounded-2xl border-2 border-amber-600/30 transition-all shadow-md min-h-[130px] flex flex-col backdrop-blur-sm",
                                                                    isUnavailable
                                                                        ? "opacity-55 grayscale"
                                                                        : "hover:from-amber-900/30 hover:via-amber-800/15 hover:to-amber-900/10 hover:border-amber-500/60 hover:shadow-xl hover:shadow-amber-900/20"
                                                                )}
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
                                                                {isUnavailable ? (
                                                                    <div className="px-3 py-3 rounded-xl border-2 border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center font-bold min-h-[70px]">
                                                                        Out of Stock
                                                                    </div>
                                                                ) : (
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
                                                                )}
                                                            </motion.div>
                                                        );
                                                    })}
                                                </div>

                                                {filteredItems.length === 0 && (
                                                    <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-900/10 text-sm text-muted-foreground">
                                                        No saved open items found in search. You can add a one-time item directly to the bill if needed.
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                                {filteredItems.map(item => {
                                                    const isUnavailable = isItemOutOfStock(item);
                                                    const saleOptions = getItemSaleOptions(item, isStoreBusinessType(businessType));
                                                    if (!item.portions || isStoreBusinessType(businessType)) {
                                                        return (
                                                            <motion.div
                                                                key={item.id}
                                                                whileHover={{ y: -2, scale: 1.01 }}
                                                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                                className={cn(
                                                                    "p-2.5 bg-gradient-to-br from-amber-900/20 via-amber-800/10 to-amber-900/5 rounded-xl border-2 border-amber-600/40 transition-all shadow-sm flex flex-col",
                                                                    isUnavailable
                                                                        ? "opacity-55 grayscale"
                                                                        : "hover:from-amber-900/30 hover:via-amber-800/15 hover:to-amber-900/10 hover:border-amber-500/80 hover:shadow-md hover:shadow-amber-900/20"
                                                                )}
                                                            >
                                                                <div className="flex-1 mb-1.5">
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
                                                                {isUnavailable ? (
                                                                    <div className="px-2 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center font-bold text-xs">
                                                                        Out of Stock
                                                                    </div>
                                                                ) : (
                                                                    <motion.button
                                                                        whileHover={{ scale: 1.03 }}
                                                                        whileTap={{ scale: 0.97 }}
                                                                        onClick={() => addToCart(item, saleOptions[0])}
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-gradient-to-br from-amber-500/20 via-amber-500/15 to-amber-500/10 border border-amber-500/40 hover:from-amber-500 hover:via-amber-500 hover:to-amber-400 hover:text-white hover:border-amber-500 transition-all flex flex-col items-center justify-center gap-0.5 font-bold group shadow-sm hover:shadow-md hover:shadow-amber-900/30 relative overflow-hidden"
                                                                    >
                                                                        <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>
                                                                        {isStoreBusinessType(businessType) && (
                                                                            <span className="text-[9px] uppercase tracking-[0.15em] opacity-70 relative z-10">
                                                                                {saleOptions[0].label}
                                                                            </span>
                                                                        )}
                                                                        <span className="text-sm font-black relative z-10">
                                                                            {formatCurrency(saleOptions[0].price)}
                                                                        </span>
                                                                    </motion.button>
                                                                )}
                                                            </motion.div>
                                                        );
                                                    }

                                                    // Handle Regular Menu Items
                                                    return (
                                                        <motion.div
                                                            key={item.id}
                                                            whileHover={{ y: -2, scale: 1.01 }}
                                                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                            className={cn(
                                                                "p-2.5 bg-gradient-to-br from-card via-card to-card/90 rounded-xl border-2 border-border transition-all shadow-sm flex flex-col",
                                                                isUnavailable
                                                                    ? "opacity-55 grayscale"
                                                                    : "hover:from-card hover:via-muted/20 hover:to-card hover:border-primary/80 hover:shadow-md hover:shadow-primary/20"
                                                            )}
                                                        >
                                                            <div className="flex-1 mb-1.5">
                                                                <p className="font-bold text-foreground text-base leading-tight">
                                                                    {item.name}
                                                                </p>
                                                                {getItemAvailableStock(item) !== null && (
                                                                    <p className="mt-2 text-xs text-muted-foreground">
                                                                        In stock: {getItemAvailableStock(item)}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <div className={`grid gap-1 mt-auto ${saleOptions.length === 1 ? 'grid-cols-1' :
                                                                saleOptions.length === 2 ? 'grid-cols-2' :
                                                                    'grid-cols-3'
                                                                }`}>
                                                                {isUnavailable ? (
                                                                    <div className="col-span-full px-2 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center font-bold text-xs">
                                                                        Out of Stock
                                                                    </div>
                                                                ) : (
                                                                    saleOptions.map(portion => (
                                                                        <motion.button
                                                                            key={portion.name}
                                                                            whileHover={{ scale: 1.03 }}
                                                                            whileTap={{ scale: 0.97 }}
                                                                            onClick={() => addToCart(item, portion)}
                                                                            className="px-1.5 py-1.5 rounded-lg bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/40 hover:from-primary hover:via-primary hover:to-primary/90 hover:text-primary-foreground hover:border-primary transition-all flex flex-col items-center justify-center gap-0.5 font-bold group shadow-sm hover:shadow-md hover:shadow-primary/30 relative overflow-hidden"
                                                                        >
                                                                            <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 group-hover:from-white/10 group-hover:via-transparent group-hover:to-transparent transition-all pointer-events-none"></div>

                                                                            {saleOptions.length > 1 && (
                                                                                <span className="text-[9px] opacity-70 group-hover:opacity-100 uppercase tracking-wider font-black relative z-10">
                                                                                    {portion.label}
                                                                                </span>
                                                                            )}
                                                                            <div className="flex items-center justify-center relative z-10">
                                                                                <span className="text-xs font-black">
                                                                                    {formatCurrency(portion.price)}
                                                                                </span>
                                                                            </div>
                                                                        </motion.button>
                                                                    ))
                                                                )}
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
                                        <input
                                            value={customerDetails.phone}
                                            onFocus={() => { phoneInputFocusRef.current = true; }}
                                            onBlur={() => { phoneInputFocusRef.current = false; }}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setCustomerDetails({ ...customerDetails, phone: val });
                                                // Clear error if it becomes valid: length 10 or (empty and not delivery) AND numeric
                                                const isNumeric = !/[^0-9]/.test(val);
                                                if (val.length === 10 && isNumeric) setPhoneError(false);
                                                if (val.length === 0 && orderType !== 'delivery') setPhoneError(false);
                                            }}
                                            className={cn(
                                                "w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border transition-colors",
                                                (customerDetails.phone.length > 10 || (customerDetails.phone.length > 0 && /[^0-9]/.test(customerDetails.phone))) ? "bg-red-500/20 border-red-500 text-red-500" : "",
                                                phoneError ? "border-red-500 ring-1 ring-red-500" : ""
                                            )}
                                        />
                                        {phoneError && <p className="text-[10px] font-bold text-red-500 mt-0.5 animate-pulse">INVALID PHONE NUMBER</p>}
                                        {!phoneError && callSyncStatus === 'listening' && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5">Live call sync ready for this outlet.</p>
                                        )}
                                        {!phoneError && callSyncStatus === 'incoming' && lastLiveCallPhone && (
                                            <p className="text-[10px] font-medium text-emerald-600 mt-0.5">Incoming call detected: {lastLiveCallPhone}</p>
                                        )}
                                        {!phoneError && callSyncStatus === 'error' && (
                                            <p className="text-[10px] text-amber-600 mt-0.5">Live call sync unavailable right now.</p>
                                        )}
                                    </div>
                                    {orderType === 'delivery' && (
                                        <>
                                            <div className="space-y-1 col-span-2">
                                                <Label className="flex items-center gap-1.5 text-xs"><MapPin size={13} /> Address</Label>
                                                <textarea rows={2} value={customerDetails.address} onChange={e => setCustomerDetails({ ...customerDetails, address: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border resize-none" />
                                            </div>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-xs">Delivery Charge (Optional)</Label>
                                                <input type="number" min="0" step="1" value={deliveryChargeInput} onChange={(e) => setDeliveryChargeInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="0" />
                                            </div>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-xs">Notes</Label>
                                                <input value={customerDetails.notes || ''} onChange={e => setCustomerDetails({ ...customerDetails, notes: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="Extra spicy, no onion..." />
                                            </div>
                                        </>
                                    )}
                                    {orderType !== 'delivery' && (
                                        <div className="space-y-1 col-span-2">
                                            <Label className="text-xs">Notes</Label>
                                            <input value={customerDetails.notes || ''} onChange={e => setCustomerDetails({ ...customerDetails, notes: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="Special note for kitchen / packing..." />
                                        </div>
                                    )}
                                    {isStoreBusinessType(businessType) && (
                                        <>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-xs">Discount</Label>
                                                <input type="number" min="0" step="1" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="0" />
                                            </div>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-xs">Payment Mode</Label>
                                                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border">
                                                    <option value="cash">Cash</option>
                                                    <option value="upi">UPI</option>
                                                    <option value="card">Card</option>
                                                </select>
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
                                order={{ orderDate: new Date(), orderType, notes: customerDetails.notes || '' }}
                                restaurant={restaurant}
                                billDetails={{ subtotal, cgst, sgst, deliveryCharge, serviceFee: additionalCharge, serviceFeeLabel: additionalChargeLabel, discount, paymentMode, grandTotal }}
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
                            {(cgst > 0 || sgst > 0) && (
                                <div className="flex justify-between text-muted-foreground text-xs">
                                    <span>GST</span>
                                    <span>{formatCurrency((cgst || 0) + (sgst || 0))}</span>
                                </div>
                            )}
                            {deliveryCharge > 0 && orderType === 'delivery' && (
                                <div className="flex justify-between text-muted-foreground text-xs">
                                    <span>Delivery Charge</span>
                                    <span>{formatCurrency(deliveryCharge)}</span>
                                </div>
                            )}
                            {additionalCharge > 0 && (
                                <div className="flex justify-between text-muted-foreground text-xs">
                                    <span>{additionalChargeLabel || 'Additional Charge'}</span>
                                    <span>{formatCurrency(additionalCharge)}</span>
                                </div>
                            )}
                            {discount > 0 && (
                                <div className="flex justify-between text-emerald-600 text-xs">
                                    <span>Discount</span>
                                    <span>-{formatCurrency(discount)}</span>
                                </div>
                            )}
                            {isStoreBusinessType(businessType) && (
                                <div className="flex justify-between text-muted-foreground text-xs">
                                    <span>Payment Mode</span>
                                    <span className="uppercase">{paymentMode}</span>
                                </div>
                            )}
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
                            order={{ 
                                orderDate: new Date(), 
                                orderType: tableToPrint.currentOrder.orderType || 'dine-in', 
                                notes: tableToPrint.currentOrder.customerDetails?.notes || '',
                                customerOrderId: lastSavedOrderData?.customerOrderId,
                                id: lastSavedOrderData?.historyId
                            }}
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

            <OwnerDashboardShortcutsDialog
                open={isShortcutHelpOpen}
                onOpenChange={setIsShortcutHelpOpen}
                sections={shortcutSections}
            />

        </div>
    );
}

export default ManualOrderPage;
