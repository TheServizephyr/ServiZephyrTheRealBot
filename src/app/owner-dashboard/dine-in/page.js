

'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2, QrCode, Download, Save } from 'lucide-react';
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

const TableCard = ({ tableId, orders, onMarkAsPaid, onPrintBill }) => {
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
    
    // Placeholder status logic
    const status = "Ordering"; 

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
            <Card className="flex flex-col h-full bg-card shadow-lg hover:shadow-primary/20 transition-shadow duration-300">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
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
                        <Button className="bg-primary hover:bg-primary/90" onClick={() => onMarkAsPaid(orders.map(o => o.id))}><CheckCircle size={16} className="mr-2"/> Mark as Paid</Button>
                    </div>
                </CardFooter>
            </Card>
        </motion.div>
    );
};

const QrCodeDisplay = ({ text, tableName, innerRef }) => {
    return (
        <div ref={innerRef} className="bg-white p-4 rounded-lg border border-border flex flex-col items-center">
            <QRCode
                value={text}
                size={256}
                level={"M"}
                includeMargin={true}
            />
            <p className="text-center font-bold text-lg mt-2 text-black">Scan to Order: {tableName}</p>
        </div>
    );
};


const QrGeneratorModal = ({ isOpen, onClose, restaurantId }) => {
    const [tableName, setTableName] = useState('');
    const [qrValue, setQrValue] = useState('');
    const printRef = useRef();

    const handleGenerate = () => {
        if (!tableName.trim()) {
            alert("Please enter a table name or number.");
            return;
        }
        const url = `${window.location.origin}/order/${restaurantId}?table=${tableName.trim()}`;
        setQrValue(url);
    };
    
    const handleDownload = () => {
        const canvas = printRef.current.querySelector('canvas');
        if (canvas) {
            const pngUrl = canvas
                .toDataURL("image/png")
                .replace("image/png", "image/octet-stream");
            let downloadLink = document.createElement("a");
            downloadLink.href = pngUrl;
            downloadLink.download = `${tableName}-qrcode.png`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        }
    };
    
    const handlePrint = useReactToPrint({
        content: () => printRef.current,
        documentTitle: `QR_Code_${tableName}`,
    });
    
    const handleSave = () => {
        // Placeholder for future save functionality
        alert(`QR Code for table "${tableName}" saved! (Feature coming soon)`);
    }

    useEffect(() => {
        if (!isOpen) {
            setTableName('');
            setQrValue('');
        }
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Generate Table QR Code</DialogTitle>
                    <DialogDescription>Create a unique QR code for a table. Customers can scan this to order directly.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="table-name">Table Name / Number</Label>
                        <Input 
                            id="table-name"
                            value={tableName}
                            onChange={(e) => setTableName(e.target.value)}
                            placeholder="e.g., T1, Table 5, Rooftop 2"
                        />
                    </div>
                    <Button onClick={handleGenerate} className="w-full bg-primary hover:bg-primary/90">Generate QR Code</Button>

                    {qrValue && (
                        <div className="mt-6 flex flex-col items-center gap-4">
                           <QrCodeDisplay text={qrValue} tableName={tableName} innerRef={printRef} />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-sm">
                                <Button onClick={handlePrint} variant="outline">
                                    <Printer className="mr-2 h-4 w-4" /> Print
                                </Button>
                                <Button onClick={handleDownload} variant="outline">
                                    <Download className="mr-2 h-4 w-4" /> Download PNG
                                </Button>
                                <Button onClick={handleSave} variant="secondary">
                                    <Save className="mr-2 h-4 w-4" /> Save for Later
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};


export default function DineInPage() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [restaurant, setRestaurant] = useState(null);
    const [billData, setBillData] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const billPrintRef = useRef();

    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
    });
    
    const handleApiCall = async (method, body, endpoint = '/api/owner/orders') => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }
        
        const fetchOptions = {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json',
            },
        };

        if (method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = JSON.stringify(body);
        } else if (body) {
            // For GET requests, append body properties to URL search params
            Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
        }

        const res = await fetch(url.toString(), fetchOptions);

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    };

    const fetchDineInOrders = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const data = await handleApiCall('GET', null, '/api/owner/orders');
            const dineInStatuses = ['pending', 'confirmed', 'preparing', 'active_tab', 'ready_for_pickup'];
            const dineInOrders = (data.orders || []).filter(o => o.deliveryType === 'dine-in' && dineInStatuses.includes(o.status));
            setOrders(dineInOrders);

            if (dineInOrders.length > 0 && !restaurant) {
                const firstOrder = dineInOrders[0];
                const orderDetails = await handleApiCall('GET', { id: firstOrder.id }, '/api/owner/orders');
                setRestaurant(orderDetails.restaurant);
            }

        } catch (error) {
            console.error("Error fetching dine-in orders:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load dine-in data: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
          if (user) fetchDineInOrders();
          else setLoading(false);
        });
    
        const interval = setInterval(() => fetchDineInOrders(true), 30000);
        return () => {
            unsubscribe();
            clearInterval(interval);
        };
      }, [impersonatedOwnerId]);


    const handleMarkAsPaid = async (orderIds) => {
        if (!window.confirm("Are you sure you want to mark this table's orders as paid and completed?")) return;

        setLoading(true);
        try {
            await Promise.all(
                orderIds.map(orderId => 
                    handleApiCall('PATCH', { orderId, newStatus: 'completed' })
                )
            );
            setInfoDialog({ isOpen: true, title: "Success", message: "Table has been cleared." });
            await fetchDineInOrders(true);
        } catch (error) {
            console.error("Error marking orders as paid:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not clear table: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };


    const ordersByTable = useMemo(() => {
        return orders.reduce((acc, order) => {
            const tableId = order.tableId || 'Unknown';
            if (!acc[tableId]) {
                acc[tableId] = [];
            }
            acc[tableId].push(order);
            return acc;
        }, {});
    }, [orders]);

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
            {restaurant && <QrGeneratorModal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} restaurantId={restaurant.id}/>}

            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables.</p>
                </div>
                <div className="flex gap-4">
                     <Button onClick={() => setIsQrModalOpen(true)} variant="default" className="bg-primary hover:bg-primary/90" disabled={!restaurant}>
                        <QrCode size={16} className="mr-2"/> Generate Table QR Codes
                    </Button>
                    <Button onClick={() => fetchDineInOrders(true)} variant="outline" disabled={loading}>
                        <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh View
                    </Button>
                </div>
            </div>
            
            {loading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl h-96"></div>
                    ))}
                </div>
            ) : Object.keys(ordersByTable).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Object.entries(ordersByTable).map(([tableId, tableOrders]) => (
                        <TableCard key={tableId} tableId={tableId} orders={tableOrders} onMarkAsPaid={handleMarkAsPaid} onPrintBill={setBillData} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-24 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold">No Active Tables</p>
                    <p>When a customer scans a QR code and orders, their table will appear here live.</p>
                </div>
            )}
        </div>
    );
}
