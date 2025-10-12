

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


const StatusBadge = ({ status }) => {
    const statusConfig = {
        'Available': 'bg-green-500/20 text-green-400 border-green-500/30',
        'On Delivery': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        'Inactive': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
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

    useEffect(() => {
        if (boy) {
            setName(boy.name);
            setPhone(boy.phone);
        } else {
            setName('');
            setPhone('');
        }
        setIsSaving(false);
    }, [boy, isOpen]);

    const handleSubmit = async () => {
        if (!name.trim() || !phone.trim() || !/^\d{10}$/.test(phone.trim())) {
            alert('Please enter a valid name and 10-digit phone number.');
            return;
        }
        setIsSaving(true);
        try {
            await onSave({ id: boy ? boy.id : null, name, phone });
            setIsOpen(false);
        } catch(error) {
           // error alert is shown in onSave
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-gray-900 border-gray-700 text-white">
                <DialogHeader>
                    <DialogTitle>{boy ? 'Edit Delivery Boy' : 'Add New Delivery Boy'}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <input id="name" value={name} onChange={e => setName(e.target.value)} className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Phone</Label>
                        <input id="phone" value={phone} onChange={e => setPhone(e.target.value)} className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} className="bg-indigo-600 hover:bg-indigo-700" disabled={isSaving}>
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
            }
            finally {
                setIsSaving(false);
            }
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-gray-900 border-gray-700 text-white">
                <DialogHeader>
                    <DialogTitle>Assign Order to {boyName}</DialogTitle>
                    <DialogDescription>Select an order that is ready for dispatch.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3 max-h-60 overflow-y-auto">
                    <h4 className="font-semibold text-gray-300">Ready Orders:</h4>
                    {readyOrders && readyOrders.length > 0 ? readyOrders.map(order => (
                        <div 
                            key={order.id}
                            onClick={() => setSelectedOrder(order.id)}
                            className={cn(
                                "p-3 rounded-lg border cursor-pointer transition-all",
                                selectedOrder === order.id 
                                  ? 'bg-indigo-500/30 border-indigo-400 ring-2 ring-indigo-400'
                                  : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                            )}
                        >
                            <div className="flex justify-between items-center">
                                <p className="font-bold">{order.id}</p>
                                <p className="text-sm text-gray-300">for {order.customer}</p>
                                <p className="text-xs text-gray-400">{order.items} items</p>
                            </div>
                        </div>
                    )) : <p className="text-center text-gray-400">No orders are ready.</p>}
                </div>
                 <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleAssign} disabled={!selectedOrder || isSaving} className="bg-indigo-600 hover:bg-indigo-700">
                        {isSaving ? 'Assigning...' : 'Confirm Assignment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const PerformanceCard = ({ title, value, icon: Icon, onClick, isLoading }) => (
    <div
      className={cn("bg-gray-800/50 p-4 rounded-lg flex items-center gap-4 border border-gray-700", onClick && "cursor-pointer hover:bg-gray-700/50 transition-colors", isLoading && 'animate-pulse')}
      onClick={onClick}
    >
        <div className="bg-gray-900 p-3 rounded-full text-indigo-400">
            <Icon size={24} />
        </div>
        <div>
            {isLoading ? (
                <>
                    <div className="h-4 bg-gray-700 rounded w-24 mb-2"></div>
                    <div className="h-6 bg-gray-700 rounded w-16"></div>
                </>
            ) : (
                <>
                    <p className="text-sm text-gray-400">{title}</p>
                    <p className="text-xl font-bold text-white">{value}</p>
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
      <th onClick={() => onSort(column)} className="cursor-pointer p-4 text-left text-sm font-semibold text-gray-400 hover:bg-gray-800 transition-colors">
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
                 <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData}>
                             <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                             <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: '#9CA3AF' }} />
                             <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: '#9CA3AF' }} />
                             <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} formatter={(value) => [value, "Deliveries"]}/>
                             <Bar dataKey="deliveries" fill="rgba(129, 140, 248, 0.6)" name="Total Deliveries" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                 </div>
            </section>
            <section>
                <div className="flex justify-between items-center mb-4">
                     <h3 className="text-xl font-bold">Rider Deep Dive</h3>
                     <div className="relative w-full md:w-auto max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input 
                            type="text" 
                            placeholder="Search rider..." 
                            className="bg-gray-800 border border-gray-600 rounded-lg w-full pl-10 pr-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-800">
                                    <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Rider</SortableHeader>
                                    <SortableHeader column="totalDeliveries" sortConfig={sortConfig} onSort={handleSort}>Total Deliveries</SortableHeader>
                                    <SortableHeader column="avgDeliveryTime" sortConfig={sortConfig} onSort={handleSort}>Avg. Time (min)</SortableHeader>
                                    <SortableHeader column="avgRating" sortConfig={sortConfig} onSort={handleSort}>Avg. Rating</SortableHeader>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-400">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700/50">
                                {isLoading ? Array.from({length:3}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded"></div></td>
                                    </tr>
                                )) : filteredAndSortedRiders.map(boy => (
                                    <tr key={boy.id} className="hover:bg-gray-700/50 transition-colors">
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
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const handleApiCall = async (method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL('/api/owner/delivery', window.location.origin);
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
            const result = await handleApiCall('GET');
            setData(result);
        } catch (error) {
            console.error(error);
            alert("Could not load delivery data: " + error.message);
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
            alert(`Error saving delivery boy: ${error.message}`);
            throw error;
        }
    };

    const handleConfirmAssignment = async (orderId) => {
        if (!selectedBoy) return;
        try {
            // This needs to update the order status as well, but for now, just updates the boy.
            await handleApiCall('PATCH', { boy: { id: selectedBoy.id, status: 'On Delivery' } });
            alert(`Order ${orderId} assigned to ${selectedBoy.name}`);
            await fetchData(true);
        } catch (error) {
            alert(`Error assigning order: ${error.message}`);
            throw error;
        } finally {
            setSelectedBoy(null);
        }
    };
    
    const handleEdit = (boy) => { setSelectedBoy(boy); setAddModalOpen(true); };
    const handleAddNew = () => { setSelectedBoy(null); setAddModalOpen(true); };
    const handleAssignClick = (boy) => { setSelectedBoy(boy); setAssignModalOpen(true); };

    return (
        <div className="p-4 md:p-6 text-white bg-gray-900 min-h-screen">
            <AddBoyModal isOpen={isAddModalOpen} setIsOpen={setAddModalOpen} onSave={handleSaveBoy} boy={selectedBoy} />
            {selectedBoy && <AssignOrderModal isOpen={isAssignModalOpen} setIsOpen={setAssignModalOpen} onAssign={handleConfirmAssignment} boyName={selectedBoy.name} readyOrders={data.readyOrders}/>}
            
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Delivery Command Center</h1>
                        <p className="text-gray-400 mt-1 text-sm md:text-base">Monitor and manage your delivery team in real-time.</p>
                    </div>
                    <div className="flex-shrink-0 flex gap-4">
                        <Button onClick={() => fetchData(true)} variant="outline" className="bg-gray-800 border-gray-700 hover:bg-gray-700">
                            <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                        </Button>
                         <Button onClick={handleAddNew} className="bg-indigo-600 hover:bg-indigo-700">
                            <UserPlus size={16} className="mr-2"/> Add Rider
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <PerformanceCard title="Total Deliveries Today" value={data.performance?.totalDeliveries || 0} icon={Bike} isLoading={loading} />
                    <PerformanceCard title="Average Delivery Time" value={`${data.performance?.avgDeliveryTime || 0} min`} icon={Clock} isLoading={loading} />
                    <PerformanceCard title="Top Performer" value={data.performance?.topPerformer?.name || 'N/A'} icon={Trophy} isLoading={loading} />
                </div>
                
                <div className="bg-gray-800/50 rounded-xl p-4 flex flex-col border border-gray-700">
                     <h3 className="text-lg font-semibold mb-4">Delivery Team ({data.boys?.length || 0})</h3>
                     <div className="overflow-y-auto space-y-3">
                        {loading ? Array.from({length:3}).map((_, i) => (
                            <div key={i} className="p-3 bg-gray-800 rounded-lg border border-gray-700 animate-pulse h-28"></div>
                        )) : (data.boys || []).map(boy => (
                            <motion.div
                                key={boy.id}
                                layout
                                className="p-3 bg-gray-800 rounded-lg border border-gray-700"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-bold text-white">{boy.name}</p>
                                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-1"><Phone size={12}/>{boy.phone}</p>
                                    </div>
                                    <StatusBadge status={boy.status} />
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-gray-300 bg-gray-900/50 p-2 rounded-md">
                                    <div>
                                        <p className="font-semibold">{boy.deliveriesToday || 0}</p>
                                        <p className="text-gray-400">Today</p>
                                    </div>
                                    <div className="flex items-center justify-center gap-1">
                                        <p className="font-semibold">{(boy.avgDeliveryTime || 0)} min</p>
                                        <p className="text-gray-400">Avg Time</p>
                                    </div>
                                    <div className="flex items-center justify-center gap-1">
                                        <p className="font-semibold">{(boy.avgRating || 0).toFixed(1)}</p>
                                        <Star size={12} className="text-yellow-400"/>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-gray-700 flex justify-end gap-2 flex-wrap">
                                    <Button variant="outline" size="sm" className="bg-gray-700 hover:bg-gray-600 border-gray-600" onClick={() => handleEdit(boy)}>
                                        <Edit size={14} className="mr-1"/> Edit
                                    </Button>
                                    <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={boy.status !== 'Available'} onClick={() => handleAssignClick(boy)}>
                                        <Bike size={14} className="mr-1"/> Assign Order
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                         {!loading && (!data.boys || data.boys.length === 0) && (
                            <p className="text-center text-gray-500 py-10">No delivery boys added yet.</p>
                         )}
                    </div>
                </div>

                <DeliveryAnalytics boysData={data.boys} weeklyData={data.weeklyPerformance} isLoading={loading}/>
            </div>
        </div>
    );
}
