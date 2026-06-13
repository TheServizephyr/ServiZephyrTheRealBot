import { getFirestore } from '@/lib/firebase-admin';
import RestaurantsListClient from './RestaurantsListClient';

export const revalidate = 3600; // ISR cache for 1 hour

export const metadata = {
  title: 'Onboarded Restaurants & Food Outlets | ServiZephyr',
  description: 'Explore the top-rated local restaurants and street food vendors onboarded on ServiZephyr. Browse menu online, check operational hours, and order directly on WhatsApp.',
  openGraph: {
    title: 'Top Local Restaurants - Order Online | ServiZephyr',
    description: 'Explore local restaurants and street food outlets onboarded on ServiZephyr. Check menus, active ratings, and order zero commission on WhatsApp.',
    url: 'https://servizephyr.com/restaurants',
    type: 'website',
  }
};

export default async function RestaurantsPage() {
  const firestore = await getFirestore();
  let restaurants = [];

  try {
    const [restoSnap, vendorSnap] = await Promise.all([
      firestore.collection('restaurants').get(),
      firestore.collection('street_vendors').get()
    ]);

    const mappedRestaurants = restoSnap.docs
      .filter(doc => {
        const data = doc.data() || {};
        return data.isPublished !== false && data.businessType !== 'shop' && data.businessType !== 'store';
      })
      .map(doc => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          name: data.name || '',
          slug: data.slug || doc.id,
          description: data.description || '',
          logoUrl: data.logoUrl || '',
          bannerUrls: data.bannerUrls || [],
          cuisines: data.cuisines || [],
          address: data.address || {},
          openingTime: data.openingTime || '09:00',
          closingTime: data.closingTime || '22:00',
          rating: data.rating || '4.2',
          phone: data.phone || '',
          botDisplayNumber: data.botDisplayNumber || '',
          whatsappNumber: data.whatsappNumber || '',
          ownerPhone: data.ownerPhone || '',
          isClosed: data.isOpen === false,
        };
      });

    const mappedVendors = vendorSnap.docs
      .filter(doc => {
        const data = doc.data() || {};
        return data.isPublished !== false && data.businessType !== 'shop' && data.businessType !== 'store';
      })
      .map(doc => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          name: data.name || '',
          slug: data.slug || doc.id,
          description: data.description || '',
          logoUrl: data.logoUrl || '',
          bannerUrls: data.bannerUrls || [],
          cuisines: data.cuisines || [],
          address: data.address || {},
          openingTime: data.openingTime || '09:00',
          closingTime: data.closingTime || '22:00',
          rating: data.rating || '4.2',
          phone: data.phone || '',
          botDisplayNumber: data.botDisplayNumber || '',
          whatsappNumber: data.whatsappNumber || '',
          ownerPhone: data.ownerPhone || '',
          isClosed: data.isOpen === false,
        };
      });

    restaurants = [...mappedRestaurants, ...mappedVendors];
  } catch (err) {
    console.error('[Restaurants Listing] Failed to fetch published restaurants and vendors:', err);
  }

  return <RestaurantsListClient restaurants={JSON.parse(JSON.stringify(restaurants))} />;
}
