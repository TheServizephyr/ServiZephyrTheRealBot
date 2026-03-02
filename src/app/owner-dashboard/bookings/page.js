'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarClock, Check, X, Filter, MoreVertical, User, Phone, Users, Clock, Hash, Trash2, Search, RefreshCw, CheckCircle, AlertTriangle, XCircle, Loader2, ListOrdered, PhoneCall, MessageCircle, QrCode, Download, Save, MapPin, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import QRCode from 'qrcode.react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs, limit, doc } from 'firebase/firestore';
import { useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import { toPng } from 'html-to-image';
import { Printer } from 'lucide-react';

export const dynamic = 'force-dynamic';

const formatDateTime = (dateValue) => {
    if (!dateValue) return 'N/A';
    let date;
    if (typeof dateValue === 'object' && dateValue !== null && dateValue._seconds) {
        date = new Date(dateValue._seconds * 1000 + (dateValue._nanoseconds || 0) / 1000000);
    } else if (typeof dateValue === 'object' && dateValue !== null && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
    } else {
        date = new Date(dateValue);
    }
    if (isNaN(date.getTime())) return 'Invalid Date';
    return format(date, "dd MMM, yyyy 'at' hh:mm a");
};

const BookingCard = ({ booking, onUpdateStatus }) => {
    const statusConfig = {
        pending: { style: 'text-yellow-400 bg-yellow-500/10', icon: <Clock size={14} /> },
        confirmed: { style: 'text-green-400 bg-green-500/10', icon: <CheckCircle size={14} /> },
        cancelled: { style: 'text-red-400 bg-red-500/10', icon: <XCircle size={14} /> },
        completed: { style: 'text-blue-400 bg-blue-500/10', icon: <CheckCircle size={14} /> },
    };
    const currentStatusConfig = statusConfig[booking.status] || statusConfig.pending;

    const createdAtDate = useMemo(() => {
        if (!booking.createdAt) return null;
        const seconds = booking.createdAt._seconds || booking.createdAt.seconds;
        if (seconds) return new Date(seconds * 1000);
        const date = new Date(booking.createdAt);
        return isNaN(date.getTime()) ? null : date;
    }, [booking.createdAt]);

    const bookingDate = useMemo(() => {
        if (!booking.bookingDateTime) return null;
        if (booking.bookingDateTime._seconds) return new Date(booking.bookingDateTime._seconds * 1000);
        const date = new Date(booking.bookingDateTime);
        return isNaN(date.getTime()) ? null : date;
    }, [booking.bookingDateTime]);

    const canBeCompleted = bookingDate ? isPast(bookingDate) : true;

    return (
        <Card className={cn("overflow-hidden border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors border-l-4", booking.status === 'confirmed' ? "border-l-green-500" : booking.status === 'pending' ? "border-l-yellow-500" : "border-l-muted")}>
            <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-bold text-sm">{booking.customerName}</h4>
                        <p className="text-[10px] text-muted-foreground">{booking.customerPhone}</p>
                    </div>
                    <span className={cn('flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold rounded-full capitalize', currentStatusConfig.style)}>
                        {currentStatusConfig.icon}
                        {booking.status}
                    </span>
                </div>

                <div className="flex items-center gap-4 text-[10px] font-medium text-muted-foreground">
                    <div className="flex items-center gap-1"><Users size={12} /> {booking.partySize} Pax</div>
                    <div className="flex items-center gap-1"><CalendarClock size={12} /> {formatDateTime(booking.bookingDateTime)}</div>
                </div>

                {booking.status === 'pending' ? (
                    <div className="grid grid-cols-2 gap-2 pt-2">
                        <Button variant="outline" size="sm" className="h-8 border-green-500/50 text-green-500 hover:bg-green-500/10 text-[11px]" onClick={() => onUpdateStatus(booking.id, 'confirmed')}>
                            <Check size={14} className="mr-1" /> Confirm
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 border-red-500/50 text-red-500 hover:bg-red-500/10 text-[11px]" onClick={() => onUpdateStatus(booking.id, 'cancelled')}>
                            <X size={14} className="mr-1" /> Cancel
                        </Button>
                    </div>
                ) : (
                    <div className="flex justify-between items-center pt-1 mt-1 border-t border-border/50">
                        <span className="text-[9px] text-muted-foreground font-medium italic">
                            {createdAtDate && `Booked ${formatDistanceToNow(createdAtDate, { addSuffix: true })}`}
                        </span>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-7 w-7 p-0 hover:bg-muted/20">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {booking.status === 'confirmed' && (
                                    <>
                                        {canBeCompleted && (
                                            <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, 'completed')}>
                                                <CheckCircle className="mr-2 h-4 w-4 text-blue-500" /> <span className="text-blue-500">Mark Completed</span>
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, 'cancelled')}>
                                            <X className="mr-2 h-4 w-4 text-red-500" /> <span className="text-red-500">Cancel Booking</span>
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const WaitlistQrModal = ({ isOpen, onClose, restaurant }) => {
    const waitlistUrl = typeof window !== 'undefined' ? `${window.location.origin}/public/waitlist/${restaurant?.id}` : '';
    // Use full URL for the logo to avoid issues with some capture libraries
    const szLogo = typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : '/logo.png';
    const posterRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownloadQr = async () => {
        if (!posterRef.current || isDownloading) return;
        setIsDownloading(true);
        console.log('[QR Download] Starting capture...');

        try {
            // Ensure images are loaded before capture
            await new Promise(r => setTimeout(r, 600));

            const pngUrl = await toPng(posterRef.current, {
                cacheBust: true,
                pixelRatio: 4,
                backgroundColor: '#ffffff',
                skipFonts: false,
                width: 460, // Lock width for capture consistency
                style: {
                    margin: '0',
                    padding: '0',
                    transform: 'none'
                }
            });

            const link = document.createElement("a");
            link.href = pngUrl;
            link.download = `${restaurant?.name || 'Restaurant'}_Waitlist_Poster.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log('[QR Download] Success');
        } catch (error) {
            console.error('[QR Download] Failed:', error);
            alert("Download failed. Please try the 'Print' button instead.");
        } finally {
            setIsDownloading(false);
        }
    };

    const handlePrint = useReactToPrint({
        content: () => posterRef.current,
        documentTitle: `${restaurant?.name}_Waitlist_QR`,
        onBeforeGetContent: () => {
            console.log('[QR Print] Preparing content...');
            return Promise.resolve();
        }
    });

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden bg-white border-0 rounded-[2rem] max-h-[90vh] flex flex-col">
                <DialogHeader className="sr-only">
                    <DialogTitle>{restaurant?.name} Waitlist QR Code</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
                    {/* The Poster Container (Visible & Printable) */}
                    <div
                        ref={posterRef}
                        className="bg-white rounded-[24px] border-[4px] sm:border-[6px] border-yellow-400 shadow-2xl overflow-hidden w-full mx-auto"
                        style={{
                            printColorAdjust: 'exact',
                            WebkitPrintColorAdjust: 'exact',
                            backgroundColor: '#ffffff'
                        }}
                    >
                        {/* Header Section */}
                        <div className="bg-gradient-to-br from-yellow-300 via-yellow-200 to-white px-4 sm:px-6 py-6 sm:py-8 text-center border-b border-yellow-200">
                            <h3 className="text-xl sm:text-3xl leading-tight font-black text-black uppercase break-words px-2">
                                {restaurant?.name || 'Restaurant'}
                            </h3>
                            <p className="mt-1 sm:mt-2 text-[10px] sm:text-[12px] font-bold text-black uppercase tracking-[0.2em] opacity-70">Live Waitlist</p>
                            <p className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-black text-yellow-700 tracking-tight uppercase">Join Queue</p>
                        </div>

                        {/* QR Section */}
                        <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-4 sm:pb-6 text-center bg-white">
                            <div className="inline-flex items-center justify-center p-3 sm:p-4 rounded-2xl sm:rounded-3xl border-2 border-yellow-300 shadow-lg bg-white mx-auto">
                                <QRCode
                                    value={waitlistUrl}
                                    size={1024}
                                    level="H"
                                    includeMargin={true}
                                    renderAs="canvas"
                                    style={{
                                        width: '100%',
                                        maxWidth: '280px',
                                        height: 'auto',
                                        aspectRatio: '1/1',
                                        display: 'block',
                                    }}
                                    imageSettings={{
                                        src: szLogo,
                                        height: 180,
                                        width: 180,
                                        excavate: true
                                    }}
                                />
                            </div>

                            <p className="mt-4 sm:mt-6 text-[10px] sm:text-[11px] font-medium text-gray-500 px-2 sm:px-6 leading-relaxed">
                                Scan the above QR using Google Lens or any other supported scanner to join our live waitlist.
                            </p>

                            {/* Footer Branding */}
                            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-yellow-100">
                                <p className="text-[10px] sm:text-[12px] font-black text-black uppercase tracking-widest">
                                    Powered by ServiZephyr
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal Footer Actions */}
                <div className="p-4 bg-zinc-50 border-t border-zinc-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button onClick={handlePrint} variant="outline" className="h-12 sm:h-14 rounded-xl sm:rounded-2xl font-bold border-zinc-200 text-zinc-700 hover:bg-white hover:border-yellow-400 order-2 sm:order-1">
                        <Printer size={18} className="mr-2" /> Print Poster
                    </Button>
                    <Button
                        onClick={handleDownloadQr}
                        disabled={isDownloading}
                        className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-yellow-400 hover:bg-yellow-500 text-black font-black uppercase tracking-tight shadow-lg shadow-yellow-200 order-1 sm:order-2"
                    >
                        {isDownloading ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <><Download size={18} className="mr-2" /> Download PNG</>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const HistoryCard = ({ name, phone, pax, time, status, type }) => {
    const statusColors = {
        seated: "bg-green-500/10 text-green-500",
        cancelled: "bg-red-500/10 text-red-500",
        completed: "bg-blue-500/10 text-blue-500",
    };

    return (
        <Card className="overflow-hidden border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors">
            <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-bold text-sm">{name}</h4>
                        <p className="text-[10px] text-muted-foreground">{phone || 'No phone'}</p>
                    </div>
                    <span className={cn("px-2 py-0.5 rounded-full text-[9px] uppercase font-bold", statusColors[status] || "bg-muted text-muted-foreground")}>
                        {status}
                    </span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-medium text-muted-foreground">
                    <div className="flex items-center gap-1"><Users size={12} /> {pax} Pax</div>
                    <div className="flex items-center gap-1"><Clock size={12} /> {formatDateTime(time)}</div>
                </div>
            </CardContent>
        </Card>
    );
};

const WaitlistHistory = ({ restaurant, impersonatedOwnerId, employeeOfOwnerId }) => {
    const { toast } = useToast();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            let url = new URL('/api/owner/waitlist', window.location.origin);
            url.searchParams.append('history', 'true');
            if (impersonatedOwnerId) url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) url.searchParams.append('employee_of', employeeOfOwnerId);

            const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } });
            const data = await res.json();
            if (res.ok) setEntries(data.entries || []);
            else throw new Error(data.message);
        } catch (err) {
            toast({ title: "History Fetch Error", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [impersonatedOwnerId, employeeOfOwnerId, toast]);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

    return (
        <div className="space-y-4 py-4">
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted/20 animate-pulse rounded-xl" />)}
                </div>
            ) : entries.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">No waitlist history found.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {entries.map(entry => (
                        <HistoryCard
                            key={entry.id}
                            name={entry.name}
                            phone={entry.phone}
                            pax={entry.paxCount}
                            time={entry.createdAt}
                            status={entry.status}
                            type="waitlist"
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const HistoryModal = ({ isOpen, onClose, bookingsHistory, restaurant, impersonatedOwnerId, employeeOfOwnerId }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <History className="text-primary" /> Service History
                    </DialogTitle>
                    <DialogDescription>Review completed and cancelled services.</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="waitlist" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1">
                        <TabsTrigger value="waitlist">Waitlist</TabsTrigger>
                        <TabsTrigger value="bookings">Bookings</TabsTrigger>
                    </TabsList>

                    <TabsContent value="waitlist">
                        <WaitlistHistory restaurant={restaurant} impersonatedOwnerId={impersonatedOwnerId} employeeOfOwnerId={employeeOfOwnerId} />
                    </TabsContent>

                    <TabsContent value="bookings" className="space-y-4 py-4">
                        {bookingsHistory.length === 0 ? (
                            <p className="text-center text-muted-foreground py-10">No booking history found.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {bookingsHistory.map(b => (
                                    <HistoryCard
                                        key={b.id}
                                        name={b.customerName}
                                        phone={b.customerPhone}
                                        pax={b.partySize}
                                        time={b.bookingDateTime}
                                        status={b.status}
                                        type="booking"
                                    />
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <DialogFooter className="mt-6">
                    <Button onClick={onClose} variant="outline" className="w-full md:w-auto">Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const WaitlistManagement = ({
    restaurant,
    impersonatedOwnerId,
    employeeOfOwnerId,
    isWaitlistEnabled,
    handleToggleWaitlist,
    isWaitlistLoading,
    setIsWaitlistQrOpen
}) => {
    const { toast } = useToast();
    const [entries, setEntries] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedTables, setSelectedTables] = useState({});

    const handleApiCall = useCallback(async (method, body, path) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Auth required");
        const idToken = await user.getIdToken();
        let url = new URL(path, window.location.origin);
        if (impersonatedOwnerId) url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        else if (employeeOfOwnerId) url.searchParams.append('employee_of', employeeOfOwnerId);

        const options = {
            method,
            headers: { 'Authorization': `Bearer ${idToken}` }
        };
        if (method !== 'GET') {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        } else if (body) {
            Object.keys(body).forEach(k => url.searchParams.append(k, body[k]));
        }

        const res = await fetch(url.toString(), options);
        if (res.status === 204) return null;
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API failed');
        return data;
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [waitlistData, tablesData] = await Promise.all([
                handleApiCall('GET', null, '/api/owner/waitlist'),
                handleApiCall('GET', { include_empty_tabs: 'true' }, '/api/owner/dine-in-tables')
            ]);
            setEntries(waitlistData?.entries || []);
            setAllTables(tablesData?.tables || []);
        } catch (err) {
            console.error("Waitlist fetch error:", err);
            toast({ title: "Fetch Error", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [handleApiCall, toast]);

    useEffect(() => {
        if (!restaurant?.id || !restaurant?.collection) {
            fetchData();
            return;
        }

        setLoading(true);
        // Live Waitlist Listener
        const waitlistRef = collection(db, restaurant.collection, restaurant.id, 'waitlist');
        const qWaitlist = query(waitlistRef, where('status', 'in', ['pending', 'notified']));

        const unsubWaitlist = onSnapshot(qWaitlist, (snapshot) => {
            const f = [];
            snapshot.forEach(d => {
                const data = d.data();
                f.push({
                    id: d.id,
                    ...data,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
                });
            });
            f.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
            setEntries(f);
            setLoading(false);
        }, (err) => {
            console.error("Waitlist listener error:", err);
            fetchData(); // Fallback to API if listener fails
        });

        // Live Tables Listener (for accurate recommendations)
        const tablesRef = collection(db, restaurant.collection, restaurant.id, 'tables');
        const unsubTables = onSnapshot(tablesRef, (snapshot) => {
            const t = [];
            snapshot.forEach(d => t.push({ id: d.id, ...d.data() }));
            setAllTables(t.filter(table => !table.isDeleted));
        }, (err) => console.warn("Tables listener error:", err));

        return () => {
            unsubWaitlist();
            unsubTables();
        };
    }, [restaurant, fetchData]);

    const handleUpdateStatus = async (entryId, status) => {
        setActionLoading(entryId);
        try {
            await handleApiCall('PATCH', { entryId, status }, '/api/owner/waitlist');
            await fetchData();
            toast({ title: "Updated", description: `Customer marked as ${status}.` });
        } catch (err) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleSeatCustomer = async (entry) => {
        const tableId = selectedTables[entry.id];
        if (!tableId) return;
        setActionLoading(entry.id);
        try {
            await handleApiCall('POST', { action: 'create_tab', tableId, pax_count: entry.paxCount, tab_name: entry.name }, '/api/owner/dine-in-tables');
            await handleApiCall('PATCH', { entryId: entry.id, status: 'seated' }, '/api/owner/waitlist');
            toast({ title: "Seated", description: `${entry.name} seated at Table ${tableId}.` });
            await fetchData();
        } catch (err) {
            toast({ title: "Seating Error", description: err.message, variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleNotify = (entry) => {
        const msg = `Hello ${entry.name}, your table for ${entry.paxCount} pax at ${restaurant?.name || 'the restaurant'} is ready! Please proceed to the entrance.`;
        window.open(`https://wa.me/91${entry.phone}?text=${encodeURIComponent(msg)}`, '_blank');
        handleUpdateStatus(entry.id, 'notified');
    };

    const recommendedEntries = useMemo(() => {
        if (!entries.length || !allTables.length) return new Set();

        const sortedEntries = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const availableTables = allTables
            .filter(t => t.state === 'available')
            .sort((a, b) => a.max_capacity - b.max_capacity); // Smallest fitting table first

        const recommendedIds = new Set();
        const usedTableIds = new Set();

        for (const entry of sortedEntries) {
            // Find a table that fits this entry and hasn't been used in this recommendation cycle
            const table = availableTables.find(t =>
                !usedTableIds.has(t.id) &&
                t.max_capacity >= entry.paxCount
            );

            if (table) {
                recommendedIds.add(entry.id);
                usedTableIds.add(table.id);
            }
        }
        return recommendedIds;
    }, [entries, allTables]);

    return (
        <div className="space-y-6">
            <style jsx global>{`
                @keyframes pulse-green {
                    0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
                }
                @keyframes pulse-yellow {
                    0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(234, 179, 8, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
                }
                .animate-pulse-green { animation: pulse-green 2s infinite; }
                .animate-pulse-yellow { animation: pulse-yellow 2s infinite; }
            `}</style>
            <div className="flex justify-between items-center bg-muted/30 p-4 rounded-xl border border-border">
                <div>
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <ListOrdered className="text-primary" size={20} />
                        Active Waitlist ({entries.length})
                    </h3>
                    <p className="text-sm text-muted-foreground">Manage walk-ins.</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Label htmlFor="waitlist-toggle" className="text-xs font-bold whitespace-nowrap">Waitlist Status</Label>
                            <Switch id="waitlist-toggle" checked={isWaitlistEnabled} onCheckedChange={handleToggleWaitlist} disabled={isWaitlistLoading} />
                        </div>
                        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8">
                            <RefreshCw size={14} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                        </Button>
                    </div>
                    {isWaitlistEnabled && (
                        <Button variant="link" size="sm" className="h-auto p-0 text-primary text-[10px]" onClick={() => setIsWaitlistQrOpen(true)}>
                            <QrCode size={12} className="mr-1" /> Get QR Code
                        </Button>
                    )}
                </div>
            </div>

            {loading && entries.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}
                </div>
            ) : entries.length === 0 ? (
                <Card className="border-dashed py-12 text-center bg-muted/10">
                    <ListOrdered className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">Empty waitlist.</p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {entries.map(entry => {
                        const tableId = selectedTables[entry.id];
                        const fitTables = allTables.filter(t => t.state === 'available' && t.max_capacity >= entry.paxCount);
                        const isRecommended = recommendedEntries.has(entry.id);
                        const isNotified = entry.status === 'notified';

                        return (
                            <Card key={entry.id} className={cn(
                                "border-l-4 transition-all duration-300",
                                isNotified ? "border-l-amber-500" : isRecommended ? "border-l-green-500 shadow-lg scale-[1.02]" : "border-l-primary",
                                isRecommended && !isNotified && "animate-pulse-green border-green-500/50",
                                isNotified && "animate-pulse-yellow border-amber-500/50"
                            )}>
                                <CardContent className="p-4 space-y-4">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-start gap-2">
                                            {isRecommended && !isNotified && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                            )}
                                            {isNotified && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                            )}
                                            <div>
                                                <h4 className="font-bold flex items-center gap-2">
                                                    {entry.name}
                                                    {isRecommended && !isNotified && (
                                                        <span className="text-[10px] bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-md border border-green-500/20">Ready to Seat</span>
                                                    )}
                                                </h4>
                                                <p className="text-xs text-muted-foreground">+91 {entry.phone}</p>
                                            </div>
                                        </div>
                                        <div className={cn("px-2 py-0.5 rounded-full text-[10px] uppercase font-bold", isNotified ? "bg-amber-500/10 text-amber-500" : isRecommended ? "bg-green-500/10 text-green-500" : "bg-primary/10 text-primary")}>
                                            {isNotified ? 'Notified' : isRecommended ? 'Recommended' : 'Waiting'}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs font-medium">
                                        <div className="flex items-center gap-1"><Users size={14} /> {entry.paxCount}</div>
                                        <div className="flex items-center gap-1 text-muted-foreground"><Clock size={14} /> {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</div>
                                    </div>
                                    <div className="space-y-2 pt-2 border-t border-border/50">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Table Allocation</Label>
                                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                            {fitTables.map(t => (
                                                <Button key={t.id} size="sm" variant={tableId === t.id ? "default" : "outline"} className="h-8 text-[11px] px-2" onClick={() => setSelectedTables(prev => ({ ...prev, [entry.id]: t.id }))}>
                                                    T{t.id} ({t.max_capacity}P)
                                                </Button>
                                            ))}
                                            {fitTables.length === 0 && <p className="text-[10px] text-muted-foreground italic">No tables available</p>}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => handleNotify(entry)}>
                                            <MessageCircle size={14} className="mr-1.5" /> WhatsApp
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-9 text-xs" asChild>
                                            <a href={`tel:+91${entry.phone}`}><PhoneCall size={14} className="mr-1.5" /> Call</a>
                                        </Button>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button className="flex-1 h-10 font-bold" disabled={!tableId || actionLoading === entry.id} onClick={() => handleSeatCustomer(entry)}>
                                            {actionLoading === entry.id ? <Loader2 className="animate-spin" size={16} /> : 'Seat Customer'}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive hover:bg-destructive/10" onClick={() => handleUpdateStatus(entry.id, 'cancelled')}>
                                            <Trash2 size={18} />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

function BookingsPageContent() {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [businessInfo, setBusinessInfo] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('waitlist');
    const [isWaitlistEnabled, setIsWaitlistEnabled] = useState(false);
    const [isWaitlistLoading, setIsWaitlistLoading] = useState(false);
    const [isWaitlistQrOpen, setIsWaitlistQrOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const { toast } = useToast();

    const fetchBookings = useCallback(async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        const timeoutId = setTimeout(() => setLoading(false), 5000);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            let url = new URL('/api/owner/bookings', window.location.origin);
            if (impersonatedOwnerId) url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) url.searchParams.append('employee_of', employeeOfOwnerId);
            const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (res.ok) {
                const data = await res.json();
                setBookings(data.bookings || []);
            }
        } catch (err) { console.error(err); }
        finally { clearTimeout(timeoutId); setLoading(false); }
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;
        let unsubscribe = () => { };
        const setup = async () => {
            try {
                const targetId = impersonatedOwnerId || employeeOfOwnerId || user.uid;
                const colls = ['restaurants', 'shops', 'street_vendors'];
                for (const coll of colls) {
                    const q = query(collection(db, coll), where('ownerId', '==', targetId), limit(1));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                        const bData = { id: snap.docs[0].id, collection: coll, ...snap.docs[0].data() };
                        setBusinessInfo(bData);
                        setIsWaitlistEnabled(bData.isWaitlistEnabled || false);
                        const bRef = collection(db, coll, bData.id, 'bookings');
                        unsubscribe = onSnapshot(query(bRef), (s) => {
                            const f = [];
                            s.forEach(d => f.push({ id: d.id, ...d.data() }));
                            setBookings(f);
                            setLoading(false);
                        });
                        break;
                    }
                }
            } catch (err) { console.error(err); setLoading(false); }
        };
        fetchBookings(true);
        setup();
        return () => unsubscribe();
    }, [impersonatedOwnerId, employeeOfOwnerId, fetchBookings]);

    const handleUpdateStatus = async (bookingId, status) => {
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/bookings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ bookingId, status }),
            });
            if (res.ok) {
                setInfoDialog({ isOpen: true, title: 'Success', message: `Booking ${status}.` });
                fetchBookings(true);
            }
        } catch (err) { setInfoDialog({ isOpen: true, title: 'Error', message: err.message }); }
    };

    const handleToggleWaitlist = async (enabled) => {
        setIsWaitlistLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isWaitlistEnabled: enabled })
            });
            if (res.ok) {
                setIsWaitlistEnabled(enabled);
                toast({ title: `Waitlist ${enabled ? 'Enabled' : 'Disabled'}` });
            }
        } catch (err) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
        finally { setIsWaitlistLoading(false); }
    };

    const filtered = useMemo(() => {
        let items = [...bookings];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(b => (b.customerName || '').toLowerCase().includes(q) || (b.customerPhone || '').includes(q));
        }
        return items;
    }, [bookings, searchQuery]);

    const upcoming = useMemo(() => filtered.filter(b => b.status === 'pending' || b.status === 'confirmed').sort((a, b) => {
        const getT = v => v?._seconds ? v._seconds * 1000 : new Date(v).getTime();
        return getT(a.bookingDateTime) - getT(b.bookingDateTime);
    }), [filtered]);

    const past = useMemo(() => filtered.filter(b => b.status === 'completed' || b.status === 'cancelled').sort((a, b) => {
        const getT = v => v?._seconds ? v._seconds * 1000 : new Date(v).getTime();
        return getT(b.bookingDateTime) - getT(a.bookingDateTime);
    }), [filtered]);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 md:p-6 space-y-6">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Bookings & Waitlist</h1>
                    <p className="text-muted-foreground mt-1">Manage your table reservations and walk-in waitlist.</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => setIsHistoryOpen(true)} variant="outline" className="flex items-center gap-2">
                        <History size={16} /> History
                    </Button>
                    <Button onClick={() => fetchBookings(true)} variant="outline" disabled={loading}>
                        <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                    </Button>
                </div>
            </header>

            {!loading && businessInfo && businessInfo.isOpen === false && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3 text-amber-600 dark:text-amber-400"
                >
                    <AlertTriangle size={20} className="shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-bold">Restaurant is Currently Closed</p>
                        <p className="text-xs opacity-80">New online bookings and waitlist joins are disabled. You can still manage existing entries here.</p>
                    </div>
                </motion.div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <TabsList className="bg-muted/50 p-1 self-start">
                        <TabsTrigger value="waitlist" className="flex items-center gap-2 font-bold"><ListOrdered size={16} /> Live Waitlist</TabsTrigger>
                        <TabsTrigger value="upcoming" className="flex items-center gap-2 font-bold"><CalendarClock size={16} /> Upcoming Bookings</TabsTrigger>
                    </TabsList>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                        <input type="text" placeholder="Search by name or phone..." className="w-full bg-muted/30 border border-border rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                </div>

                <TabsContent value="waitlist">
                    <WaitlistManagement
                        restaurant={businessInfo}
                        impersonatedOwnerId={impersonatedOwnerId}
                        employeeOfOwnerId={employeeOfOwnerId}
                        isWaitlistEnabled={isWaitlistEnabled}
                        handleToggleWaitlist={handleToggleWaitlist}
                        isWaitlistLoading={isWaitlistLoading}
                        setIsWaitlistQrOpen={setIsWaitlistQrOpen}
                    />
                </TabsContent>

                <TabsContent value="upcoming">
                    <div className="space-y-6">
                        <div className="flex justify-between items-center bg-muted/30 p-4 rounded-xl border border-border">
                            <div>
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <CalendarClock className="text-primary" size={20} />
                                    Active Reservations ({upcoming.length})
                                </h3>
                                <p className="text-sm text-muted-foreground">Manage upcoming table bookings.</p>
                            </div>
                        </div>

                        {loading && upcoming.length === 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />)}
                            </div>
                        ) : upcoming.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {upcoming.map(b => <BookingCard key={b.id} booking={b} onUpdateStatus={handleUpdateStatus} />)}
                            </div>
                        ) : (
                            <Card className="border-dashed py-12 text-center bg-muted/10">
                                <CalendarClock className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
                                <p className="text-muted-foreground">No upcoming bookings found.</p>
                            </Card>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            <WaitlistQrModal isOpen={isWaitlistQrOpen} onClose={() => setIsWaitlistQrOpen(false)} restaurant={businessInfo} />
            <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} bookingsHistory={past} restaurant={businessInfo} impersonatedOwnerId={impersonatedOwnerId} employeeOfOwnerId={employeeOfOwnerId} />
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ ...infoDialog, isOpen: false })} title={infoDialog.title} message={infoDialog.message} />
        </motion.div>
    );
}

export default function BookingsPage() {
    return (
        <Suspense fallback={<div className="p-10 text-center"><Loader2 className="mx-auto h-10 w-10 animate-spin text-primary/30" /></div>}>
            <BookingsPageContent />
        </Suspense>
    );
}
