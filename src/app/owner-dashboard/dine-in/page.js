'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2, QrCode, Download, Save, Wind, Edit, Table as TableIcon, History, Search, Salad, UtensilsCrossed, Droplet, PlusCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isAfter, subDays } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import InfoDialog from '@/components/InfoDialog';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const ManageTablesModal = ({ isOpen, onClose, allTables, onEdit, onDelete, loading, onCreateNew, onShowQr }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-4xl">
                <DialogHeader className="flex flex-row justify-between items-center">
                    <div>
                        <DialogTitle>Manage All Tables</DialogTitle>
                        <DialogDescription>
                            View, edit, or delete all the tables you have created for your establishment.
                        </DialogDescription>
                    </div>
                    <Button onClick={onCreateNew}><PlusCircle size={16} className="mr-2"/> Create New Table</Button>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto mt-4 pr-4">
                    <table className="w-full">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><TableIcon size={16} className="inline mr-2"/>Table Name</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2"/>Max Capacity</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2"/>Currently Occupied</th>
                                <th className="p-4 text-right font-semibold text-muted-foreground">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <tr key={i} className="border-t border-border animate-pulse">
                                        <td className="p-4" colSpan={4}><div className="h-8 bg-muted rounded-md"></div></td>
                                    </tr>
                                ))
                            ) : allTables.length > 0 ? (
                                allTables.map(table => (
                                    <tr key={table.id} className="border-t border-border hover:bg-muted/50">
                                        <td className="p-4 font-semibold">{table.id}</td>
                                        <td className="p-4">{table.max_capacity}</td>
                                        <td className="p-4">{table.current_pax || 0}</td>
                                        <td className="p-4 flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onShowQr(table)}>
                                                <QrCode size={16}/>
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onEdit(table)}>
                                                <Edit size={16}/>
                                            </Button>
                                             <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => onDelete(table.id)}>
                                                <Trash2 size={16}/>
                                             </Button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="4" className="text-center p-8 text-muted-foreground">No tables created yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                 </div>
            </DialogContent>
        </Dialog>
    );
}

const DineInHistoryModal = ({ isOpen, onClose, closedTabs }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredTabs = useMemo(() => {
        if (!searchTerm) return closedTabs;
        return closedTabs.filter(tab => 
            tab.tableId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (tab.tab_name && tab.tab_name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [closedTabs, searchTerm]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Dine-In History (Last 30 Days)</DialogTitle>
                    <DialogDescription>A log of all closed tabs from the past 30 days.</DialogDescription>
                </DialogHeader>
                 <div className="relative my-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by table or tab name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-1 pr-4 space-y-3">
                    {filteredTabs.length > 0 ? (
                        filteredTabs.map(tab => (
                            <div key={tab.id} className="p-3 bg-muted rounded-lg flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-foreground">Table {tab.tableId} - {tab.tab_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Closed {tab.closedAt ? formatDistanceToNow(tab.closedAt, { addSuffix: true }) : 'Recently'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-lg text-primary">{formatCurrency(tab.totalBill)}</p>
                                    <p className="text-xs text-muted-foreground">via {tab.paymentMethod || 'Pay at Counter'}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-center py-10 text-muted-foreground">No history found for the last 30 days.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const HistoryModal = ({ tableHistory, onClose }) => {
    if (!tableHistory) return null;

    const { tableId, events } = tableHistory;

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Activity History for Table {tableId}</DialogTitle>
                    <DialogDescription>A log of all events that occurred at this table.</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4">
                    {events.length > 0 ? (
                        events.map((event, index) => (
                            <div key={index} className="flex items-start gap-4">
                                <div className="bg-muted p-2 rounded-full mt-1">
                                    {event.type === 'order' ? <ShoppingBag size={16} className="text-primary"/> : <Bell size={16} className="text-yellow-500"/>}
                                </div>
                                <div>
                                    <p className="font-semibold">{event.type === 'order' ? `Order Placed by ${event.customerName}` : 'Service Request'}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                                    </p>
                                    {event.type === 'order' && (
                                        <ul className="text-xs list-disc pl-4 mt-1 text-muted-foreground">
                                            {event.items.map((item, i) => <li key={i}>{item.qty}x {item.name}</li>)}
                                        </ul>
                                    )}
                                </div>
                                {event.type === 'order' && <p className="ml-auto font-semibold text-sm">{formatCurrency(event.totalAmount)}</p>}
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-muted-foreground py-8">No activity recorded for this table yet.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};


const BillModal = ({ order, restaurant, onClose, onPrint, printRef }) => {
    if (!order || !restaurant) return null;

    const allItems = useMemo(() => {
        const itemMap = new Map();
        (order.orders || []).forEach(o => {
            (o.items || []).forEach(item => {
                const existing = itemMap.get(item.name);
                if (existing) {
                    itemMap.set(item.name, { ...existing, qty: existing.qty + item.qty });
                } else {
                    itemMap.set(item.name, { ...item });
                }
            });
        });
        return Array.from(itemMap.values());
    }, [order.orders]);
    
    const totalBill = useMemo(() => (order.orders || []).reduce((sum, o) => sum + (o.totalAmount || 0), 0), [order.orders]);

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-md p-0">
                 <div ref={printRef} className="font-mono text-black bg-white p-6">
                    <div className="text-center mb-6 border-b-2 border-dashed border-black pb-4">
                        <h1 className="text-2xl font-bold uppercase">{restaurant.name}</h1>
                        <p className="text-xs">{restaurant.address?.street}, {restaurant.address?.city}</p>
                        {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
                    </div>
                     <div className="mb-4 text-xs">
                        <p><strong>Table:</strong> {order.tableId}</p>
                        <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')}</p>
                    </div>

                    <table className="w-full text-xs mb-4">
                        <thead className="border-y-2 border-dashed border-black">
                            <tr>
                                <th className="text-left font-bold py-2">ITEM</th>
                                <th className="text-center font-bold py-2">QTY</th>
                                <th className="text-right font-bold py-2">AMOUNT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allItems.map((item, index) => (
                                <tr key={index} className="border-b border-dotted border-black">
                                    <td className="py-2">{item.name}</td>
                                    <td className="text-center py-2">{item.qty}</td>
                                    <td className="text-right py-2">{formatCurrency(item.qty * item.price)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    
                    <div className="flex justify-between font-bold text-lg pt-2 mt-2 border-t-2 border-dashed border-black">
                        <span>GRAND TOTAL</span>
                        <span>{formatCurrency(totalBill)}</span>
                    </div>

                    <div className="text-center mt-6 pt-4 border-t border-dashed border-black">
                        <p className="text-xs italic">Thank you for dining with us!</p>
                        <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                    </div>
                </div>
                 <div className="p-4 bg-muted border-t border-border flex justify-end no-print">
                    <Button onClick={onPrint} className="bg-primary hover:bg-primary/90">
                        <Printer className="mr-2 h-4 w-4" /> Print Bill
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, description, confirmText, isDestructive = false }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={onConfirm} variant={isDestructive ? "destructive" : "default"}>
                        {confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const TableCard = ({ tableId, tableData, onMarkAsPaid, onPrintBill, onMarkAsCleaned, onShowHistory }) => {
    const tabs = tableData.tabs || [];
    const state = tableData.state;
    const stateConfig = {
        available: {
            title: "Available",
            bg: "bg-card",
            border: "border-border",
            icon: <CheckCircle size={16} className="text-green-500" />
        },
        occupied: {
            title: "Occupied",
            bg: "bg-yellow-500/10",
            border: "border-yellow-500",
            icon: <Users size={16} className="text-yellow-500" />
        },
        needs_cleaning: {
            title: "Needs Cleaning",
            bg: "bg-red-500/10",
            border: "border-red-500",
            icon: <Wind size={16} className="text-red-500" />
        }
    };
    
    const currentConfig = stateConfig[state] || { title: state, bg: "bg-muted", border: "border-border", icon: null };

    return (
         <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
            <Card className={cn("flex flex-col h-full shadow-lg hover:shadow-primary/20 transition-shadow duration-300 border-2", currentConfig.border)}>
                <CardHeader className={cn("flex-row items-center justify-between space-y-0 pb-2", currentConfig.bg)}>
                    <CardTitle className="text-2xl font-bold">Table {tableId}</CardTitle>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        {currentConfig.icon} {currentConfig.title}
                    </div>
                </CardHeader>
                <CardContent className="flex-grow p-4">
                    {state === 'needs_cleaning' ? (
                         <div className="flex-grow p-4 flex flex-col items-center justify-center text-center">
                            <p className="text-muted-foreground">This table's bill has been paid. Mark it as clean once it's ready for the next guests.</p>
                        </div>
                    ) : tabs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                            <p className="font-semibold">Table is Available</p>
                            <p className="text-xs">Capacity: {tableData.max_capacity} guests</p>
                        </div>
                    ) : (
                         tabs.map((tab) => (
                            <div key={tab.id} className="mb-4 last:mb-0">
                                 <div className="flex justify-between items-center bg-muted/50 p-2 rounded-t-lg">
                                    <h4 className="font-semibold text-foreground">{tab.tab_name}</h4>
                                    <span className="text-xs font-mono text-muted-foreground">{tab.id.substring(0,6)}...</span>
                                </div>
                                <div className="text-xs text-muted-foreground my-2 flex items-center gap-2">
                                    <Clock size={14}/> Last activity: {tab.latestOrderTime ? format(tab.latestOrderTime, 'p') : 'N/A'}
                                </div>
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                    {tab.allItems.map((item, index) => (
                                        <div key={index} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded-md">
                                            <span className="text-foreground">{item.name}</span>
                                            <span className="font-semibold text-foreground">x{item.qty}</span>
                                        </div>
                                    ))}
                                </div>
                                <CardFooter className="flex-col items-start bg-muted/30 p-4 border-t mt-4">
                                    <Button variant="outline" size="sm" className="w-full mb-4" onClick={() => onShowHistory(tableId, tab.id)}>
                                        <History size={14} className="mr-2"/> See History
                                    </Button>
                                    <div className="flex justify-between items-center w-full">
                                        <span className="text-lg font-bold">Total Bill:</span>
                                        <span className="text-2xl font-bold text-primary">{formatCurrency(tab.totalBill)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 w-full mt-4">
                                        <Button variant="outline" onClick={() => onPrintBill({ tableId, orders: tab.orders })}><Printer size={16} className="mr-2"/> Print Bill</Button>
                                        <Button className="bg-primary hover:bg-primary/90" onClick={() => onMarkAsPaid(tableId, tab.id)}><CheckCircle size={16} className="mr-2"/> Mark as Paid</Button>
                                    </div>
                                </CardFooter>
                            </div>
                        ))
                    )}
                </CardContent>
                {state === 'needs_cleaning' && (
                     <CardFooter className="p-4">
                        <Button className="w-full bg-green-500 hover:bg-green-600" onClick={() => onMarkAsCleaned(tableId)}>
                            <CheckCircle size={16} className="mr-2"/> Mark as Cleaned
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </motion.div>
    );
};

const QrCodeDisplay = ({ text, tableName, innerRef }) => {
    const handleDownload = () => {
        const canvas = innerRef.current.querySelector('canvas');
        if (canvas) {
            const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
            let downloadLink = document.createElement("a");
            downloadLink.href = pngUrl;
            downloadLink.download = `${tableName}-qrcode.png`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        }
    };

    const handlePrint = useReactToPrint({
        content: () => innerRef.current,
        documentTitle: `QR_Code_${tableName}`,
    });

    return (
        <div className="mt-6 flex flex-col items-center gap-4">
             <div ref={innerRef} className="bg-white p-4 rounded-lg border border-border flex flex-col items-center">
                <QRCode
                    value={text}
                    size={256}
                    level={"M"}
                    includeMargin={true}
                />
                <p className="text-center font-bold text-lg mt-2 text-black">Scan to Order: {tableName}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
                <Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print</Button>
                <Button onClick={handleDownload} variant="outline"><Download className="mr-2 h-4 w-4" /> Download PNG</Button>
            </div>
        </div>
    );
};

const QrCodeDisplayModal = ({ isOpen, onClose, restaurantId, table }) => {
    if (!table) return null;
    const qrValue = `${window.location.origin}/order/${restaurantId}?table=${table.id}`;
    const printRef = useRef();

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>QR Code for Table: {table.id}</DialogTitle>
                    <DialogDescription>
                        Customers can scan this code with their phone camera to open the menu and order directly from this table.
                    </DialogDescription>
                </DialogHeader>
                <QrCodeDisplay text={qrValue} tableName={table.id} innerRef={printRef} />
            </DialogContent>
        </Dialog>
    );
};

const QrGeneratorModal = ({ isOpen, onClose, onSaveTable, restaurantId, initialTable, onEditTable, onDeleteTable, showInfoDialog }) => {
    const [tableName, setTableName] = useState('');
    const [maxCapacity, setMaxCapacity] = useState(4);
    const [qrValue, setQrValue] = useState('');
    const printRef = useRef();

    useEffect(() => {
        if (isOpen) {
            if (initialTable) {
                setTableName(initialTable.id);
                setMaxCapacity(initialTable.max_capacity || 4);
                if (restaurantId && initialTable.id) {
                    const url = `${window.location.origin}/order/${restaurantId}?table=${initialTable.id}`;
                    setQrValue(url);
                } else {
                    setQrValue('');
                }
            } else {
                setTableName('');
                setMaxCapacity(4);
                setQrValue('');
            }
        }
    }, [isOpen, initialTable, restaurantId]);

    const handleGenerate = () => {
        if (!tableName.trim()) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a table name or number."});
            return;
        }
        if (!restaurantId) {
            showInfoDialog({ isOpen: true, title: 'Error', message: "Restaurant ID is missing. Cannot generate QR code."});
            return;
        }
        const url = `${window.location.origin}/order/${restaurantId}?table=${tableName.trim()}`;
        setQrValue(url);
    };

    const handleSave = async () => {
        if (!tableName.trim() || !maxCapacity || maxCapacity < 1) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: 'Please enter a valid table name and capacity.'});
            return;
        }
        try {
            if (initialTable) {
                await onEditTable(initialTable.id, tableName.trim(), maxCapacity);
            } else {
                await onSaveTable(tableName.trim(), maxCapacity);
            }
            handleGenerate();
        } catch (error) {
            // error is handled by parent
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{initialTable ? `Manage Table: ${initialTable.id}` : 'Create a New Table'}</DialogTitle>
                    <DialogDescription>
                        {initialTable ? 'Edit table details. The QR code will update automatically.' : 'Create a new table. A unique QR code will be generated upon saving.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                            <Label htmlFor="table-name">Table Name / Number</Label>
                            <Input
                                id="table-name"
                                value={tableName}
                                onChange={(e) => setTableName(e.target.value)}
                                placeholder="e.g., T1, Rooftop 2"
                            />
                        </div>
                        <div>
                            <Label htmlFor="max-capacity">Max Capacity</Label>
                            <Input
                                id="max-capacity"
                                type="number"
                                value={maxCapacity}
                                onChange={(e) => setMaxCapacity(parseInt(e.target.value, 10))}
                                placeholder="e.g., 4"
                                min="1"
                            />
                        </div>
                    </div>
                    <Button onClick={handleSave} className="w-full bg-primary hover:bg-primary/90">
                        <Save className="mr-2 h-4 w-4" /> {initialTable ? 'Save Changes' : 'Save Table & Generate QR'}
                    </Button>

                    {qrValue && <QrCodeDisplay text={qrValue} tableName={tableName} innerRef={printRef} />}

                     {initialTable && (
                        <div className="pt-4 border-t border-dashed">
                             <Button onClick={() => { onDeleteTable(initialTable.id); onClose(); }} variant="destructive" className="w-full">
                                <Trash2 className="mr-2 h-4 w-4"/> Delete This Table
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const LiveServiceRequests = ({ impersonatedOwnerId }) => {
    const [requests, setRequests] = useState([]);

    const fetchRequests = async () => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            let url = '/api/owner/service-requests';
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            }
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (res.ok) {
                const data = await res.json();
                setRequests(data.requests || []);
            }
        } catch (error) {
            console.error("Failed to fetch service requests:", error);
        }
    };
    
    const handleAcknowledge = async (requestId) => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            await fetch('/api/owner/service-requests', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ requestId, status: 'acknowledged' })
            });
            fetchRequests(); // Refresh list
        } catch (error) {
            console.error("Failed to acknowledge request:", error);
        }
    };

    useEffect(() => {
        fetchRequests();
        const interval = setInterval(fetchRequests, 15000); // Poll every 15 seconds
        return () => clearInterval(interval);
    }, [impersonatedOwnerId]);

    if(requests.length === 0) return null;

    return (
        <Card className="mb-6 border-primary/50 bg-primary/10">
            <CardHeader>
                <CardTitle className="flex items-center gap-3 text-primary">
                    <Bell className="animate-wiggle"/> Live Service Requests ({requests.length})
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {requests.map(req => {
                    const date = req.createdAt ? new Date(req.createdAt) : null;
                    const isValidDate = date && !isNaN(date.getTime());
                    return (
                        <motion.div 
                            key={req.id}
                            layout
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 50 }}
                            className="flex items-center justify-between p-3 bg-card rounded-lg"
                        >
                            <div>
                                <p className="font-bold">Service needed at Table: {req.tableId}</p>
                                <p className="text-xs text-muted-foreground">{isValidDate ? formatDistanceToNow(date, { addSuffix: true }) : 'Just now'}</p>
                            </div>
                            <Button size="sm" onClick={() => handleAcknowledge(req.id)}><CheckCircle className="mr-2 h-4 w-4"/>Acknowledge</Button>
                        </motion.div>
                    )
                })}
            </CardContent>
        </Card>
    )
}

const DineInAddItemModal = ({ isOpen, onClose, onSave, itemCategory, showInfoDialog }) => {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');

    useEffect(() => {
        if (isOpen) {
            setName('');
            setPrice('');
        }
    }, [isOpen]);

    const handleSave = () => {
        if (!name.trim() || !price || isNaN(parseFloat(price))) {
            showInfoDialog({ isOpen: true, title: "Invalid Input", message: "Please enter a valid item name and price." });
            return;
        }
        onSave({ name: name.trim(), price: parseFloat(price) });
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Add New {itemCategory}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div>
                        <Label htmlFor="item-name">Item Name</Label>
                        <Input id="item-name" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div>
                        <Label htmlFor="item-price">Price (₹)</Label>
                        <Input id="item-price" type="number" value={price} onChange={e => setPrice(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave}>Save Item</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const DineInMenuModal = ({ isOpen, onClose, showInfoDialog }) => {
    const [menuItems, setMenuItems] = useState([]);
    const [cutleryItems, setCutleryItems] = useState([]);
    const [amenityItems, setAmenityItems] = useState([]);
    const [isAddItemModalOpen, setAddItemModalOpen] = useState(false);
    const [addItemCategory, setAddItemCategory] = useState('');


    const handleAddItem = (category) => {
        setAddItemCategory(category);
        setAddItemModalOpen(true);
    };

    const handleSaveNewItem = (item) => {
        if (addItemCategory === 'Cutlery') {
            setCutleryItems(prev => [...prev, item]);
        } else if (addItemCategory === 'Amenity') {
            setAmenityItems(prev => [...prev, item]);
        }
    };

    return (
        <>
            <DineInAddItemModal
                isOpen={isAddItemModalOpen}
                onClose={() => setAddItemModalOpen(false)}
                onSave={handleSaveNewItem}
                itemCategory={addItemCategory}
                showInfoDialog={showInfoDialog}
            />
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="max-w-4xl bg-background border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle>Dine-In Menu Editor</DialogTitle>
                        <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Feature in Development</AlertTitle>
                            <AlertDescription>
                               This is a preview. Soon, you will be able to copy items from your main menu. Saving items is currently local to this session.
                            </AlertDescription>
                        </Alert>
                    </DialogHeader>
                    <div className="mt-4 max-h-[70vh] overflow-y-auto pr-4 space-y-6">
                        <div className="p-4 border border-dashed border-border rounded-lg">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold flex items-center gap-2"><Salad size={20}/> Dine-In Menu Items</h3>
                                <Button variant="outline" disabled>Copy Items from Main Menu</Button>
                            </div>
                            <div className="space-y-2">
                                {menuItems.length > 0 ? menuItems.map(item => (
                                    <div key={item.id} className="flex justify-between items-center p-3 bg-muted rounded-md">
                                        <p>{item.name}</p>
                                        <p className="font-semibold">{formatCurrency(item.price)}</p>
                                    </div>
                                )) : <p className="text-sm text-center text-muted-foreground py-4">No menu items added. Use 'Copy from Main Menu'.</p>}
                            </div>
                        </div>
                        <div className="p-4 border border-dashed border-border rounded-lg">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold flex items-center gap-2"><UtensilsCrossed size={20}/> Cutlery & Crockery</h3>
                                 <Button variant="outline" size="sm" onClick={() => handleAddItem('Cutlery')}><PlusCircle size={16} className="mr-2"/> Add Item</Button>
                            </div>
                            <div className="space-y-2">
                                 {cutleryItems.length > 0 ? cutleryItems.map((item, index) => (
                                    <div key={index} className="flex justify-between items-center p-3 bg-muted rounded-md">
                                        <p>{item.name}</p>
                                        <p className="font-semibold">{item.price > 0 ? formatCurrency(item.price) : 'Free'}</p>
                                    </div>
                                )) : <p className="text-sm text-center text-muted-foreground py-4">No cutlery items added yet.</p>}
                            </div>
                        </div>
                        <div className="p-4 border border-dashed border-border rounded-lg">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold flex items-center gap-2"><Droplet size={20}/> Basic Amenities</h3>
                                 <Button variant="outline" size="sm" onClick={() => handleAddItem('Amenity')}><PlusCircle size={16} className="mr-2"/> Add Item</Button>
                            </div>
                             <div className="space-y-2">
                                 {amenityItems.length > 0 ? amenityItems.map((item, index) => (
                                    <div key={index} className="flex justify-between items-center p-3 bg-muted rounded-md">
                                        <p>{item.name}</p>
                                        <p className="font-semibold">{formatCurrency(item.price)}</p>
                                    </div>
                                )) : <p className="text-sm text-center text-muted-foreground py-4">No amenities added yet.</p>}
                            </div>
                        </div>
                    </div>
                     <DialogFooter>
                        <Button onClick={onClose}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}


function DineInPage() {
    const [allOrders, setAllOrders] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [allServiceRequests, setAllServiceRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [isManageTablesModalOpen, setIsManageTablesModalOpen] = useState(false);
    const [isQrDisplayModalOpen, setIsQrDisplayModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isDineInMenuModalOpen, setIsDineInMenuModalOpen] = useState(false);
    const [editingTable, setEditingTable] = useState(null);
    const [displayTable, setDisplayTable] = useState(null);
    const [restaurant, setRestaurant] = useState(null);
    const [restaurantId, setRestaurantId] = useState('');
    const [billData, setBillData] = useState(null);
    const [historyModalData, setHistoryModalData] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [confirmationState, setConfirmationState] = useState({ isOpen: false, onConfirm: () => {}, title: '', description: '', confirmText: '' });

    const billPrintRef = useRef();

    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
    });
    
    const handleApiCall = async (method, body, endpoint) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL(endpoint, window.location.origin);
        const finalImpersonatedId = impersonatedOwnerId || searchParams.get('impersonate_owner_id');
        if (finalImpersonatedId) {
            url.searchParams.append('impersonate_owner_id', finalImpersonatedId);
        }
        
        const fetchOptions = {
            method,
            headers: { 'Authorization': `Bearer ${idToken}`},
        };
        
        if (method !== 'GET') {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(body);
        } else if (body) {
            Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
        }

        const res = await fetch(url.toString(), fetchOptions);
        
        if (res.status === 204) {
            return null;
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    };

    const fetchData = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            
            const settingsUrl = `/api/owner/settings?impersonate_owner_id=${impersonatedOwnerId || ''}`;
            const [ordersData, tablesData, settingsData, requestsData] = await Promise.all([
                 handleApiCall('GET', null, '/api/owner/orders'),
                 handleApiCall('GET', null, '/api/owner/dine-in-tables'),
                 fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }).then(res => res.json()),
                 handleApiCall('GET', null, '/api/owner/service-requests')
            ]);
            
            setAllOrders(ordersData.orders || []);
            setAllTables(tablesData.tables || []);
            setAllServiceRequests(requestsData.requests || []);
            
            const fetchedRestaurant = {
                name: settingsData.restaurantName,
                address: settingsData.address,
                gstin: settingsData.gstin
             };
            setRestaurant(fetchedRestaurant);
            
            const fetchedRestaurantId = settingsData.businessId;
            setRestaurantId(fetchedRestaurantId);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load dine-in data: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };
    
    const handleSaveTable = async (tableName, maxCapacity) => {
        try {
            await handleApiCall('POST', { tableId: tableName, max_capacity: maxCapacity }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: `Table "${tableName}" saved with a capacity of ${maxCapacity}.` });
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save table: ${error.message}` });
            throw error;
        }
    };
    
    const handleEditTable = async (originalId, newId, newCapacity) => {
        try {
            await handleApiCall('PATCH', { tableId: originalId, newTableId: newId, newCapacity }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: `Table updated successfully.` });
            await fetchData(true);
        } catch(error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not edit table: ${error.message}` });
            throw error;
        }
    };

    const handleDeleteTable = async (tableId) => {
        if (window.confirm(`Are you sure you want to delete table "${tableId}"? This cannot be undone.`)) {
            try {
                await handleApiCall('DELETE', { tableId }, '/api/owner/dine-in-tables');
                setInfoDialog({ isOpen: true, title: "Success", message: `Table "${tableId}" has been deleted.` });
                await fetchData(true);
            } catch (error) {
                setInfoDialog({ isOpen: true, title: "Error", message: `Could not delete table: ${error.message}` });
            }
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
          if (user) fetchData();
          else setLoading(false);
        });
    
        const interval = setInterval(() => fetchData(true), 30000);
        return () => {
            unsubscribe();
            clearInterval(interval);
        };
      }, [impersonatedOwnerId]);

      const confirmMarkAsPaid = (tableId, tabId) => {
        setConfirmationState({
            isOpen: true,
            title: "Confirm Payment",
            description: `Are you sure you want to mark all orders for this tab on Table ${tableId} as paid? This will close the tab and mark the table as needing cleaning.`,
            confirmText: "Yes, Mark as Paid",
            onConfirm: () => {
                handleMarkAsPaid(tableId, tabId);
                setConfirmationState({ isOpen: false });
            },
        });
    };

    const handleMarkAsPaid = async (tableId, tabId) => {
        setLoading(true);
        try {
            await handleApiCall('PATCH', { tableId, action: 'mark_paid', tabIdToClose: tabId }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: "Table has been marked for cleaning." });
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not clear table: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };
    
    const handleMarkAsCleaned = async (tableId) => {
         setLoading(true);
         try {
             await handleApiCall('PATCH', { tableId, action: 'mark_cleaned' }, '/api/owner/dine-in-tables');
             setInfoDialog({ isOpen: true, title: "Success", message: `Table ${tableId} is now available.` });
             await fetchData(true);
         } catch(error) {
             setInfoDialog({ isOpen: true, title: "Error", message: `Could not update table status: ${error.message}` });
         } finally {
             setLoading(false);
         }
    };

    const { activeTableData, closedTabsData } = useMemo(() => {
        const dineInStatuses = ['pending', 'confirmed', 'preparing', 'active_tab', 'ready_for_pickup'];
        const thirtyDaysAgo = subDays(new Date(), 30);
    
        const uniqueTabIds = [...new Set(allOrders.filter(o => o.deliveryType === 'dine-in' && o.dineInTabId).map(o => o.dineInTabId))];
    
        const tabsData = uniqueTabIds.map(tabId => {
            const tabOrders = allOrders.filter(o => o.dineInTabId === tabId);
            if (tabOrders.length === 0) return null;
    
            const mainOrder = tabOrders.find(o => o.tab_name) || tabOrders[0];
            const latestOrder = tabOrders.reduce((latest, current) => {
                const latestDate = new Date(latest.orderDate?.seconds ? latest.orderDate.seconds * 1000 : latest.orderDate);
                const currentDate = new Date(current.orderDate?.seconds ? current.orderDate.seconds * 1000 : current.orderDate);
                return currentDate > latestDate ? current : latest;
            });
    
            const isActive = dineInStatuses.includes(latestOrder.status);
            const totalBill = tabOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            
            const allItemsMap = new Map();
            tabOrders.forEach(order => {
                (order.items || []).forEach(item => {
                    const existing = allItemsMap.get(item.name);
                    if (existing) {
                        allItemsMap.set(item.name, { ...existing, qty: existing.qty + item.qty });
                    } else {
                        allItemsMap.set(item.name, { ...item });
                    }
                });
            });
    
            return {
                id: tabId,
                tableId: mainOrder.tableId,
                tab_name: mainOrder.tab_name || "Guest",
                orders: tabOrders,
                isActive,
                totalBill,
                allItems: Array.from(allItemsMap.values()),
                latestOrderTime: new Date(latestOrder.orderDate?.seconds ? latestOrder.orderDate.seconds * 1000 : latestOrder.orderDate),
                closedAt: !isActive ? new Date(latestOrder.orderDate?.seconds ? latestOrder.orderDate.seconds * 1000 : latestOrder.orderDate) : null,
                paymentMethod: latestOrder.paymentDetails?.method || 'Pay at Counter',
            };
        }).filter(Boolean);
    
        const closedTabs = tabsData.filter(tab => !tab.isActive && tab.closedAt && isAfter(tab.closedAt, thirtyDaysAgo));
        closedTabs.sort((a,b) => b.closedAt - a.closedAt);
    
        const tableMap = allTables.reduce((acc, table) => {
            acc[table.id] = { ...table, tabs: [], state: table.state || 'available' };
            return acc;
        }, {});
    
        tabsData.forEach(tab => {
            if (tab.isActive && tableMap[tab.tableId]) {
                tableMap[tab.tableId].tabs.push(tab);
                tableMap[tab.tableId].state = 'occupied';
            }
        });
    
        return { activeTableData: tableMap, closedTabsData: closedTabs };
    }, [allOrders, allTables]);
    
    const handleShowHistory = (tableId, tabId) => {
        const tableData = activeTableData[tableId];
        if (!tableData) return;

        const tab = tableData.tabs.find(t => t.id === tabId);
        if (!tab) return;
    
        const orderEvents = (tab.orders || []).map(o => ({
            type: 'order',
            timestamp: o.orderDate.seconds ? o.orderDate.seconds * 1000 : new Date(o.orderDate).getTime(),
            customerName: o.customerName,
            items: o.items,
            totalAmount: o.totalAmount
        }));
    
        const requestEvents = (allServiceRequests || []).filter(r => r.dineInTabId === tabId).map(r => ({
            type: 'request',
            timestamp: r.createdAt.seconds ? r.createdAt.seconds * 1000 : new Date(r.createdAt).getTime(),
        }));
        
        const allEvents = [...orderEvents, ...requestEvents].sort((a, b) => b.timestamp - a.timestamp);
        
        setHistoryModalData({ tableId, events: allEvents });
    };

    const handleOpenEditModal = (table = null) => {
        if (!restaurantId) {
            setInfoDialog({isOpen: true, title: "Error", message: "Restaurant data is not loaded yet. Cannot manage tables."});
            return;
        }
        setEditingTable(table);
        setIsQrModalOpen(true);
    };

     const handleOpenQrDisplayModal = (table) => {
        if (!restaurantId) {
            setInfoDialog({isOpen: true, title: "Error", message: "Restaurant data is not loaded yet. Cannot show QR code."});
            return;
        }
        setDisplayTable(table);
        setIsManageTablesModalOpen(false); // Close manage modal if open
        setIsQrDisplayModalOpen(true);
    };

    const renderTableCards = () => {
        const sortedTableKeys = Object.keys(activeTableData).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        return sortedTableKeys.flatMap(tableId => {
            const tableData = activeTableData[tableId];
            const { tabs } = tableData;

            if (tabs.length === 0 || tableData.state === 'available' || tableData.state === 'needs_cleaning') {
                return (
                    <TableCard
                        key={tableId}
                        tableId={tableId}
                        tableData={tableData}
                        onMarkAsCleaned={handleMarkAsCleaned}
                    />
                );
            }

            return tabs.map(tab => (
                 <TableCard
                    key={`${tableId}-${tab.id}`}
                    tableId={tableId}
                    tableData={{ ...tableData, tabs: [tab] }} // Pass only one tab to the card
                    onMarkAsPaid={confirmMarkAsPaid}
                    onPrintBill={setBillData}
                    onShowHistory={handleShowHistory}
                />
            ));
        });
    };


    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <DineInHistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} closedTabs={closedTabsData} />
            <ManageTablesModal isOpen={isManageTablesModalOpen} onClose={() => setIsManageTablesModalOpen(false)} allTables={allTables} onEdit={handleOpenEditModal} onDelete={handleDeleteTable} loading={loading} onCreateNew={() => handleOpenEditModal(null)} onShowQr={handleOpenQrDisplayModal} />
            <DineInMenuModal isOpen={isDineInMenuModalOpen} onClose={() => setIsDineInMenuModalOpen(false)} showInfoDialog={setInfoDialog} />
            {historyModalData && <HistoryModal tableHistory={historyModalData} onClose={() => setHistoryModalData(null)} />}
            {billData && (
                <BillModal 
                    order={billData}
                    restaurant={restaurant}
                    onClose={() => setBillData(null)}
                    onPrint={handlePrint}
                    printRef={billPrintRef}
                />
            )}
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            {restaurantId && <QrGeneratorModal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} restaurantId={restaurantId} onSaveTable={handleSaveTable} onEditTable={handleEditTable} onDeleteTable={handleDeleteTable} initialTable={editingTable} showInfoDialog={setInfoDialog} />}
            {restaurantId && <QrCodeDisplayModal isOpen={isQrDisplayModalOpen} onClose={() => setIsQrDisplayModalOpen(false)} restaurantId={restaurantId} table={displayTable} />}
            <ConfirmationModal 
                isOpen={confirmationState.isOpen}
                onClose={() => setConfirmationState({ isOpen: false })}
                onConfirm={confirmationState.onConfirm}
                title={confirmationState.title}
                description={confirmationState.description}
                confirmText={confirmationState.confirmText}
            />


            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables and table management.</p>
                </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <Button onClick={() => setIsHistoryModalOpen(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading}>
                    <History size={20}/> Dine-In History
                </Button>
                 <Button onClick={() => setIsDineInMenuModalOpen(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading}>
                    <Salad size={20}/> Dine-In Menu
                </Button>
                 <Button onClick={() => setIsManageTablesModalOpen(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading}>
                    <TableIcon size={20}/> Manage Tables
                </Button>
                <Button onClick={() => fetchData(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading}>
                    <RefreshCw size={20} className={cn(loading && "animate-spin")} /> Refresh View
                </Button>
            </div>


            <LiveServiceRequests impersonatedOwnerId={impersonatedOwnerId} />
            
             <h2 className="text-xl font-bold mb-4">Live Tables</h2>
            {loading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl h-96"></div>
                    ))}
                </div>
            ) : Object.keys(activeTableData).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {renderTableCards()}
                </div>
            ) : (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold">No Active Tables</p>
                    <p>When a customer scans a QR code and orders, their table will appear here live.</p>
                </div>
            )}
        </div>
    );
}

export default DineInPage;
