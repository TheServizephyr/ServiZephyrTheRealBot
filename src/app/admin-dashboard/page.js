'use client';

import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AlertCircle, Store, Users, IndianRupee, ShoppingCart, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';

// Mock Data
const pendingApprovals = 3;
const totalRestaurants = 152;
const totalUsers = 4820;
const todayOrders = 256;
const todayRevenue = 125000;

const recentSignups = [
  { type: 'Restaurant', name: 'Pizza Paradise', time: '2m ago' },
  { type: 'User', name: 'Rohan Sharma', time: '5m ago' },
  { type: 'User', name: 'Priya Singh', time: '12m ago' },
  { type: 'Restaurant', name: 'Curry Corner', time: '28m ago' },
];

const weeklyOrderData = [
  { day: 'Mon', orders: 210 },
  { day: 'Tue', orders: 180 },
  { day: 'Wed', orders: 250 },
  { day: 'Thu', orders: 230 },
  { day: 'Fri', orders: 310 },
  { day: 'Sat', orders: 420 },
  { day: 'Sun', orders: 390 },
];

const StatCard = ({ title, value, icon: Icon, isCurrency = false, className = '' }) => (
  <Card className={`hover:border-primary transition-colors ${className}`}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">
        {isCurrency ? `₹${value.toLocaleString('en-IN')}` : value.toLocaleString('en-IN')}
      </div>
    </CardContent>
  </Card>
);

export default function AdminDashboardPage() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

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
          value={pendingApprovals}
          icon={AlertCircle}
          className="bg-yellow-500/10 border-yellow-500/50 cursor-pointer lg:col-span-1"
        />
        <StatCard title="Total Restaurants" value={totalRestaurants} icon={Store} />
        <StatCard title="Total Users" value={totalUsers} icon={Users} />
        <StatCard title="Today's Orders" value={todayOrders} icon={ShoppingCart} />
        <StatCard title="Today's Revenue" value={todayRevenue} icon={IndianRupee} isCurrency />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
           <Card className="h-full">
            <CardHeader>
              <CardTitle>Platform-wide Order Volume (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] w-full">
                <ResponsiveContainer>
                    <LineChart data={weeklyOrderData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)"/>
                        <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }}/>
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}/>
                        <Line type="monotone" dataKey="orders" stroke="hsl(var(--primary))" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Recent Sign-ups</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentSignups.map((signup, i) => (
                  <div key={i} className="flex items-center">
                    <div className="p-3 bg-muted rounded-full mr-4">
                      {signup.type === 'Restaurant' ? (
                        <Store className="h-5 w-5 text-primary" />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-grow">
                      <p className="text-sm font-medium leading-none">{signup.name}</p>
                      <p className="text-sm text-muted-foreground">{signup.type}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">{signup.time}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
