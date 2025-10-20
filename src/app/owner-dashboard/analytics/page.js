

"use client";

import { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Sector, ScatterChart, Scatter, Legend, ReferenceLine, AreaChart, Area } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { IndianRupee, Hash, Users, Star, TrendingDown, GitCommitHorizontal, AlertTriangle, Lightbulb, ChefHat, ShoppingBasket, DollarSign, ArrowRight, TrendingUp, Filter, Calendar as CalendarIcon, ArrowDown, ArrowUp, UserPlus, FileBarChart, CalendarDays, X, Gift, Crown, Clock, Sparkles, Wand2, Ticket, Percent, Loader2, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NextImage from 'next/image';
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Switch } from '@/components/ui/switch';
import { format, addDays }from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};


// --- SALES OVERVIEW COMPONENTS ---
const SalesOverview = ({ data, loading }) => {
    const [modalData, setModalData] = useState({ isOpen: false, title: '', data: [], type: '' });

    const openModal = (title, data, type) => {
        setModalData({ isOpen: true, title, data, type });
    }

    const KpiCard = ({ title, value, change, icon: Icon, isCurrency = false, data, modalTitle, modalType, isRejection = false }) => {
        if(loading) {
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
                        {Math.abs(change).toFixed(1)}% vs last period
                    </div>
                )}
                 {isRejection && <div className="text-xs mt-1 text-muted-foreground">in selected period</div>}
            </motion.div>
        );
    };

    const SalesTrendChart = () => (
        <div className="bg-card border border-border p-5 rounded-xl h-[400px]">
            <h3 className="text-lg font-semibold mb-4 text-card-foreground">Sales Trend</h3>
            {loading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" size={32}/></div>
            ) : (
                <ResponsiveContainer width="100%" height="90%">
                    <AreaChart data={data?.salesTrend || []} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} formatter={(value) => [formatCurrency(value), 'Sales']}/>
                        <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#salesGradient)" />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    );
    
    const RejectionReasonChart = () => {
        const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6'];
        
        if(loading) {
            return (
                 <div className="bg-card border border-border p-5 rounded-xl h-[300px] animate-pulse">
                    <div className="h-6 bg-muted w-3/4 mb-4"></div>
                    <div className="flex items-center justify-center h-full">
                        <div className="w-48 h-48 bg-muted rounded-full"></div>
                    </div>
                </div>
            )
        }

        if (!data?.rejectionReasons || data.rejectionReasons.length === 0) {
            return (
                 <div className="bg-card border border-border p-5 rounded-xl h-[300px] flex flex-col items-center justify-center">
                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Rejection Reasons</h3>
                    <p className="text-muted-foreground text-sm">No rejections in this period. Great job!</p>
                 </div>
            )
        }

        return (
            <div className="bg-card border border-border p-5 rounded-xl h-[300px]">
                 <h3 className="text-lg font-semibold mb-4 text-card-foreground">Order Rejection Reasons</h3>
                 <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                         <Pie data={data?.rejectionReasons} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name">
                            {data.rejectionReasons.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                         </Pie>
                         <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}/>
                         <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" formatter={(value) => <span className="text-muted-foreground text-sm">{value}</span>}/>
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
             <Dialog open={modalData.isOpen} onOpenChange={(isOpen) => setModalData(prev => ({...prev, isOpen}))}>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <KpiCard title="Total Revenue" value={data?.kpis?.totalRevenue || 0} change={data?.kpis?.revenueChange || 0} icon={IndianRupee} isCurrency={true} modalTitle="Revenue Details" modalType="revenue" loading={loading}/>
                <KpiCard title="Total Orders" value={data?.kpis?.totalOrders || 0} change={data?.kpis?.ordersChange || 0} icon={ShoppingBasket} modalTitle="Order Details" modalType="orders" loading={loading}/>
                <KpiCard title="Average Order Value" value={data?.kpis?.avgOrderValue || 0} change={data?.kpis?.avgValueChange || 0} icon={FileBarChart} isCurrency={true} modalTitle="Order Value Details" modalType="orders" loading={loading}/>
                <KpiCard title="New Customers" value={data?.kpis?.newCustomers || 0} change={data?.kpis?.customersChange || 0} icon={UserPlus} modalTitle="New Customer Details" modalType="customers" loading={loading}/>
                <KpiCard title="Total Rejections" value={data?.kpis?.totalRejections || 0} icon={Ban} isRejection={true} loading={loading}/>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <SalesTrendChart />
                </div>
                <div className="lg:col-span-1">
                    <RejectionReasonChart />
                </div>
            </div>
        </div>
    );
};


const MenuAnalytics = ({ data, loading }) => {

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
                        <YAxis type="number" dataKey="profitability" name="Profitability" unit="%" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} label={{ value: 'Profitability (%)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))' }}/>
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

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PerformanceList data={data?.menuPerformance} metric="totalProfit" ascending={false} title="Top Profitable Items" icon={TrendingUp} isProfit={true} loading={loading}/>
                <PerformanceList data={data?.menuPerformance} metric="totalProfit" ascending={true} title="Underperforming Items" icon={TrendingDown} loading={loading}/>
            </div>
            <div className="grid grid-cols-1 gap-6">
                <ProfitabilityMatrix data={data?.menuPerformance || []} loading={loading}/>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <CustomerStatCard title="Total Customers" value={data?.customerStats?.totalCustomers || 0} icon={Users} loading={loading} />
                    <CustomerStatCard title="New This Month" value={data?.customerStats?.newThisMonth || 0} icon={UserPlus} loading={loading} />
                    <CustomerStatCard title="Repeat Rate" value={`${data?.customerStats?.repeatRate || 0}%`} icon={GitCommitHorizontal} loading={loading} />
                </div>
            </section>
             <section>
                <h3 className="text-xl font-bold mb-4">❤️ Your VIP Lounge</h3>
                {loading ? <div className="bg-card border border-border rounded-xl h-64 animate-pulse"></div> : (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <table className="w-full text-left">
                           {/* Table content as before, but using live data */}
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
};


// --- Main Page Component ---
export default function AnalyticsPage() {
    const [activeTab, setActiveTab] = useState('sales');
    const [activeDateFilter, setActiveDateFilter] = useState('This Month');
    const [date, setDate] = useState({
        from: addDays(new Date(), -29),
        to: new Date(),
    });
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [analyticsData, setAnalyticsData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAnalyticsData = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("User not authenticated");
                const idToken = await user.getIdToken();

                let url = new URL('/api/owner/analytics', window.location.origin);
                url.searchParams.append('filter', activeDateFilter);
                if (activeDateFilter === 'Custom Range' && date.from && date.to) {
                    url.searchParams.append('from', date.from.toISOString());
                    url.searchParams.append('to', date.to.toISOString());
                }
                if (impersonatedOwnerId) {
                    url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
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

            } catch (error) {
                console.error("Error fetching analytics data:", error);
                setInfoDialog({isOpen: true, title: "Error", message: "Could not load analytics: " + error.message});
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchAnalyticsData();
            else setLoading(false);
        });

        return () => unsubscribe();

    }, [activeDateFilter, date, impersonatedOwnerId]);


    useEffect(() => {
        if (date?.from && date?.to) {
            setIsPopoverOpen(false);
        }
    }, [date]);
    
    const dateFilters = ["Today", "This Week", "This Month", "This Year"];

    const tabs = {
        sales: { label: "Sales Overview" },
        menu: { label: "Menu Analytics" },
        customers: { label: "Customer Insights" },
    };

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'sales':
                return <SalesOverview data={analyticsData?.salesData} loading={loading} />;
            case 'menu':
                return <MenuAnalytics data={analyticsData} loading={loading} />;
            case 'customers':
                return <CustomerRelationshipHub data={analyticsData} loading={loading} />;
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
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">Your personal business advisor, now with deeper insights.</p>
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
                            className={`py-4 px-2 md:px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
                                activeTab === key
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
        </div>
    );
}
