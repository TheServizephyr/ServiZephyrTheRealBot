

"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Plus, Tag, XCircle, ArrowUpRight, IndianRupee, Hash, Users, ListFilter, Bot, Ban } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Image from 'next/image';
import Link from 'next/link';
import InfoDialog from '@/components/InfoDialog';

// Helper function to format currency
const formatCurrency = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

// --- Individual Components Defined in One File ---

// 1. Summary Stat Card Component
const StatCard = ({ title, value, icon, change, isCurrency = false, isLoading = false, isRejection = false }) => {
  const Icon = icon;
  
  if (isLoading) {
    return (
        <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
            <div className="h-8 bg-muted rounded w-1/2 mb-3"></div>
            <div className="h-3 bg-muted rounded w-1/2"></div>
        </div>
    )
  }
  
  return (
    <motion.div
      className={cn("bg-card border border-border rounded-xl p-5 flex flex-col justify-between", isRejection && "bg-red-500/10 border-red-500/50")}
      whileHover={{ scale: 1.03, backgroundColor: 'hsl(var(--muted))' }}
    >
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <Icon className={cn("text-muted-foreground", isRejection && "text-red-400")} size={20} />
      </div>
      <div className="mt-2">
        <span className="text-2xl md:text-3xl font-bold text-foreground">
          {isCurrency ? formatCurrency(value) : Number(value).toLocaleString('en-IN')}
        </span>
      </div>
       { !isRejection ? (
            <div className="mt-3 flex items-center text-xs">
                <span className={cn('flex items-center', change > 0 ? 'text-green-400' : 'text-red-400')}>
                    <ArrowUpRight size={14} className={cn('mr-1', change < 0 && 'rotate-180')} />
                    {Math.abs(change)}%
                </span>
                <span className="text-muted-foreground ml-1">vs last period</span>
            </div>
        ) : (
            <div className="mt-3 text-xs text-muted-foreground">in selected period</div>
        )}
    </motion.div>
  );
};


// 2. Live Order Feed Component
const LiveOrderFeed = ({ orders, isLoading }) => {
  const router = useRouter();

  if (isLoading) {
    return (
        <div className="bg-card border border-border rounded-xl p-5 h-[380px] flex flex-col">
          <div className="h-6 bg-muted rounded w-2/4 mb-4 animate-pulse"></div>
          <div className="space-y-2 animate-pulse">
            <div className="h-16 bg-muted/50 rounded-lg"></div>
            <div className="h-16 bg-muted/50 rounded-lg"></div>
            <div className="h-16 bg-muted/50 rounded-lg"></div>
            <div className="h-16 bg-muted/50 rounded-lg"></div>
          </div>
        </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] flex flex-col">
      <h3 className="text-lg font-semibold text-foreground mb-4">🔥 Live Order Feed</h3>
      <div className="overflow-y-auto pr-2 flex-grow">
        
          {orders && orders.length > 0 ? orders.map((order, index) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg mb-2",
                index === 0 ? "bg-primary/10 border-l-4 border-primary" : "bg-muted/50"
              )}
            >
              <div>
                <p className="font-semibold text-foreground text-sm truncate max-w-[120px] sm:max-w-none">{order.id}</p>
                <p className="text-sm text-muted-foreground">{order.customer}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-foreground">{formatCurrency(order.amount)}</p>
                <button 
                  onClick={() => router.push('/owner-dashboard/live-orders')}
                  className="text-xs text-primary hover:text-primary/80 font-semibold mt-1">
                  View Details
                </button>
              </div>
            </motion.div>
          )) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                No live orders right now.
            </div>
          )}
        
      </div>
      <audio id="notification-sound" src="/notification.mp3" preload="auto" />
    </div>
  );
};


// 3. Sales Bar Chart Component
const SalesChart = ({ salesData, isLoading }) => {
  if (isLoading) {
     return (
        <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-pulse">
            <div className="h-6 bg-muted rounded w-2/4 mb-4"></div>
            <div className="h-full w-full bg-muted/50 rounded-lg"></div>
        </div>
     )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] flex flex-col">
       <h3 className="text-lg font-semibold text-foreground mb-4">📈 Weekly Sales</h3>
       <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={salesData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(value) => `₹${value/1000}k`} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--primary) / 0.1)' }}
              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--popover-foreground))' }}
              labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              formatter={(value) => [formatCurrency(value), 'Sales']}
            />
            <Bar dataKey="sales" fill="hsl(var(--primary) / 0.8)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
       </div>
    </div>
  );
};


// 4. Top Selling Item Component
const TopSellingItem = ({ name, count, imageUrl }) => (
  <div className="flex-shrink-0 w-36 sm:w-48 mr-4 text-center">
    <div className="relative w-full h-28 sm:h-32 rounded-lg overflow-hidden border-2 border-border">
        <Image src={imageUrl} alt={name} layout="fill" objectFit="cover" />
    </div>
    <p className="mt-2 font-semibold text-foreground truncate text-sm sm:text-base">{name}</p>
    <p className="text-xs text-primary">{count} times today</p>
  </div>
);

const BotOnboardingNudge = () => {
    return (
        <motion.div
            className="bg-primary/10 border-2 border-dashed border-primary/50 rounded-xl p-6 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
        >
            <Bot size={40} className="mx-auto text-primary" />
            <h3 className="mt-4 text-xl font-bold text-foreground">Your next step: Connect your first WhatsApp Bot!</h3>
            <p className="mt-2 text-muted-foreground max-w-lg mx-auto">
                Unlock direct orders and marketing by connecting your business WhatsApp number. The setup takes less than 5 minutes.
            </p>
            <Link href="/owner-dashboard/connections" passHref>
                <motion.button
                    className="mt-6 bg-primary text-primary-foreground font-bold py-3 px-6 rounded-lg text-md hover:bg-primary/90 transition-transform transform hover:scale-105"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                >
                    Connect WhatsApp Bot Now
                </motion.button>
            </Link>
        </motion.div>
    );
};


// --- Main Dashboard Page Component ---

function PageContent() {
  const [activeFilter, setActiveFilter] = useState('Today');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [botCount, setBotCount] = useState(0);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const router = useRouter();
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  useEffect(() => {
    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) {
              console.error("User not authenticated");
              setLoading(false);
              return;
            }

            const idToken = await user.getIdToken(true);
            
            // API URLs
            let dashboardApiUrl = `/api/owner/dashboard-data?filter=${activeFilter}`;
            if (impersonatedOwnerId) {
                dashboardApiUrl += `&impersonate_owner_id=${impersonatedOwnerId}`;
            }

            let connectionsApiUrl = '/api/owner/connections';
            if (impersonatedOwnerId) {
                connectionsApiUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
            }
            
            // Fetch both endpoints concurrently
            const [dashboardRes, connectionsRes] = await Promise.all([
                fetch(dashboardApiUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }),
                fetch(connectionsApiUrl, { headers: { 'Authorization': `Bearer ${idToken}` } })
            ]);

            if (!dashboardRes.ok || !connectionsRes.ok) {
                 const errorData = !dashboardRes.ok ? await dashboardRes.json() : await connectionsRes.json();
                 throw new Error(errorData.message || 'Failed to fetch initial data');
            }

            const dashboardData = await dashboardRes.json();
            const connectionsData = await connectionsRes.json();
            
            setDashboardData(dashboardData);
            setBotCount(connectionsData.connections?.length || 0);

        } catch (error) {
            console.error("Error fetching initial data:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Error: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };
    
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        fetchInitialData();
      } else {
        setLoading(false);
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [activeFilter, router, impersonatedOwnerId]);

  return (
    <div className="text-foreground min-h-full p-4 md:p-6">
      <InfoDialog 
          isOpen={infoDialog.isOpen} 
          onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
          title={infoDialog.title} 
          message={infoDialog.message}
      />
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>

        {/* Global Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-4 md:mb-0">Business Command Center</h1>
          <div className="flex items-center bg-card p-1 rounded-lg border border-border">
            {['Today', 'This Week', 'This Month'].map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  'px-3 py-1.5 text-sm font-semibold rounded-md transition-colors',
                  activeFilter === filter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
        
        <div className="mb-6">
             {!loading && botCount === 0 && <BotOnboardingNudge />}
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
           <button 
             onClick={() => router.push('/owner-dashboard/menu')}
             className="flex items-center justify-center p-3 bg-primary hover:bg-primary/90 rounded-lg font-semibold transition-colors text-sm sm:text-base text-primary-foreground">
              <Plus size={18} className="mr-2" /> Add New Item
           </button>
           <button 
             onClick={() => router.push('/owner-dashboard/coupons')}
             className="flex items-center justify-center p-3 bg-secondary hover:bg-secondary/90 rounded-lg font-semibold transition-colors text-sm sm:text-base text-secondary-foreground">
              <Tag size={18} className="mr-2" /> Create Coupon
           </button>
           <button 
             onClick={() => router.push('/owner-dashboard/menu')}
             className="flex items-center justify-center p-3 bg-secondary hover:bg-secondary/90 rounded-lg font-semibold transition-colors text-sm sm:text-base text-secondary-foreground">
              <XCircle size={18} className="mr-2" /> Mark Item Out of Stock
           </button>
        </div>

      </motion.div>

      <motion.div
        className="space-y-6"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: {
              staggerChildren: 0.1
            }
          }
        }}
      >
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          <StatCard isLoading={loading} title="Sales" value={dashboardData?.stats.sales || 0} icon={IndianRupee} change={dashboardData?.stats.salesChange || 0} isCurrency />
          <StatCard isLoading={loading} title="Total Orders" value={dashboardData?.stats.orders || 0} icon={Hash} change={dashboardData?.stats.ordersChange || 0} />
          <StatCard isLoading={loading} title="New Customers" value={dashboardData?.stats.newCustomers || 0} icon={Users} change={dashboardData?.stats.newCustomersChange || 0} />
          <StatCard isLoading={loading} title="Average Order Value" value={dashboardData?.stats.avgOrderValue || 0} icon={ListFilter} change={dashboardData?.stats.avgOrderValueChange || 0} isCurrency />
          <StatCard isLoading={loading} title="Today's Rejections" value={dashboardData?.stats.todayRejections || 0} icon={Ban} isRejection={true} />
        </div>

        {/* Live Feed and Sales Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LiveOrderFeed orders={dashboardData?.liveOrders} isLoading={loading} />
          <SalesChart salesData={dashboardData?.salesChart} isLoading={loading} />
        </div>

        {/* Top Selling Items */}
        <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-lg font-semibold text-foreground mb-4">⭐ Top Selling Items</h3>
            {loading ? (
                <div className="flex animate-pulse space-x-4">
                    <div className="w-48 h-40 bg-muted/50 rounded-lg"></div>
                    <div className="w-48 h-40 bg-muted/50 rounded-lg"></div>
                    <div className="w-48 h-40 bg-muted/50 rounded-lg"></div>
                    <div className="w-48 h-40 bg-muted/50 rounded-lg"></div>
                </div>
            ) : (
                <div className="flex overflow-x-auto pb-4 -mb-4">
                    {dashboardData?.topItems && dashboardData.topItems.length > 0 ? (
                        dashboardData.topItems.map(item => <TopSellingItem key={item.name} {...item} />)
                    ) : (
                        <div className="w-full text-center text-muted-foreground py-10">No sales data for this period yet.</div>
                    )}
                </div>
            )}
        </div>

      </motion.div>
    </div>
  );
}

export default function OwnerDashboardPage() {
    return (
        <React.Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><div className="h-16 w-16 animate-spin rounded-full border-b-2 border-primary"></div></div>}>
            <PageContent />
        </React.Suspense>
    )
}
