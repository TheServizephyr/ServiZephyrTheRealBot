

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
import { useQRCode } from 'next-qrcode';
import { useReactToPrint } from 'react-to-print';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const TableCard = ({ tableId, orders }) => {
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
                        <Button variant="outline"><Printer size={16} className="mr-2"/> Print Bill</Button>
                        <Button className="bg-primary hover:bg-primary/90"><CheckCircle size={16} className="mr-2"/> Mark as Paid</Button>
                    </div>
                </CardFooter>
            </Card>
        </motion.div>
    );
};

const QrCodeDisplay = ({ text, tableName, innerRef }) => {
    const { Canvas } = useQRCode();

    return (
        <div ref={innerRef} className="bg-white p-4 rounded-lg border border-border flex flex-col items-center">
            <Canvas
                text={text}
                options={{
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    scale: 4,
                    width: 256,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF',
                    },
                }}
            />
            <p className="text-center font-bold text-lg mt-2 text-black">Scan to Order: {tableName}</p>
        </div>
    );
};


const QrGeneratorModal = ({ isOpen, onClose, restaurantId }) => {
    const [tableName, setTableName] = useState('');
    const [qrValue, setQrValue] = useState('');
    const printRef = useRef();

    const { Canvas } = useQRCode();

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
    const [restaurantId, setRestaurantId] = useState('');

    const fetchDineInOrders = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();
            
            // This is a bit of a workaround to get the restaurantId
            // A better solution might be to have a dedicated endpoint for businessId
            const settingsRes = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                // This assumes restaurantName is unique and can be used as ID, which is not ideal.
                // It should be a proper ID from a dedicated endpoint. For now, this is a placeholder.
                const bizId = settingsData?.restaurantName?.toLowerCase().replace(/\s+/g, '-') || '';
                setRestaurantId(bizId);
            }
            
            let url = new URL('/api/owner/orders', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            }

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch orders');
            }
            const data = await res.json();
            // Filter for dine-in and active tabs
            const dineInOrders = (data.orders || []).filter(o => o.deliveryType === 'dine-in' && o.status === 'active_tab');
            setOrders(dineInOrders);
        } catch (error) {
            console.error("Error fetching dine-in orders:", error);
            alert(`Could not load dine-in data: ${error.message}`);
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
            <QrGeneratorModal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} restaurantId={restaurantId}/>
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables.</p>
                </div>
                <div className="flex gap-4">
                     <Button onClick={() => setIsQrModalOpen(true)} variant="default" className="bg-primary hover:bg-primary/90">
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
                        <TableCard key={tableId} tableId={tableId} orders={tableOrders} />
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
