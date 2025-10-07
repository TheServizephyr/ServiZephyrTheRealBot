

"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Star, AlertTriangle, Sparkles, X, History, Gift, StickyNote, IndianRupee, Mail, Users, UserPlus, Repeat, Crown, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from "@/lib/utils";
import { auth } from '@/lib/firebase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Wand2, Ticket, Percent, Truck } from 'lucide-react';


const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Handle Firestore Timestamp object if it comes
    if (dateString.seconds) {
        return new Date(dateString.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const date = new Date(dateString);
    if(isNaN(date.getTime())) return 'N/A'; // Invalid date
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;


// --- HELPER FUNCTIONS FOR STATUS ---
const getCustomerStatus = (customer) => {
    if (!customer || !customer.lastOrderDate) return 'New';
    const daysSinceLastOrder = (new Date() - new Date(customer.lastOrderDate)) / (1000 * 60 * 60 * 24);
    
    if (customer.totalOrders > 10) return 'Loyal';
    if (daysSinceLastOrder > 60) return 'At Risk';
    if (customer.totalOrders <= 2) return 'New';
    return 'Active';
}

// --- SUB-COMPONENTS (Single File) ---

const CustomerBadge = ({ status }) => {
  if (status === 'Loyal') {
    return <span title="Loyal Customer" className="flex items-center gap-1 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full"><Star size={12} /> Loyal</span>;
  }
  if (status === 'At Risk') {
    return <span title="At Risk" className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded-full"><AlertTriangle size={12} /> At Risk</span>;
  }
  if (status === 'New') {
     return <span title="New Customer" className="flex items-center gap-1 text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded-full"><Sparkles size={12} /> New</span>;
  }
  return <span title="Active Customer" className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full"><Users size={12} /> Active</span>;
};

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

const CouponModal = ({ isOpen, setIsOpen, customerName }) => {
    const [coupon, setCoupon] = useState(null);

    useEffect(() => {
        if(isOpen) {
            setCoupon({
                code: '', description: `Special reward for ${customerName}`, type: 'flat', value: '',
                minOrder: '', startDate: new Date(), expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                status: 'Active',
            });
        }
    }, [isOpen, customerName]);
    
    if(!coupon) return null;

    const handleChange = (field, value) => {
        setCoupon(prev => (prev ? { ...prev, [field]: value } : null));
    };

    const generateRandomCode = () => {
        const code = `VIP-${customerName.split(' ')[0].toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // In a real app, this would be a backend call
        alert(`Reward coupon "${coupon.code}" created for ${customerName}!`);
        setIsOpen(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-lg bg-gray-900 border-gray-700 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Ticket /> Create a Reward
                        </DialogTitle>
                        <DialogDescription>Sending a special reward to {customerName}.</DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid gap-y-4 py-6">
                         <div>
                            <Label htmlFor="code">Coupon Code</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                                <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2"/> Generate</Button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="value">Discount Value (₹)</Label>
                                <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder="e.g., 100" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                            </div>
                            <div>
                                <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-gray-800 border-gray-600 w-full" />
                            </div>
                        </div>
                         <div>
                            <Label>Expiry Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                   <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {coupon.expiryDate ? format(coupon.expiryDate, 'dd MMM yyyy') : <span>Pick a date</span>}
                                   </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.expiryDate} onSelect={(date) => handleChange('expiryDate', date)} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                    </div>

                    <DialogFooter className="pt-4">
                        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">Send Reward</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const CustomerDetailPanel = ({ customer, onClose, onSaveNotes }) => {
  const [activeTab, setActiveTab] = useState('history');
  const [isCouponModalOpen, setCouponModalOpen] = useState(false);
  const [notes, setNotes] = useState(customer.notes || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setNotes(customer.notes || '');
  }, [customer]);

  if (!customer) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
        await onSaveNotes(customer.id, notes);
        alert("Notes saved!");
    } catch(err) {
        alert("Failed to save notes. " + err.message);
    } finally {
        setIsSaving(false);
    }
  }

  const tabs = [
    { id: 'history', label: 'Order History', icon: History },
    { id: 'actions', label: 'Actions', icon: Gift },
    { id: 'notes', label: 'Notes', icon: StickyNote },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed top-0 right-0 h-full w-full max-w-lg bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col"
    >
      <CouponModal isOpen={isCouponModalOpen} setIsOpen={setCouponModalOpen} customerName={customer.name} />

      {/* Header */}
      <div className="p-6 border-b border-gray-700 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-white">{customer.name}</h2>
          <p className="text-sm text-gray-400 flex items-center gap-2 mt-1"><Mail size={14} /> {customer.email}</p>
          <div className="mt-3"><CustomerBadge status={getCustomerStatus(customer)} /></div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:bg-gray-700 hover:text-white">
          <X size={24} />
        </Button>
      </div>

       {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-px bg-gray-700">
        <div className="bg-gray-800 p-4 text-center">
            <p className="text-xs text-gray-400">Total Spend</p>
            <p className="text-xl font-bold text-white">{formatCurrency(customer.totalSpend)}</p>
        </div>
        <div className="bg-gray-800 p-4 text-center">
            <p className="text-xs text-gray-400">Total Orders</p>
            <p className="text-xl font-bold text-white">{customer.totalOrders}</p>
        </div>
        <div className="bg-gray-800 p-4 text-center">
            <p className="text-xs text-gray-400">Member Since</p>
            <p className="text-xl font-bold text-white">{formatDate(customer.joinDate)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex -mb-px">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-4 px-1 text-center border-b-2 text-sm font-medium flex items-center justify-center gap-2 ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              <tab.icon size={16} /> {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="flex-grow p-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'history' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-white">All Orders ({customer.orderHistory?.length || 0})</h3>
                {customer.orderHistory && customer.orderHistory.length > 0 ? customer.orderHistory.map(order => (
                  <div key={order.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-white">{order.id}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.date)}</p>
                    </div>
                    <p className="font-bold text-lg text-white">{formatCurrency(order.amount)}</p>
                  </div>
                )) : <p className="text-gray-400 text-center py-4">No order history available.</p>}
              </div>
            )}
            {activeTab === 'actions' && (
              <div className="space-y-4">
                 <h3 className="font-semibold text-white">Engage with {customer.name}</h3>
                 <div className="bg-gray-800 p-4 rounded-lg">
                    <h4 className="font-semibold text-indigo-400">Send a Custom Discount</h4>
                    <p className="text-sm text-gray-400 mt-1 mb-3">Reward their loyalty with a special coupon.</p>
                    <Button onClick={() => setCouponModalOpen(true)} className="w-full bg-indigo-600 hover:bg-indigo-700">
                        <Gift size={16} className="mr-2"/> Create & Send Coupon
                    </Button>
                 </div>
              </div>
            )}
            {activeTab === 'notes' && (
               <div>
                 <h3 className="font-semibold text-white mb-2">Private Notes</h3>
                 <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={8} 
                    className="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-indigo-500 focus:border-indigo-500" 
                    placeholder={`e.g., Prefers window seat, always orders extra sauce...`}
                 />
                 <div className="mt-4 flex justify-end">
                    <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700" disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Notes'}
                    </Button>
                 </div>
               </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

const StatCard = ({ icon: Icon, title, value, detail, isLoading }) => (
    <div className={`bg-gray-800/50 p-5 rounded-xl border border-gray-700 flex items-start gap-4 ${isLoading ? 'animate-pulse' : ''}`}>
        <div className="bg-gray-900 p-3 rounded-lg">
            <Icon className={`h-6 w-6 text-indigo-400 ${isLoading ? 'invisible' : ''}`} />
        </div>
        <div>
            {isLoading ? (
                <>
                  <div className="h-4 bg-gray-700 rounded w-24 mb-2"></div>
                  <div className="h-8 bg-gray-700 rounded w-16 mb-2"></div>
                  <div className="h-3 bg-gray-700 rounded w-32"></div>
                </>
            ) : (
                <>
                  <p className="text-sm text-gray-400">{title}</p>
                  <p className="text-2xl font-bold text-white">{value}</p>
                  <p className="text-xs text-gray-500">{detail}</p>
                </>
            )}
        </div>
    </div>
);

// --- MAIN PAGE COMPONENT ---
export default function CustomersPage() {
    const [customers, setCustomers] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'totalSpend', direction: 'desc' });
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("All");
    const [isCouponModalOpen, setCouponModalOpen] = useState(false);
    const [rewardCustomer, setRewardCustomer] = useState(null);

    useEffect(() => {
        const fetchCustomers = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) throw new Error("User not authenticated.");
                const idToken = await user.getIdToken();
                const res = await fetch('/api/owner/customers', {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to fetch');
                }
                const data = await res.json();
                setCustomers(data.customers || []);
                setStats(data.stats || {});
            } catch (error) {
                console.error("Failed to fetch customers:", error);
                alert("Could not load customer data: " + error.message);
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchCustomers();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const vipCustomers = useMemo(() => {
        return [...customers].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 5);
    }, [customers]);

    const handleSendReward = (customer) => {
        setRewardCustomer(customer);
        setCouponModalOpen(true);
    };

    const filteredAndSortedCustomers = useMemo(() => {
        if (loading) return [];
        let filteredItems = [...customers];

        if (activeFilter !== 'All') {
            filteredItems = filteredItems.filter(customer => getCustomerStatus(customer) === activeFilter);
        }
        if (searchQuery) {
            const lowercasedQuery = searchQuery.toLowerCase();
            filteredItems = filteredItems.filter(customer =>
                (customer.name || '').toLowerCase().includes(lowercasedQuery) ||
                (customer.email || '').toLowerCase().includes(lowercasedQuery)
            );
        }
        filteredItems.sort((a, b) => {
            const key = sortConfig.key;
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            if (a[key] < b[key]) return -1 * dir;
            if (a[key] > b[key]) return 1 * dir;
            return 0;
        });

        return filteredItems;
    }, [customers, sortConfig, searchQuery, activeFilter, loading]);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleSaveNotes = async (customerId, newNotes) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        const res = await fetch('/api/owner/customers', {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ customerId, notes: newNotes })
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || "Failed to save notes.");
        }

        setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, notes: newNotes } : c));
        if(selectedCustomer && selectedCustomer.id === customerId) {
            setSelectedCustomer(prev => ({...prev, notes: newNotes}));
        }
    };
    
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setSelectedCustomer(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
    
    const filterButtons = [
        { label: 'All', value: 'All' },
        { label: 'Loyal', value: 'Loyal', className: 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' },
        { label: 'At Risk', value: 'At Risk', className: 'bg-red-500/10 text-red-500 hover:bg-red-500/20' },
        { label: 'New', value: 'New', className: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' },
        { label: 'Active', value: 'Active', className: 'bg-green-500/10 text-green-500 hover:bg-green-500/20' }
    ];

    return (
        <div className="p-4 md:p-6 text-white relative min-h-screen bg-gray-900">
             {rewardCustomer && <CouponModal isOpen={isCouponModalOpen} setIsOpen={setCouponModalOpen} customerName={rewardCustomer.name} />}

            <div>
                <h1 className="text-3xl font-bold tracking-tight">Customer Hub</h1>
                <p className="text-gray-400 mt-1">Manage, analyze, and engage with your customers.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 my-6">
                <StatCard isLoading={loading} icon={Users} title="Total Customers" value={stats.totalCustomers || 0} detail="All-time customers" />
                <StatCard isLoading={loading} icon={UserPlus} title="New This Month" value={stats.newThisMonth || 0} detail="Joined in the last 30 days" />
                <StatCard isLoading={loading} icon={Repeat} title="Repeat Customer Rate" value={`${stats.repeatRate || 0}%`} detail="Customers with more than one order" />
                <StatCard isLoading={loading} icon={Crown} title="Top Spender" value={stats.topSpender?.name || 'N/A'} detail={formatCurrency(stats.topSpender?.totalSpend)} />
            </div>

            <section className="my-8">
                <h3 className="text-xl font-bold mb-4">❤️ Your VIP Lounge</h3>
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-800">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-gray-400">Rank</th>
                                    <th className="p-4 text-sm font-semibold text-gray-400">Customer</th>
                                    <th className="p-4 text-sm font-semibold text-gray-400">Total Spend</th>
                                    <th className="p-4 text-sm font-semibold text-gray-400">Total Orders</th>
                                    <th className="p-4 text-sm font-semibold text-gray-400 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {loading ? Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/4"></div></td>
                                        <td className="p-4 flex justify-center"><div className="h-8 bg-gray-700 rounded w-3/4"></div></td>
                                    </tr>
                                )) : vipCustomers.map((cust, i) => (
                                    <tr key={cust.id} className="hover:bg-gray-700/50 transition-colors">
                                        <td className="p-4"><span className="font-bold text-lg">{i + 1}</span></td>
                                        <td className="p-4 font-semibold">{cust.name}</td>
                                        <td className="p-4 text-green-400 font-bold">{formatCurrency(cust.totalSpend)}</td>
                                        <td className="p-4 text-center">{cust.totalOrders}</td>
                                        <td className="p-4 text-center">
                                            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500" onClick={() => handleSendReward(cust)}>
                                                <Gift size={16} className="mr-2"/> Send Reward
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>


            <div className="my-6 p-4 bg-gray-800/50 rounded-xl border border-gray-700 flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                        type="text" 
                        placeholder="Search by name or email..." 
                        className="bg-gray-900 border border-gray-600 rounded-lg w-full md:w-80 pl-10 pr-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                     <Filter size={16} className="text-gray-400"/>
                    <span className="text-sm font-medium">Filter by segment:</span>
                    <div className="flex items-center gap-2 flex-wrap">
                        {filterButtons.map(btn => (
                           <Button 
                             key={btn.value} 
                             variant="secondary" 
                             size="sm" 
                             onClick={() => setActiveFilter(btn.value)}
                             className={cn('bg-gray-700 hover:bg-gray-600', btn.className, activeFilter === btn.value && 'ring-2 ring-indigo-500')}
                           >
                            {btn.label}
                           </Button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-800">
                                <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                                <SortableHeader column="lastOrderDate" sortConfig={sortConfig} onSort={handleSort}>Last Order</SortableHeader>
                                <SortableHeader column="totalOrders" sortConfig={sortConfig} onSort={handleSort}>Total Orders</SortableHeader>
                                <SortableHeader column="totalSpend" sortConfig={sortConfig} onSort={handleSort}>Total Spend</SortableHeader>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {loading ? (
                                Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/2"></div></td>
                                    </tr>
                                ))
                            ) : filteredAndSortedCustomers.map(customer => (
                                <motion.tr 
                                    key={customer.id} 
                                    onClick={() => setSelectedCustomer(customer)}
                                    className="cursor-pointer hover:bg-gray-700/50 transition-colors"
                                    whileHover={{scale: 1.01}}
                                >
                                    <td className="p-4 font-medium">
                                        <div className="flex flex-col">
                                           <div className="flex items-center gap-3">
                                               {customer.name}
                                               <CustomerBadge status={getCustomerStatus(customer)} />
                                           </div>
                                           <span className="text-xs text-gray-400">{customer.email}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-gray-300">{formatDate(customer.lastOrderDate)}</td>
                                    <td className="p-4 text-gray-300 text-center">{customer.totalOrders}</td>
                                    <td className="p-4 font-semibold text-right">{formatCurrency(customer.totalSpend)}</td>
                                </motion.tr>
                            ))}
                             { !loading && filteredAndSortedCustomers.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="text-center p-8 text-gray-400">
                                        No customers found for this filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <AnimatePresence>
                {selectedCustomer && (
                    <CustomerDetailPanel 
                        customer={selectedCustomer} 
                        onClose={() => setSelectedCustomer(null)}
                        onSaveNotes={handleSaveNotes}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
