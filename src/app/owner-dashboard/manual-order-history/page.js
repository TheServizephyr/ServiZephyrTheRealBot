"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, RefreshCw, Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import BillToPrint from '@/components/BillToPrint';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const toDateInput = (date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};

const defaultSummary = {
    totalBills: 0, totalAmount: 0, avgBillValue: 0,
    pendingSettlementAmount: 0, pendingSettlementBills: 0,
    settledAmount: 0, settledBills: 0,
};

const TABS = ['all', 'delivery', 'pickup', 'dine-in'];

export default function ManualOrderHistoryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [history, setHistory] = useState([]);
    const [activeTab, setActiveTab] = useState('all');
    const [summary, setSummary] = useState(defaultSummary);
    const [loading, setLoading] = useState(true);
    const [isSettling, setIsSettling] = useState(false);
    const [selectedBillIds, setSelectedBillIds] = useState([]);
    const [settlingBillIds, setSettlingBillIds] = useState([]);
    const [selectedBill, setSelectedBill] = useState(null);
    const [printBillData, setPrintBillData] = useState(null);
    const [pendingRebillPrint, setPendingRebillPrint] = useState(false);
    const [restaurant, setRestaurant] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const rebillPrintRef = useRef(null);

    const [fromDate, setFromDate] = useState(() => toDateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    const [toDate, setToDate] = useState(() => toDateInput(new Date()));

    const accessQuery = impersonatedOwnerId
        ? `impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '';

    const backUrl = impersonatedOwnerId
        ? `/owner-dashboard/manual-order?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `/owner-dashboard/manual-order?employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '/owner-dashboard/manual-order';

    const handleRebillPrint = useReactToPrint({ content: () => rebillPrintRef.current });

    const fetchRestaurantDetails = async () => {
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        const settingsUrl = new URL('/api/owner/settings', window.location.origin);
        if (accessQuery) {
            new URLSearchParams(accessQuery).forEach((v, k) => settingsUrl.searchParams.set(k, v));
        }
        const res = await fetch(settingsUrl.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setRestaurant({
            name: data.restaurantName || 'Outlet',
            address: data.address || '',
            gstin: data.gstin || '',
            gstEnabled: !!data.gstEnabled,
            gstPercentage: Number(data.gstPercentage ?? data.gstRate ?? 0),
            gstMinAmount: Number(data.gstMinAmount ?? 0),
        });
    };

    const fetchHistory = async () => {
        try {
            setLoading(true);
            const user = auth.currentUser;
            if (!user) throw new Error('Please login first.');
            const idToken = await user.getIdToken();

            const apiUrl = new URL('/api/owner/custom-bill/history', window.location.origin);
            apiUrl.searchParams.set('from', fromDate);
            apiUrl.searchParams.set('to', toDate);
            apiUrl.searchParams.set('limit', '300');
            if (impersonatedOwnerId) apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) apiUrl.searchParams.set('employee_of', employeeOfOwnerId);

            const res = await fetch(apiUrl.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.message || 'Failed to load order history.');

            setHistory(Array.isArray(data.history) ? data.history : []);
            setSummary({ ...defaultSummary, ...(data.summary || {}) });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Load Failed', message: error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                fetchHistory();
                fetchRestaurantDetails().catch(() => {});
            } else {
                setLoading(false);
            }
        });
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, accessQuery]);

    useEffect(() => {
        if (!pendingRebillPrint || !printBillData) return;
        const run = async () => {
            try { await handleRebillPrint?.(); }
            catch (e) { setInfoDialog({ isOpen: true, title: 'Re-Bill Failed', message: e?.message }); }
            finally { setPendingRebillPrint(false); }
        };
        run();
    }, [pendingRebillPrint, printBillData, handleRebillPrint]);

    // Filter by tab - "all" shows everything
    const filteredHistory = useMemo(
        () => history.filter(bill => activeTab === 'all' || bill.orderType === activeTab),
        [history, activeTab]
    );

    const selectableBillIds = useMemo(
        () => filteredHistory.filter(b => b?.settlementEligible && !b?.isSettled).map(b => b.id),
        [filteredHistory]
    );

    const selectedBillIdSet = useMemo(() => new Set(selectedBillIds), [selectedBillIds]);
    const settlingBillIdSet = useMemo(() => new Set(settlingBillIds), [settlingBillIds]);
    // Per-tab computed stats (derived from full history, not filtered)
    const tabStats = useMemo(() => {
        const compute = (bills) => {
            const total = bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
            const settled = bills.filter(b => b.isSettled).reduce((s, b) => s + Number(b.totalAmount || 0), 0);
            const pending = bills.filter(b => b.settlementEligible && !b.isSettled).reduce((s, b) => s + Number(b.totalAmount || 0), 0);
            return { count: bills.length, total, settled, pending };
        };
        return {
            all: compute(history),
            delivery: compute(history.filter(b => b.orderType === 'delivery')),
            pickup: compute(history.filter(b => b.orderType === 'pickup')),
            'dine-in': compute(history.filter(b => b.orderType === 'dine-in')),
        };
    }, [history]);

    const activeStat = tabStats[activeTab] || tabStats.all;

    const selectedSettleAmount = useMemo(() =>
        filteredHistory.reduce((sum, bill) => {
            if (!selectedBillIdSet.has(bill.id)) return sum;
            return sum + Number(bill.totalAmount || 0);
        }, 0),
        [filteredHistory, selectedBillIdSet]
    );

    const allSelectableSelected = selectableBillIds.length > 0 &&
        selectableBillIds.every(id => selectedBillIdSet.has(id));

    const toggleBillSelection = (billId) => {
        setSelectedBillIds(prev => prev.includes(billId) ? prev.filter(id => id !== billId) : [...prev, billId]);
    };

    const toggleSelectAll = () => {
        if (allSelectableSelected) { setSelectedBillIds([]); return; }
        setSelectedBillIds([...selectableBillIds]);
    };

    const settleBills = async (historyIds) => {
        const billIds = Array.isArray(historyIds) ? historyIds.filter(Boolean) : [];
        if (billIds.length === 0) throw new Error('No bills provided.');
        const user = auth.currentUser;
        if (!user) throw new Error('Please login first.');
        const idToken = await user.getIdToken();

        const apiUrl = new URL('/api/owner/custom-bill/history', window.location.origin);
        if (impersonatedOwnerId) apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
        else if (employeeOfOwnerId) apiUrl.searchParams.set('employee_of', employeeOfOwnerId);

        const res = await fetch(apiUrl.toString(), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ action: 'settle', historyIds: billIds }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || 'Settlement failed.');
        return data;
    };

    const handleSettleSelected = async () => {
        if (selectedBillIds.length === 0) return;
        try {
            setIsSettling(true);
            const data = await settleBills(selectedBillIds);
            setInfoDialog({ isOpen: true, title: 'Settlement Complete', message: data?.message || 'Orders settled successfully.' });
            setSelectedBillIds([]);
            await fetchHistory();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Settlement Failed', message: error.message });
        } finally {
            setIsSettling(false);
        }
    };

    const handleSettleSingle = async (bill) => {
        if (!bill?.id || !bill?.settlementEligible || bill?.isSettled) return;
        if (settlingBillIdSet.has(bill.id) || isSettling) return;
        try {
            setSettlingBillIds(prev => [...prev, bill.id]);
            await settleBills([bill.id]);
            setSelectedBillIds(prev => prev.filter(id => id !== bill.id));
            await fetchHistory();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Settlement Failed', message: error.message });
        } finally {
            setSettlingBillIds(prev => prev.filter(id => id !== bill.id));
        }
    };

    const triggerRebill = (bill) => {
        if (!bill) return;
        setPrintBillData(bill);
        setPendingRebillPrint(true);
    };

    return (
        <div className="text-foreground bg-background min-h-screen p-4 md:p-6">
            {/* Hidden print ref */}
            <div className="hidden">
                <div ref={rebillPrintRef} className="preview-bill">
                    {printBillData && (
                        <BillToPrint
                            order={{ orderDate: printBillData.printedAt || printBillData.createdAt }}
                            restaurant={restaurant}
                            billDetails={{
                                subtotal: printBillData.subtotal || 0,
                                cgst: printBillData.cgst || 0,
                                sgst: printBillData.sgst || 0,
                                deliveryCharge: printBillData.deliveryCharge || 0,
                                serviceFee: printBillData.additionalCharge || 0,
                                serviceFeeLabel: printBillData.additionalChargeLabel || 'Additional Charge',
                                grandTotal: printBillData.totalAmount || 0,
                                discount: 0
                            }}
                            items={Array.isArray(printBillData.items) ? printBillData.items : []}
                            customerDetails={{
                                name: printBillData.customerName || '',
                                phone: printBillData.customerPhone || '',
                                address: printBillData.customerAddress || '',
                            }}
                        />
                    )}
                </div>
            </div>

            <InfoDialog
                isOpen={infoDialog.isOpen}
                title={infoDialog.title}
                message={infoDialog.message}
                onClose={() => setInfoDialog(prev => ({ ...prev, isOpen: false }))}
            />

            {/* Bill Detail Modal */}
            {selectedBill && (
                <Dialog open={!!selectedBill} onOpenChange={() => setSelectedBill(null)}>
                    <DialogContent className="bg-card border-border text-foreground max-w-md">
                        <DialogHeader>
                            <DialogTitle>Order Details</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Order ID</span><span className="font-mono">{selectedBill.customerOrderId || selectedBill.historyId?.slice(0, 12)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{selectedBill.orderType || '-'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span>{selectedBill.customerName || 'Walk-in'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{selectedBill.customerPhone || '-'}</span></div>
                            {selectedBill.customerAddress && <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span className="text-right max-w-[60%]">{selectedBill.customerAddress}</span></div>}
                            <hr className="border-border" />
                            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(selectedBill.subtotal)}</span></div>
                            {selectedBill.cgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatCurrency(selectedBill.cgst)}</span></div>}
                            {selectedBill.sgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatCurrency(selectedBill.sgst)}</span></div>}
                            {selectedBill.deliveryCharge > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery Charge</span><span>{formatCurrency(selectedBill.deliveryCharge)}</span></div>}
                            {selectedBill.serviceFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{selectedBill.serviceFeeLabel || 'Additional Charge'}</span><span>{formatCurrency(selectedBill.serviceFee)}</span></div>}
                            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(selectedBill.totalAmount)}</span></div>
                            <hr className="border-border" />
                            {Array.isArray(selectedBill.items) && selectedBill.items.length > 0 && (
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {selectedBill.items.map((item, i) => (
                                        <div key={i} className="flex justify-between text-xs">
                                            <span>{item.name}{item.portionName ? ` (${item.portionName})` : ''} × {item.quantity}</span>
                                            <span>{formatCurrency(item.totalPrice)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={() => setSelectedBill(null)}>Close</Button>
                            <Button onClick={() => { triggerRebill(selectedBill); setSelectedBill(null); }} className="bg-primary hover:bg-primary/90">
                                <Printer className="h-4 w-4 mr-2" /> Re-Print
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Button variant="ghost" size="icon" onClick={() => router.push(backUrl)} className="h-9 w-9">
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Manual Order History</h1>
                    <p className="text-sm text-muted-foreground">Bills created from the Manual Order page</p>
                </div>
            </div>

            {/* Summary Cards — react to active tab */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Bills ({activeTab === 'all' ? 'All Types' : activeTab})</p>
                    <p className="text-2xl font-bold">{activeStat.count}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p className="text-2xl font-bold">{formatCurrency(activeStat.total)}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Settled</p>
                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(activeStat.settled)}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Pending Settlement</p>
                    <p className="text-2xl font-bold text-amber-600">{formatCurrency(activeStat.pending)}</p>
                </div>
            </div>

            {/* Cross-type breakdown bar (only visible on 'all' tab) */}
            {activeTab === 'all' && !loading && history.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-5">
                    {[
                        { key: 'delivery', label: '📦 Delivery', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400' },
                        { key: 'dine-in',  label: '🍽️ Dine-In',  color: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400' },
                        { key: 'pickup',   label: '🛍️ Pickup',   color: 'border-green-500/30 bg-green-500/5 text-green-400' },
                    ].map(({ key, label, color }) => (
                        <button key={key}
                            onClick={() => setActiveTab(key)}
                            className={`border rounded-xl p-3 text-left transition-all hover:opacity-80 ${color}`}>
                            <p className="text-xs font-semibold mb-1">{label}</p>
                            <p className="text-lg font-bold">{tabStats[key].count} orders</p>
                            <p className="text-xs opacity-80">{formatCurrency(tabStats[key].total)}</p>
                        </button>
                    ))}
                </div>
            )}

            {/* Date Range + Refresh */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4 flex flex-col md:flex-row md:items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-semibold">From</label>
                    <input type="date" value={fromDate} max={toDate} onChange={e => setFromDate(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none" />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-semibold">To</label>
                    <input type="date" value={toDate} min={fromDate} onChange={e => setToDate(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none" />
                </div>
                <Button onClick={fetchHistory} disabled={loading} className="bg-primary hover:bg-primary/90 md:self-end">
                    <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
                    {loading ? 'Loading...' : 'Refresh'}
                </Button>
            </div>

            {/* Settlement Bar */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">Selected for settlement: {selectedBillIds.length} bill(s)</p>
                    <p className="text-xs text-muted-foreground">Selected Amount: {formatCurrency(selectedSettleAmount)}</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={toggleSelectAll} disabled={loading || selectableBillIds.length === 0} className="text-sm">
                        {allSelectableSelected ? 'Deselect All' : 'Select All Pending'}
                    </Button>
                    <Button onClick={handleSettleSelected} disabled={isSettling || selectedBillIds.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
                        {isSettling ? 'Settling...' : 'Settle Selected'}
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap bg-muted/30 p-1 rounded-xl w-fit mb-4">
                {TABS.map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        className={cn(
                            'px-6 py-2.5 rounded-lg text-sm font-semibold capitalize transition-all',
                            activeTab === tab
                                ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        )}>
                        {tab === 'dine-in' ? 'Dine-in' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b border-border">
                            <tr>
                                <th className="p-4 text-left font-semibold text-muted-foreground">
                                    <input type="checkbox" checked={allSelectableSelected} onChange={toggleSelectAll}
                                        disabled={loading || selectableBillIds.length === 0} />
                                </th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Order ID</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Type</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Customer</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Items</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Amount</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Settlement</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Printed At</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, idx) => (
                                    <tr key={`sk-${idx}`} className="animate-pulse">
                                        {Array.from({ length: 9 }).map((_, j) => (
                                            <td key={j} className="p-4"><div className="h-5 bg-muted rounded w-20" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredHistory.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                                        No orders found in the selected range.
                                    </td>
                                </tr>
                            ) : (
                                filteredHistory.map(bill => {
                                    const isSelectable = !!bill?.settlementEligible && !bill?.isSettled;
                                    const isSelected = selectedBillIdSet.has(bill.id);
                                    const isRowSettling = settlingBillIdSet.has(bill.id);

                                    return (
                                        <tr key={bill.id} className="hover:bg-muted/40 cursor-pointer"
                                            onClick={() => setSelectedBill(bill)}>
                                            <td className="p-4">
                                                <input type="checkbox" checked={isSelected} disabled={!isSelectable}
                                                    onChange={() => toggleBillSelection(bill.id)}
                                                    onClick={e => e.stopPropagation()} />
                                            </td>
                                            <td className="p-4 font-mono text-xs md:text-sm">
                                                {bill.customerOrderId || String(bill.historyId || bill.id).slice(0, 12)}
                                            </td>
                                            <td className="p-4 uppercase text-xs font-semibold text-muted-foreground">
                                                {bill.orderType || '-'}
                                            </td>
                                            <td className="p-4">
                                                <div className="font-medium">{bill.customerName || 'Walk-in Customer'}</div>
                                                <div className="text-xs text-muted-foreground">{bill.customerPhone || '-'}</div>
                                            </td>
                                            <td className="p-4">{Number(bill.itemCount || 0)}</td>
                                            <td className="p-4 font-semibold">{formatCurrency(bill.totalAmount || 0)}</td>
                                            <td className="p-4">
                                                {!bill?.settlementEligible ? (
                                                    <span className="inline-flex items-center rounded-full border border-slate-500/40 px-2 py-1 text-xs text-slate-500">Not Required</span>
                                                ) : bill?.isSettled ? (
                                                    <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600">Settled</span>
                                                ) : (
                                                    <button type="button" onClick={e => { e.stopPropagation(); handleSettleSingle(bill); }}
                                                        disabled={isSettling || isRowSettling}
                                                        className={cn(
                                                            'inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 transition-colors',
                                                            isSettling || isRowSettling ? 'opacity-60 cursor-not-allowed' : 'hover:bg-amber-500/20'
                                                        )}>
                                                        {isRowSettling ? 'Settling...' : 'Pending'}
                                                    </button>
                                                )}
                                            </td>
                                            <td className="p-4 text-xs text-muted-foreground">
                                                {formatDateTime(bill.printedAt || bill.createdAt)}
                                            </td>
                                            <td className="p-4">
                                                <button type="button" onClick={e => { e.stopPropagation(); triggerRebill(bill); }}
                                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                                    <Printer className="h-3.5 w-3.5" /> Re-Bill
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
