
"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Phone, Bike, UserPlus, Search, Edit, RefreshCw, Star, Clock, Trophy, ChevronDown, ChevronUp, BarChart as BarChartIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from "@/lib/utils";
import { auth } from '@/lib/firebase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useSearchParams } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import InfoDialog from '@/components/InfoDialog';


const StatusBadge = ({ status }) => {
    const statusConfig = {
        'Available': 'bg-green-500/10 text-green-400 border-green-500/20',
        'On Delivery': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        'Inactive': 'bg-muted text-muted-foreground border-border',
    };
    return (
        <span className={cn('px-2 py-1 text-xs font-semibold rounded-full border', statusConfig[status] || statusConfig['Inactive'])}>
            {status}
        </span>
    );
};

const AddBoyModal = ({ isOpen, setIsOpen, onSave, boy }) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState('');

    useEffect(() => {
        if (boy) {
            setName(boy.name);
            setPhone(boy.phone);
        } else {
            setName('');
            setPhone('');
        }
        setIsSaving(false);
        setModalError('');
    }, [boy, isOpen]);

    const handleSubmit = async () => {
        setModalError('');
        if (!name.trim() || !phone.trim() || !/^\d{10}$/.test(phone.trim())) {
            setModalError('Please enter a valid name and 10-digit phone number.');
            return;
        }
        setIsSaving(true);
        try {
            await onSave({ id: boy ? boy.id : null, name, phone });
            setIsOpen(false);
        } catch(error) {
           setModalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{boy ? 'Edit Delivery Rider' : 'Add New Delivery Rider'}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <input id="name" value={name} onChange={e => setName(e.target.value)} className="col-span-3 p-2 border rounded-md bg-input border-border" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Phone</Label>
                        <input id="phone" value={phone} onChange={e => setPhone(e.target.value)} className="col-span-3 p-2 border rounded-md bg-input border-border" />
                    </div>
                    {modalError && <p className="text-destructive text-center text-sm">{modalError}</p>}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const AssignOrderModal = ({ isOpen, setIsOpen, onAssign, boyName, readyOrders }) => {
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleAssign = async () => {
        if (selectedOrder) {
            setIsSaving(true);
            try {
                await onAssign(selectedOrder);
                setIsOpen(false);
            } catch(error) {
                // error alert shown in onAssign
                throw error;
            }
            finally {
                setIsSaving(false);
            }
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Assign Order to {boyName}</DialogTitle>
                    <DialogDescription>Select an order that is ready for dispatch.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3 max-h-60 overflow-y-auto">
                    <h4 className="font-semibold text-muted-foreground">Ready Orders:</h4>
                    {readyOrders && readyOrders.length > 0 ? readyOrders.map(order => (
                        <div 
                            key={order.id}
                            onClick={() => setSelectedOrder(order.id)}
                            className={cn(
                                "p-3 rounded-lg border cursor-pointer transition-all",
                                selectedOrder === order.id 
                                  ? 'bg-primary/10 border-primary ring-2 ring-primary'
                                  : 'bg-muted/50 border-border hover:bg-muted'
                            )}
                        >
                            <div className="flex justify-between items-center">
                                <p className="font-bold">{order.id}</p>
                                <p className="text-sm text-muted-foreground">for {order.customer}</p>
                                <p className="text-xs text-muted-foreground">{order.items} items</p>
                            </div>
                        </div>
                    )) : <p className="text-center text-muted-foreground">No orders are ready.</p>}
                </div>
                 <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleAssign} disabled={!selectedOrder || isSaving}>
                        {isSaving ? 'Assigning...' : 'Confirm Assignment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const PerformanceCard = ({ title, value, icon: Icon, onClick, isLoading }) => (
    <div
      className={cn("bg-card p-4 rounded-lg flex items-center gap-4 border border-border", onClick && "cursor-pointer hover:bg-muted transition-colors", isLoading && 'animate-pulse')}
      onClick={onClick}
    >
        <div className="bg-muted p-3 rounded-full text-primary">
            <Icon size={24} />
        </div>
        <div>
            {isLoading ? (
                <>
                    <div className="h-4 bg-muted-foreground/20 rounded w-24 mb-2"></div>
                    <div className="h-6 bg-muted-foreground/20 rounded w-16"></div>
                </>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                </>
            )}
        </div>
    </div>
);

const SortableHeader = ({ children, column, sortConfig, onSort }) => {
    const isSorted = sortConfig.key === column;
    const direction = isSorted ? sortConfig.direction : 'desc';
    const Icon = direction === 'asc' ? ChevronUp : ChevronDown;
  
    return (
      <th onClick={() => onSort(column)} className="cursor-pointer p-4 text-left text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
        <div className="flex items-center gap-2">
          {children}
          {isSorted && <Icon size={16} />}
        </div>
      </th>
    );
  };
  
const DeliveryAnalytics = ({ boysData, weeklyData, isLoading }) => {
    const [sortConfig, setSortConfig] = useState({ key: 'totalDeliveries', direction: 'desc' });
    const [searchQuery, setSearchQuery] = useState("");

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredAndSortedRiders = useMemo(() => {
        if (!boysData) return [];
        let filtered = [...boysData];
        if (searchQuery) {
            filtered = filtered.filter(boy => (boy.name || '').toLowerCase().includes(searchQuery.toLowerCase()));
        }
        filtered.sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (a[sortConfig.key] > b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        return filtered;
    }, [searchQuery, sortConfig, boysData]);

    return(
        <div className="mt-8 space-y-6">
             <h2 className="text-2xl font-bold tracking-tight">Delivery Analytics Hub</h2>
            <section>
                 <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><BarChartIcon/> Team's Weekly Performance</h3>
                 <div className="bg-card border border-border rounded-xl p-5 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData}>
                             <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                             <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                             <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                             <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} formatter={(value) => [value, "Deliveries"]}/>
                             <Bar dataKey="deliveries" fill="hsl(var(--primary))" name="Total Deliveries" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                 </div>
            </section>
            <section>
                <div className="flex justify-between items-center mb-4">
                     <h3 className="text-xl font-bold">Rider Deep Dive</h3>
                     <div className="relative w-full md:w-auto max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input 
                            type="text" 
                            placeholder="Search rider..." 
                            className="bg-input border border-border rounded-lg w-full pl-10 pr-4 py-2 focus:ring-2 focus:ring-primary outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-muted/50">
                                    <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Rider</SortableHeader>
                                    <SortableHeader column="totalDeliveries" sortConfig={sortConfig} onSort={handleSort}>Total Deliveries</SortableHeader>
                                    <SortableHeader column="avgDeliveryTime" sortConfig={sortConfig} onSort={handleSort}>Avg. Time (min)</SortableHeader>
                                    <SortableHeader column="avgRating" sortConfig={sortConfig} onSort={handleSort}>Avg. Rating</SortableHeader>
                                    <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isLoading ? Array.from({length:3}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                    </tr>
                                )) : filteredAndSortedRiders.map(boy => (
                                    <tr key={boy.id} className="hover:bg-muted transition-colors">
                                        <td className="p-4 font-medium">{boy.name}</td>
                                        <td className="p-4 text-center font-bold text-lg">{boy.totalDeliveries || 0}</td>
                                        <td className="p-4 text-center">{boy.avgDeliveryTime || 0}</td>
                                        <td className="p-4 text-center flex items-center justify-center gap-1">
                                            {(boy.avgRating || 0).toFixed(1)} <Star size={14} className="text-yellow-400"/>
                                        </td>
                                        <td className="p-4">
                                            <StatusBadge status={boy.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default function DeliveryPage() {
    const [data, setData] = useState({ boys: [], performance: {}, readyOrders: [], weeklyPerformance: [] });
    const [loading, setLoading] = useState(true);
    const [isAddModalOpen, setAddModalOpen] = useState(false);
    const [isAssignModalOpen, setAssignModalOpen] = useState(false);
    const [selectedBoy, setSelectedBoy] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const handleApiCall = async (method, body, endpoint = '/api/owner/delivery') => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message || 'API call failed');
        return result;
    }

    const fetchData = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const result = await handleApiCall('GET', undefined, '/api/owner/delivery');
            setData(result);
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not load delivery data: " + error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchData();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [impersonatedOwnerId]);

    const handleSaveBoy = async (boyData) => {
        try {
            await handleApiCall(boyData.id ? 'PATCH' : 'POST', { boy: boyData });
            await fetchData(true);
        } catch (error) {
            console.error(error);
            throw new Error(`Error saving delivery boy: ${error.message}`);
        }
    };

    const handleConfirmAssignment = async (orderId) => {
        if (!selectedBoy) return;
        try {
            // This needs to update the order status as well, but for now, just updates the boy.
            await handleApiCall('PATCH', { boy: { id: selectedBoy.id, status: 'On Delivery' } });
            setInfoDialog({ isOpen: true, title: "Success", message: `Order ${orderId} assigned to ${selectedBoy.name}` });
            await fetchData(true);
        } catch (error) {
            console.error(error);
            throw new Error(`Error assigning order: ${error.message}`);
        } finally {
            setSelectedBoy(null);
        }
    };
    
    const handleEdit = (boy) => { setSelectedBoy(boy); setAddModalOpen(true); };
    const handleAddNew = () => { setSelectedBoy(null); setAddModalOpen(true); };
    const handleAssignClick = (boy) => { setSelectedBoy(boy); setAssignModalOpen(true); };
    
    const handleStatusToggle = async (boy, newStatus) => {
         try {
            await handleApiCall('PATCH', { boy: { ...boy, status: newStatus } }, '/api/owner/delivery');
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
        }
    };

    return (
        <div className="p-4 md:p-6 text-foreground bg-background min-h-screen">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <AddBoyModal isOpen={isAddModalOpen} setIsOpen={setAddModalOpen} onSave={handleSaveBoy} boy={selectedBoy} />
            {selectedBoy && <AssignOrderModal isOpen={isAssignModalOpen} setIsOpen={setAssignModalOpen} onAssign={handleConfirmAssignment} boyName={selectedBoy.name} readyOrders={data.readyOrders}/>}
            
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Delivery Command Center</h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">Monitor and manage your delivery team in real-time.</p>
                    </div>
                    <div className="flex-shrink-0 flex gap-4">
                        <Button onClick={() => fetchData(true)} variant="outline" disabled={loading}>
                            <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                        </Button>
                         <Button onClick={handleAddNew}>
                            <UserPlus size={16} className="mr-2"/> Add Rider
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <PerformanceCard title="Total Deliveries Today" value={data.performance?.totalDeliveries || 0} icon={Bike} isLoading={loading} />
                    <PerformanceCard title="Average Delivery Time" value={`${data.performance?.avgDeliveryTime || 0} min`} icon={Clock} isLoading={loading} />
                    <PerformanceCard title="Top Performer" value={data.performance?.topPerformer?.name || 'N/A'} icon={Trophy} isLoading={loading} />
                </div>
                
                <div className="bg-card rounded-xl p-4 flex flex-col border border-border">
                     <h3 className="text-lg font-semibold mb-4">Delivery Team ({data.boys?.length || 0})</h3>
                     <div className="overflow-y-auto space-y-3">
                        {loading ? Array.from({length:3}).map((_, i) => (
                            <div key={i} className="p-3 bg-muted rounded-lg border border-border animate-pulse h-28"></div>
                        )) : (data.boys || []).map(boy => (
                            <motion.div
                                key={boy.id}
                                layout
                                className="p-3 bg-muted/50 rounded-lg border border-border"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-bold text-foreground">{boy.name}</p>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Phone size={12}/>{boy.phone}</p>
                                    </div>
                                    <StatusBadge status={boy.status} />
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground bg-background p-2 rounded-md">
                                    <div>
                                        <p className="font-semibold text-foreground">{boy.deliveriesToday || 0}</p>
                                        <p>Today</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-1">
                                        <p className="font-semibold text-foreground">{(boy.avgDeliveryTime || 0)} min</p>
                                        <p>Avg Time</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-1">
                                        <p className="font-semibold text-foreground">{(boy.avgRating || 0).toFixed(1)}</p>
                                        <Star size={12} className="text-yellow-400"/>
                                    </div>
                                </div>
                                 <div className="mt-3 pt-3 border-t border-border flex justify-between items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={boy.status !== 'Inactive'}
                                            onCheckedChange={(checked) => handleStatusToggle(boy, checked ? 'Available' : 'Inactive')}
                                            disabled={boy.status === 'On Delivery'}
                                            id={`switch-${boy.id}`}
                                        />
                                        <Label htmlFor={`switch-${boy.id}`} className="text-sm text-muted-foreground cursor-pointer">
                                            {boy.status !== 'Inactive' ? 'Active' : 'Inactive'}
                                        </Label>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => handleEdit(boy)}>
                                            <Edit size={14} className="mr-1"/> Edit
                                        </Button>
                                        <Button size="sm" disabled={boy.status !== 'Available'} onClick={() => handleAssignClick(boy)}>
                                            <Bike size={14} className="mr-1"/> Assign Order
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                         {!loading && (!data.boys || data.boys.length === 0) && (
                            <p className="text-center text-muted-foreground py-10">No delivery riders added yet.</p>
                         )}
                    </div>
                </div>

                <DeliveryAnalytics boysData={data.boys} weeklyData={data.weeklyPerformance} isLoading={loading}/>
            </div>
        </div>
    );
}
