
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, LayoutDashboard, MessageCircle, ShoppingCart, Utensils, Pizza, Soup, Drumstick, Salad, CakeSlice, GlassWater } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// --- MOCK DATA (will be replaced by API call) ---
const mockMenuData = {
    restaurantName: "The Curry Cloud",
    categories: {
      "starters": { title: "Starters", icon: Utensils, items: [
        { id: 's1', name: 'Paneer Tikka', description: 'Smoky, grilled cottage cheese cubes.', price: 280, isVeg: true, imageUrl: 'https://picsum.photos/seed/paneertikka/100/100' },
        { id: 's2', name: 'Chilli Chicken', description: 'Spicy chicken with peppers and onions.', price: 320, isVeg: false, imageUrl: 'https://picsum.photos/seed/chillichicken/100/100' },
        { id: 's3', name: 'Veg Manchurian Dry', description: 'Fried vegetable balls in a tangy sauce.', price: 240, isVeg: true, imageUrl: 'https://picsum.photos/seed/manchurian/100/100' },
      ]},
      "main-course": { title: "Main Course", icon: Soup, items: [
        { id: 'm1', name: 'Dal Makhani', description: 'Creamy black lentils, a house specialty.', price: 250, isVeg: true, imageUrl: 'https://picsum.photos/seed/dalmakhani/100/100' },
        { id: 'm2', name: 'Butter Chicken', description: 'Rich tomato and butter gravy with chicken.', price: 450, isVeg: false, imageUrl: 'https://picsum.photos/seed/butterchicken/100/100' },
        { id: 'm3', name: 'Kadhai Paneer', description: 'Cottage cheese in a spicy tomato-onion gravy.', price: 350, isVeg: true, imageUrl: 'https://picsum.photos/seed/kadhaipaneer/100/100' },
      ]},
      "desserts": { title: "Desserts", icon: CakeSlice, items: [
        { id: 'd1', name: 'Gulab Jamun', description: 'Sweet milk solids dumplings in syrup.', price: 120, isVeg: true, imageUrl: 'https://picsum.photos/seed/gulabjamun/100/100' },
        { id: 'd2', name: 'Moong Dal Halwa', description: 'A rich, classic Indian dessert.', price: 150, isVeg: true, imageUrl: 'https://picsum.photos/seed/halwa/100/100' },
      ]},
       "beverages": { title: "Beverages", icon: GlassWater, items: [
        { id: 'b1', name: 'Coke', description: '300ml Can', price: 60, isVeg: true, imageUrl: 'https://picsum.photos/seed/coke/100/100' },
      ]},
    },
};


// --- Sub-components for clean structure ---

const MenuItemCard = ({ item, onAddToCart }) => {
  return (
    <motion.div 
        className="flex items-start gap-4 p-4 bg-gray-800/50 rounded-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
    >
      <div className="relative w-20 h-20 rounded-md overflow-hidden bg-gray-700 flex-shrink-0">
         <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" data-ai-hint="food item" />
      </div>
      <div className="flex-grow">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-3 h-3 border-2 ${item.isVeg ? 'border-green-500' : 'border-red-500'} rounded-sm flex items-center justify-center`}>
            <div className={`w-1.5 h-1.5 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
          </div>
          <h4 className="font-semibold text-white">{item.name}</h4>
        </div>
        <p className="text-xs text-gray-400 mb-2">{item.description}</p>
        <p className="font-bold text-gray-200">₹{item.price}</p>
      </div>
      <Button 
        onClick={() => onAddToCart(item)}
        variant="outline" 
        size="sm"
        className="self-center bg-gray-700 hover:bg-indigo-600 hover:text-white border-gray-600"
      >
        ADD
      </Button>
    </motion.div>
  );
};


const OrderPage = () => {
    const params = useParams();
    const router = useRouter();
    const { restaurantId } = params;

    const [menu, setMenu] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState(null);
    const sectionRefs = useRef({});

    // TODO: Fetch real data based on restaurantId
    useEffect(() => {
        setLoading(true);
        // Simulate API call
        setTimeout(() => {
            setMenu(mockMenuData);
            const firstCategory = Object.keys(mockMenuData.categories)[0];
            setActiveCategory(firstCategory);
            // Initialize refs for each section
            Object.keys(mockMenuData.categories).forEach(key => {
                sectionRefs.current[key] = React.createRef();
            });
            setLoading(false);
        }, 1000);
    }, [restaurantId]);

    const handleAddToCart = (item) => {
        // TODO: Implement cart logic
        console.log("Added to cart:", item.name);
    };

    const handleCategoryClick = (key) => {
        setActiveCategory(key);
        const element = document.getElementById(key);
        if (element) {
            const headerOffset = 80; // height of sticky header
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: "smooth"
            });
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (!menu) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
                <p>Could not load menu for this restaurant.</p>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-gray-900 text-white">
            {/* Header */}
            <header className="sticky top-0 z-20 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-gray-400">Ordering from</p>
                        <h1 className="text-xl font-bold">{menu.restaurantName}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                         <Button variant="ghost" size="sm" onClick={() => router.push('/owner-dashboard')}>
                            <LayoutDashboard className="mr-2 h-4 w-4"/> Dashboard
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
                            <MessageCircle className="mr-2 h-4 w-4"/> Back to Bot
                        </Button>
                    </div>
                </div>
            </header>
            
            {/* Category Chips - mobile friendly */}
            <div className="sticky top-[69px] z-20 bg-gray-900/80 backdrop-blur-lg py-2 overflow-x-auto">
                 <div className="container mx-auto px-4 flex gap-2">
                     {Object.entries(menu.categories).map(([key, { title, icon: Icon }]) => (
                         <button 
                            key={key}
                            onClick={() => handleCategoryClick(key)}
                            className={cn(
                                "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors",
                                activeCategory === key 
                                ? "bg-indigo-500 text-white" 
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            )}
                         >
                            <Icon size={16} />
                            {title}
                         </button>
                     ))}
                 </div>
            </div>


            <div className="container mx-auto px-4 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                    
                    {/* Left: Categories (Hidden on mobile, kept for larger screens logic) */}
                    <aside className="hidden md:block md:col-span-3 lg:col-span-2">
                        <nav className="sticky top-24">
                            <h2 className="text-lg font-semibold mb-4">Menu</h2>
                            <ul className="space-y-2">
                                {Object.entries(menu.categories).map(([key, { title, icon: Icon }]) => (
                                    <li key={key}>
                                        <button 
                                            onClick={() => handleCategoryClick(key)}
                                            className={cn(
                                                "w-full flex items-center gap-3 p-3 rounded-lg text-sm transition-colors text-left",
                                                activeCategory === key 
                                                ? "bg-indigo-500/20 text-indigo-300 font-semibold" 
                                                : "text-gray-300 hover:bg-gray-800"
                                            )}
                                        >
                                            <Icon size={20} />
                                            {title}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    </aside>

                    {/* Middle: Menu Items */}
                    <main className="md:col-span-9 lg:col-span-7">
                        <div className="space-y-10">
                            {Object.entries(menu.categories).map(([key, { title, items }]) => (
                                <section id={key} key={key} className="pt-2 scroll-mt-20">
                                    <h3 className="text-2xl font-bold mb-4">{title}</h3>
                                    <div className="grid grid-cols-1 gap-4">
                                        {items.map(item => (
                                            <MenuItemCard key={item.id} item={item} onAddToCart={handleAddToCart} />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </main>

                    {/* Right: Cart (Placeholder) */}
                    <aside className="hidden lg:block md:col-span-3">
                         <div className="sticky top-24 bg-gray-800 rounded-xl p-5 border border-gray-700">
                             <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold">Your Order</h2>
                                <ShoppingCart size={20} />
                             </div>
                             <div className="h-48 flex items-center justify-center text-gray-500">
                                 <p>Your cart is empty</p>
                             </div>
                             <Button disabled className="w-full mt-4">View Cart</Button>
                         </div>
                    </aside>
                </div>
            </div>

             {/* Sticky Footer Cart for Mobile */}
             <footer className="sticky bottom-0 z-20 bg-gray-900/80 backdrop-blur-lg border-t border-gray-700 p-4 lg:hidden">
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700">
                    <ShoppingCart className="mr-2 h-5 w-5"/> View Your Cart (0)
                </Button>
            </footer>
        </div>
    );
};

export default OrderPage;

    