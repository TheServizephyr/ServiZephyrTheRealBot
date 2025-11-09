'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2, QrCode, Download, Save, Wind, Edit, Table as TableIcon, History, Search, Salad, UtensilsCrossed, Droplet, PlusCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { auth, db } from '@/lib/firebase';
import { onSnapshot, collection, doc, writeBatch } from 'firebase/firestore';
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
import { Checkbox } from '@/components/ui/checkbox';


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
                        <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')} - {new Date().toLocaleTimeString('en-IN')}</p>
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
                                    <td className="text-right py-2">{formatCurrency(item.qty * (item.totalPrice / item.qty))}</td>
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


const TableCard = ({ tableId, tableData, onMarkAsPaid, onPrintBill, onMarkAsCleaned, onShowHistory, acknowledgedItems, onToggleAcknowledge, onConfirmOrders, isTab = false }) => {
    const state = tableData.state;
    
    const paxCount = isTab ? tableData.pax_count : tableData.tabs?.reduce((sum, tab) => sum + (tab.pax_count || 0), 0) || 0;

    const stateConfig = {
        available: {
            title: "Available",
            bg: "bg-card",
            border: "border-border",
            icon: <CheckCircle size={16} className="text-green-500" />,
            capacityText: `Capacity: ${tableData.max_capacity}`
        },
        occupied: {
            title: `Occupied (${paxCount})`,
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

    const tab = isTab ? tableData : null;
    const hasPendingOrders = tab?.orders.some(o => o.status === 'pending');

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
                    <CardTitle className="text-2xl font-bold">{tableId}</CardTitle>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        {currentConfig.icon} 
                        {currentConfig.title}
                        {currentConfig.capacityText && <span className="text-xs text-muted-foreground ml-2">({currentConfig.capacityText})</span>}
                    </div>
                </CardHeader>
                
                {state !== 'available' && (
                     <CardContent className="flex-grow p-4">
                        {state === 'needs_cleaning' ? (
                             <div className="flex-grow p-4 flex flex-col items-center justify-center text-center">
                                <p className="text-muted-foreground">This table's bill has been paid. Mark it as clean once it's ready for the next guests.</p>
                            </div>
                        ) : tab ? (
                            <div key={tab.id} className="mb-4 last:mb-0">
                                    <div className="flex justify-between items-center bg-muted/50 p-2 rounded-t-lg">
                                    <h4 className="font-semibold text-foreground">{tab.tab_name}</h4>
                                    <span className="text-xs font-mono text-muted-foreground">{tab.id.substring(0,6)}...</span>
                                </div>
                                <div className="text-xs text-muted-foreground my-2 flex items-center gap-2">
                                    <Clock size={14}/> Last activity: {tab.latestOrderTime ? format(tab.latestOrderTime, 'p') : 'N/A'}
                                </div>
                                {hasPendingOrders && (
                                    <Button size="sm" className="w-full mb-2 bg-yellow-500 hover:bg-yellow-600" onClick={() => onConfirmOrders(tab.orders.filter(o => o.status === 'pending').map(o => o.id))}>
                                        Confirm Tab's New Orders
                                    </Button>
                                )}
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                    {tab.allItems.map((item) => {
                                        const uniqueItemId = `${tab.id}-${item.name}`;
                                        const isAcknowledged = acknowledgedItems.has(uniqueItemId);
                                        const isPending = tab.orders.some(o => o.items.some(i => i.name === item.name) && o.status === 'pending');

                                        return (
                                            <div 
                                                key={uniqueItemId} 
                                                className={cn(
                                                    "flex justify-between items-center text-sm p-2 rounded-md transition-colors",
                                                    isAcknowledged ? "bg-muted/50" : (isPending ? "bg-yellow-400/20" : "bg-green-500/10")
                                                )}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Checkbox 
                                                        checked={isAcknowledged}
                                                        onCheckedChange={() => onToggleAcknowledge(uniqueItemId)}
                                                        id={uniqueItemId}
                                                    />
                                                    <label htmlFor={uniqueItemId} className="text-foreground">{item.name}</label>
                                                </div>
                                                <span className="font-semibold text-foreground">x{item.qty}</span>
                                            </div>
                                        );
                                    })}
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
                        ) : null}
                    </CardContent>
                )}
                
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

const LiveServiceRequests = ({ requests, onAcknowledge }) => {
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
                            <Button size="sm" onClick={() => onAcknowledge(req.id)}><CheckCircle className="mr-2 h-4 w-4"/>Acknowledge</Button>
                        </motion.div>
                    )
                })}
            </CardContent>
        </Card>
    )
}

function DineInPageContent() {
    const [tables, setTables] = useState([]);
    const [serviceRequests, setServiceRequests] = useState([]);
    const [closedTabs, setClosedTabs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [acknowledgedItems, setAcknowledgedItems] = useState(new Set());
    const [isManageTablesOpen, setManageTablesOpen] = useState(false);
    const [isHistoryOpen, setHistoryOpen] = useState(false);
    const [qrTable, setQrTable] = useState(null);
    const [editTable, setEditTable] = useState(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, tableId: null });
    const [historyData, setHistoryData] = useState(null);
    const [restaurantId, setRestaurantId] = useState(null);
    
    const [billData, setBillData] = useState(null);
    const billPrintRef = useRef();
    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
    });


    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const handleApiCall = async (method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        const endpoint = method === 'GET' ? `/api/owner/dine-in-tables` : '/api/owner/dine-in-tables';
        
        let url = new URL(endpoint, window.location.origin);
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
    };
    
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        const fetchBusinessId = async () => {
             const idToken = await user.getIdToken();
             const settingsRes = await fetch(`/api/owner/settings?impersonate_owner_id=${impersonatedOwnerId || ''}`, { headers: { 'Authorization': `Bearer ${idToken}` }});
             if (settingsRes.ok) {
                 const settingsData = await settingsRes.json();
                 setRestaurantId(settingsData.businessId);
             }
        }
        fetchBusinessId();

        const fetchData = async () => {
             try {
                const data = await handleApiCall('GET');
                const processedTables = (data.tables || []).map(table => {
                    const tabsWithDetails = (table.tabs || []).map(tab => {
                        const allItems = tab.orders.flatMap(o => o.items || []);
                        const itemMap = new Map();
                        allItems.forEach(item => {
                             const key = `${item.name}-${item.portion.name}`;
                             const existing = itemMap.get(key);
                             if (existing) {
                                 itemMap.set(key, { ...existing, qty: existing.qty + item.quantity });
                             } else {
                                 itemMap.set(key, { ...item, qty: item.quantity });
                             }
                        });
                        return {
                            ...tab,
                            totalBill: tab.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
                            latestOrderTime: Math.max(...tab.orders.map(o => o.orderDate?.seconds ? o.orderDate.seconds * 1000 : new Date(o.orderDate).getTime())),
                            allItems: Array.from(itemMap.values()),
                        };
                    });
                    return { ...table, tabs: tabsWithDetails };
                });

                setTables(processedTables);
                setServiceRequests(data.serviceRequests || []);
                setClosedTabs(data.closedTabs || []);
            } catch (error) {
                console.error("Error fetching dine-in data:", error);
                setInfoDialog({ isOpen: true, title: "Error", message: "Could not load dine-in data. " + error.message });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchData(); // Initial fetch
                const interval = setInterval(fetchData, 15000); // Polling
                return () => clearInterval(interval);
            } else {
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }, [impersonatedOwnerId]);


    const onToggleAcknowledge = (itemId) => {
        setAcknowledgedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    const handleConfirmOrders = async (orderIds) => {
        try {
            await handleApiCall('PATCH', { orderIds, newStatus: 'confirmed' }, '/api/owner/orders');
            setInfoDialog({ isOpen: true, title: "Success", message: `${orderIds.length} order(s) confirmed!` });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not confirm orders. " + error.message });
        }
    };
    
    const handleMarkAsPaid = async (tableId, tabIdToClose) => {
         try {
            await handleApiCall('PATCH', { tableId, tabIdToClose, action: 'mark_paid' });
            setInfoDialog({ isOpen: true, title: "Success", message: `Tab ${tabIdToClose.substring(0,6)} on Table ${tableId} marked as paid.` });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Failed to mark as paid. " + error.message });
        }
    };

     const handleMarkAsCleaned = async (tableId) => {
        try {
            await handleApiCall('PATCH', { tableId, action: 'mark_cleaned' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Failed to update table status. " + error.message });
        }
    };

     const handleSaveTable = async (tableId, maxCapacity) => {
        try {
            await handleApiCall('POST', { tableId, max_capacity: maxCapacity });
            setInfoDialog({ isOpen: true, title: "Success", message: `Table ${tableId} created.` });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Failed to create table: ${error.message}` });
        }
    };
    
    const handleEditTable = async (oldTableId, newTableId, newCapacity) => {
        try {
            await handleApiCall('PATCH', { tableId: oldTableId, newTableId, newCapacity });
            setInfoDialog({ isOpen: true, title: "Success", message: `Table ${oldTableId} updated.` });
            setEditTable(null);
        } catch(e) {
             setInfoDialog({ isOpen: true, title: "Error", message: `Failed to edit table: ${e.message}` });
        }
    };

    const handleDeleteTable = async (tableId) => {
         try {
            await handleApiCall('DELETE', { tableId });
            setInfoDialog({ isOpen: true, title: "Success", message: `Table ${tableId} deleted.` });
            setDeleteConfirmation({isOpen: false, tableId: null});
        } catch(e) {
             setInfoDialog({ isOpen: true, title: "Error", message: `Failed to delete table: ${e.message}` });
        }
    };

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            
            <QrGeneratorModal
                isOpen={!!editTable || (isManageTablesOpen && !editTable)}
                onClose={() => setEditTable(null)}
                onSaveTable={handleSaveTable}
                restaurantId={restaurantId}
                initialTable={editTable}
                onEditTable={handleEditTable}
                onDeleteTable={(id) => setDeleteConfirmation({ isOpen: true, tableId: id })}
                showInfoDialog={setInfoDialog}
            />
            {qrTable && <QrCodeDisplayModal isOpen={!!qrTable} onClose={() => setQrTable(null)} restaurantId={restaurantId} table={qrTable} />}
            {historyData && <HistoryModal tableHistory={historyData} onClose={() => setHistoryData(null)} />}
            {billData && <BillModal order={billData} restaurant={{ name: 'Your Restaurant' }} onClose={() => setBillData(null)} onPrint={handlePrint} printRef={billPrintRef} />}

            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ isOpen: false, tableId: null })}
                onConfirm={() => handleDeleteTable(deleteConfirmation.tableId)}
                title="Confirm Deletion"
                description={`Are you sure you want to delete Table ${deleteConfirmation.tableId}? This action cannot be undone.`}
                confirmText="Delete Table"
                isDestructive={true}
            />

             <ManageTablesModal
                isOpen={isManageTablesOpen}
                onClose={() => setManageTablesOpen(false)}
                allTables={tables}
                onEdit={(table) => {setEditTable(table); setManageTablesOpen(false);}}
                onDelete={(id) => setDeleteConfirmation({ isOpen: true, tableId: id })}
                loading={loading}
                onCreateNew={() => { setEditTable(null); setManageTablesOpen(false); }}
                onShowQr={setQrTable}
            />
            
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1">A real-time overview of your tables and customer tabs.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setManageTablesOpen(true)}><TableIcon size={16} className="mr-2"/> Manage Tables</Button>
                    <Button variant="outline" onClick={() => setHistoryOpen(true)}><History size={16} className="mr-2"/> View History</Button>
                    <Button onClick={() => window.location.reload()} variant="outline" size="icon"><RefreshCw size={16}/></Button>
                </div>
            </div>
            
            <LiveServiceRequests requests={serviceRequests} onAcknowledge={() => {}} />

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {loading ? (
                    [...Array(8)].map((_, i) => <Card key={i} className="h-96 animate-pulse"><CardHeader><div className="h-8 bg-muted rounded-md w-3/4"></div></CardHeader><CardContent><div className="h-48 bg-muted rounded-md"></div></CardContent></Card>)
                ) : tables.length > 0 ? (
                    tables.map(table => (
                        <div key={table.id} className="space-y-4">
                            <TableCard 
                                tableId={table.id}
                                tableData={table}
                                onMarkAsPaid={handleMarkAsPaid}
                                onPrintBill={setBillData}
                                onMarkAsCleaned={handleMarkAsCleaned}
                                onShowHistory={() => {}}
                                acknowledgedItems={acknowledgedItems}
                                onToggleAcknowledge={onToggleAcknowledge}
                                onConfirmOrders={handleConfirmOrders}
                            />
                            {table.tabs.map(tab => (
                                <TableCard
                                    key={tab.id}
                                    tableId={tab.tableId}
                                    tableData={tab}
                                    onMarkAsPaid={handleMarkAsPaid}
                                    onPrintBill={setBillData}
                                    onMarkAsCleaned={handleMarkAsCleaned}
                                    onShowHistory={() => {}}
                                    acknowledgedItems={acknowledgedItems}
                                    onToggleAcknowledge={onToggleAcknowledge}
                                    onConfirmOrders={handleConfirmOrders}
                                    isTab={true}
                                />
                            ))}
                        </div>
                    ))
                ) : (
                    <div className="col-span-full text-center py-16 text-muted-foreground">
                        <TableIcon size={48} className="mx-auto" />
                        <p className="mt-4 font-semibold">No tables have been set up yet.</p>
                        <Button onClick={() => setEditTable(null)} className="mt-4">
                            <PlusCircle size={16} className="mr-2"/> Create Your First Table
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function DineInPageWrapper() {
    return (
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><p>Loading...</p></div>}>
        <DineInPageContent />
      </Suspense>
    );
  }
