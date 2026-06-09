'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, ShoppingBag, Clock, Star, MapPin, Phone, 
  MessageSquare, Plus, Minus, Check, ArrowRight, Info, 
  AlertCircle, ChevronRight, X, Heart
} from 'lucide-react';
import Image from 'next/image';

function formatWhatsAppNumber(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  return cleaned;
}

export default function RestaurantPageClient({ restaurantData }) {
  const { business, overview, menuSnapshot } = restaurantData;
  const categories = menuSnapshot?.menu?.categories || [];
  const itemsByCategory = menuSnapshot?.menu?.itemsByCategory || {};
  const hasBot = !!business.botDisplayNumber;

  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [cart, setCart] = useState({});
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id || '');
  const [likedItems, setLikedItems] = useState({});

  // Load liked items from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`liked_${business.id}`);
        if (raw) {
          setLikedItems(JSON.parse(raw));
        }
      } catch (e) {
        console.error('Failed to load liked items:', e);
      }
    }
  }, [business.id]);

  // Sync liked items to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (Object.keys(likedItems).length === 0) {
          localStorage.removeItem(`liked_${business.id}`);
          return;
        }
        localStorage.setItem(`liked_${business.id}`, JSON.stringify(likedItems));
      } catch (e) {
        console.error('Failed to save liked items:', e);
      }
    }
  }, [likedItems, business.id]);

  // 1. Load initial cart from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const keysToTry = [
          business.id && `cart_${business.id}`,
          business.slug && `cart_${business.slug}`,
          business.merchantId && `cart_${business.merchantId}`
        ].filter(Boolean);

        let raw = null;
        for (const key of keysToTry) {
          raw = localStorage.getItem(key);
          if (raw) break;
        }

        if (raw) {
          const parsed = JSON.parse(raw);
          const cartArray = parsed.cart || [];
          const initialCart = {};
          cartArray.forEach(item => {
            initialCart[item.id] = {
              id: item.id,
              name: item.name,
              price: item.totalPrice,
              qty: item.quantity,
              isVeg: item.isVeg,
              portions: item.portions
            };
          });
          setCart(initialCart);
        }
      } catch (e) {
        console.error('Failed to load cart from localStorage:', e);
      }
    }
  }, [business.id, business.slug, business.merchantId]);

  // 2. Sync cart to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const keysToSync = [
          business.id && `cart_${business.id}`,
          business.slug && `cart_${business.slug}`,
          business.merchantId && `cart_${business.merchantId}`
        ].filter(Boolean);

        const cartValues = Object.values(cart);
        if (cartValues.length === 0) {
          keysToSync.forEach(key => localStorage.removeItem(key));
          return;
        }

        const formattedCart = cartValues.map(item => ({
          id: item.id,
          name: item.name,
          totalPrice: item.price,
          price: item.price,
          quantity: item.qty,
          isVeg: item.isVeg ?? true,
          portions: item.portions || [{ name: 'Full', price: item.price }]
        }));

        const expiryTimestamp = new Date().getTime() + (24 * 60 * 60 * 1000);
        const cartData = {
          cart: formattedCart,
          notes: '',
          deliveryType: 'delivery',
          restaurantId: business.id,
          restaurantName: business.name,
          expiryTimestamp
        };

        keysToSync.forEach(key => {
          localStorage.setItem(key, JSON.stringify(cartData));
        });
      } catch (e) {
        console.error('Failed to save cart to localStorage:', e);
      }
    }
  }, [cart, business.id, business.slug, business.merchantId, business.name]);

  // Helper to format time (e.g., "11:00" to "11:00 AM")
  const formatTime12h = (timeStr) => {
    if (!timeStr) return '';
    try {
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const formattedHours = h % 12 || 12;
      return `${formattedHours}:${minutes} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  const whatsappNumber = useMemo(() => {
    return formatWhatsAppNumber(business.botDisplayNumber || business.whatsappNumber || business.ownerPhone);
  }, [business]);

  // Handle generic inquiry on WhatsApp
  const handleGeneralWhatsAppClick = () => {
    const message = `Hi! I found *${business.name}* on ServiZephyr. Please send me the online ordering link! 🍕`;
    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  // Add/Remove Cart Handlers
  const addToCart = (item) => {
    const price = item.portions?.[0]?.price ?? 0;
    setCart((prev) => {
      const existing = prev[item.id];
      return {
        ...prev,
        [item.id]: {
          id: item.id,
          name: item.name,
          price,
          qty: existing ? existing.qty + 1 : 1,
        },
      };
    });
  };

  const removeFromCart = (item) => {
    setCart((prev) => {
      const existing = prev[item.id];
      if (!existing) return prev;
      if (existing.qty === 1) {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }
      return {
        ...prev,
        [item.id]: {
          ...existing,
          qty: existing.qty - 1,
        },
      };
    });
  };

  const toggleLike = (itemId) => {
    setLikedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  // Computed Cart metrics
  const totalItems = useMemo(() => {
    return Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
  }, [cart]);

  const totalPrice = useMemo(() => {
    return Object.values(cart).reduce((sum, item) => sum + item.price * item.qty, 0);
  }, [cart]);

  // Handle checkout via WhatsApp
  const handleOrderWhatsApp = () => {
    if (totalItems === 0) return;

    const cartText = Object.values(cart)
      .map((item) => `• *${item.name}* x${item.qty} (₹${item.price * item.qty})`)
      .join('\n');

    const cartItemsCode = Object.values(cart)
      .map((item) => `${item.id}:${item.qty}`)
      .join(',');

    const message = `Hi! I want to order from *${business.name}* via ServiZephyr:\n\n${cartText}\n\n*Total Items:* ${totalItems}\n*Estimated Bill:* ₹${totalPrice}\n\nPlease verify and send me the payment link! 🛒✨\n\n(SZCART:${cartItemsCode})`;

    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  // Filter and Search menu items
  const filteredMenu = useMemo(() => {
    const result = {};
    categories.forEach((cat) => {
      let items = itemsByCategory[cat.id] || [];

      // Filter by Veg/Non-Veg
      if (vegOnly) {
        items = items.filter((item) => item.isVeg === true);
      }

      // Filter by Favorites
      if (favoritesOnly) {
        items = items.filter((item) => likedItems[item.id] === true);
      }

      // Filter by Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            (item.description && item.description.toLowerCase().includes(q))
        );
      }

      if (items.length > 0) {
        result[cat.id] = items;
      }
    });
    return result;
  }, [categories, itemsByCategory, vegOnly, searchQuery, favoritesOnly, likedItems]);

  // Scroll handler to category sections
  const scrollToCategory = (catId) => {
    setActiveCategory(catId);
    const element = document.getElementById(`category-${catId}`);
    if (element) {
      const yOffset = -120; // sticky header offset
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // Address details helper
  const addressText = useMemo(() => {
    const addr = business.address || {};
    const parts = [addr.street, addr.area, addr.city, addr.state, addr.postalCode].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  }, [business.address]);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#FAFAFA] pb-32">
      {/* 1. Header Hero Banner */}
      <div className="relative h-64 md:h-80 w-full overflow-hidden">
        {business.bannerUrls?.[0] ? (
          <Image
            src={business.bannerUrls[0]}
            alt={business.name}
            fill
            priority
            className="object-cover brightness-[0.4]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-amber-950/80 via-[#1F1400]/90 to-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-transparent to-black/40" />
      </div>

      {/* 2. Restaurant Profile Info Section */}
      <div className="max-w-6xl mx-auto px-4 -mt-16 md:-mt-24 relative z-10">
        <div className="bg-[#121216] border border-[#1F1F27]/80 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start md:items-center gap-4 md:gap-6">
              {/* Logo */}
              <div className="relative w-20 h-20 md:w-28 md:h-28 rounded-2xl overflow-hidden border-4 border-[#121216] bg-[#1a1a24] shadow-lg flex-shrink-0">
                {business.logoUrl ? (
                  <Image
                    src={business.logoUrl}
                    alt={business.name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#FDBA12] text-[#121216] font-bold text-3xl">
                    {business.name?.charAt(0)}
                  </div>
                )}
              </div>

              {/* Detail Info */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#FAFAFA]">
                    {business.name}
                  </h1>
                  {overview?.restaurant?.isOpen ? (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Open Now
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      Closed
                    </span>
                  )}
                </div>

                <p className="text-sm text-neutral-400 mb-3 max-w-xl">
                  {business.description || `Welcome to ${business.name}. Check out our fresh menu items and order online!`}
                </p>

                <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-neutral-300">
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-[#FDBA12] fill-[#FDBA12]" />
                    <span className="font-bold text-[#FAFAFA]">{overview?.restaurant?.rating?.value ?? '4.2'}</span>
                    <span className="text-neutral-500">({overview?.restaurant?.rating?.count ?? '25'}+ orders)</span>
                  </div>

                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-600 hidden sm:block" />

                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-neutral-400" />
                    <span>{formatTime12h(business.openingTime)} - {formatTime12h(business.closingTime)}</span>
                  </div>

                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-600 hidden sm:block" />

                  <div className="flex items-center gap-1">
                    <span className="text-neutral-400 font-medium">Cuisines:</span>
                    <span className="text-[#FDBA12]">
                      {business.cuisines?.length > 0 ? business.cuisines.join(', ') : 'North Indian, Fast Food'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Action Button */}
            <div className="flex flex-col sm:flex-row gap-3">
              {hasBot ? (
                <button
                  onClick={handleGeneralWhatsAppClick}
                  className="w-full sm:w-auto px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-[#121216] font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-500/10 flex items-center justify-center gap-2 group"
                >
                  <MessageSquare className="w-5 h-5 fill-current" />
                  <span>Inquire on WhatsApp</span>
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>
              ) : (
                <div className="px-4 py-2.5 rounded-xl bg-neutral-800/60 border border-neutral-700/50 text-neutral-400 text-xs font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#FDBA12] shrink-0" />
                  <span>Catalog & Menu Only</span>
                </div>
              )}
            </div>
          </div>

          <hr className="my-6 border-[#1F1F27]/80" />

          {/* Location details */}
          <div className="flex items-start gap-2.5 text-sm text-neutral-300">
            <MapPin className="w-4 h-4 text-[#FDBA12] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-neutral-200">Location</p>
              <p className="text-neutral-400 mt-0.5">{addressText}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Menu Explorer Grid */}
      <div className="max-w-6xl mx-auto px-4 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Category Sidebar (Desktop Only) */}
          <div className="hidden lg:block lg:col-span-1 self-start sticky top-24">
            <div className="bg-[#121216] border border-[#1F1F27]/80 rounded-2xl p-4">
              <h3 className="font-bold text-sm text-neutral-400 tracking-wider uppercase mb-4 px-2">
                Categories
              </h3>
              <nav className="flex flex-col gap-1.5">
                {categories.map((cat) => {
                  const hasItems = filteredMenu[cat.id]?.length > 0;
                  if (!hasItems && searchQuery) return null;

                  return (
                    <button
                      key={cat.id}
                      onClick={() => scrollToCategory(cat.id)}
                      className={`text-left w-full px-3 py-2.5 rounded-xl font-medium text-sm transition-all flex items-center justify-between ${
                        activeCategory === cat.id
                          ? 'bg-[#FDBA12]/10 text-[#FDBA12] border border-[#FDBA12]/20 font-bold'
                          : 'text-neutral-400 hover:text-[#FAFAFA] hover:bg-[#1a1a24]'
                      }`}
                    >
                      <span className="truncate">{cat.title}</span>
                      <span className="text-xs px-2 py-0.5 bg-[#1C1C24] text-neutral-400 rounded-md border border-[#2a2a38]">
                        {itemsByCategory[cat.id]?.length || 0}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Main Menu Feed */}
          <div className="lg:col-span-3">
            {!hasBot && (
              <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3 text-sm text-amber-200">
                <AlertCircle className="w-5 h-5 shrink-0 text-[#FDBA12] mt-0.5" />
                <div>
                  <h5 className="font-bold text-[#FDBA12] mb-0.5">Catalog & Menu Only</h5>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Online ordering via WhatsApp is not enabled for this outlet. You can browse their menu, view pricing, and check operational timings here. Please visit them in-person for dine-in or local billing.
                  </p>
                </div>
              </div>
            )}
            {/* Sticky Search & Filter Bar */}
            <div className="sticky top-0 bg-[#0A0A0C]/90 backdrop-blur-md z-40 py-4 flex flex-col sm:flex-row gap-4 border-b border-[#1F1F27]/60 mb-6">
              <div className="relative flex-grow">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Search dishes or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 bg-[#121216] border border-[#1F1F27]/80 focus:border-[#FDBA12] focus:ring-1 focus:ring-[#FDBA12] rounded-xl text-sm focus:outline-none transition-all placeholder:text-neutral-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setVegOnly(!vegOnly)}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center gap-2 ${
                    vegOnly
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-[#121216] text-neutral-400 border-[#1F1F27]/80 hover:text-white hover:bg-[#1a1a24]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block border border-emerald-300" />
                  Veg Only
                </button>

                <button
                  onClick={() => setFavoritesOnly(!favoritesOnly)}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center gap-2 ${
                    favoritesOnly
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : 'bg-[#121216] text-neutral-400 border-[#1F1F27]/80 hover:text-white hover:bg-[#1a1a24]'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${favoritesOnly ? 'fill-rose-400 text-rose-400' : 'text-neutral-400'}`} />
                  <span>Favorites ({Object.values(likedItems).filter(Boolean).length})</span>
                </button>
              </div>
            </div>

            {/* Menu Items List */}
            {Object.keys(filteredMenu).length === 0 ? (
              <div className="bg-[#121216] border border-[#1F1F27]/80 rounded-2xl p-12 text-center">
                {favoritesOnly ? (
                  <Heart className="w-12 h-12 text-rose-500 mx-auto mb-4 fill-rose-500/20" />
                ) : (
                  <AlertCircle className="w-12 h-12 text-[#FDBA12] mx-auto mb-4" />
                )}
                <h3 className="font-bold text-lg mb-1">
                  {favoritesOnly ? 'No favorites added' : 'No items found'}
                </h3>
                <p className="text-neutral-400 text-sm max-w-sm mx-auto">
                  {favoritesOnly 
                    ? 'Tap the heart icon on any dish to add it to your favorites so you can quickly find it later.'
                    : 'We couldn\'t find any matching dishes. Try searching for something else or clear the filters.'
                  }
                </p>
                {(searchQuery || vegOnly || favoritesOnly) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setVegOnly(false);
                      setFavoritesOnly(false);
                    }}
                    className="mt-4 px-4 py-2 bg-[#FDBA12] text-[#121216] font-bold rounded-lg hover:bg-[#e2a60a] transition-all text-sm"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-10">
                {categories.map((cat) => {
                  const items = filteredMenu[cat.id];
                  if (!items || items.length === 0) return null;

                  return (
                    <div key={cat.id} id={`category-${cat.id}`} className="scroll-mt-36">
                      <div className="flex items-center justify-between mb-4 border-b border-[#1F1F27]/40 pb-2">
                        <h2 className="text-xl font-extrabold tracking-tight text-[#FAFAFA] flex items-center gap-2">
                          {cat.title}
                          <span className="text-xs font-normal text-neutral-500">
                            ({items.length} items)
                          </span>
                        </h2>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {items.map((item) => {
                          const cartItem = cart[item.id];
                          const basePrice = item.portions?.[0]?.price ?? 0;
                          const isVeg = item.isVeg === true;

                          return (
                            <motion.div
                              layout
                              key={item.id}
                              className="bg-[#121216] border border-[#1F1F27]/80 rounded-xl p-4 flex gap-4 relative hover:border-[#FDBA12]/30 transition-all group overflow-hidden"
                            >
                              {/* Left Content */}
                              <div className="flex-grow flex flex-col justify-between min-w-0">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    {/* Veg Icon Badge */}
                                    <div
                                      className={`w-4 h-4 border flex items-center justify-center p-0.5 flex-shrink-0 ${
                                        isVeg ? 'border-emerald-500' : 'border-rose-500'
                                      }`}
                                    >
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full ${
                                          isVeg ? 'bg-emerald-500' : 'bg-rose-500'
                                        }`}
                                      />
                                    </div>

                                    {item.portions?.[0]?.name && item.portions?.[0]?.name !== 'Full' && (
                                      <span className="px-1.5 py-0.5 bg-[#1C1C24] text-[10px] text-neutral-400 rounded border border-[#2a2a38]">
                                        {item.portions[0].name}
                                      </span>
                                    )}
                                  </div>

                                  <h4 className="font-bold text-[#FAFAFA] truncate group-hover:text-[#FDBA12] transition-colors">
                                    {item.name}
                                  </h4>

                                  {item.description && (
                                    <p className="text-xs text-neutral-400 line-clamp-2 mt-1 pr-2">
                                      {item.description}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-4 flex items-center justify-between">
                                  <span className="text-base font-black text-[#FAFAFA]">
                                    ₹{basePrice}
                                  </span>
                                </div>
                              </div>
 
                              {/* Right Image/Add Button */}
                              <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-[#1A1A24] border border-[#1F1F27]/60 flex-shrink-0 self-center">
                                {item.imageUrl ? (
                                  <Image
                                    src={item.imageUrl}
                                    alt={item.name}
                                    fill
                                    className="object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1A1A24] to-[#252535]">
                                    <ShoppingBag className="w-8 h-8 text-neutral-600 opacity-40" />
                                  </div>
                                )}
 
                                {/* Like Button */}
                                <button
                                  onClick={() => toggleLike(item.id)}
                                  className="absolute top-1 right-1 p-1 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm z-10 transition-all text-neutral-400 hover:text-rose-500"
                                >
                                  <Heart
                                    className={`w-3.5 h-3.5 ${
                                      likedItems[item.id] ? 'fill-rose-500 text-rose-500' : ''
                                    }`}
                                  />
                                </button>
 
                                {/* Add to Cart overlay (Visible on both Mobile & Desktop) */}
                                {hasBot && (
                                  <div className="absolute bottom-1 right-1 left-1 bg-black/85 backdrop-blur-md border border-[#2c2c3c] rounded-md p-0.5 z-20">
                                    {cartItem ? (
                                      <div className="flex items-center justify-between text-[#FAFAFA]">
                                        <button
                                          onClick={() => removeFromCart(item)}
                                          className="p-1 hover:text-[#FDBA12] transition-colors rounded hover:bg-[#1a1a24]"
                                        >
                                          <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="text-xs font-bold">
                                          {cartItem.qty}
                                        </span>
                                        <button
                                          onClick={() => addToCart(item)}
                                          className="p-1 hover:text-[#FDBA12] transition-colors rounded hover:bg-[#1a1a24]"
                                        >
                                          <Plus className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => addToCart(item)}
                                        className="w-full py-1 text-xs font-bold text-[#FDBA12] flex items-center justify-center gap-1 hover:bg-[#1C1C24] rounded transition-all"
                                      >
                                        <Plus className="w-3 h-3" /> Add
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Interactive Bottom Cart Bar (Sticky on all screens when cart has items) */}
      <AnimatePresence>
        {totalItems > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-6 left-4 right-4 md:left-auto md:right-8 md:w-96 bg-[#121216] border border-[#FDBA12]/40 rounded-2xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#1F1F27]/60">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#FDBA12]/10 border border-[#FDBA12]/20 flex items-center justify-center text-[#FDBA12]">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#FAFAFA]">{totalItems} Item{totalItems > 1 ? 's' : ''} Added</p>
                    <p className="text-xs text-neutral-400">Order from local cart</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-neutral-400">Subtotal</p>
                  <p className="text-base font-extrabold text-[#FAFAFA]">₹{totalPrice}</p>
                </div>
              </div>

              <button
                onClick={handleOrderWhatsApp}
                className="w-full py-3.5 bg-[#FDBA12] hover:bg-[#e2a60a] text-[#121216] font-extrabold rounded-xl transition-all shadow-lg hover:shadow-[#FDBA12]/10 flex items-center justify-center gap-2 group"
              >
                <span>Order via WhatsApp</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
