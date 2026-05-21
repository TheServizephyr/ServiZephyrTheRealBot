
'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CalendarDays, IndianRupee, MessageSquare, Minus, ReceiptText, RefreshCw, ShoppingCart, Store, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function formatChartDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : format(date, 'MMM dd');
}

const GrowthPill = ({ growth }) => {
  const direction = growth?.direction || 'flat';
  const label = growth?.label || '0%';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const className = direction === 'up'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    : direction === 'down'
      ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300'
      : 'border-border bg-muted text-muted-foreground';

  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', className)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
};

const sourceIcons = {
  whatsappOnline: MessageSquare,
  dineIn: Store,
  manual: ReceiptText,
  bookings: CalendarDays,
  other: ShoppingCart,
};

const StatCard = ({ title, value, icon: Icon, isCurrency = false, className = '', isLoading, href, subtitle, growth }) => {
  const cardContent = (
    <Card className={cn("hover:border-primary transition-colors h-full", className, href && "cursor-pointer")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {isCurrency ? formatCurrency(value) : formatNumber(value)}
        </div>
        {(subtitle || growth) && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{subtitle}</span>
            {growth ? <GrowthPill growth={growth} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className={`animate-pulse bg-card border border-border rounded-xl p-5 h-[108px]`}>
        <div className="flex justify-between items-center">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-5 w-5 bg-muted rounded-full"></div>
        </div>
        <div className="h-8 bg-muted rounded w-1/2 mt-4"></div>
      </div>
    );
  }
  
  if (href) {
    return <Link href={href} className="w-full h-full">{cardContent}</Link>;
  }

  return cardContent;
};

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const desktopRuntime = isDesktopApp();
  const cacheKey = 'admin_dashboard_stats_v1';

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/dashboard-stats', { headers });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = 'Failed to fetch dashboard data';
        try { errMsg = JSON.parse(text).message || errMsg; } catch (e) { errMsg = text || errMsg; }
        throw new Error(errMsg);
      }
      const result = await res.json();
      setData(result);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        // Ignore cache write errors.
      }
      if (desktopRuntime) {
        await setOfflineNamespace('admin_dashboard', cacheKey, result);
      }
    } catch (err) {
      let cached = null;
      try {
        const localCached = localStorage.getItem(cacheKey);
        cached = localCached ? JSON.parse(localCached) : null;
      } catch {
        cached = null;
      }
      if (!cached && desktopRuntime) {
        cached = await getOfflineNamespace('admin_dashboard', cacheKey, null);
      }
      if (cached) {
        setData(cached);
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  const periodSummary = data?.periodSummary || {};
  const topRestaurantsToday = Array.isArray(data?.topRestaurantsToday) ? data.topRestaurantsToday : [];
  const sourceBreakdown = Array.isArray(data?.sourceBreakdown) ? data.sourceBreakdown : [];
  const getSourceMetric = (sources, key) => (sources || []).find((source) => source.key === key)?.current || { orderCount: 0, revenue: 0 };

  if (error) {
    return (
        <div className="text-center p-8 text-destructive bg-destructive/10 rounded-lg">
            <h2 className="text-lg font-bold">Error Loading Dashboard</h2>
            <p>{error}</p>
            <Button onClick={fetchData} className="mt-4">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
            </Button>
        </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.h1 variants={itemVariants} className="text-3xl font-bold tracking-tight">
        Platform Overview
      </motion.h1>
      <motion.div variants={itemVariants}>
        <OfflineDesktopStatus />
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-6 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          title="Pending Approvals"
          value={data?.pendingApprovals || 0}
          icon={AlertCircle}
          className="bg-yellow-500/10 border-yellow-500/50"
          isLoading={loading}
          href="/admin-dashboard/restaurants"
        />
        <StatCard title="Total Listings" value={data?.totalListings || 0} icon={Store} isLoading={loading}/>
        <StatCard title="Total Users" value={data?.totalUsers || 0} icon={Users} isLoading={loading}/>
        <StatCard
          title="Today's Orders"
          value={data?.todayOrders || 0}
          icon={ShoppingCart}
          isLoading={loading}
          subtitle={`${formatNumber(periodSummary.yesterday?.current?.orderCount)} yesterday`}
          growth={periodSummary.today?.orderGrowth}
        />
        <StatCard
          title="Today's Revenue"
          value={data?.todayRevenue || 0}
          icon={IndianRupee}
          isCurrency
          isLoading={loading}
          subtitle={`${formatCurrency(periodSummary.yesterday?.current?.revenue)} yesterday`}
          growth={periodSummary.today?.revenueGrowth}
        />
        <StatCard
          title="This Week Orders"
          value={periodSummary.week?.current?.orderCount || 0}
          icon={CalendarDays}
          isLoading={loading}
          subtitle={`${formatCurrency(periodSummary.week?.current?.revenue)} revenue`}
          growth={periodSummary.week?.orderGrowth}
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
           <Card className="h-full">
            <CardHeader>
              <CardTitle>Platform Orders & Revenue (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] w-full">
              {loading ? (
                <div className="flex items-center justify-center h-full"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <ResponsiveContainer>
                    <LineChart data={data?.weeklyOrderData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)"/>
                        <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis yAxisId="orders" tick={{ fill: 'hsl(var(--muted-foreground))' }}/>
                        <YAxis yAxisId="revenue" orientation="right" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} tick={{ fill: 'hsl(var(--muted-foreground))' }}/>
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                          formatter={(value, name) => (name === 'revenue' ? formatCurrency(value) : formatNumber(value))}
                        />
                        <Legend />
                        <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="hsl(var(--primary))" strokeWidth={2} />
                        <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Top Restaurants Today</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4 animate-pulse">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-md"></div>)}
                </div>
              ) : (
              <div className="space-y-4">
                {topRestaurantsToday.length > 0 ? topRestaurantsToday.slice(0, 6).map((restaurant) => (
                  <div key={restaurant.id} className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Store className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-none">{restaurant.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Online {formatNumber(getSourceMetric(restaurant.todaySources, 'whatsappOnline').orderCount)}
                        {' · '}Dine-in {formatNumber(getSourceMetric(restaurant.todaySources, 'dineIn').orderCount)}
                        {' · '}Manual {formatNumber(getSourceMetric(restaurant.todaySources, 'manual').orderCount)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold">{formatNumber(restaurant.today?.orderCount)}</span>
                      <GrowthPill growth={restaurant.todayOrderGrowth} />
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center pt-8">No orders placed today.</p>}
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Order Source Split</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Last 7 days by source. Open full analytics for exact date range and restaurant-wise source tables.</p>
            </div>
            <Link href="/admin-dashboard/analytics">
              <Button variant="outline" size="sm">Full Analytics</Button>
            </Link>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {sourceBreakdown.map((source) => {
              const Icon = sourceIcons[source.key] || ShoppingCart;
              return (
                <div key={source.key} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">{source.label}</p>
                      </div>
                      <p className="mt-2 text-2xl font-bold">{formatNumber(source.current?.orderCount)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(source.current?.revenue)} revenue</p>
                    </div>
                    <GrowthPill growth={source.orderGrowth} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle>Period Snapshot</CardTitle>
            <Link href="/admin-dashboard/analytics">
              <Button variant="outline" size="sm">Open Analytics</Button>
            </Link>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {[
              ['Yesterday', periodSummary.yesterday],
              ['This Month', periodSummary.month],
              ['This Year', periodSummary.year],
            ].map(([label, period]) => (
              <div key={label} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-bold">{formatNumber(period?.current?.orderCount)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{formatCurrency(period?.current?.revenue)} revenue</p>
                  </div>
                  <GrowthPill growth={period?.orderGrowth} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Sign-ups</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-4 md:grid-cols-4 animate-pulse">
                {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-md"></div>)}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {(data?.recentSignups || []).length > 0 ? data.recentSignups.map((signup, i) => (
                  <div key={i} className="flex items-center rounded-lg border p-3">
                    <div className="p-3 bg-muted rounded-full mr-4">
                      {signup.type === 'Restaurant' ? (
                        <Store className="h-5 w-5 text-primary" />
                      ) : signup.type === 'Shop' ? (
                        <ShoppingCart className="h-5 w-5 text-blue-400" />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-grow">
                      <p className="truncate text-sm font-medium leading-none">{signup.name}</p>
                      <p className="text-sm text-muted-foreground">{signup.type} · {format(new Date(signup.time), "p")}</p>
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center md:col-span-2 xl:col-span-4">No recent sign-ups found.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
