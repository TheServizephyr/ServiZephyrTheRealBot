'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, ArrowUpDown, BookOpen, BookmarkCheck, Drumstick, Heart, Leaf, Loader2, Search, SlidersHorizontal, Trophy, Utensils, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const ANALYTICS_TAG_KEYS = new Set([
    'bestseller',
    'highly reordered',
    'popular',
    'trending',
    'must try',
    "chef's special",
]);

const getWishlistStorageKey = (restaurantId, entryId) => `servizephyr_waitlist_menu_wishlist_${restaurantId}_${entryId}`;
const getCredentialStorageKey = (restaurantId, entryId) => `servizephyr_waitlist_menu_credential_${restaurantId}_${entryId}`;
const getCategorySectionId = (categoryKey) => `waitlist-menu-category-${encodeURIComponent(String(categoryKey || 'all'))}`;

const SORT_OPTIONS = [
    { value: 'default', label: 'Sort' },
    { value: 'price_asc', label: 'Low price' },
    { value: 'price_desc', label: 'High price' },
    { value: 'wishlisted', label: 'Wishlisted' },
];

function formatCategoryTitle(value = '') {
    return String(value || 'General')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getLowestPrice(item = {}) {
    const portions = Array.isArray(item.portions) ? item.portions : [];
    const prices = portions
        .map((portion) => Number(portion?.price))
        .filter((price) => Number.isFinite(price) && price >= 0);
    if (prices.length > 0) return Math.min(...prices);
    const fallback = Number(item.price);
    return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

function getFoodTags(item = {}) {
    if (!Array.isArray(item.tags)) return [];
    return item.tags.filter((tag) => !ANALYTICS_TAG_KEYS.has(String(tag || '').toLowerCase()));
}

function getAddOnGroups(item = {}) {
    if (!Array.isArray(item.addOnGroups)) return [];
    return item.addOnGroups
        .map((group) => ({
            title: String(group?.title || group?.name || 'Add-ons').trim() || 'Add-ons',
            options: Array.isArray(group?.options)
                ? group.options
                    .map((option) => ({
                        name: String(option?.name || option?.label || '').trim(),
                        price: Number(option?.price || 0) || 0,
                    }))
                    .filter((option) => option.name)
                : [],
        }))
        .filter((group) => group.options.length > 0);
}

function sortMenuItems(items = [], sortMode = 'default') {
    const sorted = [...items];
    if (sortMode === 'price_asc') {
        sorted.sort((a, b) => getLowestPrice(a) - getLowestPrice(b));
    } else if (sortMode === 'price_desc') {
        sorted.sort((a, b) => getLowestPrice(b) - getLowestPrice(a));
    } else if (sortMode === 'wishlisted') {
        sorted.sort((a, b) => Number(b?.wishlistCount || 0) - Number(a?.wishlistCount || 0));
    } else {
        sorted.sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999));
    }
    return sorted;
}

function applyWishlistSummaryToMenuData(menuData = {}, wishlist = {}) {
    const featuredItemIds = new Set(Array.isArray(wishlist?.featuredItemIds) ? wishlist.featuredItemIds.map(String) : []);
    const threshold = Math.max(1, Number(wishlist?.threshold || 20));
    const counts = wishlist?.counts || {};
    const rawMenu = menuData?.menu && typeof menuData.menu === 'object' ? menuData.menu : {};
    const menu = {};

    Object.entries(rawMenu).forEach(([categoryId, items]) => {
        menu[categoryId] = Array.isArray(items)
            ? items.map((item) => {
                const itemId = String(item?.id || '');
                const wishlistCount = Number(counts[itemId] || item?.wishlistCount || 0);
                const isMostWishlisted = featuredItemIds.has(itemId) && wishlistCount >= threshold;
                const nextItem = { ...item, isMostWishlisted };
                if (isMostWishlisted) nextItem.wishlistCount = wishlistCount;
                else delete nextItem.wishlistCount;
                return nextItem;
            })
            : [];
    });

    return { ...menuData, menu };
}

function WaitlistMenuItem({ item, isSaved, onOpenDetails, onToggleSaved }) {
    const price = getLowestPrice(item);
    const portionsCount = Array.isArray(item.portions) ? item.portions.length : 0;
    const addOnGroups = getAddOnGroups(item);
    const addOnCount = addOnGroups.reduce((sum, group) => sum + group.options.length, 0);
    const foodTags = getFoodTags(item);
    const isOutOfStock = item.isAvailable === false;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                'rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-green-600/30',
                isOutOfStock && 'opacity-60 grayscale'
            )}
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetails(item)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenDetails(item);
                }
            }}
        >
            <div className="flex gap-3">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.imageUrl ? (
                        <Image
                            src={item.imageUrl}
                            alt={item.name || 'Menu item'}
                            className="h-full w-full object-cover"
                            fill
                            sizes="96px"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Utensils size={28} />
                        </div>
                    )}
                    {isOutOfStock && (
                        <div className="absolute inset-x-1 bottom-1 rounded-md bg-background/90 px-2 py-1 text-center text-[10px] font-bold text-destructive">
                            Out of stock
                        </div>
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    'flex h-4 w-4 shrink-0 items-center justify-center border',
                                    item.isVeg ? 'border-green-600' : 'border-red-600'
                                )}>
                                    <span className={cn('h-2 w-2 rounded-full', item.isVeg ? 'bg-green-600' : 'bg-red-600')} />
                                </span>
                                <h2 className="line-clamp-2 text-base font-bold leading-snug text-foreground">{item.name}</h2>
                            </div>
                            <p className="mt-1 text-sm font-extrabold text-foreground">Rs {price}</p>
                        </div>
                        <Button
                            type="button"
                            size="icon"
                            variant={isSaved ? 'default' : 'outline'}
                            className={cn(
                                'h-10 w-10 shrink-0 rounded-full',
                                isSaved && 'bg-green-600 text-white hover:bg-green-700'
                            )}
                            aria-label={isSaved ? `Remove ${item.name} from saved items` : `Save ${item.name}`}
                            title={isSaved ? 'Saved' : 'Save for later'}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleSaved(item.id);
                            }}
                        >
                            {isSaved ? <BookmarkCheck size={18} /> : <Heart size={18} />}
                        </Button>
                    </div>

                    {item.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.isMostWishlisted && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                <Trophy size={11} /> Most wishlisted
                            </span>
                        )}
                        {foodTags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {tag}
                            </span>
                        ))}
                        {portionsCount > 1 && (
                            <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {portionsCount} sizes
                            </span>
                        )}
                        {addOnCount > 0 && (
                            <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {addOnCount} add-ons
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function WaitlistMenuItemDetail({ item, isSaved, onClose, onToggleSaved }) {
    if (!item) return null;

    const portions = Array.isArray(item.portions) && item.portions.length > 0
        ? item.portions
        : [{ name: 'Regular', price: getLowestPrice(item) }];
    const addOnGroups = getAddOnGroups(item);
    const foodTags = getFoodTags(item);

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />
            <motion.div
                className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88vh] max-w-3xl overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                role="dialog"
                aria-modal="true"
                aria-label={`${item.name} details`}
            >
                <div className="max-h-[88vh] overflow-y-auto">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-wide text-green-600">Item details</p>
                            <h2 className="truncate text-lg font-black">{item.name}</h2>
                        </div>
                        <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close item details">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    <div className="p-4">
                        <div className="flex gap-4">
                            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-muted">
                                {item.imageUrl ? (
                                    <Image src={item.imageUrl} alt={item.name || 'Menu item'} fill sizes="112px" className="object-cover" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                        <Utensils size={34} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                'flex h-4 w-4 shrink-0 items-center justify-center border',
                                                item.isVeg ? 'border-green-600' : 'border-red-600'
                                            )}>
                                                <span className={cn('h-2 w-2 rounded-full', item.isVeg ? 'bg-green-600' : 'bg-red-600')} />
                                            </span>
                                            <span className="text-sm font-bold">{item.isVeg ? 'Veg' : 'Non-veg'}</span>
                                        </div>
                                        <p className="mt-2 text-lg font-black">Rs {getLowestPrice(item)}</p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant={isSaved ? 'default' : 'outline'}
                                        className={cn(
                                            'h-10 w-10 shrink-0 rounded-full',
                                            isSaved && 'bg-green-600 text-white hover:bg-green-700'
                                        )}
                                        aria-label={isSaved ? `Remove ${item.name} from saved items` : `Save ${item.name}`}
                                        onClick={() => onToggleSaved(item.id)}
                                    >
                                        {isSaved ? <BookmarkCheck size={18} /> : <Heart size={18} />}
                                    </Button>
                                </div>
                                {item.description && (
                                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                                )}
                            </div>
                        </div>

                        {(item.isMostWishlisted || foodTags.length > 0) && (
                            <div className="mt-4 flex flex-wrap gap-1.5">
                                {item.isMostWishlisted && (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-700">
                                        <Trophy size={12} /> Most wishlisted
                                    </span>
                                )}
                                {foodTags.map((tag) => (
                                    <span key={tag} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        <section className="mt-5">
                            <h3 className="text-sm font-black uppercase tracking-wide">Sizes</h3>
                            <div className="mt-2 space-y-2">
                                {portions.map((portion, index) => (
                                    <div key={`${portion.name}-${index}`} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                                        <span className="font-bold">{portion.name || 'Regular'}</span>
                                        <span className="font-black">Rs {Number(portion.price || 0)}</span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {addOnGroups.length > 0 && (
                            <section className="mt-5">
                                <h3 className="text-sm font-black uppercase tracking-wide">Add-ons</h3>
                                <div className="mt-2 space-y-3">
                                    {addOnGroups.map((group, groupIndex) => (
                                        <div key={`${group.title}-${groupIndex}`} className="rounded-lg border border-border bg-card p-3">
                                            <p className="font-black">{group.title}</p>
                                            <div className="mt-2 space-y-1.5">
                                                {group.options.map((option, optionIndex) => (
                                                    <div key={`${option.name}-${optionIndex}`} className="flex items-center justify-between text-sm">
                                                        <span className="text-muted-foreground">{option.name}</span>
                                                        <span className="font-bold">{option.price > 0 ? `+ Rs ${option.price}` : 'Included'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}

export default function WaitlistMenuExplorePage({ params }) {
    const { restaurantId } = params;
    const searchParams = useSearchParams();
    const queryEntryId = String(searchParams.get('entryId') || '').trim();
    const queryArrivalCode = String(searchParams.get('arrivalCode') || '').trim();

    const [payload, setPayload] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [dietFilter, setDietFilter] = useState('all');
    const [showSavedOnly, setShowSavedOnly] = useState(false);
    const [showMostWishlistedOnly, setShowMostWishlistedOnly] = useState(false);
    const [sortMode, setSortMode] = useState('default');
    const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [savedItemIds, setSavedItemIds] = useState(() => new Set());
    const [savedItemsHydrated, setSavedItemsHydrated] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [credentials, setCredentials] = useState({ entryId: queryEntryId, arrivalCode: queryArrivalCode, ready: false });

    const entryId = credentials.entryId;
    const arrivalCode = credentials.arrivalCode;

    const storageKey = useMemo(() => getWishlistStorageKey(restaurantId, entryId || 'guest'), [restaurantId, entryId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const safeEntryId = queryEntryId;
        const safeArrivalCode = queryArrivalCode;
        let nextArrivalCode = safeArrivalCode;

        if (safeEntryId) {
            const credentialStorageKey = getCredentialStorageKey(restaurantId, safeEntryId);
            if (nextArrivalCode) {
                try {
                    window.sessionStorage.setItem(credentialStorageKey, nextArrivalCode);
                } catch {
                    // Session storage can be unavailable in locked-down browsers.
                }
            } else {
                try {
                    nextArrivalCode = window.sessionStorage.getItem(credentialStorageKey) || '';
                } catch {
                    nextArrivalCode = '';
                }
            }

            if (safeArrivalCode) {
                const safeUrl = `/public/waitlist/${encodeURIComponent(restaurantId)}/menu?entryId=${encodeURIComponent(safeEntryId)}`;
                window.history.replaceState(null, '', safeUrl);
            }
        }

        setCredentials({ entryId: safeEntryId, arrivalCode: nextArrivalCode, ready: true });
    }, [queryArrivalCode, queryEntryId, restaurantId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            setSavedItemIds(new Set(Array.isArray(parsed) ? parsed.map(String) : []));
        } catch {
            setSavedItemIds(new Set());
        } finally {
            setSavedItemsHydrated(true);
        }
    }, [storageKey]);

    useEffect(() => {
        if (!savedItemsHydrated) return;
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(Array.from(savedItemIds)));
        } catch {
            // Ignore storage quota or private-mode failures.
        }
    }, [savedItemIds, savedItemsHydrated, storageKey]);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();

        const loadMenu = async () => {
            if (!credentials.ready) return;
            if (!entryId || !arrivalCode) {
                setError('Waitlist token details are missing. Please return to your token page.');
                setLoading(false);
                return;
            }

            setLoading(true);
            setError('');

            try {
                const query = new URLSearchParams({
                    restaurantId,
                    entryId,
                    arrivalCode,
                });
                const res = await fetch(`/api/public/waitlist/menu?${query.toString()}`, {
                    cache: 'no-store',
                    signal: controller.signal,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'Failed to load menu.');
                if (!cancelled) setPayload(data);
            } catch (err) {
                if (err?.name === 'AbortError') return;
                if (!cancelled) setError(err?.message || 'Failed to load menu.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadMenu();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [arrivalCode, credentials.ready, entryId, restaurantId]);

    const menuData = payload?.menuData || {};
    const rawMenu = useMemo(() => menuData.menu || {}, [menuData.menu]);
    const categoryTitleMap = useMemo(() => {
        const map = new Map();
        (Array.isArray(menuData.customCategories) ? menuData.customCategories : []).forEach((category) => {
            const id = String(category?.id || '').trim();
            if (id) map.set(id, String(category?.title || category?.name || '').trim());
        });
        return map;
    }, [menuData.customCategories]);

    const categories = useMemo(() => {
        return Object.entries(rawMenu)
            .map(([key, items]) => ({
                key,
                title: categoryTitleMap.get(key) || formatCategoryTitle(key),
                count: Array.isArray(items) ? items.length : 0,
            }))
            .filter((category) => category.count > 0)
            .sort((a, b) => a.title.localeCompare(b.title));
    }, [categoryTitleMap, rawMenu]);

    const hasFeaturedWishlistedItems = useMemo(() => {
        return Object.values(rawMenu).some((items) => (
            Array.isArray(items) && items.some((item) => item?.isMostWishlisted === true)
        ));
    }, [rawMenu]);

    const visibleItemsByCategory = useMemo(() => {
        const normalizedSearch = searchQuery.trim().toLowerCase();
        const result = [];

        categories.forEach((category) => {
            let items = Array.isArray(rawMenu[category.key]) ? rawMenu[category.key] : [];
            if (normalizedSearch) {
                items = items.filter((item) => {
                    const text = `${item?.name || ''} ${item?.description || ''}`.toLowerCase();
                    return text.includes(normalizedSearch);
                });
            }
            if (dietFilter === 'veg') items = items.filter((item) => item?.isVeg === true);
            if (dietFilter === 'nonveg') items = items.filter((item) => item?.isVeg !== true);
            if (showSavedOnly) items = items.filter((item) => savedItemIds.has(String(item?.id || '')));
            if (showMostWishlistedOnly) items = items.filter((item) => item?.isMostWishlisted === true);
            items = sortMenuItems(items, sortMode);

            if (items.length > 0) {
                result.push({ ...category, items });
            }
        });

        return result;
    }, [categories, dietFilter, rawMenu, savedItemIds, searchQuery, showMostWishlistedOnly, showSavedOnly, sortMode]);

    const savedCount = savedItemIds.size;
    const restaurantName = payload?.restaurant?.name || menuData.restaurantName || 'Restaurant';
    const waitlistToken = payload?.waitlist?.waitlistToken || '';
    const activeCategoryTitle = activeCategory === 'all'
        ? 'All'
        : categories.find((category) => category.key === activeCategory)?.title || 'Categories';
    const sortLabel = SORT_OPTIONS.find((option) => option.value === sortMode)?.label || 'Sort';
    const activeFilterCount = (dietFilter !== 'all' ? 1 : 0) + (showMostWishlistedOnly ? 1 : 0);
    const visibleSortOptions = useMemo(() => (
        hasFeaturedWishlistedItems
            ? SORT_OPTIONS
            : SORT_OPTIONS.filter((option) => option.value !== 'wishlisted')
    ), [hasFeaturedWishlistedItems]);

    useEffect(() => {
        if (hasFeaturedWishlistedItems) return;
        if (showMostWishlistedOnly) setShowMostWishlistedOnly(false);
        if (sortMode === 'wishlisted') setSortMode('default');
    }, [hasFeaturedWishlistedItems, showMostWishlistedOnly, sortMode]);

    useEffect(() => {
        if (!selectedItem || typeof document === 'undefined') return undefined;
        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }

        return () => {
            document.body.style.overflow = originalOverflow;
            document.body.style.paddingRight = originalPaddingRight;
        };
    }, [selectedItem]);

    const toggleSaved = useCallback((itemId) => {
        const safeItemId = String(itemId || '').trim();
        if (!safeItemId) return;
        const shouldSave = !savedItemIds.has(safeItemId);
        setSavedItemIds((current) => {
            const next = new Set(current);
            if (next.has(safeItemId)) next.delete(safeItemId);
            else next.add(safeItemId);
            return next;
        });
        void fetch('/api/public/waitlist/menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                restaurantId,
                entryId,
                arrivalCode,
                itemId: safeItemId,
                action: shouldSave ? 'save' : 'unsave',
            }),
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'Wishlist sync failed.');
                if (data?.wishlist) {
                    setPayload((current) => {
                        if (!current?.menuData) return current;
                        return {
                            ...current,
                            wishlist: data.wishlist,
                            menuData: applyWishlistSummaryToMenuData(current.menuData, data.wishlist),
                        };
                    });
                }
            })
            .catch((syncError) => {
                console.warn('[waitlist-menu] wishlist sync failed:', syncError?.message || syncError);
            });
    }, [arrivalCode, entryId, restaurantId, savedItemIds]);

    const cycleSortMode = useCallback(() => {
        setSortMode((current) => {
            const currentIndex = visibleSortOptions.findIndex((option) => option.value === current);
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % visibleSortOptions.length : 0;
            return visibleSortOptions[nextIndex]?.value || 'default';
        });
    }, [visibleSortOptions]);

    const selectCategory = useCallback((categoryKey) => {
        setActiveCategory(categoryKey);
        setIsCategoryMenuOpen(false);
        if (typeof window !== 'undefined') {
            if (categoryKey === 'all') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            window.requestAnimationFrame(() => {
                document.getElementById(getCategorySectionId(categoryKey))?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                });
            });
        }
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-center">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-green-600" />
                    <p className="mt-3 text-sm font-semibold text-muted-foreground">Loading menu...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md border-destructive/30">
                    <CardContent className="p-6 text-center">
                        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
                        <h1 className="mt-4 text-xl font-bold">Menu unavailable</h1>
                        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                        <Button asChild className="mt-5 w-full" variant="outline">
                            <Link href={`/public/waitlist/${encodeURIComponent(restaurantId)}`}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back to token
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
                <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
                    <Button asChild size="icon" variant="ghost" className="shrink-0">
                        <Link href={`/public/waitlist/${encodeURIComponent(restaurantId)}`} aria-label="Back to waitlist token">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold uppercase tracking-wide text-green-600">Explore Menu</p>
                        <h1 className="truncate text-lg font-black">{restaurantName}</h1>
                    </div>
                    <div className="rounded-full border border-green-600/30 bg-green-600/10 px-3 py-1 text-xs font-bold text-green-700">
                        {savedCount} saved
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
                <section className="rounded-2xl border border-green-600/20 bg-green-600/10 p-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                            <BookOpen size={20} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-black">View and save only</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {waitlistToken ? `Token ${waitlistToken}. ` : ''}Save items now so choosing after seating is faster.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="sticky top-[65px] z-10 -mx-4 mt-4 border-b border-border bg-background/95 px-4 pb-3 pt-1 backdrop-blur">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search menu..."
                            className="h-11 rounded-xl pl-9"
                        />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant={showSavedOnly ? 'default' : 'outline'}
                            className={cn(showSavedOnly && 'bg-green-600 text-white hover:bg-green-700')}
                            onClick={() => setShowSavedOnly((value) => !value)}
                        >
                            <BookmarkCheck className="mr-1.5 h-4 w-4" /> Saved
                        </Button>
                        <div className="relative">
                            <Button
                                type="button"
                                size="sm"
                                variant={activeFilterCount > 0 ? 'default' : 'outline'}
                                onClick={() => setIsFilterMenuOpen((value) => !value)}
                            >
                                <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                                Filter{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                            </Button>
                            <AnimatePresence>
                                {isFilterMenuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                        className="absolute left-0 top-10 z-20 w-48 rounded-xl border border-border bg-background p-2 shadow-xl"
                                    >
                                        <button
                                            type="button"
                                            className={cn(
                                                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold',
                                                dietFilter === 'all' ? 'bg-muted' : 'hover:bg-muted'
                                            )}
                                            onClick={() => {
                                                setDietFilter('all');
                                                setIsFilterMenuOpen(false);
                                            }}
                                        >
                                            <Utensils className="h-4 w-4" /> All food
                                        </button>
                                        <button
                                            type="button"
                                            className={cn(
                                                'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold',
                                                dietFilter === 'veg' ? 'bg-green-600 text-white' : 'hover:bg-muted'
                                            )}
                                            onClick={() => {
                                                setDietFilter((value) => value === 'veg' ? 'all' : 'veg');
                                                setIsFilterMenuOpen(false);
                                            }}
                                        >
                                            <Leaf className="h-4 w-4" /> Veg
                                        </button>
                                        <button
                                            type="button"
                                            className={cn(
                                                'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold',
                                                dietFilter === 'nonveg' ? 'bg-red-600 text-white' : 'hover:bg-muted'
                                            )}
                                            onClick={() => {
                                                setDietFilter((value) => value === 'nonveg' ? 'all' : 'nonveg');
                                                setIsFilterMenuOpen(false);
                                            }}
                                        >
                                            <Drumstick className="h-4 w-4" /> Non-veg
                                        </button>
                                        {hasFeaturedWishlistedItems && (
                                            <button
                                                type="button"
                                                className={cn(
                                                    'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold',
                                                    showMostWishlistedOnly ? 'bg-amber-500 text-white' : 'hover:bg-muted'
                                                )}
                                                onClick={() => {
                                                    setShowMostWishlistedOnly((value) => !value);
                                                    setIsFilterMenuOpen(false);
                                                }}
                                            >
                                                <Trophy className="h-4 w-4" /> Most wishlisted
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant={sortMode === 'default' ? 'outline' : 'default'}
                            onClick={cycleSortMode}
                        >
                            <ArrowUpDown className="mr-1.5 h-4 w-4" /> {sortLabel}
                        </Button>
                    </div>
                </section>

                {visibleItemsByCategory.length > 0 ? (
                    <div className="mt-5 space-y-8">
                        {visibleItemsByCategory.map((category) => (
                            <section
                                key={category.key}
                                id={getCategorySectionId(category.key)}
                                className="scroll-mt-36 space-y-3"
                            >
                                <div>
                                    <h2 className="text-xl font-black">{category.title}</h2>
                                    <p className="text-xs font-semibold text-muted-foreground">{category.items.length} items</p>
                                </div>
                                <div className="space-y-3">
                                    {category.items.map((item) => (
                                        <WaitlistMenuItem
                                            key={item.id}
                                            item={item}
                                            isSaved={savedItemIds.has(String(item.id || ''))}
                                            onOpenDetails={setSelectedItem}
                                            onToggleSaved={toggleSaved}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <Card className="mt-6 border-dashed">
                        <CardContent className="p-8 text-center">
                            <Utensils className="mx-auto h-10 w-10 text-muted-foreground/50" />
                            <h2 className="mt-4 text-lg font-bold">No items match</h2>
                            <p className="mt-1 text-sm text-muted-foreground">Try clearing search, category, or saved filters.</p>
                        </CardContent>
                    </Card>
                )}
            </main>

            <div className="fixed bottom-5 right-5 z-30">
                <AnimatePresence>
                    {isCategoryMenuOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: 12, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.96 }}
                            className="absolute bottom-16 right-0 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
                        >
                            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wide text-green-600">Categories</p>
                                    <p className="text-sm font-black">{activeCategoryTitle}</p>
                                </div>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label="Close categories"
                                    onClick={() => setIsCategoryMenuOpen(false)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="max-h-80 overflow-y-auto p-2">
                                <button
                                    type="button"
                                    className={cn(
                                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold',
                                        activeCategory === 'all' ? 'bg-green-600 text-white' : 'hover:bg-muted'
                                    )}
                                    onClick={() => selectCategory('all')}
                                >
                                    <span>All</span>
                                    <span className={cn('text-xs', activeCategory === 'all' ? 'text-white/80' : 'text-muted-foreground')}>
                                        {categories.reduce((sum, category) => sum + category.count, 0)}
                                    </span>
                                </button>
                                {categories.map((category) => (
                                    <button
                                        key={category.key}
                                        type="button"
                                        className={cn(
                                            'mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold',
                                            activeCategory === category.key ? 'bg-green-600 text-white' : 'hover:bg-muted'
                                        )}
                                        onClick={() => selectCategory(category.key)}
                                    >
                                        <span className="truncate">{category.title}</span>
                                        <span className={cn('ml-3 text-xs', activeCategory === category.key ? 'text-white/80' : 'text-muted-foreground')}>
                                            {category.count}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <Button
                    type="button"
                    size="icon"
                    className="h-12 w-12 rounded-full bg-green-600 text-white shadow-xl hover:bg-green-700"
                    aria-label="Choose category"
                    title={`Category: ${activeCategoryTitle}`}
                    onClick={() => setIsCategoryMenuOpen((value) => !value)}
                >
                    {isCategoryMenuOpen ? <X className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}
                </Button>
            </div>
            {selectedItem && (
                <WaitlistMenuItemDetail
                    item={selectedItem}
                    isSaved={savedItemIds.has(String(selectedItem.id || ''))}
                    onClose={() => setSelectedItem(null)}
                    onToggleSaved={toggleSaved}
                />
            )}
        </div>
    );
}
