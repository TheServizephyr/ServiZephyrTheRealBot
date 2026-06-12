import { getFirestore } from '@/lib/firebase-admin';
import { getBusinessCollection } from '@/services/business/businessService';
import { kv, isKvConfigured } from '@/lib/kv';

const MEMORY_TTL_MS = 5 * 60 * 1000; // L1 Memory Cache: 5 minutes
const REDIS_KEY = 'public:food-search:cache';
const REDIS_TTL_SEC = 24 * 60 * 60; // L2 Redis Cache: 24 hours

let globalSearchCache = {
    menuItems: [],
    businesses: new Map(),
    expiresAt: 0
};

let rebuildPromise = null;

/**
 * Calculates distance between two coordinates in kilometers using the Haversine formula.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const airDistance = R * c;
    const roadDistance = airDistance * 1.3; // Factor 1.3 to estimate road/driving distance
    return Number(roadDistance.toFixed(1)); // Return rounded to 1 decimal place
}

/**
 * Rebuilds the search index by pulling from Firestore.
 */
async function rebuildSearchCache(firestore, hasRedis) {
    console.log('[food-search-service] L1 & L2 cache cold. Rebuilding search cache from Firestore...');
    const startTime = Date.now();

    // 1. Fetch all published businesses from all collections
    const collections = ['restaurants', 'shops', 'street_vendors'];
    const businessesMap = new Map();

    const collectionPromises = collections.map(async (colName) => {
        try {
            const snap = await firestore.collection(colName).get();
            const docPromises = snap.docs.map(async (doc) => {
                const data = doc.data();
                
                // Allow search visibility unless explicitly unpublished
                if (data.isPublished === false) return;

                let deliveryEnabled = true;
                let deliveryRadius = 5;
                try {
                    const dsSnap = await doc.ref.collection('delivery_settings').doc('config').get();
                    if (dsSnap.exists) {
                        const dsData = dsSnap.data();
                        deliveryEnabled = dsData.deliveryEnabled ?? true;
                        deliveryRadius = Number(dsData.deliveryRadius ?? 5);
                    } else {
                        deliveryEnabled = data.deliveryEnabled ?? true;
                        deliveryRadius = Number(data.deliveryRadius ?? 5);
                    }
                } catch (err) {
                    console.warn(`[food-search-service] Failed to fetch delivery subcollection for ${doc.id}:`, err.message);
                }

                const address = data.address || data.businessAddress || {};
                const rawLat = data.coordinates?.lat ?? address.latitude ?? null;
                const rawLng = data.coordinates?.lng ?? address.longitude ?? null;
                
                let lat = null;
                let lng = null;
                
                if (rawLat !== null && rawLat !== undefined && rawLat !== '') {
                    const parsed = Number(rawLat);
                    if (!isNaN(parsed) && parsed !== 0) lat = parsed;
                }
                if (rawLng !== null && rawLng !== undefined && rawLng !== '') {
                    const parsed = Number(rawLng);
                    if (!isNaN(parsed) && parsed !== 0) lng = parsed;
                }

                businessesMap.set(doc.id, {
                    id: doc.id,
                    name: data.name || 'Unnamed Business',
                    phone: data.phone || data.ownerPhone || '',
                    isClaimed: data.isClaimed === true,
                    botDisplayNumber: data.botDisplayNumber || null,
                    coordinates: (lat !== null && lng !== null) ? { lat, lng } : null,
                    addressText: data.addressText || address.street || 'Address not available',
                    city: address.city || '',
                    type: colName === 'shops' ? 'store' : colName === 'street_vendors' ? 'street-vendor' : 'restaurant',
                    openingTime: data.openingTime || '09:00',
                    closingTime: data.closingTime || '22:00',
                    deliveryEnabled,
                    deliveryRadius,
                });
            });
            await Promise.all(docPromises);
        } catch (e) {
            console.error(`[food-search-service] Failed to fetch collection ${colName}:`, e.message || e);
        }
    });

    const menuPromise = (async () => {
        try {
            return await firestore.collectionGroup('menu').get();
        } catch (e) {
            console.error('[food-search-service] Failed collection group query:', e.message || e);
            return null;
        }
    })();

    // Run business collection fetches and menu collectionGroup fetch in parallel!
    const [_, menuSnap] = await Promise.all([
        Promise.all(collectionPromises),
        menuPromise
    ]);

    // 2. Fetch all menu items from Collection Group query
    const menuItems = [];
    if (menuSnap) {
        menuSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted === true) return;
            if (data.isAvailable === false) return; // filter in-memory to avoid index requirement

            const parentRef = doc.ref.parent.parent;
            if (!parentRef) return;
            const businessId = parentRef.id;

            // Only link to active published businesses
            const business = businessesMap.get(businessId);
            if (!business) return;

            // Parse portion pricing
            const portions = Array.isArray(data.portions) ? data.portions : [];
            let price = null;
            if (data.price !== undefined && data.price !== null && data.price !== '') {
                const parsed = Number(data.price);
                if (!isNaN(parsed)) {
                    price = parsed;
                }
            }

            if (price === null && portions.length > 0) {
                const prices = portions.map(p => Number(p.price)).filter(p => !isNaN(p));
                if (prices.length > 0) {
                    price = Math.min(...prices);
                }
            }

            if (price === null || isNaN(price)) return; // Skip if no valid price

            menuItems.push({
                id: doc.id,
                name: data.name || '',
                description: data.description || '',
                price,
                isVeg: data.isVeg === true,
                categoryId: data.categoryId || 'general',
                businessId,
                portions,
                imageUrl: data.imageUrl || '',
            });
        });
    }

    const now = Date.now();
    globalSearchCache = {
        menuItems,
        businesses: businessesMap,
        expiresAt: now + MEMORY_TTL_MS
    };

    console.log(`[food-search-service] Rebuild completed in ${Date.now() - startTime}ms. Cached ${menuItems.length} items from ${businessesMap.size} businesses.`);

    // Write to L2 Redis Cache
    if (hasRedis) {
        try {
            console.log('[food-search-service] Saving search cache to L2 Redis...');
            const serialized = {
                menuItems,
                businesses: Object.fromEntries(businessesMap),
                expiresAt: now + (REDIS_TTL_SEC * 1000)
            };
            await kv.set(REDIS_KEY, JSON.stringify(serialized), { ex: REDIS_TTL_SEC });
            console.log('[food-search-service] Saved to Redis successfully.');
        } catch (err) {
            console.error('[food-search-service] Failed to save search cache to Redis:', err.message || err);
        }
    }
}

/**
 * Returns the cached search index or rebuilds it if expired.
 */
async function getSearchCache(firestore) {
    const now = Date.now();
    
    // 1. Check L1 In-Memory Cache
    if (globalSearchCache.expiresAt && globalSearchCache.expiresAt > now) {
        return globalSearchCache;
    }

    // If a rebuild is already running, wait for it
    if (rebuildPromise) {
        console.log('[food-search-service] Rebuild in progress. Waiting for active promise...');
        await rebuildPromise;
        return globalSearchCache;
    }

    // 2. Check L2 Redis Cache
    let hasRedis = false;
    try {
        hasRedis = isKvConfigured();
    } catch (e) {
        console.warn('[food-search-service] KV check error:', e.message);
    }

    if (hasRedis) {
        try {
            console.log('[food-search-service] Checking L2 Redis Cache...');
            const cachedData = await kv.get(REDIS_KEY);
            if (cachedData) {
                const parsed = typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData;
                if (parsed && parsed.expiresAt && parsed.expiresAt > now) {
                    console.log('[food-search-service] L2 Redis cache hit. Hydrating L1 memory cache...');
                    globalSearchCache = {
                        menuItems: parsed.menuItems || [],
                        businesses: new Map(Object.entries(parsed.businesses || {})),
                        expiresAt: now + MEMORY_TTL_MS
                    };
                    return globalSearchCache;
                }
            }
        } catch (err) {
            console.error('[food-search-service] Redis read error (falling back to Firestore):', err.message || err);
        }
    }

    // 3. L1 & L2 are cold -> Run Rebuild
    rebuildPromise = rebuildSearchCache(firestore, hasRedis);
    try {
        await rebuildPromise;
    } finally {
        rebuildPromise = null;
    }

    return globalSearchCache;
}

/**
 * Calculates Levenshtein Distance (Edit Distance) between two words.
 */
function getEditDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Checks if searchWord matches targetWord using exact substring matching
 * or fuzzy spelling similarity (edit distance <= 1 for short words, <= 2 for longer ones).
 */
function isFuzzyMatch(searchWord, targetWord) {
    if (targetWord.includes(searchWord)) return true;
    if (searchWord.length < 4) return false;

    const distance = getEditDistance(searchWord, targetWord);
    // Allow edit distance of 1 for 4-letter words, and 2 for words of length >= 5
    const maxAllowedDistance = searchWord.length === 4 ? 1 : 2;

    return distance <= maxAllowedDistance;
}

/**
 * Searches food dishes using the L1 server cache, filtering and sorting by location.
 */
export async function searchDishes(firestore, { query = '', lat = null, lng = null, filter = 'nearest', page = 1, limit = 15, city = null } = {}) {
    const cache = await getSearchCache(firestore);
    const searchTerms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (searchTerms.length === 0) {
        // Return unique businesses directly
        const businesses = Array.from(cache.businesses.values());
        let outletMatches = [];

        for (const business of businesses) {
            // Filter by city if specified
            if (city && business.city?.toLowerCase() !== city.toLowerCase()) {
                continue;
            }

            let distanceKm = null;
            const coords = business.coordinates;
            const bLat = coords ? coords.lat : null;
            const bLng = coords ? coords.lng : null;

            if (lat !== null && lng !== null && bLat !== null && bLng !== null) {
                distanceKm = calculateDistance(Number(lat), Number(lng), bLat, bLng);
            }

            outletMatches.push({
                restaurant: {
                    id: business.id,
                    name: business.name,
                    phone: business.phone,
                    isClaimed: business.isClaimed,
                    botDisplayNumber: business.botDisplayNumber,
                    address: business.addressText,
                    city: business.city,
                    type: business.type,
                    coordinates: business.coordinates,
                    openingTime: business.openingTime,
                    closingTime: business.closingTime,
                    deliveryEnabled: business.deliveryEnabled,
                    deliveryRadius: business.deliveryRadius,
                },
                distanceKm,
            });
        }

        // Apply Sorting for Outlets by distance
        outletMatches.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));

        // Pagination
        const offset = (page - 1) * limit;
        const paginated = outletMatches.slice(offset, offset + limit);

        return {
            results: paginated,
            total: outletMatches.length,
            page,
            totalPages: Math.ceil(outletMatches.length / limit)
        };
    }

    let matches = [];

    // Filter menu items by keywords
    for (const item of cache.menuItems) {
        const business = cache.businesses.get(item.businessId);
        if (!business) continue;

        // Filter by city if specified
        if (city && business.city?.toLowerCase() !== city.toLowerCase()) {
            continue;
        }

        let isMatch = true;
        if (searchTerms.length > 0) {
            const nameLower = item.name.toLowerCase();
            const descLower = item.description.toLowerCase();
            const restaurantNameLower = business.name.toLowerCase();

            isMatch = searchTerms.every(term => {
                // 1. Check direct substring match first for speed
                if (nameLower.includes(term) || descLower.includes(term) || restaurantNameLower.includes(term)) {
                    return true;
                }

                // 2. Fall back to word-by-word fuzzy matching
                const targetWords = [
                    ...nameLower.split(/[\s\-_\/]+/),
                    ...descLower.split(/[\s\-_\/]+/),
                    ...restaurantNameLower.split(/[\s\-_\/]+/)
                ].filter(Boolean);

                return targetWords.some(targetWord => isFuzzyMatch(term, targetWord));
            });
        }

        if (isMatch) {
            let distanceKm = null;
            const coords = business.coordinates;
            const bLat = coords ? coords.lat : null;
            const bLng = coords ? coords.lng : null;

            if (lat !== null && lng !== null && bLat !== null && bLng !== null) {
                distanceKm = calculateDistance(Number(lat), Number(lng), bLat, bLng);
            }

            matches.push({
                dish: {
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    isVeg: item.isVeg,
                    portions: item.portions,
                    imageUrl: item.imageUrl || '',
                },
                restaurant: {
                    id: business.id,
                    name: business.name,
                    phone: business.phone,
                    isClaimed: business.isClaimed,
                    botDisplayNumber: business.botDisplayNumber,
                    address: business.addressText,
                    city: business.city,
                    type: business.type,
                    coordinates: business.coordinates,
                    openingTime: business.openingTime,
                    closingTime: business.closingTime,
                    deliveryEnabled: business.deliveryEnabled,
                    deliveryRadius: business.deliveryRadius,
                },
                distanceKm,
            });
        }
    }

    // Apply Sorting Filters
    if (filter === 'cheapest') {
        matches.sort((a, b) => a.dish.price - b.dish.price);
    } else if (filter === 'veg') {
        matches = matches.filter(m => m.dish.isVeg);
        matches.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    } else if (filter === 'cheapest-nearest') {
        // Compound sort: distance weight + price weight
        // Normalized score = (price / maxPrice) * 0.5 + (distance / maxDistance) * 0.5
        matches.sort((a, b) => {
            const distA = a.distanceKm ?? 9999;
            const distB = b.distanceKm ?? 9999;
            if (Math.abs(distA - distB) < 1.0) { // If distance difference is less than 1km, sort by price
                return a.dish.price - b.dish.price;
            }
            return distA - distB;
        });
    } else {
        // Default: nearest first
        matches.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }

    // Pagination
    const offset = (page - 1) * limit;
    const paginated = matches.slice(offset, offset + limit);

    return {
        results: paginated,
        total: matches.length,
        page,
        totalPages: Math.ceil(matches.length / limit)
    };
}

/**
 * Manually invalidates the search cache index (e.g. when menu gets mutated).
 */
export function invalidateFoodSearchCache() {
    globalSearchCache.expiresAt = 0;
    console.log('[food-search-service] Global search cache invalidated.');
    
    // Also delete Redis cache key so the next request triggers rebuild on database
    try {
        if (isKvConfigured()) {
            kv.del(REDIS_KEY).catch(err => {
                console.error('[food-search-service] Failed to delete Redis key on invalidation:', err.message);
            });
        }
    } catch (e) {
        console.warn('[food-search-service] KV check error on invalidation:', e.message);
    }
}
