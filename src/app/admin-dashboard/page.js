
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AlertCircle, Store, Users, IndianRupee, ShoppingCart, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

const StatCard = ({ title, value, icon: Icon, isCurrency = false, className = '', isLoading }) => {
  if (isLoading) {
    return (
      <Card className={`animate-pulse ${className}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-5 w-5 bg-muted rounded-full"></div>
        </CardHeader>
        <CardContent>
          <div className="h-8 bg-muted rounded w-1/2"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`hover:border-primary transition-colors ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {isCurrency ? `₹${Number(value).toLocaleString('en-IN')}` : Number(value).toLocaleString('en-IN')}
        </div>
      </CardContent>
    </Card>
  );
};

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // NOTE: In a real app, you'd use a library like SWR or React Query
      const res = await fetch('/api/admin/dashboard-stats');
      if (!res.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err.message);
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

  if (error) {
    return (
        <div className="text-center p-8 text-destructive">
            <h2 className="text-lg font-bold">Error</h2>
            <p>{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md">Try Again</button>
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

      <motion.div variants={itemVariants} className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Pending Approvals"
          value={data?.pendingApprovals || 0}
          icon={AlertCircle}
          className="bg-yellow-500/10 border-yellow-500/50 cursor-pointer lg:col-span-1"
          isLoading={loading}
        />
        <StatCard title="Total Listings" value={data?.totalListings || 0} icon={Store} isLoading={loading}/>
        <StatCard title="Total Users" value={data?.totalUsers || 0} icon={Users} isLoading={loading}/>
        <StatCard title="Today's Orders" value={data?.todayOrders || 0} icon={ShoppingCart} isLoading={loading}/>
        <StatCard title="Today's Revenue" value={data?.todayRevenue || 0} icon={IndianRupee} isCurrency isLoading={loading}/>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
           <Card className="h-full">
            <CardHeader>
              <CardTitle>Platform-wide Order Volume (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] w-full">
              {loading ? (
                <div className="flex items-center justify-center h-full"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <ResponsiveContainer>
                    <LineChart data={data?.weeklyOrderData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)"/>
                        <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }}/>
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}/>
                        <Line type="monotone" dataKey="orders" stroke="hsl(var(--primary))" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Recent Sign-ups</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4 animate-pulse">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-md"></div>)}
                </div>
              ) : (
              <div className="space-y-4">
                {(data?.recentSignups || []).map((signup, i) => (
                  <div key={i} className="flex items-center">
                    <div className="p-3 bg-muted rounded-full mr-4">
                      {signup.type === 'Restaurant' || signup.type === 'Shop' ? (
                        <Store className="h-5 w-5 text-primary" />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-grow">
                      <p className="text-sm font-medium leading-none">{signup.name}</p>
                      <p className="text-sm text-muted-foreground">{signup.type}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">{format(new Date(signup.time), "p")}</div>
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

    