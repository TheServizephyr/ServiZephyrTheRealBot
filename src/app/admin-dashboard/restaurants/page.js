

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Check, X, MoreVertical, Eye, Pause, Play, Search, RefreshCw, ShieldCheck, Edit, Store, ShoppingCart } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';


const SuspensionModal = ({ isOpen, onOpenChange, onConfirm, restaurantName, initialRestrictedFeatures = [] }) => {
    const features = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'live-orders', label: 'Live Order Management' },
        { id: 'menu', label: 'Menu/Item Management' },
        { id: 'analytics', label: 'Analytics & Reports' },
        { id: 'customers', label: 'Customer Hub' },
        { id: 'delivery', label: 'Delivery Management' },
        { id: 'coupons', label: 'Coupon & Offer Hub' },
    ];
    const [selectedFeatures, setSelectedFeatures] = useState([]);
    const [remark, setRemark] = useState("");

    useEffect(() => {
        if (isOpen) {
            setSelectedFeatures(initialRestrictedFeatures);
            setRemark(""); // Reset remark every time it opens
        }
    }, [isOpen, initialRestrictedFeatures]);

    const handleSelect = (featureId) => {
        setSelectedFeatures(prev => 
            prev.includes(featureId) ? prev.filter(id => id !== featureId) : [...prev, featureId]
        );
    };
    
    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedFeatures(features.map(f => f.id));
        } else {
            setSelectedFeatures([]);
        }
    };
    
    const handleConfirm = () => {
        onConfirm(selectedFeatures, remark);
    }

    const allSelected = features.length > 0 && selectedFeatures.length === features.length;
    const partiallySelected = selectedFeatures.length > 0 && selectedFeatures.length < features.length;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Suspend / Edit Suspension for: {restaurantName}</DialogTitle>
                    <DialogDescription>
                        Select the features you want to restrict. The owner will see a lock screen for these features with your remark.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                     <div className="flex items-center space-x-3 p-3 rounded-md bg-muted border border-border">
                        <Checkbox 
                            id="select-all" 
                            onCheckedChange={handleSelectAll}
                            checked={allSelected}
                             data-state={partiallySelected ? "indeterminate" : (allSelected ? "checked" : "unchecked")}
                        />
                        <Label htmlFor="select-all" className="flex-grow cursor-pointer text-sm font-bold">Select/Deselect All</Label>
                    </div>
                     {features.map(feature => (
                        <div key={feature.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted">
                            <Checkbox 
                                id={feature.id} 
                                onCheckedChange={() => handleSelect(feature.id)}
                                checked={selectedFeatures.includes(feature.id)}
                            />
                            <Label htmlFor={feature.id} className="flex-grow cursor-pointer text-sm font-medium">{feature.label}</Label>
                        </div>
                    ))}
                    <div className="pt-4 border-t border-border">
                        <Label htmlFor="suspension-remark">Suspension Remark (Optional)</Label>
                        <Textarea 
                            id="suspension-remark"
                            value={remark}
                            onChange={(e) => setRemark(e.target.value)}
                            placeholder="e.g., Menu not updated as per policy."
                            className="mt-2"
                        />
                         <p className="text-xs text-muted-foreground mt-1">This message will be shown to the business owner.</p>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button variant="destructive" onClick={handleConfirm}>Confirm Suspension</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const RestaurantRow = ({ restaurant, onUpdateStatus }) => {
  const [isSuspensionModalOpen, setIsSuspensionModalOpen] = useState(false);
  
  const statusClasses = {
    Approved: 'bg-green-500/10 text-green-400',
    Pending: 'bg-yellow-500/10 text-yellow-400',
    Suspended: 'bg-red-500/10 text-red-400',
    Rejected: 'bg-gray-500/10 text-gray-400',
  };

  const businessTypeConfig = {
      restaurant: { icon: Store, color: 'text-primary' },
      shop: { icon: ShoppingCart, color: 'text-blue-400'}
  }
  const BusinessIcon = businessTypeConfig[restaurant.businessType]?.icon || Store;
  const businessIconColor = businessTypeConfig[restaurant.businessType]?.color || 'text-primary';
  
  const handleSuspensionConfirm = (restrictedFeatures, suspensionRemark) => {
    onUpdateStatus(restaurant.id, restaurant.businessType, 'Suspended', { restrictedFeatures, suspensionRemark });
    setIsSuspensionModalOpen(false);
  };


  return (
    <>
    <SuspensionModal 
        isOpen={isSuspensionModalOpen}
        onOpenChange={setIsSuspensionModalOpen}
        onConfirm={handleSuspensionConfirm}
        restaurantName={restaurant.name}
        initialRestrictedFeatures={restaurant.restrictedFeatures || []}
    />
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
            <BusinessIcon className={`h-4 w-4 ${businessIconColor}`} />
            <span>{restaurant.name}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">{restaurant.ownerName}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">{restaurant.ownerEmail}</TableCell>
      <TableCell className="hidden md:table-cell">{new Date(restaurant.onboarded).toLocaleDateString()}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[restaurant.status]}`}>
          {restaurant.status}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {restaurant.status === 'Pending' && (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(restaurant.id, restaurant.businessType, 'Approved')}>
              <Check className="mr-2 h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" size="sm" className="border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={() => onUpdateStatus(restaurant.id, restaurant.businessType, 'Rejected')}>
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
              <DropdownMenuItem className="text-red-500" onClick={() => setIsSuspensionModalOpen(true)}><Pause className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {restaurant.status === 'Suspended' && (
            <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500" onClick={() => setIsSuspensionModalOpen(true)}>
                    <Edit className="mr-2 h-4 w-4" /> Edit Suspension
                </Button>
                <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(restaurant.id, restaurant.businessType, 'Approved')}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Re-activate
                </Button>
            </div>
        )}
        {restaurant.status === 'Rejected' && (
          <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(restaurant.id, restaurant.businessType, 'Approved')}>
            <ShieldCheck className="mr-2 h-4 w-4" /> Re-consider
          </Button>
        )}
      </TableCell>
    </TableRow>
    </>
  );
};

export default function AdminRestaurantsPage() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const fetchRestaurants = async () => {
    setLoading(true);
    setError(null);
    try {
        const response = await fetch('/api/admin/restaurants');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to fetch listings');
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

  const handleUpdateStatus = async (restaurantId, businessType, newStatus, suspensionDetails = {}) => {
    try {
        const res = await fetch('/api/admin/restaurants', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restaurantId, businessType, status: newStatus, ...suspensionDetails }),
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to update status');
        }
        // Refresh the list after update
        fetchRestaurants();
    } catch (err) {
        setInfoDialog({ isOpen: true, title: "Error", message: err.message });
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
            No listings found for this status.
          </TableCell>
        </TableRow>
      )
    }
    return data.map(r => <RestaurantRow key={r.id} restaurant={r} onUpdateStatus={handleUpdateStatus} />);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <h1 className="text-3xl font-bold tracking-tight">Listings Management</h1>
      <Tabs defaultValue="pending">
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList className="w-full md:w-auto">
            <TabsTrigger value="Pending" className="flex-1 md:flex-initial">Pending</TabsTrigger>
            <TabsTrigger value="Approved" className="flex-1 md:flex-initial">Approved</TabsTrigger>
            <TabsTrigger value="Suspended" className="flex-1 md:flex-initial">Suspended</TabsTrigger>
            <TabsTrigger value="Rejected" className="flex-1 md:flex-initial">Rejected</TabsTrigger>
          </TabsList>
          <div className="relative w-full max-w-sm">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
             <Input 
                placeholder="Search by business name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
             />
          </div>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Name</TableHead>
                  <TableHead className="hidden md:table-cell">Owner Name</TableHead>
                  <TableHead className="hidden lg:table-cell">Owner Email</TableHead>
                  <TableHead className="hidden md:table-cell">Onboarding</TableHead>
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
