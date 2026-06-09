'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, MapPin, Clock, ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function RestaurantsListClient({ restaurants = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpenNow, setFilterOpenNow] = useState(false);
  const [filterTopRated, setFilterTopRated] = useState(false);
  const [selectedCuisine, setSelectedCuisine] = useState('All');

  // Derive unique cuisines from the restaurants data
  const allCuisines = useMemo(() => {
    const set = new Set();
    restaurants.forEach(r => {
      if (r.cuisines && Array.isArray(r.cuisines)) {
        r.cuisines.forEach(c => set.add(c));
      }
    });
    return ['All', ...Array.from(set).sort()];
  }, [restaurants]);

  // Helper to format time (e.g. "11:00" to "11:00 AM")
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

  // Helper to check if a restaurant is currently open based on system hours
  const isCurrentlyOpen = (openingTime, closingTime) => {
    if (!openingTime || !closingTime) return true;
    try {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeInMins = currentHours * 60 + currentMinutes;

      const [openH, openM] = openingTime.split(':').map(Number);
      const [closeH, closeM] = closingTime.split(':').map(Number);
      const openTimeInMins = openH * 60 + openM;
      const closeTimeInMins = closeH * 60 + closeM;

      if (closeTimeInMins > openTimeInMins) {
        return currentTimeInMins >= openTimeInMins && currentTimeInMins <= closeTimeInMins;
      } else {
        // Over-midnight hours
        return currentTimeInMins >= openTimeInMins || currentTimeInMins <= closeTimeInMins;
      }
    } catch {
      return true;
    }
  };

  // Process search and filters
  const filteredRestaurants = useMemo(() => {
    return restaurants.filter(r => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = r.name.toLowerCase().includes(query);
        const matchesDesc = r.description.toLowerCase().includes(query);
        const matchesCuisine = r.cuisines && r.cuisines.some(c => c.toLowerCase().includes(query));
        const matchesCity = r.address?.city?.toLowerCase().includes(query) || false;
        const matchesArea = r.address?.area?.toLowerCase().includes(query) || false;

        if (!matchesName && !matchesDesc && !matchesCuisine && !matchesCity && !matchesArea) {
          return false;
        }
      }

      // 2. Open Now Filter
      if (filterOpenNow) {
        const open = isCurrentlyOpen(r.openingTime, r.closingTime);
        if (!open) return false;
      }

      // 3. Top Rated Filter (Rating >= 4.0)
      if (filterTopRated) {
        const ratingNum = parseFloat(r.rating || '0');
        if (ratingNum < 4.0) return false;
      }

      // 4. Selected Cuisine
      if (selectedCuisine !== 'All') {
        if (!r.cuisines || !r.cuisines.includes(selectedCuisine)) return false;
      }

      return true;
    });
  }, [restaurants, searchQuery, filterOpenNow, filterTopRated, selectedCuisine]);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#FAFAFA] pb-24 font-sans">
      {/* 1. Stunning Hero Section */}
      <div className="relative overflow-hidden pt-28 pb-16 border-b border-[#1F1F27]/60">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1b1202]/30 via-transparent to-[#0e1711]/20 pointer-events-none" />
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-[#FDBA12]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />

        <div className="max-w-6xl mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex justify-center items-center gap-2 mb-4"
          >
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-[#FDBA12]/10 text-[#FDBA12] border border-[#FDBA12]/20 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Zero Commission Platform
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl md:text-6xl font-extrabold tracking-tight text-white mb-4 font-headline"
          >
            Browse & Order from <span className="text-[#FDBA12]">Local Outlets</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg text-neutral-400 max-w-2xl mx-auto mb-8 leading-relaxed"
          >
            Check out menus, operational hours, and connect directly on WhatsApp to order with zero middlemen commissions.
          </motion.p>
        </div>
      </div>

      {/* 2. Interactive Filters and Toolbar */}
      <div className="max-w-6xl mx-auto px-4 mt-10">
        <div className="bg-[#121216]/90 border border-[#1F1F27]/80 rounded-2xl p-6 shadow-xl backdrop-blur-md mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search Input */}
            <div className="relative flex-grow">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                placeholder="Search by restaurant name, cuisine, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-[#1A1A22] border border-[#2a2a35] focus:border-[#FDBA12] focus:ring-1 focus:ring-[#FDBA12] rounded-xl text-sm focus:outline-none transition-all placeholder:text-neutral-500 text-white"
              />
            </div>

            {/* Quick Toggle Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setFilterOpenNow(!filterOpenNow)}
                className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all flex items-center gap-2 ${
                  filterOpenNow
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold'
                    : 'bg-[#1A1A22] text-neutral-400 border-[#2a2a35] hover:text-white hover:bg-[#20202a]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Open Now
              </button>

              <button
                onClick={() => setFilterTopRated(!filterTopRated)}
                className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all flex items-center gap-2 ${
                  filterTopRated
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 font-bold'
                    : 'bg-[#1A1A22] text-neutral-400 border-[#2a2a35] hover:text-white hover:bg-[#20202a]'
                }`}
              >
                <Star className="w-4 h-4 fill-current text-amber-400" />
                Top Rated (4.0+)
              </button>
            </div>
          </div>

          {/* Cuisine Pill Filters */}
          {allCuisines.length > 1 && (
            <div className="mt-6 border-t border-[#1F1F27]/60 pt-4">
              <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Popular Cuisines</p>
              <div className="flex flex-wrap gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {allCuisines.map((cuisine) => (
                  <button
                    key={cuisine}
                    onClick={() => setSelectedCuisine(cuisine)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      selectedCuisine === cuisine
                        ? 'bg-[#FDBA12] text-[#121216] font-bold'
                        : 'bg-[#1A1A22] text-neutral-400 border border-[#2a2a35] hover:text-white hover:bg-[#20202a]'
                    }`}
                  >
                    {cuisine}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. Outlets Grid */}
        <AnimatePresence mode="popLayout">
          {filteredRestaurants.length === 0 ? (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#121216] border border-[#1F1F27]/80 rounded-2xl p-16 text-center max-w-xl mx-auto mt-12"
            >
              <AlertCircle className="w-12 h-12 text-[#FDBA12] mx-auto mb-4" />
              <h3 className="font-bold text-xl mb-2">No restaurants found</h3>
              <p className="text-neutral-400 text-sm mb-6">
                We couldn&apos;t find any outlets matching your search query or filters. Try adjusting your settings.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterOpenNow(false);
                  setFilterTopRated(false);
                  setSelectedCuisine('All');
                }}
                className="px-6 py-2.5 bg-[#FDBA12] text-[#121216] font-bold rounded-xl hover:bg-[#e2a60a] transition-all text-sm shadow-md"
              >
                Reset All Filters
              </button>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {filteredRestaurants.map((r) => {
                const open = isCurrentlyOpen(r.openingTime, r.closingTime);
                const addressParts = [r.address?.street, r.address?.area].filter(Boolean);
                const city = r.address?.city || '';
                const locationText = addressParts.join(', ') || 'Delhi/NCR';

                return (
                  <motion.div
                    layout
                    key={r.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="group bg-[#121216] border border-[#1F1F27]/80 rounded-2xl overflow-hidden hover:border-[#FDBA12]/40 transition-all flex flex-col justify-between shadow-lg hover:shadow-2xl"
                  >
                    {/* Header Image */}
                    <div className="relative h-44 w-full bg-[#1A1A22] overflow-hidden">
                      {r.bannerUrls?.[0] ? (
                        <Image
                          src={r.bannerUrls[0]}
                          alt={r.name}
                          fill
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-r from-amber-950/60 to-neutral-900" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-[#121216]/10 to-transparent" />

                      {/* Rating Badge */}
                      <span className="absolute top-4 right-4 px-2.5 py-1 text-xs font-black rounded-lg bg-black/75 backdrop-blur-md text-[#FDBA12] border border-[#FDBA12]/30 flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 fill-[#FDBA12] text-[#FDBA12]" />
                        {r.rating || '4.2'}
                      </span>

                      {/* Open Now Badge */}
                      <span className={`absolute top-4 left-4 px-2.5 py-1 text-[10px] font-bold rounded-lg border ${
                        open
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}>
                        {open ? 'Open Now' : 'Closed'}
                      </span>
                    </div>

                    {/* Logo & Content */}
                    <div className="p-5 flex-grow flex flex-col relative">
                      {/* Logo Overlap */}
                      <div className="absolute -top-12 left-5 w-16 h-16 rounded-xl overflow-hidden border-2 border-[#121216] bg-[#1a1a24] shadow-lg flex-shrink-0">
                        {r.logoUrl ? (
                          <Image
                            src={r.logoUrl}
                            alt={r.name}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[#FDBA12] text-[#121216] font-bold text-xl">
                            {r.name?.charAt(0)}
                          </div>
                        )}
                      </div>

                      {/* Header spacer */}
                      <div className="h-6" />

                      {/* Name & Cuisines */}
                      <div className="mb-4">
                        <h2 className="text-xl font-bold tracking-tight text-white group-hover:text-[#FDBA12] transition-colors line-clamp-1">
                          {r.name}
                        </h2>
                        {r.cuisines && r.cuisines.length > 0 && (
                          <p className="text-xs text-[#FDBA12] font-semibold mt-1">
                            {r.cuisines.slice(0, 3).join(', ')}
                          </p>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-xs text-neutral-400 mb-5 line-clamp-2 leading-relaxed flex-grow">
                        {r.description || `Fresh meals prepared fresh daily at ${r.name}. Browse menu and place your order today!`}
                      </p>

                      {/* Info lines */}
                      <div className="space-y-2.5 border-t border-[#1F1F27]/60 pt-4 text-xs text-neutral-300">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-[#FDBA12] shrink-0" />
                          <span className="truncate">{locationText}{city ? `, ${city}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
                          <span>{formatTime12h(r.openingTime)} - {formatTime12h(r.closingTime)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action button */}
                    <div className="p-5 pt-0">
                      <Link
                        href={`/restaurant/${r.slug}`}
                        className="w-full py-3 bg-[#1A1A22] group-hover:bg-[#FDBA12] text-[#FAFAFA] group-hover:text-[#121216] font-extrabold rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                      >
                        <span>Browse Menu & Order</span>
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
