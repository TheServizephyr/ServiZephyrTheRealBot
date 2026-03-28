
"use client";

import { useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Sector, ScatterChart, Scatter, Legend, ReferenceLine, AreaChart, Area } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { IndianRupee, Hash, Phone, Users, Star, TrendingDown, GitCommitHorizontal, AlertTriangle, Lightbulb, ChefHat, ShoppingBasket, DollarSign, ArrowRight, TrendingUp, Filter, Calendar as CalendarIcon, ArrowDown, ArrowUp, UserPlus, FileBarChart, CalendarDays, X, Gift, Crown, Clock, Sparkles, Wand2, Ticket, Percent, Loader2, Ban, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NextImage from 'next/image';
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Switch } from '@/components/ui/switch';
import { format, addDays } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import {
    buildOwnerDashboardShortcutPath,
    navigateToShortcutPath,
    OwnerDashboardShortcutsDialog,
    useOwnerDashboardShortcuts,
} from '@/lib/ownerDashboardShortcuts';

export const dynamic = 'force-dynamic';
const ANALYTICS_CACHE_TTL_MS = 2 * 60 * 1000;

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const normalizeBusinessType = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'restaurant' || normalized === 'street-vendor') return normalized;
    return null;
};


// --- SALES OVERVIEW COMPONENTS ---
const SalesOverview = ({ data, loading, isStoreBusiness = false }) => {
    const [modalData, setModalData] = useState({ isOpen: false, title: '', data: [], type: '' });

    const openModal = (title, data, type) => {
        setModalData({ isOpen: true, title, data, type });
    }

    const KpiCard = ({ title, value, change, icon: Icon, isCurrency = false, data, modalTitle, modalType, isRejection = false }) => {
        if (loading) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                    <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-full"></div>
                </div>
            )
        }
        const changeColor = isRejection ? 'text-muted-foreground' : (change > 0 ? 'text-green-400' : 'text-red-400');
        const ChangeIcon = change > 0 ? ArrowUp : ArrowDown;
        return (
            <motion.div
                className={cn("bg-card border border-border p-5 rounded-xl", data && "cursor-pointer")}
                whileHover={{ y: -5, boxShadow: "0 4px 15px hsla(var(--primary), 0.2)" }}
                onClick={() => data && openModal(modalTitle, data, modalType)}
            >
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <Icon className={cn("text-muted-foreground", isRejection && "text-red-500")} />
                </div>
                <p className="text-3xl font-bold mt-2 text-foreground">{isCurrency ? formatCurrency(value) : Number(value).toLocaleString('en-IN')}</p>
                {change !== undefined && !isRejection && (
                    <div className={`flex items-center text-xs mt-1 ${changeColor}`}>
                        <ChangeIcon size={12} className="mr-1" />
                        {Math.abs(change).toFixed(2)}% vs last period
                    </div>
                )}
                {isRejection && <div className="text-xs mt-1 text-muted-foreground">in selected period</div>}
            </motion.div>
        );
    };

    const SourceSplitCard = ({ title, count, revenue, icon: Icon, tone }) => {
        const toneClasses = {
            green: 'border-green-500/30 bg-green-500/5 text-green-300',
            blue: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
            yellow: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
        };
        const style = toneClasses[tone] || toneClasses.blue;

        if (loading) {
            return (
                <div className="bg-card border border-border p-4 rounded-xl animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                    <div className="h-7 bg-muted rounded w-2/3 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
            );
        }

        return (
            <div className={cn('border p-4 rounded-xl', style)}>
                <div className="flex items-center justify-between mb-1">
                    <p className="text-xs uppercase tracking-wide">{title}</p>
                    <Icon size={16} />
                </div>
                <p className="text-2xl font-bold">{Number(count || 0).toLocaleString('en-IN')}</p>
                <p className="text-xs opacity-80">Revenue: {formatCurrency(revenue || 0)}</p>
            </div>
        );
    };

    const OrderSourceChart = () => {
        const COLORS = ['#22c55e', '#3b82f6', '#eab308'];
        const sourceData = data?.orderSourceBreakdown || [];

        if (loading) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] animate-pulse">
                    <div className="h-6 bg-muted w-3/4 mb-4"></div>
                    <div className="flex items-center justify-center h-full">
                        <div className="w-48 h-48 bg-muted rounded-full"></div>
                    </div>
                </div>
            );
        }

        if (sourceData.length === 0) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] flex flex-col items-center justify-center">
                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Source Mix</h3>
                    <p className="text-muted-foreground text-sm">No source data available.</p>
                </div>
            );
        }

        return (
            <div className="bg-card border border-border p-5 rounded-xl h-[350px]">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Source Mix</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                        <Pie
                            data={sourceData}
                            cx="50%"
                            cy="50%"
                            innerRadius={"60%"}
                            outerRadius={"80%"}
                            paddingAngle={5}
                            dataKey="value"
                            nameKey="name"
                            stroke="hsl(var(--card))"
                            strokeWidth={2}
                        >
                            {sourceData.map((entry, index) => (
                                <Cell key={`order-source-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                color: 'hsl(var(--popover-foreground))'
                            }}
                            formatter={(value, _name, payload) => {
                                const revenue = payload?.payload?.revenue || 0;
                                return [`${value} orders • ${formatCurrency(revenue)}`, 'Volume'];
                            }}
                        />
                        <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" formatter={(value) => <span className="text-muted-foreground text-sm">{value}</span>} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        );
    };

    const SalesTrendChart = () => (
        <div className="bg-card border border-border p-5 rounded-xl h-[400px]">
            <h3 className="text-lg font-semibold mb-4 text-card-foreground">Sales Trend</h3>
            {loading ? (
                <div className="flex items-center justify-center h-full"><GoldenCoinSpinner /></div>
            ) : (
                <ResponsiveContainer width="100%" height="90%">
                    <AreaChart data={data?.salesTrend || []} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} formatter={(value) => [formatCurrency(value), 'Sales']} />
                        <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#salesGradient)" />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    );

    const PaymentModeChart = () => {
        const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316'];

        if (loading) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] animate-pulse">
                    <div className="h-6 bg-muted w-3/4 mb-4"></div>
                    <div className="flex items-center justify-center h-full">
                        <div className="w-48 h-48 bg-muted rounded-full"></div>
                    </div>
                </div>
            )
        }

        if (!data?.paymentMethods || data.paymentMethods.length === 0) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] flex flex-col items-center justify-center">
                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">Payment Modes</h3>
                    <p className="text-muted-foreground text-sm">No payment data available.</p>
                </div>
            )
        }

        return (
            <div className="bg-card border border-border p-5 rounded-xl h-[350px]">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Payment Modes</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                        <Pie
                            data={data?.paymentMethods}
                            cx="50%"
                            cy="50%"
                            innerRadius={"60%"}
                            outerRadius={"80%"}
                            paddingAngle={5}
                            dataKey="value"
                            nameKey="name"
                            stroke="hsl(var(--card))"
                            strokeWidth={2}
                        >
                            {data.paymentMethods.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                color: 'hsl(var(--popover-foreground))'
                            }}
                            itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                            formatter={(value) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" formatter={(value) => <span className="text-muted-foreground text-sm">{value}</span>} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        );
    }

    const RejectionReasonChart = () => {
        const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6'];

        if (loading) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] animate-pulse">
                    <div className="h-6 bg-muted w-3/4 mb-4"></div>
                    <div className="flex items-center justify-center h-full">
                        <div className="w-48 h-48 bg-muted rounded-full"></div>
                    </div>
                </div>
            )
        }

        if (!data?.rejectionReasons || data.rejectionReasons.length === 0) {
            return (
                <div className="bg-card border border-border p-5 rounded-xl h-[350px] flex flex-col items-center justify-center">
                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Rejection Reasons</h3>
                    <p className="text-muted-foreground text-sm">No rejections in this period. Great job!</p>
                </div>
            )
        }

        return (
            <div className="bg-card border border-border p-5 rounded-xl h-[350px]">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Rejection Reasons</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                        <Pie
                            data={data?.rejectionReasons}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={"80%"}
                            fill="#8884d8"
                            dataKey="value"
                            nameKey="name"
                            stroke="hsl(var(--card))"
                            strokeWidth={2}
                        >
                            {data.rejectionReasons.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                color: 'hsl(var(--popover-foreground))'
                            }}
                            itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        />
                        <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" formatter={(value) => <span className="text-muted-foreground text-sm">{value}</span>} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        );
    }

    const ModalContent = () => {
        const renderTable = () => {
            switch (modalData.type) {
                case 'customers': return <div>Customer Data...</div>
                case 'orders': return <div>Order Data...</div>
                default: return <div>Transaction Data...</div>
            }
        };

        return (
            <Dialog open={modalData.isOpen} onOpenChange={(isOpen) => setModalData(prev => ({ ...prev, isOpen }))}>
                <DialogContent className="max-w-3xl bg-card border-border text-card-foreground">
                    <DialogHeader>
                        <DialogTitle>{modalData.title}</DialogTitle>
                        <DialogDescription>Detailed view for the selected period.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto">
                        {/* A more detailed table would go here */}
                    </div>
                </DialogContent>
            </Dialog>
        );
    }


    return (
        <div className="space-y-6">
            <ModalContent />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-6">
                <KpiCard title="Total Revenue" value={data?.kpis?.totalRevenue || 0} change={data?.kpis?.revenueChange || 0} icon={IndianRupee} isCurrency={true} modalTitle="Revenue Details" modalType="revenue" loading={loading} />
                <KpiCard title={isStoreBusiness ? "Total Sales" : "Total Orders"} value={data?.kpis?.totalOrders || 0} change={data?.kpis?.ordersChange || 0} icon={ShoppingBasket} modalTitle="Order Details" modalType="orders" loading={loading} />
                <KpiCard title="Average Order Value" value={data?.kpis?.avgOrderValue || 0} change={data?.kpis?.avgValueChange || 0} icon={FileBarChart} isCurrency={true} modalTitle="Order Value Details" modalType="orders" loading={loading} />
                {!isStoreBusiness && <KpiCard title="Dine-In Orders" value={data?.kpis?.dineInOrders || 0} icon={ChefHat} loading={loading} />}
                <KpiCard title="Online Orders" value={data?.kpis?.onlineOrders || 0} icon={TrendingUp} loading={loading} />
                <KpiCard title={isStoreBusiness ? "Counter Orders" : "Call Orders"} value={data?.kpis?.manualCallOrders || 0} icon={Phone} loading={loading} />
                <KpiCard title={isStoreBusiness ? "Cancelled / Failed" : "Total Rejections"} value={data?.kpis?.totalRejections || 0} icon={Ban} isRejection={true} loading={loading} />
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-2 ${isStoreBusiness ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-4`}>
                {!isStoreBusiness && (
                    <SourceSplitCard
                        title="Dine-In Orders"
                        count={data?.kpis?.dineInOrders || 0}
                        revenue={data?.kpis?.dineInRevenue || 0}
                        icon={ChefHat}
                        tone="yellow"
                    />
                )}
                <SourceSplitCard
                    title="Online Orders"
                    count={data?.kpis?.onlineOrders || 0}
                    revenue={data?.kpis?.onlineOrderRevenue || 0}
                    icon={TrendingUp}
                    tone="green"
                />
                <SourceSplitCard
                    title={isStoreBusiness ? "Counter Orders" : "Manual Call Orders"}
                    count={data?.kpis?.manualCallOrders || 0}
                    revenue={data?.kpis?.manualCallRevenue || 0}
                    icon={Phone}
                    tone="blue"
                />
                <SourceSplitCard
                    title={isStoreBusiness ? "POS Bills" : "Offline Counter Bills"}
                    count={data?.kpis?.counterBills || 0}
                    revenue={data?.kpis?.counterBillRevenue || 0}
                    icon={Hash}
                    tone="yellow"
                />
            </div>

            {/* Sales Trend - Full Width */}
            <div className="w-full">
                <SalesTrendChart />
            </div>

            {/* Pie Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <OrderSourceChart />
                <PaymentModeChart />
                <RejectionReasonChart />
            </div>
        </div>
    );
};


const MenuAnalytics = ({ data, loading, isStoreBusiness = false }) => {

    const PerformanceList = ({ data, metric, ascending = false, title, icon: Icon, isProfit = false }) => {
        const sortedData = useMemo(() => {
            if (!data) return [];
            return [...data].sort((a, b) => ascending ? a[metric] - b[metric] : b[metric] - a[metric]).slice(0, 5);
        }, [data, metric, ascending]);

        if (loading) return <div className="bg-card border border-border p-5 rounded-xl h-full animate-pulse"><div className="h-8 bg-muted w-3/4 rounded-md"></div></div>;

        return (
            <div className="bg-card border border-border p-5 rounded-xl h-full">
                <h3 className="font-semibold text-card-foreground mb-4 flex items-center gap-2">
                    <Icon className={isProfit ? "text-green-400" : "text-red-400"} />
                    {title}
                </h3>
                <div className="space-y-3">
                    {sortedData.map(item => (
                        <div key={item.name} className="flex flex-col sm:flex-row items-start gap-3 p-3 rounded-lg bg-background">
                            <NextImage src={item.imageUrl} alt={item.name} width={48} height={48} className="rounded-md object-cover flex-shrink-0" />
                            <div className="flex-grow w-full">
                                <p className="font-semibold text-foreground text-sm">{item.name}</p>
                                <div className="flex flex-wrap justify-between items-center text-xs mt-2 text-muted-foreground gap-2">
                                    <div>
                                        <p className="text-xs">Units Sold</p>
                                        <strong className="text-foreground text-sm">{item.unitsSold}</strong>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs">Total Profit</p>
                                        <span className="font-bold text-base text-green-400">{formatCurrency(item.totalProfit)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const ProfitabilityMatrix = ({ data }) => {
        if (loading) return <div className="bg-card border border-border p-5 rounded-xl lg:col-span-3 h-[400px] animate-pulse"></div>;

        const avgPopularity = data.length > 0 ? data.reduce((sum, item) => sum + item.popularity, 0) / data.length : 0;
        const avgProfitability = data.length > 0 ? data.reduce((sum, item) => sum + item.profitability, 0) / data.length : 0;

        const getQuadrant = (item) => {
            if (item.popularity >= avgPopularity && item.profitability >= avgProfitability) return 'Superstar';
            if (item.popularity >= avgPopularity && item.profitability < avgProfitability) return 'Workhorse';
            if (item.popularity < avgPopularity && item.profitability >= avgProfitability) return 'Puzzle';
            return 'Deadweight';
        };

        const quadrantData = {
            Superstar: data.filter(item => getQuadrant(item) === 'Superstar'),
            Workhorse: data.filter(item => getQuadrant(item) === 'Workhorse'),
            Puzzle: data.filter(item => getQuadrant(item) === 'Puzzle'),
            Deadweight: data.filter(item => getQuadrant(item) === 'Deadweight'),
        };
        const quadrantColors = { Superstar: '#22c55e', Workhorse: '#3b82f6', Puzzle: '#f97316', Deadweight: '#ef4444' };

        return (
            <div className="bg-card border border-border p-5 rounded-xl lg:col-span-3">
                <h3 className="font-semibold text-card-foreground mb-4">Profitability Matrix</h3>
                <ResponsiveContainer width="100%" height={350}>
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis type="number" dataKey="popularity" name="Popularity" unit=" units" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} label={{ value: 'Popularity (Units Sold)', position: 'bottom', fill: 'hsl(var(--muted-foreground))', dy: 20 }} />
                        <YAxis type="number" dataKey="profitability" name="Profitability" unit="%" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} label={{ value: 'Profitability (%)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                return <div className="bg-popover border border-border p-3 rounded-lg shadow-lg text-popover-foreground"><p className="font-bold text-base mb-2">{payload[0].payload.name}</p></div>;
                            }
                            return null;
                        }} />
                        <ReferenceLine y={avgProfitability} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
                        <ReferenceLine x={avgPopularity} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
                        {Object.keys(quadrantData).map(quad => (
                            <Scatter key={quad} name={quad} data={quadrantData[quad]} fill={quadrantColors[quad]} />
                        ))}
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        );
    };

    if (isStoreBusiness) {
        const inventoryHealth = data?.storeInsights?.inventoryHealth || {};
        const brandPerformance = data?.storeInsights?.brandPerformance || [];
        const topMovers = data?.storeInsights?.topMovers || [];
        const deadStock = data?.storeInsights?.deadStock || [];

        const StoreStatCard = ({ title, value, icon: Icon, detail }) => (
            <div className="bg-card border border-border p-5 rounded-xl">
                {loading ? (
                    <div className="animate-pulse">
                        <div className="h-4 bg-muted w-3/4 rounded mb-2"></div>
                        <div className="h-8 bg-muted w-1/2 rounded"></div>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">{title}</p>
                            <Icon className="text-muted-foreground" size={18} />
                        </div>
                        <p className="text-3xl font-bold mt-2 text-foreground">{value}</p>
                        {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
                    </>
                )}
            </div>
        );

        const StoreList = ({ title, rows, emptyLabel, valueRenderer, metaRenderer }) => (
            <div className="bg-card border border-border p-5 rounded-xl">
                <h3 className="font-semibold text-card-foreground mb-4">{title}</h3>
                {loading ? (
                    <div className="space-y-3 animate-pulse">
                        <div className="h-14 bg-muted rounded-lg"></div>
                        <div className="h-14 bg-muted rounded-lg"></div>
                        <div className="h-14 bg-muted rounded-lg"></div>
                    </div>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{emptyLabel}</p>
                ) : (
                    <div className="space-y-3">
                        {rows.map((row) => (
                            <div key={row.id || row.name || row.brand} className="rounded-lg border border-border bg-background px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm text-foreground truncate">{row.name || row.brand}</p>
                                        <p className="text-xs text-muted-foreground mt-1">{metaRenderer(row)}</p>
                                    </div>
                                    <div className="text-right text-sm font-semibold text-foreground whitespace-nowrap">
                                        {valueRenderer(row)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );

        return (
            <div className="space-y-6">
                <div>
                    <h3 className="text-xl font-bold mb-4">Inventory Health</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <StoreStatCard title="Catalog Products" value={inventoryHealth.totalProducts || 0} icon={ShoppingBasket} detail="Products in current catalog" />
                        <StoreStatCard title="Low Stock Risk" value={inventoryHealth.lowStockCount || 0} icon={AlertTriangle} detail="At or below reorder level" />
                        <StoreStatCard title="Out of Stock" value={inventoryHealth.outOfStockCount || 0} icon={Ban} detail="Need replenishment now" />
                        <StoreStatCard title="Safety Stock Risk" value={inventoryHealth.safetyRiskCount || 0} icon={ShieldAlert} detail="Below safety stock threshold" />
                        <StoreStatCard title="Reorder Suggested" value={inventoryHealth.reorderSuggestedCount || 0} icon={Wand2} detail="Has reorder qty configured" />
                        <StoreStatCard title="Dead Stock" value={inventoryHealth.deadStockCount || 0} icon={TrendingDown} detail="No sales in selected range" />
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <StoreList
                        title="Top Movers"
                        rows={topMovers}
                        emptyLabel="No product movement in selected range."
                        metaRenderer={(row) => `Stock: ${row.stockOnHand || 0} • Brand: ${row.brand || 'Unbranded'}`}
                        valueRenderer={(row) => `${row.unitsSold || 0} sold`}
                    />
                    <StoreList
                        title="Dead Stock"
                        rows={deadStock}
                        emptyLabel="No dead stock detected in selected range."
                        metaRenderer={(row) => `On hand: ${row.stockOnHand || 0} • Reorder level: ${row.reorderLevel || 0}`}
                        valueRenderer={(row) => formatCurrency(row.revenue || 0)}
                    />
                </div>

                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-5 border-b border-border">
                        <h3 className="font-semibold text-card-foreground">Brand Performance</h3>
                        <p className="text-sm text-muted-foreground mt-1">Top brands by revenue in the selected period.</p>
                    </div>
                    {loading ? (
                        <div className="p-5 space-y-3 animate-pulse">
                            <div className="h-12 bg-muted rounded-lg"></div>
                            <div className="h-12 bg-muted rounded-lg"></div>
                            <div className="h-12 bg-muted rounded-lg"></div>
                        </div>
                    ) : brandPerformance.length === 0 ? (
                        <div className="p-5 text-sm text-muted-foreground">No brand data available yet.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/40 border-b border-border">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-semibold">Brand</th>
                                        <th className="px-4 py-3 text-right font-semibold">SKUs</th>
                                        <th className="px-4 py-3 text-right font-semibold">Units Sold</th>
                                        <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                                        <th className="px-4 py-3 text-right font-semibold">Low Stock</th>
                                        <th className="px-4 py-3 text-right font-semibold">Out of Stock</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {brandPerformance.map((row) => (
                                        <tr key={row.brand} className="border-b border-border/60">
                                            <td className="px-4 py-3 font-medium">{row.brand}</td>
                                            <td className="px-4 py-3 text-right">{row.skuCount || 0}</td>
                                            <td className="px-4 py-3 text-right">{row.unitsSold || 0}</td>
                                            <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.revenue || 0)}</td>
                                            <td className="px-4 py-3 text-right">{row.lowStockCount || 0}</td>
                                            <td className="px-4 py-3 text-right">{row.outOfStockCount || 0}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PerformanceList data={data?.menuPerformance} metric="totalProfit" ascending={false} title="Top Profitable Items" icon={TrendingUp} isProfit={true} loading={loading} />
                <PerformanceList data={data?.menuPerformance} metric="totalProfit" ascending={true} title="Underperforming Items" icon={TrendingDown} loading={loading} />
            </div>
            <div className="grid grid-cols-1 gap-6">
                <ProfitabilityMatrix data={data?.menuPerformance || []} loading={loading} />
            </div>
        </div>
    );
};

const CustomerRelationshipHub = ({ data, loading }) => {
    // This component remains largely unchanged as it was already well-structured
    // We just pass loading state to its children
    const CustomerStatCard = ({ title, value, icon: Icon, detail }) => (
        <div className={cn("bg-card border border-border p-5 rounded-xl")}>
            {loading ? (
                <div className="animate-pulse">
                    <div className="h-4 bg-muted w-3/4 rounded mb-2"></div>
                    <div className="h-8 bg-muted w-1/2 rounded"></div>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{title}</p>
                        <Icon className="text-muted-foreground" />
                    </div>
                    <p className="text-3xl font-bold mt-2 text-foreground">{value}</p>
                    {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
                </>
            )}
        </div>
    );

    return (
        <div className="space-y-8">
            <section>
                <h3 className="text-xl font-bold mb-4">Customer Snapshot</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <CustomerStatCard title="Total Customers" value={data?.customerStats?.totalCustomers || 0} icon={Users} loading={loading} />
                    <CustomerStatCard title="New This Month" value={data?.customerStats?.newThisMonth || 0} icon={UserPlus} loading={loading} />
                    <CustomerStatCard title="Repeat Rate" value={`${data?.customerStats?.repeatRate || 0}%`} icon={GitCommitHorizontal} loading={loading} />
                </div>
            </section>
            <section>
                <h3 className="text-xl font-bold mb-4">UID vs Guest Channel Split</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <CustomerStatCard
                        title="UID Online Orders"
                        value={data?.customerStats?.customerTypeMix?.uid?.onlineOrders || 0}
                        icon={Users}
                        detail="Logged-in users placing online orders"
                    />
                    <CustomerStatCard
                        title="UID Call Orders"
                        value={data?.customerStats?.customerTypeMix?.uid?.manualCallOrders || 0}
                        icon={Phone}
                        detail="Logged-in users via manual call-create flow"
                    />
                    <CustomerStatCard
                        title="UID Counter Bills"
                        value={data?.customerStats?.customerTypeMix?.uid?.counterBills || 0}
                        icon={Hash}
                        detail="Logged-in users billed at counter"
                    />
                    <CustomerStatCard
                        title="Guest Online Orders"
                        value={data?.customerStats?.customerTypeMix?.guest?.onlineOrders || 0}
                        icon={UserPlus}
                        detail="Guest users placing online orders"
                    />
                    <CustomerStatCard
                        title="Guest Call Orders"
                        value={data?.customerStats?.customerTypeMix?.guest?.manualCallOrders || 0}
                        icon={Phone}
                        detail="Guest users via manual call-create flow"
                    />
                    <CustomerStatCard
                        title="Guest Counter Bills"
                        value={data?.customerStats?.customerTypeMix?.guest?.counterBills || 0}
                        icon={Hash}
                        detail="Guest users billed at counter"
                    />
                </div>
            </section>
            <section>
                <h3 className="text-xl font-bold mb-4">Customer Channel Mix (Current Filter)</h3>
                {loading ? (
                    <div className="bg-card border border-border rounded-xl h-64 animate-pulse"></div>
                ) : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-muted/40 border-b border-border">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold">Customer</th>
                                        <th className="px-4 py-3 font-semibold">Type</th>
                                        <th className="px-4 py-3 font-semibold">Phone</th>
                                        <th className="px-4 py-3 font-semibold text-center">Online</th>
                                        <th className="px-4 py-3 font-semibold text-center">Call</th>
                                        <th className="px-4 py-3 font-semibold text-center">Counter</th>
                                        <th className="px-4 py-3 font-semibold text-right">Spend</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(data?.customerStats?.customerOrderMix || []).length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                                                No customer channel data in selected range.
                                            </td>
                                        </tr>
                                    ) : (
                                        (data?.customerStats?.customerOrderMix || []).map((row) => (
                                            <tr key={row.customerKey} className="border-b border-border/60">
                                                <td className="px-4 py-3 font-medium">{row.name || 'Customer'}</td>
                                                <td className="px-4 py-3 uppercase text-xs tracking-wide text-muted-foreground">{row.customerType || 'guest'}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{row.phone || '-'}</td>
                                                <td className="px-4 py-3 text-center">{row.onlineOrders || 0}</td>
                                                <td className="px-4 py-3 text-center">{row.manualCallOrders || 0}</td>
                                                <td className="px-4 py-3 text-center">{row.counterBills || 0}</td>
                                                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.totalSpent || 0)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
};

const RiderAnalyticsHub = ({ data, loading }) => {
    const riderAnalytics = data?.riderAnalytics || {};
    const riders = riderAnalytics.riders || [];
    const combinedDayWise = riderAnalytics.combinedDayWise || [];
    const combinedWeekWise = riderAnalytics.combinedWeekWise || [];

    const StatCard = ({ title, value, icon: Icon, sub }) => (
        <div className="bg-card border border-border p-5 rounded-xl">
            {loading ? (
                <div className="animate-pulse">
                    <div className="h-4 bg-muted w-3/4 rounded mb-2"></div>
                    <div className="h-8 bg-muted w-1/2 rounded"></div>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{title}</p>
                        <Icon className="text-muted-foreground" size={18} />
                    </div>
                    <p className="text-3xl font-bold mt-2 text-foreground">{value}</p>
                    {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
                </>
            )}
        </div>
    );

    return (
        <div className="space-y-8">
            <section>
                <h3 className="text-xl font-bold mb-4">Rider Snapshot</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                    <StatCard title="Total Riders" value={riderAnalytics.totalRiders || 0} icon={Users} />
                    <StatCard title="Active Riders" value={riderAnalytics.activeRidersInPeriod || 0} icon={TrendingUp} sub="In selected period" />
                    <StatCard title="Assigned Orders" value={riderAnalytics.totalAssignedOrders || 0} icon={ShoppingBasket} />
                    <StatCard title="Completed Orders" value={riderAnalytics.totalCompletedOrders || 0} icon={Sparkles} />
                    <StatCard title="Total Collection" value={formatCurrency(riderAnalytics.totalCollection || 0)} icon={IndianRupee} />
                </div>
            </section>

            <section>
                <h3 className="text-xl font-bold mb-4">All Riders Day Wise</h3>
                {loading ? (
                    <div className="bg-card border border-border rounded-xl h-52 animate-pulse"></div>
                ) : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-muted/40 border-b border-border">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold">Date</th>
                                        <th className="px-4 py-3 font-semibold text-center">Assigned</th>
                                        <th className="px-4 py-3 font-semibold text-center">Completed</th>
                                        <th className="px-4 py-3 font-semibold text-right">Collection</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {combinedDayWise.length === 0 ? (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No rider orders in selected range.</td></tr>
                                    ) : combinedDayWise.map((row) => (
                                        <tr key={row.dayKey} className="border-b border-border/60">
                                            <td className="px-4 py-3 font-medium">{row.date}</td>
                                            <td className="px-4 py-3 text-center">{row.assignedOrders || 0}</td>
                                            <td className="px-4 py-3 text-center">{row.completedOrders || 0}</td>
                                            <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.collection || 0)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            <section>
                <h3 className="text-xl font-bold mb-4">All Riders Week Wise</h3>
                {loading ? (
                    <div className="bg-card border border-border rounded-xl h-52 animate-pulse"></div>
                ) : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-muted/40 border-b border-border">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold">Week Range</th>
                                        <th className="px-4 py-3 font-semibold text-center">Assigned</th>
                                        <th className="px-4 py-3 font-semibold text-center">Completed</th>
                                        <th className="px-4 py-3 font-semibold text-right">Collection</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {combinedWeekWise.length === 0 ? (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No rider orders in selected range.</td></tr>
                                    ) : combinedWeekWise.map((row) => (
                                        <tr key={row.weekKey} className="border-b border-border/60">
                                            <td className="px-4 py-3 font-medium">{row.weekStart} to {row.weekEnd}</td>
                                            <td className="px-4 py-3 text-center">{row.assignedOrders || 0}</td>
                                            <td className="px-4 py-3 text-center">{row.completedOrders || 0}</td>
                                            <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.collection || 0)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            <section>
                <h3 className="text-xl font-bold mb-4">Rider Wise Breakdown</h3>
                <div className="space-y-4">
                    {loading ? (
                        <div className="bg-card border border-border rounded-xl h-40 animate-pulse"></div>
                    ) : riders.length === 0 ? (
                        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No rider-wise data found in selected range.</div>
                    ) : riders.map((rider) => (
                        <div key={rider.riderId} className="bg-card border border-border rounded-xl p-5">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                                <div>
                                    <h4 className="text-lg font-semibold">{rider.riderName || 'Rider'}</h4>
                                    <p className="text-xs text-muted-foreground">{rider.riderPhone || 'No phone'}</p>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    Completion: <span className="text-foreground font-semibold">{rider.completionRate || 0}%</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="rounded-lg border border-border p-3">
                                    <p className="text-xs text-muted-foreground">Assigned Orders</p>
                                    <p className="text-xl font-bold">{rider.totalAssignedOrders || 0}</p>
                                </div>
                                <div className="rounded-lg border border-border p-3">
                                    <p className="text-xs text-muted-foreground">Completed Orders</p>
                                    <p className="text-xl font-bold">{rider.totalCompletedOrders || 0}</p>
                                </div>
                                <div className="rounded-lg border border-border p-3">
                                    <p className="text-xs text-muted-foreground">Collection</p>
                                    <p className="text-xl font-bold">{formatCurrency(rider.totalCollection || 0)}</p>
                                </div>
                            </div>
                            <div className="mt-4">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Recent Orders</p>
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-muted/40 border-b border-border">
                                            <tr>
                                                <th className="px-3 py-2 font-semibold">Order ID</th>
                                                <th className="px-3 py-2 font-semibold">Status</th>
                                                <th className="px-3 py-2 font-semibold">Date</th>
                                                <th className="px-3 py-2 font-semibold text-right">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(rider.orders || []).slice(0, 10).map((order) => (
                                                <tr key={`${rider.riderId}_${order.id}`} className="border-b border-border/60">
                                                    <td className="px-3 py-2 font-medium">{order.customerOrderId || order.id}</td>
                                                    <td className="px-3 py-2 uppercase">{order.status || '-'}</td>
                                                    <td className="px-3 py-2">{formatDate(order.orderDate)}</td>
                                                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(order.amount || 0)}</td>
                                                </tr>
                                            ))}
                                            {(rider.orders || []).length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-5 text-center text-muted-foreground">No orders for this rider in selected range.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

// --- MANUAL ORDER ANALYTICS COMPONENT ---
const ManualOrderAnalytics = ({ date, activeDateFilter, impersonatedOwnerId, employeeOfOwnerId, onlineRevenue, isStoreBusiness = false }) => {
    const [manualHistory, setManualHistory] = useState([]);
    const [manualLoading, setManualLoading] = useState(true);

    const toYMD = (d) => {
        if (!d) return '';
        const y = d.getFullYear();
        const m = `${d.getMonth() + 1}`.padStart(2, '0');
        const day = `${d.getDate()}`.padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const getDateRange = () => {
        const now = new Date();
        if (activeDateFilter === 'Today') return { from: toYMD(now), to: toYMD(now) };
        if (activeDateFilter === 'This Week') {
            const start = new Date(now); start.setDate(now.getDate() - now.getDay());
            return { from: toYMD(start), to: toYMD(now) };
        }
        if (activeDateFilter === 'This Year') {
            return { from: `${now.getFullYear()}-01-01`, to: toYMD(now) };
        }
        if (activeDateFilter === 'Custom Range' && date?.from && date?.to) {
            return { from: toYMD(date.from), to: toYMD(date.to) };
        }
        // Default: This Month
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: toYMD(start), to: toYMD(now) };
    };

    useEffect(() => {
        const fetchManualHistory = async () => {
            setManualLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) return;
                const idToken = await user.getIdToken();
                const { from, to } = getDateRange();
                const url = new URL('/api/owner/custom-bill/history', window.location.origin);
                url.searchParams.set('from', from);
                url.searchParams.set('to', to);
                url.searchParams.set('limit', '1000');
                if (impersonatedOwnerId) url.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
                else if (employeeOfOwnerId) url.searchParams.set('employee_of', employeeOfOwnerId);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const data = await res.json().catch(() => ({}));
                if (res.ok) setManualHistory(Array.isArray(data.history) ? data.history : []);
            } catch { /* silently ignore */ }
            finally { setManualLoading(false); }
        };
        const unsub = auth.onAuthStateChanged(u => { if (u) fetchManualHistory(); else setManualLoading(false); });
        return () => unsub();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDateFilter, date, impersonatedOwnerId, employeeOfOwnerId]);

    // Only count manual order types (delivery, dine-in, pickup) — exclude custom-bill types
    const allowedManualTypes = useMemo(() => (
        isStoreBusiness ? ['delivery', 'pickup'] : ['delivery', 'dine-in', 'pickup']
    ), [isStoreBusiness]);

    const manualOrders = useMemo(() =>
        manualHistory.filter((bill) => allowedManualTypes.includes(bill.orderType)),
        [allowedManualTypes, manualHistory]
    );

    const compute = (bills) => ({
        count: bills.length,
        revenue: bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0),
        avg: bills.length > 0 ? bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0) / bills.length : 0,
    });

    const overall = useMemo(() => compute(manualOrders), [manualOrders]);
    const byType = useMemo(() => ({
        delivery: compute(manualOrders.filter(b => b.orderType === 'delivery')),
        'dine-in': compute(manualOrders.filter(b => b.orderType === 'dine-in')),
        pickup: compute(manualOrders.filter(b => b.orderType === 'pickup')),
    }), [manualOrders]);

    const combinedRevenue = (Number(onlineRevenue) || 0) + overall.revenue;

    const typeConfig = [
        { key: 'delivery', label: '📦 Delivery', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400' },
        ...(!isStoreBusiness ? [{ key: 'dine-in', label: '🍽️ Dine-In', color: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400' }] : []),
        { key: 'pickup', label: '🛍️ Pickup', color: 'border-green-500/30 bg-green-500/5 text-green-400' },
    ];

    if (manualLoading) {
        return (
            <div className="space-y-4">
                {[1,2].map(i => <div key={i} className="h-32 bg-card border border-border rounded-xl animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Combined revenue banner */}
            <div className="bg-card border border-border rounded-xl p-5">
                <p className="text-sm text-muted-foreground mb-1">Combined Total Revenue (Online + Manual Billing)</p>
                <p className="text-4xl font-bold text-foreground">{formatCurrency(combinedRevenue)}</p>
                <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                    <span>🌐 Online: <strong className="text-foreground">{formatCurrency(Number(onlineRevenue) || 0)}</strong></span>
                    <span>📋 Manual: <strong className="text-foreground">{formatCurrency(overall.revenue)}</strong></span>
                </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-xl p-5">
                    <p className="text-sm text-muted-foreground">Total Manual Orders</p>
                    <p className="text-3xl font-bold mt-1">{overall.count.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-5">
                    <p className="text-sm text-muted-foreground">Manual Billing Revenue</p>
                    <p className="text-3xl font-bold mt-1">{formatCurrency(overall.revenue)}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-5">
                    <p className="text-sm text-muted-foreground">Avg Bill Value</p>
                    <p className="text-3xl font-bold mt-1">{formatCurrency(overall.avg)}</p>
                </div>
            </div>

            {/* Per-type breakdown */}
            <div>
                <h3 className="text-lg font-semibold mb-3">Order Type Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {typeConfig.map(({ key, label, color }) => (
                        <div key={key} className={`border rounded-xl p-4 ${color}`}>
                            <p className="text-sm font-semibold mb-2">{label}</p>
                            <p className="text-2xl font-bold">{byType[key].count} orders</p>
                            <p className="text-sm opacity-90 mt-1">{formatCurrency(byType[key].revenue)}</p>
                            <p className="text-xs opacity-70 mt-0.5">Avg: {formatCurrency(byType[key].avg)}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent manual orders table */}
            <div>
                <h3 className="text-lg font-semibold mb-3">Recent Orders</h3>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30 border-b border-border">
                                <tr>
                                    <th className="p-4 text-left font-semibold text-muted-foreground">Type</th>
                                    <th className="p-4 text-left font-semibold text-muted-foreground">Customer</th>
                                    <th className="p-4 text-left font-semibold text-muted-foreground">Amount</th>
                                    <th className="p-4 text-left font-semibold text-muted-foreground">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {manualOrders.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No manual orders in selected period.</td></tr>
                                ) : manualOrders.slice(0, 20).map((bill, i) => (
                                    <tr key={bill.id || i} className="hover:bg-muted/20">
                                        <td className="p-4 capitalize text-xs font-semibold text-muted-foreground">{bill.orderType}</td>
                                        <td className="p-4">{bill.customerName || 'Walk-in'}</td>
                                        <td className="p-4 font-semibold">{formatCurrency(bill.totalAmount || 0)}</td>
                                        <td className="p-4 text-xs text-muted-foreground">
                                            {bill.printedAt ? new Date(bill.printedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Main Page Component ---
function AnalyticsPageContent() {
    const [activeTab, setActiveTab] = useState('sales');
    const [activeDateFilter, setActiveDateFilter] = useState('This Month');
    const [date, setDate] = useState({
        from: addDays(new Date(), -29),
        to: new Date(),
    });
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

    const [analyticsData, setAnalyticsData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [businessType, setBusinessType] = useState('restaurant');
    const normalizedBusinessType = normalizeBusinessType(businessType) || 'restaurant';
    const isStoreBusiness = normalizedBusinessType === 'store';

    const shortcutScope = useMemo(() => ({
        impersonatedOwnerId,
        employeeOfOwnerId,
    }), [employeeOfOwnerId, impersonatedOwnerId]);

    const navigateWithShortcut = useCallback((basePath) => {
        navigateToShortcutPath(buildOwnerDashboardShortcutPath(basePath, shortcutScope));
    }, [shortcutScope]);

    const shortcutSections = useMemo(() => ([
        {
            title: 'Page Navigation',
            shortcuts: [
                { combo: 'Alt+M', description: 'Open Manual Billing' },
                { combo: 'Alt+O', description: 'Open Live Orders' },
                { combo: 'Alt+A', description: 'Open Analytics' },
                { combo: 'Alt+D', description: 'Open Dine In' },
                { combo: 'Alt+W', description: 'Open WhatsApp Direct' },
                { combo: '?', description: 'Show shortcut help' },
            ],
        },
    ]), []);

    const ownerDashboardShortcuts = useMemo(() => ([
        { key: 'm', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/manual-order') },
        { key: 'o', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/live-orders') },
        { key: 'a', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/analytics') },
        { key: 'd', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/dine-in') },
        { key: 'w', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/whatsapp-direct') },
    ]), [navigateWithShortcut]);

    useOwnerDashboardShortcuts({
        shortcuts: ownerDashboardShortcuts,
        onOpenHelp: () => setIsShortcutHelpOpen(true),
    });

    useEffect(() => {
        try {
            const storedBusinessType = normalizeBusinessType(localStorage.getItem('businessType'));
            if (storedBusinessType) {
                setBusinessType(storedBusinessType);
            }
        } catch {
            // Ignore localStorage access issues
        }
    }, []);

    useEffect(() => {
        const fetchAnalyticsData = async () => {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("User not authenticated");

                const cacheKey = [
                    'owner_analytics_v1',
                    activeDateFilter,
                    date?.from ? date.from.toISOString() : 'na',
                    date?.to ? date.to.toISOString() : 'na',
                    impersonatedOwnerId || 'self',
                    employeeOfOwnerId || 'none',
                ].join(':');

                const cachedRaw = sessionStorage.getItem(cacheKey);
                if (cachedRaw) {
                    const parsed = JSON.parse(cachedRaw);
                    if (parsed?.ts && (Date.now() - parsed.ts) < ANALYTICS_CACHE_TTL_MS && parsed?.payload) {
                        setAnalyticsData(parsed.payload);
                        const resolvedBusinessType = normalizeBusinessType(parsed.payload?.businessInfo?.businessType);
                        if (resolvedBusinessType) setBusinessType(resolvedBusinessType);
                        setLoading(false);
                        return;
                    }
                }

                setLoading(true);
                const idToken = await user.getIdToken();

                let url = new URL('/api/owner/analytics', window.location.origin);
                url.searchParams.append('filter', activeDateFilter);
                if (activeDateFilter === 'Custom Range' && date.from && date.to) {
                    url.searchParams.append('from', date.from.toISOString());
                    url.searchParams.append('to', date.to.toISOString());
                }
                if (impersonatedOwnerId) {
                    url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
                } else if (employeeOfOwnerId) {
                    url.searchParams.append('employee_of', employeeOfOwnerId);
                }

                const res = await fetch(url.toString(), {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || "Failed to fetch analytics");
                }

                const data = await res.json();
                setAnalyticsData(data);
                const resolvedBusinessType = normalizeBusinessType(data?.businessInfo?.businessType);
                if (resolvedBusinessType) setBusinessType(resolvedBusinessType);
                sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: data }));

            } catch (error) {
                console.error("Error fetching analytics data:", error);
                setInfoDialog({ isOpen: true, title: "Error", message: "Could not load analytics: " + error.message });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchAnalyticsData();
            else setLoading(false);
        });

        return () => unsubscribe();

    }, [activeDateFilter, date, impersonatedOwnerId, employeeOfOwnerId]);


    useEffect(() => {
        if (date?.from && date?.to) {
            setIsPopoverOpen(false);
        }
    }, [date]);

    const dateFilters = ["Today", "This Week", "This Month", "This Year"];

    const tabs = {
        sales: { label: "Sales Overview" },
        menu: { label: isStoreBusiness ? "Item Analytics" : "Menu Analytics" },
        customers: { label: "Customer Insights" },
        riders: { label: "Rider Analytics" },
        manual: { label: "Manual Orders" },
    };

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'sales':
                return <SalesOverview data={analyticsData?.salesData} loading={loading} isStoreBusiness={isStoreBusiness} />;
            case 'menu':
                return <MenuAnalytics data={analyticsData} loading={loading} isStoreBusiness={isStoreBusiness} />;
            case 'customers':
                return <CustomerRelationshipHub data={analyticsData} loading={loading} />;
            case 'riders':
                return <RiderAnalyticsHub data={analyticsData} loading={loading} />;
            case 'manual':
                return (
                    <ManualOrderAnalytics
                        date={date}
                        activeDateFilter={activeDateFilter}
                        impersonatedOwnerId={impersonatedOwnerId}
                        employeeOfOwnerId={employeeOfOwnerId}
                        onlineRevenue={analyticsData?.salesData?.kpis?.totalRevenue || 0}
                        isStoreBusiness={isStoreBusiness}
                    />
                );
            default:
                return null;
        }
    }


    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Growth Engine: Analytics</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">
                        {isStoreBusiness ? 'Store performance, demand, and product movement in one place.' : 'Your personal business advisor, now with deeper insights.'}
                    </p>
                </div>
                <div className="bg-card p-1 rounded-lg flex items-center gap-2 w-full md:w-auto overflow-x-auto border border-border">
                    <div className="flex gap-1 whitespace-nowrap">
                        {dateFilters.map(filter => (
                            <Button
                                key={filter}
                                variant="ghost"
                                onClick={() => setActiveDateFilter(filter)}
                                className={cn(
                                    'py-2 px-3 text-sm h-auto',
                                    activeDateFilter === filter ? 'bg-muted text-foreground' : 'text-muted-foreground',
                                    'transition-colors'
                                )}
                            >
                                {filter}
                            </Button>
                        ))}
                        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    id="date"
                                    variant={"ghost"}
                                    className={cn(
                                        "w-[260px] justify-start text-left font-normal py-2 px-3 text-sm h-auto",
                                        !date && "text-muted-foreground",
                                        activeDateFilter === 'Custom Range' ? 'bg-muted text-foreground' : 'text-muted-foreground',
                                    )}
                                    onClick={() => {
                                        setActiveDateFilter('Custom Range');
                                        setIsPopoverOpen(true);
                                    }}
                                >
                                    <CalendarDays className="mr-2 h-4 w-4" />
                                    {date?.from ? (
                                        date.to ? (
                                            <>
                                                {format(date.from, "LLL dd, y")} -{" "}
                                                {format(date.to, "LLL dd, y")}
                                            </>
                                        ) : (
                                            format(date.from, "LLL dd, y")
                                        )
                                    ) : (
                                        <span>Pick a date</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="end">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={date?.from}
                                    selected={date}
                                    onSelect={setDate}
                                    numberOfMonths={1}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </div>

            <div className="border-b border-border mb-6">
                <nav className="flex -mb-px space-x-2 md:space-x-6 overflow-x-auto">
                    {Object.entries(tabs).map(([key, { label }]) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`py-4 px-2 md:px-1 border-b-2 text-sm font-medium whitespace-nowrap ${activeTab === key
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-500'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            </div>

            <div>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        {renderActiveTab()}
                    </motion.div>
                </AnimatePresence>
            </div>

            <OwnerDashboardShortcutsDialog
                open={isShortcutHelpOpen}
                onOpenChange={setIsShortcutHelpOpen}
                sections={shortcutSections}
            />
        </div>
    );
}

export default function AnalyticsPage() {
    return (
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><GoldenCoinSpinner /></div>}>
            <AnalyticsPageContent />
        </Suspense>
    )
}
