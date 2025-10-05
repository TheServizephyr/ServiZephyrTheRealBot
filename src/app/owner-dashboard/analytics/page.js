"use client";

import { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Sector, ScatterChart, Scatter, Legend, ReferenceLine, AreaChart, Area } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { IndianRupee, Hash, Users, Star, TrendingDown, GitCommitHorizontal, AlertTriangle, Lightbulb, ChefHat, ShoppingBasket, DollarSign, ArrowRight, TrendingUp, Filter, Calendar as CalendarIcon, ArrowDown, ArrowUp, UserPlus, FileBarChart, CalendarDays, X, Gift, Crown, Clock, Sparkles, Wand2, Ticket, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NextImage from 'next/image';
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { format, addDays }from 'date-fns';


// --- DUMMY DATA ---
const menuPerformanceData = [
    // Momos
    { name: "Veg Fried Momos", category: "Momos", unitsSold: 210, price: 84, foodCost: 30, salesTrend: [15, 20, 18, 25, 30, 42, 60], imageUrl: "https://picsum.photos/seed/VFMomos/100/100", performanceChange: 12 },
    { name: "Paneer Fried Momos", category: "Momos", unitsSold: 180, price: 105, foodCost: 45, salesTrend: [12, 18, 15, 22, 28, 35, 49], imageUrl: "https://picsum.photos/seed/PFMomos/100/100", performanceChange: 8 },
    { name: "Kurkure Momos", category: "Momos", unitsSold: 150, price: 105, foodCost: 40, salesTrend: [10, 14, 12, 18, 20, 25, 31], imageUrl: "https://picsum.photos/seed/KMomos/100/100", performanceChange: 5 },
    // Tandoori Item
    { name: "Mia Khalifa Chaap", category: "Tandoori", unitsSold: 175, price: 189, foodCost: 70, salesTrend: [14, 16, 20, 22, 25, 30, 38], imageUrl: "https://picsum.photos/seed/MKChaap/100/100", performanceChange: 15 },
    { name: "Malai Chaap", category: "Tandoori", unitsSold: 160, price: 158, foodCost: 65, salesTrend: [12, 14, 16, 13, 18, 22, 25], imageUrl: "https://picsum.photos/seed/MalaiChaap/100/100", performanceChange: 9 },
    // Starters
    { name: "Chilli Paneer", category: "Starters", unitsSold: 140, price: 158, foodCost: 60, salesTrend: [8, 10, 9, 12, 15, 21, 15], imageUrl: "https://picsum.photos/seed/cpaneer/100/100", performanceChange: -5 },
    { name: "French Fries", category: "Starters", unitsSold: 95, price: 63, foodCost: 25, salesTrend: [5, 8, 7, 10, 12, 15, 13], imageUrl: "https://picsum.photos/seed/sroll/100/100", performanceChange: -18 },
    // Main Course
    { name: "Paneer Butter Masala", category: "Main Course", unitsSold: 220, price: 200, foodCost: 80, salesTrend: [20, 25, 22, 30, 35, 42, 46], imageUrl: "https://picsum.photos/seed/pbm/100/100", performanceChange: 18 },
    { name: "Dal Makhni", category: "Main Course", unitsSold: 190, price: 189, foodCost: 60, salesTrend: [18, 22, 20, 25, 30, 35, 40], imageUrl: "https://picsum.photos/seed/dal/100/100", performanceChange: 10 },
    { name: "Shahi Paneer", category: "Main Course", unitsSold: 160, price: 179, foodCost: 75, salesTrend: [15, 18, 16, 20, 25, 28, 38], imageUrl: "https://picsum.photos/seed/ShahiP/100/100", performanceChange: 7 },
    { name: "Korma Chaap", category: "Main Course", unitsSold: 80, price: 231, foodCost: 110, salesTrend: [7, 9, 8, 10, 12, 14, 20], imageUrl: "https://picsum.photos/seed/KormaC/100/100", performanceChange: -12 },
    // Breads
    { name: "Tandoori Roti", category: "Breads", unitsSold: 450, price: 10, foodCost: 4, salesTrend: [40, 45, 50, 55, 60, 80, 120], imageUrl: "https://picsum.photos/seed/proti/100/100", performanceChange: 25 },
    { name: "Butter Naan", category: "Breads", unitsSold: 350, price: 26, foodCost: 10, salesTrend: [30, 35, 40, 45, 50, 70, 80], imageUrl: "https://picsum.photos/seed/bnaan/100/100", performanceChange: 20 },
    // Rolls
    { name: "Paneer Tikka Roll", category: "Rolls", unitsSold: 130, price: 95, foodCost: 40, salesTrend: [10, 12, 15, 18, 20, 25, 30], imageUrl: "https://picsum.photos/seed/PTRoll/100/100", performanceChange: 22 },
    // Beverages (example)
    { name: "Coke", category: "Beverages", unitsSold: 85, price: 40, foodCost: 20, salesTrend: [10, 15, 12, 10, 8, 15, 15], imageUrl: "https://picsum.photos/seed/coke/100/100", performanceChange: -25 },
];


// Data processing to add calculated fields
const processedMenuData = menuPerformanceData.map(item => {
    const revenue = item.unitsSold * item.price;
    const totalCost = item.unitsSold * item.foodCost;
    const totalProfit = revenue - totalCost;
    const profitMargin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
    const popularity = item.unitsSold; // For matrix
    const profitability = profitMargin; // For matrix
    return { ...item, revenue, totalCost, totalProfit, profitMargin, popularity, profitability };
});

const formatCurrency = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const formatDate = (date) => new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });


// --- DYNAMIC SALES DATA GENERATION ---
const generateSalesData = (filter, dateRange) => {
    let kpis = { totalRevenue: 0, totalOrders: 0, newCustomers: 0, revenueChange: 0, ordersChange: 0, avgValueChange: 0, customersChange: 0 };
    let salesTrend = [];
    let heatmap = [];
    let paymentMethods = [{ name: 'Online', value: 0 }, { name: 'COD', value: 0 }];
    let transactions = [];
    let newCustomersList = [];

    let days = 1;
    if (filter === 'This Week') days = 7;
    if (filter === 'This Month') days = 30;
    if (filter === 'This Year') days = 365;
    if (filter === 'Custom Range' && dateRange?.from && dateRange?.to) {
        days = (dateRange.to - dateRange.from) / (1000 * 60 * 60 * 24) + 1;
    } else if (filter === 'Today') {
        days = 1;
    }


    for (let i = 0; i < days; i++) {
        const date = new Date();
        if (filter === 'Custom Range' && dateRange?.from) {
             date.setDate(dateRange.from.getDate() + i);
        } else {
             date.setDate(new Date().getDate() - (days - 1) + i);
        }
        
        const dailyOrders = 50 + Math.floor(Math.random() * 50);
        let dailyRevenue = 0;
        for (let j=0; j<dailyOrders; j++) {
            const orderValue = 100 + Math.random() * 500;
            dailyRevenue += orderValue;
            transactions.push({ id: `TRN-${Math.random().toString(36).substr(2, 9)}`, date: date.toISOString(), amount: orderValue, customer: "Customer " + j });
        }

        kpis.totalRevenue += dailyRevenue;
        kpis.totalOrders += dailyOrders;
        
        const dailyNewCustomers = Math.floor(Math.random() * 5);
        kpis.newCustomers += dailyNewCustomers;
        for (let k = 0; k < dailyNewCustomers; k++) {
            const customerName = `New Customer ${Math.random().toString(36).substr(2, 5)}`;
            newCustomersList.push({
                id: `CUST-${Math.random().toString(36).substr(2, 9)}`,
                name: customerName,
                joinDate: date.toISOString(),
                amount: 100 + Math.random() * 400
            });
        }


        if (filter === 'This Year') {
            const monthIndex = date.getMonth();
            if (!salesTrend[monthIndex]) salesTrend[monthIndex] = { day: date.toLocaleString('default', { month: 'short' }), sales: 0 };
            salesTrend[monthIndex].sales += dailyRevenue;
        } else if (filter === 'This Month' || filter === 'This Week' || filter === 'Today' || filter === 'Custom Range') {
             if (days > 7) {
                salesTrend.push({ day: format(date, 'dd/MM'), sales: dailyRevenue });
             } else {
                salesTrend.push({ day: format(date, 'EEE'), sales: dailyRevenue });
             }
        }
        
        if(filter === 'This Month' || (filter === 'Custom Range' && days > 1) ) {
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const firstDayOfWeek = startOfMonth.getDay();
            const emptyDays = Array(firstDayOfWeek).fill({ date: null, count: 0 });
            const monthData = Array.from({ length: daysInMonth(date.getMonth(), date.getFullYear()) }, (_, i) => {
                const currentDate = new Date(date.getFullYear(), date.getMonth(), i + 1);
                const dayData = transactions.find(t => new Date(t.date).toDateString() === currentDate.toDateString());
                return { date: currentDate.toISOString(), count: dayData ? dayData.amount : 0 };
            });
            heatmap = [...emptyDays, ...monthData];
        } else {
            heatmap.push({ date: date.toISOString().split('T')[0], count: dailyRevenue });
        }
    }
    
    function daysInMonth(month, year) {
        return new Date(year, month + 1, 0).getDate();
    }
    
    if(filter === 'This Year') salesTrend = salesTrend.filter(Boolean);
    
    kpis.avgOrderValue = kpis.totalOrders > 0 ? kpis.totalRevenue / kpis.totalOrders : 0;
    kpis.revenueChange = (Math.random() - 0.3) * 20;
    kpis.ordersChange = (Math.random() - 0.4) * 15;
    kpis.avgValueChange = (Math.random() - 0.5) * 10;
    kpis.customersChange = (Math.random() - 0.6) * 5;
    paymentMethods = [{ name: 'Online', value: 65 + Math.random() * 10 }, { name: 'COD', value: 25 + Math.random() * 10 }];

    return { kpis, salesTrend, heatmap, paymentMethods, transactions, newCustomersList };
};


// --- SALES OVERVIEW COMPONENTS ---
const SalesOverview = ({ activeDateFilter, dateRange }) => {
    const [salesData, setSalesData] = useState(null);
    const [modalData, setModalData] = useState({ isOpen: false, title: '', data: [], type: '' });

    useEffect(() => {
        setSalesData(generateSalesData(activeDateFilter, dateRange));
    }, [activeDateFilter, dateRange]);

    if (!salesData) {
        return <div className="text-center p-10 text-gray-400">Generating report...</div>;
    }

    const openModal = (title, data, type) => {
        setModalData({ isOpen: true, title, data, type });
    }

    const KpiCard = ({ title, value, change, icon: Icon, isCurrency = false, data, modalTitle, modalType }) => {
        const changeColor = change > 0 ? 'text-green-400' : 'text-red-400';
        const ChangeIcon = change > 0 ? ArrowUp : ArrowDown;
        return (
            <motion.div 
                className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl cursor-pointer"
                whileHover={{ y: -5, boxShadow: "0 4px 15px rgba(79, 70, 229, 0.4)" }}
                onClick={() => data && openModal(modalTitle, data, modalType)}
            >
                <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-400">{title}</p>
                    <Icon className="text-gray-500" />
                </div>
                <p className="text-3xl font-bold mt-2">{isCurrency ? formatCurrency(value) : Number(value).toLocaleString('en-IN')}</p>
                <div className={`flex items-center text-xs mt-1 ${changeColor}`}>
                    <ChangeIcon size={12} className="mr-1" />
                    {Math.abs(change).toFixed(1)}% vs last period
                </div>
            </motion.div>
        );
    };

    const SalesTrendChart = () => (
        <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl h-[400px]">
            <h3 className="text-lg font-semibold mb-4">Sales Trend</h3>
            <ResponsiveContainer width="100%" height="90%">
                <AreaChart data={salesData.salesTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} tickFormatter={(value) => isNaN(value) ? value : formatCurrency(value)} />
                    <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} formatter={(value) => [formatCurrency(value), 'Sales']}/>
                    <Area type="monotone" dataKey="sales" stroke="#6366f1" fillOpacity={1} fill="url(#salesGradient)" />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
    
    const RevenueHeatmap = () => {
        if(activeDateFilter !== 'This Month' && !(activeDateFilter === 'Custom Range' && dateRange.from && dateRange.to)) return <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl flex items-center justify-center text-gray-400 h-[300px]">Heatmap available for 'This Month' or 'Custom Range' view only.</div>;

        const maxCount = salesData.heatmap.length > 0 ? Math.max(...salesData.heatmap.map(d => d.count)) : 0;
        const getColor = (count) => {
            if (count === null || count === undefined) return 'rgba(255, 255, 255, 0.05)';
            const opacity = count > 0 ? 0.2 + (count / maxCount) * 0.8 : 0.05;
            return `rgba(34, 197, 94, ${opacity})`;
        };
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        return (
            <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl h-[300px]">
                 <h3 className="text-lg font-semibold mb-4">Revenue Heatmap</h3>
                 <div className="grid grid-cols-7 gap-2 text-center text-xs">
                     {days.map(day => <div key={day} className="text-gray-400">{day}</div>)}
                     {salesData.heatmap.map((day, index) => (
                         <div key={index}>
                             {day.date ? (
                                <div className="w-full aspect-square rounded-md" style={{ backgroundColor: getColor(day.count) }} title={`Sales on ${format(new Date(day.date), "LLL dd")}: ${formatCurrency(day.count)}`} />
                             ) : <div />}
                         </div>
                     ))}
                 </div>
            </div>
        );
    };
    
    const PaymentMethodsChart = () => {
        const [activeIndex, setActiveIndex] = useState(0);

        const onPieEnter = (_, index) => {
            setActiveIndex(index);
        };

        return (
            <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl">
                 <h3 className="text-lg font-semibold mb-4">Payment Methods</h3>
                 <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                         <Pie
                            activeIndex={activeIndex}
                            activeShape={(props) => {
                                const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
                                return (
                                    <g>
                                        <text x={cx} y={cy} dy={8} textAnchor="middle" fill="#fff" className="font-bold">{payload.name}</text>
                                        <Sector
                                            cx={cx}
                                            cy={cy}
                                            innerRadius={innerRadius}
                                            outerRadius={outerRadius + 5}
                                            startAngle={startAngle}
                                            endAngle={endAngle}
                                            fill={fill}
                                        />
                                    </g>
                                );
                            }}
                            data={salesData.paymentMethods}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                            onMouseEnter={onPieEnter}
                         >
                            <Cell fill="#4f46e5" />
                            <Cell fill="#fb923c" />
                         </Pie>
                         <Tooltip content={({ active, payload }) => {
                             if (active && payload && payload.length) {
                                return <div className="bg-gray-900 border border-gray-700 p-2 rounded-lg text-white text-sm">{`${payload[0].name}: ${payload[0].value.toFixed(1)}%`}</div>
                             }
                             return null;
                         }} />
                         <Legend iconType="circle" formatter={(value, entry) => <span className="text-gray-300">{value}</span>}/>
                    </PieChart>
                 </ResponsiveContainer>
            </div>
        );
    }
    
    const ModalContent = () => {
        const renderTable = () => {
            switch (modalData.type) {
                case 'customers':
                    return (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-gray-800">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Customer Name</th>
                                    <th scope="col" className="px-6 py-3">Join Date</th>
                                    <th scope="col" className="px-6 py-3 text-right">First Order Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modalData.data.map(item => (
                                    <tr key={item.id} className="border-b border-gray-700">
                                        <td className="px-6 py-4 font-medium">{item.name}</td>
                                        <td className="px-6 py-4">{formatDate(item.joinDate)}</td>
                                        <td className="px-6 py-4 text-right">{formatCurrency(item.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    );
                case 'orders':
                     return (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-gray-800">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Transaction ID</th>
                                    <th scope="col" className="px-6 py-3">Customer</th>
                                    <th scope="col" className="px-6 py-3">Date</th>
                                    <th scope="col" className="px-6 py-3 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modalData.data.map(item => (
                                    <tr key={item.id} className="border-b border-gray-700">
                                        <td className="px-6 py-4 font-medium">{item.id}</td>
                                        <td className="px-6 py-4">{item.customer}</td>
                                        <td className="px-6 py-4">{formatDate(item.date)}</td>
                                        <td className="px-6 py-4 text-right">{formatCurrency(item.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                     );
                case 'revenue':
                default:
                    return (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-gray-800">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Transaction ID</th>
                                    <th scope="col" className="px-6 py-3">Date</th>
                                    <th scope="col" className="px-6 py-3 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modalData.data.map(item => (
                                    <tr key={item.id} className="border-b border-gray-700">
                                        <td className="px-6 py-4 font-medium">{item.id}</td>
                                        <td className="px-6 py-4">{formatDate(item.date)}</td>
                                        <td className="px-6 py-4 text-right">{formatCurrency(item.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    );
            }
        };

        return (
             <Dialog open={modalData.isOpen} onOpenChange={(isOpen) => setModalData(prev => ({...prev, isOpen}))}>
                <DialogContent className="max-w-3xl bg-gray-900 border-gray-700 text-white">
                    <DialogHeader>
                        <DialogTitle>{modalData.title}</DialogTitle>
                        <DialogDescription>Detailed view for the selected period.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto">
                        {renderTable()}
                    </div>
                </DialogContent>
            </Dialog>
        );
    }


    return (
        <div className="space-y-6">
            <ModalContent />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard title="Total Revenue" value={salesData.kpis.totalRevenue} change={salesData.kpis.revenueChange} icon={IndianRupee} isCurrency={true} data={salesData.transactions} modalTitle="Revenue Details" modalType="revenue"/>
                <KpiCard title="Total Orders" value={salesData.kpis.totalOrders} change={salesData.kpis.ordersChange} icon={ShoppingBasket} data={salesData.transactions} modalTitle="Order Details" modalType="orders" />
                <KpiCard title="Average Order Value" value={salesData.kpis.avgOrderValue} change={salesData.kpis.avgValueChange} icon={FileBarChart} isCurrency={true} data={salesData.transactions} modalTitle="Order Value Details" modalType="orders"/>
                <KpiCard title="New Customers" value={salesData.kpis.newCustomers} change={salesData.kpis.customersChange} icon={UserPlus} data={salesData.newCustomersList} modalTitle="New Customer Details" modalType="customers" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <SalesTrendChart />
                </div>
                <div className="lg:col-span-1 space-y-6">
                    <RevenueHeatmap />
                    <PaymentMethodsChart />
                </div>
            </div>
        </div>
    );
};


// --- ADVANCED MENU ANALYTICS COMPONENTS ---

const PerformanceList = ({ data, metric, ascending = false, title, icon: Icon, isProfit = false }) => {
    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => ascending ? a[metric] - b[metric] : b[metric] - a[metric]).slice(0, 5);
    }, [data, metric, ascending]);

    const PerformanceIndicator = ({ value }) => {
        const isPositive = value > 0;
        const Arrow = isPositive ? ArrowUp : ArrowDown;
        const color = isPositive ? 'text-green-400' : 'text-red-400';
        return (
            <div className={`flex items-center text-xs ${color}`}>
                <Arrow size={12} className="mr-1" />
                {Math.abs(value)}%
            </div>
        )
    };

    return (
        <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl h-full">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Icon className={isProfit ? "text-green-400" : "text-red-400"} />
                {title}
            </h3>
            <div className="space-y-3">
                {sortedData.map(item => (
                     <div key={item.name} className="flex flex-col sm:flex-row items-start gap-3 p-3 rounded-lg bg-gray-700/50">
                         <NextImage src={item.imageUrl} alt={item.name} width={48} height={48} className="rounded-md object-cover flex-shrink-0" />
                         <div className="flex-grow w-full">
                             <p className="font-semibold text-white text-sm">{item.name}</p>
                             <div className="flex flex-wrap justify-between items-center text-xs mt-2 text-gray-300 gap-2">
                                 <div className="flex-shrink-0">
                                     <p className="text-gray-400 text-xs">Units Sold</p>
                                     <strong className="text-white text-sm">{item.unitsSold}</strong>
                                 </div>
                                 <div className="text-right flex-shrink-0">
                                    <p className="text-gray-400 text-xs">Total Profit</p>
                                    <span className="font-bold text-base text-green-400">{formatCurrency(item.totalProfit)}</span>
                                 </div>
                                 <div className="text-right flex-shrink-0">
                                     <p className="text-gray-400 text-xs">vs last period</p>
                                     <PerformanceIndicator value={item.performanceChange} />
                                 </div>
                             </div>
                         </div>
                     </div>
                ))}
            </div>
        </div>
    );
};

const ItemSalesTrendChart = ({ data }) => {
    const top5ByProfit = useMemo(() => data.sort((a,b) => b.totalProfit - a.totalProfit).slice(0, 5), [data]);
    
    const chartData = useMemo(() => {
        const days = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
        return days.map((day, i) => {
            const entry = { day };
            top5ByProfit.forEach(item => {
                entry[item.name] = item.salesTrend[i];
            });
            return entry;
        });
    }, [top5ByProfit]);

    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#00C49F'];

    return (
        <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl">
             <h3 className="font-semibold text-white mb-4">Top 5 Items Sales Trend (by Profit)</h3>
            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} label={{ value: 'Units Sold', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} />
                    <Legend wrapperStyle={{fontSize: "12px"}}/>
                    {top5ByProfit.map((item, index) => (
                        <Line key={item.name} type="monotone" dataKey={item.name} stroke={colors[index % colors.length]} strokeWidth={2} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

const CategoryDeepDive = ({ data }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState(null);

    const categoryData = useMemo(() => {
        const categoryMap = data.reduce((acc, item) => {
            if (!acc[item.category]) {
                acc[item.category] = { name: item.category, revenue: 0, items: [] };
            }
            acc[item.category].revenue += item.revenue;
            acc[item.category].items.push(item);
            return acc;
        }, {});
        const categories = Object.values(categoryMap).sort((a,b) => b.revenue - a.revenue);
        // Set initial selected category if not already set
        if (categories.length > 0 && !selectedCategory) {
            setSelectedCategory(categories[0].name);
        }
        return categories;
    }, [data, selectedCategory]);

    const onPieEnter = (_, index) => setActiveIndex(index);
    const onPieClick = (data) => setSelectedCategory(data.payload.name);

    const COLORS = ['#4f46e5', '#a78bfa', '#facc15', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
    
    const itemsInCategory = useMemo(() => {
        if(!selectedCategory) return [];
        return data.filter(item => item.category === selectedCategory).sort((a,b) => b.totalProfit - a.totalProfit);
    }, [data, selectedCategory]);

    return (
        <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl lg:col-span-3">
            <h3 className="font-semibold text-white mb-4">Category Deep Dive</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1 h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                activeIndex={activeIndex}
                                activeShape={(props) => {
                                    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
                                    return (
                                        <g>
                                            <text x={cx} y={cy - 10} dy={8} textAnchor="middle" fill="#fff" className="text-sm font-bold">{payload.name}</text>
                                            <text x={cx} y={cy + 15} dy={8} textAnchor="middle" fill="#9ca3af" className="text-xs">{formatCurrency(payload.revenue)}</text>
                                            <Cell {...props} cornerRadius={5} />
                                        </g>
                                    );
                                }}
                                data={categoryData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="revenue"
                                onMouseEnter={onPieEnter}
                                onClick={onPieClick}
                                paddingAngle={5}
                            >
                                {categoryData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="cursor-pointer outline-none" strokeWidth={activeIndex === index ? 1 : 0} stroke={'white'} />
                                ))}
                            </Pie>
                            <Tooltip content={<div style={{display: 'none'}} />} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="md:col-span-2">
                    <h4 className="font-semibold text-white mb-2 text-sm md:text-base">Items in '{selectedCategory}'</h4>
                    <div className="overflow-auto max-h-[220px]">
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-gray-800">
                                <tr>
                                    <th className="p-2">Item</th>
                                    <th className="p-2 text-right">Revenue</th>
                                    <th className="p-2 text-right">Cost</th>
                                    <th className="p-2 text-right">Profit</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {itemsInCategory.map(item => (
                                    <tr key={item.name}>
                                        <td className="p-2 font-medium text-white">{item.name}</td>
                                        <td className="p-2 text-right text-gray-300">{formatCurrency(item.revenue)}</td>
                                        <td className="p-2 text-right text-gray-400">{formatCurrency(item.totalCost)}</td>
                                        <td className="p-2 text-right font-bold text-green-400">{formatCurrency(item.totalProfit)}</td>
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

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-lg text-white">
        <p className="font-bold text-base mb-2">{data.name}</p>
        <p className="text-sm"><span className="font-semibold text-gray-400">Popularity:</span> {data.popularity} units</p>
        <p className="text-sm"><span className="font-semibold text-gray-400">Profitability:</span> {data.profitability.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
};


const ProfitabilityMatrix = ({ data }) => {
    const avgPopularity = useMemo(() => data.reduce((sum, item) => sum + item.popularity, 0) / data.length, [data]);
    const avgProfitability = useMemo(() => data.reduce((sum, item) => sum + item.profitability, 0) / data.length, [data]);

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
    const legendPayload = [
        { value: 'Superstars (High Profit, High Popularity)', type: 'square', color: quadrantColors.Superstar },
        { value: 'Workhorses (Low Profit, High Popularity)', type: 'square', color: quadrantColors.Workhorse },
        { value: 'Puzzles (High Profit, Low Popularity)', type: 'square', color: quadrantColors.Puzzle },
        { value: 'Deadweights (Low Profit, Low Popularity)', type: 'square', color: quadrantColors.Deadweight },
    ];

    return (
         <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl lg:col-span-3">
            <h3 className="font-semibold text-white mb-4">Profitability Matrix</h3>
            <ResponsiveContainer width="100%" height={350}>
                <ScatterChart margin={{ top: 20, right: 120, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                    <XAxis type="number" dataKey="popularity" name="Popularity" unit=" units" tick={{ fill: '#9CA3AF', fontSize: 12 }} label={{ value: 'Popularity (Units Sold)', position: 'bottom', fill: '#9CA3AF', dy: 20 }} />
                    <YAxis type="number" dataKey="profitability" name="Profitability" unit="%" tick={{ fill: '#9CA3AF', fontSize: 12 }} label={{ value: 'Profitability (%)', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}/>
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
                    <ReferenceLine y={avgProfitability} stroke="white" strokeDasharray="3 3" />
                    <ReferenceLine x={avgPopularity} stroke="white" strokeDasharray="3 3" />
                    <Legend layout="vertical" verticalAlign="top" align="right" wrapperStyle={{ fontSize: '12px', right: -20, top: 20 }} payload={legendPayload} />
                    {Object.keys(quadrantData).map(quad => (
                       <Scatter key={quad} name={quad} data={quadrantData[quad]} fill={quadrantColors[quad]} />
                    ))}
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
};


// --- CUSTOMER RELATIONSHIP HUB COMPONENTS ---

// This is a minimal coupon modal for the analytics page.
const CouponModal = ({ isOpen, setIsOpen, customerName, onSave }) => {
    const [coupon, setCoupon] = useState(null);

    useEffect(() => {
        if(isOpen) {
            setCoupon({
                code: '', description: `Special reward for ${customerName}`, type: 'flat', value: '',
                minOrder: '', startDate: new Date(), expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                status: 'Active',
            });
        }
    }, [isOpen, customerName]);

    const handleChange = (field, value) => {
        setCoupon(prev => (prev ? { ...prev, [field]: value } : null));
    };
    
    const generateRandomCode = () => {
        const code = `VIP-${customerName.split(' ')[0].toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        handleChange('code', code);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!coupon.code || !coupon.value) {
            alert('Please generate a code and enter a value.');
            return;
        }
        // In a real app, you would save this coupon to the backend
        console.log("Saving coupon:", coupon);
        alert(`Coupon "${coupon.code}" created for ${customerName}!`);
        setIsOpen(false);
    };

    if(!coupon) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md bg-gray-900 border-gray-700 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Ticket /> Create a Reward
                        </DialogTitle>
                        <DialogDescription>Sending a special reward to {customerName}.</DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid gap-y-4 py-6">
                         <div>
                            <Label htmlFor="code">Coupon Code</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                                <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2"/> Generate</Button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="value">Discount Value (₹)</Label>
                                <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder="e.g., 100" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                            </div>
                            <div>
                                <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                            </div>
                        </div>
                         <div>
                            <Label>Expiry Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                   <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {coupon.expiryDate ? format(coupon.expiryDate, 'dd MMM yyyy') : <span>Pick a date</span>}
                                   </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.expiryDate} onSelect={(date) => handleChange('expiryDate', date)} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                    </div>

                    <DialogFooter className="pt-4">
                        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">Send Reward</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const CustomerStatCard = ({ title, value, icon: Icon, detail, onClick }) => (
    <div 
        className={cn("bg-gray-800/50 border border-gray-700 p-5 rounded-xl", onClick && "cursor-pointer hover:bg-gray-700/50")}
        onClick={onClick}
    >
        <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{title}</p>
            <Icon className="text-gray-500" />
        </div>
        <p className="text-3xl font-bold mt-2">{value}</p>
        {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
);

const ActivePie = (props) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
    return (
        <g>
            <text x={cx} y={cy-10} dy={8} textAnchor="middle" fill="#fff" className="font-bold text-sm">{payload.name}</text>
            <text x={cx} y={cy+10} dy={8} textAnchor="middle" fill="#9ca3af" className="text-xs">{`(${(payload.percent * 100).toFixed(0)}%)`}</text>
            <Sector {...props} cornerRadius={5} />
        </g>
    );
};

const CustomerRelationshipHub = () => {
    const [listModalData, setListModalData] = useState({ isOpen: false, title: '', data: [] });
    const [couponModalData, setCouponModalData] = useState({ isOpen: false, customerName: '' });

    const openListModal = (title, data) => {
        setListModalData({ isOpen: true, title, data });
    }
    
    const openCouponModal = (customerName) => {
        setCouponModalData({ isOpen: true, customerName });
    };

    // Dummy Data for Customer Hub
    const customerData = useMemo(() => {
        const allCustomers = Array.from({ length: 854 }, (_, i) => ({
            id: `CUST-${i + 1}`,
            name: `Customer ${i + 1}`,
            totalSpend: 500 + Math.random() * 20000,
            totalOrders: 1 + Math.floor(Math.random() * 20),
            joinDate: addDays(new Date(), -Math.floor(Math.random() * 365)).toISOString(),
        }));
        const newThisMonth = allCustomers.filter(c => new Date(c.joinDate) > addDays(new Date(), -30));
        const repeatCustomers = allCustomers.filter(c => c.totalOrders > 1);
        
        return { allCustomers, newThisMonth, repeatCustomers };
    }, []);

    const customerStats = {
        totalCustomers: customerData.allCustomers.length,
        newThisMonth: customerData.newThisMonth.length,
        repeatRate: Math.round((customerData.repeatCustomers.length / customerData.allCustomers.length) * 100),
        newVsReturning: [{ name: 'New', value: 350 }, { name: 'Returning', value: 650 }]
    };
    
    const vipCustomers = [...customerData.allCustomers].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 5);

    const smartAlerts = [
        { type: 'churn', icon: AlertTriangle, color: 'text-yellow-400', message: "Rohan Sharma hasn't ordered in 10 days.", buttonText: 'Send "We Miss You" Offer' },
        { type: 'milestone', icon: Sparkles, color: 'text-indigo-400', message: "Priya Singh just completed her 10th order!", buttonText: 'Send "Thank You" Reward' },
        { type: 'high_value', icon: Crown, color: 'text-green-400', message: "Ankit Kumar has spent over ₹5000 this month.", buttonText: 'Make VIP & Send Offer' }
    ];
    
    const peakHoursData = Array.from({ length: 12 }, (_, i) => ({
      hour: `${i + 9} ${i + 9 < 12 ? 'AM' : 'PM'}`,
      orders: Math.floor(Math.random() * 50) + 10,
    }));
    
    const heatmapData = useMemo(() => {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const hours = Array.from({ length: 12 }, (_, i) => `${i + 9}:00`); // 9 AM to 8 PM
        return days.flatMap(day =>
            hours.map(hour => ({
                day,
                hour,
                value: Math.floor(Math.random() * 100)
            }))
        );
    }, []);
    const maxHeatmapValue = Math.max(...heatmapData.map(d => d.value));

    const ListModalContent = () => (
        <Dialog open={listModalData.isOpen} onOpenChange={(isOpen) => setListModalData(prev => ({...prev, isOpen}))}>
            <DialogContent className="max-w-3xl bg-gray-900 border-gray-700 text-white">
                <DialogHeader>
                    <DialogTitle>{listModalData.title}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-400 uppercase bg-gray-800">
                            <tr>
                                <th scope="col" className="px-6 py-3">Customer Name</th>
                                <th scope="col" className="px-6 py-3">Total Orders</th>
                                <th scope="col" className="px-6 py-3 text-right">Total Spend</th>
                            </tr>
                        </thead>
                        <tbody>
                            {listModalData.data.map(item => (
                                <tr key={item.id} className="border-b border-gray-700">
                                    <td className="px-6 py-4 font-medium">{item.name}</td>
                                    <td className="px-6 py-4">{item.totalOrders}</td>
                                    <td className="px-6 py-4 text-right">{formatCurrency(item.totalSpend)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </DialogContent>
        </Dialog>
    );

    return (
        <div className="space-y-8">
            <ListModalContent />
            <CouponModal 
                isOpen={couponModalData.isOpen} 
                setIsOpen={(isOpen) => setCouponModalData(prev => ({...prev, isOpen}))}
                customerName={couponModalData.customerName}
            />

            {/* Section 1: Customer Snapshot */}
            <section>
                <h3 className="text-xl font-bold mb-4">Customer Snapshot</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <CustomerStatCard title="Total Customers" value={customerStats.totalCustomers} icon={Users} onClick={() => openListModal("All Customers", customerData.allCustomers, 'customerList')} />
                    <CustomerStatCard title="New This Month" value={customerStats.newThisMonth} icon={UserPlus} onClick={() => openListModal("New Customers This Month", customerData.newThisMonth, 'customerList')} />
                    <CustomerStatCard title="Repeat Rate" value={`${customerStats.repeatRate}%`} icon={GitCommitHorizontal} onClick={() => openListModal("Repeat Customers", customerData.repeatCustomers, 'customerList')} />
                    <div className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl flex flex-col justify-center items-center">
                         <h4 className="font-semibold text-sm text-gray-400 mb-2 text-center">New vs. Returning Orders</h4>
                         <ResponsiveContainer width="100%" height={120}>
                            <PieChart>
                                <Pie data={customerStats.newVsReturning} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} activeShape={ActivePie} activeIndex={0}>
                                    <Cell fill="#4f46e5" />
                                    <Cell fill="#fb923c" />
                                </Pie>
                                <Tooltip content={<div style={{display: 'none'}} />}/>
                                <Legend iconType="circle" wrapperStyle={{fontSize: '12px'}} formatter={(value) => <span className="text-gray-300">{value}</span>}/>
                            </PieChart>
                         </ResponsiveContainer>
                    </div>
                </div>
            </section>
            
            {/* Section 2: VIP Lounge */}
            <section>
                <h3 className="text-xl font-bold mb-4">❤️ Your VIP Lounge</h3>
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-800">
                            <tr>
                                <th className="p-4 text-sm font-semibold text-gray-400">Rank</th>
                                <th className="p-4 text-sm font-semibold text-gray-400">Customer</th>
                                <th className="p-4 text-sm font-semibold text-gray-400">Total Spend</th>
                                <th className="p-4 text-sm font-semibold text-gray-400">Total Orders</th>
                                <th className="p-4 text-sm font-semibold text-gray-400 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {vipCustomers.map((cust, i) => (
                                <tr key={cust.name} className="hover:bg-gray-700/50 transition-colors">
                                    <td className="p-4"><span className="font-bold text-lg">{i + 1}</span></td>
                                    <td className="p-4 font-semibold">{cust.name}</td>
                                    <td className="p-4 text-green-400 font-bold">{formatCurrency(cust.totalSpend)}</td>
                                    <td className="p-4">{cust.totalOrders}</td>
                                    <td className="p-4 text-center">
                                        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500" onClick={() => openCouponModal(cust.name)}>
                                            <Gift size={16} className="mr-2"/> Send Reward
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

             {/* Section 3: Smart Alert System */}
            <section>
                <h3 className="text-xl font-bold mb-4">🔔 The Smart Alert System</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {smartAlerts.map(alert => (
                        <div key={alert.type} className="bg-gray-800/50 border border-gray-700 p-5 rounded-xl flex flex-col">
                            <div className="flex items-center gap-3 mb-3">
                                <alert.icon size={20} className={alert.color} />
                                <p className="font-semibold">{alert.message}</p>
                            </div>
                            <Button size="sm" className="w-full mt-auto bg-gray-700 hover:bg-gray-600">{alert.buttonText}</Button>
                        </div>
                    ))}
                </div>
            </section>

             {/* Section 4: Peak Hours & Heatmap */}
            <section>
                 <h3 className="text-xl font-bold mb-4">📈 Peak Hours & Heatmap</h3>
                 <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                     <div className="lg:col-span-3 bg-gray-800/50 border border-gray-700 p-5 rounded-xl">
                        <h4 className="font-semibold text-sm text-gray-400 mb-4">Peak Order Times</h4>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={peakHoursData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                                <XAxis dataKey="hour" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                                <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} formatter={(value) => [value, 'Orders']}/>
                                <Bar dataKey="orders" fill="#8884d8" />
                            </BarChart>
                        </ResponsiveContainer>
                     </div>
                     <div className="lg:col-span-2 bg-gray-800/50 border border-gray-700 p-5 rounded-xl">
                        <h4 className="font-semibold text-sm text-gray-400 mb-4">Weekly Order Heatmap</h4>
                        <div className="grid grid-cols-7 gap-1">
                            {heatmapData.slice(0, 7).map(d => <div key={d.day} className="text-center text-xs text-gray-400">{d.day}</div>)}
                            {heatmapData.map((d, i) => (
                                <div 
                                    key={i} 
                                    className="w-full aspect-square rounded-sm"
                                    style={{ backgroundColor: `rgba(34, 197, 94, ${d.value / maxHeatmapValue})` }}
                                    title={`${d.day} at ${d.hour}: ${d.value} orders`}
                                />
                            ))}
                        </div>
                     </div>
                 </div>
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
        inventory: { label: "Inventory & Profit" },
    };

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'sales':
                return <SalesOverview activeDateFilter={activeDateFilter} dateRange={date} />;
            case 'menu':
                return (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <PerformanceList data={processedMenuData} metric="totalProfit" ascending={false} title="Top Profitable Items" icon={TrendingUp} isProfit={true}/>
                            <PerformanceList data={processedMenuData} metric="totalProfit" ascending={true} title="Underperforming Items" icon={TrendingDown} />
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                            <ItemSalesTrendChart data={processedMenuData} />
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                            <CategoryDeepDive data={processedMenuData} />
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                            <ProfitabilityMatrix data={processedMenuData} />
                        </div>
                    </div>
                );
            case 'customers':
                return <CustomerRelationshipHub />;
            case 'inventory':
                 return <div className="text-center p-10 text-gray-500">Inventory & Profit Coming Soon...</div>;
            default:
                return null;
        }
    }


    return (
        <div className="p-4 md:p-6 text-white min-h-screen bg-gray-900">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Growth Engine: Analytics</h1>
                    <p className="text-gray-400 mt-1 text-sm md:text-base">Your personal business advisor, now with deeper insights.</p>
                </div>
                 <div className="bg-gray-800/80 p-1 rounded-lg flex items-center gap-2 w-full md:w-auto overflow-x-auto">
                     <div className="flex gap-1 whitespace-nowrap">
                        {dateFilters.map(filter => (
                            <Button 
                                key={filter}
                                variant="ghost"
                                onClick={() => setActiveDateFilter(filter)}
                                className={cn(
                                    'py-2 px-3 text-sm h-auto',
                                    activeDateFilter === filter ? 'bg-gray-700 text-white' : 'text-gray-400',
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
                                     activeDateFilter === 'Custom Range' ? 'bg-gray-700 text-white' : 'text-gray-400',
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

            <div className="border-b border-gray-700 mb-6">
                <nav className="flex -mb-px space-x-2 md:space-x-6 overflow-x-auto">
                    {Object.entries(tabs).map(([key, { label }]) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`py-4 px-2 md:px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
                                activeTab === key
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
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
