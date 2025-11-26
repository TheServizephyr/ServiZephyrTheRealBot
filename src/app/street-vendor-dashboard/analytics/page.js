'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Award, AlertTriangle, Calendar, BarChart3, PieChart, Package, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function StreetVendorAnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [dateFilter, setDateFilter] = useState('This Month');
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchAnalytics();
            } else {
                router.push('/');
            }
        });
        return () => unsubscribe();
    }, [dateFilter, router]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please log in to view analytics');
            }

            const idToken = await user.getIdToken();
            const res = await fetch(`/api/owner/analytics?filter=${encodeURIComponent(dateFilter)}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Failed to fetch analytics' }));
                throw new Error(errorData.message || `HTTP ${res.status}: ${res.statusText}`);
            }
            const data = await res.json();
            setAnalyticsData(data);
        } catch (error) {
            console.error('Error fetching analytics:', error);
            setAnalyticsData({ error: error.message });
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (!analyticsData) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <p className="text-muted-foreground">No data available</p>
            </div>
        );
    }

    if (analyticsData.error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-6">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="h-8 w-8 text-destructive" />
                    </div>
                    <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Analytics</h2>
                    <p className="text-muted-foreground mb-4">{analyticsData.error}</p>
                    {analyticsData.error.includes('401') || analyticsData.error.includes('Unauthorized') ? (
                        <p className="text-sm text-muted-foreground">Please log in again to view analytics</p>
                    ) : null}
                </div>
                <Button onClick={fetchAnalytics} size="lg">Retry</Button>
            </div>
        );
    }

    const { salesData, menuPerformance } = analyticsData;
    const topPerformers = menuPerformance
        .filter(item => item.unitsSold > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    const lowPerformers = menuPerformance
        .filter(item => item.unitsSold === 0)
        .slice(0, 10);

    const bestSeller = topPerformers[0];
    const mostProfitable = menuPerformance
        .filter(item => item.unitsSold > 0)
        .sort((a, b) => b.totalProfit - a.totalProfit)[0];

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
            <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                >
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                            Analytics Dashboard
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">Track your sales and item performance</p>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2.5 border-2 border-border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
                        <Calendar className="h-5 w-5 text-primary" />
                        <select
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="bg-transparent border-none outline-none font-medium cursor-pointer text-sm md:text-base"
                        >
                            <option value="Today">Today</option>
                            <option value="This Week">This Week</option>
                            <option value="This Month">This Month</option>
                            <option value="This Year">This Year</option>
                        </select>
                    </div>
                </motion.div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
                        <Card className="border-2 hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-medium text-green-900 dark:text-green-100">Total Revenue</CardTitle>
                                    <div className="p-2 bg-green-500/10 rounded-lg">
                                        <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-green-900 dark:text-green-100">₹{salesData.kpis.totalRevenue.toFixed(2)}</div>
                                <p className={cn("text-xs flex items-center gap-1 mt-2 font-medium", salesData.kpis.revenueChange >= 0 ? "text-green-600" : "text-red-600")}>
                                    {salesData.kpis.revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {Math.abs(salesData.kpis.revenueChange).toFixed(1)}% from last period
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
                        <Card className="border-2 hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-medium text-blue-900 dark:text-blue-100">Total Orders</CardTitle>
                                    <div className="p-2 bg-blue-500/10 rounded-lg">
                                        <ShoppingBag className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{salesData.kpis.totalOrders}</div>
                                <p className={cn("text-xs flex items-center gap-1 mt-2 font-medium", salesData.kpis.ordersChange >= 0 ? "text-green-600" : "text-red-600")}>
                                    {salesData.kpis.ordersChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {Math.abs(salesData.kpis.ordersChange).toFixed(1)}% from last period
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
                        <Card className="border-2 hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 border-amber-200 dark:border-amber-800">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-medium text-amber-900 dark:text-amber-100">Best Seller</CardTitle>
                                    <div className="p-2 bg-amber-500/10 rounded-lg">
                                        <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-xl font-bold text-amber-900 dark:text-amber-100 truncate">{bestSeller?.name || 'N/A'}</div>
                                <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 font-medium">{bestSeller?.unitsSold || 0} units sold</p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }}>
                        <Card className="border-2 hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-medium text-purple-900 dark:text-purple-100">Most Profitable</CardTitle>
                                    <div className="p-2 bg-purple-500/10 rounded-lg">
                                        <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-xl font-bold text-purple-900 dark:text-purple-100 truncate">{mostProfitable?.name || 'N/A'}</div>
                                <p className="text-xs text-purple-700 dark:text-purple-300 mt-2 font-medium">₹{mostProfitable?.totalProfit?.toFixed(2) || 0} profit</p>
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Performers */}
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
                        <Card className="border-2 hover:shadow-lg transition-shadow h-full">
                            <CardHeader className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-b">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Award className="h-6 w-6 text-yellow-600" />
                                    Top Revenue Generators
                                </CardTitle>
                                <CardDescription>Items making you the most money</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                {topPerformers.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Package className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                                        <p className="text-muted-foreground font-medium">No sales data available</p>
                                        <p className="text-sm text-muted-foreground/70 mt-1">Sales will appear here once orders are completed</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {topPerformers.map((item, index) => (
                                            <motion.div
                                                key={item.id}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.6 + index * 0.1 }}
                                                className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-muted/50 to-transparent hover:from-muted hover:shadow-md transition-all"
                                            >
                                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold shadow-md">
                                                    {index + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold truncate text-sm md:text-base">{item.name}</p>
                                                    <p className="text-xs text-muted-foreground">{item.unitsSold} units</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-green-600 text-sm md:text-base">₹{item.revenue.toFixed(2)}</p>
                                                    <p className="text-xs text-muted-foreground">{((item.revenue / salesData.kpis.totalRevenue) * 100).toFixed(0)}%</p>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>

                    {/* Low Performers */}
                    {lowPerformers.length > 0 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
                            <Card className="border-2 border-orange-200 dark:border-orange-800 hover:shadow-lg transition-shadow h-full">
                                <CardHeader className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border-b">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <AlertTriangle className="h-6 w-6 text-orange-600" />
                                        Items Not Selling
                                    </CardTitle>
                                    <CardDescription>Review these items to boost sales</CardDescription>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="space-y-3">
                                        {lowPerformers.map((item, index) => (
                                            <motion.div
                                                key={item.id}
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.7 + index * 0.1 }}
                                                className="flex items-center justify-between p-3 rounded-xl bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/50 hover:shadow-md transition-all"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-orange-900 dark:text-orange-100 truncate text-sm md:text-base">{item.name}</p>
                                                    <p className="text-xs text-orange-700 dark:text-orange-300">Price: ₹{item.portions[0]?.price || 0}</p>
                                                </div>
                                                <Button variant="outline" size="sm" className="text-orange-600 border-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 flex-shrink-0 text-xs md:text-sm">
                                                    Review
                                                </Button>
                                            </motion.div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}
                </div>

                {/* Revenue Trend */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
                    <Card className="border-2 hover:shadow-lg transition-shadow">
                        <CardHeader className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-b">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <BarChart3 className="h-6 w-6 text-blue-600" />
                                Revenue Trend
                            </CardTitle>
                            <CardDescription>Daily sales performance</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {salesData.salesTrend.length === 0 ? (
                                <div className="text-center py-12">
                                    <BarChart3 className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                                    <p className="text-muted-foreground font-medium">No sales data for this period</p>
                                </div>
                            ) : (
                                <div className="h-64 flex items-end justify-around gap-1 md:gap-2">
                                    {salesData.salesTrend.map((day, index) => {
                                        const maxSales = Math.max(...salesData.salesTrend.map(d => d.sales));
                                        const height = maxSales > 0 ? (day.sales / maxSales) * 100 : 0;
                                        return (
                                            <motion.div
                                                key={day.day}
                                                initial={{ height: 0 }}
                                                animate={{ height: `${height}%` }}
                                                transition={{ delay: 0.9 + index * 0.05, duration: 0.5 }}
                                                className="flex-1 flex flex-col items-center gap-2"
                                            >
                                                <div className="w-full bg-gradient-to-t from-blue-500 to-purple-500 rounded-t-lg transition-all hover:from-blue-600 hover:to-purple-600 shadow-lg min-h-[20px] flex items-start justify-center" style={{ height: height > 0 ? '100%' : '20px' }}>
                                                    <span className="text-[10px] md:text-xs text-white font-bold p-1">₹{day.sales.toFixed(0)}</span>
                                                </div>
                                                <span className="text-[10px] md:text-xs text-muted-foreground font-medium">{day.day}</span>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Payment Methods */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}>
                    <Card className="border-2 hover:shadow-lg transition-shadow">
                        <CardHeader className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-b">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <PieChart className="h-6 w-6 text-purple-600" />
                                Payment Methods
                            </CardTitle>
                            <CardDescription>How customers are paying</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="space-y-4">
                                {salesData.paymentMethods.map((method, index) => {
                                    const total = salesData.paymentMethods.reduce((sum, m) => sum + m.value, 0);
                                    const percentage = total > 0 ? (method.value / total) * 100 : 0;
                                    return (
                                        <motion.div
                                            key={method.name}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 1.1 + index * 0.1 }}
                                        >
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="font-semibold text-sm md:text-base">{method.name}</span>
                                                <span className="text-sm text-muted-foreground font-medium">{method.value} orders ({percentage.toFixed(1)}%)</span>
                                            </div>
                                            <div className="w-full bg-muted rounded-full h-3 overflow-hidden shadow-inner">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${percentage}%` }}
                                                    transition={{ delay: 1.2 + index * 0.1, duration: 0.8 }}
                                                    className={cn(
                                                        "h-full rounded-full shadow-md transition-all",
                                                        method.name === 'Online' ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-gradient-to-r from-green-500 to-emerald-500'
                                                    )}
                                                />
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
