import { getFirestore } from '@/lib/firebase-admin';

export default async function sitemap() {
    const baseUrl = 'https://servizephyr.com';

    // Core static routes
    const staticRoutes = [
        '',
        '/about',
        '/contact',
        '/privacy',
        '/terms-and-conditions',
        '/join',
    ].map((route) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: route === '' ? 1 : 0.8,
    }));

    try {
        const firestore = await getFirestore();
        // Fetch published restaurants with minimum fields to optimize Firestore reads
        const snap = await firestore
            .collection('restaurants')
            .get();

        const restaurantUrls = snap.docs
            .filter(doc => doc.data()?.isPublished !== false)
            .map((doc) => {
            const data = doc.data();
            const rawSlug = data.slug || doc.id;
            const slug = rawSlug.split('/').map(encodeURIComponent).join('/');
            const lastModified = data.updatedAt?.toDate 
                ? data.updatedAt.toDate() 
                : (data.updatedAt ? new Date(data.updatedAt) : new Date());

            return {
                url: `${baseUrl}/restaurant/${slug}`,
                lastModified,
                changeFrequency: 'daily',
                priority: 0.9,
            };
        });

        // Dynamic Programmatic SEO Routes
        const popularCuisines = ['momos', 'dosa', 'biryani', 'burger', 'chai'];
        const popularCities = ['noida', 'delhi', 'gurugram', 'ghaziabad'];
        const popularDishes = ['dosa', 'biryani', 'momos', 'burger', 'chai', 'pizza', 'pasta', 'paneer'];

        const cuisineCityRoutes = [];
        for (const cuisine of popularCuisines) {
            for (const city of popularCities) {
                cuisineCityRoutes.push({
                    url: `${baseUrl}/search/cuisine/${cuisine}/${city}`,
                    lastModified: new Date(),
                    changeFrequency: 'daily',
                    priority: 0.8,
                });
            }
        }

        const cityRoutes = popularCities.map(city => ({
            url: `${baseUrl}/search/in/${city}`,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 0.8,
        }));

        const dishRoutes = popularDishes.map(dish => ({
            url: `${baseUrl}/dish/${dish}`,
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 0.7,
        }));

        return [...staticRoutes, ...cuisineCityRoutes, ...cityRoutes, ...dishRoutes, ...restaurantUrls];
    } catch (error) {
        console.error('[Sitemap] Failed to fetch dynamic restaurant slugs:', error);
        return staticRoutes;
    }
}
