

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
import { useSearchParams } from 'next/navigation';


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
    if(customer.status === 'claimed' && customer.totalOrders <= 2) return 'Claimed'; // Prioritize 'Claimed' for new-ish customers
    const lastOrderDate = customer.lastOrderDate.seconds ? new Date(customer.lastOrderDate.seconds * 1000) : new Date(customer.lastOrderDate);
    const daysSinceLastOrder = (new Date() - lastOrderDate) / (1000 * 60 * 60 * 24);
    
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
  if (status === 'Claimed') {
    return <span title="Claimed via Order" className="flex items-center gap-1 text-xs text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-full"><Sparkles size={12} /> Claimed</span>;
  }
  return <span title="Active Customer" className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full"><Users size={12} /> Active</span>;
};

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

const CouponModal = ({ isOpen, setIsOpen, onSave, customer }) => {
    const [coupon, setCoupon] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if(isOpen && customer) {
            setCoupon({
                code: '',
                description: `Special reward for ${customer.name}`,
                type: 'flat',
                value: '',
                minOrder: '',
                startDate: new Date(),
                expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                status: 'Active',
                customerId: customer.id, // Associate coupon with customer
            });
        }
    }, [isOpen, customer]);
    
    if(!coupon) return null;

    const handleChange = (field, value) => {
        setCoupon(prev => (prev ? { ...prev, [field]: value } : null));
    };

    const generateRandomCode = () => {
        const code = `VIP-${customer.name.split(' ')[0].toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            alert("Failed to save reward: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Ticket /> Create a Reward
                        </DialogTitle>
                        <DialogDescription>Sending a special reward to {customer.name}.</DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid gap-y-4 py-6">
                         <div>
                            <Label htmlFor="code">Coupon Code</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-input border-border w-full" />
                                <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2"/> Generate</Button>
                            </div>
                        </div>
                         <div>
                            <Label htmlFor="description">Description</Label>
                            <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={2} placeholder="e.g., A special thanks for being a loyal customer." className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="value">Discount Value (₹ or %)</Label>
                                <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder="e.g., 100 or 20" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                            <div>
                                <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
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
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                            {isSaving ? 'Sending...' : 'Send Reward'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const CustomerDetailPanel = ({ customer, onClose, onSaveNotes, onSendReward }) => {
  const [activeTab, setActiveTab] = useState('history');
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
      className="fixed top-0 right-0 h-full w-full max-w-lg bg-card border-l border-border shadow-2xl z-50 flex flex-col"
    >
      {/* Header */}
      <div className="p-6 border-b border-border flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{customer.name}</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Mail size={14} /> {customer.email}</p>
          <div className="mt-3"><CustomerBadge status={getCustomerStatus(customer)} /></div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={24} />
        </Button>
      </div>

       {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-px bg-border">
        <div className="bg-background p-4 text-center">
            <p className="text-xs text-muted-foreground">Total Spend</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(customer.totalSpend)}</p>
        </div>
        <div className="bg-background p-4 text-center">
            <p className="text-xs text-muted-foreground">Total Orders</p>
            <p className="text-xl font-bold text-foreground">{customer.totalOrders}</p>
        </div>
        <div className="bg-background p-4 text-center">
            <p className="text-xs text-muted-foreground">Last Order</p>
            <p className="text-xl font-bold text-foreground">{formatDate(customer.lastOrderDate)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex -mb-px">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-4 px-1 text-center border-b-2 text-sm font-medium flex items-center justify-center gap-2 ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
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
                <h3 className="font-semibold text-foreground">All Orders ({customer.orderHistory?.length || 0})</h3>
                {customer.orderHistory && customer.orderHistory.length > 0 ? customer.orderHistory.map(order => (
                  <div key={order.id} className="bg-muted p-3 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-foreground">{order.id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(order.date)}</p>
                    </div>
                    <p className="font-bold text-lg text-foreground">{formatCurrency(order.amount)}</p>
                  </div>
                )) : <p className="text-muted-foreground text-center py-4">No order history available.</p>}
              </div>
            )}
            {activeTab === 'actions' && (
              <div className="space-y-4">
                 <h3 className="font-semibold text-foreground">Engage with {customer.name}</h3>
                 <div className="bg-muted p-4 rounded-lg">
                    <h4 className="font-semibold text-primary">Send a Custom Discount</h4>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">Reward their loyalty with a special coupon.</p>
                    <Button onClick={() => onSendReward(customer)} className="w-full bg-primary hover:bg-primary/90">
                        <Gift size={16} className="mr-2"/> Create & Send Reward
                    </Button>
                 </div>
              </div>
            )}
            {activeTab === 'notes' && (
               <div>
                 <h3 className="font-semibold text-foreground mb-2">Private Notes</h3>
                 <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={8} 
                    className="w-full p-3 bg-input border border-border rounded-lg text-foreground focus:ring-primary focus:border-primary" 
                    placeholder={`e.g., Prefers window seat, always orders extra sauce...`}
                 />
                 <div className="mt-4 flex justify-end">
                    <Button onClick={handleSave} className="bg-primary hover:bg-primary/90" disabled={isSaving}>
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
    <div className={cn("bg-card p-5 rounded-xl border border-border flex items-start gap-4", isLoading && 'animate-pulse')}>
        <div className="bg-muted p-3 rounded-lg">
            <Icon className={cn("h-6 w-6 text-primary", isLoading && 'invisible')} />
        </div>
        <div>
            {isLoading ? (
                <>
                  <div className="h-4 bg-muted rounded w-24 mb-2"></div>
                  <div className="h-8 bg-muted rounded w-16 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-32"></div>
                </>
            ) : (
                <>
                  <p className="text-sm text-muted-foreground">{title}</p>
                  <p className="text-2xl font-bold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{detail}</p>
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
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const handleApiCall = async (endpoint, method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL(endpoint, window.location.origin)
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }

    useEffect(() => {
        const fetchCustomers = async () => {
            setLoading(true);
            try {
                const data = await handleApiCall('/api/owner/customers', 'GET');
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
    }, [impersonatedOwnerId]);
    
    const vipCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0)).slice(0, 5);
    }, [customers]);

    const handleSendReward = (customer) => {
        setRewardCustomer(customer);
        setCouponModalOpen(true);
    };
    
    const handleSaveReward = async (couponData) => {
        const payload = {
            ...couponData,
            startDate: couponData.startDate.toISOString(),
            expiryDate: couponData.expiryDate.toISOString(),
        };
        await handleApiCall('/api/owner/coupons', 'POST', { coupon: payload });
        alert(`Reward coupon "${couponData.code}" created for ${rewardCustomer.name}!`);
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
            let valA = a[key];
            let valB = b[key];
             if (key.includes('Date')) {
                valA = a[key]?.seconds ? new Date(a[key].seconds * 1000) : new Date(a[key]);
                valB = b[key]?.seconds ? new Date(b[key].seconds * 1000) : new Date(b[key]);
            }
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
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
        await handleApiCall('/api/owner/customers', 'PATCH', { customerId, notes: newNotes });
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
        { label: 'Claimed', value: 'Claimed', className: 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20' },
        { label: 'Loyal', value: 'Loyal', className: 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' },
        { label: 'At Risk', value: 'At Risk', className: 'bg-red-500/10 text-red-500 hover:bg-red-500/20' },
        { label: 'New', value: 'New', className: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' },
        { label: 'Active', value: 'Active', className: 'bg-green-500/10 text-green-500 hover:bg-green-500/20' }
    ];

    return (
        <div className="p-4 md:p-6 text-foreground relative min-h-screen bg-background">
             {rewardCustomer && <CouponModal isOpen={isCouponModalOpen} setIsOpen={setCouponModalOpen} customer={rewardCustomer} onSave={handleSaveReward} />}

            <div>
                <h1 className="text-3xl font-bold tracking-tight">Customer Hub</h1>
                <p className="text-muted-foreground mt-1">Manage, analyze, and engage with your customers.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 my-6">
                <StatCard isLoading={loading} icon={Users} title="Total Customers" value={stats.totalCustomers || 0} detail="All-time customers" />
                <StatCard isLoading={loading} icon={UserPlus} title="New This Month" value={stats.newThisMonth || 0} detail="Joined in the last 30 days" />
                <StatCard isLoading={loading} icon={Repeat} title="Repeat Customer Rate" value={`${stats.repeatRate || 0}%`} detail="Customers with more than one order" />
                <StatCard isLoading={loading} icon={Crown} title="Top Spender" value={stats.topSpender?.name || 'N/A'} detail={formatCurrency(stats.topSpender?.totalSpend)} />
            </div>

            <section className="my-8">
                <h3 className="text-xl font-bold mb-4">❤️ Your VIP Lounge</h3>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Rank</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Total Spend</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Total Orders</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4 flex justify-center"><div className="h-8 bg-muted rounded w-3/4"></div></td>
                                    </tr>
                                )) : vipCustomers.map((cust, i) => (
                                    <tr key={cust.id} className="hover:bg-muted transition-colors">
                                        <td className="p-4"><span className="font-bold text-lg">{i + 1}</span></td>
                                        <td className="p-4 font-semibold">{cust.name}</td>
                                        <td className="p-4 text-green-400 font-bold">{formatCurrency(cust.totalSpend)}</td>
                                        <td className="p-4 text-center">{cust.totalOrders}</td>
                                        <td className="p-4 text-center">
                                            <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => handleSendReward(cust)}>
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


            <div className="my-6 p-4 bg-card rounded-xl border border-border flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                    <input 
                        type="text" 
                        placeholder="Search by name or email..." 
                        className="bg-input border border-border rounded-lg w-full md:w-80 pl-10 pr-4 py-2 focus:ring-2 focus:ring-primary outline-none"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                     <Filter size={16} className="text-muted-foreground"/>
                    <span className="text-sm font-medium">Filter by segment:</span>
                    <div className="flex items-center gap-2 flex-wrap">
                        {filterButtons.map(btn => (
                           <Button 
                             key={btn.value} 
                             variant="secondary" 
                             size="sm" 
                             onClick={() => setActiveFilter(btn.value)}
                             className={cn('bg-muted hover:bg-muted/80', btn.className, activeFilter === btn.value && 'ring-2 ring-primary')}
                           >
                            {btn.label}
                           </Button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/50">
                                <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                                <SortableHeader column="lastOrderDate" sortConfig={sortConfig} onSort={handleSort}>Last Order</SortableHeader>
                                <SortableHeader column="totalOrders" sortConfig={sortConfig} onSort={handleSort}>Total Orders</SortableHeader>
                                <SortableHeader column="totalSpend" sortConfig={sortConfig} onSort={handleSort}>Total Spend</SortableHeader>
                                <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({length: 5}).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/3"></div></td>
                                    </tr>
                                ))
                            ) : filteredAndSortedCustomers.map(customer => (
                                <motion.tr 
                                    key={customer.id} 
                                    onClick={() => setSelectedCustomer(customer)}
                                    className="cursor-pointer hover:bg-muted transition-colors"
                                    whileHover={{scale: 1.01}}
                                >
                                    <td className="p-4 font-medium">
                                        <div className="flex flex-col">
                                           <div className="flex items-center gap-3">
                                               {customer.name}
                                           </div>
                                           <span className="text-xs text-muted-foreground">{customer.email}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-muted-foreground">{formatDate(customer.lastOrderDate)}</td>
                                    <td className="p-4 text-muted-foreground text-center">{customer.totalOrders}</td>
                                    <td className="p-4 font-semibold text-right">{formatCurrency(customer.totalSpend)}</td>
                                    <td className="p-4"><CustomerBadge status={getCustomerStatus(customer)} /></td>
                                </motion.tr>
                            ))}
                             { !loading && filteredAndSortedCustomers.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="text-center p-8 text-muted-foreground">
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
                        onSendReward={handleSendReward}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}


    

    