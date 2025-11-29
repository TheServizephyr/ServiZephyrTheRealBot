
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { kv } from '@vercel/kv';

// In-memory cache (instant access!)
const memoryCache = new Map();
const MEMORY_CACHE_TTL = 60 * 1000; // 1 minute

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const firestore = await getFirestore();

    // Cache key
    const cacheKey = `menu:${restaurantId}:${phone || 'public'}`;

    if (!restaurantId) {
        return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    try {
        // LAYER 1: Check in-memory cache (FASTEST!)
        const memCached = memoryCache.get(cacheKey);
        if (memCached && (Date.now() - memCached.timestamp) < MEMORY_CACHE_TTL) {
            console.log(`[Menu API] Memory cache HIT for ${restaurantId}`);
            return NextResponse.json(memCached.data, {
                status: 200,
                headers: {
                    'X-Cache': 'MEMORY-HIT',
                    'Cache-Control': 's-maxage=300, stale-while-revalidate=600'
                }
            });
        }

        // LAYER 2: Check Redis cache
        try {
            const cachedData = await kv.get(cacheKey);
            if (cachedData) {
                console.log(`[Menu API] Redis cache HIT for ${restaurantId}`);

                // Store in memory for next request
                memoryCache.set(cacheKey, {
                    data: cachedData,
                    timestamp: Date.now()
                });

                return NextResponse.json(cachedData, {
                    status: 200,
                    headers: {
                        'X-Cache': 'REDIS-HIT',
                        'Cache-Control': 's-maxage=300, stale-while-revalidate=600'
                    }
                });
            }
            console.log(`[Menu API] Cache MISS for ${restaurantId} - fetching from Firestore`);
        } catch (cacheError) {
            console.error('[Menu API] Redis cache check failed:', cacheError.message);
        }

        // LAYER 3: Fetch from Firestore (SLOWEST)
        let businessData = null;
        let businessRef = null;
        let collectionName = '';

        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessData = docSnap.data();
                businessRef = docRef;
                collectionName = name;
                break;
            }
        }

        if (!businessData) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        // Fetch only available menu items (faster!)
        const menuSnap = await businessRef
            .collection('menu')
            .where('isAvailable', '==', true)
            .get();
        let menuData = {};
        const customCategories = businessData.customCategories || [];

        const restaurantCategoryConfig = {
            "starters": { title: "Starters" }, "main-course": { title: "Main Course" }, "beverages": { title: "Beverages" },
            "desserts": { title: "Desserts" }, "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
            "momos": { title: "Momos" }, "burgers": { title: "Burgers" }, "rolls": { title: "Rolls" },
            "tandoori-khajana": { title: "Tandoori Khajana" }, "rice": { title: "Rice" }, "noodles": { title: "Noodles" },
            "pasta": { title: "Pasta" }, "raita": { title: "Raita" },
            'snacks': { title: 'Snacks' }, 'chaat': { title: 'Chaat' }, 'sweets': { title: 'Sweets' },
        };
        const shopCategoryConfig = {
            "electronics": { title: "Electronics" }, "groceries": { title: "Groceries" }, "clothing": { title: "Clothing" },
            "books": { title: "Books" }, "home-appliances": { title: "Home Appliances" }, "toys-games": { title: "Toys & Games" },
            "beauty-personal-care": { title: "Beauty & Personal Care" }, "sports-outdoors": { title: "Sports & Outdoors" },
        };

        const businessType = businessData.businessType || collectionName.slice(0, -1);
        const baseCategories = (businessType === 'restaurant' || businessType === 'street-vendor') ? restaurantCategoryConfig : shopCategoryConfig;

        const allCategories = { ...baseCategories };
        customCategories.forEach(cat => {
            if (!allCategories[cat.id]) {
                allCategories[cat.id] = { title: cat.title };
            }
        });

        Object.keys(allCategories).forEach(key => {
            menuData[key] = [];
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (menuData[categoryKey]) {
                menuData[categoryKey].push({ id: doc.id, ...item });
            } else {
                if (!menuData['general']) menuData['general'] = [];
                menuData['general'].push({ id: doc.id, ...item });
            }
        });

        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        // Loyalty points removed - fetch at checkout instead (performance optimization)
        let loyaltyPoints = 0;
        let userId = null;

        // Coupons removed - lazy load when user clicks "Apply Coupon" (performance optimization)
        const coupons = [];

        const responseData = {
            restaurantName: businessData.name,
            approvalStatus: businessData.approvalStatus || 'approved',
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            deliveryCharge: businessData.deliveryCharge,
            deliveryFreeThreshold: businessData.deliveryFreeThreshold,
            menu: menuData,
            coupons: coupons,
            loyaltyPoints: loyaltyPoints,
            deliveryEnabled: businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            dineInModel: businessData.dineInModel,
        };

        // Store in BOTH caches
        try {
            // Memory cache (instant!)
            memoryCache.set(cacheKey, {
                data: responseData,
                timestamp: Date.now()
            });

            // Redis cache (persistent!)
            await kv.set(cacheKey, responseData, { ex: 300 });
            console.log(`[Menu API] Cached in Memory + Redis for ${restaurantId}`);
        } catch (cacheError) {
            console.error('[Menu API] Cache storage failed:', cacheError);
        }

        return NextResponse.json(responseData, {
            status: 200,
            headers: {
                'X-Cache': 'MISS',
                'Cache-Control': 's-maxage=300, stale-while-revalidate=600'
            }
        });

    } catch (error) {
        console.error(`[API ERROR] /api/public/menu/${restaurantId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
