'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Compass, Trash2, ArrowRight, ShoppingBag, Phone, Map as MapIcon, AlertTriangle, Check, Loader2, Sparkles, Sun, Moon } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';

function formatWhatsAppNumber(phone) {
    let cleaned = String(phone || '').replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

export default function SearchClient({ initialQuery = '', initialLat = '', initialLng = '', initialFilter = 'nearest' }) {
    const router = useRouter();
    const { theme, resolvedTheme, setTheme } = useTheme();
    const [themeMounted, setThemeMounted] = useState(false);

    useEffect(() => {
        setThemeMounted(true);
    }, []);

    const toggleTheme = () => {
        const currentTheme = resolvedTheme || theme;
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    };

    // Search and location states
    const [query, setQuery] = useState(initialQuery);
    const [searchInput, setSearchInput] = useState(initialQuery);
    const [lat, setLat] = useState(initialLat ? parseFloat(initialLat) : null);
    const [lng, setLng] = useState(initialLng ? parseFloat(initialLng) : null);
    const [filter, setFilter] = useState(initialFilter);
    const [vegOnly, setVegOnly] = useState(false);

    // Results and pagination states
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    // Geolocation detection state
    const [gpsStatus, setGpsStatus] = useState('idle'); // 'idle' | 'detecting' | 'granted' | 'denied'
    const [gpsError, setGpsError] = useState(null);

    // Cart state: localized to a single claimed business
    const [cart, setCart] = useState({});
    const [cartBusiness, setCartBusiness] = useState(null); // stores active business details
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [pendingItem, setPendingItem] = useState(null);

    // Track unique impression hits on viewport render
    const trackedImpressions = useRef(new Set());

    // Request client Geolocation
    const requestLocation = () => {
        if (!navigator.geolocation) {
            setGpsStatus('denied');
            setGpsError('Geolocation is not supported by your browser.');
            return;
        }

        setGpsStatus('detecting');
        setResults([]);
        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const newLat = position.coords.latitude;
                const newLng = position.coords.longitude;
                setLat(newLat);
                setLng(newLng);
                setGpsStatus('granted');
                setGpsError(null);

                // Push new location parameters to URL
                const searchParams = new URLSearchParams(window.location.search);
                searchParams.set('lat', String(newLat));
                searchParams.set('lng', String(newLng));
                router.push(`/search?${searchParams.toString()}`);
            },
            (error) => {
                console.warn('[Search] Geolocation error:', error.message);
                setGpsStatus('denied');
                setGpsError('Location access denied. Items will show without distance sorting.');
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    // Trigger initial geolocation check if no coordinates are in URL
    useEffect(() => {
        if (!initialLat || !initialLng) {
            requestLocation();
        } else {
            setGpsStatus('granted');
        }
    }, [initialLat, initialLng]);

    // Fetch search results when parameters change
    useEffect(() => {
        let isCancelled = false;

        async function fetchResults() {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (query) params.set('q', query);
                if (lat !== null) params.set('lat', String(lat));
                if (lng !== null) params.set('lng', String(lng));
                params.set('page', String(page));
                if (query) {
                    params.set('limit', '100');
                } else {
                    params.set('limit', '15');
                }

                const response = await fetch(`/api/public/food-search?${params.toString()}`);
                const data = await response.json();

                if (!isCancelled) {
                    setResults(data.results || []);
                    setTotal(data.total || 0);
                    setTotalPages(data.totalPages || 1);

                    // If a search was run, log the query anonymously
                    if (query && page === 1) {
                        fetch('/api/public/search-log', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                query,
                                lat,
                                lng,
                                areaHint: results?.[0]?.restaurant?.city || ''
                            })
                        }).catch(err => console.error('[Analytics] Failed to log search query:', err));
                    }
                }
            } catch (err) {
                console.error('[Search] Fetch error:', err);
            } finally {
                if (!isCancelled) setLoading(false);
            }
        }

        fetchResults();

        return () => {
            isCancelled = true;
        };
    }, [query, lat, lng, page]);

    // Filter and sort results client-side for instant responsive interaction
    const processedResults = useMemo(() => {
        let items = [...results];

        // 1. Apply Veg Only filter
        if (vegOnly) {
            items = items.filter(item => item.dish?.isVeg === true || !item.dish);
        }

        // 2. Apply Sorting
        if (query) {
            // Sorting for dish search
            if (filter === 'cheapest') {
                items.sort((a, b) => (a.dish?.price ?? 0) - (b.dish?.price ?? 0));
            } else if (filter === 'cheapest-nearest') {
                items.sort((a, b) => {
                    const distA = a.distanceKm ?? 9999;
                    const distB = b.distanceKm ?? 9999;
                    if (Math.abs(distA - distB) < 1.0) {
                        return (a.dish?.price ?? 0) - (b.dish?.price ?? 0);
                    }
                    return distA - distB;
                });
            } else {
                // Default: nearest first
                items.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
            }
        } else {
            // Sorting for empty query (outlets list by distance)
            items.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
        }

        return items;
    }, [results, vegOnly, filter, query]);

    // Track search result appearances (impressions) once they render
    useEffect(() => {
        if (processedResults.length === 0) return;

        const uniqueBusinesses = new Map();
        processedResults.forEach(item => {
            const b = item.restaurant;
            if (b && !trackedImpressions.current.has(b.id)) {
                uniqueBusinesses.set(b.id, b);
            }
        });

        // Fire appearanceCount tracks
        uniqueBusinesses.forEach((b, id) => {
            trackedImpressions.current.add(id);
            fetch('/api/public/track-interaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    businessId: id,
                    businessType: b.type || 'restaurant',
                    metric: 'appearanceCount'
                })
            }).catch(err => console.error('[Analytics] Failed to track appearance:', err));
        });
    }, [processedResults]);

    // Handle search submission
    const handleSearchSubmit = (e) => {
        if (e) e.preventDefault();
        setPage(1);
        setResults([]);
        setLoading(true);
        setQuery(searchInput);

        const searchParams = new URLSearchParams(window.location.search);
        searchParams.set('q', searchInput);
        router.push(`/search?${searchParams.toString()}`);
    };

    const handlePageChange = (newPage) => {
        setResults([]);
        setLoading(true);
        setPage(newPage);
    };

    // Increment metrics for click actions (Call, Navigate, Order, Details)
    const trackClick = (businessId, businessType, metric) => {
        fetch('/api/public/track-interaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessId,
                businessType,
                metric
            })
        }).catch(err => console.error('[Analytics] Failed to track click metric:', err));
    };

    // Cart handlers
    const handleAddClick = (dish, restaurant) => {
        // Strict boundary: Only allow ordering from one claimed store at a time
        if (cartBusiness && cartBusiness.id !== restaurant.id) {
            setPendingItem({ dish, restaurant });
            setShowConflictModal(true);
            return;
        }

        trackClick(restaurant.id, restaurant.type, 'searchCount');

        setCart((prev) => {
            const existing = prev[dish.id];
            return {
                ...prev,
                [dish.id]: {
                    dish,
                    qty: existing ? existing.qty + 1 : 1
                }
            };
        });

        if (!cartBusiness) {
            setCartBusiness(restaurant);
        }
    };

    const handleRemoveClick = (dishId) => {
        setCart((prev) => {
            const existing = prev[dishId];
            if (!existing) return prev;

            const updated = { ...prev };
            if (existing.qty <= 1) {
                delete updated[dishId];
            } else {
                updated[dishId] = {
                    ...existing,
                    qty: existing.qty - 1
                };
            }

            // If cart is empty, clear active business
            if (Object.keys(updated).length === 0) {
                setCartBusiness(null);
            }

            return updated;
        });
    };

    const confirmConflictResolution = () => {
        if (pendingItem) {
            setCart({
                [pendingItem.dish.id]: {
                    dish: pendingItem.dish,
                    qty: 1
                }
            });
            setCartBusiness(pendingItem.restaurant);
            trackClick(pendingItem.restaurant.id, pendingItem.restaurant.type, 'searchCount');
        }
        setShowConflictModal(false);
        setPendingItem(null);
    };

    // Cart metrics
    const totalCartItems = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
    }, [cart]);

    const totalCartPrice = useMemo(() => {
        return Object.values(cart).reduce((sum, item) => sum + item.dish.price * item.qty, 0);
    }, [cart]);

    // Extract unique restaurants for empty-query view
    const uniqueRestaurants = useMemo(() => {
        const map = new Map();
        processedResults.forEach(item => {
            const b = item.restaurant;
            if (b && !map.has(b.id)) {
                map.set(b.id, {
                    ...b,
                    distanceKm: item.distanceKm
                });
            }
        });
        return Array.from(map.values());
    }, [processedResults]);

    // Group results by restaurant for search-query view
    const groupedResults = useMemo(() => {
        const map = new Map();
        processedResults.forEach(item => {
            if (!item.dish) return;
            const b = item.restaurant;
            if (!b) return;

            if (!map.has(b.id)) {
                map.set(b.id, {
                    restaurant: b,
                    distanceKm: item.distanceKm,
                    dishes: []
                });
            }
            map.get(b.id).dishes.push(item);
        });
        return Array.from(map.values());
    }, [processedResults]);

    // Format and trigger WhatsApp Ordering redirection
    const handleCheckout = () => {
        if (!cartBusiness || totalCartItems === 0) return;

        const cartText = Object.values(cart)
            .map((item) => `• *${item.dish.name}* x${item.qty} (₹${item.dish.price * item.qty})`)
            .join('\n');

        const cartItemsCode = Object.values(cart)
            .map((item) => `${item.dish.id}:${item.qty}`)
            .join(',');

        const message = `Hi! I want to order from *${cartBusiness.name}* via ServiZephyr:\n\n${cartText}\n\n*Total Items:* ${totalCartItems}\n*Estimated Bill:* ₹${totalCartPrice}\n\nPlease verify and send me the payment link! 🛒✨\n\n(SZCART:${cartItemsCode})`;

        const whatsappNumber = formatWhatsAppNumber(cartBusiness.botDisplayNumber || cartBusiness.phone);
        const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

        trackClick(cartBusiness.id, cartBusiness.type, 'searchCount');
        window.open(url, '_blank');
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 font-sans pb-24 transition-colors duration-200">
            {/* Top Navigation / Search Bar Header */}
            <header className="sticky top-0 z-40 bg-white/80 border-b border-slate-200 dark:bg-slate-950/80 dark:border-slate-800 backdrop-blur-md px-4 py-3">
                <div className="max-w-md mx-auto">
                    <div className="flex items-center gap-2">
                        <form onSubmit={handleSearchSubmit} className="flex-grow flex gap-2">
                            <div className="relative flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search for dishes, cuisines..."
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    className="w-full bg-slate-100 border border-slate-200 dark:bg-slate-900 dark:border-slate-750 rounded-full py-2.5 pl-10 pr-4 text-slate-900 placeholder-slate-500 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm shadow-inner"
                                />
                            </div>
                            <button
                                type="submit"
                                className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-bold px-5 rounded-full text-sm transition-all shadow-md shadow-emerald-500/25 flex items-center justify-center"
                            >
                                Search
                            </button>
                        </form>
                        {themeMounted && (
                            <button
                                onClick={toggleTheme}
                                className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-300 bg-slate-100 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all active:scale-90 flex-shrink-0"
                                aria-label="Toggle Theme"
                                type="button"
                            >
                                {(resolvedTheme || theme) === 'dark' ? (
                                    <Sun className="h-4.5 w-4.5 text-yellow-400 fill-yellow-400/25" />
                                ) : (
                                    <Moon className="h-4.5 w-4.5 text-indigo-600 fill-indigo-600/10" />
                                )}
                            </button>
                        )}
                    </div>

                    {/* Geolocation indicator */}
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400 px-2">
                        <div className="flex items-center gap-1">
                            <MapPin className={`h-3.5 w-3.5 ${gpsStatus === 'granted' ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
                            {gpsStatus === 'detecting' && <span>Pinpointing location...</span>}
                            {gpsStatus === 'granted' && <span>Location Active</span>}
                            {gpsStatus === 'denied' && <span className="text-yellow-500 font-medium">Location Disabled (Sorting Standard)</span>}
                            {gpsStatus === 'idle' && <span>Location status idle</span>}
                        </div>
                        {gpsStatus !== 'granted' && (
                            <button
                                onClick={requestLocation}
                                className="text-emerald-400 hover:underline flex items-center gap-0.5 font-medium"
                            >
                                <Compass className="h-3.5 w-3.5" /> Enable GPS
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 mt-4">
                {/* Filters Sticky Bar */}
                <div className="sticky top-[68px] z-30 bg-slate-50/90 dark:bg-slate-900/90 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 gap-2 mb-4 backdrop-blur-md">
                    <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-full border border-slate-200/60 dark:border-slate-850 text-xs">
                        <button
                            onClick={() => { setFilter('nearest'); setPage(1); }}
                            className={`px-3.5 py-1.5 rounded-full font-medium transition-all ${filter === 'nearest' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                        >
                            Nearest
                        </button>
                        <button
                            onClick={() => { setFilter('cheapest'); setPage(1); }}
                            className={`px-3.5 py-1.5 rounded-full font-medium transition-all ${filter === 'cheapest' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                        >
                            Cheapest
                        </button>
                        <button
                            onClick={() => { setFilter('cheapest-nearest'); setPage(1); }}
                            className={`px-3.5 py-1.5 rounded-full font-medium transition-all ${filter === 'cheapest-nearest' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                            title="Sorts by distance weight + price weight"
                        >
                            Cheapest-Nearest
                        </button>
                    </div>

                    <button
                        onClick={() => { setVegOnly(prev => !prev); setPage(1); }}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all ${vegOnly ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-250 dark:border-emerald-500 text-emerald-600 dark:text-emerald-300' : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900'}`}
                    >
                        <span className={`h-2.5 w-2.5 rounded-full ${vegOnly ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-400 dark:bg-slate-600'}`} />
                        Veg Only
                    </button>
                </div>

                {/* Loading State */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                        <span className="text-sm font-medium">Cooking up the best matches...</span>
                    </div>
                )}

                {/* Empty State */}
                {!loading && processedResults.length === 0 && (
                    <div className="text-center py-16 px-4 bg-white dark:bg-slate-950/45 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-3" />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-1">
                            {query ? "No Dishes Found" : "No Dishes Available"}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                            {query 
                                ? `We couldn't find any active dishes matching "${query}". Try searching for "Biryani", "Chai", or "Dosa".`
                                : "No active dishes or restaurants are currently onboarded in this region. If you are a restaurant owner, onboard your business and add dishes to start receiving orders!"
                            }
                        </p>
                    </div>
                )}

                {/* Empty query view: Show unique restaurants */}
                {!loading && !query && uniqueRestaurants.length > 0 && (
                    <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5 px-1">
                            <Sparkles className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 fill-emerald-500 dark:fill-emerald-400" />
                            Outlets near you
                        </div>
                        <div className="space-y-3">
                            {uniqueRestaurants.map((restaurant) => {
                                const isClaimed = restaurant.isClaimed === true;
                                const displayType = restaurant.type === 'street-vendor' ? 'Street Vendor' : (restaurant.type === 'store' ? 'Local Store' : 'Restaurant');

                                return (
                                    <div
                                        key={restaurant.id}
                                        className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all rounded-2xl p-5 shadow-sm flex justify-between items-start gap-4"
                                    >
                                        <div className="flex-grow min-w-0">
                                            {/* Header */}
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                    restaurant.type === 'street-vendor' 
                                                        ? 'bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-400' 
                                                        : (restaurant.type === 'store' ? 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400')
                                                }`}>
                                                    {displayType}
                                                </span>
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                    isClaimed 
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400' 
                                                        : 'bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900/60 text-yellow-600 dark:text-yellow-500'
                                                }`}>
                                                    {isClaimed ? 'Ordering Active' : 'Catalog Only'}
                                                </span>
                                            </div>

                                            {/* Restaurant Name */}
                                            <Link
                                                href={`/restaurant/${restaurant.id}`}
                                                onClick={() => trackClick(restaurant.id, restaurant.type, 'profileViewCount')}
                                                className="text-base font-black text-slate-900 dark:text-slate-100 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors inline-block"
                                            >
                                                {restaurant.name}
                                            </Link>

                                            {/* Timings & Distance */}
                                            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                <span>🕒 {restaurant.openingTime} - {restaurant.closingTime}</span>
                                                {restaurant.distanceKm !== null && (
                                                    <span className="flex items-center gap-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                                                        📍 {restaurant.distanceKm < 1 ? `${Math.round(restaurant.distanceKm * 1000)} m` : `${restaurant.distanceKm} km`}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Address */}
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs truncate">
                                                {restaurant.address}
                                            </p>
                                        </div>

                                        {/* Action CTA */}
                                        <div className="flex-shrink-0 flex flex-col gap-2 items-end">
                                            {isClaimed ? (
                                                <Link
                                                    href={`/restaurant/${restaurant.id}`}
                                                    onClick={() => trackClick(restaurant.id, restaurant.type, 'profileViewCount')}
                                                    className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-black text-xs h-9 px-4 rounded-full transition-all flex items-center justify-center shadow-md shadow-emerald-500/15"
                                                >
                                                    Order Now
                                                </Link>
                                            ) : (
                                                <div className="flex flex-col gap-1.5 items-end">
                                                    <Link
                                                        href={`/restaurant/${restaurant.id}`}
                                                        onClick={() => trackClick(restaurant.id, restaurant.type, 'profileViewCount')}
                                                        className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 font-bold text-xs h-9 px-4 rounded-full transition-all flex items-center justify-center border border-slate-200 dark:border-slate-700"
                                                    >
                                                        View Restaurant
                                                    </Link>
                                                    
                                                    {/* Fast Call/Navigate items */}
                                                    <div className="flex gap-1">
                                                        {restaurant.phone && (
                                                            <a
                                                                href={`tel:${restaurant.phone}`}
                                                                onClick={() => trackClick(restaurant.id, restaurant.type, 'searchCount')}
                                                                className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 transition-colors"
                                                                title="Call"
                                                            >
                                                                <Phone className="h-3 w-3" />
                                                            </a>
                                                        )}
                                                        {restaurant.coordinates?.lat && restaurant.coordinates?.lng && (
                                                            <a
                                                                href={`https://www.google.com/maps/search/?api=1&query=${restaurant.coordinates.lat},${restaurant.coordinates.lng}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={() => trackClick(restaurant.id, restaurant.type, 'searchCount')}
                                                                className="h-7 w-7 flex items-center justify-center bg-sky-50 hover:bg-sky-100 dark:bg-sky-950 dark:hover:bg-sky-900 border border-sky-200 dark:border-sky-800 rounded-full text-sky-600 dark:text-sky-400 transition-colors"
                                                                title="Navigate"
                                                            >
                                                                <MapIcon className="h-3 w-3" />
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Search query view: Show restaurants with their matching dishes */}
                {!loading && query && groupedResults.length > 0 && (
                    <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5 px-1">
                            Showing results for &quot;{query}&quot;
                        </div>
                        <div className="space-y-4">
                            {groupedResults.map((group) => {
                                const restaurant = group.restaurant;
                                const isClaimed = restaurant.isClaimed === true;
                                const displayType = restaurant.type === 'street-vendor' ? 'Street Vendor' : (restaurant.type === 'store' ? 'Local Store' : 'Restaurant');

                                return (
                                    <div
                                        key={restaurant.id}
                                        className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow duration-200"
                                    >
                                        {/* Restaurant Header */}
                                        <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-900 pb-3.5 gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                        restaurant.type === 'street-vendor' 
                                                            ? 'bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-400' 
                                                            : (restaurant.type === 'store' ? 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400')
                                                    }`}>
                                                        {displayType}
                                                    </span>
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                        isClaimed 
                                                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900/60 text-yellow-600 dark:text-yellow-500'
                                                    }`}>
                                                        {isClaimed ? 'Ordering Active' : 'Catalog Only'}
                                                    </span>
                                                </div>
                                                <Link
                                                    href={`/restaurant/${restaurant.id}`}
                                                    onClick={() => trackClick(restaurant.id, restaurant.type, 'profileViewCount')}
                                                    className="text-base font-black text-slate-900 dark:text-slate-100 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors inline-block"
                                                >
                                                    {restaurant.name}
                                                </Link>
                                                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    <span>🕒 {restaurant.openingTime} - {restaurant.closingTime}</span>
                                                    {group.distanceKm !== null && (
                                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                                            📍 {group.distanceKm < 1 ? `${Math.round(group.distanceKm * 1000)} m` : `${group.distanceKm} km`}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Fast buttons for calling/navigating on maps */}
                                            <div className="flex gap-1 flex-shrink-0">
                                                {restaurant.phone && (
                                                    <a
                                                        href={`tel:${restaurant.phone}`}
                                                        onClick={() => trackClick(restaurant.id, restaurant.type, 'searchCount')}
                                                        className="h-8 w-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 transition-colors"
                                                        title="Call"
                                                    >
                                                        <Phone className="h-3.5 w-3.5" />
                                                    </a>
                                                )}
                                                {restaurant.coordinates?.lat && restaurant.coordinates?.lng && (
                                                    <a
                                                        href={`https://www.google.com/maps/search/?api=1&query=${restaurant.coordinates.lat},${restaurant.coordinates.lng}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() => trackClick(restaurant.id, restaurant.type, 'searchCount')}
                                                        className="h-8 w-8 flex items-center justify-center bg-sky-50 hover:bg-sky-100 dark:bg-sky-950 dark:hover:bg-sky-900 border border-sky-200 dark:border-sky-800 rounded-full text-sky-600 dark:text-sky-400 transition-colors"
                                                        title="Navigate"
                                                    >
                                                        <MapIcon className="h-3.5 w-3.5" />
                                                    </a>
                                                )}
                                            </div>
                                        </div>

                                        {/* Matching Dishes Sub-list */}
                                        <div className="space-y-2">
                                            {group.dishes.filter(item => item.dish).map((item) => {
                                                const isInCart = cart[item.dish.id];

                                                return (
                                                    <div
                                                        key={item.dish.id}
                                                        className="bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 rounded-xl p-3 flex justify-between items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                                                    >
                                                        <div className="flex-grow min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`w-3 h-3 border flex items-center justify-center flex-shrink-0 ${item.dish.isVeg ? 'border-emerald-600' : 'border-red-600'}`}>
                                                                    <span className={`w-1 h-1 rounded-full ${item.dish.isVeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                                </span>
                                                                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                                                    {item.dish.name}
                                                                </h4>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-xs">
                                                                    ₹{item.dish.price} {item.dish.portions && item.dish.portions.length > 1 && 'onwards'}
                                                                </span>
                                                            </div>
                                                            {item.dish.portions && item.dish.portions.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-1.5 mb-1">
                                                                    {item.dish.portions.map((port, idx) => (
                                                                        <span 
                                                                            key={idx} 
                                                                            className="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold"
                                                                        >
                                                                            {port.name}: <span className="text-emerald-600 dark:text-emerald-400">₹{port.price}</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {item.dish.description && (
                                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                                                                    {item.dish.description}
                                                                </p>
                                                            )}
                                                        </div>

                                                        {/* Right side container: image & stepper stacked */}
                                                        <div className="flex-shrink-0 flex flex-col items-center gap-2">
                                                            {item.dish.imageUrl && (
                                                                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 flex-shrink-0 bg-slate-100 dark:bg-slate-900">
                                                                    <img 
                                                                        src={item.dish.imageUrl} 
                                                                        alt={item.dish.name} 
                                                                        className="object-cover w-full h-full"
                                                                        loading="lazy"
                                                                    />
                                                                </div>
                                                            )}
                                                            {isClaimed && (
                                                                <div className="w-full flex justify-center">
                                                                    {isInCart ? (
                                                                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full h-7 overflow-hidden select-none shadow-sm">
                                                                            <button
                                                                                onClick={() => handleRemoveClick(item.dish.id)}
                                                                                className="px-2 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 font-bold active:scale-90 transition-all text-xs"
                                                                            >
                                                                                -
                                                                            </button>
                                                                            <span className="px-1.5 text-[10px] font-bold text-slate-800 dark:text-slate-200">
                                                                                {isInCart.qty}
                                                                            </span>
                                                                            <button
                                                                                onClick={() => handleAddClick(item.dish, restaurant)}
                                                                                className="px-2 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 font-bold active:scale-90 transition-all text-xs"
                                                                            >
                                                                                +
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => handleAddClick(item.dish, restaurant)}
                                                                            className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-bold text-[10px] h-7 px-3.5 rounded-full transition-all shadow-sm"
                                                                        >
                                                                            Add
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Pagination Controls */}
                {!loading && totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 px-2 text-xs">
                        <button
                            onClick={() => handlePageChange(Math.max(1, page - 1))}
                            disabled={page === 1}
                            className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 px-3.5 py-1.5 rounded-md disabled:opacity-50 transition-colors font-medium"
                        >
                            Previous
                        </button>
                        <span className="text-slate-500 dark:text-slate-400 font-medium">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                            disabled={page === totalPages}
                            className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 px-3.5 py-1.5 rounded-md disabled:opacity-50 transition-colors font-medium"
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>

            {/* Bottom Sticky Cart Bar */}
            {totalCartItems > 0 && cartBusiness && (
                <div className="fixed bottom-0 left-0 right-0 z-50 bg-emerald-500 text-slate-950 max-w-md mx-auto shadow-2xl rounded-t-2xl p-4 border-t border-emerald-400 flex items-center justify-between transition-all">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm">{totalCartItems} {totalCartItems === 1 ? 'Item' : 'Items'}</span>
                            <span className="h-1 w-1 rounded-full bg-slate-950/40" />
                            <span className="font-extrabold text-sm">₹{totalCartPrice}</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-950/70 max-w-[200px] truncate leading-none mt-0.5">
                            Ordering from {cartBusiness.name}
                        </p>
                    </div>
                    <button
                        onClick={handleCheckout}
                        className="bg-slate-950 text-emerald-400 hover:bg-slate-900 active:scale-95 font-black text-xs px-5 py-3 rounded-full shadow-lg flex items-center gap-1.5 transition-all uppercase tracking-wider"
                    >
                        Order via WhatsApp <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Conflict Modal: Replacing items in cart */}
            {showConflictModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xs w-full p-5 shadow-2xl text-center">
                        <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-3" />
                        <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-base mb-1">Replace Cart Items?</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                            Your cart already contains items from <span className="text-slate-800 dark:text-slate-200 font-semibold">{cartBusiness?.name}</span>. Discard them and start a new order with <span className="text-slate-800 dark:text-slate-200 font-semibold">{pendingItem?.restaurant.name}</span>?
                        </p>
                        <div className="flex gap-2 justify-center">
                            <button
                                onClick={() => { setShowConflictModal(false); setPendingItem(null); }}
                                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-705 dark:text-slate-300 text-xs font-bold py-2 px-4 rounded-full transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmConflictResolution}
                                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-black py-2 px-4 rounded-full transition-all"
                            >
                                Replace
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
