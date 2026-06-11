import { getFirestore } from '@/lib/firebase-admin';
import { searchDishes } from '@/services/public/foodSearch.service';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Phone, MapPin, ExternalLink, Sparkles, ChefHat } from 'lucide-react';

export const revalidate = 43200; // 12 Hours cache lifetime

// Pre-render popular local combinations for instant crawlability
export async function generateStaticParams() {
    const popularCuisines = ['momos', 'dosa', 'biryani', 'burger', 'chai'];
    const popularCities = ['noida', 'delhi', 'gurugram', 'ghaziabad'];

    const params = [];
    for (const cuisine of popularCuisines) {
        for (const city of popularCities) {
            params.push({ cuisine, city });
        }
    }
    return params;
}

export async function generateMetadata({ params }) {
    const cuisine = params.cuisine.charAt(0).toUpperCase() + params.cuisine.slice(1);
    const city = params.city.charAt(0).toUpperCase() + params.city.slice(1);

    return {
        title: `Best ${cuisine} in ${city} | Compare Prices & Order | ServiZephyr`,
        description: `Find the cheapest and nearest ${cuisine} in ${city}. Compare menus and prices from top local outlets and order directly via WhatsApp.`,
        alternates: {
            canonical: `https://servizephyr.com/search/cuisine/${params.cuisine}/${params.city}`,
        }
    };
}

function formatWhatsAppNumber(phone) {
    let cleaned = String(phone || '').replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

export default async function CuisineCityPage({ params }) {
    const firestore = await getFirestore();
    const { cuisine, city } = params;

    // Fetch matching dishes and restaurants
    const { results } = await searchDishes(firestore, {
        query: cuisine,
        city: city,
        limit: 50
    });

    const displayCuisine = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
    const displayCity = city.charAt(0).toUpperCase() + city.slice(1);

    // Filter results to ensure exact or strong semantic match
    const matchedResults = results.filter(item => {
        if (!item.dish) return false;
        const nameLower = item.dish.name.toLowerCase();
        const descLower = item.dish.description.toLowerCase();
        return nameLower.includes(cuisine.toLowerCase()) || descLower.includes(cuisine.toLowerCase());
    });

    // Calculate Price Aggregates
    const prices = matchedResults.map(r => r.dish.price);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

    // Generate JSON-LD Schema
    const schemaJson = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": `Best ${displayCuisine} in ${displayCity}`,
        "description": `Compare prices and order from ${matchedResults.length} food outlets serving ${displayCuisine} in ${displayCity}.`,
        "itemListElement": matchedResults.map((item, index) => {
            const schema = {
                "@type": "ListItem",
                "position": index + 1,
                "item": {
                    "@type": "FoodEstablishment",
                    "name": item.restaurant.name,
                    "url": `https://servizephyr.com/restaurant/${item.restaurant.id}`,
                    "address": {
                        "@type": "PostalAddress",
                        "addressLocality": item.restaurant.city || displayCity,
                        "streetAddress": item.restaurant.address,
                        "addressCountry": "IN"
                    }
                }
            };
            if (item.restaurant.phone) {
                schema.item.telephone = item.restaurant.phone;
            }
            return schema;
        })
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 font-sans pb-16 transition-colors duration-200">
            {/* JSON-LD Schema */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaJson) }}
            />

            {/* Header */}
            <header className="sticky top-0 z-40 bg-white/80 border-b border-slate-200 dark:bg-slate-955/80 dark:border-slate-800 backdrop-blur-md px-4 py-4">
                <div className="max-w-md mx-auto flex items-center gap-3">
                    <Link
                        href="/search"
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                        aria-label="Back to search"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">
                            Local Food Discovery
                        </h1>
                        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                            {displayCuisine} in {displayCity}
                        </p>
                    </div>
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 mt-6 space-y-6">
                {/* Title & Market Stats */}
                <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                    <div>
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">
                            <Sparkles className="h-4 w-4 fill-emerald-500/10" /> Programmatic Directory
                        </div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 leading-tight">
                            Best {displayCuisine} in {displayCity}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                            Discover {matchedResults.length} local restaurants, vendors, and stores serving fresh {displayCuisine} in {displayCity}. Direct ordering on WhatsApp.
                        </p>
                    </div>

                    {matchedResults.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-900 text-center">
                            <div>
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Min Price</p>
                                <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">₹{minPrice}</p>
                            </div>
                            <div className="border-x border-slate-100 dark:border-slate-900">
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Average</p>
                                <p className="text-sm font-black text-slate-800 dark:text-slate-100 mt-0.5">₹{avgPrice}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Max Price</p>
                                <p className="text-sm font-black text-slate-800 dark:text-slate-100 mt-0.5">₹{maxPrice}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Empty State */}
                {matchedResults.length === 0 && (
                    <div className="text-center py-12 px-4 bg-white dark:bg-slate-950/45 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <ChefHat className="h-10 w-10 text-slate-400 mx-auto mb-3" />
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                            No {displayCuisine} Found
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                            We currently don&apos;t have any restaurants onboarded serving {displayCuisine} in {displayCity}. Check back later or browse other categories!
                        </p>
                        <Link 
                            href="/search"
                            className="inline-block mt-4 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-955 px-5 py-2 rounded-full transition-all shadow-md shadow-emerald-500/10"
                        >
                            Browse All Outlets
                        </Link>
                    </div>
                )}

                {/* Listings */}
                {matchedResults.length > 0 && (
                    <div className="space-y-4">
                        {matchedResults.map((item) => {
                            const restaurant = item.restaurant;
                            const dish = item.dish;
                            const isClaimed = restaurant.isClaimed === true;
                            const displayType = restaurant.type === 'street-vendor' ? 'Street Vendor' : (restaurant.type === 'store' ? 'Local Store' : 'Restaurant');
                            
                            // WhatsApp Order link construction
                            const whatsappNumber = formatWhatsAppNumber(restaurant.botDisplayNumber || restaurant.phone);
                            const orderMessage = `Hi! I found *${restaurant.name}* on ServiZephyr and want to order *${dish.name}* (₹${dish.price}). Please send me the order link! 🛒✨`;
                            const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(orderMessage)}`;

                            return (
                                <div
                                    key={dish.id}
                                    className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow duration-200"
                                >
                                    {/* Outlet Header */}
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
                                                className="text-base font-black text-slate-900 dark:text-slate-100 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors inline-block"
                                            >
                                                {restaurant.name}
                                            </Link>
                                            <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                <MapPin className="h-3 w-3" />
                                                <span className="truncate max-w-[200px]">{restaurant.address}</span>
                                            </div>
                                        </div>

                                        {/* Phone/Location Fast Buttons */}
                                        <div className="flex gap-1 flex-shrink-0">
                                            {restaurant.phone && (
                                                <a
                                                    href={`tel:${restaurant.phone}`}
                                                    className="h-8 w-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 transition-colors"
                                                    title="Call"
                                                >
                                                    <Phone className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                        </div>
                                    </div>

                                    {/* Dish Information */}
                                    <div className="bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 rounded-xl p-3 flex justify-between items-center gap-4">
                                        <div className="flex-grow min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`w-3.5 h-3.5 border flex items-center justify-center flex-shrink-0 ${dish.isVeg ? 'border-emerald-600' : 'border-red-600'}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${dish.isVeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                </span>
                                                <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                                    {dish.name}
                                                </h3>
                                            </div>
                                            <p className="text-emerald-600 dark:text-emerald-400 font-extrabold text-sm mt-0.5">
                                                ₹{dish.price}
                                            </p>
                                            {dish.description && (
                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                                    {dish.description}
                                                </p>
                                            )}
                                        </div>

                                        {/* Dish Image */}
                                        {dish.imageUrl && (
                                            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 flex-shrink-0 bg-slate-100 dark:bg-slate-900">
                                                <img 
                                                    src={dish.imageUrl} 
                                                    alt={dish.name} 
                                                    className="object-cover w-full h-full"
                                                    loading="lazy"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Call to Action Checkout */}
                                    <div className="flex gap-2">
                                        {isClaimed ? (
                                            <a
                                                href={waUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-slate-950 font-black text-xs py-3 px-4 rounded-full transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                                            >
                                                <MessageSquare className="h-4 w-4 fill-slate-950" /> Order via WhatsApp
                                            </a>
                                        ) : (
                                            <Link
                                                href={`/restaurant/${restaurant.id}`}
                                                className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-700 dark:text-slate-200 font-extrabold text-xs py-3 px-4 rounded-full transition-all border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1"
                                            >
                                                View Menu & Location <ExternalLink className="h-3.5 w-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
