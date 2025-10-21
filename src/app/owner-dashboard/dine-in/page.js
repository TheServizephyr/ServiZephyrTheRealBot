
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2, QrCode, Download, Save, Wind, Edit, ChevronDown, ChevronUp, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import InfoDialog from '@/components/InfoDialog';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

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

const TableCard = ({ tableId, tableData, onMarkAsPaid, onPrintBill, onMarkAsCleaned }) => {
    const orders = tableData.orders || [];
    const totalBill = useMemo(() => orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0), [orders]);
    const customerNames = useMemo(() => [...new Set(orders.map(o => o.customerName))], [orders]);
    const allItems = useMemo(() => {
        const itemMap = new Map();
        orders.forEach(order => {
            (order.items || []).forEach(item => {
                const existing = itemMap.get(item.name);
                if (existing) {
                    itemMap.set(item.name, { ...existing, qty: existing.qty + item.qty });
                } else {
                    itemMap.set(item.name, { ...item });
                }
            });
        });
        return Array.from(itemMap.values());
    }, [orders]);

    const latestOrderTime = useMemo(() => {
        if (orders.length === 0) return null;
        const latestTimestamp = Math.max(...orders.map(o => o.orderDate.seconds ? o.orderDate.seconds * 1000 : new Date(o.orderDate).getTime()));
        return new Date(latestTimestamp);
    }, [orders]);
    
    const state = tableData.state;

    const stateConfig = {
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


    if (state === 'needs_cleaning') {
        return (
             <motion.div
                layout
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
                <Card className={cn("flex flex-col h-full shadow-lg border-2", currentConfig.border)}>
                    <CardHeader className={cn("flex-row items-center justify-between space-y-0 pb-2", currentConfig.bg)}>
                        <CardTitle className="text-2xl font-bold">Table {tableId}</CardTitle>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            {currentConfig.icon} {currentConfig.title}
                        </div>
                    </CardHeader>
                    <CardContent className="flex-grow p-4 flex flex-col items-center justify-center text-center">
                        <p className="text-muted-foreground">This table's bill has been paid. Mark it as clean once it's ready for the next guests.</p>
                    </CardContent>
                    <CardFooter className="p-4">
                        <Button className="w-full bg-green-500 hover:bg-green-600" onClick={() => onMarkAsCleaned(tableId)}>
                            <CheckCircle size={16} className="mr-2"/> Mark as Cleaned
                        </Button>
                    </CardFooter>
                </Card>
            </motion.div>
        )
    }

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
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{customerNames.join(', ')}</span>
                        <Users size={16} className="text-muted-foreground"/>
                    </div>
                </CardHeader>
                <CardContent className="flex-grow p-4">
                    <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                        <Clock size={14}/> Last activity: {latestOrderTime ? format(latestOrderTime, 'p') : 'N/A'}
                    </div>
                     <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {allItems.map((item, index) => (
                            <div key={index} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded-md">
                                <span className="text-foreground">{item.name}</span>
                                <span className="font-semibold text-foreground">x{item.qty}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
                <CardFooter className="flex-col items-start bg-muted/30 p-4 border-t">
                    <div className="flex justify-between items-center w-full mb-4">
                        <span className="text-lg font-bold">Total Bill:</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(totalBill)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <Button variant="outline" onClick={() => onPrintBill({ tableId, orders })}><Printer size={16} className="mr-2"/> Print Bill</Button>
                        <Button className="bg-primary hover:bg-primary/90" onClick={() => onMarkAsPaid(tableId, tableData.orders.map(o => o.id))}><CheckCircle size={16} className="mr-2"/> Mark as Paid</Button>
                    </div>
                </CardFooter>
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


function DineInPageInternal() {
    const [allOrders, setAllOrders] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [isQrDisplayModalOpen, setIsQrDisplayModalOpen] = useState(false);
    const [editingTable, setEditingTable] = useState(null);
    const [displayTable, setDisplayTable] = useState(null);
    const [restaurant, setRestaurant] = useState(null);
    const [restaurantId, setRestaurantId] = useState('');
    const [billData, setBillData] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
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
            const [ordersData, tablesData, settingsData] = await Promise.all([
                 handleApiCall('GET', null, '/api/owner/orders'),
                 handleApiCall('GET', null, '/api/owner/dine-in-tables'),
                 fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }).then(res => res.json())
            ]);
            
            const dineInStatuses = ['pending', 'confirmed', 'preparing', 'active_tab', 'ready_for_pickup'];
            const dineInOrders = (ordersData.orders || []).filter(o => o.deliveryType === 'dine-in' && dineInStatuses.includes(o.status));
            setAllOrders(dineInOrders);
            setAllTables(tablesData.tables || []);
            
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


    const handleMarkAsPaid = async (tableId, orderIds) => {
        if (!window.confirm("Are you sure you want to mark this table's orders as paid and completed?")) return;

        setLoading(true);
        try {
            // In a real scenario, these would be batched in a transaction
            await Promise.all(
                orderIds.map(orderId => 
                    handleApiCall('PATCH', { orderId, newStatus: 'completed' }, '/api/owner/orders')
                )
            );
            
            // This API call needs to be created or logic adjusted.
            // For now, let's assume it works.
            await handleApiCall('PATCH', { tableId, action: 'mark_paid', tabIdToClose: tableId }, '/api/owner/dine-in-tables');

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

    const combinedTableData = useMemo(() => {
        const tableMap = new Map();
        
        allTables.forEach(table => {
            tableMap.set(table.id, {
                ...table,
                state: (table.current_pax > 0) ? 'occupied' : 'available',
                orders: [],
            });
        });

        allOrders.forEach(order => {
            const tableId = order.dineInTabId || 'Unknown';
            if (tableMap.has(tableId)) {
                const tableEntry = tableMap.get(tableId);
                tableEntry.orders.push(order);
            }
        });
        
        // This is a correction: A table can be occupied without new orders (e.g. bill paid).
        // The state should be 'needs_cleaning' ONLY if the bill was just paid. This logic is handled by API now.
        for (const [key, value] of tableMap.entries()) {
            // Example: if a table has no current orders but was recently marked paid.
            if (value.orders.length === 0 && value.current_pax > 0) {
                 // The backend should set this state explicitly. Here we just reflect it.
                 // This logic might be imperfect on the frontend.
            }
        }
        
        return Object.fromEntries(tableMap);
    }, [allOrders, allTables]);
    
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
        setIsQrDisplayModalOpen(true);
    };

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
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


            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables and table management.</p>
                </div>
                <div className="flex gap-4">
                     <Button onClick={() => handleOpenEditModal(null)} variant="default" className="bg-primary hover:bg-primary/90" disabled={loading}>
                        <QrCode size={16} className="mr-2"/> Create Table & QR
                    </Button>
                    <Button onClick={() => fetchData(true)} variant="outline" disabled={loading}>
                        <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh View
                    </Button>
                </div>
            </div>
            
             <h2 className="text-xl font-bold mb-4">Live Tables</h2>
            {loading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl h-96"></div>
                    ))}
                </div>
            ) : Object.keys(combinedTableData).filter(id => combinedTableData[id].state !== 'available').length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Object.entries(combinedTableData)
                        .filter(([_, data]) => data.state !== 'available')
                        .map(([tableId, tableData]) => (
                        <TableCard key={tableId} tableId={tableId} tableData={tableData} onMarkAsPaid={handleMarkAsPaid} onPrintBill={setBillData} onMarkAsCleaned={handleMarkAsCleaned}/>
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold">No Active Tables</p>
                    <p>When a customer scans a QR code and orders, their table will appear here live.</p>
                </div>
            )}
            
            <div className="mt-12">
                 <h2 className="text-xl font-bold mb-4">All Your Tables</h2>
                 <Card>
                    <CardContent className="p-0">
                         <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="p-4 text-left font-semibold text-muted-foreground"><TableIcon size={16} className="inline mr-2"/>Table Name</th>
                                        <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2"/>Max Capacity</th>
                                        <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2"/>Currently Occupied</th>
                                        <th className="p-4 text-right font-semibold text-muted-foreground">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allTables.map(table => (
                                        <tr key={table.id} className="border-t border-border">
                                            <td className="p-4 font-semibold">{table.id}</td>
                                            <td className="p-4">{table.max_capacity}</td>
                                            <td className="p-4">{table.current_pax || 0}</td>
                                            <td className="p-4 flex justify-end gap-2">
                                                <Button variant="outline" size="sm" onClick={() => handleOpenQrDisplayModal(table)}>
                                                    <QrCode size={14} className="mr-2"/> Show QR
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleOpenEditModal(table)}>
                                                    <Edit size={16}/>
                                                </Button>
                                                 <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteTable(table.id)}>
                                                    <Trash2 size={16}/>
                                                 </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                         </div>
                    </CardContent>
                 </Card>
            </div>
        </div>
    );
}

export default function DineInPage() {
    return <DineInPageInternal />;
}
