import { notFound } from 'next/navigation';
import { getFirestore } from '@/lib/firebase-admin';
import { findBusinessById } from '@/services/business/businessService';
import { getFreshMenuSnapshot } from '@/lib/server/menuSnapshot';
import { getPublicRestaurantOverview } from '@/services/business/publicRestaurantOverview.service';
import RestaurantPageClient from './RestaurantPageClient';

// Enable Incremental Static Regeneration (ISR) to cache public page rendering
export const revalidate = 3600; // Cache pages for 1 hour

export async function generateStaticParams() {
  // We generate on-demand to keep build times extremely fast.
  return [];
}

function formatWhatsAppNumber(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  return cleaned;
}

function buildRestaurantSchema(restaurantData) {
  const { business, id, menuSnapshot } = restaurantData;
  const address = business.address || {};
  const lat = business.coordinates?.lat ?? address.latitude ?? null;
  const lng = business.coordinates?.lng ?? address.longitude ?? null;
  
  const categories = menuSnapshot?.menu?.categories || [];
  const itemsByCategory = menuSnapshot?.menu?.itemsByCategory || {};
  
  // Format Menu Sections for JSON-LD
  const menuSections = categories.map(cat => {
    const items = itemsByCategory[cat.id] || [];
    return {
      "@type": "MenuSection",
      "name": cat.title,
      "hasMenuItem": items.map(item => {
        const basePrice = item.portions?.[0]?.price ?? 0;
        return {
          "@type": "MenuItem",
          "name": item.name,
          "description": item.description || '',
          "offers": {
            "@type": "Offer",
            "price": String(basePrice),
            "priceCurrency": "INR"
          }
        };
      })
    };
  });

  const whatsappNumber = formatWhatsAppNumber(business.botDisplayNumber || business.whatsappNumber || business.ownerPhone);
  const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi! I want to order from ${business.name} on ServiZephyr.`)}`;

  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "name": business.name,
    "image": business.logoUrl || business.bannerUrls?.[0] || 'https://servizephyr.com/logo.png',
    "priceRange": "₹₹",
    "servesCuisine": Array.isArray(business.cuisines) ? business.cuisines.join(', ') : 'North Indian, Chinese, Fast Food',
    "address": {
      "@type": "PostalAddress",
      "streetAddress": address.street || 'Address details',
      "addressLocality": address.area || address.city || 'Locality',
      "addressRegion": address.state || 'State',
      "postalCode": address.postalCode || '000000',
      "addressCountry": "IN"
    },
    ...(lat && lng ? {
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": lat,
        "longitude": lng
      }
    } : {}),
    "telephone": business.phone || business.ownerPhone || '',
    "openingHoursSpecification": {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
      ],
      "opens": business.openingTime || '09:00',
      "closes": business.closingTime || '22:00'
    },
    "hasMenu": {
      "@type": "Menu",
      "name": `${business.name} Menu`,
      "hasMenuSection": menuSections
    },
    "potentialAction": {
      "@type": "OrderAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": waUrl,
        "inLanguage": "en",
        "actionPlatform": [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform"
        ]
      },
      "deliveryMethod": ["http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"]
    }
  };
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const firestore = await getFirestore();
  const business = await findBusinessById(firestore, slug);
  if (!business || business.collection !== 'restaurants' || business.data.isPublished === false) {
    return {
      title: 'Restaurant Not Found | ServiZephyr',
    };
  }

  const name = business.data.name || 'Restaurant';
  const cuisines = Array.isArray(business.data.cuisines) ? business.data.cuisines.join(', ') : 'Multi-cuisine';
  const address = business.data.address || {};
  const city = address.city || 'India';
  const description = `Order online from ${name} in ${city} with zero commission on ServiZephyr. Browse menu categories, check operational hours, and order directly on WhatsApp.`;

  return {
    title: `${name} - Order Menu Online & Timings | ServiZephyr`,
    description,
    openGraph: {
      title: `${name} Menu & Order | ServiZephyr`,
      description,
      url: `https://servizephyr.com/restaurant/${slug}`,
      siteName: 'ServiZephyr',
      images: [
        {
          url: business.data.logoUrl || business.data.bannerUrls?.[0] || 'https://servizephyr.com/logo.png',
          width: 800,
          height: 600,
          alt: `${name} Logo`,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} - Menu & WhatsApp Ordering`,
      description,
      images: [business.data.bannerUrls?.[0] || business.data.logoUrl || 'https://servizephyr.com/logo.png'],
    },
  };
}

export default async function RestaurantPage({ params }) {
  const { slug } = await params;
  const firestore = await getFirestore();
  
  const business = await findBusinessById(firestore, slug);
  if (!business || business.collection !== 'restaurants' || business.data.isPublished === false) {
    notFound();
  }

  // Get overview and insights (prep time, active rate,veg count, rating etc)
  const overview = await getPublicRestaurantOverview(firestore, business.id);

  // Fetch full structured menu snapshot
  const menuSnapshot = await getFreshMenuSnapshot({
    firestore,
    businessId: business.id,
    businessRef: business.ref,
    businessData: business.data,
    collectionNameHint: business.collection,
    allowInlineRebuild: true,
  });

  if (!menuSnapshot) {
    notFound();
  }

  const restaurantData = {
    business: {
      id: business.id,
      slug: business.data.slug || slug || '',
      merchantId: business.data.merchantId || '',
      name: business.data.name || '',
      logoUrl: business.data.logoUrl || '',
      bannerUrls: business.data.bannerUrls || [],
      address: business.data.address || {},
      cuisines: business.data.cuisines || [],
      openingTime: business.data.openingTime || '09:00',
      closingTime: business.data.closingTime || '22:00',
      phone: business.data.phone || '',
      ownerPhone: business.data.ownerPhone || '',
      whatsappNumber: business.data.whatsappNumber || '',
      botDisplayNumber: business.data.botDisplayNumber || '',
      description: business.data.description || '',
    },
    id: business.id,
    overview,
    menuSnapshot,
  };

  const schemaJson = buildRestaurantSchema(restaurantData);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaJson) }}
      />
      <RestaurantPageClient restaurantData={JSON.parse(JSON.stringify(restaurantData))} />
    </>
  );
}
