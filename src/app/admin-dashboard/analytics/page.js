'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  Calendar as CalendarIcon,
  CalendarDays,
  Clock,
  Download,
  IndianRupee,
  MessageSquare,
  Minus,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { format, startOfMonth, startOfWeek, startOfYear, subDays } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

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

function GrowthPill({ growth }) {
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
}

function MetricCard({ title, value, subValue, growth, icon: Icon }) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{subValue}</span>
          <GrowthPill growth={growth} />
        </div>
      </CardContent>
    </Card>
  );
}

function exportAnalyticsAsCsv(payload) {
  const range = payload?.range || {};
  const lines = [];
  lines.push(`Analytics Export,${range.start || ''} to ${range.end || ''}`);
  lines.push('');
  lines.push('Period,Orders,Revenue,Previous Orders,Previous Revenue,Order Growth,Revenue Growth');
  Object.values(payload?.periodSummary || {}).forEach((period) => {
    lines.push([
      period.label,
      period.current?.orderCount || 0,
      period.current?.revenue || 0,
      period.previous?.orderCount || 0,
      period.previous?.revenue || 0,
      period.orderGrowth?.label || '',
      period.revenueGrowth?.label || '',
    ].join(','));
  });

  lines.push('');
  lines.push('Source,Orders,Revenue,Previous Orders,Previous Revenue,Growth');
  (payload?.sourceBreakdown || []).forEach((source) => {
    lines.push([
      source.label,
      source.current?.orderCount || 0,
      source.current?.revenue || 0,
      source.previous?.orderCount || 0,
      source.previous?.revenue || 0,
      source.orderGrowth?.label || '',
    ].join(','));
  });

  lines.push('');
  lines.push('Restaurant,Today Orders,Yesterday Orders,Today Revenue,Week Orders,Month Orders,Year Orders,Today Growth');
  (payload?.restaurantBreakdown || []).forEach((row) => {
    lines.push([
      `"${String(row.name || '').replace(/"/g, '""')}"`,
      row.today?.orderCount || 0,
      row.yesterday?.orderCount || 0,
      row.today?.revenue || 0,
      row.week?.orderCount || 0,
      row.month?.orderCount || 0,
      row.year?.orderCount || 0,
      row.todayOrderGrowth?.label || '',
    ].join(','));
  });

  lines.push('');
  lines.push('Top Items,Orders');
  (payload?.topItems || []).forEach((row) => {
    lines.push(`"${String(row.name || '').replace(/"/g, '""')}",${Number(row.orders || 0)}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `admin-analytics-${range.start || 'start'}-to-${range.end || 'end'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const emptyPayload = {
  range: null,
  revenueData: [],
  userData: [],
  topRestaurants: [],
  topItems: [],
  restaurantBreakdown: [],
  sourceBreakdown: [],
  sourceRestaurantBreakdown: [],
  periodSummary: {},
  totals: { orderCount: 0, revenue: 0, userSignups: 0 },
};

const sourceIcons = {
  whatsappOnline: MessageSquare,
  dineIn: Store,
  manual: ReceiptText,
  bookings: CalendarDays,
  other: ShoppingCart,
};

const presetButtons = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
  { key: 'last40', label: 'Last 40 Days' },
];

export default function AdminAnalyticsPage() {
  const [date, setDate] = useState({
    from: subDays(new Date(), 40),
    to: new Date(),
  });
  const [selectedSourceKey, setSelectedSourceKey] = useState('whatsappOnline');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(emptyPayload);

  const analyticsCacheKey = useMemo(() => {
    const start = date?.from ? format(date.from, 'yyyy-MM-dd') : 'start';
    const end = date?.to ? format(date.to, 'yyyy-MM-dd') : 'end';
    return `admin_analytics::${start}::${end}`;
  }, [date]);

  const fetchAnalytics = useCallback(async () => {
    if (!date?.from || !date?.to) return;

    setLoading(true);
    setError('');
    try {
      const headers = {};
      const currentUser = auth.currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const start = format(date.from, 'yyyy-MM-dd');
      const end = format(date.to, 'yyyy-MM-dd');
      const res = await fetch(`/api/admin/analytics?start=${start}&end=${end}`, {
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text();
        let message = 'Could not load analytics';
        try {
          message = JSON.parse(text).message || message;
        } catch {
          message = text || message;
        }
        throw new Error(message);
      }

      const data = await res.json();
      const nextPayload = {
        ...emptyPayload,
        ...data,
        revenueData: Array.isArray(data.revenueData) ? data.revenueData : [],
        userData: Array.isArray(data.userData) ? data.userData : [],
        topRestaurants: Array.isArray(data.topRestaurants) ? data.topRestaurants : [],
        topItems: Array.isArray(data.topItems) ? data.topItems : [],
        restaurantBreakdown: Array.isArray(data.restaurantBreakdown) ? data.restaurantBreakdown : [],
        sourceBreakdown: Array.isArray(data.sourceBreakdown) ? data.sourceBreakdown : [],
        sourceRestaurantBreakdown: Array.isArray(data.sourceRestaurantBreakdown) ? data.sourceRestaurantBreakdown : [],
        periodSummary: data.periodSummary || {},
        totals: data.totals || emptyPayload.totals,
      };
      setPayload(nextPayload);
      const cachePayload = { ts: Date.now(), data: nextPayload };
      try {
        localStorage.setItem(analyticsCacheKey, JSON.stringify(cachePayload));
      } catch {
        // Ignore local cache failures.
      }
      if (isDesktopApp()) {
        await setOfflineNamespace('admin_analytics', analyticsCacheKey, cachePayload);
      }
    } catch (err) {
      let cached = null;
      try {
        const raw = localStorage.getItem(analyticsCacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.data) cached = parsed.data;
        }
      } catch {
        // Ignore malformed cache.
      }
      if (!cached && isDesktopApp()) {
        const desktopPayload = await getOfflineNamespace('admin_analytics', analyticsCacheKey, null);
        cached = desktopPayload?.data || null;
      }

      if (cached) {
        setPayload({ ...emptyPayload, ...cached });
        setError('Showing cached analytics because the live fetch failed.');
      } else {
        setError(err.message || 'Could not load analytics');
      }
    } finally {
      setLoading(false);
    }
  }, [date?.from, date?.to, analyticsCacheKey]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const setPreset = (key) => {
    const now = new Date();
    if (key === 'today') setDate({ from: now, to: now });
    if (key === 'yesterday') {
      const yesterday = subDays(now, 1);
      setDate({ from: yesterday, to: yesterday });
    }
    if (key === 'week') setDate({ from: startOfWeek(now, { weekStartsOn: 1 }), to: now });
    if (key === 'month') setDate({ from: startOfMonth(now), to: now });
    if (key === 'year') setDate({ from: startOfYear(now), to: now });
    if (key === 'last40') setDate({ from: subDays(now, 40), to: now });
  };

  const periodSummary = payload.periodSummary || {};
  const canExport = payload.restaurantBreakdown.length > 0 || payload.topItems.length > 0;
  const selectedRangeLabel = payload.range?.start && payload.range?.end
    ? `${payload.range.start} to ${payload.range.end}`
    : 'selected range';
  const getSourceMetric = (sources, key) => (sources || []).find((source) => source.key === key)?.current || { orderCount: 0, revenue: 0 };
  const selectedSource = (payload.sourceBreakdown || []).find((source) => source.key === selectedSourceKey) || payload.sourceBreakdown?.[0] || null;
  const selectedSourceGroup = (payload.sourceRestaurantBreakdown || []).find((source) => source.key === selectedSourceKey);
  const selectedSourceRows = selectedSourceGroup?.rows || [];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { y: 16, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Platform Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Selected range: {selectedRangeLabel}. Orders {formatNumber(payload.totals.orderCount)}, Revenue {formatCurrency(payload.totals.revenue)}, Signups {formatNumber(payload.totals.userSignups)}
          </p>
          <div className="mt-2">
            <OfflineDesktopStatus />
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto">
          <div className="flex flex-wrap gap-2">
            {presetButtons.map((preset) => (
              <Button key={preset.key} type="button" variant="outline" size="sm" onClick={() => setPreset(preset.key)}>
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  className={cn(
                    'w-full sm:w-[300px] justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, 'LLL dd, y')} - {format(date.to, 'LLL dd, y')}
                      </>
                    ) : (
                      format(date.from, 'LLL dd, y')
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
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>

            <Button variant="outline" onClick={fetchAnalytics} disabled={loading} className="w-full sm:w-auto">
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>

            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={!canExport}
              onClick={() => exportAnalyticsAsCsv(payload)}
            >
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Analytics Notice</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Today Orders"
          value={formatNumber(periodSummary.today?.current?.orderCount)}
          subValue={`${formatCurrency(periodSummary.today?.current?.revenue)} revenue`}
          growth={periodSummary.today?.orderGrowth}
          icon={ShoppingCart}
        />
        <MetricCard
          title="Yesterday Orders"
          value={formatNumber(periodSummary.yesterday?.current?.orderCount)}
          subValue={`${formatCurrency(periodSummary.yesterday?.current?.revenue)} revenue`}
          growth={periodSummary.yesterday?.orderGrowth}
          icon={Clock}
        />
        <MetricCard
          title="This Week"
          value={formatNumber(periodSummary.week?.current?.orderCount)}
          subValue={`${formatCurrency(periodSummary.week?.current?.revenue)} revenue`}
          growth={periodSummary.week?.orderGrowth}
          icon={CalendarDays}
        />
        <MetricCard
          title="This Month"
          value={formatNumber(periodSummary.month?.current?.orderCount)}
          subValue={`${formatCurrency(periodSummary.month?.current?.revenue)} revenue`}
          growth={periodSummary.month?.orderGrowth}
          icon={Activity}
        />
        <MetricCard
          title="This Year"
          value={formatNumber(periodSummary.year?.current?.orderCount)}
          subValue={`${formatCurrency(periodSummary.year?.current?.revenue)} revenue`}
          growth={periodSummary.year?.orderGrowth}
          icon={IndianRupee}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Order Source Split</CardTitle>
            <p className="text-sm text-muted-foreground">These totals are for {selectedRangeLabel}.</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {(payload.sourceBreakdown || []).map((source) => {
              const Icon = sourceIcons[source.key] || ShoppingCart;
              return (
                <button
                  key={source.key}
                  type="button"
                  onClick={() => setSelectedSourceKey(source.key)}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-colors hover:border-primary',
                    selectedSourceKey === source.key && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">{source.label}</p>
                      </div>
                      <p className="mt-2 text-2xl font-bold">{formatNumber(source.current?.orderCount)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(source.current?.revenue)} revenue</p>
                    </div>
                    <GrowthPill growth={source.orderGrowth} />
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>{selectedSource?.label || 'Source'} By Restaurant</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing where {formatNumber(selectedSource?.current?.orderCount)} orders came from in {selectedRangeLabel}.
              </p>
            </div>
            <Badge variant="secondary" className="w-fit">{selectedSourceRows.length} restaurants</Badge>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : selectedSourceRows.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">No restaurants for this source in this range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Restaurant</th>
                      <th className="px-3 py-3 text-right font-medium">Range Orders</th>
                      <th className="px-3 py-3 text-right font-medium">Range Revenue</th>
                      <th className="px-3 py-3 text-right font-medium">Today Orders</th>
                      <th className="px-3 py-3 text-right font-medium">Today Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSourceRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-4 pr-4">
                          <p className="font-medium leading-snug">{row.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
                        </td>
                        <td className="px-3 py-4 text-right font-semibold">{formatNumber(row.selected?.orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatCurrency(row.selected?.revenue)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(row.today?.orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatCurrency(row.today?.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-5">
        <motion.div variants={itemVariants} className="xl:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Orders & Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={payload.revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" />
                    <XAxis dataKey="date" tickFormatter={formatChartDate} />
                    <YAxis yAxisId="orders" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis yAxisId="revenue" orientation="right" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(value, name) => (name === 'revenue' ? formatCurrency(value) : formatNumber(value))} labelFormatter={formatChartDate} />
                    <Legend />
                    <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} className="xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>New User Growth</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={payload.userData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" />
                    <XAxis dataKey="date" tickFormatter={formatChartDate} />
                    <YAxis />
                    <Tooltip labelFormatter={formatChartDate} />
                    <Legend />
                    <Line type="monotone" dataKey="customers" name="Customers" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="owners" name="Owners" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Today Restaurant Breakdown</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">These source columns are only for today, so they add up to the Today total.</p>
            </div>
            <Badge variant="secondary" className="w-fit">Top {payload.restaurantBreakdown.length || 0}</Badge>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : payload.restaurantBreakdown.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground">No orders found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Restaurant</th>
                      <th className="px-3 py-3 text-right font-medium">Today</th>
                      <th className="px-3 py-3 text-right font-medium">Yesterday</th>
                      <th className="px-3 py-3 text-right font-medium">Growth</th>
                      <th className="px-3 py-3 text-right font-medium">Today Online</th>
                      <th className="px-3 py-3 text-right font-medium">Today Dine-in</th>
                      <th className="px-3 py-3 text-right font-medium">Today Manual</th>
                      <th className="px-3 py-3 text-right font-medium">Today Booking</th>
                      <th className="px-3 py-3 text-right font-medium">Today Revenue</th>
                      <th className="px-3 py-3 text-right font-medium">Week</th>
                      <th className="px-3 py-3 text-right font-medium">Month</th>
                      <th className="px-3 py-3 text-right font-medium">Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.restaurantBreakdown.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                              <Store className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium leading-none">{row.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-right font-semibold">{formatNumber(row.today?.orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(row.yesterday?.orderCount)}</td>
                        <td className="px-3 py-4">
                          <div className="flex justify-end">
                            <GrowthPill growth={row.todayOrderGrowth} />
                          </div>
                        </td>
                        <td className="px-3 py-4 text-right">{formatNumber(getSourceMetric(row.todaySources, 'whatsappOnline').orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(getSourceMetric(row.todaySources, 'dineIn').orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(getSourceMetric(row.todaySources, 'manual').orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(getSourceMetric(row.todaySources, 'bookings').orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatCurrency(row.today?.revenue)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(row.week?.orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(row.month?.orderCount)}</td>
                        <td className="px-3 py-4 text-right">{formatNumber(row.year?.orderCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Top Restaurants In Selected Range</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : payload.topRestaurants.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground">No data for this range.</div>
              ) : (
                <div className="space-y-4">
                  {payload.topRestaurants.map((row, index) => (
                    <div key={row.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium leading-snug">{index + 1}. {row.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold">{formatCurrency(row.revenue)}</p>
                          <p className="text-xs text-muted-foreground">{formatNumber(row.orderCount)} orders</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Top Ordered Items</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : payload.topItems.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground">No data for this range.</div>
              ) : (
                <div className="space-y-4">
                  {payload.topItems.map((row, index) => (
                    <div key={row.name} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium leading-snug">{index + 1}. {row.name}</p>
                        <p className="shrink-0 font-semibold">{formatNumber(row.orders)} orders</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
