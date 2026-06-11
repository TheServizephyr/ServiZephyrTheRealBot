import { getFirestore } from '@/lib/firebase-admin';
import { searchDishes } from '@/services/public/foodSearch.service';
import Link from 'next/link';
import { ArrowLeft, Phone, MapPin, ExternalLink, Sparkles, ChefHat, ShieldCheck } from 'lucide-react';

export const revalidate = 43200; // 12 Hours cache lifetime

// Pre-render popular local cities for instant crawlability
export async function generateStaticParams() {
    const popularCities = ['noida', 'delhi', 'gurugram', 'ghaziabad'];
    return popularCities.map(city => ({ city }));
}

export async function generateMetadata({ params }) {
    const city = params.city.charAt(0).toUpperCase() + params.city.slice(1);

    return {
        title: `Best Food Outlets & Restaurants in ${city} | Order on WhatsApp`,
        description: `Explore top restaurants, street food vendors, and local food stores in ${city}. View phone numbers, addresses, and order directly on WhatsApp.`,
        alternates: {
            canonical: `https://servizephyr.com/search/in/${params.city}`,
        }
    };
}

export default async function CityPage({ params }) {
    const firestore = await getFirestore();
    const { city } = params;

    // Fetch outlets in the selected city
    const { results } = await searchDishes(firestore, {
        city: city,
        limit: 100 // Load up to 100 outlets for the directory page
    });

    const displayCity = city.charAt(0).toUpperCase() + city.slice(1);

    // Calculate count of each type
    const restaurantsCount = results.filter(r => r.restaurant.type === 'restaurant').length;
    const vendorsCount = results.filter(r => r.restaurant.type === 'street-vendor').length;
    const storesCount = results.filter(r => r.restaurant.type === 'store').length;

    // Generate JSON-LD Schema (ItemList of FoodEstablishments)
    const schemaJson = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": `Top Food Outlets in ${displayCity}`,
        "description": `Browse and order from ${results.length} local food businesses in ${displayCity}.`,
        "itemListElement": results.map((item, index) => {
            const r = item.restaurant;
            const schemaItem = {
                "@type": "FoodEstablishment",
                "name": r.name,
                "url": `https://servizephyr.com/restaurant/${r.id}`
            };

            // Only add address details if they exist to prevent schema warnings
            if (r.address || displayCity) {
                schemaItem.address = {
                    "@type": "PostalAddress",
                    "addressLocality": r.city || displayCity,
                    ...(r.address && { "streetAddress": r.address }),
                    "addressCountry": "IN"
                };
            }

            if (r.phone) {
                schemaItem.telephone = r.phone;
            }

            return {
                "@type": "ListItem",
                "position": index + 1,
                "item": schemaItem
            };
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
            <header className="sticky top-0 z-40 bg-white/80 border-b border-slate-200 dark:bg-slate-950/80 dark:border-slate-800 backdrop-blur-md px-4 py-4">
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
                            City Directory
                        </h1>
                        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                            Food Outlets in {displayCity}
                        </p>
                    </div>
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 mt-6 space-y-6">
                {/* Title & Market Stats */}
                <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                    <div>
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">
                            <Sparkles className="h-4 w-4 fill-emerald-500/10" /> Local Directory
                        </div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 leading-tight">
                            Explore Outlets in {displayCity}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                            Order directly via WhatsApp from local vendors, outlets, and stores in your neighborhood.
                        </p>
                    </div>

                    {results.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-900 text-center">
                            <div>
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Restaurants</p>
                                <p className="text-sm font-black text-slate-800 dark:text-slate-100 mt-0.5">{restaurantsCount}</p>
                            </div>
                            <div className="border-x border-slate-100 dark:border-slate-900">
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Street Food</p>
                                <p className="text-sm font-black text-amber-600 dark:text-amber-400 mt-0.5">{vendorsCount}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Local Stores</p>
                                <p className="text-sm font-black text-indigo-600 dark:text-indigo-400 mt-0.5">{storesCount}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Empty State */}
                {results.length === 0 && (
                    <div className="text-center py-12 px-4 bg-white dark:bg-slate-950/45 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <ChefHat className="h-10 w-10 text-slate-400 mx-auto mb-3" />
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                            No Outlets Found
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                            We currently don&apos;t have any active food businesses onboarded in {displayCity}. Check back later or browse other cities!
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
                {results.length > 0 && (
                    <div className="space-y-4">
                        {results.map((item) => {
                            const r = item.restaurant;
                            const isClaimed = r.isClaimed === true;
                            const displayType = r.type === 'street-vendor' ? 'Street Vendor' : (r.type === 'store' ? 'Local Store' : 'Restaurant');

                            return (
                                <div
                                    key={r.id}
                                    className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow duration-200"
                                >
                                    {/* Outlet Header */}
                                    <div className="flex justify-between items-start gap-3">
                                        <div className="min-w-0 flex-grow">
                                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                    r.type === 'street-vendor' 
                                                        ? 'bg-amber-55 text-amber-800 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 dark:text-amber-400' 
                                                        : (r.type === 'store' ? 'bg-indigo-50 text-indigo-750 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900/50 dark:text-indigo-400' : 'bg-rose-50 text-rose-750 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 dark:text-rose-400')
                                                }`}>
                                                    {displayType}
                                                </span>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                    isClaimed 
                                                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 dark:text-emerald-400' 
                                                        : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900/60 dark:text-yellow-550'
                                                }`}>
                                                    {isClaimed ? 'Ordering Active' : 'Catalog Only'}
                                                </span>
                                            </div>
                                            <Link
                                                href={`/restaurant/${r.id}`}
                                                className="text-base font-black text-slate-900 dark:text-slate-100 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors inline-block"
                                            >
                                                {r.name}
                                            </Link>
                                            <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                                <span className="truncate max-w-[220px]">{r.address}</span>
                                            </div>
                                        </div>

                                        {/* Phone/Location Fast Buttons */}
                                        <div className="flex gap-1 flex-shrink-0">
                                            {r.phone && (
                                                <a
                                                    href={`tel:${r.phone}`}
                                                    className="h-8 w-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 transition-colors"
                                                    title="Call"
                                                >
                                                    <Phone className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                        </div>
                                    </div>

                                    {/* Additional info: timing and WhatsApp availability */}
                                    <div className="bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 rounded-xl p-3 flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                        <div>
                                            Timing: <span className="font-bold">{r.openingTime} - {r.closingTime}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                            <span>WhatsApp Delivery</span>
                                        </div>
                                    </div>

                                    {/* Call to Action */}
                                    <div className="flex gap-2">
                                        <Link
                                            href={`/restaurant/${r.id}`}
                                            className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-slate-950 font-black text-xs py-3 px-4 rounded-full transition-all flex items-center justify-center gap-1 shadow-md shadow-emerald-500/10"
                                        >
                                            View Menu & Place Order
                                        </Link>
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
