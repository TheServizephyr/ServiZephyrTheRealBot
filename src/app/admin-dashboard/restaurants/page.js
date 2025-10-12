
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Check, X, MoreVertical, Eye, Pause, Play, Search, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const RestaurantRow = ({ restaurant, onUpdateStatus }) => {
  const statusClasses = {
    Approved: 'bg-green-500/10 text-green-400',
    Pending: 'bg-yellow-500/10 text-yellow-400',
    Suspended: 'bg-red-500/10 text-red-400',
    Rejected: 'bg-gray-500/10 text-gray-400',
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{restaurant.name}</TableCell>
      <TableCell>{restaurant.ownerName}</TableCell>
      <TableCell className="text-muted-foreground">{restaurant.ownerEmail}</TableCell>
      <TableCell>{new Date(restaurant.onboarded).toLocaleDateString()}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[restaurant.status]}`}>
          {restaurant.status}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {restaurant.status === 'Pending' && (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(restaurant.id, 'Approved')}>
              <Check className="mr-2 h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" size="sm" className="border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={() => onUpdateStatus(restaurant.id, 'Rejected')}>
              <X className="mr-2 h-4 w-4" /> Reject
            </Button>
          </div>
        )}
        {restaurant.status === 'Approved' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/owner-dashboard?impersonate_owner_id=${restaurant.ownerId}`} target="_blank">
                    <Eye className="mr-2 h-4 w-4" /> View as Owner
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-500" onClick={() => onUpdateStatus(restaurant.id, 'Suspended')}><Pause className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {restaurant.status === 'Suspended' && (
          <Button variant="outline" size="sm" onClick={() => onUpdateStatus(restaurant.id, 'Approved')}>
            <Play className="mr-2 h-4 w-4" /> Re-activate
          </Button>
        )}
        {restaurant.status === 'Rejected' && (
          <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(restaurant.id, 'Approved')}>
            <Check className="mr-2 h-4 w-4" /> Approve
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

export default function AdminRestaurantsPage() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const fetchRestaurants = async () => {
    setLoading(true);
    setError(null);
    try {
        const response = await fetch('/api/admin/restaurants');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to fetch restaurants');
        }
        const data = await response.json();
        setRestaurants(data.restaurants);
    } catch (err) {
        setError(err.message);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchRestaurants();
  }, []);

  const handleUpdateStatus = async (restaurantId, newStatus) => {
    try {
        const res = await fetch('/api/admin/restaurants', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restaurantId, status: newStatus }),
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to update status');
        }
        // Refresh the list after update
        fetchRestaurants();
    } catch (err) {
        alert(err.message);
    }
  };

  const filteredRestaurants = (status) =>
    restaurants.filter(r => r.status === status && r.name.toLowerCase().includes(search.toLowerCase()));

  const renderTableContent = (status) => {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="text-center p-8">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          </TableCell>
        </TableRow>
      );
    }
    if (error) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="text-center p-8 text-destructive">
            Error: {error}
          </TableCell>
        </TableRow>
      );
    }
    const data = filteredRestaurants(status);
    if (data.length === 0) {
      return (
         <TableRow>
          <TableCell colSpan={6} className="text-center p-8 text-muted-foreground">
            No restaurants found for this status.
          </TableCell>
        </TableRow>
      )
    }
    return data.map(r => <RestaurantRow key={r.id} restaurant={r} onUpdateStatus={handleUpdateStatus} />);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Restaurant Management</h1>
      <Tabs defaultValue="pending">
        <div className="flex justify-between items-center mb-4">
          <TabsList>
            <TabsTrigger value="Pending">Pending Approval</TabsTrigger>
            <TabsTrigger value="Approved">Approved</TabsTrigger>
            <TabsTrigger value="Suspended">Suspended</TabsTrigger>
            <TabsTrigger value="Rejected">Rejected</TabsTrigger>
          </TabsList>
          <div className="relative w-full max-w-sm">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
             <Input 
                placeholder="Search restaurant..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
             />
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Restaurant Name</TableHead>
                  <TableHead>Owner Name</TableHead>
                  <TableHead>Owner Email</TableHead>
                  <TableHead>Onboarding Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TabsContent value="Pending" className="contents">
                  {renderTableContent('Pending')}
                </TabsContent>
                <TabsContent value="Approved" className="contents">
                  {renderTableContent('Approved')}
                </TabsContent>
                <TabsContent value="Suspended" className="contents">
                  {renderTableContent('Suspended')}
                </TabsContent>
                <TabsContent value="Rejected" className="contents">
                  {renderTableContent('Rejected')}
                </TabsContent>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>
    </motion.div>
  );
}
