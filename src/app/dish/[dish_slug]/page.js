import { getFirestore } from '@/lib/firebase-admin';
import { searchDishes } from '@/services/public/foodSearch.service';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Phone, MapPin, ExternalLink, Sparkles, ChefHat, Info, HelpCircle } from 'lucide-react';

export const revalidate = 43200; // 12 Hours cache lifetime

const DISH_DESCRIPTIONS = {
    dosa: "Dosa is a classic, thin, and crispy South Indian crepe made from a fermented batter of rice and black lentils. It is traditionally served hot with flavorful sambar and fresh coconut chutney.",
    biryani: "Biryani is a celebration of aroma, texture, and flavor. It is a beloved mixed rice dish popular across India, slow-cooked (dum) with fragrant basmati rice, rich spices, saffron, and veggies or meat.",
    momos: "Momos are bite-sized steamed, pan-fried, or tandoori dumplings filled with seasoned vegetables or minced meat, served alongside a signature spicy red chili chutney.",
    burger: "A burger is a popular comfort food consisting of a grilled or fried patty (veg or non-veg) tucked inside soft sliced buns, topped with fresh lettuce, onions, cheese, and delicious sauces.",
    chai: "Chai is the aromatic tea that fuels India. It is brewed with fresh milk, sugar, tea leaves, and infused with spices like cardamom, crushed ginger, cloves, and black pepper.",
    pizza: "Pizza is a universally loved oven-baked flatbread topped with savory tomato sauce, melted mozzarella cheese, and a variety of colorful vegetable or meat toppings.",
    pasta: "Pasta is a classic Italian staple available in various shapes (penne, fusilli, spaghetti) tossed in delicious sauces such as creamy white sauce, tangy red tomato sauce, or green pesto.",
    paneer: "Paneer dishes feature fresh, soft cottage cheese cubes cooked in rich, creamy, and spiced tomato-onion based gravies. It is a staple of North Indian vegetarian cuisine."
};

function formatWhatsAppNumber(phone) {
    let cleaned = String(phone || '').replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

export async function generateStaticParams() {
    const popularDishes = ['dosa', 'biryani', 'momos', 'burger', 'chai', 'pizza', 'pasta', 'paneer'];
    return popularDishes.map(dish_slug => ({ dish_slug }));
}

export async function generateMetadata({ params }) {
    const dish = params.dish_slug.charAt(0).toUpperCase() + params.dish_slug.slice(1);

    return {
        title: `Average Price of ${dish} | Compare Prices & Outlets | ServiZephyr`,
        description: `What is the cost of ${dish} in your city? Compare average prices, explore popular variants, and find local street vendors and restaurants serving fresh ${dish}.`,
        alternates: {
            canonical: `https://servizephyr.com/dish/${params.dish_slug}`,
        }
    };
}

export default async function DishKnowledgePage({ params }) {
    const firestore = await getFirestore();
    const { dish_slug } = params;

    // Search for all matching menu items across all cities
    const { results } = await searchDishes(firestore, {
        query: dish_slug,
        limit: 200 // Retrieve a good sample size to build market analytics
    });

    const displayDish = dish_slug.charAt(0).toUpperCase() + dish_slug.slice(1);

    // Filter to ensure target dish word matches
    const matchedResults = results.filter(item => {
        if (!item.dish) return false;
        return item.dish.name.toLowerCase().includes(dish_slug.toLowerCase());
    });

    // 1. Group prices by City
    const cityData = {};
    matchedResults.forEach(item => {
        const city = item.restaurant.city || 'Other';
        const normCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
        if (!cityData[normCity]) {
            cityData[normCity] = [];
        }
        cityData[normCity].push(item.dish.price);
    });

    const cityAnalytics = Object.keys(cityData).map(city => {
        const prices = cityData[city];
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        return { city, min, max, avg, count: prices.length };
    }).sort((a, b) => b.count - a.count);

    // 2. Extract popular variations (top 5 unique names)
    const variationsMap = {};
    matchedResults.forEach(item => {
        const name = item.dish.name.trim();
        variationsMap[name] = (variationsMap[name] || 0) + 1;
    });
    const popularVariations = Object.keys(variationsMap)
        .map(name => ({ name, count: variationsMap[name] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // 3. Informative description
    const descriptionText = DISH_DESCRIPTIONS[dish_slug.toLowerCase()] || 
        `${displayDish} is a delicious dish prepared by local chefs and food creators, available in various styles and flavor profiles at local food outlets.`;

    // 4. Generate JSON-LD Product Schema
    const avgPriceAll = matchedResults.length > 0
        ? Math.round(matchedResults.reduce((sum, item) => sum + item.dish.price, 0) / matchedResults.length)
        : 0;

    const schemaJson = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": displayDish,
        "description": descriptionText,
        "offers": {
            "@type": "AggregateOffer",
            "priceCurrency": "INR",
            "offerCount": matchedResults.length,
            ...(matchedResults.length > 0 && {
                "lowPrice": Math.min(...matchedResults.map(r => r.dish.price)),
                "highPrice": Math.max(...matchedResults.map(r => r.dish.price))
            })
        }
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
                            Dish Knowledge Hub
                        </h1>
                        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                            Explore {displayDish}
                        </p>
                    </div>
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 mt-6 space-y-6">
                {/* What is [Dish] Section */}
                <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <Info className="h-5 w-5" />
                        <h2 className="text-base font-black text-slate-900 dark:text-slate-100">
                            What is {displayDish}?
                        </h2>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {descriptionText}
                    </p>
                </div>

                {/* Market Price Analytics */}
                <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <Sparkles className="h-5 w-5" />
                        <h2 className="text-base font-black text-slate-900 dark:text-slate-100">
                            Local Market Cost Analysis
                        </h2>
                    </div>

                    {cityAnalytics.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            No pricing data is currently available for this item.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {cityAnalytics.map((analytics) => (
                                <div key={analytics.city} className="space-y-1">
                                    <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                                        <span>{analytics.city}</span>
                                        <span>Avg: ₹{analytics.avg}</span>
                                    </div>
                                    <div className="relative h-2 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden">
                                        <div 
                                            className="absolute h-full bg-emerald-500/80 rounded-full"
                                            style={{
                                                left: `${Math.max(5, (analytics.min / 300) * 100)}%`,
                                                width: `${Math.min(90, ((analytics.max - analytics.min) / 300) * 100)}%`
                                            }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                                        <span>Min: ₹{analytics.min}</span>
                                        <span>Max: ₹{analytics.max}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Popular Variations */}
                {popularVariations.length > 0 && (
                    <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                        <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Popular Variants
                        </h2>
                        <ul className="space-y-2">
                            {popularVariations.map((variant, index) => (
                                <li key={index} className="flex justify-between items-center text-xs border-b border-slate-100 dark:border-slate-900 pb-1.5 last:border-0 last:pb-0">
                                    <span className="font-bold text-slate-800 dark:text-slate-200">{variant.name}</span>
                                    <span className="text-[10px] bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded-full text-slate-500 dark:text-slate-400">
                                        {variant.count} outlets
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Nearby Outlets serving this dish */}
                <div className="space-y-3">
                    <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Top Outlets serving {displayDish}
                    </h2>

                    {matchedResults.length === 0 ? (
                        <div className="text-center py-8 bg-white dark:bg-slate-950/45 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <ChefHat className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                No local outlets found offering this dish.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {matchedResults.slice(0, 10).map((item) => {
                                const r = item.restaurant;
                                const dish = item.dish;
                                const isClaimed = r.isClaimed === true;
                                const displayType = r.type === 'street-vendor' ? 'Street Vendor' : (r.type === 'store' ? 'Local Store' : 'Restaurant');
                                
                                const whatsappNumber = formatWhatsAppNumber(r.botDisplayNumber || r.phone);
                                const orderMessage = `Hi! I found *${r.name}* on ServiZephyr and want to order *${dish.name}* (₹${dish.price}). Please send me the order link! 🛒✨`;
                                const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(orderMessage)}`;

                                return (
                                    <div
                                        key={dish.id}
                                        className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow duration-200"
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                        r.type === 'street-vendor' 
                                                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 dark:text-amber-400' 
                                                            : (r.type === 'store' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900/50 dark:text-indigo-400' : 'bg-rose-50 text-rose-750 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 dark:text-rose-400')
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
                                                    <MapPin className="h-3 w-3" />
                                                    <span className="truncate max-w-[200px]">{r.address}</span>
                                                </div>
                                            </div>

                                            {r.phone && (
                                                <a
                                                    href={`tel:${r.phone}`}
                                                    className="h-8 w-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 transition-colors flex-shrink-0"
                                                    title="Call"
                                                >
                                                    <Phone className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                        </div>

                                        {/* Dish Item Details */}
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
                                            </div>

                                            {dish.imageUrl && (
                                                <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 flex-shrink-0 bg-slate-100 dark:bg-slate-900">
                                                    <img 
                                                        src={dish.imageUrl} 
                                                        alt={dish.name} 
                                                        className="object-cover w-full h-full"
                                                        loading="lazy"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* CTAs */}
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
                                                    href={`/restaurant/${r.id}`}
                                                    className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-700 dark:text-slate-200 font-extrabold text-xs py-3 px-4 rounded-full transition-all border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1"
                                                >
                                                    View Menu <ExternalLink className="h-3.5 w-3.5" />
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
