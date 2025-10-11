'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Calendar as CalendarIcon, Download } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { addDays, format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

// Mock Data
const revenueData = [
  { date: '2023-09-01', revenue: 45000 }, { date: '2023-09-08', revenue: 62000 }, { date: '2023-09-15', revenue: 58000 },
  { date: '2023-09-22', revenue: 78000 }, { date: '2023-09-29', revenue: 92000 }, { date: '2023-10-06', revenue: 110000 },
];
const userData = [
  { date: '2023-09-01', customers: 120, owners: 5 }, { date: '2023-09-08', customers: 150, owners: 2 },
  { date: '2023-09-15', customers: 180, owners: 8 }, { date: '2023-09-22', customers: 220, owners: 3 },
  { date: '2023-09-29', customers: 280, owners: 6 }, { date: '2023-10-06', customers: 350, owners: 4 },
];
const topRestaurants = [
  { name: 'Pizza Paradise', revenue: 25000 }, { name: 'Curry Corner', revenue: 22000 }, { name: 'Burger Barn', revenue: 18000 },
  { name: 'Noodle House', revenue: 15000 }, { name: 'Taco Town', revenue: 12000 },
];
const topItems = [
  { name: 'Margherita Pizza', orders: 1250 }, { name: 'Butter Chicken', orders: 980 }, { name: 'Classic Burger', orders: 850 },
  { name: 'Hakka Noodles', orders: 720 }, { name: 'Paneer Tikka', orders: 680 },
];

export default function AdminAnalyticsPage() {
  const [date, setDate] = useState({
    from: new Date(2023, 8, 1),
    to: addDays(new Date(2023, 8, 1), 40),
  });
  
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
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Platform Analytics</h1>
        <div className="flex items-center gap-4">
           <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-[300px] justify-start text-left font-normal",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
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
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline"><Download className="mr-2 h-4 w-4"/> Export Data</Button>
        </div>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={itemVariants}>
            <Card>
                <CardHeader><CardTitle>Platform Revenue Trend</CardTitle></CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer>
                        <LineChart data={revenueData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'MMM dd')} />
                            <YAxis tickFormatter={(v) => `₹${v/1000}k`} />
                            <Tooltip formatter={(value) => `₹${value.toLocaleString()}`} />
                            <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
            <Card>
                <CardHeader><CardTitle>New User Growth</CardTitle></CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer>
                        <LineChart data={userData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'MMM dd')} />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="customers" name="Customers" stroke="hsl(var(--primary))" />
                            <Line type="monotone" dataKey="owners" name="Owners" stroke="hsl(var(--secondary-foreground))" />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </motion.div>
      </div>

       <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={itemVariants}>
            <Card>
                <CardHeader><CardTitle>Top 10 Performing Restaurants</CardTitle></CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer>
                        <BarChart data={topRestaurants} layout="vertical">
                           <CartesianGrid strokeDasharray="3 3" />
                           <XAxis type="number" tickFormatter={(v) => `₹${v/1000}k`} />
                           <YAxis type="category" dataKey="name" width={100} />
                           <Tooltip formatter={(value) => `₹${value.toLocaleString()}`} />
                           <Bar dataKey="revenue" fill="hsl(var(--primary))" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
            <Card>
                <CardHeader><CardTitle>Top 10 Ordered Items</CardTitle></CardHeader>
                <CardContent className="h-[300px]">
                     <ResponsiveContainer>
                        <BarChart data={topItems} layout="vertical">
                           <CartesianGrid strokeDasharray="3 3" />
                           <XAxis type="number" />
                           <YAxis type="category" dataKey="name" width={100} />
                           <Tooltip />
                           <Bar dataKey="orders" fill="hsl(var(--primary))" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </motion.div>
      </div>

    </motion.div>
  );
}
