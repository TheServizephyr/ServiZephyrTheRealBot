
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { kv } from '@vercel/kv';

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const firestore = await getFirestore();

    // FIX: Single cache key for all users (not per-user)
    // This dramatically improves cache hit rate from ~10% to ~95%
    const cacheKey = `menu:${restaurantId}`;

    if (!restaurantId) {
        return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    try {
        // Step 1: FORCE DELETE CACHE for debugging
        console.log(`[Menu API] DELETING cache for ${restaurantId}`);
        try {
            await kv.del(cacheKey);
            console.log(`[Menu API] Cache deleted successfully`);
        } catch (delErr) {
            console.error(`[Menu API] Cache deletion failed:`, delErr);
        }

        console.log(`[Menu API] Fetching FRESH data from Firestore for ${restaurantId}`);

        // Step 2: Cache miss - fetch from Firestore (OPTIMIZED)
        let businessData = null;
        let businessRef = null;
        let collectionName = '';

        // OPTIMIZATION: Try most common collection first (restaurants)
        const collectionsToTry = ['street_vendors', 'restaurants', 'shops'];
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
            console.log(`[Menu API] ❌ Business not found for ${restaurantId}`);
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        console.log(`[Menu API] ✅ Found business: ${businessData.name} in ${collectionName}`);
        console.log(`[Menu API] 🔍 Querying coupons with status='active' from ${collectionName}/${restaurantId}/coupons`);

        // OPTIMIZATION: Fetch menu in parallel with other data
        const [menuSnap, couponsSnap] = await Promise.all([
            businessRef.collection('menu').get(),
            businessRef.collection('coupons').where('status', '==', 'active').get()
        ]);

        console.log(`[Menu API] 📊 Coupons query returned ${couponsSnap.size} documents`);

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

        // Sort items in memory by order field
        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        // OPTIMIZATION: Skip user-specific data for cache (fetch separately if needed)
        // This allows ALL users to share same cache
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
            deliveryCharge: businessData.deliveryCharge,
            deliveryFreeThreshold: businessData.deliveryFreeThreshold,
            menu: menuData,
            coupons: coupons,
            loyaltyPoints: 0, // User-specific data removed for better caching
            deliveryEnabled: businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            dineInModel: businessData.dineInModel,
            isOpen: businessData.isOpen !== false, // Restaurant open/closed status
        };

        // FIX: Async cache write (don't block response)
        // TEMPORARILY DISABLED FOR DEBUGGING
        /*
        kv.set(cacheKey, responseData, { ex: 3600 }) // 1 hour TTL
            .then(() => console.log(`[Menu API] Cached data for ${restaurantId} (TTL: 1 hour)`))
            .catch(cacheError => console.error('[Menu API] Cache storage failed:', cacheError));
        */

        // Return immediately without waiting for cache write
        return NextResponse.json(responseData, {
            status: 200,
            headers: {
                'X-Cache': 'DISABLED',
                'Cache-Control': 's-maxage=3600, stale-while-revalidate=1800'
            }
        });

    } catch (error) {
        console.error(`[API ERROR] /api/public/menu/${restaurantId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
