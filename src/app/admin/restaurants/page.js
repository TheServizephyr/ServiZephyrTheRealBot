'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Check, X, MoreVertical, Eye, Pause, Play, Search, RefreshCcw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const mockRestaurants = [
  { id: 1, name: 'Pizza Paradise', owner: 'Rohan Sharma', email: 'rohan@example.com', onboarded: '2023-10-01', status: 'Pending' },
  { id: 2, name: 'Curry Corner', owner: 'Amit Patel', email: 'amit@example.com', onboarded: '2023-09-15', status: 'Approved' },
  { id: 3, name: 'Burger Barn', owner: 'Priya Desai', email: 'priya@example.com', onboarded: '2023-08-22', status: 'Approved' },
  { id: 4, name: 'Sushi Spot', owner: 'Sunita Verma', email: 'sunita@example.com', onboarded: '2023-10-05', status: 'Pending' },
  { id: 5, name: 'Taco Town', owner: 'Rajesh Kumar', email: 'rajesh@example.com', onboarded: '2023-07-11', status: 'Suspended' },
  { id: 6, name: 'Noodle House', owner: 'Anjali Mehta', email: 'anjali@example.com', onboarded: '2023-09-28', status: 'Approved' },
  { id: 7, name: 'The Daily Grind', owner: 'Vikram Singh', email: 'vikram@example.com', onboarded: '2023-10-08', status: 'Pending' },
  { id: 8, name: 'Lost & Found', owner: 'Admin', email: 'restore@me.com', onboarded: '2023-01-01', status: 'Rejected' },
];

const RestaurantRow = ({ restaurant }) => {
  const statusClasses = {
    Approved: 'bg-green-500/10 text-green-400',
    Pending: 'bg-yellow-500/10 text-yellow-400',
    Suspended: 'bg-red-500/10 text-red-400',
    Rejected: 'bg-gray-500/10 text-gray-400',
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{restaurant.name}</TableCell>
      <TableCell>{restaurant.owner}</TableCell>
      <TableCell className="text-muted-foreground">{restaurant.email}</TableCell>
      <TableCell>{new Date(restaurant.onboarded).toLocaleDateString()}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[restaurant.status]}`}>
          {restaurant.status}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {restaurant.status === 'Pending' && (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500">
              <Check className="mr-2 h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" size="sm" className="border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-500">
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
              <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View as Owner</DropdownMenuItem>
              <DropdownMenuItem className="text-red-500"><Pause className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {restaurant.status === 'Suspended' && (
          <Button variant="outline" size="sm" onClick={() => alert(`Re-activating ${restaurant.name}`)}>
            <Play className="mr-2 h-4 w-4" /> Re-activate
          </Button>
        )}
        {restaurant.status === 'Rejected' && (
           <Button variant="outline" size="sm" onClick={() => alert(`Re-approving ${restaurant.name}`)}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Re-Approve
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

export default function AdminRestaurantsPage() {
  const [restaurants, setRestaurants] = useState(mockRestaurants);
  const [search, setSearch] = useState('');

  const filteredRestaurants = (status) =>
    restaurants.filter(r => r.status === status && r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Restaurant Management</h1>
      <Tabs defaultValue="pending">
        <div className="flex justify-between items-center mb-4">
          <TabsList>
            <TabsTrigger value="pending">Pending Approval</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="suspended">Suspended</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
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
                <TabsContent value="pending" className="contents">
                  {filteredRestaurants('Pending').map(r => <RestaurantRow key={r.id} restaurant={r} />)}
                </TabsContent>
                <TabsContent value="approved" className="contents">
                  {filteredRestaurants('Approved').map(r => <RestaurantRow key={r.id} restaurant={r} />)}
                </TabsContent>
                <TabsContent value="suspended" className="contents">
                  {filteredRestaurants('Suspended').map(r => <RestaurantRow key={r.id} restaurant={r} />)}
                </TabsContent>
                 <TabsContent value="rejected" className="contents">
                  {filteredRestaurants('Rejected').map(r => <RestaurantRow key={r.id} restaurant={r} />)}
                </TabsContent>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>
    </motion.div>
  );
}
