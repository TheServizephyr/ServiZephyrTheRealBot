'use client';

import { motion } from 'framer-motion';
import { ArrowRight, RefreshCw, ShoppingBag, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState, useEffect, Suspense } from 'react';
import { useUser } from '@/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

const StatCard = ({ title, value, isLoading }) => (
    <Card>
        <CardHeader>
            <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <div className="h-9 w-3/4 bg-muted rounded-md animate-pulse"></div>
            ) : (
                <p className="text-3xl font-bold">{value}</p>
            )}
        </CardContent>
    </Card>
);

function CustomerHubContent() {
    const { user, isUserLoading } = useUser();
    const [hubData, setHubData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const router = useRouter();


    useEffect(() => {
        const fetchHubData = async () => {
            if (user) {
                setLoading(true);
                try {
                    const idToken = await user.getIdToken();
                    const res = await fetch('/api/customer/hub-data', {
                        headers: { 'Authorization': `Bearer ${idToken}` }
                    });
                    if (!res.ok) throw new Error('Failed to fetch hub data');
                    const data = await res.json();
                    setHubData(data);
                } catch (error) {
                    console.error("Error fetching hub data:", error);
                    setInfoDialog({isOpen: true, title: 'Error', message: 'Could not load your hub data.'});
                } finally {
                    setLoading(false);
                }
            } else {
                setLoading(false);
            }
        };

        if (!isUserLoading) {
            fetchHubData();
        }
    }, [user, isUserLoading]);

    const handleNavigation = async (restaurantId) => {
        if (!user) {
            setInfoDialog({isOpen: true, title: 'Authentication Error', message: 'Please log in again to continue.'});
            return;
        }
        setIsRedirecting(true);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/auth/generate-session-token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create a secure session.');
            
            const { phone, token } = data;
            router.push(`/order/${restaurantId}?phone=${phone}&token=${token}`);

        } catch (error) {
            setInfoDialog({isOpen: true, title: 'Navigation Error', message: error.message});
            setIsRedirecting(false);
        }
    };


    return (
        <>
        {isRedirecting && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-white h-12 w-12" />
            </div>
        )}
        <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message}/>
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="p-4 md:p-6 space-y-8"
        >
            <header>
                <h1 className="text-3xl font-bold tracking-tight">My Hub</h1>
                <p className="text-muted-foreground mt-1">Your personal stats and shortcuts.</p>
            </header>

            {(loading || hubData?.quickReorder) && (
                <motion.div variants={itemVariants}>
                    <Card className="bg-primary/10 border-primary/20">
                    <CardHeader>
                        <CardTitle className="text-primary flex items-center gap-2">
                            <RefreshCw size={20} /> Quick Re-Order
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                             <div className="space-y-3">
                                <div className="h-6 w-3/4 bg-muted rounded-md animate-pulse"></div>
                                <div className="h-10 w-48 bg-muted rounded-md animate-pulse"></div>
                            </div>
                        ) : hubData?.quickReorder && (
                            <>
                                <p className="text-lg">Time for your favorite <span className="font-bold text-foreground">'{hubData.quickReorder.dishName}'</span> from <span className="font-bold text-foreground">{hubData.quickReorder.restaurantName}</span>?</p>
                                <button onClick={() => handleNavigation(hubData.quickReorder.restaurantId)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
                                    Re-order Now <ArrowRight size={16}/>
                                </button>
                            </>
                        )}
                    </CardContent>
                    </Card>
                </motion.div>
            )}

            {(loading || (hubData?.myRestaurants && hubData.myRestaurants.length > 0)) && (
                <motion.div variants={itemVariants}>
                    <h2 className="text-xl font-bold mb-4">My Restaurants</h2>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                    {loading ? (
                         [...Array(5)].map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-24 text-center">
                                <div className="w-24 h-24 bg-muted rounded-full animate-pulse"></div>
                            </div>
                        ))
                    ) : (
                        hubData.myRestaurants.map(resto => (
                            <button onClick={() => handleNavigation(resto.id)} key={resto.id} className="flex-shrink-0 w-24 text-center cursor-pointer group">
                                <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center border-2 border-border group-hover:border-primary transition-colors">
                                    <span className="text-xs font-bold text-foreground text-center p-1">{resto.name}</span>
                                </div>
                            </button>
                        ))
                    )}
                    </div>
                </motion.div>
            )}

            <motion.div variants={itemVariants}>
                <h2 className="text-xl font-bold mb-4">My Stats</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard 
                        title="Total Savings this Month"
                        value={`₹${hubData?.myStats?.totalSavings.toFixed(2) || '0.00'}`}
                        isLoading={loading}
                    />
                    <StatCard 
                        title="Your Top Restaurant"
                        value={hubData?.myStats?.topRestaurant || 'N/A'}
                        isLoading={loading}
                    />
                    <StatCard 
                        title="Your Top Dish"
                        value={hubData?.myStats?.topDish || 'N/A'}
                        isLoading={loading}
                    />
                </div>
            </motion.div>

            {!loading && !hubData?.quickReorder && (
                 <motion.div 
                    variants={itemVariants} 
                    className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl"
                >
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 font-semibold">Your hub is waiting to be filled!</p>
                    <p className="text-sm">Place your first order to see your personalized stats here.</p>
                </motion.div>
            )}
        </motion.div>
        </>
    );
}

export default function CustomerHubPage() {
    return (
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <CustomerHubContent />
        </Suspense>
    )
}
