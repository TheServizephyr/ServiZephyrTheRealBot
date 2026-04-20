"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Search, Printer, User, Phone, MapPin, RotateCcw, Edit, Trash2, PlusCircle, CheckCircle, ChevronDown, Lock, GripVertical, X, Menu as MenuIcon, Mic, MicOff, SlidersHorizontal } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { auth, rtdb } from '@/lib/firebase';
import { onValue, ref } from 'firebase/database';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BillToPrint from '@/components/BillToPrint';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from "@/components/ui/use-toast";
import { isKioskPrintMode, resolvePreferredPrintMode } from '@/lib/printMode';
import { generateCustomerOrderId } from '@/utils/generateCustomerOrderId';
import VoiceBillingPanel from '@/components/manual-order/VoiceBillingPanel';
import {
    buildActiveCallSyncUserPath,
    buildCallSyncEventKey,
    buildCallSyncVoiceDraftPath,
    dismissCallSyncEventForSession,
    isCallSyncEventFresh,
    isCallSyncLiveSuggestionState,
    isCallSyncVoiceDraftFresh,
    isDismissedCallSyncEvent,
    normalizeIndianPhoneLoose,
} from '@/lib/call-sync';
import {
    buildOwnerDashboardShortcutPath,
    navigateToShortcutPath,
    OwnerDashboardShortcutsDialog,
    useOwnerDashboardShortcuts,
} from '@/lib/ownerDashboardShortcuts';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { appendOfflineQueueItem, getOfflineNamespaces, setOfflineNamespace } from '@/lib/desktop/offlineStore';
import { getBestEffortIdToken } from '@/lib/client-session';
import { silentPrintElement } from '@/lib/desktop/print';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useVoiceCommandCapture } from '@/hooks/useVoiceCommandCapture';
import {
    buildVoiceMenuIndex,
    findVoiceTableMatch,
    normalizeVoiceText,
    parseManualOrderVoiceCommand,
    serializeVoiceResolverPayload,
} from '@/lib/manual-order-voice';
import {
    getOwnerDashboardLayoutMode,
    onOwnerDashboardLayoutModeChange,
    resolveManualOrderMobileViewport,
} from '@/lib/screenOrientation';

import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { connectSerialPrinter, printSerialData } from '@/services/printer/webSerialPrinter';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const createBillDraftId = () => `cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const CALL_SUGGESTION_TTL_MS = 2 * 60 * 1000;
const formatCategoryLabel = (categoryId = '') => String(categoryId).replace(/-/g, ' ').trim();
const INITIAL_VOICE_DEBUG_SNAPSHOT = {
    phase: 'idle',
    source: '',
    provider: '',
    transcript: '',
    confidence: null,
    fallbackUsed: false,
    audioMime: '',
    audioSize: 0,
    resolvedCount: 0,
    pendingCount: 0,
    unresolvedCount: 0,
    requestedTableReference: '',
    matchedTableName: '',
    desiredMode: '',
    note: '',
    error: '',
    updatedAt: 0,
};
const buildVoiceSttKeyterms = (voiceIndex = []) => {
    const seen = new Set();
    const ranked = (Array.isArray(voiceIndex) ? voiceIndex : [])
        .map((entry) => String(entry?.name || '').trim())
        .filter(Boolean)
        .sort((left, right) => {
            const tokenDiff = right.split(/\s+/).length - left.split(/\s+/).length;
            if (tokenDiff !== 0) return tokenDiff;
            return right.length - left.length;
        });

    const keyterms = [];
    let tokenBudget = 0;

    ranked.forEach((term) => {
        const normalized = term.toLowerCase();
        if (seen.has(normalized)) return;
        const tokens = term.split(/\s+/).filter(Boolean);
        if (!tokens.length) return;
        if (keyterms.length >= 90) return;
        if (tokenBudget + tokens.length > 420) return;
        seen.add(normalized);
        keyterms.push(term);
        tokenBudget += tokens.length;
    });

    return keyterms;
};
const CUSTOMER_SUGGESTION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const normalizeSuggestionPhone = (value = '') => String(value || '').replace(/\D/g, '').slice(-10);
const normalizeAddressText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
const scoreAddressMatch = (candidate = '', query = '') => {
    const normalizedCandidate = normalizeAddressText(candidate).toLowerCase();
    const normalizedQuery = normalizeAddressText(query).toLowerCase();
    if (!normalizedQuery) return normalizedCandidate ? 1 : 0;
    if (!normalizedCandidate.includes(normalizedQuery)) return 0;
    if (normalizedCandidate.startsWith(normalizedQuery)) return 120 - normalizedCandidate.length;
    return 60 - normalizedCandidate.indexOf(normalizedQuery);
};
const scorePhoneSuggestion = (customer = {}, digits = '') => {
    const phone = normalizeSuggestionPhone(customer?.phone);
    if (!digits || !phone.includes(digits)) return -1;
    let score = phone.startsWith(digits) ? 300 : 180 - phone.indexOf(digits);
    score += Math.min(Number(customer?.totalOrders || 0), 50);
    if (customer?.lastUsedAt) {
        const daysSinceLastUse = Math.max(0, Math.floor((Date.now() - Number(customer.lastUsedAt || 0)) / 86400000));
        score += Math.max(0, 40 - Math.min(daysSinceLastUse, 40));
    }
    return score;
};
const formatSuggestionAddressPreview = (addresses = []) => {
    const firstAddress = addresses?.[0]?.full || '';
    if (!firstAddress) return '';
    return firstAddress.length > 64 ? `${firstAddress.slice(0, 61)}...` : firstAddress;
};
const sortManualTablesByName = (tables = []) => [...tables].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
const IS_DEV_BUILD = process.env.NODE_ENV !== 'production';
const SHOW_MANUAL_ORDER_VOICE_UI = false;
const DESKTOP_MUTATION_TIMEOUT_MS = IS_DEV_BUILD ? 30000 : 12000;
const DESKTOP_MUTATION_RETRY_TIMEOUT_MS = IS_DEV_BUILD ? 45000 : 20000;
const DESKTOP_TOKEN_TIMEOUT_MS = IS_DEV_BUILD ? 5000 : 1200;
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

const isDesktopOfflineMode = (desktopRuntime) => (
    Boolean(
        desktopRuntime &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
    )
);
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
    const { user } = useUser();
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
    const [customerSuggestionDataset, setCustomerSuggestionDataset] = useState({ generatedAt: 0, customers: [], addresses: [] });
    const [customerSuggestionStatus, setCustomerSuggestionStatus] = useState('idle');
    const [selectedCustomerSuggestion, setSelectedCustomerSuggestion] = useState(null);
    const [isPhoneSuggestionOpen, setIsPhoneSuggestionOpen] = useState(false);
    const [isAddressSuggestionOpen, setIsAddressSuggestionOpen] = useState(false);
    const [activePhoneSuggestionIndex, setActivePhoneSuggestionIndex] = useState(-1);
    const [activeAddressSuggestionIndex, setActiveAddressSuggestionIndex] = useState(-1);
    const [isCustomerNameInputPrimed, setIsCustomerNameInputPrimed] = useState(false);
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
    const autoPrintBillsEnabled = restaurant?.autoPrintBillsEnabled === true;

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
    const [pendingCallSuggestion, setPendingCallSuggestion] = useState(null);
    const [attachedCallContext, setAttachedCallContext] = useState(null);
    const [isCustomOpenItemModalOpen, setIsCustomOpenItemModalOpen] = useState(false);
    const [customOpenItemName, setCustomOpenItemName] = useState('');
    const [customOpenItemPrice, setCustomOpenItemPrice] = useState('');
    const [voiceCommandLog, setVoiceCommandLog] = useState([]);
    const [voicePendingItems, setVoicePendingItems] = useState([]);
    const [voiceLastTranscript, setVoiceLastTranscript] = useState('');
    const [voiceLastAction, setVoiceLastAction] = useState('');
    const [voiceDebugEvents, setVoiceDebugEvents] = useState([]);
    const [voiceDebugSnapshot, setVoiceDebugSnapshot] = useState(INITIAL_VOICE_DEBUG_SNAPSHOT);
    const [isVoiceDebugDialogOpen, setIsVoiceDebugDialogOpen] = useState(false);
    const [isVoiceCommandProcessing, setIsVoiceCommandProcessing] = useState(false);
    const [isVoiceAiResolving, setIsVoiceAiResolving] = useState(false);
    const [isVoiceFallbackTranscribing, setIsVoiceFallbackTranscribing] = useState(false);
    const hasHydratedFromCacheRef = useRef(false);
    const phoneInputFocusRef = useRef(false);
    const phoneSuggestionBoxRef = useRef(null);
    const addressSuggestionBoxRef = useRef(null);
    const dismissedCallSuggestionKeysRef = useRef(new Set());
    const scrollContainerRef = useRef(null);
    const categoryRefs = useRef({});
    const searchInputRef = useRef(null);
    const sidebarRef = useRef(null);
    const isResizing = useRef(false);
    const cartRef = useRef([]);
    const voiceTranscriptQueueRef = useRef([]);
    const isVoiceQueueRunningRef = useRef(false);
    const voiceBrowserResultQueueRef = useRef([]);
    const voiceCapturedSegmentQueueRef = useRef([]);
    const voicePendingAudioSkipCountRef = useRef(0);
    const isVoiceHybridQueueRunningRef = useRef(false);
    const browserVoiceRecognitionSupportedRef = useRef(false);
    const voiceCaptureSupportedRef = useRef(false);
    const voiceUseBrowserPrimaryRef = useRef(true);
    const voiceAudioFallbackTimerRef = useRef(null);
    const voiceRecentAudioFallbackAtRef = useRef(0);
    const lastAppliedCompanionDraftVersionRef = useRef(0);
    const [manualSidebarWidth, setManualSidebarWidth] = useState(null); // null means use dynamic default

    const billContainerRef = useRef(null);
    const isResizingBill = useRef(false);
    const [billSidebarWidth, setBillSidebarWidth] = useState(340);
    const [isCustomerDetailsOpen, setIsCustomerDetailsOpen] = useState(true);
    const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [isMobileToolsOpen, setIsMobileToolsOpen] = useState(false);
    const [isStandalonePwa, setIsStandalonePwa] = useState(false);
    const [, setTableTimeTick] = useState(0);
    const mobileSwipeStartRef = useRef(null);
    const mobileMicPressActiveRef = useRef(false);
    const mobileMicStartInFlightRef = useRef(false);
    const mobileMicStopAfterStartRef = useRef(false);
    const mobileMicStartTokenRef = useRef(0);
    const voiceListeningStateRef = useRef(false);
    const voiceLastCartMutationRef = useRef({ timestamp: 0, source: '', mode: '', tableId: '' });
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
    useEffect(() => {
        const applyViewportState = () => {
            const mobileViewport = resolveManualOrderMobileViewport({
                width: window.innerWidth,
                height: window.innerHeight,
                mode: getOwnerDashboardLayoutMode(),
            });
            setIsMobileViewport(mobileViewport);
            if (!mobileViewport) {
                setIsMobileCartOpen(false);
                setIsMobileToolsOpen(false);
            }
        };

        applyViewportState();
        window.addEventListener('resize', applyViewportState);
        window.addEventListener('orientationchange', applyViewportState);
        const unsubscribe = onOwnerDashboardLayoutModeChange(applyViewportState);
        return () => {
            window.removeEventListener('resize', applyViewportState);
            window.removeEventListener('orientationchange', applyViewportState);
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const standaloneMediaQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(display-mode: standalone)')
            : null;

        const applyStandaloneState = () => {
            const isStandalone = Boolean(
                standaloneMediaQuery?.matches ||
                window.navigator?.standalone ||
                String(document.referrer || '').startsWith('android-app://')
            );
            setIsStandalonePwa(isStandalone);
        };

        applyStandaloneState();

        if (standaloneMediaQuery && typeof standaloneMediaQuery.addEventListener === 'function') {
            standaloneMediaQuery.addEventListener('change', applyStandaloneState);
            return () => standaloneMediaQuery.removeEventListener('change', applyStandaloneState);
        }

        if (standaloneMediaQuery?.addListener) {
            standaloneMediaQuery.addListener(applyStandaloneState);
            return () => standaloneMediaQuery.removeListener(applyStandaloneState);
        }

        return undefined;
    }, []);

    useEffect(() => {
        if (isMobileViewport) {
            setIsCustomerDetailsOpen(false);
        }
    }, [isMobileViewport]);

    useEffect(() => {
        if (!isMobileViewport || (!isMobileCartOpen && !isMobileToolsOpen) || typeof document === 'undefined') return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isMobileCartOpen, isMobileToolsOpen, isMobileViewport]);
    useEffect(() => {
        cartRef.current = cart;
    }, [cart]);

    const cacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_custom_bill_cache_v2_${scope}`;
    }, [impersonatedOwnerId, employeeOfOwnerId]);
    const customerSuggestionCacheKey = useMemo(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return '';
        return `manual_order_customer_suggestions_v1_${collectionName}_${businessId}`;
    }, [callSyncTarget?.businessId, callSyncTarget?.collectionName]);
    const manualTablesCacheKey = useMemo(() => `${cacheKey}__manual_tables_v1`, [cacheKey]);
    const offlineQueueScope = useMemo(() => `${cacheKey}__queue`, [cacheKey]);
    const desktopRuntime = useMemo(() => isDesktopApp(), []);

    const buildScopedUrl = useCallback((endpoint) => {
        const url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }
        return url.toString();
    }, [impersonatedOwnerId, employeeOfOwnerId]);
    const companionDraftSeenKey = useMemo(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return '';
        return `manual_order_companion_draft_seen_v1_${collectionName}_${businessId}`;
    }, [callSyncTarget?.businessId, callSyncTarget?.collectionName]);

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

    const resolveCachedPayload = useCallback(async () => {
        const localPayload = readCachedPayload();
        if (localPayload?.data) return localPayload;
        if (!desktopRuntime) return null;
        try {
            const desktopPayload = (await getOfflineNamespaces([
                { key: 'manualOrderCache', namespace: 'manual_order_cache', scope: cacheKey, fallback: null },
            ])).manualOrderCache;
            return desktopPayload?.data ? desktopPayload : null;
        } catch {
            return null;
        }
    }, [cacheKey, desktopRuntime, readCachedPayload]);

    const writeCachedPayload = useCallback((data = {}) => {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                ts: Date.now(),
                data,
            }));
        } catch {
            // Ignore storage errors
        }
        if (desktopRuntime) {
            void setOfflineNamespace('manual_order_cache', cacheKey, {
                ts: Date.now(),
                data,
            });
        }
    }, [cacheKey, desktopRuntime]);

    const readCachedManualTables = useCallback(() => {
        try {
            const raw = localStorage.getItem(manualTablesCacheKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }, [manualTablesCacheKey]);

    const resolveCachedManualTables = useCallback(async () => {
        const localTables = readCachedManualTables();
        if (localTables.length > 0) return localTables;
        if (!desktopRuntime) return [];
        try {
            const desktopTables = (await getOfflineNamespaces([
                { key: 'manualTables', namespace: 'manual_tables', scope: manualTablesCacheKey, fallback: [] },
            ])).manualTables;
            return Array.isArray(desktopTables) ? desktopTables : [];
        } catch {
            return [];
        }
    }, [desktopRuntime, manualTablesCacheKey, readCachedManualTables]);

    const writeCachedManualTables = useCallback((tables = []) => {
        const sortedTables = sortManualTablesByName(tables);
        try {
            localStorage.setItem(manualTablesCacheKey, JSON.stringify(sortedTables));
        } catch {
            // Ignore storage errors
        }
        if (desktopRuntime) {
            void setOfflineNamespace('manual_tables', manualTablesCacheKey, sortedTables);
        }
        return sortedTables;
    }, [desktopRuntime, manualTablesCacheKey]);

    const queueOfflineAction = useCallback(async (action, payload) => {
        const item = {
            action,
            payload,
            scope: offlineQueueScope,
            impersonatedOwnerId,
            employeeOfOwnerId,
            queuedAt: new Date().toISOString(),
        };
        try {
            const raw = localStorage.getItem(offlineQueueScope);
            const queue = raw ? JSON.parse(raw) : [];
            const next = Array.isArray(queue) ? [...queue, item] : [item];
            localStorage.setItem(offlineQueueScope, JSON.stringify(next));
        } catch {
            // Ignore storage errors
        }
        if (desktopRuntime) {
            await appendOfflineQueueItem('owner_offline_sync_queue', item);
        }
    }, [desktopRuntime, employeeOfOwnerId, impersonatedOwnerId, offlineQueueScope]);

    const canUseDesktopOfflineFallback = useCallback((error = null) => {
        if (!desktopRuntime) return false;
        if (isDesktopOfflineMode(desktopRuntime)) return true;
        const message = String(error?.message || error || '').toLowerCase();
        return (
            message.includes('failed to fetch') ||
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('auth') ||
            message.includes('backend error') ||
            message.includes('unavailable') ||
            message.includes('ehostunreach') ||
            message.includes('enotfound') ||
            message.includes('identitytoolkit') ||
            message.includes('no connection established') ||
            message.includes('not authenticated') ||
            message.includes('authentication required')
        );
    }, [desktopRuntime]);

    const fetchWithDesktopMutationTimeout = useCallback(async (input, init = {}, timeoutMs = DESKTOP_MUTATION_TIMEOUT_MS) => {
        if (!desktopRuntime) {
            return fetch(input, init);
        }

        const runTimedFetch = async (requestTimeoutMs) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

            try {
                return await fetch(input, {
                    ...init,
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
        };

        try {
            return await runTimedFetch(timeoutMs);
        } catch (error) {
            if (error?.name === 'AbortError') {
                try {
                    console.warn('[Manual Order] Desktop fetch timed out, retrying once with a longer timeout.');
                    return await runTimedFetch(Math.max(timeoutMs, DESKTOP_MUTATION_RETRY_TIMEOUT_MS));
                } catch (retryError) {
                    if (retryError?.name === 'AbortError') {
                        const timeoutError = new Error('desktop action timeout');
                        timeoutError.code = 'desktop_action_timeout';
                        throw timeoutError;
                    }
                    throw retryError;
                }
            }
            throw error;
        }
    }, [desktopRuntime]);

    const getDesktopActionIdToken = useCallback(async (user = auth.currentUser, options = {}) => {
        const { timeoutMs = DESKTOP_TOKEN_TIMEOUT_MS } = options;
        return getBestEffortIdToken(user, {
            timeoutMs: desktopRuntime ? timeoutMs : 0,
        });
    }, [desktopRuntime]);
    const readSeenCompanionDraftVersion = useCallback(() => {
        if (!companionDraftSeenKey || typeof window === 'undefined') return 0;
        try {
            return Number(sessionStorage.getItem(companionDraftSeenKey) || 0) || 0;
        } catch {
            return 0;
        }
    }, [companionDraftSeenKey]);
    const writeSeenCompanionDraftVersion = useCallback((version) => {
        if (!companionDraftSeenKey || typeof window === 'undefined') return;
        try {
            sessionStorage.setItem(companionDraftSeenKey, String(Math.max(0, Number(version || 0) || 0)));
        } catch {
            // Ignore storage write errors
        }
    }, [companionDraftSeenKey]);
    const clearCompanionVoiceDraft = useCallback(async () => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return;

        try {
            const idToken = await getDesktopActionIdToken(auth.currentUser, { timeoutMs: 3000 });
            if (!idToken) return;
            await fetch(buildScopedUrl('/api/owner/manual-order/companion-draft'), {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
        } catch {
            // Best-effort cleanup only.
        }
    }, [buildScopedUrl, callSyncTarget?.businessId, callSyncTarget?.collectionName, getDesktopActionIdToken]);
    const shouldApplyCompanionVoiceDraft = useCallback((draft = {}) => {
        if (!draft?.version || !isCallSyncVoiceDraftFresh(draft?.updatedAt)) return false;

        const version = Math.max(0, Number(draft?.version || 0) || 0);
        const seenVersion = Math.max(
            lastAppliedCompanionDraftVersionRef.current,
            readSeenCompanionDraftVersion()
        );
        if (version > seenVersion) return true;

        const draftHasContent = (
            (Array.isArray(draft?.items) && draft.items.length > 0) ||
            (Array.isArray(draft?.pendingItems) && draft.pendingItems.length > 0) ||
            Boolean(String(draft?.lastTranscript || draft?.lastAction || draft?.note || '').trim())
        );
        const currentCartIsEmpty = cartRef.current.length === 0;

        return Boolean(
            version > 0 &&
            version <= seenVersion &&
            lastAppliedCompanionDraftVersionRef.current === 0 &&
            currentCartIsEmpty &&
            draftHasContent
        );
    }, [readSeenCompanionDraftVersion]);
    const fetchCompanionVoiceDraftSnapshot = useCallback(async () => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return null;

        try {
            const idToken = await getDesktopActionIdToken(auth.currentUser, { timeoutMs: 3000 });
            if (!idToken) return null;

            const res = await fetch(buildScopedUrl('/api/owner/manual-order/companion-draft'), {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.error('[ManualOrder] Companion draft fetch failed:', payload?.message || res.statusText);
                return null;
            }
            return payload?.draft || null;
        } catch (error) {
            console.error('[ManualOrder] Companion draft bootstrap failed:', error);
            return null;
        }
    }, [buildScopedUrl, callSyncTarget?.businessId, callSyncTarget?.collectionName, getDesktopActionIdToken]);

    const readCustomerSuggestionCache = useCallback(() => {
        if (!customerSuggestionCacheKey) return null;
        try {
            const raw = localStorage.getItem(customerSuggestionCacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.data ? parsed : null;
        } catch {
            return null;
        }
    }, [customerSuggestionCacheKey]);

    const writeCustomerSuggestionCache = useCallback((data = {}) => {
        if (!customerSuggestionCacheKey) return;
        try {
            localStorage.setItem(customerSuggestionCacheKey, JSON.stringify({
                ts: Date.now(),
                data,
            }));
        } catch {
            // Ignore storage errors
        }
    }, [customerSuggestionCacheKey]);

    const activeAttachedCallForBill = attachedCallContext?.billDraftId === billDraftId ? attachedCallContext : null;
    const isPendingCallSuggestionFresh = pendingCallSuggestion
        ? isCallSyncEventFresh(pendingCallSuggestion.timestampMs, CALL_SUGGESTION_TTL_MS)
        : false;

    const resolveCallSyncIdleState = useCallback(() => {
        if (activeAttachedCallForBill?.phone) return 'attached';
        if (pendingCallSuggestion && isCallSyncEventFresh(pendingCallSuggestion.timestampMs, CALL_SUGGESTION_TTL_MS)) {
            return 'incoming';
        }
        return 'listening';
    }, [activeAttachedCallForBill?.phone, pendingCallSuggestion]);

    const dismissCallSuggestion = useCallback((suggestion, options = {}) => {
        const callKey = typeof suggestion === 'string' ? suggestion : suggestion?.callKey;
        if (callKey && options?.suppressFuturePrompts !== false) {
            dismissedCallSuggestionKeysRef.current.add(callKey);
            dismissCallSyncEventForSession(callKey);
        }
        setPendingCallSuggestion((prev) => (prev?.callKey === callKey ? null : prev));
        setCallSyncStatus(activeAttachedCallForBill?.phone ? 'attached' : 'listening');
    }, [activeAttachedCallForBill?.phone]);

    const attachCallSuggestionToBill = useCallback((suggestion) => {
        const normalizedPhone = normalizeIndianPhoneLoose(suggestion?.phone);
        if (normalizedPhone.length !== 10) return;

        setOrderType('delivery');
        setActiveTable(null);
        setCustomerDetails((prev) => ({ ...prev, phone: normalizedPhone }));
        setAttachedCallContext({
            phone: normalizedPhone,
            callKey: suggestion.callKey,
            timestampMs: suggestion.timestampMs,
            billDraftId,
            attachedAt: Date.now(),
        });
        setPendingCallSuggestion(null);
        setPhoneError(false);
        setCallSyncStatus('attached');
        if (suggestion?.callKey) {
            dismissedCallSuggestionKeysRef.current.add(suggestion.callKey);
            dismissCallSyncEventForSession(suggestion.callKey);
        }
    }, [billDraftId]);

    const clearAttachedCallPhone = useCallback(() => {
        setAttachedCallContext(null);
        setCustomerDetails((prev) => ({ ...prev, phone: '' }));
        setSelectedCustomerSuggestion(null);
        setPhoneError(false);
        setCallSyncStatus(isPendingCallSuggestionFresh ? 'incoming' : 'listening');
    }, [isPendingCallSuggestionFresh]);

    const normalizedPhoneQuery = useMemo(
        () => normalizeSuggestionPhone(customerDetails.phone),
        [customerDetails.phone]
    );

    const phoneSuggestions = useMemo(() => {
        if (normalizedPhoneQuery.length < 4) return [];
        return (customerSuggestionDataset.customers || [])
            .map((customer) => ({ customer, score: scorePhoneSuggestion(customer, normalizedPhoneQuery) }))
            .filter((entry) => entry.score >= 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((entry) => entry.customer);
    }, [customerSuggestionDataset.customers, normalizedPhoneQuery]);

    const selectedCustomerAddresses = useMemo(
        () => (selectedCustomerSuggestion?.addresses || []).map((entry) => entry.full).filter(Boolean),
        [selectedCustomerSuggestion]
    );

    const addressSuggestions = useMemo(() => {
        const query = customerDetails.address || '';
        const addressMap = new Map();

        selectedCustomerAddresses.forEach((address, index) => {
            const score = scoreAddressMatch(address, query);
            if (score > 0) {
                addressMap.set(address.toLowerCase(), {
                    full: address,
                    score: score + 300 - index,
                    source: 'customer',
                });
            }
        });

        (customerSuggestionDataset.addresses || []).forEach((entry, index) => {
            const address = typeof entry === 'string' ? entry : entry?.full;
            const score = scoreAddressMatch(address, query);
            if (score <= 0) return;
            const key = String(address || '').trim().toLowerCase();
            const existing = addressMap.get(key);
            const nextScore = score + Math.min(Number(entry?.useCount || 0), 25) + Math.max(0, 60 - index);
            if (!existing || nextScore > existing.score) {
                addressMap.set(key, {
                    full: address,
                    score: nextScore,
                    source: existing?.source || 'global',
                });
            }
        });

        return Array.from(addressMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
    }, [customerDetails.address, customerSuggestionDataset.addresses, selectedCustomerAddresses]);

    const applyCustomerSuggestion = useCallback((customer, options = {}) => {
        if (!customer) return;
        const phone = normalizeSuggestionPhone(customer.phone);
        const topAddress = customer?.addresses?.[0]?.full || '';

        setSelectedCustomerSuggestion(customer);
        setCustomerDetails((prev) => ({
            ...prev,
            phone: phone || prev.phone,
            name: customer.name || prev.name,
            address: options.preserveAddress ? prev.address : (topAddress || prev.address),
        }));
        setPhoneError(false);
        setIsPhoneSuggestionOpen(false);
        setActivePhoneSuggestionIndex(-1);
        if (orderType === 'delivery' && customer?.addresses?.length) {
            setIsAddressSuggestionOpen(true);
        }
    }, [orderType]);

    const applyAddressSuggestion = useCallback((address) => {
        const nextAddress = normalizeAddressText(address);
        if (!nextAddress) return;
        setCustomerDetails((prev) => ({ ...prev, address: nextAddress }));
        setIsAddressSuggestionOpen(false);
        setActiveAddressSuggestionIndex(-1);
    }, []);

    const handlePhoneSuggestionKeyDown = useCallback((event) => {
        if (!phoneSuggestions.length) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsPhoneSuggestionOpen(true);
            setActivePhoneSuggestionIndex((prev) => {
                const nextIndex = prev < 0 ? 0 : Math.min(prev + 1, phoneSuggestions.length - 1);
                return nextIndex;
            });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsPhoneSuggestionOpen(true);
            setActivePhoneSuggestionIndex((prev) => {
                if (prev <= 0) return 0;
                return prev - 1;
            });
            return;
        }

        if (event.key === 'Enter' && isPhoneSuggestionOpen) {
            const targetIndex = activePhoneSuggestionIndex >= 0 ? activePhoneSuggestionIndex : 0;
            const targetSuggestion = phoneSuggestions[targetIndex];
            if (!targetSuggestion) return;
            event.preventDefault();
            applyCustomerSuggestion(targetSuggestion);
            return;
        }

        if (event.key === 'Escape' && isPhoneSuggestionOpen) {
            event.preventDefault();
            setIsPhoneSuggestionOpen(false);
            setActivePhoneSuggestionIndex(-1);
        }
    }, [activePhoneSuggestionIndex, applyCustomerSuggestion, isPhoneSuggestionOpen, phoneSuggestions]);

    const handleAddressSuggestionKeyDown = useCallback((event) => {
        if (!addressSuggestions.length) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsAddressSuggestionOpen(true);
            setActiveAddressSuggestionIndex((prev) => {
                const nextIndex = prev < 0 ? 0 : Math.min(prev + 1, addressSuggestions.length - 1);
                return nextIndex;
            });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsAddressSuggestionOpen(true);
            setActiveAddressSuggestionIndex((prev) => {
                if (prev <= 0) return 0;
                return prev - 1;
            });
            return;
        }

        if (event.key === 'Enter' && isAddressSuggestionOpen) {
            const targetIndex = activeAddressSuggestionIndex >= 0 ? activeAddressSuggestionIndex : 0;
            const targetSuggestion = addressSuggestions[targetIndex];
            if (!targetSuggestion?.full) return;
            event.preventDefault();
            applyAddressSuggestion(targetSuggestion.full);
            return;
        }

        if (event.key === 'Escape' && isAddressSuggestionOpen) {
            event.preventDefault();
            setIsAddressSuggestionOpen(false);
            setActiveAddressSuggestionIndex(-1);
        }
    }, [activeAddressSuggestionIndex, addressSuggestions, applyAddressSuggestion, isAddressSuggestionOpen]);

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
        if (!tableToPrint) return undefined;
        if (!autoPrintBillsEnabled) {
            setTableToPrint(null);
            return undefined;
        }

        let cancelled = false;
        const runPrint = async () => {
            try {
                if (desktopRuntime && tablePrintRef.current) {
                    await silentPrintElement(tablePrintRef.current, {
                        documentTitle: `Table-Bill-${Date.now()}`,
                    });
                } else if (handleTablePrint) {
                    handleTablePrint();
                }
            } catch (error) {
                console.error('[Manual Order] Auto table print failed:', error);
                if (!cancelled && handleTablePrint) {
                    handleTablePrint();
                }
            } finally {
                if (!cancelled) {
                    setTimeout(() => setTableToPrint(null), 300);
                }
            }
        };

        runPrint();
        return () => {
            cancelled = true;
        };
    }, [autoPrintBillsEnabled, desktopRuntime, tableToPrint, handleTablePrint]);

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
                    const idToken = await getDesktopActionIdToken(user);
                    const inventoryRes = await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/inventory?limit=500'), {
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
    }, [buildScopedUrl, fetchWithDesktopMutationTimeout, getDesktopActionIdToken, readCachedPayload]);

    useEffect(() => {
        if (!desktopRuntime) return;
        let cancelled = false;

        const hydrateDesktopOfflineData = async () => {
            try {
                const desktopSnapshot = await getOfflineNamespaces([
                    { key: 'manualOrderCache', namespace: 'manual_order_cache', scope: cacheKey, fallback: null },
                    { key: 'manualTables', namespace: 'manual_tables', scope: manualTablesCacheKey, fallback: [] },
                ]);
                const desktopCache = desktopSnapshot?.manualOrderCache;
                if (!cancelled && !readCachedPayload() && desktopCache?.data) {
                    if (desktopCache.data.menu && typeof desktopCache.data.menu === 'object') setMenu(desktopCache.data.menu);
                    if (Array.isArray(desktopCache.data.openItems)) setOpenItems(dedupeOpenItems(desktopCache.data.openItems));
                    if (desktopCache.data.restaurant) setRestaurant(desktopCache.data.restaurant);
                    if (desktopCache.data.businessType) {
                        setBusinessType(desktopCache.data.businessType);
                        setIsBusinessTypeResolved(true);
                    }
                    setCacheStatus('desktop-hit');
                    setLoading(false);
                }

                const desktopTables = desktopSnapshot?.manualTables;
                if (!cancelled && readCachedManualTables().length === 0 && Array.isArray(desktopTables) && desktopTables.length > 0) {
                    const sortedTables = writeCachedManualTables(desktopTables);
                    if (orderType === 'dine-in') {
                        setManualTables(sortedTables);
                    }
                }
            } catch (error) {
                console.warn('[Manual Order] Failed to hydrate desktop offline data:', error);
            }
        };

        hydrateDesktopOfflineData();
        return () => {
            cancelled = true;
        };
    }, [cacheKey, desktopRuntime, manualTablesCacheKey, orderType, readCachedManualTables, readCachedPayload, writeCachedManualTables]);

    useEffect(() => {
        let isMounted = true;

        const fetchMenuAndSettings = async () => {
            // Only show loading spinner when there's no local cache yet
            // This prevents the loading flicker on every re-visit
            const cached = await resolveCachedPayload();
            const hasCachedMenu = !!cached?.data?.menu;
            if (!hasCachedMenu) setLoading(true);
            try {
                if (isDesktopOfflineMode(desktopRuntime) && hasCachedMenu) {
                    setMenu(cached.data.menu || {});
                    setOpenItems(Array.isArray(cached.data.openItems) ? dedupeOpenItems(cached.data.openItems) : []);
                    if (cached.data.restaurant) setRestaurant(cached.data.restaurant);
                    if (cached.data.businessType) {
                        setBusinessType(cached.data.businessType);
                        setIsBusinessTypeResolved(true);
                    }
                    setCacheStatus('offline-fallback');
                    setLoading(false);
                    return;
                }

                const user = auth.currentUser;
                if (!user) throw new Error("Authentication required.");
                const idToken = await getDesktopActionIdToken(user);

                const headers = { 'Authorization': `Bearer ${idToken}` };
                const menuUrl = buildScopedUrl('/api/owner/menu?compact=1&includeOpenItems=1');
                const inventoryUrl = buildScopedUrl('/api/owner/inventory?limit=500');
                const settingsUrl = buildScopedUrl('/api/owner/settings');
                const versionUrl = buildScopedUrl('/api/owner/menu?versionOnly=1');

                let shouldFetchFullMenu = true;
                try {
                    const versionRes = await fetchWithDesktopMutationTimeout(versionUrl, { headers });
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
                            const inventoryRes = await fetchWithDesktopMutationTimeout(inventoryUrl, { headers });
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

                    const settingsPromise = fetchWithDesktopMutationTimeout(settingsUrl, { headers });
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
                                autoPrintBillsEnabled: settingsData.autoPrintBillsEnabled === true,
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

                const menuPromise = fetchWithDesktopMutationTimeout(menuUrl, { headers });
                const settingsPromise = fetchWithDesktopMutationTimeout(settingsUrl, { headers });
                const inventoryPromise = fetchWithDesktopMutationTimeout(inventoryUrl, { headers });
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
                        autoPrintBillsEnabled: settingsData.autoPrintBillsEnabled === true,
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
                    const cached = await resolveCachedPayload();
                    const hasCachedMenu = Boolean(cached?.data?.menu && typeof cached.data.menu === 'object' && Object.keys(cached.data.menu).length > 0);
                    if (hasCachedMenu && canUseDesktopOfflineFallback(error)) {
                        setCacheStatus('offline-fallback');
                        setMenu(cached.data.menu || {});
                        setOpenItems(Array.isArray(cached.data.openItems) ? dedupeOpenItems(cached.data.openItems) : []);
                        if (cached.data.restaurant) setRestaurant(cached.data.restaurant);
                        if (cached.data.businessType) {
                            setBusinessType(cached.data.businessType);
                            setIsBusinessTypeResolved(true);
                        }
                        toast({
                            title: 'Offline Cache Active',
                            description: 'Live menu could not be refreshed, so cached desktop menu is being used.',
                            variant: 'warning',
                        });
                    } else {
                        setCacheStatus('error');
                        toast({ title: 'Error', description: `Could not load menu: ${error.message}`, variant: 'destructive' });
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
    }, [accessQuery, buildScopedUrl, cacheKey, resolveCachedPayload, writeCachedPayload, toast, desktopRuntime, canUseDesktopOfflineFallback, readCachedPayload, fetchWithDesktopMutationTimeout, getDesktopActionIdToken]);

    useEffect(() => {
        if (!customerSuggestionCacheKey) {
            setCustomerSuggestionDataset({ generatedAt: 0, customers: [], addresses: [] });
            setCustomerSuggestionStatus('idle');
            return undefined;
        }

        let isMounted = true;
        const cached = readCustomerSuggestionCache();
        if (cached?.data) {
            setCustomerSuggestionDataset(cached.data);
            setCustomerSuggestionStatus('cached');
        }

        const shouldRefresh = !cached || (Date.now() - Number(cached.ts || 0)) > CUSTOMER_SUGGESTION_CACHE_TTL_MS;
        if (!shouldRefresh && cached?.data) {
            return undefined;
        }

        const fetchSuggestions = async () => {
            try {
                const currentUser = auth.currentUser;
                if (!currentUser) return;
                setCustomerSuggestionStatus(cached?.data ? 'refreshing' : 'loading');
                const res = await fetch(buildScopedUrl('/api/owner/manual-order/customer-suggestions?limit=250'), {
                    headers: {
                        Authorization: `Bearer ${await currentUser.getIdToken()}`,
                    },
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const payload = await res.json();
                if (!isMounted) return;
                const nextDataset = {
                    generatedAt: Number(payload?.generatedAt || Date.now()),
                    customers: Array.isArray(payload?.customers) ? payload.customers : [],
                    addresses: Array.isArray(payload?.addresses) ? payload.addresses : [],
                };
                setCustomerSuggestionDataset(nextDataset);
                setCustomerSuggestionStatus('ready');
                writeCustomerSuggestionCache(nextDataset);
            } catch (error) {
                if (!isMounted) return;
                console.error('[ManualOrder] Failed to load customer suggestions:', error);
                setCustomerSuggestionStatus(cached?.data ? 'stale' : 'error');
            }
        };

        fetchSuggestions();
        return () => {
            isMounted = false;
        };
    }, [buildScopedUrl, customerSuggestionCacheKey, readCustomerSuggestionCache, writeCustomerSuggestionCache]);

    useEffect(() => {
        if (normalizedPhoneQuery.length !== 10) return;
        const exactMatch = (customerSuggestionDataset.customers || []).find(
            (customer) => normalizeSuggestionPhone(customer.phone) === normalizedPhoneQuery
        );
        if (!exactMatch) return;
        if (selectedCustomerSuggestion?.phone === exactMatch.phone) return;

        setSelectedCustomerSuggestion(exactMatch);
        setCustomerDetails((prev) => ({
            ...prev,
            name: prev.name || exactMatch.name || '',
            address: prev.address || exactMatch?.addresses?.[0]?.full || '',
        }));
    }, [customerSuggestionDataset.customers, normalizedPhoneQuery, selectedCustomerSuggestion?.phone]);

    useEffect(() => {
        if (!isPhoneSuggestionOpen || !phoneSuggestions.length) {
            setActivePhoneSuggestionIndex(-1);
            return;
        }
        setActivePhoneSuggestionIndex((prev) => {
            if (prev < 0) return 0;
            return Math.min(prev, phoneSuggestions.length - 1);
        });
    }, [isPhoneSuggestionOpen, phoneSuggestions]);

    useEffect(() => {
        if (!isAddressSuggestionOpen || !addressSuggestions.length) {
            setActiveAddressSuggestionIndex(-1);
            return;
        }
        setActiveAddressSuggestionIndex((prev) => {
            if (prev < 0) return 0;
            return Math.min(prev, addressSuggestions.length - 1);
        });
    }, [addressSuggestions, isAddressSuggestionOpen]);

    useEffect(() => {
        const handleClickOutsideSuggestions = (event) => {
            const target = event.target;
            if (
                phoneSuggestionBoxRef.current &&
                !phoneSuggestionBoxRef.current.contains(target)
            ) {
                setIsPhoneSuggestionOpen(false);
                setActivePhoneSuggestionIndex(-1);
            }
            if (
                addressSuggestionBoxRef.current &&
                !addressSuggestionBoxRef.current.contains(target)
            ) {
                setIsAddressSuggestionOpen(false);
                setActiveAddressSuggestionIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleClickOutsideSuggestions);
        return () => document.removeEventListener('mousedown', handleClickOutsideSuggestions);
    }, []);

    useEffect(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        const listenerUid = String(user?.uid || '').trim();

        if (!listenerUid || !businessId || !collectionName) {
            setCallSyncStatus('inactive');
            return undefined;
        }

        setCallSyncStatus('listening');
        const callRef = ref(rtdb, buildActiveCallSyncUserPath(listenerUid));
        const unsubscribe = onValue(
            callRef,
            (snapshot) => {
                const activeCall = snapshot.exists() ? snapshot.val() : null;
                if (!activeCall) {
                    setCallSyncStatus(resolveCallSyncIdleState());
                    return;
                }

                if (
                    String(activeCall?.businessId || '').trim() !== businessId ||
                    String(activeCall?.collectionName || '').trim() !== collectionName
                ) {
                    setCallSyncStatus(resolveCallSyncIdleState());
                    return;
                }

                const phone = normalizeIndianPhoneLoose(activeCall.phone);
                const state = String(activeCall.state || '').trim().toLowerCase();
                const timestampMs = Number(activeCall.timestampMs || activeCall.updatedAt || 0);
                const isIncoming = isCallSyncLiveSuggestionState(state);
                const callKey = buildCallSyncEventKey(phone, timestampMs);

                if (!isIncoming || phone.length !== 10 || !isCallSyncEventFresh(timestampMs)) {
                    setCallSyncStatus(resolveCallSyncIdleState());
                    return;
                }

                if (!callKey || dismissedCallSuggestionKeysRef.current.has(callKey) || isDismissedCallSyncEvent(callKey) || activeAttachedCallForBill?.callKey === callKey) {
                    setCallSyncStatus(resolveCallSyncIdleState());
                    return;
                }

                const nextSuggestion = {
                    phone,
                    state,
                    timestampMs,
                    callKey,
                };

                setPendingCallSuggestion((prev) => (prev?.callKey === callKey ? prev : nextSuggestion));
                setCallSyncStatus('incoming');
            },
            (error) => {
                console.error('[ManualOrder] Call sync realtime listener failed:', error);
                setCallSyncStatus('error');
            }
        );

        return () => {
            unsubscribe();
        };
    }, [activeAttachedCallForBill?.callKey, activeAttachedCallForBill?.phone, callSyncTarget?.businessId, callSyncTarget?.collectionName, resolveCallSyncIdleState, user?.uid]);

    useEffect(() => {
        if (!pendingCallSuggestion?.timestampMs) return undefined;

        const remainingMs = CALL_SUGGESTION_TTL_MS - (Date.now() - pendingCallSuggestion.timestampMs);
        if (remainingMs <= 0) {
            setPendingCallSuggestion(null);
            setCallSyncStatus(resolveCallSyncIdleState());
            return undefined;
        }

        const timer = window.setTimeout(() => {
            setPendingCallSuggestion((prev) => (
                prev?.callKey === pendingCallSuggestion.callKey ? null : prev
            ));
            setCallSyncStatus(resolveCallSyncIdleState());
        }, remainingMs + 250);

        return () => window.clearTimeout(timer);
    }, [pendingCallSuggestion, resolveCallSyncIdleState]);

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
            const offlineTables = await resolveCachedManualTables();
            if (isDesktopOfflineMode(desktopRuntime)) {
                if (offlineTables.length > 0) {
                    const sortedOfflineTables = sortManualTablesByName(offlineTables);
                    setManualTables(sortedOfflineTables);
                    return sortedOfflineTables;
                }
                return [];
            }
            const user = auth.currentUser;
            if (!user) {
                if (offlineTables.length > 0) {
                    const sortedOfflineTables = sortManualTablesByName(offlineTables);
                    setManualTables(sortedOfflineTables);
                    return sortedOfflineTables;
                }
                return [];
            }
            const idToken = await getDesktopActionIdToken(user);
            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/manual-tables'), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                const sortedTables = sortManualTablesByName(data.tables || []);
                setManualTables(sortedTables);
                writeCachedManualTables(sortedTables);
                return sortedTables;
            }
        } catch (error) {
            console.error('Error fetching manual tables:', error);
            const offlineTables = await resolveCachedManualTables();
            if (offlineTables.length > 0) {
                const sortedOfflineTables = sortManualTablesByName(offlineTables);
                setManualTables(sortedOfflineTables);
                toast({
                    title: 'Offline Tables Loaded',
                    description: 'Using locally cached dine-in tables because the network is unavailable.',
                    variant: 'warning',
                });
                return sortedOfflineTables;
            }
        } finally {
            setIsLoadingTables(false);
        }
        return [];
    }, [buildScopedUrl, desktopRuntime, fetchWithDesktopMutationTimeout, getDesktopActionIdToken, resolveCachedManualTables, toast, writeCachedManualTables]);

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

    const orderedVisibleMenuEntries = useMemo(() => {
        if (categoryOrder.length === 0) return visibleMenuEntries;
        return [...visibleMenuEntries].sort((a, b) => {
            const idxA = categoryOrder.indexOf(a[0]);
            const idxB = categoryOrder.indexOf(b[0]);
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
    }, [visibleMenuEntries, categoryOrder]);

    const voiceMenuIndex = useMemo(
        () => buildVoiceMenuIndex(menu, openItems, businessType),
        [menu, openItems, businessType]
    );
    const voiceSttKeyterms = useMemo(
        () => buildVoiceSttKeyterms(voiceMenuIndex),
        [voiceMenuIndex]
    );

    // Calculate a compact default width based on the longest category name.
    const defaultSidebarWidth = useMemo(() => {
        if (!visibleMenuEntries || visibleMenuEntries.length === 0) return 132;
        let maxLen = 0;
        for (const [categoryId] of visibleMenuEntries) {
            const label = formatCategoryLabel(categoryId);
            if (label.length > maxLen) {
                maxLen = label.length;
            }
        }
        // Keep it slightly tighter by default while still leaving room for wrapped labels.
        return Math.max(118, Math.min(maxLen * 7.75 + 42, 340));
    }, [visibleMenuEntries]);

    const sidebarWidth = manualSidebarWidth !== null ? manualSidebarWidth : defaultSidebarWidth;

    // Handle Scroll Spy
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            // Use the rendered category order so the active highlight matches the UI.
            const categories = orderedVisibleMenuEntries.map(([catId]) => catId);
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
        const availableCategoryIds = orderedVisibleMenuEntries.map(([categoryId]) => categoryId);
        if (availableCategoryIds.length > 0) {
            setActiveCategory((prev) => (availableCategoryIds.includes(prev) ? prev : availableCategoryIds[0]));
        }
        return () => container.removeEventListener('scroll', handleScroll);
    }, [orderedVisibleMenuEntries]);

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
            const idToken = await getDesktopActionIdToken(user);
            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/manual-tables'), {
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
            if (canUseDesktopOfflineFallback(error)) {
                const nextTables = sortManualTablesByName(readCachedManualTables().map((table) => (
                    table.id === tableToEdit.id
                        ? { ...table, id: newTableName.trim(), name: newTableName.trim(), updatedAt: new Date().toISOString() }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_update', { id: tableToEdit.id, name: newTableName.trim() });
                toast({ title: 'Offline Saved', description: 'Table updated locally and queued for sync.', variant: 'warning' });
                setIsEditTableModalOpen(false);
                setTableToEdit(null);
                setNewTableName('');
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
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
            const idToken = await getDesktopActionIdToken(user);
            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl(`/api/owner/manual-tables?tableId=${tableToDelete.id}`), {
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
            if (canUseDesktopOfflineFallback(error)) {
                const nextTables = sortManualTablesByName(readCachedManualTables().filter((table) => table.id !== tableToDelete.id));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_delete', { id: tableToDelete.id });
                if (activeTable?.id === tableToDelete.id) setActiveTable(null);
                setTableToDelete(null);
                toast({ title: 'Offline Saved', description: 'Table deleted locally and queued for sync.', variant: 'warning' });
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
        } finally {
            setTableActionLoading(false);
        }
    };

    const activateResizeMode = useCallback(() => {
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    const clearResizeMode = useCallback(() => {
        if (isResizing.current || isResizingBill.current) return;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    // --- Sidebar Resizing Logic ---
    const startResizing = useCallback((e) => {
        e.preventDefault();
        isResizing.current = true;
        activateResizeMode();
    }, [activateResizeMode]);

    const stopResizing = useCallback(() => {
        if (!isResizing.current) return;
        isResizing.current = false;
        clearResizeMode();
    }, [clearResizeMode]);

    const handleSidebarResizeMove = useCallback((clientX) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const newWidth = clientX - sidebarRef.current.getBoundingClientRect().left;
        const minWidth = 118;
        const maxWidth = Math.min(800, window.innerWidth * 0.5);
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            setManualSidebarWidth(newWidth);
        }
    }, []);

    // --- Bill Sidebar Resizing Logic ---
    const startResizingBill = useCallback((e) => {
        e.preventDefault();
        isResizingBill.current = true;
        activateResizeMode();
    }, [activateResizeMode]);

    const stopResizingBill = useCallback(() => {
        if (!isResizingBill.current) return;
        isResizingBill.current = false;
        clearResizeMode();
    }, [clearResizeMode]);

    const handleBillResizeMove = useCallback((clientX) => {
        if (!isResizingBill.current || !billContainerRef.current) return;
        const rect = billContainerRef.current.getBoundingClientRect();
        const newWidth = rect.right - clientX;
        const minWidth = 280;
        const maxWidth = Math.min(800, window.innerWidth * 0.5);
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            setBillSidebarWidth(newWidth);
        }
    }, []);

    useEffect(() => {
        const onPointerMove = (e) => {
            if (!(isResizing.current || isResizingBill.current)) return;
            if (isResizing.current) handleSidebarResizeMove(e.clientX);
            if (isResizingBill.current) handleBillResizeMove(e.clientX);
        };
        const onPointerUp = () => {
            if (isResizing.current) stopResizing();
            if (isResizingBill.current) stopResizingBill();
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };
    }, [handleSidebarResizeMove, stopResizing, handleBillResizeMove, stopResizingBill]);
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

    const resetCurrentBill = useCallback(() => {
        cartRef.current = [];
        setCart([]);
        setQtyInputMap({});
        setItemHistory([]);
        setBillDraftId(createBillDraftId());
        setLastSavedOrderData(null);
        setCurrentBillCustomerOrderId(generateCustomerOrderId());
        setCustomerDetails({ name: '', phone: '', address: '', notes: '' });
        setDeliveryChargeInput('0');
        setAdditionalChargeNameInput('');
        setAdditionalChargeInput('0');
        setSelectedCustomerSuggestion(null);
        setIsPhoneSuggestionOpen(false);
        setIsAddressSuggestionOpen(false);
        setActivePhoneSuggestionIndex(-1);
        setActiveAddressSuggestionIndex(-1);
        setAttachedCallContext(null);
        setPendingCallSuggestion(null);
        setPhoneError(false);
        setDiscountInput('0');
        setPaymentMode('cash');
        setCallSyncStatus('listening');
        setVoicePendingItems([]);
        voiceLastCartMutationRef.current = { timestamp: 0, source: '', mode: '', tableId: '' };
        lastAppliedCompanionDraftVersionRef.current = 0;
        writeSeenCompanionDraftVersion(0);
        void clearCompanionVoiceDraft();
    }, [clearCompanionVoiceDraft, writeSeenCompanionDraftVersion]);

    const handleClear = useCallback(() => {
        resetCurrentBill();
    }, [resetCurrentBill]);

    const updateVoiceDebugSnapshot = useCallback((patch = {}) => {
        setVoiceDebugSnapshot((prev) => ({
            ...prev,
            ...patch,
            updatedAt: Date.now(),
        }));
    }, []);

    const appendVoiceDebugEvent = useCallback((title, detail = '', level = 'info') => {
        const normalizedTitle = String(title || '').trim();
        const normalizedDetail = String(detail || '').trim();
        if (!normalizedTitle && !normalizedDetail) return;

        setVoiceDebugEvents((prev) => ([
            {
                id: `voice-debug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                title: normalizedTitle || 'Voice event',
                detail: normalizedDetail,
                level,
                createdAt: Date.now(),
            },
            ...prev,
        ].slice(0, 20)));
    }, []);

    const addVoiceLogEntry = useCallback((summary, transcript = '') => {
        const normalizedSummary = String(summary || '').trim();
        if (!normalizedSummary) return;
        setVoiceCommandLog((prev) => ([
            {
                id: `voice-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                summary: normalizedSummary,
                transcript: String(transcript || '').trim(),
            },
            ...prev,
        ].slice(0, 5)));
        setVoiceLastAction(normalizedSummary);
        if (transcript) {
            setVoiceLastTranscript(String(transcript).trim());
        }
        appendVoiceDebugEvent('Voice result', normalizedSummary, 'info');
    }, [appendVoiceDebugEvent]);

    const clearVoiceDebugData = useCallback(() => {
        setVoiceDebugEvents([]);
        setVoiceDebugSnapshot(INITIAL_VOICE_DEBUG_SNAPSHOT);
    }, []);

    const handleVoiceCaptureDebugEvent = useCallback((event = {}) => {
        const type = String(event?.type || '').trim();
        if (!type) return;

        if (type === 'speech-detected') {
            updateVoiceDebugSnapshot({
                phase: 'hearing',
                note: `Speech detected above threshold ${Number(event?.threshold || 0).toFixed(3)}.`,
                error: '',
            });
            appendVoiceDebugEvent(
                'Speech detected',
                `rms ${Number(event?.rms || 0).toFixed(3)} • threshold ${Number(event?.threshold || 0).toFixed(3)}`,
                'info'
            );
            return;
        }

        if (type === 'segment-queued') {
            updateVoiceDebugSnapshot({
                phase: 'segment-ready',
                source: 'recorded-audio',
                audioMime: String(event?.mimeType || '').trim(),
                audioSize: Number(event?.size || 0),
                note: 'Audio segment queued for transcription.',
                error: '',
            });
            appendVoiceDebugEvent(
                'Segment queued',
                `${String(event?.mimeType || 'audio/webm')} • ${Math.round(Number(event?.size || 0) / 1024)} KB`,
                'info'
            );
            return;
        }

        if (type === 'segment-dropped') {
            const reason = String(event?.reason || 'segment-dropped').trim();
            const reasonLabel = ({
                'no-speech-detected': 'Recorder ne speech threshold cross nahi ki.',
                'audio-too-small': 'Audio segment bahut chhota tha.',
                'empty-segment': 'Recorder ne empty segment return kiya.',
                'missing-audio': 'Recorder se audio blob hi nahi mila.',
            })[reason] || reason;

            updateVoiceDebugSnapshot({
                phase: 'segment-dropped',
                source: 'recorded-audio',
                audioMime: String(event?.mimeType || '').trim(),
                audioSize: Number(event?.size || 0),
                note: reasonLabel,
                error: '',
            });
            appendVoiceDebugEvent(
                'Segment dropped',
                `${reasonLabel}${Number(event?.size || 0) ? ` • ${Math.round(Number(event?.size || 0) / 1024)} KB` : ''}`,
                'warning'
            );
            return;
        }

        if (type === 'stream-opened' || type === 'stream-reused') {
            updateVoiceDebugSnapshot({
                phase: 'listening',
                source: 'recorded-audio',
                note: type === 'stream-reused'
                    ? 'Warm mic stream reused for faster capture.'
                    : 'Mic stream opened successfully.',
                error: '',
            });
            appendVoiceDebugEvent(
                type === 'stream-reused' ? 'Mic stream reused' : 'Mic stream opened',
                Number(event?.keepWarmMs || 0) > 0
                    ? `Warm reuse ${Math.round(Number(event.keepWarmMs) / 1000)} sec`
                    : 'Fresh stream',
                'info'
            );
            return;
        }

        if (type === 'capture-error' || type === 'segment-upload-error') {
            const message = String(event?.message || 'Voice capture failed.').trim();
            updateVoiceDebugSnapshot({
                phase: 'error',
                source: 'recorded-audio',
                error: message,
                note: message,
            });
            appendVoiceDebugEvent(
                type === 'capture-error' ? 'Capture error' : 'Upload error',
                message,
                'error'
            );
        }
    }, [appendVoiceDebugEvent, updateVoiceDebugSnapshot]);

    const resolveVoiceSaleOption = useCallback((entry, explicitPortionName = '', requestedPortion = '') => {
        const options = Array.isArray(entry?.saleOptions) ? entry.saleOptions : [];
        if (!options.length) return null;

        const findOption = (needle) => {
            const normalizedNeedle = normalizeVoiceText(needle);
            if (!normalizedNeedle) return null;
            return options.find((option) => {
                const optionName = normalizeVoiceText(option?.name);
                const optionLabel = normalizeVoiceText(option?.label);
                return (
                    optionName === normalizedNeedle ||
                    optionLabel === normalizedNeedle ||
                    optionName.includes(normalizedNeedle) ||
                    optionLabel.includes(normalizedNeedle)
                );
            }) || null;
        };

        const explicitMatch = findOption(explicitPortionName);
        if (explicitMatch) return explicitMatch;

        const requestedMatch = findOption(requestedPortion);
        if (requestedMatch) return requestedMatch;

        if (options.length === 1) return options[0];
        return options.find((option) => {
            const normalizedLabel = normalizeVoiceText(option?.label || option?.name);
            return normalizedLabel === 'regular' || normalizedLabel === 'full' || normalizedLabel === 'unit';
        }) || options[0];
    }, []);

    const buildResolvedVoiceSelection = useCallback((selection = {}) => {
        const entryId = String(selection?.entryId || selection?.itemId || '').trim();
        if (!entryId) return null;

        const entry = voiceMenuIndex.find((candidate) => candidate.entryId === entryId || candidate.itemId === entryId);
        if (!entry?.item) return null;

        const selectedOption = resolveVoiceSaleOption(entry, selection?.portionName, selection?.requestedPortion);
        if (!selectedOption) return null;

        return {
            lineId: selection?.lineId || null,
            entry,
            item: entry.item,
            quantity: Math.max(1, parseInt(selection?.quantity, 10) || 1),
            requestedPortion: selection?.requestedPortion || '',
            commandAction: selection?.commandAction || 'add',
            spokenText: selection?.spokenText || '',
            selectedOption,
        };
    }, [resolveVoiceSaleOption, voiceMenuIndex]);

    const buildVoiceSelectionLabel = useCallback((selection = {}) => {
        const itemName = String(selection?.item?.name || selection?.entry?.name || 'Item').trim() || 'Item';
        const explicitPortion = String(selection?.requestedPortion || '').trim();
        const selectedPortion = String(selection?.selectedOption?.label || selection?.selectedOption?.name || '').trim();
        const shouldShowSelectedPortion = Boolean(
            explicitPortion ||
            (
                (selection?.commandAction || 'add') === 'add' &&
                Array.isArray(selection?.item?.portions) &&
                selection.item.portions.length > 1
            )
        );
        const portionLabel = explicitPortion || (shouldShowSelectedPortion ? selectedPortion : '');
        return portionLabel ? `${itemName} (${portionLabel})` : itemName;
    }, []);

    const doesCartItemMatchVoiceSelection = useCallback((cartItem = {}, selection = {}, requireSpecificPortion = false) => {
        const targetItemId = String(selection?.item?.id || selection?.entry?.itemId || '').trim();
        if (!targetItemId || String(cartItem?.id || '').trim() !== targetItemId) {
            return false;
        }

        if (!requireSpecificPortion) return true;

        const cartPortion = normalizeVoiceText(cartItem?.portion?.label || cartItem?.portion?.name || 'regular');
        const targetPortion = normalizeVoiceText(
            selection?.selectedOption?.label ||
            selection?.selectedOption?.name ||
            selection?.requestedPortion ||
            ''
        );
        return Boolean(targetPortion) && cartPortion === targetPortion;
    }, []);

    const rebuildItemHistoryFromCart = useCallback((items = []) => (
        (Array.isArray(items) ? items : []).flatMap((item) => (
            Array.from({ length: Math.max(0, Number(item?.quantity || 0)) }, () => item.cartItemId)
        ))
    ), []);
    const applyCompanionVoiceDraftSnapshot = useCallback(async (draft = {}) => {
        const version = Math.max(0, Number(draft?.version || 0) || 0);
        if (version <= 0) return false;

        let resolvedActiveTable = null;
        const targetMode = String(draft?.orderType || 'delivery').trim() || 'delivery';
        const targetTableId = String(draft?.activeTable?.id || '').trim();
        if (targetMode === 'dine-in' && targetTableId) {
            resolvedActiveTable = manualTables.find((table) => table.id === targetTableId) || null;
            if (!resolvedActiveTable) {
                const fetchedTables = await fetchManualTables();
                resolvedActiveTable = (Array.isArray(fetchedTables) ? fetchedTables : []).find((table) => table.id === targetTableId) || null;
            }
            if (!resolvedActiveTable) {
                resolvedActiveTable = {
                    id: targetTableId,
                    name: String(draft?.activeTable?.name || targetTableId).trim() || targetTableId,
                    status: String(draft?.activeTable?.status || 'available').trim() || 'available',
                    currentOrder: null,
                };
            }
        }

        const nextCart = Array.isArray(draft?.items)
            ? draft.items.map((item) => ({
                ...item,
                quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
                price: Number(item?.price || item?.portion?.price || 0) || 0,
                totalPrice: Number(item?.totalPrice || 0) || 0,
                cartItemId: String(item?.cartItemId || `${item?.id || 'item'}-${item?.portion?.name || 'regular'}`).trim(),
            }))
            : [];

        cartRef.current = nextCart;
        setCart(nextCart);
        setQtyInputMap({});
        setItemHistory(rebuildItemHistoryFromCart(nextCart));
        setBillDraftId(createBillDraftId());
        setLastSavedOrderData(null);
        setCurrentBillCustomerOrderId(generateCustomerOrderId());
        setCustomerDetails({
            name: String(draft?.customerDetails?.name || '').trim(),
            phone: String(draft?.customerDetails?.phone || '').trim(),
            address: String(draft?.customerDetails?.address || '').trim(),
            notes: String(draft?.customerDetails?.notes || '').trim(),
        });
        setDeliveryChargeInput('0');
        setAdditionalChargeNameInput('');
        setAdditionalChargeInput('0');
        setDiscountInput('0');
        setPaymentMode('cash');
        setSelectedCustomerSuggestion(null);
        setIsPhoneSuggestionOpen(false);
        setIsAddressSuggestionOpen(false);
        setActivePhoneSuggestionIndex(-1);
        setActiveAddressSuggestionIndex(-1);
        setAttachedCallContext(null);
        setPendingCallSuggestion(null);
        setPhoneError(false);
        setSelectedOccupiedTable(null);
        setOrderType(targetMode);
        setActiveTable(targetMode === 'dine-in' ? resolvedActiveTable : null);
        setVoicePendingItems(Array.isArray(draft?.pendingItems) ? draft.pendingItems : []);
        setVoiceLastTranscript(String(draft?.lastTranscript || '').trim());
        setVoiceLastAction(String(draft?.lastAction || draft?.note || '').trim());
        updateVoiceDebugSnapshot({
            phase: draft?.pendingItems?.length ? 'needs-confirmation' : (nextCart.length > 0 ? 'items-added' : 'completed'),
            source: 'billing-companion',
            provider: 'android-companion',
            transcript: String(draft?.lastTranscript || '').trim(),
            resolvedCount: nextCart.length,
            pendingCount: Array.isArray(draft?.pendingItems) ? draft.pendingItems.length : 0,
            unresolvedCount: Math.max(0, Number(draft?.unresolvedCount || 0) || 0),
            matchedTableName: targetMode === 'dine-in' ? (resolvedActiveTable?.name || String(draft?.activeTable?.name || '').trim()) : '',
            desiredMode: targetMode,
            note: String(draft?.note || '').trim() || 'Voice draft synced from billing companion.',
            error: '',
        });

        voiceLastCartMutationRef.current = {
            timestamp: Date.now(),
            source: 'companion-sync',
            mode: targetMode,
            tableId: targetMode === 'dine-in' ? (resolvedActiveTable?.id || targetTableId) : '',
        };
        lastAppliedCompanionDraftVersionRef.current = version;
        writeSeenCompanionDraftVersion(version);
        addVoiceLogEntry(
            String(draft?.note || '').trim() || 'Voice draft synced from billing companion.',
            String(draft?.lastTranscript || 'Billing companion').trim()
        );
        toast({
            title: 'Billing Companion',
            description: draft?.pendingItems?.length
                ? 'Companion draft synced. Some items still need confirmation.'
                : 'Voice bill synced from companion app.',
            variant: draft?.pendingItems?.length ? 'warning' : 'success',
        });
        return true;
    }, [
        addVoiceLogEntry,
        fetchManualTables,
        manualTables,
        rebuildItemHistoryFromCart,
        toast,
        updateVoiceDebugSnapshot,
        writeSeenCompanionDraftVersion,
    ]);

    const appendResolvedVoiceItemsToCart = useCallback((resolvedSelections = []) => {
        if (!Array.isArray(resolvedSelections) || resolvedSelections.length === 0) {
            return { addedLabels: [], blockedLabels: [] };
        }

        const nextCart = [...cartRef.current];
        const nextHistory = [];
        const addedLabels = [];
        const blockedLabels = [];
        const touchedCartItemIds = new Set();

        resolvedSelections.forEach((selection) => {
            if (!selection?.item || !selection?.selectedOption) return;

            const sourceItem = selection.item;
            const selectedOption = selection.selectedOption;
            const quantityToAdd = Math.max(1, parseInt(selection.quantity, 10) || 1);
            const cartItemId = `${sourceItem.id}-${selectedOption.name}`;
            const existingIndex = nextCart.findIndex((cartItem) => cartItem.cartItemId === cartItemId);
            const existingItem = existingIndex >= 0 ? nextCart[existingIndex] : null;
            const nextQuantity = (existingItem?.quantity || 0) + quantityToAdd;

            if (!enforceCartStockLimit(sourceItem, nextQuantity)) {
                blockedLabels.push(sourceItem.name || 'Item');
                return;
            }

            if (existingItem) {
                nextCart[existingIndex] = {
                    ...existingItem,
                    quantity: nextQuantity,
                    totalPrice: existingItem.price * nextQuantity,
                };
            } else {
                const { portions, ...itemWithoutPortions } = sourceItem;
                const hasMultiplePortions = Array.isArray(portions) && portions.length > 1;
                const portionCount = Array.isArray(portions) ? portions.length : 0;
                const newCartItem = {
                    ...itemWithoutPortions,
                    quantity: quantityToAdd,
                    cartItemId,
                    price: selectedOption.price,
                    totalPrice: selectedOption.price * quantityToAdd,
                };

                if (portionCount > 0) {
                    newCartItem.portionCount = portionCount;
                }
                if (hasMultiplePortions) {
                    newCartItem.portion = selectedOption;
                }

                nextCart.push(newCartItem);
            }

            for (let i = 0; i < quantityToAdd; i += 1) {
                nextHistory.push(cartItemId);
            }
            touchedCartItemIds.add(cartItemId);

            const portionLabel = Array.isArray(sourceItem?.portions) && sourceItem.portions.length > 1
                ? ` (${selectedOption.label || selectedOption.name})`
                : '';
            addedLabels.push(`${quantityToAdd} x ${sourceItem.name}${portionLabel}`);
        });

        if (addedLabels.length > 0) {
            cartRef.current = nextCart;
            setCart(nextCart);
            setItemHistory((prev) => [...prev, ...nextHistory]);
            setQtyInputMap((prev) => {
                const nextMap = { ...prev };
                touchedCartItemIds.forEach((cartItemId) => {
                    delete nextMap[cartItemId];
                });
                return nextMap;
            });
            voiceLastCartMutationRef.current = {
                timestamp: Date.now(),
                source: 'voice',
                mode: orderType,
                tableId: activeTable?.id || '',
            };
        }

        return { addedLabels, blockedLabels };
    }, [activeTable?.id, enforceCartStockLimit, orderType]);

    const subtractResolvedVoiceItemsFromCart = useCallback((resolvedSelections = []) => {
        if (!Array.isArray(resolvedSelections) || resolvedSelections.length === 0) {
            return { removedLabels: [], missingLabels: [] };
        }

        const nextCart = [...cartRef.current];
        const removedLabels = [];
        const missingLabels = [];
        const touchedCartItemIds = new Set();

        resolvedSelections.forEach((selection) => {
            if (!selection?.item) return;

            let remainingToRemove = Math.max(1, parseInt(selection.quantity, 10) || 1);
            const requireSpecificPortion = Boolean(selection?.requestedPortion);
            let removedCount = 0;

            for (let index = nextCart.length - 1; index >= 0 && remainingToRemove > 0; index -= 1) {
                const cartItem = nextCart[index];
                if (!doesCartItemMatchVoiceSelection(cartItem, selection, requireSpecificPortion)) continue;

                const nextQuantity = Number(cartItem.quantity || 0) - remainingToRemove;
                touchedCartItemIds.add(cartItem.cartItemId);

                if (nextQuantity > 0) {
                    removedCount += remainingToRemove;
                    nextCart[index] = {
                        ...cartItem,
                        quantity: nextQuantity,
                        totalPrice: cartItem.price * nextQuantity,
                    };
                    remainingToRemove = 0;
                } else {
                    removedCount += Number(cartItem.quantity || 0);
                    remainingToRemove -= Number(cartItem.quantity || 0);
                    nextCart.splice(index, 1);
                }
            }

            if (removedCount > 0) {
                removedLabels.push(`${removedCount} x ${buildVoiceSelectionLabel(selection)}`);
            } else {
                missingLabels.push(buildVoiceSelectionLabel(selection));
            }
        });

        if (removedLabels.length > 0) {
            cartRef.current = nextCart;
            setCart(nextCart);
            setItemHistory(rebuildItemHistoryFromCart(nextCart));
            setQtyInputMap((prev) => {
                const nextMap = { ...prev };
                touchedCartItemIds.forEach((cartItemId) => {
                    delete nextMap[cartItemId];
                });
                return nextMap;
            });
            voiceLastCartMutationRef.current = {
                timestamp: Date.now(),
                source: 'voice',
                mode: orderType,
                tableId: activeTable?.id || '',
            };
        }

        return { removedLabels, missingLabels };
    }, [activeTable?.id, buildVoiceSelectionLabel, doesCartItemMatchVoiceSelection, orderType, rebuildItemHistoryFromCart]);

    const clearResolvedVoiceItemsFromCart = useCallback((resolvedSelections = []) => {
        if (!Array.isArray(resolvedSelections) || resolvedSelections.length === 0) {
            return { clearedLabels: [], missingLabels: [] };
        }

        const currentCart = [...cartRef.current];
        const removedCartItemIds = new Set();
        const clearedLabels = [];
        const missingLabels = [];

        resolvedSelections.forEach((selection) => {
            if (!selection?.item) return;
            const requireSpecificPortion = Boolean(selection?.requestedPortion);
            const matchingItems = currentCart.filter((cartItem) => (
                doesCartItemMatchVoiceSelection(cartItem, selection, requireSpecificPortion)
            ));

            if (matchingItems.length === 0) {
                missingLabels.push(buildVoiceSelectionLabel(selection));
                return;
            }

            matchingItems.forEach((cartItem) => {
                removedCartItemIds.add(cartItem.cartItemId);
            });
            clearedLabels.push(buildVoiceSelectionLabel(selection));
        });

        if (removedCartItemIds.size > 0) {
            const nextCart = currentCart.filter((cartItem) => !removedCartItemIds.has(cartItem.cartItemId));
            cartRef.current = nextCart;
            setCart(nextCart);
            setItemHistory(rebuildItemHistoryFromCart(nextCart));
            setQtyInputMap((prev) => {
                const nextMap = { ...prev };
                removedCartItemIds.forEach((cartItemId) => {
                    delete nextMap[cartItemId];
                });
                return nextMap;
            });
            voiceLastCartMutationRef.current = {
                timestamp: Date.now(),
                source: 'voice',
                mode: orderType,
                tableId: activeTable?.id || '',
            };
        }

        return { clearedLabels, missingLabels };
    }, [activeTable?.id, buildVoiceSelectionLabel, doesCartItemMatchVoiceSelection, orderType, rebuildItemHistoryFromCart]);

    const activateTableContextFromVoice = useCallback((table) => {
        if (!table?.id) {
            return { ok: false, message: 'Table not found.' };
        }

        if (table.status === 'occupied') {
            if (table?.currentOrder?.isFinalized) {
                setSelectedOccupiedTable(table);
                return { ok: false, message: `${table.name} is locked. Reopen it manually to edit.` };
            }

            const order = table.currentOrder || {};
            const nextItems = Array.isArray(order.items) ? order.items : [];
            cartRef.current = nextItems;
            setCart(nextItems);
            setItemHistory([]);
            setQtyInputMap({});
            setCustomerDetails({
                name: '',
                phone: '',
                address: '',
                notes: '',
                ...(order.customerDetails || {}),
            });
            setDeliveryChargeInput(String(order.deliveryCharge || 0));
            setAdditionalChargeInput(String(order.additionalCharge || 0));
            setAdditionalChargeNameInput(String(order.additionalChargeLabel || ''));
            setDiscountInput(String(order.discount || 0));
            setPaymentMode(order.paymentMode || 'cash');
        } else if (activeTable?.id !== table.id) {
            resetCurrentBill();
        }

        setOrderType('dine-in');
        setActiveTable(table);
        setSelectedOccupiedTable(null);
        return { ok: true, message: `${table.name} selected for billing.` };
    }, [activeTable?.id, resetCurrentBill]);

    const resolveAiVoiceCandidates = useCallback(async (parsedCommand, availableTables = []) => {
        const resolverPayload = serializeVoiceResolverPayload(parsedCommand);
        if (!resolverPayload?.unresolvedItems?.length) {
            return { resolvedSelections: [], unresolvedLineIds: new Set(), fallbackError: '' };
        }

        const unresolvedLookup = new Map(
            resolverPayload.unresolvedItems.map((item) => [item.lineId, item])
        );
        const unresolvedLineIds = new Set(unresolvedLookup.keys());

        setIsVoiceAiResolving(true);
        updateVoiceDebugSnapshot({
            phase: 'ai-resolving',
            note: `Trying OpenRouter AI resolver for ${unresolvedLineIds.size} unresolved items.`,
            error: '',
        });
        appendVoiceDebugEvent('OpenRouter AI started', `${unresolvedLineIds.size} unresolved items sent to AI resolver.`, 'info');
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                return { resolvedSelections: [], unresolvedLineIds, fallbackError: 'Authentication required for AI fallback.' };
            }

            const idToken = await currentUser.getIdToken();
            const res = await fetch(buildScopedUrl('/api/owner/manual-order/voice-parse'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    ...resolverPayload,
                    currentMode: orderType,
                    activeTableId: activeTable?.id || null,
                    tableOptions: (availableTables || []).map((table) => ({
                        id: table.id,
                        name: table.name,
                        status: table.status,
                        isFinalized: !!table?.currentOrder?.isFinalized,
                    })),
                }),
            });

            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                return {
                    resolvedSelections: [],
                    unresolvedLineIds,
                    fallbackError: payload?.message || 'AI fallback could not resolve the spoken items.',
                };
            }

            const resolvedSelections = Array.isArray(payload?.items)
                ? payload.items
                    .filter((item) => Number(item?.confidence || 0) >= 0.72)
                    .map((item) => {
                        const unresolved = unresolvedLookup.get(item.lineId);
                        return buildResolvedVoiceSelection({
                            lineId: item.lineId,
                            entryId: item.entryId,
                            portionName: item.portionName,
                            quantity: unresolved?.quantity || 1,
                            requestedPortion: unresolved?.requestedPortion || '',
                            commandAction: unresolved?.commandAction || parsedCommand?.cartAction || 'add',
                            spokenText: unresolved?.spokenText || '',
                        });
                    })
                    .filter(Boolean)
                : [];

            const stillUnresolved = new Set(unresolvedLineIds);
            resolvedSelections.forEach((item) => {
                if (item?.lineId) stillUnresolved.delete(item.lineId);
            });
            (Array.isArray(payload?.unresolvedLineIds) ? payload.unresolvedLineIds : []).forEach((lineId) => {
                if (lineId) stillUnresolved.add(lineId);
            });

            appendVoiceDebugEvent(
                'OpenRouter AI result',
                resolvedSelections.length > 0
                    ? `AI resolved ${resolvedSelections.length} item(s).`
                    : 'AI could not confidently resolve the pending items.',
                resolvedSelections.length > 0 ? 'info' : 'warning'
            );

            return {
                resolvedSelections,
                unresolvedLineIds: stillUnresolved,
                fallbackError: '',
            };
        } catch (error) {
            appendVoiceDebugEvent('OpenRouter AI failed', error?.message || 'AI fallback is unavailable right now.', 'warning');
            return {
                resolvedSelections: [],
                unresolvedLineIds,
                fallbackError: error?.message || 'AI fallback is unavailable right now.',
            };
        } finally {
            if (resolverPayload?.unresolvedItems?.length) {
                appendVoiceDebugEvent(
                    'OpenRouter AI finished',
                    'Resolver completed candidate ranking for pending items.',
                    'info'
                );
            }
            setIsVoiceAiResolving(false);
        }
    }, [activeTable?.id, appendVoiceDebugEvent, buildResolvedVoiceSelection, buildScopedUrl, orderType, updateVoiceDebugSnapshot]);

    const processVoiceCommandTranscript = useCallback(async (spokenTranscript) => {
        const transcript = String(spokenTranscript || '').trim();
        if (!transcript) return;

        setVoiceLastTranscript(transcript);
        setIsVoiceCommandProcessing(true);
        updateVoiceDebugSnapshot({
            phase: 'parsing',
            transcript,
            note: 'Parsing transcript against menu index.',
            error: '',
        });
        appendVoiceDebugEvent('Parsing transcript', transcript, 'info');

        try {
            let availableTables = manualTables;
            let parsedCommand = parseManualOrderVoiceCommand({
                transcript,
                menuIndex: voiceMenuIndex,
                manualTables: availableTables,
                currentMode: orderType,
            });

            if (parsedCommand.requestedTableReference && !parsedCommand.matchedTableId) {
                const fetchedTables = await fetchManualTables();
                if (Array.isArray(fetchedTables) && fetchedTables.length > 0) {
                    availableTables = fetchedTables;
                    parsedCommand = parseManualOrderVoiceCommand({
                        transcript,
                        menuIndex: voiceMenuIndex,
                        manualTables: fetchedTables,
                        currentMode: orderType,
                    });
                }
            }

            const resolvedCount = parsedCommand.items.filter((item) => item.status === 'resolved').length;
            const pendingCount = parsedCommand.items.filter((item) => item.status === 'pending').length;
            const unresolvedCount = parsedCommand.items.filter((item) => item.status === 'unresolved').length;
            updateVoiceDebugSnapshot({
                phase: 'parsed',
                transcript,
                resolvedCount,
                pendingCount,
                unresolvedCount,
                requestedTableReference: parsedCommand.requestedTableReference || '',
                matchedTableName: parsedCommand.matchedTableName || '',
                desiredMode: parsedCommand.desiredMode || orderType,
                note: `Parser found ${resolvedCount} resolved, ${pendingCount} pending, ${unresolvedCount} unmatched items.`,
            });
            appendVoiceDebugEvent(
                'Parser result',
                `resolved ${resolvedCount} • pending ${pendingCount} • unmatched ${unresolvedCount}${parsedCommand.matchedTableName ? ` • table ${parsedCommand.matchedTableName}` : ''}`,
                unresolvedCount > 0 && resolvedCount === 0 && pendingCount === 0 ? 'warning' : 'info'
            );

            const cartAction = String(parsedCommand?.cartAction || 'add').trim() || 'add';
            if (cartAction === 'clear-all') {
                const message = cartRef.current.length > 0 ? 'Current bill cleared.' : 'Current bill already empty tha.';
                if (cartRef.current.length > 0) {
                    resetCurrentBill();
                }
                updateVoiceDebugSnapshot({
                    phase: 'completed',
                    transcript,
                    resolvedCount: 0,
                    pendingCount: 0,
                    unresolvedCount: 0,
                    note: message,
                    error: '',
                });
                addVoiceLogEntry(message, transcript);
                return;
            }

            const targetMode = parsedCommand.desiredMode || orderType;
            if (isStoreBusinessType(businessType) && targetMode === 'dine-in') {
                const message = 'Dine-in mode is not available for this store outlet.';
                updateVoiceDebugSnapshot({ phase: 'blocked', note: message, error: message });
                addVoiceLogEntry(message, transcript);
                toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                return;
            }

            const targetTable = parsedCommand.matchedTableId
                ? availableTables.find((table) => table.id === parsedCommand.matchedTableId)
                : (parsedCommand.requestedTableReference ? findVoiceTableMatch(availableTables, parsedCommand.requestedTableReference) : null);

            const currentHasItems = cartRef.current.length > 0;
            const currentTableId = activeTable?.id || '';
            const targetTableId = targetTable?.id || '';
            const contextChangesMode = targetMode !== orderType;
            const contextChangesTable = Boolean(targetTableId && targetTableId !== currentTableId);
            const hasCommandItems = parsedCommand.items.some((item) => String(item?.spokenText || '').trim());
            const recentVoiceDraft = (
                voiceLastCartMutationRef.current?.source === 'voice' &&
                (Date.now() - Number(voiceLastCartMutationRef.current?.timestamp || 0)) <= 30000
            );
            const canReplaceFreshVoiceDraft = (
                currentHasItems &&
                targetTable &&
                !hasCommandItems &&
                !currentTableId &&
                recentVoiceDraft
            );

            if (canReplaceFreshVoiceDraft) {
                resetCurrentBill();
            }

            if (!canReplaceFreshVoiceDraft && currentHasItems && (contextChangesMode || contextChangesTable)) {
                const message = targetTable
                    ? `Current bill active hai. ${targetTable.name} par switch karne se pehle save ya clear karo.`
                    : `Current bill active hai. ${targetMode.replace(/-/g, ' ')} mode me switch karne se pehle save ya clear karo.`;
                updateVoiceDebugSnapshot({ phase: 'blocked', note: message, error: message });
                addVoiceLogEntry(message, transcript);
                toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                return;
            }

            if (targetMode !== orderType) {
                setOrderType(targetMode);
                if (targetMode !== 'dine-in') {
                    setActiveTable(null);
                }
            }

            if (targetTable) {
                const tableActivation = activateTableContextFromVoice(targetTable);
                if (!tableActivation.ok) {
                    updateVoiceDebugSnapshot({ phase: 'blocked', note: tableActivation.message, error: tableActivation.message });
                    addVoiceLogEntry(tableActivation.message, transcript);
                    toast({ title: 'Voice Billing', description: tableActivation.message, variant: 'warning' });
                    return;
                }
                if (canReplaceFreshVoiceDraft) {
                    addVoiceLogEntry(`${targetTable.name} selected. Previous voice draft cleared.`, transcript);
                }
            } else if (parsedCommand.requestedTableReference) {
                const message = `Table "${parsedCommand.requestedTableReference}" match nahi hua.`;
                updateVoiceDebugSnapshot({ phase: 'blocked', note: message, error: message });
                addVoiceLogEntry(message, transcript);
                toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                return;
            }

            const localResolvedSelections = parsedCommand.items
                .filter((item) => item.status === 'resolved')
                .map((item) => buildResolvedVoiceSelection({
                    lineId: item.lineId,
                    entryId: item.selectedEntry?.entryId || item.selectedEntry?.itemId,
                    portionName: item.selectedOption?.label || item.selectedOption?.name,
                    quantity: item.quantity,
                    requestedPortion: item.requestedPortion,
                    commandAction: item.commandAction || cartAction,
                    spokenText: item.spokenText,
                }))
                .filter(Boolean);

            let pendingItems = parsedCommand.items
                .filter((item) => item.status === 'pending' && Array.isArray(item.candidates) && item.candidates.length > 0)
                .map((item) => ({
                    id: item.lineId,
                    spokenText: item.spokenText,
                    quantity: item.quantity,
                    requestedPortion: item.requestedPortion,
                    commandAction: item.commandAction || cartAction,
                    reason: item.reason || 'ambiguous-match',
                    candidates: item.candidates,
                }));

            let aiFallbackError = '';
            const aiEligiblePendingLineIds = new Set(
                pendingItems
                    .filter((item) => item.reason !== 'portion-required' && item.reason !== 'family-ambiguous')
                    .map((item) => item.id)
            );
            if (pendingItems.some((item) => item.reason === 'portion-required')) {
                appendVoiceDebugEvent(
                    'Portion confirmation needed',
                    'AI fallback skipped for items where half/full was not spoken clearly.',
                    'info'
                );
            }
            if (pendingItems.some((item) => item.reason === 'family-ambiguous')) {
                appendVoiceDebugEvent(
                    'Family confirmation needed',
                    'AI fallback skipped because spoken name matches multiple items in the same family.',
                    'info'
                );
            }
            if (aiEligiblePendingLineIds.size > 0) {
                const aiResolution = await resolveAiVoiceCandidates({
                    ...parsedCommand,
                    items: parsedCommand.items.filter((item) => (
                        item.status !== 'pending' || aiEligiblePendingLineIds.has(item.lineId)
                    )),
                }, availableTables);
                aiFallbackError = aiResolution.fallbackError || '';

                const resolvedByAiLineIds = new Set(
                    aiResolution.resolvedSelections.map((selection) => selection.lineId).filter(Boolean)
                );
                pendingItems = pendingItems.filter((item) => aiResolution.unresolvedLineIds.has(item.id) && !resolvedByAiLineIds.has(item.id));
                localResolvedSelections.push(...aiResolution.resolvedSelections);
            }

            const unresolvedWithoutCandidates = parsedCommand.items.filter((item) => item.status === 'unresolved');
            if (pendingItems.length > 0) {
                setVoicePendingItems((prev) => {
                    const nextMap = new Map(prev.map((item) => [item.id, item]));
                    pendingItems.forEach((item) => {
                        nextMap.set(item.id, item);
                    });
                    return Array.from(nextMap.values());
                });
            }

            let addedLabels = [];
            let blockedLabels = [];
            let removedLabels = [];
            let clearedLabels = [];
            let missingLabels = [];

            if (cartAction === 'subtract') {
                const subtractResult = subtractResolvedVoiceItemsFromCart(localResolvedSelections);
                removedLabels = subtractResult.removedLabels;
                missingLabels = subtractResult.missingLabels;
            } else if (cartAction === 'clear-item') {
                const clearResult = clearResolvedVoiceItemsFromCart(localResolvedSelections);
                clearedLabels = clearResult.clearedLabels;
                missingLabels = clearResult.missingLabels;
            } else {
                const addResult = appendResolvedVoiceItemsToCart(localResolvedSelections);
                addedLabels = addResult.addedLabels;
                blockedLabels = addResult.blockedLabels;
            }

            const summaryParts = [];

            if (targetTable?.name) {
                summaryParts.push(`${targetTable.name} selected`);
            } else if (targetMode !== orderType) {
                summaryParts.push(`${targetMode.replace(/-/g, ' ')} mode selected`);
            }

            if (addedLabels.length > 0) {
                summaryParts.push(`Added ${addedLabels.join(', ')}`);
            }
            if (removedLabels.length > 0) {
                summaryParts.push(`Removed ${removedLabels.join(', ')}`);
            }
            if (clearedLabels.length > 0) {
                summaryParts.push(`Cleared ${clearedLabels.join(', ')}`);
            }
            if (pendingItems.length > 0) {
                summaryParts.push(
                    pendingItems
                        .map((item) => (
                            item.reason === 'portion-required'
                                ? `Choose portion for "${item.spokenText}"`
                                : `Confirm "${item.spokenText}"`
                        ))
                        .join(', ')
                );
            }
            if (unresolvedWithoutCandidates.length > 0) {
                summaryParts.push(`Could not match ${unresolvedWithoutCandidates.map((item) => `"${item.spokenText}"`).join(', ')}`);
            }
            if (blockedLabels.length > 0) {
                summaryParts.push(`Stock blocked ${blockedLabels.join(', ')}`);
            }
            if (missingLabels.length > 0) {
                summaryParts.push(`Not found in current cart ${missingLabels.join(', ')}`);
            }
            if (!summaryParts.length) {
                summaryParts.push('No cart changes were applied.');
            }

            const summary = summaryParts.join('. ');
            updateVoiceDebugSnapshot({
                phase: addedLabels.length > 0 || removedLabels.length > 0 || clearedLabels.length > 0
                    ? 'items-added'
                    : pendingItems.length > 0
                        ? 'needs-confirmation'
                        : unresolvedWithoutCandidates.length > 0
                            ? 'unmatched'
                            : 'completed',
                transcript,
                resolvedCount: addedLabels.length + removedLabels.length + clearedLabels.length,
                pendingCount: pendingItems.length,
                unresolvedCount: unresolvedWithoutCandidates.length,
                note: summary,
                error: '',
            });
            addVoiceLogEntry(summary, transcript);

            if (pendingItems.length > 0) {
                toast({
                    title: 'Voice Billing',
                    description: pendingItems.some((item) => item.reason === 'portion-required')
                        ? 'Some items need portion confirmation before the bill is updated.'
                        : 'Some items need confirmation before the bill is updated.',
                    variant: 'warning',
                });
            } else if (unresolvedWithoutCandidates.length > 0) {
                toast({
                    title: 'Voice Billing',
                    description: 'Some spoken items could not be matched. Please try again.',
                    variant: 'warning',
                });
            } else if (missingLabels.length > 0 && addedLabels.length === 0 && removedLabels.length === 0 && clearedLabels.length === 0) {
                toast({
                    title: 'Voice Billing',
                    description: 'Selected item current cart me nahi mila.',
                    variant: 'warning',
                });
            } else if (aiFallbackError && addedLabels.length === 0) {
                toast({
                    title: 'Voice Billing',
                    description: aiFallbackError,
                    variant: 'warning',
                });
            }
        } catch (error) {
            const message = error?.message || 'Voice command could not be processed.';
            updateVoiceDebugSnapshot({
                phase: 'error',
                transcript,
                error: message,
                note: message,
            });
            appendVoiceDebugEvent('Voice pipeline error', message, 'error');
            addVoiceLogEntry(message, transcript);
            toast({ title: 'Voice Billing', description: message, variant: 'destructive' });
        } finally {
            setIsVoiceCommandProcessing(false);
        }
    }, [
        activeTable?.id,
        activateTableContextFromVoice,
        addVoiceLogEntry,
        appendResolvedVoiceItemsToCart,
        buildResolvedVoiceSelection,
        businessType,
        clearResolvedVoiceItemsFromCart,
        fetchManualTables,
        manualTables,
        orderType,
        resetCurrentBill,
        resolveAiVoiceCandidates,
        subtractResolvedVoiceItemsFromCart,
        toast,
        updateVoiceDebugSnapshot,
        voiceMenuIndex,
        appendVoiceDebugEvent,
    ]);

    const handleVoiceCommandResult = useCallback((spokenTranscript) => {
        const transcript = String(spokenTranscript || '').trim();
        if (!transcript) return;

        voiceTranscriptQueueRef.current.push(transcript);
        if (isVoiceQueueRunningRef.current) return;

        isVoiceQueueRunningRef.current = true;
        void (async () => {
            while (voiceTranscriptQueueRef.current.length > 0) {
                const nextTranscript = voiceTranscriptQueueRef.current.shift();
                if (!nextTranscript) continue;
                // Process voice commands serially so consecutive spoken lines do not race each other.
                // This keeps cart and mode updates deterministic during busy counter sessions.
                // eslint-disable-next-line no-await-in-loop
                await processVoiceCommandTranscript(nextTranscript);
            }
            isVoiceQueueRunningRef.current = false;
        })();
    }, [processVoiceCommandTranscript]);

    const handleVoicePendingCandidate = useCallback((pendingItemId, candidate) => {
        const pendingItem = voicePendingItems.find((item) => item.id === pendingItemId);
        if (!pendingItem || !candidate) return;

        const resolvedSelection = buildResolvedVoiceSelection({
            lineId: pendingItem.id,
            entryId: candidate.entryId || candidate.itemId,
            portionName: candidate.portionName,
            quantity: pendingItem.quantity,
            requestedPortion: pendingItem.requestedPortion,
            commandAction: pendingItem.commandAction || 'add',
            spokenText: pendingItem.spokenText,
        });
        if (!resolvedSelection) return;

        let summary = '';
        if ((pendingItem.commandAction || 'add') === 'subtract') {
            const { removedLabels, missingLabels } = subtractResolvedVoiceItemsFromCart([resolvedSelection]);
            summary = removedLabels.length > 0
                ? `Removed ${removedLabels.join(', ')}`
                : `Could not find ${missingLabels.join(', ')} in current cart`;
        } else if ((pendingItem.commandAction || 'add') === 'clear-item') {
            const { clearedLabels, missingLabels } = clearResolvedVoiceItemsFromCart([resolvedSelection]);
            summary = clearedLabels.length > 0
                ? `Cleared ${clearedLabels.join(', ')}`
                : `Could not find ${missingLabels.join(', ')} in current cart`;
        } else {
            const { addedLabels } = appendResolvedVoiceItemsToCart([resolvedSelection]);
            summary = addedLabels.length > 0 ? `Added ${addedLabels.join(', ')}` : '';
        }

        setVoicePendingItems((prev) => prev.filter((item) => item.id !== pendingItemId));
        if (summary) {
            addVoiceLogEntry(summary, `Resolved "${pendingItem.spokenText}" manually`);
        }
    }, [
        addVoiceLogEntry,
        appendResolvedVoiceItemsToCart,
        buildResolvedVoiceSelection,
        clearResolvedVoiceItemsFromCart,
        subtractResolvedVoiceItemsFromCart,
        voicePendingItems,
    ]);

    const dismissVoicePendingItem = useCallback((pendingItemId) => {
        setVoicePendingItems((prev) => prev.filter((item) => item.id !== pendingItemId));
    }, []);

    useEffect(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return undefined;

        const draftRef = ref(rtdb, buildCallSyncVoiceDraftPath({ businessId, collectionName }));
        const unsubscribe = onValue(
            draftRef,
            (snapshot) => {
                const draft = snapshot.exists() ? snapshot.val() : null;
                if (!shouldApplyCompanionVoiceDraft(draft)) return;

                void applyCompanionVoiceDraftSnapshot(draft);
            },
            (error) => {
                console.error('[ManualOrder] Companion voice draft listener failed:', error);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [
        applyCompanionVoiceDraftSnapshot,
        callSyncTarget?.businessId,
        callSyncTarget?.collectionName,
        shouldApplyCompanionVoiceDraft,
    ]);

    useEffect(() => {
        const businessId = String(callSyncTarget?.businessId || '').trim();
        const collectionName = String(callSyncTarget?.collectionName || '').trim();
        if (!businessId || !collectionName) return undefined;

        let cancelled = false;
        void (async () => {
            const draft = await fetchCompanionVoiceDraftSnapshot();
            if (cancelled || !shouldApplyCompanionVoiceDraft(draft)) return;
            await applyCompanionVoiceDraftSnapshot(draft);
        })();

        return () => {
            cancelled = true;
        };
    }, [
        applyCompanionVoiceDraftSnapshot,
        callSyncTarget?.businessId,
        callSyncTarget?.collectionName,
        fetchCompanionVoiceDraftSnapshot,
        shouldApplyCompanionVoiceDraft,
    ]);

    const resetVoiceHybridQueues = useCallback(() => {
        voiceBrowserResultQueueRef.current = [];
        voiceCapturedSegmentQueueRef.current = [];
        voicePendingAudioSkipCountRef.current = 0;
        voiceRecentAudioFallbackAtRef.current = 0;
        if (voiceAudioFallbackTimerRef.current) {
            clearTimeout(voiceAudioFallbackTimerRef.current);
            voiceAudioFallbackTimerRef.current = null;
        }
    }, []);

    const transcribeVoiceSegment = useCallback(async (audioBlob, metadata = {}) => {
        if (!(audioBlob instanceof Blob)) return;

        const idToken = await getDesktopActionIdToken(auth.currentUser, { timeoutMs: 3000 });
        if (!idToken) {
            throw new Error('Voice billing ke liye login session required hai.');
        }

        const mimeType = String(metadata?.mimeType || audioBlob.type || 'audio/webm').trim() || 'audio/webm';

        const requestTranscript = async () => {
            const formData = new FormData();
            formData.append('audio', audioBlob, `voice-segment-${Date.now()}.webm`);
            formData.append('mimeType', mimeType);
            if (voiceSttKeyterms.length > 0) {
                formData.append('keyterms', JSON.stringify(voiceSttKeyterms));
            }

            updateVoiceDebugSnapshot({
                phase: 'transcribing',
                source: 'recorded-audio',
                provider: 'deepgram',
                audioMime: mimeType,
                audioSize: Number(audioBlob.size || 0),
                note: 'Sending captured audio to Deepgram transcription.',
                error: '',
            });
            appendVoiceDebugEvent(
                'Audio transcription started',
                `${mimeType} • ${Math.round(Number(audioBlob.size || 0) / 1024)} KB`,
                'info'
            );

            const res = await fetch(buildScopedUrl('/api/owner/manual-order/voice-transcribe'), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
                body: formData,
            });

            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 422) {
                    const provider = String(payload?.provider || 'deepgram').trim();
                    updateVoiceDebugSnapshot({
                        phase: 'no-speech',
                        source: 'recorded-audio',
                        provider,
                        transcript: '',
                        confidence: Number(payload?.confidence || 0),
                        note: payload?.message || 'No speech detected in captured audio.',
                    });
                    appendVoiceDebugEvent('No speech detected', payload?.message || 'Recorder captured a segment but no transcript was returned.', 'warning');
                    return {
                        transcript: '',
                        provider,
                        fallbackUsed: false,
                        confidence: Number(payload?.confidence || 0),
                        noSpeech: true,
                        message: String(payload?.message || '').trim(),
                    };
                }
                updateVoiceDebugSnapshot({
                    phase: 'error',
                    source: 'recorded-audio',
                    provider: 'deepgram',
                    error: payload?.message || 'Voice transcription failed.',
                    note: payload?.message || 'Voice transcription failed.',
                });
                appendVoiceDebugEvent('Transcription failed', payload?.message || 'Voice transcription failed.', 'error');
                throw new Error(payload?.message || 'Voice transcription failed.');
            }

            const result = {
                transcript: String(payload?.transcript || '').trim(),
                provider: String(payload?.provider || '').trim(),
                fallbackUsed: !!payload?.fallbackUsed,
                confidence: Number(payload?.confidence || 0),
                detectedLanguage: String(payload?.detectedLanguage || '').trim(),
                languageConfidence: Number(payload?.languageConfidence || 0),
                transcriptionMode: String(payload?.transcriptionMode || '').trim(),
            };
            updateVoiceDebugSnapshot({
                phase: 'transcribed',
                source: 'recorded-audio',
                provider: result.provider || 'deepgram',
                transcript: result.transcript,
                confidence: result.confidence,
                fallbackUsed: result.fallbackUsed,
                note: result.transcript
                    ? `Transcript received from audio capture.${result.detectedLanguage ? ` Language ${result.detectedLanguage}` : ''}${result.transcriptionMode ? ` • ${result.transcriptionMode}` : ''}`
                    : 'Transcript response was empty.',
                error: '',
            });
            appendVoiceDebugEvent(
                'Transcript received',
                `${result.provider || 'unknown'} • conf ${result.confidence.toFixed(2)}${result.detectedLanguage ? ` • lang ${result.detectedLanguage}` : ''}${result.fallbackUsed ? ' • retry used' : ''}${result.transcript ? ` • ${result.transcript}` : ''}`,
                'info'
            );
            return result;
        };

        return requestTranscript();
    }, [appendVoiceDebugEvent, buildScopedUrl, getDesktopActionIdToken, updateVoiceDebugSnapshot, voiceSttKeyterms]);

    const assessBrowserVoiceTranscript = useCallback((spokenTranscript, browserMeta = {}) => {
        const normalizedTranscript = normalizeVoiceText(spokenTranscript);
        const tokenCount = normalizedTranscript ? normalizedTranscript.split(/\s+/).filter(Boolean).length : 0;

        if (!tokenCount) {
            return {
                shouldUsePaidFallback: true,
                browserConfidence: 0,
                highestItemConfidence: 0,
            };
        }

        const preview = parseManualOrderVoiceCommand({
            transcript: spokenTranscript,
            menuIndex: voiceMenuIndex,
            manualTables,
            currentMode: orderType,
        });
        const items = Array.isArray(preview?.items) ? preview.items : [];
        const resolvedCount = items.filter((item) => item.status === 'resolved').length;
        const pendingCount = items.filter((item) => item.status === 'pending' && Array.isArray(item.candidates) && item.candidates.length > 0).length;
        const unresolvedCount = items.filter((item) => item.status === 'unresolved').length;
        const highestItemConfidence = items.reduce(
            (maxScore, item) => Math.max(maxScore, Number(item?.confidence || 0)),
            0
        );
        const browserConfidence = Number(browserMeta?.confidence || 0);
        const tableContextNeedsHelp = Boolean(preview?.requestedTableReference && !preview?.matchedTableId);
        const contextCommandDetected = Boolean(
            (preview?.requestedTableReference && preview?.matchedTableId) ||
            preview?.matchedTableId ||
            (preview?.desiredMode && preview.desiredMode !== (orderType || 'delivery'))
        );
        const parserConfident = (
            highestItemConfidence >= 0.84 ||
            (resolvedCount > 0 && highestItemConfidence >= 0.74) ||
            (pendingCount > 0 && highestItemConfidence >= 0.68)
        );
        const browserConfident = browserConfidence >= 0.82;
        const shouldUsePaidFallback = (
            (tableContextNeedsHelp && !browserConfident) ||
            (
                !contextCommandDetected &&
                !browserConfident &&
                !parserConfident &&
                resolvedCount === 0 &&
                pendingCount === 0 &&
                (unresolvedCount > 0 || items.length === 0)
            )
        );

        return {
            shouldUsePaidFallback,
            browserConfidence,
            highestItemConfidence,
        };
    }, [manualTables, orderType, voiceMenuIndex]);

    const processHybridVoiceQueues = useCallback(() => {
        if (isVoiceHybridQueueRunningRef.current) return;
        isVoiceHybridQueueRunningRef.current = true;

        void (async () => {
            try {
                while (true) {
                    while (voicePendingAudioSkipCountRef.current > 0 && voiceCapturedSegmentQueueRef.current.length > 0) {
                        voiceCapturedSegmentQueueRef.current.shift();
                        voicePendingAudioSkipCountRef.current = Math.max(0, voicePendingAudioSkipCountRef.current - 1);
                    }

                    if (!voiceUseBrowserPrimaryRef.current) {
                        const nextAudioSegment = voiceCapturedSegmentQueueRef.current.shift();
                        if (!nextAudioSegment) break;

                        setIsVoiceFallbackTranscribing(true);
                        try {
                            const paidTranscript = await transcribeVoiceSegment(nextAudioSegment.audioBlob, nextAudioSegment.metadata);
                            if (paidTranscript?.transcript) {
                                handleVoiceCommandResult(paidTranscript.transcript);
                            }
                        } catch (error) {
                            const message = error?.message || 'Voice transcription failed.';
                            addVoiceLogEntry(message, '');
                            toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                        } finally {
                            setIsVoiceFallbackTranscribing(false);
                        }
                        continue;
                    }

                    const nextBrowserResult = voiceBrowserResultQueueRef.current[0];
                    const nextAudioSegment = voiceCapturedSegmentQueueRef.current[0];
                    const audioWaitExpired = nextAudioSegment
                        ? (Date.now() - Number(nextAudioSegment.createdAt || 0)) >= 1450
                        : false;

                    if (!nextBrowserResult) {
                        if (!nextAudioSegment) break;
                        if (!audioWaitExpired) break;

                        voiceCapturedSegmentQueueRef.current.shift();
                        setIsVoiceFallbackTranscribing(true);
                        appendVoiceDebugEvent('Browser transcript timeout', 'Browser speech ne transcript nahi diya, recorded audio fallback use ho rahi hai.', 'warning');
                        try {
                            const paidTranscript = await transcribeVoiceSegment(nextAudioSegment.audioBlob, nextAudioSegment.metadata);
                            if (paidTranscript?.transcript) {
                                voiceRecentAudioFallbackAtRef.current = Date.now();
                                handleVoiceCommandResult(paidTranscript.transcript);
                            }
                        } catch (error) {
                            const message = error?.message || 'Voice transcription failed.';
                            addVoiceLogEntry(message, '');
                            toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                        } finally {
                            setIsVoiceFallbackTranscribing(false);
                        }
                        continue;
                    }

                    if (!nextBrowserResult) break;
                    const assessment = assessBrowserVoiceTranscript(nextBrowserResult.transcript, nextBrowserResult.meta);
                    const fallbackWaitExpired = (Date.now() - Number(nextBrowserResult.createdAt || 0)) >= 1200;
                    const canUsePaidFallback = voiceCaptureSupportedRef.current && Boolean(nextAudioSegment);

                    if (assessment.shouldUsePaidFallback && voiceCaptureSupportedRef.current && !nextAudioSegment && !fallbackWaitExpired) {
                        break;
                    }

                    if (!assessment.shouldUsePaidFallback || !canUsePaidFallback || fallbackWaitExpired) {
                        voiceBrowserResultQueueRef.current.shift();
                        handleVoiceCommandResult(nextBrowserResult.transcript);

                        if (nextAudioSegment) {
                            voiceCapturedSegmentQueueRef.current.shift();
                        } else if (voiceCaptureSupportedRef.current) {
                            voicePendingAudioSkipCountRef.current += 1;
                        }
                        continue;
                    }

                    voiceBrowserResultQueueRef.current.shift();
                    voiceCapturedSegmentQueueRef.current.shift();

                    setIsVoiceFallbackTranscribing(true);
                    try {
                        const paidTranscript = await transcribeVoiceSegment(nextAudioSegment.audioBlob, nextAudioSegment.metadata);
                        const resolvedTranscript = String(paidTranscript?.transcript || nextBrowserResult.transcript || '').trim();
                        if (resolvedTranscript) {
                            handleVoiceCommandResult(resolvedTranscript);
                        }
                    } catch (error) {
                        const browserTranscript = String(nextBrowserResult.transcript || '').trim();
                        if (browserTranscript) {
                            handleVoiceCommandResult(browserTranscript);
                        } else {
                            const message = error?.message || 'Voice transcription failed.';
                            addVoiceLogEntry(message, '');
                            toast({ title: 'Voice Billing', description: message, variant: 'warning' });
                        }
                    } finally {
                        setIsVoiceFallbackTranscribing(false);
                    }
                }
            } finally {
                isVoiceHybridQueueRunningRef.current = false;
            }
        })();
    }, [
        addVoiceLogEntry,
        appendVoiceDebugEvent,
        assessBrowserVoiceTranscript,
        handleVoiceCommandResult,
        toast,
        transcribeVoiceSegment,
    ]);

    const scheduleHybridVoiceQueueDrain = useCallback((delayMs = 1450) => {
        if (voiceAudioFallbackTimerRef.current) {
            clearTimeout(voiceAudioFallbackTimerRef.current);
        }
        voiceAudioFallbackTimerRef.current = window.setTimeout(() => {
            voiceAudioFallbackTimerRef.current = null;
            processHybridVoiceQueues();
        }, delayMs);
    }, [processHybridVoiceQueues]);

    const handleCapturedVoiceSegment = useCallback((audioBlob, metadata = {}) => {
        if (!(audioBlob instanceof Blob)) return;
        updateVoiceDebugSnapshot({
            phase: 'segment-captured',
            source: 'recorded-audio',
            audioMime: String(metadata?.mimeType || audioBlob.type || 'audio/webm').trim() || 'audio/webm',
            audioSize: Number(metadata?.size || audioBlob.size || 0),
            note: 'Captured one voice segment. Waiting to transcribe it.',
            error: '',
        });
        appendVoiceDebugEvent(
            'Audio captured',
            `${String(metadata?.mimeType || audioBlob.type || 'audio/webm').trim() || 'audio/webm'} • ${Math.round(Number(metadata?.size || audioBlob.size || 0) / 1024)} KB`,
            'info'
        );
        voiceCapturedSegmentQueueRef.current.push({
            id: `voice-audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            audioBlob,
            metadata,
            createdAt: Date.now(),
        });
        processHybridVoiceQueues();
        if (voiceUseBrowserPrimaryRef.current) {
            scheduleHybridVoiceQueueDrain();
        }
    }, [appendVoiceDebugEvent, processHybridVoiceQueues, scheduleHybridVoiceQueueDrain, updateVoiceDebugSnapshot]);

    const handleBrowserVoiceResult = useCallback((spokenTranscript, meta = {}) => {
        const transcript = String(spokenTranscript || '').trim();
        if (!transcript) return;
        if (
            voiceRecentAudioFallbackAtRef.current &&
            (Date.now() - voiceRecentAudioFallbackAtRef.current) < 2200 &&
            voiceCapturedSegmentQueueRef.current.length === 0
        ) {
            appendVoiceDebugEvent('Late browser transcript ignored', transcript, 'info');
            return;
        }

        updateVoiceDebugSnapshot({
            phase: 'browser-transcript',
            source: 'browser-speech',
            provider: 'browser',
            transcript,
            confidence: Number(meta?.confidence || 0),
            note: 'Browser speech recognition returned a transcript.',
            error: '',
        });
        appendVoiceDebugEvent('Browser transcript', `${transcript} • conf ${Number(meta?.confidence || 0).toFixed(2)}`, 'info');
        voiceBrowserResultQueueRef.current.push({
            id: `voice-browser-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            transcript,
            meta,
            createdAt: Date.now(),
        });
        processHybridVoiceQueues();
        window.setTimeout(() => {
            processHybridVoiceQueues();
        }, 1300);
    }, [appendVoiceDebugEvent, processHybridVoiceQueues, updateVoiceDebugSnapshot]);

    const {
        isSupported: isBrowserVoiceRecognitionSupported,
        isListening: isBrowserVoiceListening,
        error: browserVoiceRecognitionError,
        permissionState: browserVoicePermissionState,
        lastErrorCode: browserVoiceRecognitionErrorCode,
        microphoneProbe: browserVoiceMicrophoneProbe,
        startListening: startBrowserVoiceListening,
        stopListening: stopBrowserVoiceListening,
        runMicrophoneProbe: runBrowserVoiceMicrophoneProbe,
    } = useSpeechRecognition({
        lang: 'en-IN',
        onFinalResult: handleBrowserVoiceResult,
    });

    const {
        isSupported: isVoiceCaptureSupported,
        isListening: isVoiceCaptureListening,
        isTranscribing: isVoiceCaptureTranscribing,
        error: voiceCaptureError,
        permissionState: voiceCapturePermissionState,
        lastErrorCode: voiceCaptureErrorCode,
        microphoneProbe: voiceCaptureMicrophoneProbe,
        startListening: startVoiceCaptureListening,
        stopListening: stopVoiceCaptureListening,
        runMicrophoneProbe: runVoiceCaptureMicrophoneProbe,
    } = useVoiceCommandCapture({
        onSegmentReady: handleCapturedVoiceSegment,
        onDebugEvent: handleVoiceCaptureDebugEvent,
        keepDeviceWarmMs: isMobileViewport ? 12000 : 0,
    });

    browserVoiceRecognitionSupportedRef.current = isBrowserVoiceRecognitionSupported;
    voiceCaptureSupportedRef.current = isVoiceCaptureSupported;

    useEffect(() => {
        if (browserVoiceRecognitionErrorCode === 'not-allowed' || browserVoiceRecognitionErrorCode === 'service-not-allowed') {
            voiceUseBrowserPrimaryRef.current = false;
            processHybridVoiceQueues();
        }
    }, [browserVoiceRecognitionErrorCode, processHybridVoiceQueues]);

    const isVoiceRecognitionSupported = isBrowserVoiceRecognitionSupported || isVoiceCaptureSupported;
    const isVoiceListening = isBrowserVoiceListening || isVoiceCaptureListening;
    const voiceRecognitionError = voiceCaptureError || browserVoiceRecognitionError;
    const voicePermissionState = browserVoicePermissionState !== 'unknown'
        ? browserVoicePermissionState
        : voiceCapturePermissionState;
    const voiceRecognitionErrorCode = browserVoiceRecognitionErrorCode || voiceCaptureErrorCode;
    const voiceMicrophoneProbe = browserVoiceMicrophoneProbe?.status && browserVoiceMicrophoneProbe.status !== 'unknown'
        ? browserVoiceMicrophoneProbe
        : voiceCaptureMicrophoneProbe;
    const shouldPreferRecordedAudioVoice = (
        isVoiceCaptureSupported &&
        !isBrowserVoiceRecognitionSupported
    );

    useEffect(() => {
        if (!voiceRecognitionError) return;
        updateVoiceDebugSnapshot({
            phase: 'error',
            error: voiceRecognitionError,
            note: voiceRecognitionError,
        });
        appendVoiceDebugEvent('Voice error', voiceRecognitionError, 'error');
    }, [appendVoiceDebugEvent, updateVoiceDebugSnapshot, voiceRecognitionError]);

    useEffect(() => {
        if (shouldPreferRecordedAudioVoice) {
            voiceUseBrowserPrimaryRef.current = false;
            processHybridVoiceQueues();
            return;
        }

        voiceUseBrowserPrimaryRef.current = true;
    }, [processHybridVoiceQueues, shouldPreferRecordedAudioVoice]);

    const startVoiceListening = useCallback(async () => {
        resetVoiceHybridQueues();
        updateVoiceDebugSnapshot({
            phase: 'arming',
            source: shouldPreferRecordedAudioVoice ? 'recorded-audio' : 'hybrid',
            note: shouldPreferRecordedAudioVoice
                ? 'Voice capture requested. Recorded-audio fallback mode active.'
                : 'Voice capture requested. Browser/default speech primary, recorded audio backup active.',
            error: '',
        });
        appendVoiceDebugEvent(
            'Mic armed',
            shouldPreferRecordedAudioVoice
                ? 'Recorded-audio mode active because browser speech recognition is unavailable.'
                : 'Browser/default speech primary with recorded-audio backup active.',
            'info'
        );

        const captureStarted = isVoiceCaptureSupported
            ? await startVoiceCaptureListening()
            : false;
        let browserStarted = false;

        if (shouldPreferRecordedAudioVoice) {
            if (!captureStarted && isBrowserVoiceRecognitionSupported) {
                browserStarted = startBrowserVoiceListening();
            }
            voiceUseBrowserPrimaryRef.current = !captureStarted && Boolean(browserStarted);
        } else {
            browserStarted = isBrowserVoiceRecognitionSupported
                ? startBrowserVoiceListening()
                : false;
            voiceUseBrowserPrimaryRef.current = Boolean(browserStarted);
        }

        if (captureStarted || browserStarted) {
            updateVoiceDebugSnapshot({
                phase: 'listening',
                source: shouldPreferRecordedAudioVoice ? 'recorded-audio' : (browserStarted ? 'browser-speech' : 'recorded-audio'),
                note: 'Mic is listening. Speak now and then release.',
                error: '',
            });
        } else {
            updateVoiceDebugSnapshot({
                phase: 'error',
                note: 'Voice start request failed.',
                error: 'Mic could not start.',
            });
        }

        return Boolean(captureStarted || browserStarted);
    }, [
        appendVoiceDebugEvent,
        isBrowserVoiceRecognitionSupported,
        isVoiceCaptureSupported,
        resetVoiceHybridQueues,
        startBrowserVoiceListening,
        startVoiceCaptureListening,
        shouldPreferRecordedAudioVoice,
        updateVoiceDebugSnapshot,
    ]);

    const stopVoiceListening = useCallback(() => {
        stopBrowserVoiceListening();
        stopVoiceCaptureListening();
        resetVoiceHybridQueues();
        setIsVoiceFallbackTranscribing(false);
        voiceUseBrowserPrimaryRef.current = true;
        updateVoiceDebugSnapshot({
            phase: 'stopped',
            note: 'Mic released. Waiting for any pending transcription.',
        });
        appendVoiceDebugEvent('Mic released', 'Capture stopped by user.', 'info');
    }, [appendVoiceDebugEvent, resetVoiceHybridQueues, stopBrowserVoiceListening, stopVoiceCaptureListening, updateVoiceDebugSnapshot]);

    const toggleVoiceListening = useCallback(async () => {
        if (isVoiceListening) {
            stopVoiceListening();
            return false;
        }
        return startVoiceListening();
    }, [isVoiceListening, startVoiceListening, stopVoiceListening]);

    const runVoiceMicrophoneProbe = useCallback(async () => {
        if (isVoiceCaptureSupported) {
            return runVoiceCaptureMicrophoneProbe();
        }
        return runBrowserVoiceMicrophoneProbe();
    }, [isVoiceCaptureSupported, runBrowserVoiceMicrophoneProbe, runVoiceCaptureMicrophoneProbe]);

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
        if (mode !== 'delivery') {
            setDeliveryChargeInput('0');
        }
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

    const saveCustomBillHistory = useCallback(async (printedVia = 'browser', typeOverride = null) => {
        const user = auth.currentUser;
        if (!user) throw new Error('Authentication required.');
        const idToken = await getDesktopActionIdToken(user);

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
        const res = await fetchWithDesktopMutationTimeout(endpoint, {
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
        const normalizedSavedPhone = normalizeSuggestionPhone(customerDetails.phone);
        const normalizedSavedAddress = normalizeAddressText(customerDetails.address);
        if (normalizedSavedPhone) {
            const freshCustomerEntry = {
                phone: normalizedSavedPhone,
                name: String(customerDetails.name || '').trim(),
                totalOrders: 1,
                lastUsedAt: Date.now(),
                addresses: normalizedSavedAddress ? [{ full: normalizedSavedAddress, useCount: 1, lastUsedAt: Date.now() }] : [],
            };
            setCustomerSuggestionDataset((prev) => {
                const existingCustomers = Array.isArray(prev?.customers) ? prev.customers : [];
                const existingAddresses = Array.isArray(prev?.addresses) ? prev.addresses : [];
                const nextCustomersMap = new Map(existingCustomers.map((entry) => [normalizeSuggestionPhone(entry.phone), entry]));
                const existingCustomer = nextCustomersMap.get(normalizedSavedPhone);
                const mergedAddressMap = new Map(
                    (existingCustomer?.addresses || []).map((entry) => [normalizeAddressText(entry.full).toLowerCase(), entry])
                );
                if (normalizedSavedAddress) {
                    const currentAddress = mergedAddressMap.get(normalizedSavedAddress.toLowerCase()) || { full: normalizedSavedAddress, useCount: 0, lastUsedAt: 0 };
                    mergedAddressMap.set(normalizedSavedAddress.toLowerCase(), {
                        ...currentAddress,
                        full: normalizedSavedAddress,
                        useCount: Number(currentAddress.useCount || 0) + 1,
                        lastUsedAt: Date.now(),
                    });
                }
                nextCustomersMap.set(normalizedSavedPhone, {
                    ...freshCustomerEntry,
                    ...existingCustomer,
                    phone: normalizedSavedPhone,
                    name: String(customerDetails.name || existingCustomer?.name || '').trim(),
                    totalOrders: Number(existingCustomer?.totalOrders || 0) + 1,
                    lastUsedAt: Date.now(),
                    addresses: Array.from(mergedAddressMap.values())
                        .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
                        .slice(0, 8),
                });

                const nextAddressesMap = new Map(existingAddresses.map((entry) => [normalizeAddressText(entry?.full || entry).toLowerCase(), entry]));
                if (normalizedSavedAddress) {
                    const existingAddress = nextAddressesMap.get(normalizedSavedAddress.toLowerCase()) || { full: normalizedSavedAddress, useCount: 0, lastUsedAt: 0 };
                    nextAddressesMap.set(normalizedSavedAddress.toLowerCase(), {
                        ...existingAddress,
                        full: normalizedSavedAddress,
                        useCount: Number(existingAddress.useCount || 0) + 1,
                        lastUsedAt: Date.now(),
                    });
                }

                const nextDataset = {
                    generatedAt: Date.now(),
                    customers: Array.from(nextCustomersMap.values())
                        .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0))
                        .slice(0, 250),
                    addresses: Array.from(nextAddressesMap.values())
                        .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0))
                        .slice(0, 250),
                };
                writeCustomerSuggestionCache(nextDataset);
                return nextDataset;
            });
        }
        return data;
    }, [accessQuery, additionalCharge, additionalChargeLabel, billDraftId, cart, cgst, currentBillCustomerOrderId, customerDetails, deliveryCharge, discount, fetchWithDesktopMutationTimeout, getDesktopActionIdToken, grandTotal, orderType, paymentMode, sgst, subtotal, writeCustomerSuggestionCache]);

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

    const persistCurrentManualOrder = async () => {
        if (!cart.length) return { ok: false };
        if (!validatePhoneNumber()) return { ok: false };

        setIsSavingBillHistory(true);
        let saveError = null;
        try {
            if (isDesktopOfflineMode(desktopRuntime)) {
                await queueOfflineAction('manual_bill_history_create', {
                    billDraftId,
                    printedVia: orderType,
                    customerDetails,
                    items: cart,
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
                });
            } else {
                await saveCustomBillHistory('browser', orderType);
            }
        } catch (error) {
            if (canUseDesktopOfflineFallback(error)) {
                await queueOfflineAction('manual_bill_history_create', {
                    billDraftId,
                    printedVia: orderType,
                    customerDetails,
                    items: cart,
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
                });
                saveError = null;
            } else {
                saveError = error;
                console.error('[Manual Order] Failed to save order before printing:', error);
            }
        } finally {
            setIsSavingBillHistory(false);
        }

        if (saveError) {
            toast({ title: 'Save Failed', description: saveError.message, variant: 'destructive' });
            return { ok: false, error: saveError };
        }

        return { ok: true };
    };

    const handleOccupyTable = async () => {
        if (!activeTable) return;
        if (activeTable?.currentOrder?.isFinalized) {
            toast({ title: 'Order Locked', description: 'This order is finalized and cannot be edited.', variant: 'destructive' });
            return;
        }
        if (!validatePhoneNumber()) return;
        setTableActionLoading(true);
        const currentOrder = {
            items: cart,
            customerDetails,
            subtotal, cgst, sgst, deliveryCharge, additionalCharge, additionalChargeLabel, grandTotal,
            orderType: 'dine-in',
            orderDate: activeTable?.currentOrder?.orderDate || new Date().toISOString(),
            occupiedAt: activeTable?.currentOrder?.occupiedAt || new Date().toISOString(),
        };
        try {
            if (isDesktopOfflineMode(desktopRuntime)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === activeTable.id
                        ? { ...table, currentOrder, isOccupied: true, updatedAt: new Date().toISOString() }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_occupy', { tableId: activeTable.id, currentOrder });
                toast({ title: 'Offline Saved', description: `Order saved locally to ${activeTable.name}.`, variant: 'warning' });
                if (autoPrintBillsEnabled) {
                    setTableToPrint({ ...activeTable, currentOrder });
                }
                setActiveTable(null);
                handleClear();
                return;
            }

            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await getDesktopActionIdToken(user);

            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl(`/api/owner/manual-tables/${activeTable.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'occupy', currentOrder })
            });

            if (!res.ok) throw new Error('Failed to save to table');

            toast({ title: 'Saved', description: `Order saved to ${activeTable.name}` });

            // Auto-print bill after saving to table
            if (autoPrintBillsEnabled) {
                const savedTableData = { ...activeTable, currentOrder };
                setTableToPrint(savedTableData);
            }

            setActiveTable(null);
            handleClear(); // Clear cart
            fetchManualTables();
        } catch (error) {
            if (canUseDesktopOfflineFallback(error)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === activeTable.id
                        ? { ...table, currentOrder, isOccupied: true, updatedAt: new Date().toISOString() }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_occupy', { tableId: activeTable.id, currentOrder });
                toast({ title: 'Offline Saved', description: `Order saved locally to ${activeTable.name}.`, variant: 'warning' });
                if (autoPrintBillsEnabled) {
                    setTableToPrint({ ...activeTable, currentOrder });
                }
                setActiveTable(null);
                handleClear();
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
        } finally {
            setTableActionLoading(false);
        }
    };

    const handleCreateTable = async () => {
        if (!newTableName.trim()) return;
        setTableActionLoading(true);
        try {
            if (isDesktopOfflineMode(desktopRuntime)) {
                const tableName = newTableName.trim();
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const existing = sourceTables.some((table) => String(table?.id || '').trim().toLowerCase() === tableName.toLowerCase());
                if (existing) {
                    toast({ title: 'Duplicate Table', description: 'A table with this name already exists locally.', variant: 'destructive' });
                    return;
                }
                const newTable = {
                    id: tableName,
                    name: tableName,
                    isOccupied: false,
                    currentOrder: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                const nextTables = sortManualTablesByName([...sourceTables, newTable]);
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_create', { name: tableName });
                toast({ title: 'Offline Saved', description: 'Table created locally and queued for sync.', variant: 'warning' });
                setIsCreateTableModalOpen(false);
                setNewTableName('');
                return;
            }

            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await getDesktopActionIdToken(user);
            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/manual-tables'), {
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
            if (canUseDesktopOfflineFallback(error)) {
                const tableName = newTableName.trim();
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const existing = sourceTables.some((table) => String(table?.id || '').trim().toLowerCase() === tableName.toLowerCase());
                if (existing) {
                    toast({ title: 'Duplicate Table', description: 'A table with this name already exists locally.', variant: 'destructive' });
                } else {
                    const newTable = {
                        id: tableName,
                        name: tableName,
                        isOccupied: false,
                        currentOrder: null,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    const nextTables = sortManualTablesByName([...sourceTables, newTable]);
                    setManualTables(nextTables);
                    writeCachedManualTables(nextTables);
                    await queueOfflineAction('manual_table_create', { name: tableName });
                    toast({ title: 'Offline Saved', description: 'Table created locally and queued for sync.', variant: 'warning' });
                    setIsCreateTableModalOpen(false);
                    setNewTableName('');
                }
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
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
            if (isDesktopOfflineMode(desktopRuntime)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === tableToFinalize.id
                        ? {
                            ...table,
                            currentOrder: {
                                ...(table.currentOrder || {}),
                                isFinalized: true,
                                finalizedAt: new Date().toISOString(),
                            },
                            updatedAt: new Date().toISOString(),
                        }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_finalize', { tableId: tableToFinalize.id });
                setSelectedOccupiedTable(null);
                toast({ title: 'Offline Saved', description: `${tableToFinalize.name} finalized locally and queued for sync.`, variant: 'warning' });
                return;
            }

            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await getDesktopActionIdToken(user);
            const res = await fetchWithDesktopMutationTimeout(buildScopedUrl(`/api/owner/manual-tables/${tableToFinalize.id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ action: 'finalize' })
            });
            if (!res.ok) throw new Error('Failed to lock order');
            toast({ title: 'Order Locked', description: `${tableToFinalize.name} order is now finalized. No further edits allowed.` });
            setSelectedOccupiedTable(null);
            fetchManualTables();
        } catch (error) {
            if (canUseDesktopOfflineFallback(error)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === tableToFinalize.id
                        ? {
                            ...table,
                            currentOrder: {
                                ...(table.currentOrder || {}),
                                isFinalized: true,
                                finalizedAt: new Date().toISOString(),
                            },
                            updatedAt: new Date().toISOString(),
                        }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_finalize', { tableId: tableToFinalize.id });
                setSelectedOccupiedTable(null);
                toast({ title: 'Offline Saved', description: `${tableToFinalize.name} finalized locally and queued for sync.`, variant: 'warning' });
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
        } finally {
            setTableActionLoading(false);
        }
    };

    const handleSettleTable = async (tableData = null) => {
        const tableToSettle = tableData?.id ? tableData : selectedOccupiedTable;
        if (!tableToSettle || !tableToSettle.currentOrder) return;
        setTableActionLoading(true);
        const offlineBillPayload = {
            billDraftId: createBillDraftId(),
            printedVia: 'dine-in',
            customerDetails: tableToSettle.currentOrder.customerDetails || {},
            items: tableToSettle.currentOrder.items || [],
            billDetails: {
                subtotal: tableToSettle.currentOrder.subtotal,
                cgst: tableToSettle.currentOrder.cgst,
                sgst: tableToSettle.currentOrder.sgst,
                deliveryCharge: tableToSettle.currentOrder.deliveryCharge,
                serviceFee: tableToSettle.currentOrder.additionalCharge,
                serviceFeeLabel: tableToSettle.currentOrder.additionalChargeLabel,
                grandTotal: tableToSettle.currentOrder.grandTotal,
            },
        };
        try {
            if (isDesktopOfflineMode(desktopRuntime)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === tableToSettle.id
                        ? { ...table, currentOrder: null, isOccupied: false, updatedAt: new Date().toISOString() }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_settle', { tableId: tableToSettle.id, bill: offlineBillPayload });
                if (!tableData?.id) {
                    setSelectedOccupiedTable(null);
                }
                toast({ title: 'Offline Settled', description: `Table ${tableToSettle.name} settled locally and queued for sync.`, variant: 'warning' });
                return;
            }

            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');
            const idToken = await getDesktopActionIdToken(user);

            const historyItems = tableToSettle.currentOrder.items.map((item) => ({
                id: item.id, name: item.name, categoryId: item.categoryId,
                quantity: item.quantity, price: item.price, totalPrice: item.totalPrice, portion: item.portion || null,
            }));

            const historyRes = await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/custom-bill/history'), {
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
                await fetchWithDesktopMutationTimeout(buildScopedUrl('/api/owner/custom-bill/history'), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    body: JSON.stringify({ action: 'settle', historyIds: [savedHistoryId] }),
                });
            }

            // 2. Free the table
            const freeRes = await fetchWithDesktopMutationTimeout(buildScopedUrl(`/api/owner/manual-tables/${tableToSettle.id}`), {
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
            if (canUseDesktopOfflineFallback(error)) {
                const cachedTables = await resolveCachedManualTables();
                const sourceTables = cachedTables.length > 0 ? cachedTables : manualTables;
                const nextTables = sortManualTablesByName(sourceTables.map((table) => (
                    table.id === tableToSettle.id
                        ? { ...table, currentOrder: null, isOccupied: false, updatedAt: new Date().toISOString() }
                        : table
                )));
                setManualTables(nextTables);
                writeCachedManualTables(nextTables);
                await queueOfflineAction('manual_table_settle', { tableId: tableToSettle.id, bill: offlineBillPayload });
                if (!tableData?.id) {
                    setSelectedOccupiedTable(null);
                }
                toast({ title: 'Offline Settled', description: `Table ${tableToSettle.name} settled locally and queued for sync.`, variant: 'warning' });
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
            }
        } finally {
            setTableActionLoading(false);
        }
    };


    const handleSaveOrderWithoutPrint = async () => {
        const result = await persistCurrentManualOrder();
        if (!result?.ok) return;

        setIsBillModalOpen(false);
        toast({
            title: 'Saved',
            description: 'Order saved successfully. Auto print is currently turned off in Settings.',
        });
        handleClear();
    };

    const handleBrowserPrintForBill = async () => {
        const result = await persistCurrentManualOrder();
        if (!result?.ok) return;

        if (billPrintRef.current) {
            if (desktopRuntime) {
                try {
                    await silentPrintElement(billPrintRef.current, {
                        documentTitle: `Bill-${Date.now()}`,
                    });
                    setIsBillModalOpen(false);
                } catch (printError) {
                    console.error('[Manual Order] Silent print failed, falling back to browser print:', printError);
                    if (handlePrint) handlePrint();
                }
            } else if (handlePrint) {
                handlePrint();
            }
        }

        toast({ title: 'Success', description: 'Bill printed and saved.' });
        handleClear(); // Automatically clear cart after success for Delivery/Pickup
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

    const mobileCartItemCount = useMemo(
        () => cart.reduce((sum, item) => sum + Number(item?.quantity || 0), 0),
        [cart]
    );

    const mobileVoiceStatusLabel = SHOW_MANUAL_ORDER_VOICE_UI
        ? (isVoiceListening
        ? 'Listening'
        : (isVoiceCommandProcessing || isVoiceFallbackTranscribing || isVoiceCaptureTranscribing)
            ? 'Processing'
            : 'Ready')
        : 'Ready';
    const isMobileHoldToTalk = isMobileViewport;
    const isMobileMicBusy = (isVoiceCommandProcessing || isVoiceFallbackTranscribing || isVoiceCaptureTranscribing) && !isVoiceListening;

    useEffect(() => {
        voiceListeningStateRef.current = isVoiceListening;
        if (!isVoiceListening) {
            mobileMicStartInFlightRef.current = false;
        }
    }, [isVoiceListening]);

    const handleMobileSwipeStart = useCallback((event) => {
        if (!isMobileViewport) return;
        if (event.target?.closest?.('[data-mobile-swipe-ignore="true"]')) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        mobileSwipeStartRef.current = {
            x: touch.clientX,
            y: touch.clientY,
        };
    }, [isMobileViewport]);

    const handleMobileSwipeEnd = useCallback((event) => {
        if (!isMobileViewport) return;
        const start = mobileSwipeStartRef.current;
        mobileSwipeStartRef.current = null;
        if (!start) return;

        const touch = event.changedTouches?.[0];
        if (!touch) return;

        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;

        if (deltaX < 0) {
            setIsMobileCartOpen(true);
            return;
        }
        setIsMobileCartOpen(false);
    }, [isMobileViewport]);

    const openMobileCartDrawer = useCallback(() => {
        setIsMobileToolsOpen(false);
        setIsMobileCartOpen(true);
    }, []);

    const toggleMobileToolsPanel = useCallback(() => {
        setIsMobileCartOpen(false);
        setIsMobileToolsOpen((prev) => !prev);
    }, []);

    const handleMobileMicPressStart = useCallback(async (event) => {
        if (!isMobileHoldToTalk || isMobileMicBusy || voiceListeningStateRef.current || mobileMicStartInFlightRef.current) return;
        event.preventDefault();
        mobileMicPressActiveRef.current = true;
        mobileMicStopAfterStartRef.current = false;
        mobileMicStartInFlightRef.current = true;
        const startToken = Date.now();
        mobileMicStartTokenRef.current = startToken;

        try {
            event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch {
            // ignore pointer capture failures on some mobile browsers
        }

        const started = await startVoiceListening();

        if (mobileMicStartTokenRef.current !== startToken) return;

        mobileMicStartInFlightRef.current = false;

        if ((!mobileMicPressActiveRef.current || mobileMicStopAfterStartRef.current) && (started || voiceListeningStateRef.current)) {
            mobileMicStopAfterStartRef.current = false;
            stopVoiceListening();
        }
    }, [isMobileHoldToTalk, isMobileMicBusy, startVoiceListening, stopVoiceListening]);

    const handleMobileMicPressEnd = useCallback((event) => {
        if (!isMobileHoldToTalk) return;
        event.preventDefault();
        mobileMicPressActiveRef.current = false;
        try {
            event.currentTarget?.releasePointerCapture?.(event.pointerId);
        } catch {
            // ignore pointer capture release failures
        }

        if (voiceListeningStateRef.current) {
            stopVoiceListening();
            return;
        }

        if (mobileMicStartInFlightRef.current) {
            mobileMicStopAfterStartRef.current = true;
        }
    }, [isMobileHoldToTalk, stopVoiceListening]);

    const handleMobileMicFabClick = useCallback(() => {
        if (isMobileHoldToTalk || isMobileMicBusy) return;
        void toggleVoiceListening();
    }, [isMobileHoldToTalk, isMobileMicBusy, toggleVoiceListening]);

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
                    {(desktopRuntime || isKioskPrintMode(preferredPrintMode)) && (
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
                            title={desktopRuntime || isKioskPrintMode(preferredPrintMode) ? 'Silent print to the saved/default printer' : 'Standard browser print dialog'}
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            {isSavingBillHistory ? 'Saving...' : (desktopRuntime || isKioskPrintMode(preferredPrintMode)) ? 'Silent Print' : 'Browser Print'}
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
                            Added only to this bill. It will not be saved in the menu.
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

            <Dialog open={isVoiceDebugDialogOpen} onOpenChange={setIsVoiceDebugDialogOpen}>
                <DialogContent className="max-w-3xl border-border bg-card p-0 text-foreground sm:rounded-2xl">
                    <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <DialogTitle>Voice Debug</DialogTitle>
                                <DialogDescription>
                                    Mic se parser tak poora pipeline yahan visible hai. Isse turant pata chalega issue capture, transcript, ya matching me hai.
                                </DialogDescription>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 text-xs font-semibold"
                                onClick={clearVoiceDebugData}
                            >
                                Clear Debug
                            </Button>
                        </div>
                    </DialogHeader>

                    <div className="max-h-[78vh] space-y-5 overflow-y-auto px-5 py-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-border bg-muted/20 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Phase</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">{voiceDebugSnapshot.phase || 'idle'}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-muted/20 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">{voiceDebugSnapshot.source || 'n/a'}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-muted/20 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">{voiceDebugSnapshot.provider || 'n/a'}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-muted/20 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Updated</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">
                                    {voiceDebugSnapshot.updatedAt
                                        ? new Date(voiceDebugSnapshot.updatedAt).toLocaleTimeString('en-IN')
                                        : 'Not yet'}
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                            <div className="space-y-3">
                                <div className="rounded-2xl border border-border bg-background p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Last Transcript</p>
                                    <p className="mt-2 min-h-[48px] text-sm font-medium leading-6 text-foreground">
                                        {voiceDebugSnapshot.transcript || voiceLastTranscript || 'Abhi tak koi transcript capture nahi hua.'}
                                    </p>
                                </div>

                                <div className="rounded-2xl border border-border bg-background p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Last Action</p>
                                    <p className="mt-2 min-h-[48px] text-sm font-medium leading-6 text-foreground">
                                        {voiceLastAction || voiceDebugSnapshot.note || 'Abhi tak cart action record nahi hua.'}
                                    </p>
                                </div>

                                <div className="rounded-2xl border border-border bg-background p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest Note</p>
                                    <p className="mt-2 text-sm leading-6 text-foreground">
                                        {voiceDebugSnapshot.note || 'No extra diagnostic note yet.'}
                                    </p>
                                    {voiceDebugSnapshot.error ? (
                                        <p className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                                            {voiceDebugSnapshot.error}
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="rounded-2xl border border-border bg-background p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Parse Counts</p>
                                    <div className="mt-3 grid grid-cols-3 gap-2">
                                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-center">
                                            <p className="text-lg font-black text-emerald-700">{voiceDebugSnapshot.resolvedCount || 0}</p>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700/80">Resolved</p>
                                        </div>
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-center">
                                            <p className="text-lg font-black text-amber-700">{voiceDebugSnapshot.pendingCount || 0}</p>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700/80">Pending</p>
                                        </div>
                                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3 text-center">
                                            <p className="text-lg font-black text-rose-700">{voiceDebugSnapshot.unresolvedCount || 0}</p>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700/80">Unmatched</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-border bg-background p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Context</p>
                                    <div className="mt-3 space-y-2 text-sm text-foreground">
                                        <p><span className="font-semibold">Mode:</span> {voiceDebugSnapshot.desiredMode || orderType || 'n/a'}</p>
                                        <p><span className="font-semibold">Table heard:</span> {voiceDebugSnapshot.requestedTableReference || 'n/a'}</p>
                                        <p><span className="font-semibold">Table matched:</span> {voiceDebugSnapshot.matchedTableName || activeTable?.name || 'n/a'}</p>
                                        <p><span className="font-semibold">Audio:</span> {voiceDebugSnapshot.audioMime || 'n/a'}{voiceDebugSnapshot.audioSize ? ` • ${Math.round(Number(voiceDebugSnapshot.audioSize || 0) / 1024)} KB` : ''}</p>
                                        <p><span className="font-semibold">Confidence:</span> {Number.isFinite(voiceDebugSnapshot.confidence) ? Number(voiceDebugSnapshot.confidence).toFixed(2) : 'n/a'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background p-4">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent Voice Events</p>
                                <p className="text-xs text-muted-foreground">{voiceDebugEvents.length} events</p>
                            </div>

                            {voiceDebugEvents.length > 0 ? (
                                <div className="mt-3 max-h-[34vh] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                                    {voiceDebugEvents.map((event) => (
                                        <div
                                            key={event.id}
                                            className={cn(
                                                'rounded-xl border px-3 py-3',
                                                event.level === 'error'
                                                    ? 'border-destructive/30 bg-destructive/5'
                                                    : event.level === 'warning'
                                                        ? 'border-amber-500/30 bg-amber-500/5'
                                                        : 'border-border bg-muted/20'
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-foreground">{event.title}</p>
                                                    {event.detail ? (
                                                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{event.detail}</p>
                                                    ) : null}
                                                </div>
                                                <p className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                                    {event.createdAt ? new Date(event.createdAt).toLocaleTimeString('en-IN') : ''}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    Abhi tak koi debug event record nahi hua. Mic start karke ek baar speak karke dekho.
                                </p>
                            )}
                        </div>
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

            {isMobileViewport && (isMobileCartOpen || isMobileToolsOpen) && (
                <button
                    type="button"
                    aria-label="Close mobile overlay"
                    className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
                    onClick={() => {
                        setIsMobileCartOpen(false);
                        setIsMobileToolsOpen(false);
                    }}
                />
            )}

            {isMobileViewport && (
                <div
                    className={cn(
                        'fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] border border-border bg-background/98 px-4 pb-5 pt-4 shadow-2xl shadow-slate-950/20 backdrop-blur transition-transform duration-300 ease-out lg:hidden',
                        isMobileToolsOpen ? 'translate-y-0' : 'translate-y-[104%] pointer-events-none'
                    )}
                >
                    <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-border" />
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Quick Tools</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Billing controls ab yahan compact mode me hain.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsMobileToolsOpen(false)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-foreground transition-colors hover:bg-muted"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="mt-4 space-y-4">
                        <div className={cn(
                            'grid gap-2 rounded-2xl bg-muted p-1',
                            isStoreBusinessType(businessType) ? 'grid-cols-2' : 'grid-cols-3'
                        )}>
                            {(isStoreBusinessType(businessType) ? ['delivery', 'pickup'] : ['delivery', 'dine-in', 'pickup']).map(mode => (
                                <button
                                    key={`mobile-mode-${mode}`}
                                    type="button"
                                    onClick={() => {
                                        setOrderType(mode);
                                        if (mode !== 'dine-in') setActiveTable(null);
                                        setIsMobileToolsOpen(false);
                                    }}
                                    className={cn(
                                        'rounded-xl px-2 py-2 text-xs font-semibold capitalize transition-colors',
                                        orderType === mode
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {mode.replace('-', ' ')}
                                </button>
                            ))}
                        </div>

                        {(orderType !== 'dine-in' || activeTable) && (
                            <div className="space-y-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        placeholder={isStoreBusinessType(businessType) ? 'Search item, SKU, or barcode...' : 'Search menu...'}
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="h-11 w-full rounded-2xl border border-border bg-input py-2 pl-10 pr-4 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        onClick={handleClear}
                                        disabled={cart.length === 0}
                                        variant="outline"
                                        className="h-11 gap-2 rounded-2xl border-2 border-destructive/40 px-3 text-sm font-semibold text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 size={16} />
                                        Clear
                                    </Button>
                                    <Button
                                        onClick={handleUndo}
                                        disabled={itemHistory.length === 0}
                                        variant="outline"
                                        className="h-11 gap-2 rounded-2xl border-2 border-primary/40 px-3 text-sm font-semibold text-foreground hover:bg-primary/10"
                                    >
                                        <RotateCcw size={16} />
                                        Undo
                                    </Button>
                                </div>
                            </div>
                        )}

                        <Link href={historyUrl} className="block">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-full rounded-2xl px-3 text-sm font-semibold"
                            >
                                View Bill History
                            </Button>
                        </Link>

                        {SHOW_MANUAL_ORDER_VOICE_UI ? (
                            <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-full rounded-2xl px-3 text-sm font-semibold"
                                onClick={() => {
                                    setIsMobileToolsOpen(false);
                                    setIsVoiceDebugDialogOpen(true);
                                }}
                            >
                                Voice Debug
                            </Button>
                        ) : null}
                    </div>
                </div>
            )}

            {SHOW_MANUAL_ORDER_VOICE_UI && isMobileViewport && (
                <button
                    type="button"
                    data-mobile-swipe-ignore="true"
                    onClick={handleMobileMicFabClick}
                    onPointerDown={handleMobileMicPressStart}
                    onPointerUp={handleMobileMicPressEnd}
                    onPointerCancel={handleMobileMicPressEnd}
                    onPointerLeave={handleMobileMicPressEnd}
                    disabled={isMobileMicBusy}
                    className={cn(
                        'fixed bottom-5 right-4 z-50 inline-flex h-16 w-16 items-center justify-center rounded-[24px] border shadow-2xl transition-all lg:hidden',
                        isVoiceListening
                            ? 'border-rose-700 bg-rose-600 text-white shadow-rose-950/35'
                            : 'border-primary/30 bg-primary text-primary-foreground shadow-primary/25',
                        isMobileMicBusy && 'opacity-70'
                    )}
                    style={{ touchAction: 'none' }}
                    aria-label={isMobileHoldToTalk ? 'Hold to talk' : 'Toggle voice billing'}
                    title={isMobileHoldToTalk ? 'Hold to talk' : 'Tap to start voice billing'}
                >
                    {isVoiceListening ? <MicOff size={24} /> : <Mic size={24} />}
                </button>
            )}

            <div
                className={cn(
                    "flex-1 min-h-0 overflow-hidden flex",
                    isMobileViewport ? "flex-col gap-3" : "flex-row gap-0"
                )}
                onTouchStart={handleMobileSwipeStart}
                onTouchEnd={handleMobileSwipeEnd}
            >
                {/* Left Side: Menu Selection (Flexible) */}
                <div className="order-1 flex-1 min-w-0 min-h-0 bg-card flex flex-col overflow-hidden">
                    <div className={cn("shrink-0 border-b border-border px-3 pt-2", isMobileViewport ? "pb-2" : "pb-3")}>
                        <div className={cn(
                            "sticky top-0 z-20 -mx-3 mb-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur",
                            isMobileViewport ? "block" : "hidden"
                        )}>
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[15px] font-black tracking-tight">
                                        {isStoreBusinessType(businessType) ? 'Store POS Billing' : 'Manual Billing'}
                                    </p>
                                    <p className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                                        {mobileVoiceStatusLabel} • {String(orderType || 'delivery').replace(/-/g, ' ')}
                                        {activeTable?.name ? ` • ${activeTable.name}` : ''}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={toggleMobileToolsPanel}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5"
                                >
                                    <SlidersHorizontal size={17} />
                                </button>

                                <button
                                    type="button"
                                    onClick={openMobileCartDrawer}
                                    className="inline-flex min-w-[64px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-border bg-background px-3 py-2 text-sm font-semibold shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5"
                                >
                                    <MenuIcon size={18} />
                                    <span>{mobileCartItemCount}</span>
                                </button>
                            </div>
                            {SHOW_MANUAL_ORDER_VOICE_UI && voiceRecognitionError ? (
                                <p className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[10px] font-medium text-destructive">
                                    {voiceRecognitionError}
                                </p>
                            ) : null}
                        </div>

                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className={cn("text-lg font-bold tracking-tight", isMobileViewport ? "hidden" : "block")}>
                                        {isStoreBusinessType(businessType) ? 'Store POS Billing' : 'Manual Billing'}
                                    </h1>
                                    <div className={cn(isMobileViewport ? "hidden" : "block")}>
                                        <OfflineDesktopStatus />
                                    </div>
                                </div>

                                <div className={cn(
                                    "mt-3 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center",
                                    isMobileViewport ? "hidden" : "flex"
                                )}>
                                    <div className="flex w-full items-center overflow-x-auto rounded-lg bg-muted p-1 sm:w-auto">
                                        {(isStoreBusinessType(businessType) ? ['delivery', 'pickup'] : ['delivery', 'dine-in', 'pickup']).map(mode => (
                                            <button
                                                key={mode}
                                                onClick={() => {
                                                    setOrderType(mode);
                                                    if (mode !== 'dine-in') setActiveTable(null);
                                                }}
                                                className={cn(
                                                    "whitespace-nowrap px-3 py-1.5 text-sm font-semibold rounded-md capitalize transition-colors",
                                                    orderType === mode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10"
                                                )}
                                            >
                                                {mode.replace('-', ' ')}
                                            </button>
                                        ))}
                                    </div>

                                    <Link href={historyUrl} className="w-full sm:w-auto">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="h-9 w-full px-3 text-xs font-semibold sm:w-auto"
                                        >
                                            View Bill History
                                        </Button>
                                    </Link>
                                </div>
                            </div>

                            <div className={cn(
                                "w-full flex-col gap-2",
                                isMobileViewport ? "hidden" : "flex",
                                SHOW_MANUAL_ORDER_VOICE_UI ? "xl:max-w-[560px]" : "lg:max-w-[440px]"
                            )}>
                                {SHOW_MANUAL_ORDER_VOICE_UI ? (
                                    <VoiceBillingPanel
                                        className="w-full"
                                        supported={isVoiceRecognitionSupported}
                                        listening={isVoiceListening}
                                        processing={isVoiceCommandProcessing || isVoiceFallbackTranscribing || isVoiceCaptureTranscribing}
                                        aiResolving={isVoiceAiResolving}
                                        lastTranscript={voiceLastTranscript}
                                        lastAction={voiceLastAction}
                                        diagnostics={voiceDebugSnapshot}
                                        error={voiceRecognitionError}
                                        permissionState={voicePermissionState}
                                        rawErrorCode={voiceRecognitionErrorCode}
                                        microphoneProbe={voiceMicrophoneProbe}
                                        currentModeLabel={orderType}
                                        activeTableLabel={activeTable?.name || ''}
                                        logEntries={voiceCommandLog}
                                        pendingItems={voicePendingItems}
                                        onToggleListening={toggleVoiceListening}
                                        onStopListening={stopVoiceListening}
                                        onRunMicrophoneProbe={runVoiceMicrophoneProbe}
                                        onOpenDebug={() => setIsVoiceDebugDialogOpen(true)}
                                        onUsePendingCandidate={handleVoicePendingCandidate}
                                        onDismissPendingItem={dismissVoicePendingItem}
                                    />
                                ) : null}

                                {(orderType !== 'dine-in' || activeTable) && (
                                    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto]">
                                        <div className="relative min-w-0 col-span-2 sm:col-span-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                            <input
                                                ref={searchInputRef}
                                                type="text"
                                                placeholder={isStoreBusinessType(businessType) ? 'Search item, SKU, or barcode...' : 'Search menu...'}
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                className="h-10 w-full min-w-0 rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                                            />
                                        </div>
                                        <Button
                                            onClick={handleClear}
                                            disabled={cart.length === 0}
                                            variant="outline"
                                            className="h-10 w-full gap-1 border-2 border-destructive/60 px-2 font-bold text-destructive shadow-sm transition-all hover:bg-destructive/10 sm:w-auto sm:px-4 sm:gap-2"
                                            title="Clear entire cart"
                                        >
                                            <Trash2 size={16} />
                                            <span className="hidden sm:inline">Clear</span>
                                        </Button>
                                        <Button
                                            onClick={handleUndo}
                                            disabled={itemHistory.length === 0}
                                            variant="outline"
                                            className="h-10 w-full gap-1 border-2 border-primary/60 px-2 font-bold text-foreground shadow-sm transition-all hover:bg-primary/10 sm:w-auto sm:px-4 sm:gap-2"
                                            title="Undo last item added"
                                        >
                                            <RotateCcw size={16} />
                                            <span className="hidden sm:inline">Undo</span>
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {orderType === 'dine-in' && !activeTable ? (
                        <div className="mt-4 flex-1 overflow-y-auto rounded-xl border-t border-border bg-muted/20 p-4">
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
                                            return (
                                                <div className="space-y-0.5 p-0.5" ref={provided.innerRef} {...provided.droppableProps}>
                                                    {isMounted && orderedVisibleMenuEntries.map(([categoryId], index) => (
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
                                onPointerDown={startResizing}
                                className="hidden select-none md:flex absolute top-0 bottom-0 z-10 w-4 cursor-col-resize items-center justify-center group"
                                style={{ left: `${sidebarWidth - 1}px`, transform: 'translateX(-50%)', touchAction: 'none' }}
                                title="Drag to resize sidebar"
                                aria-label="Resize category sidebar"
                            >
                                <div className="h-10 w-1 bg-border rounded-full group-hover:bg-primary transition-colors"></div>
                            </div>

                            <div className="absolute left-0 right-0 top-0 z-10 border-b border-border bg-card/95 px-3 py-2 backdrop-blur md:hidden">
                                <div className="flex gap-2 overflow-x-auto pb-1" data-mobile-swipe-ignore="true">
                                    {orderedVisibleMenuEntries.map(([categoryId]) => (
                                        <button
                                            key={`mobile-cat-${categoryId}`}
                                            type="button"
                                            onClick={() => scrollToCategory(categoryId)}
                                            className={cn(
                                                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                                                activeCategory === categoryId
                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                    : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                                            )}
                                        >
                                            {formatCategoryLabel(categoryId)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* ITEM LIST */}
                            <div
                                ref={scrollContainerRef}
                                className="flex-grow min-h-0 overflow-y-auto overscroll-contain px-3 pb-24 pt-16 custom-scrollbar md:pl-5 md:pr-6 md:pt-2 md:pb-4 lg:pr-8"
                            >
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                                        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                        <p>Loading menu...</p>
                                    </div>
                                ) : orderedVisibleMenuEntries.map(([categoryId, filteredItems]) => (
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
                                                        className="group relative overflow-hidden p-4 text-left bg-gradient-to-br from-emerald-950/30 via-emerald-900/15 to-emerald-900/5 hover:from-emerald-900/35 hover:via-emerald-800/20 hover:to-emerald-900/10 rounded-2xl border border-emerald-500/35 hover:border-emerald-400/70 transition-all shadow-md hover:shadow-xl hover:shadow-emerald-950/20 min-h-[118px] flex flex-col justify-between"
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
                                                            <p className="text-xs text-muted-foreground mt-2 leading-snug max-w-[13rem] sm:max-w-[14rem]">
                                                                Enter name and price. Adds only to this bill, not the menu.
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

                {/* Right Side: Live Bill Preview (Resizable) */}
                <div
                    ref={billContainerRef}
                    style={{
                        width: isMobileViewport ? undefined : `${billSidebarWidth}px`,
                        minWidth: isMobileViewport ? undefined : '260px',
                        maxWidth: isMobileViewport ? undefined : 'min(420px, 46vw)',
                    }}
                    onTouchStart={handleMobileSwipeStart}
                    onTouchEnd={handleMobileSwipeEnd}
                    className={cn(
                        'relative flex flex-shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain',
                        isMobileViewport
                            ? [
                                'fixed inset-y-0 right-0 z-50 h-[100dvh] w-[min(92vw,420px)] max-w-full',
                                'border-l border-border bg-background px-3 pb-3 pt-3 shadow-2xl shadow-slate-950/25',
                                'transition-transform duration-300 ease-out',
                                isMobileCartOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none',
                            ]
                            : 'order-2 h-full max-h-none min-h-0 overflow-y-auto px-0 pb-0 pr-1'
                    )}
                >
                    {!isMobileViewport && (
                        <div
                            onPointerDown={startResizingBill}
                            className="group absolute left-0 top-1/2 z-30 flex h-28 w-7 -translate-x-1/2 -translate-y-1/2 cursor-col-resize select-none items-center justify-center"
                            title="Drag to resize current order panel"
                            aria-label="Resize current order panel"
                            style={{ touchAction: 'none' }}
                        >
                            <div className="flex h-full w-full items-center justify-center rounded-full bg-background/95 shadow-sm ring-1 ring-border transition-colors group-hover:ring-primary/30">
                                <div className="flex h-20 w-4 items-center justify-center gap-1 rounded-full transition-colors group-hover:bg-primary/10">
                                    <div className="h-10 w-[2px] rounded-full bg-border transition-colors group-hover:bg-primary" />
                                    <GripVertical size={14} className="text-muted-foreground transition-colors group-hover:text-primary" />
                                    <div className="h-10 w-[2px] rounded-full bg-border transition-colors group-hover:bg-primary" />
                                </div>
                            </div>
                        </div>
                    )}

                    {isMobileViewport && (
                        <div className="sticky top-0 z-10 -mx-3 border-b border-border bg-background/95 px-3 pb-3 pt-1 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Current Order</p>
                                    <p className="mt-1 truncate text-sm font-semibold text-foreground">
                                        {mobileCartItemCount} item(s) • {formatCurrency(grandTotal)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsMobileCartOpen(false)}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-foreground transition-colors hover:bg-muted"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground">Swipe right to go back to menu.</p>
                        </div>
                    )}

                    {/* Collapsible Customer Details */}
                    <div className="bg-card border border-border rounded-xl overflow-visible flex-shrink-0">
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
                        <div className={cn('transition-all duration-200', isCustomerDetailsOpen ? 'max-h-[42rem] overflow-visible opacity-100' : 'max-h-0 overflow-hidden opacity-0')}>
                            <div className="p-2 border-t border-border">
                                {pendingCallSuggestion && isPendingCallSuggestionFresh && (
                                    <div className="mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-semibold text-emerald-700">Incoming call</p>
                                                <p className="text-sm font-bold tracking-wide text-emerald-900">{pendingCallSuggestion.phone}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => dismissCallSuggestion(pendingCallSuggestion)}
                                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-500/10"
                                                title="Ignore this incoming call"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-8 px-3 text-xs"
                                                onClick={() => attachCallSuggestionToBill(pendingCallSuggestion)}
                                            >
                                                {activeAttachedCallForBill?.phone && activeAttachedCallForBill.phone !== pendingCallSuggestion.phone
                                                    ? 'Replace with Latest Call'
                                                    : 'Use for This Bill'}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-8 px-3 text-xs"
                                                onClick={() => dismissCallSuggestion(pendingCallSuggestion)}
                                            >
                                                Ignore
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1.5 text-xs"><User size={13} /> Name</Label>
                                        <input
                                            name="manual-order-entry-name"
                                            autoComplete="new-password"
                                            autoCorrect="off"
                                            autoCapitalize="words"
                                            spellCheck={false}
                                            aria-autocomplete="none"
                                            data-form-type="other"
                                            data-lpignore="true"
                                            data-1p-ignore="true"
                                            readOnly={!isCustomerNameInputPrimed}
                                            onPointerDown={() => setIsCustomerNameInputPrimed(true)}
                                            onFocus={() => setIsCustomerNameInputPrimed(true)}
                                            value={customerDetails.name}
                                            onChange={e => setCustomerDetails({ ...customerDetails, name: e.target.value })}
                                            className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1.5 text-xs"><Phone size={13} /> Phone</Label>
                                        <div className="relative" ref={phoneSuggestionBoxRef}>
                                            <input
                                                name="manual-order-customer-phone"
                                                autoComplete="off"
                                                autoCorrect="off"
                                                autoCapitalize="off"
                                                spellCheck={false}
                                                value={customerDetails.phone}
                                                onFocus={() => {
                                                    phoneInputFocusRef.current = true;
                                                    if (phoneSuggestions.length) {
                                                        setIsPhoneSuggestionOpen(true);
                                                        setActivePhoneSuggestionIndex(0);
                                                    }
                                                }}
                                                onBlur={() => { phoneInputFocusRef.current = false; }}
                                                onKeyDown={handlePhoneSuggestionKeyDown}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (activeAttachedCallForBill && normalizeIndianPhoneLoose(val) !== normalizeIndianPhoneLoose(activeAttachedCallForBill.phone)) {
                                                        setAttachedCallContext(null);
                                                    }
                                                    const nextDigits = normalizeSuggestionPhone(val);
                                                    if (!nextDigits || normalizeSuggestionPhone(selectedCustomerSuggestion?.phone) !== nextDigits) {
                                                        setSelectedCustomerSuggestion(null);
                                                    }
                                                    setCustomerDetails({ ...customerDetails, phone: val });
                                                    const isNumeric = !/[^0-9]/.test(val);
                                                    if (val.length === 10 && isNumeric) setPhoneError(false);
                                                    if (val.length === 0 && orderType !== 'delivery') setPhoneError(false);
                                                    setIsPhoneSuggestionOpen(nextDigits.length >= 4);
                                                    setActivePhoneSuggestionIndex(nextDigits.length >= 4 ? 0 : -1);
                                                }}
                                                className={cn(
                                                    "w-full rounded-md border bg-input px-2 py-1.5 pr-8 text-sm transition-colors border-border",
                                                    (customerDetails.phone.length > 10 || (customerDetails.phone.length > 0 && /[^0-9]/.test(customerDetails.phone))) ? "bg-red-500/20 border-red-500 text-red-500" : "",
                                                    phoneError ? "border-red-500 ring-1 ring-red-500" : ""
                                                )}
                                            />
                                            {customerDetails.phone && (
                                                <button
                                                    type="button"
                                                    onClick={clearAttachedCallPhone}
                                                    className="absolute inset-y-0 right-1 my-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                                    title={activeAttachedCallForBill ? 'Remove linked caller number' : 'Clear phone number'}
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                            {isPhoneSuggestionOpen && phoneSuggestions.length > 0 && (
                                                <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                                                    {phoneSuggestions.map((suggestion) => (
                                                        <button
                                                            key={suggestion.phone}
                                                            type="button"
                                                            className={cn(
                                                                "flex w-full flex-col gap-0.5 border-b border-border/70 px-3 py-2 text-left last:border-b-0 hover:bg-muted",
                                                                phoneSuggestions[activePhoneSuggestionIndex]?.phone === suggestion.phone && "bg-muted"
                                                            )}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onMouseEnter={() => setActivePhoneSuggestionIndex(phoneSuggestions.findIndex((entry) => entry.phone === suggestion.phone))}
                                                            onClick={() => applyCustomerSuggestion(suggestion)}
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="text-sm font-medium text-foreground">
                                                                    {suggestion.name || 'Repeat Customer'}
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">{suggestion.phone}</span>
                                                            </div>
                                                            {formatSuggestionAddressPreview(suggestion.addresses) && (
                                                                <p className="truncate text-xs text-muted-foreground">
                                                                    {formatSuggestionAddressPreview(suggestion.addresses)}
                                                                </p>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {phoneError && <p className="text-[10px] font-bold text-red-500 mt-0.5 animate-pulse">INVALID PHONE NUMBER</p>}
                                        {!phoneError && callSyncStatus === 'error' && (
                                            <p className="text-[10px] text-amber-600 mt-0.5">Live call sync unavailable right now.</p>
                                        )}
                                        {!phoneError && customerSuggestionStatus === 'ready' && phoneSuggestions.length > 0 && normalizedPhoneQuery.length >= 4 && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5">Repeat customer suggestions ready.</p>
                                        )}
                                    </div>
                                    {orderType === 'delivery' && (
                                        <>
                                            <div className="space-y-1 sm:col-span-2">
                                                <Label className="flex items-center gap-1.5 text-xs"><MapPin size={13} /> Address</Label>
                                                <div className="relative" ref={addressSuggestionBoxRef}>
                                                    <textarea
                                                        name="manual-order-customer-address"
                                                        autoComplete="new-password"
                                                        autoCorrect="off"
                                                        autoCapitalize="sentences"
                                                        spellCheck={false}
                                                        data-form-type="other"
                                                        rows={2}
                                                        value={customerDetails.address}
                                                        onFocus={() => {
                                                            if (addressSuggestions.length) {
                                                                setIsAddressSuggestionOpen(true);
                                                                setActiveAddressSuggestionIndex(0);
                                                            }
                                                        }}
                                                        onKeyDown={handleAddressSuggestionKeyDown}
                                                        onChange={e => {
                                                            setCustomerDetails({ ...customerDetails, address: e.target.value });
                                                            setIsAddressSuggestionOpen(true);
                                                            setActiveAddressSuggestionIndex(0);
                                                        }}
                                                        className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border resize-none"
                                                    />
                                                    {isAddressSuggestionOpen && addressSuggestions.length > 0 && (
                                                        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                                                            {addressSuggestions.map((entry) => (
                                                                <button
                                                                    key={entry.full}
                                                                    type="button"
                                                                    className={cn(
                                                                        "flex w-full flex-col gap-0.5 border-b border-border/70 px-3 py-2 text-left last:border-b-0 hover:bg-muted",
                                                                        addressSuggestions[activeAddressSuggestionIndex]?.full === entry.full && "bg-muted"
                                                                    )}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                    onMouseEnter={() => setActiveAddressSuggestionIndex(addressSuggestions.findIndex((item) => item.full === entry.full))}
                                                                    onClick={() => applyAddressSuggestion(entry.full)}
                                                                >
                                                                    <span className="text-sm text-foreground">{entry.full}</span>
                                                                    {entry.source === 'customer' && (
                                                                        <span className="text-[10px] uppercase tracking-wide text-emerald-600">Saved for this customer</span>
                                                                    )}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                {selectedCustomerAddresses.length > 1 && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {selectedCustomerAddresses.slice(0, 4).map((address) => (
                                                            <button
                                                                key={address}
                                                                type="button"
                                                                onClick={() => applyAddressSuggestion(address)}
                                                                className={cn(
                                                                    "max-w-full rounded-full border px-2 py-1 text-[10px] text-left transition-colors",
                                                                    normalizeAddressText(customerDetails.address).toLowerCase() === normalizeAddressText(address).toLowerCase()
                                                                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                                                                        : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                <span className="block truncate max-w-[220px]">{address}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Delivery Charge (Optional)</Label>
                                                <input type="number" min="0" step="1" value={deliveryChargeInput} onChange={(e) => setDeliveryChargeInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="0" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Notes</Label>
                                                <input value={customerDetails.notes || ''} onChange={e => setCustomerDetails({ ...customerDetails, notes: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="Extra spicy, no onion..." />
                                            </div>
                                        </>
                                    )}
                                    {orderType !== 'delivery' && (
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Notes</Label>
                                            <input value={customerDetails.notes || ''} onChange={e => setCustomerDetails({ ...customerDetails, notes: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="Special note for kitchen / packing..." />
                                        </div>
                                    )}
                                    {isStoreBusinessType(businessType) && (
                                        <>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Discount</Label>
                                                <input type="number" min="0" step="1" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full px-2 py-1.5 text-sm border rounded-md bg-input border-border" placeholder="0" />
                                            </div>
                                            <div className="space-y-1">
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
                    <div className="bg-card border border-border rounded-xl flex min-h-[240px] flex-grow flex-col overflow-hidden lg:min-h-0">
                        {/* Panel Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 flex-shrink-0">
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
                                    <div key={item.cartItemId} className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/20 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm leading-tight truncate">{item.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {item.portion ? `${item.portion.name} · ` : ''}{formatCurrency(item.price)} each
                                            </p>
                                        </div>
                                        <div className="flex w-full flex-shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
                                            <span className="text-xs font-semibold text-right sm:w-14">{formatCurrency(item.totalPrice)}</span>
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
                        <div className="sticky bottom-0 border-t border-border bg-card/95 p-3 backdrop-blur flex gap-2 flex-shrink-0">
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
                                    onClick={autoPrintBillsEnabled ? handleBrowserPrintForBill : handleSaveOrderWithoutPrint}
                                    className="flex-1 h-10 px-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-900/30 transition-all"
                                    disabled={cart.length === 0 || isSavingBillHistory}
                                >
                                    <Printer className="mr-2 h-4 w-4" /> {isSavingBillHistory ? 'Saving...' : autoPrintBillsEnabled ? 'Save & Print' : 'Save Order'}
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
