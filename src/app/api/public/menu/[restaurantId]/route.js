
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { kv } from '@vercel/kv';

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const firestore = await getFirestore();

    if (!restaurantId) {
        return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    console.log(`[Menu API] 🚀 START - Request received for restaurantId: ${restaurantId} at ${new Date().toISOString()}`);

    // Check if Vercel KV is available (optional for local dev)
    const isKvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

    try {
        // STEP 1: Fetch restaurant/vendor doc to get menuVersion
        let businessData = null;
        let businessRef = null;
        let collectionName = '';
        let menuVersion = 1; // Default version

        const collectionsToTry = ['restaurants', 'street_vendors', 'shops'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessData = docSnap.data();
                businessRef = docRef;
                collectionName = name;
                menuVersion = businessData.menuVersion || 1; // Get version or default to 1
                break;
            }
        }

        if (!businessData) {
            console.log(`[Menu API] ❌ Business not found for ${restaurantId}`);
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        // STEP 2: Build version-based cache key
        // PATCH: Added _patch1 to force cache refresh due to Delivery Settings Migration fix (missing deliveryEnabled)
        const cacheKey = `menu:${restaurantId}:v${menuVersion}_patch1`;
        console.log(`[Menu API] 🔑 Cache key: ${cacheKey} (menuVersion: ${menuVersion})`);

        // STEP 3: Check Redis cache with version-specific key
        if (isKvAvailable) {
            const cachedData = await kv.get(cacheKey);
            if (cachedData) {
                console.log(`[Menu API] ✅ Cache HIT for ${cacheKey}`);
                return NextResponse.json(cachedData, {
                    status: 200,
                    headers: {
                        'X-Cache': 'HIT',
                        'X-Menu-Version': menuVersion.toString(),
                        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    }
                });
            }
            console.log(`[Menu API] ❌ Cache MISS - Fetching from Firestore for ${cacheKey}`);
        } else {
            console.log(`[Menu API] ⚠️ Vercel KV not configured - skipping cache for ${restaurantId}`);
        }

        // STEP 4: Cache miss - fetch from Firestore
        console.log(`[Menu API] ✅ Found business: ${businessData.name} in ${collectionName}`);
        console.log(`[Menu API] 🔍 Querying coupons with status='active' from ${collectionName}/${restaurantId}/coupons`);

        // Fetch menu, coupons, AND delivery settings in parallel
        const [menuSnap, couponsSnap, deliveryConfigSnap] = await Promise.all([
            businessRef.collection('menu').get(),
            businessRef.collection('coupons').where('status', '==', 'active').get(),
            businessRef.collection('delivery_settings').doc('config').get()
        ]);

        console.log(`[Menu API] 📊 Coupons query returned ${couponsSnap.size} documents`);

        // Check delivery settings
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
        console.log(`[Menu API] 🚚 Delivery Config found: ${deliveryConfigSnap.exists}`, deliveryConfigSnap.exists ? deliveryConfig : '(using legacy/defaults)');

        let menuData = {};
        // FETCH CUSTOM CATEGORIES FROM SUB-COLLECTION
        const customCatSnap = await businessRef.collection('custom_categories').orderBy('order', 'asc').get();
        const customCategories = customCatSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
        const allCategories = { ...(businessType === 'restaurant' || businessType === 'street-vendor' ? restaurantCategoryConfig : shopCategoryConfig) };
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

        // Sort items by order field
        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        // Process coupons
        const now = new Date();
        console.log('[Menu API] Fetched', couponsSnap.size, 'coupons with status=active');
        console.log('[Menu API] Current time:', now);

        const coupons = couponsSnap.docs
            .map(doc => {
                const couponData = { id: doc.id, ...doc.data() };
                console.log('[Menu API] Coupon:', couponData.code, 'startDate:', couponData.startDate, 'expiryDate:', couponData.expiryDate);
                return couponData;
            })
            .filter(coupon => {
                const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
                const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
                const isPublic = !coupon.customerId;
                const isValid = startDate <= now && expiryDate >= now;

                console.log('[Menu API] Coupon', coupon.code, '- valid:', isValid, 'public:', isPublic, 'start:', startDate, 'expiry:', expiryDate);

                return isValid && isPublic; // Only public coupons in cache
            });

        console.log('[Menu API] Final coupons count:', coupons.length);

        const responseData = {
            restaurantName: businessData.name,
            approvalStatus: businessData.approvalStatus || 'approved',
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            // MERGED DELIVERY SETTINGS (Sub-collection takes precedence => fallback to legacy)
            deliveryCharge: deliveryConfigSnap.exists ? deliveryConfig.deliveryCharge : businessData.deliveryCharge,
            deliveryFreeThreshold: deliveryConfigSnap.exists ? deliveryConfig.freeDeliveryThreshold : businessData.deliveryFreeThreshold,
            minOrderValue: deliveryConfigSnap.exists ? deliveryConfig.minOrderValue : businessData.minOrderValue,
            menu: menuData,
            coupons: coupons,
            loyaltyPoints: 0, // User-specific data removed for better caching
            // MERGED DELIVERY ENABLED STATUS
            deliveryEnabled: deliveryConfigSnap.exists ? deliveryConfig.deliveryEnabled : businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            dineInModel: businessData.dineInModel,
            isOpen: businessData.isOpen === true,
        };

        // STEP 5: Cache with version-based key and 12-hour TTL
        if (isKvAvailable) {
            kv.set(cacheKey, responseData, { ex: 43200 }) // 12 hours = 43200 seconds
                .then(() => console.log(`[Menu API] ✅ Cached as ${cacheKey} (TTL: 12 hours)`))
                .catch(cacheError => console.error('[Menu API] ❌ Cache storage failed:', cacheError));
        }

        // Return with no-cache headers to prevent browser caching
        return NextResponse.json(responseData, {
            status: 200,
            headers: {
                'X-Cache': 'MISS',
                'X-Menu-Version': menuVersion.toString(),
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

    } catch (error) {
        console.error(`[API ERROR] /api/public/menu/${restaurantId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
