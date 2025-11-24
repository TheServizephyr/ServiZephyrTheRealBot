'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Award, AlertTriangle, Calendar, BarChart3, PieChart } from 'lucide-react';
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
            <div className="p-4 md:p-6 flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!analyticsData) {
        return (
            <div className="p-4 md:p-6 flex items-center justify-center h-full">
                <p className="text-muted-foreground">No data available</p>
            </div>
        );
    }

    if (analyticsData.error) {
        return (
            <div className="p-4 md:p-6 flex flex-col items-center justify-center h-full gap-4">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Analytics</h2>
                    <p className="text-muted-foreground">{analyticsData.error}</p>
                    {analyticsData.error.includes('401') || analyticsData.error.includes('Unauthorized') ? (
                        <p className="text-sm text-muted-foreground mt-2">Please log in again to view analytics</p>
                    ) : null}
                </div>
                <Button onClick={fetchAnalytics}>Retry</Button>
            </div>
        );
    }

    const { salesData, menuPerformance } = analyticsData;
    const topPerformers = menuPerformance
        .filter(item => item.unitsSold > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

    const lowPerformers = menuPerformance
        .filter(item => item.unitsSold === 0)
        .slice(0, 5);

    const bestSeller = topPerformers[0];
    const mostProfitable = menuPerformance
        .filter(item => item.unitsSold > 0)
        .sort((a, b) => b.totalProfit - a.totalProfit)[0];

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
                    <p className="text-muted-foreground mt-1">Track your sales and item performance</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-card">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="bg-transparent border-none outline-none text-sm font-medium cursor-pointer"
                    >
                        <option value="Today">Today</option>
                        <option value="This Week">This Week</option>
                        <option value="This Month">This Month</option>
                        <option value="This Year">This Year</option>
                    </select>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">₹{salesData.kpis.totalRevenue.toFixed(2)}</div>
                            <p className={cn("text-xs flex items-center gap-1 mt-1", salesData.kpis.revenueChange >= 0 ? "text-green-600" : "text-red-600")}>
                                {salesData.kpis.revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {Math.abs(salesData.kpis.revenueChange).toFixed(1)}% from last period
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{salesData.kpis.totalOrders}</div>
                            <p className={cn("text-xs flex items-center gap-1 mt-1", salesData.kpis.ordersChange >= 0 ? "text-green-600" : "text-red-600")}>
                                {salesData.kpis.ordersChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {Math.abs(salesData.kpis.ordersChange).toFixed(1)}% from last period
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <Card className="border-green-200 bg-green-50/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-green-900">Best Seller</CardTitle>
                            <Award className="h-4 w-4 text-green-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold text-green-900 truncate">{bestSeller?.name || 'N/A'}</div>
                            <p className="text-xs text-green-700 mt-1">{bestSeller?.unitsSold || 0} units sold</p>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                    <Card className="border-blue-200 bg-blue-50/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-blue-900">Most Profitable</CardTitle>
                            <TrendingUp className="h-4 w-4 text-blue-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold text-blue-900 truncate">{mostProfitable?.name || 'N/A'}</div>
                            <p className="text-xs text-blue-700 mt-1">₹{mostProfitable?.totalProfit?.toFixed(2) || 0} profit</p>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-yellow-500" />
                            Top 5 Revenue Generators
                        </CardTitle>
                        <CardDescription>Items that are making you the most money</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {topPerformers.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">No sales data available</p>
                        ) : (
                            <div className="space-y-3">
                                {topPerformers.map((item, index) => (
                                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                                                {index + 1}
                                            </div>
                                            <div>
                                                <p className="font-semibold">{item.name}</p>
                                                <p className="text-sm text-muted-foreground">{item.unitsSold} units sold</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-green-600">₹{item.revenue.toFixed(2)}</p>
                                            <p className="text-xs text-muted-foreground">{((item.revenue / salesData.kpis.totalRevenue) * 100).toFixed(1)}% of total</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {lowPerformers.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                    <Card className="border-orange-200">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-orange-500" />
                                Items Not Selling
                            </CardTitle>
                            <CardDescription>These items haven&apos;t sold in the selected period</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {lowPerformers.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-orange-50 border border-orange-200">
                                        <div>
                                            <p className="font-semibold text-orange-900">{item.name}</p>
                                            <p className="text-sm text-orange-700">Price: ₹{item.portions[0]?.price || 0}</p>
                                        </div>
                                        <Button variant="outline" size="sm" className="text-orange-600 border-orange-300 hover:bg-orange-100">
                                            Review
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-blue-500" />
                            Revenue Trend
                        </CardTitle>
                        <CardDescription>Daily sales performance</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {salesData.salesTrend.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No sales data for the selected period</p>
                        ) : (
                            <div className="h-64 flex items-end justify-around gap-2">
                                {salesData.salesTrend.map((day) => {
                                    const maxSales = Math.max(...salesData.salesTrend.map(d => d.sales));
                                    const height = maxSales > 0 ? (day.sales / maxSales) * 100 : 0;
                                    return (
                                        <div key={day.day} className="flex-1 flex flex-col items-center gap-2">
                                            <div className="w-full bg-primary rounded-t-md transition-all hover:bg-primary/80" style={{ height: `${height}%`, minHeight: height > 0 ? '20px' : '0' }}>
                                                <div className="text-xs text-white text-center p-1">₹{day.sales.toFixed(0)}</div>
                                            </div>
                                            <span className="text-xs text-muted-foreground">{day.day}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <PieChart className="h-5 w-5 text-purple-500" />
                            Payment Methods
                        </CardTitle>
                        <CardDescription>How customers are paying</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {salesData.paymentMethods.map((method) => {
                                const total = salesData.paymentMethods.reduce((sum, m) => sum + m.value, 0);
                                const percentage = total > 0 ? (method.value / total) * 100 : 0;
                                return (
                                    <div key={method.name}>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-medium">{method.name}</span>
                                            <span className="text-sm text-muted-foreground">{method.value} orders ({percentage.toFixed(1)}%)</span>
                                        </div>
                                        <div className="w-full bg-muted rounded-full h-3">
                                            <div
                                                className={cn("h-3 rounded-full transition-all", method.name === 'Online' ? 'bg-blue-500' : 'bg-green-500')}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
