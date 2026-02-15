'use client';

import { motion } from 'framer-motion';
import { ArrowRight, RefreshCw, ShoppingBag, Loader2, QrCode, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useState, useEffect, Suspense, useRef } from 'react';
import { useUser } from '@/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { Html5QrcodeScanner } from 'html5-qrcode';

const CUSTOMER_DASH_CACHE_TTL_MS = 3 * 60 * 1000;

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
    const [isNavigating, setIsNavigating] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [showScanner, setShowScanner] = useState(false);
    const scannerRef = useRef(null);
    const router = useRouter();


    useEffect(() => {
        const fetchHubData = async () => {
            if (user) {
                try {
                    const cacheKey = `customer_hub_v1:${user.uid}`;
                    const cachedRaw = sessionStorage.getItem(cacheKey);
                    if (cachedRaw) {
                        const parsed = JSON.parse(cachedRaw);
                        if (parsed?.ts && (Date.now() - parsed.ts) < CUSTOMER_DASH_CACHE_TTL_MS && parsed?.payload) {
                            setHubData(parsed.payload);
                            setLoading(false);
                            return;
                        }
                    }

                    setLoading(true);
                    const idToken = await user.getIdToken();
                    const res = await fetch('/api/customer/hub-data', {
                        headers: { 'Authorization': `Bearer ${idToken}` }
                    });
                    if (!res.ok) throw new Error('Failed to fetch hub data');
                    const data = await res.json();
                    setHubData(data);
                    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: data }));
                } catch (error) {
                    console.error("Error fetching hub data:", error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your hub data.' });
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

    // Initialize Scanner when showScanner becomes true
    useEffect(() => {
        if (showScanner && !scannerRef.current) {
            const scanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
                /* verbose= */ false
            );

            scanner.render(onScanSuccess, onScanFailure);
            scannerRef.current = scanner;
        }

        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(error => console.error("Failed to clear scanner", error));
                scannerRef.current = null;
            }
        };
    }, [showScanner]);

    const onScanSuccess = async (decodedText, decodedResult) => {
        // Handle the scanned code
        console.log(`Code matched = ${decodedText}`, decodedResult);

        // Stop scanning
        if (scannerRef.current) {
            scannerRef.current.clear();
            setShowScanner(false);
        }

        // Extract Vendor ID from URL
        // Expected URL format: https://servizephyr.com/order/[vendorId]
        // or just [vendorId] if we want to support direct IDs
        let vendorId = null;
        try {
            if (decodedText.includes('/order/')) {
                const parts = decodedText.split('/order/');
                if (parts.length > 1) {
                    vendorId = parts[1].split('?')[0]; // Remove any existing query params
                }
            } else {
                // Fallback: assume the text itself might be the ID if it's not a URL
                // But safer to rely on URL structure
                vendorId = decodedText;
            }

            if (vendorId) {
                await handleNavigation(vendorId);
            } else {
                setInfoDialog({ isOpen: true, title: 'Invalid QR', message: 'This QR code does not look like a valid ServiZephyr menu code.' });
            }
        } catch (err) {
            console.error("Error parsing QR:", err);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not process the QR code.' });
        }
    };

    const onScanFailure = (error) => {
        // console.warn(`Code scan error = ${error}`);
        // No need to alert on every frame failure
    };

    const handleNavigation = async (restaurantId) => {
        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Authentication Error', message: 'Please log in again to continue.' });
            return;
        }
        setIsNavigating(true);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/auth/generate-session-token', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({}) // Fix: Send empty body to prevent JSON parse error on server
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create a secure session.');

            const { phone, token } = data;
            router.push(`/order/${restaurantId}?phone=${phone}&token=${token}`);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Navigation Error', message: error.message });
            setIsNavigating(false);
        }
    };


    return (
        <>
            {isNavigating && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <Loader2 className="animate-spin text-white h-12 w-12" />
                </div>
            )}

            {/* QR Scanner Modal */}
            {showScanner && (
                <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4">
                    <div className="w-full max-w-md bg-background rounded-xl overflow-hidden relative">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 z-10"
                            onClick={() => setShowScanner(false)}
                        >
                            <X className="h-6 w-6" />
                        </Button>
                        <div className="p-4 text-center">
                            <h3 className="text-lg font-bold mb-2">Scan Menu QR</h3>
                            <p className="text-sm text-muted-foreground mb-4">Point your camera at the vendor&apos;s QR code</p>
                            <div id="reader" className="w-full"></div>
                        </div>
                    </div>
                </div>
            )}

            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="p-4 md:p-6 space-y-8"
            >
                <header className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">My Hub</h1>
                        <p className="text-muted-foreground mt-1">Your personal stats and shortcuts.</p>
                    </div>
                    <Button onClick={() => setShowScanner(true)} className="gap-2">
                        <QrCode className="h-4 w-4" />
                        Scan QR
                    </Button>
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
                                        <p className="text-lg">Time for your favorite <span className="font-bold text-foreground">&apos;{hubData.quickReorder.dishName}&apos;</span> from <span className="font-bold text-foreground">{hubData.quickReorder.restaurantName}</span>?</p>
                                        <button onClick={() => handleNavigation(hubData.quickReorder.restaurantId)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
                                            Re-order Now <ArrowRight size={16} />
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
