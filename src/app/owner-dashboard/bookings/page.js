'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarClock, Check, X, Filter, MoreVertical, User, Phone, Users, Clock, Hash, Trash2, Search, RefreshCw, CheckCircle, AlertTriangle, XCircle, Loader2, ListOrdered, PhoneCall, MessageCircle, QrCode, Download, Save, MapPin, History, Settings, ScanLine, BarChart3 } from 'lucide-react';
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
import QrScanner from '@/components/QrScanner';
import { cn } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import { toPng } from 'html-to-image';
import { Printer } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';

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

const formatCountdown = (totalSeconds) => {
    const safeSeconds = Math.max(0, Number(totalSeconds || 0));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
            const nodeWidth = posterRef.current.scrollWidth || posterRef.current.offsetWidth || 460;
            const nodeHeight = posterRef.current.scrollHeight || posterRef.current.offsetHeight;

            const pngUrl = await toPng(posterRef.current, {
                cacheBust: true,
                pixelRatio: 4,
                backgroundColor: '#ffffff',
                skipFonts: false,
                width: nodeWidth,
                height: nodeHeight,
                style: {
                    width: `${nodeWidth}px`,
                    height: `${nodeHeight}px`,
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

const HistoryCard = ({ name, phone, pax, time, status, type, token }) => {
    const statusColors = {
        seated: "bg-green-500/10 text-green-500",
        cancelled: "bg-red-500/10 text-red-500",
        completed: "bg-blue-500/10 text-blue-500",
        no_show: "bg-amber-500/10 text-amber-600",
    };

    return (
        <Card className="overflow-hidden border-border/50 bg-muted/5 hover:bg-muted/10 transition-colors">
            <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-bold text-sm">{name}</h4>
                        <p className="text-[10px] text-muted-foreground">{phone || 'No phone'}</p>
                        {token && (
                            <p className="text-[10px] text-yellow-500 font-semibold mt-1">{token}</p>
                        )}
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

const WaitlistHistory = ({ restaurant, impersonatedOwnerId, employeeOfOwnerId, searchQuery = '' }) => {
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

    const filteredEntries = useMemo(() => {
        const q = String(searchQuery || '').trim().toLowerCase();
        if (!q) return entries;
        return entries.filter((entry) => {
            const name = String(entry?.name || '').toLowerCase();
            const phone = String(entry?.phone || '');
            const token = String(entry?.waitlistToken || '').toLowerCase();
            return name.includes(q) || phone.includes(q) || token.includes(q);
        });
    }, [entries, searchQuery]);

    return (
        <div className="space-y-4 py-4">
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted/20 animate-pulse rounded-xl" />)}
                </div>
            ) : filteredEntries.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">No waitlist history found.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredEntries.map(entry => (
                        <HistoryCard
                            key={entry.id}
                            name={entry.name}
                            phone={entry.phone}
                            pax={entry.paxCount}
                            time={entry.noShowAt || entry.seatedAt || entry.cancelledAt || entry.createdAt}
                            status={entry.status}
                            type="waitlist"
                            token={entry.waitlistToken}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const CHART_COLORS = ['#FACC15', '#22C55E', '#EF4444', '#3B82F6', '#A855F7', '#14B8A6'];

const WaitlistAnalyticsModal = ({ isOpen, onClose, impersonatedOwnerId, employeeOfOwnerId }) => {
    const { toast } = useToast();
    const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [loading, setLoading] = useState(false);
    const [analytics, setAnalytics] = useState(null);

    const fetchAnalytics = useCallback(async () => {
        if (startDate > endDate) {
            toast({ title: 'Invalid Range', description: 'Start date cannot be after end date.', variant: 'destructive' });
            return;
        }
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const url = new URL('/api/owner/waitlist/analytics', window.location.origin);
            url.searchParams.set('startDate', startDate);
            url.searchParams.set('endDate', endDate);
            if (impersonatedOwnerId) url.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
            else if (employeeOfOwnerId) url.searchParams.set('employee_of', employeeOfOwnerId);

            const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to load analytics');
            setAnalytics(data);
        } catch (err) {
            toast({ title: 'Analytics Error', description: err.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, impersonatedOwnerId, employeeOfOwnerId, toast]);

    useEffect(() => {
        if (isOpen) void fetchAnalytics();
    }, [isOpen, fetchAnalytics]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BarChart3 size={18} /> Waitlist Analytics
                    </DialogTitle>
                    <DialogDescription>
                        Customer mix, peak hours, cancellations and no-show trends for selected range.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor="analyticsStartDate" className="text-sm">From</Label>
                        <input
                            id="analyticsStartDate"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm"
                        />
                        <Label htmlFor="analyticsEndDate" className="text-sm">To</Label>
                        <input
                            id="analyticsEndDate"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm"
                        />
                        <Button type="button" variant="outline" onClick={fetchAnalytics} disabled={loading}>
                            {loading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
                            Refresh
                        </Button>
                    </div>

                    {loading && !analytics ? (
                        <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />
                    ) : analytics ? (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{analytics?.summary?.totalEntries || 0}</p></CardContent></Card>
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">New</p><p className="text-2xl font-bold text-green-500">{analytics?.summary?.newCustomers || 0}</p></CardContent></Card>
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Repeat</p><p className="text-2xl font-bold text-blue-500">{analytics?.summary?.repeatCustomers || 0}</p></CardContent></Card>
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Cancellations</p><p className="text-2xl font-bold text-red-500">{analytics?.summary?.cancellations || 0}</p></CardContent></Card>
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">No-show</p><p className="text-2xl font-bold text-amber-500">{analytics?.summary?.noShow || 0}</p></CardContent></Card>
                                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Seated</p><p className="text-2xl font-bold text-primary">{analytics?.summary?.seated || 0}</p></CardContent></Card>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">Peak Hours Heatmap</CardTitle>
                                        <CardDescription>Entries by hour ({analytics?.timezone || 'IST'})</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={analytics?.hourly || []}>
                                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
                                                <YAxis allowDecimals={false} />
                                                <Tooltip />
                                                <Bar dataKey="count" fill="#FACC15" radius={[6, 6, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">Customer Mix</CardTitle>
                                        <CardDescription>New vs repeat customers</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={analytics?.customerMix || []} dataKey="count" nameKey="label" outerRadius={110} label>
                                                    {(analytics?.customerMix || []).map((entry, index) => (
                                                        <Cell key={`${entry.label}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </CardContent>
                                </Card>
                            </div>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Status Breakdown</CardTitle>
                                    <CardDescription>Pending, notified, seated, cancelled, no-show</CardDescription>
                                </CardHeader>
                                <CardContent className="h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={analytics?.statusBreakdown || []}>
                                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                            <XAxis dataKey="status" />
                                            <YAxis allowDecimals={false} />
                                            <Tooltip />
                                            <Bar dataKey="count" fill="#22C55E" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">No analytics data available.</p>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const HistoryModal = ({ isOpen, onClose, bookingsHistory, restaurant, impersonatedOwnerId, employeeOfOwnerId, onOpenAnalytics }) => {
    const [historySearchQuery, setHistorySearchQuery] = useState('');
    const filteredBookingsHistory = useMemo(() => {
        const q = String(historySearchQuery || '').trim().toLowerCase();
        if (!q) return bookingsHistory;
        return bookingsHistory.filter((b) => {
            const name = String(b?.customerName || '').toLowerCase();
            const phone = String(b?.customerPhone || '');
            const token = String(b?.waitlistToken || '').toLowerCase();
            return name.includes(q) || phone.includes(q) || token.includes(q);
        });
    }, [bookingsHistory, historySearchQuery]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <History className="text-primary" /> Service History
                    </DialogTitle>
                    <DialogDescription>Review completed and cancelled services.</DialogDescription>
                </DialogHeader>

                <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <input
                        type="text"
                        placeholder="Search history by name, number, token..."
                        className="w-full bg-muted/30 border border-border rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                    />
                </div>

                <Tabs defaultValue="waitlist" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1">
                        <TabsTrigger value="waitlist">Waitlist</TabsTrigger>
                        <TabsTrigger value="bookings">Bookings</TabsTrigger>
                    </TabsList>

                    <TabsContent value="waitlist">
                        <WaitlistHistory
                            restaurant={restaurant}
                            impersonatedOwnerId={impersonatedOwnerId}
                            employeeOfOwnerId={employeeOfOwnerId}
                            searchQuery={historySearchQuery}
                        />
                    </TabsContent>

                    <TabsContent value="bookings" className="space-y-4 py-4">
                        {filteredBookingsHistory.length === 0 ? (
                            <p className="text-center text-muted-foreground py-10">No booking history found.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {filteredBookingsHistory.map(b => (
                                    <HistoryCard
                                        key={b.id}
                                        name={b.customerName}
                                        phone={b.customerPhone}
                                        pax={b.partySize}
                                        time={b.bookingDateTime}
                                        status={b.status}
                                        type="booking"
                                        token={b.waitlistToken}
                                    />
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <DialogFooter className="mt-6 flex gap-2">
                    <Button onClick={onOpenAnalytics} variant="outline" className="w-full md:w-auto">
                        <BarChart3 size={15} className="mr-2" /> Analytics
                    </Button>
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
    waitlistSeatingMode,
    onWaitlistUpdate,
}) => {
    const { toast } = useToast();
    const [entries, setEntries] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedTables, setSelectedTables] = useState({});
    const [waitlistMeta, setWaitlistMeta] = useState({
        noShowTimeoutMinutes: 10,
        capacity: null,
    });
    const [nowTs, setNowTs] = useState(Date.now());
    const [isArrivalScannerOpen, setIsArrivalScannerOpen] = useState(false);
    const [scanSeatingEntry, setScanSeatingEntry] = useState(null);
    const [scanSelectedTableId, setScanSelectedTableId] = useState('');

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

    const listenerRefreshTimerRef = useRef(null);
    const fetchData = useCallback(async (silent = false) => {
        if (listenerRefreshTimerRef.current) {
            clearTimeout(listenerRefreshTimerRef.current);
            listenerRefreshTimerRef.current = null;
        }
        if (!silent) setLoading(true);
        try {
            const [waitlistData, tablesData] = await Promise.all([
                handleApiCall('GET', null, '/api/owner/waitlist'),
                handleApiCall('GET', { include_empty_tabs: 'true' }, '/api/owner/dine-in-tables')
            ]);
            setEntries(waitlistData?.entries || []);
            setWaitlistMeta(waitlistData?.meta || { noShowTimeoutMinutes: 10, capacity: null });
            setAllTables(tablesData?.tables || []);
        } catch (err) {
            console.error("Waitlist fetch error:", err);
            toast({ title: "Fetch Error", description: err.message, variant: "destructive" });
        } finally {
            if (!silent) setLoading(false);
        }
    }, [handleApiCall, toast]);

    useEffect(() => {
        if (typeof onWaitlistUpdate === 'function') {
            onWaitlistUpdate(entries);
        }
    }, [entries, onWaitlistUpdate]);


    useEffect(() => {
        if (!restaurant?.id || !restaurant?.collection) {
            fetchData();
            return;
        }

        setLoading(true);
        // Live Waitlist Listener
        const waitlistRef = collection(db, restaurant.collection, restaurant.id, 'waitlist');
        const qWaitlist = query(waitlistRef, where('status', 'in', ['pending', 'ready_to_notify', 'notified', 'arrived']));

        const unsubWaitlist = onSnapshot(qWaitlist, () => {
            void fetchData();
        }, (err) => {
            console.error("Waitlist listener error:", err);
            fetchData(); // Fallback to API if listener fails
        });

        // Live Tables Listener (for accurate recommendations)
        const tablesRef = collection(db, restaurant.collection, restaurant.id, 'tables');
        const unsubTables = onSnapshot(tablesRef, () => {
            void fetchData();
        }, (err) => console.warn("Tables listener error:", err));

        return () => {
            unsubWaitlist();
            unsubTables();
        };
    }, [restaurant, fetchData]);

    useEffect(() => {
        const interval = setInterval(() => setNowTs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const handleUpdateStatus = async (entryId, status) => {
        setActionLoading(entryId);
        try {
            const result = await handleApiCall('PATCH', { entryId, status }, '/api/owner/waitlist');
            await fetchData();
            toast({ title: "Updated", description: `Customer marked as ${status}.` });
            if (result?.warning) {
                toast({ title: "Capacity Alert", description: result.warning, variant: "destructive" });
            }
            if (result?.promotedEntryId) {
                toast({ title: "Next Guest Notified", description: "Auto-promoted next pending guest." });
            }
        } catch (err) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const seatWaitlistEntry = useCallback(async (entry, overrideTableId = null, source = 'manual') => {
        const tableId = overrideTableId || selectedTables[entry.id];
        const usesTraditionalSeating = waitlistSeatingMode === 'manual_seat';
        if (!usesTraditionalSeating && !tableId) return;
        setActionLoading(entry.id);
        try {
            if (!usesTraditionalSeating) {
                await handleApiCall('POST', { action: 'create_tab', tableId, pax_count: entry.paxCount, tab_name: entry.name }, '/api/owner/dine-in-tables');
            }
            const result = await handleApiCall('PATCH', { entryId: entry.id, status: 'seated' }, '/api/owner/waitlist');
            toast({
                title: "Seated",
                description: usesTraditionalSeating
                    ? `${entry.name} marked as seated (manual seating).`
                    : `${entry.name} seated at Table ${tableId}.${source === 'scan' ? ' (via token scan)' : ''}`
            });
            if (result?.warning) {
                toast({ title: "Capacity Alert", description: result.warning, variant: "destructive" });
            }
            await fetchData();
        } catch (err) {
            toast({ title: "Seating Error", description: err.message, variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    }, [selectedTables, waitlistSeatingMode, handleApiCall, fetchData, toast]);

    const handleSeatCustomer = async (entry) => {
        await seatWaitlistEntry(entry, null, 'manual');
    };

    const handleNotify = (entry) => {
        const guestCountText = `${entry.paxCount} ${Number(entry.paxCount) === 1 ? 'guest' : 'guests'}`;
        const lapseMinutes = Number(waitlistMeta?.noShowTimeoutMinutes || 10);
        const msg = `Hi ${entry.name},\n\nGreat news! Your table for ${guestCountText} at ${restaurant?.name || 'the restaurant'} is now ready.\n\nPlease come to the entrance when you can.\nYour seat may lapse after ${lapseMinutes} minutes, so please arrive soon to avoid cancellation.\nIf you are not visiting, please let us know so we can assist the next guest.\n\nThank you!`;
        window.open(`https://wa.me/91${entry.phone}?text=${encodeURIComponent(msg)}`, '_blank');
        handleUpdateStatus(entry.id, 'notified');
    };

    const handleArrivalScanSuccess = useCallback(async (decodedText) => {
        try {
            const parsed = new URL(decodedText);
            const rid = parsed.searchParams.get('rid');
            const eid = parsed.searchParams.get('eid');
            const c = parsed.searchParams.get('c');

            const isWaitlistArrivalPath = parsed.pathname.includes('/public/waitlist-arrive');
            if (!isWaitlistArrivalPath || !rid || !eid || !c) {
                throw new Error('Invalid waitlist arrival QR.');
            }

            if (restaurant?.id && rid !== restaurant.id) {
                throw new Error('This token belongs to another restaurant.');
            }

            const entry = entries.find((item) => item.id === eid);
            if (!entry) {
                throw new Error('Entry not found in active waitlist.');
            }

            const scannedCode = String(c || '').trim().toUpperCase();
            const storedCode = String(entry.arrivalCode || '').trim().toUpperCase();
            if (!storedCode || storedCode !== scannedCode) {
                throw new Error('Invalid token QR.');
            }

            const usesTraditionalSeating = waitlistSeatingMode === 'manual_seat';
            if (usesTraditionalSeating) {
                setIsArrivalScannerOpen(false);
                await seatWaitlistEntry(entry, null, 'scan');
                return;
            }

            const fitTables = allTables
                .filter((t) => t.state === 'available' && t.max_capacity >= entry.paxCount)
                .sort((a, b) => a.max_capacity - b.max_capacity);

            if (fitTables.length === 0) {
                throw new Error('No table available for this party size.');
            }

            setScanSeatingEntry(entry);
            setScanSelectedTableId(fitTables[0].id);
            setIsArrivalScannerOpen(false);
        } catch (err) {
            toast({ title: 'Scan Error', description: err.message || 'Invalid QR code.', variant: 'destructive' });
        }
    }, [restaurant?.id, entries, waitlistSeatingMode, allTables, seatWaitlistEntry, toast]);

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
            <div className="hidden md:flex justify-between items-center bg-muted/30 p-4 rounded-xl border border-border">
                <div>
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <ListOrdered className="text-primary" size={20} />
                        Active Waitlist ({entries.length})
                    </h3>
                    <p className="text-sm text-muted-foreground">Manage walk-ins.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIsArrivalScannerOpen(true)} className="h-8 hidden md:inline-flex">
                        <ScanLine size={14} className="mr-2" /> Scan Token QR
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8">
                        <RefreshCw size={14} className={cn("md:mr-2", loading && "animate-spin")} /> <span className="hidden md:inline">Refresh</span>
                    </Button>
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
                        const usesTraditionalSeating = waitlistSeatingMode === 'manual_seat';
                        const tableId = selectedTables[entry.id];
                        const fitTables = allTables.filter(t => t.state === 'available' && t.max_capacity >= entry.paxCount);
                        const isRecommended = !usesTraditionalSeating && recommendedEntries.has(entry.id);
                        const isNotified = entry.status === 'notified';
                        const isReadyToNotify = entry.status === 'ready_to_notify';
                        const isArrived = entry.status === 'arrived';
                        const notifiedAtMs = entry?.notifiedAt ? new Date(entry.notifiedAt).getTime() : null;
                        const computedDeadlineMs = notifiedAtMs
                            ? (notifiedAtMs + Math.max(1, Number(waitlistMeta?.noShowTimeoutMinutes || 10)) * 60 * 1000)
                            : null;
                        const noShowDeadlineMs = entry?.noShowDeadlineAt
                            ? new Date(entry.noShowDeadlineAt).getTime()
                            : computedDeadlineMs;
                        const remainingNoShowMinutes = (isNotified && noShowDeadlineMs)
                            ? Math.max(0, Math.ceil((noShowDeadlineMs - nowTs) / 60000))
                            : null;
                        const totalNoShowSeconds = Math.max(60, Number(waitlistMeta?.noShowTimeoutMinutes || 10) * 60);
                        const remainingNoShowSeconds = (isNotified && noShowDeadlineMs)
                            ? Math.max(0, Math.ceil((noShowDeadlineMs - nowTs) / 1000))
                            : null;
                        const progressRatio = remainingNoShowSeconds !== null
                            ? Math.max(0, Math.min(1, remainingNoShowSeconds / totalNoShowSeconds))
                            : 0;
                        const progressDeg = Math.round(progressRatio * 360);

                        return (
                            <Card key={entry.id} className={cn(
                                "border-l-4 transition-all duration-300",
                                isNotified ? "border-l-amber-500" : isReadyToNotify ? "border-l-sky-500" : isArrived ? "border-l-purple-500" : isRecommended ? "border-l-green-500 shadow-lg scale-[1.02]" : "border-l-primary",
                                isRecommended && !isNotified && "animate-pulse-green border-green-500/50",
                                isNotified && "animate-pulse-yellow border-amber-500/50"
                            )}>
                                <CardContent className="p-4 space-y-4">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-start gap-2">
                                            {isRecommended && !isNotified && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                            )}
                                            {isReadyToNotify && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                                            )}
                                            {isNotified && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                            )}
                                            {isArrived && (
                                                <div className="mt-1.5 h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
                                            )}
                                            <div>
                                                <h4 className="font-bold flex items-center gap-2">
                                                    {entry.name}
                                                    {entry.waitlistToken && (
                                                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md border border-primary/20">
                                                            {entry.waitlistToken}
                                                        </span>
                                                    )}
                                                    {isRecommended && !isNotified && (
                                                        <span className="text-[10px] bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-md border border-green-500/20">Ready to Seat</span>
                                                    )}
                                                </h4>
                                                <p className="text-xs text-muted-foreground">+91 {entry.phone}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1.5">
                                            <div className={cn("px-2 py-0.5 rounded-full text-[10px] uppercase font-bold", isNotified ? "bg-amber-500/10 text-amber-500" : isReadyToNotify ? "bg-sky-500/10 text-sky-500" : isArrived ? "bg-purple-500/10 text-purple-500" : isRecommended ? "bg-green-500/10 text-green-500" : "bg-primary/10 text-primary")}>
                                                {isNotified ? 'Notified' : isReadyToNotify ? 'Ready to Notify' : isArrived ? 'Arrived' : isRecommended ? 'Recommended' : 'Waiting'}
                                            </div>
                                            {isNotified && remainingNoShowMinutes !== null && (
                                                <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">
                                                    <span
                                                        className="h-4 w-4 rounded-full border border-amber-500/60"
                                                        style={{
                                                            background: `conic-gradient(#f59e0b ${progressDeg}deg, rgba(245, 158, 11, 0.15) ${progressDeg}deg 360deg)`
                                                        }}
                                                    />
                                                    <span className="text-[10px] font-semibold text-amber-600">
                                                        {formatCountdown(remainingNoShowSeconds)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs font-medium">
                                        <div className="flex items-center gap-1"><Users size={14} /> {entry.paxCount}</div>
                                        <div className="flex items-center gap-1 text-muted-foreground"><Clock size={14} /> {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</div>
                                    </div>
                                    {!usesTraditionalSeating && (
                                        <div className="space-y-2 pt-2 border-t border-border/50">
                                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                                                Table Allocation
                                            </Label>
                                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                                {fitTables.map(t => (
                                                    <Button key={t.id} size="sm" variant={tableId === t.id ? "default" : "outline"} className="h-8 text-[11px] px-2" onClick={() => setSelectedTables(prev => ({ ...prev, [entry.id]: t.id }))}>
                                                        T{t.id} ({t.max_capacity}P)
                                                    </Button>
                                                ))}
                                                {fitTables.length === 0 && <p className="text-[10px] text-muted-foreground italic">No tables available</p>}
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => handleNotify(entry)}>
                                            <FaWhatsapp size={15} className="mr-1.5 text-green-500" /> Notify
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-9 text-xs" asChild>
                                            <a href={`tel:+91${entry.phone}`}><PhoneCall size={14} className="mr-1.5" /> Call</a>
                                        </Button>
                                    </div>
                                    <div className="flex gap-2">
                                        {isNotified && (
                                            <Button
                                                variant="outline"
                                                className="h-10 font-bold flex-1"
                                                disabled={actionLoading === entry.id}
                                                onClick={() => handleUpdateStatus(entry.id, 'arrived')}
                                            >
                                                {actionLoading === entry.id ? <Loader2 className="animate-spin" size={16} /> : 'Mark Arrived'}
                                            </Button>
                                        )}
                                        <Button
                                            className="h-10 font-bold flex-1"
                                            disabled={((!tableId && !usesTraditionalSeating) || actionLoading === entry.id)}
                                            onClick={() => handleSeatCustomer(entry)}
                                        >
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

            {waitlistSeatingMode === 'manual_seat' && waitlistMeta?.capacity?.softAlert && (
                <Card className="border-amber-500/30 bg-amber-500/5">
                    <CardContent className="p-3 text-sm text-amber-700">
                        Capacity Alert: {waitlistMeta?.capacity?.message}
                    </CardContent>
                </Card>
            )}
            <AnimatePresence>
                {isArrivalScannerOpen && (
                    <QrScanner
                        onClose={() => setIsArrivalScannerOpen(false)}
                        onScanSuccess={handleArrivalScanSuccess}
                    />
                )}
            </AnimatePresence>
            <Dialog
                open={Boolean(scanSeatingEntry)}
                onOpenChange={(open) => {
                    if (!open) {
                        setScanSeatingEntry(null);
                        setScanSelectedTableId('');
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Seat Customer from Token Scan</DialogTitle>
                        <DialogDescription>
                            Select table for {scanSeatingEntry?.name || 'guest'} ({scanSeatingEntry?.paxCount || 0} pax).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                            {allTables
                                .filter((t) => t.state === 'available' && t.max_capacity >= Number(scanSeatingEntry?.paxCount || 1))
                                .sort((a, b) => a.max_capacity - b.max_capacity)
                                .map((t) => (
                                    <Button
                                        key={t.id}
                                        type="button"
                                        size="sm"
                                        variant={scanSelectedTableId === t.id ? 'default' : 'outline'}
                                        onClick={() => setScanSelectedTableId(t.id)}
                                    >
                                        T{t.id} ({t.max_capacity}P)
                                    </Button>
                                ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                setScanSeatingEntry(null);
                                setScanSelectedTableId('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={!scanSeatingEntry || !scanSelectedTableId || actionLoading === scanSeatingEntry?.id}
                            onClick={async () => {
                                if (!scanSeatingEntry || !scanSelectedTableId) return;
                                await seatWaitlistEntry(scanSeatingEntry, scanSelectedTableId, 'scan');
                                setScanSeatingEntry(null);
                                setScanSelectedTableId('');
                            }}
                        >
                            Confirm Seat
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Button
                type="button"
                onClick={() => setIsArrivalScannerOpen(true)}
                className="md:hidden fixed bottom-6 right-4 z-40 h-14 w-14 rounded-full p-0 shadow-2xl"
                aria-label="Scan token QR"
                title="Scan token QR"
            >
                <ScanLine size={22} />
            </Button>
        </div>
    );
};

function BookingsPageContent() {
    const [bookings, setBookings] = useState([]);
    const [waitlistCount, setWaitlistCount] = useState(0);
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
    const [waitlistSeatingMode, setWaitlistSeatingMode] = useState('table_assign');
    const [waitlistManualCapacity, setWaitlistManualCapacity] = useState(40);
    const [waitlistNoShowTimeoutMinutes, setWaitlistNoShowTimeoutMinutes] = useState(10);
    const [waitlistConfigLoading, setWaitlistConfigLoading] = useState(false);
    const [isWaitlistQrOpen, setIsWaitlistQrOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isWaitlistAnalyticsOpen, setIsWaitlistAnalyticsOpen] = useState(false);
    const [isWaitlistSettingsOpen, setIsWaitlistSettingsOpen] = useState(false);
    const [capacityDraft, setCapacityDraft] = useState('40');
    const [noShowTimeoutDraft, setNoShowTimeoutDraft] = useState('10');
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
                        setWaitlistSeatingMode(
                            bData.waitlistSeatingMode === 'manual_seat' ? 'manual_seat' : 'table_assign'
                        );
                        setWaitlistManualCapacity(Math.max(1, Number(bData.waitlistManualCapacity || 40)));
                        setWaitlistNoShowTimeoutMinutes(Math.max(1, Number(bData.waitlistNoShowTimeoutMinutes || 10)));
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

    useEffect(() => {
        setCapacityDraft(String(waitlistManualCapacity || 40));
    }, [waitlistManualCapacity, isWaitlistSettingsOpen]);

    useEffect(() => {
        setNoShowTimeoutDraft(String(waitlistNoShowTimeoutMinutes || 10));
    }, [waitlistNoShowTimeoutMinutes, isWaitlistSettingsOpen]);

    const getSettingsApiUrl = () => {
        const url = new URL('/api/owner/settings', window.location.origin);
        if (impersonatedOwnerId) url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        else if (employeeOfOwnerId) url.searchParams.append('employee_of', employeeOfOwnerId);
        return url.toString();
    };

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
            const res = await fetch(getSettingsApiUrl(), {
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

    const handleWaitlistSeatingModeChange = async (mode) => {
        const nextMode = mode === 'manual_seat' ? 'manual_seat' : 'table_assign';
        setWaitlistConfigLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch(getSettingsApiUrl(), {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ waitlistSeatingMode: nextMode })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to update seating mode');
            setWaitlistSeatingMode(nextMode);
            setBusinessInfo((prev) => prev ? { ...prev, waitlistSeatingMode: nextMode } : prev);
            toast({ title: "Saved", description: `Waitlist seating mode set to ${nextMode === 'manual_seat' ? 'Manual' : 'Table Assignment'}.` });
        } catch (err) {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
        } finally {
            setWaitlistConfigLoading(false);
        }
    };

    const handleWaitlistManualCapacitySave = async (capacityRaw) => {
        const parsedCapacity = Number.parseInt(String(capacityRaw), 10);
        if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 500) {
            toast({ title: "Invalid Capacity", description: "Enter a capacity between 1 and 500.", variant: "destructive" });
            return;
        }

        setWaitlistConfigLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch(getSettingsApiUrl(), {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ waitlistManualCapacity: parsedCapacity })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to update manual capacity');
            setWaitlistManualCapacity(parsedCapacity);
            setBusinessInfo((prev) => prev ? { ...prev, waitlistManualCapacity: parsedCapacity } : prev);
            toast({ title: "Saved", description: `Manual seating capacity updated to ${parsedCapacity}.` });
        } catch (err) {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
        } finally {
            setWaitlistConfigLoading(false);
        }
    };

    const handleWaitlistNoShowTimeoutSave = async (timeoutRaw) => {
        const parsedTimeout = Number.parseInt(String(timeoutRaw), 10);
        if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1 || parsedTimeout > 120) {
            toast({ title: "Invalid Timeout", description: "Enter timeout between 1 and 120 minutes.", variant: "destructive" });
            return;
        }

        setWaitlistConfigLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch(getSettingsApiUrl(), {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ waitlistNoShowTimeoutMinutes: parsedTimeout })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to update no-show timeout');
            setWaitlistNoShowTimeoutMinutes(parsedTimeout);
            setBusinessInfo((prev) => prev ? { ...prev, waitlistNoShowTimeoutMinutes: parsedTimeout } : prev);
            toast({ title: "Saved", description: `No-show timeout set to ${parsedTimeout} minutes.` });
        } catch (err) {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
        } finally {
            setWaitlistConfigLoading(false);
        }
    };

    const handleResetDailyWaitlistCounter = async () => {
        setWaitlistConfigLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const res = await fetch(getSettingsApiUrl(), {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetWaitlistTokenCounter: true })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to reset waitlist counter');
            setBusinessInfo((prev) => prev ? {
                ...prev,
                waitlistTokenCounter: data.waitlistTokenCounter,
                waitlistTokenCounterDate: data.waitlistTokenCounterDate,
            } : prev);
            await fetchBookings(true);
            toast({ title: 'Counter Reset', description: 'Waitlist token counter reset to start for today.' });
        } catch (err) {
            toast({ title: 'Failed', description: err.message, variant: 'destructive' });
        } finally {
            setWaitlistConfigLoading(false);
        }
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 md:p-6 space-y-3 md:space-y-6">
            <header className="flex flex-row justify-between items-center gap-2">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold tracking-tight leading-tight">Bookings & Waitlist</h1>
                    <p className="hidden md:block text-muted-foreground mt-1 text-sm md:text-base">Manage your table reservations and walk-in waitlist.</p>
                </div>
                <div className="flex gap-1.5 md:gap-2">
                    <Button onClick={() => setIsHistoryOpen(true)} variant="outline" className="h-8 w-8 px-0 md:h-10 md:w-auto md:px-3 flex items-center justify-center md:gap-2">
                        <History size={16} /> <span className="hidden md:inline">History</span>
                    </Button>
                    <Button onClick={() => setIsWaitlistSettingsOpen(true)} variant="outline" className="h-8 w-8 px-0 md:h-10 md:w-auto md:px-3 flex items-center justify-center md:gap-2" disabled={!businessInfo}>
                        <Settings size={16} /> <span className="hidden md:inline">Settings</span>
                    </Button>
                    <Button onClick={() => fetchBookings(true)} variant="outline" disabled={loading} className="h-8 w-8 px-0 md:h-10 md:w-auto md:px-3 flex items-center justify-center">
                        <RefreshCw size={16} className={loading ? "animate-spin" : "md:mr-2"} /> <span className="hidden md:inline">Refresh</span>
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
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4 mb-3 md:mb-6">
                    <TabsList className="bg-muted/50 p-1 self-start w-full md:w-auto grid grid-cols-2 md:inline-flex h-10 md:h-11">
                        <TabsTrigger value="waitlist" className="flex items-center gap-2 font-bold text-xs md:text-sm"><ListOrdered size={16} className="hidden md:block" /> Live Waitlist ({waitlistCount})</TabsTrigger>
                        <TabsTrigger value="upcoming" className="flex items-center gap-2 font-bold text-xs md:text-sm"><CalendarClock size={16} className="hidden md:block" /> {upcoming ? `Upcoming (${upcoming.length})` : 'Upcoming'}</TabsTrigger>
                    </TabsList>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 md:h-5 md:w-5" />
                        <input type="text" placeholder="Search by name or phone..." className="w-full bg-muted/30 border border-border rounded-xl pl-9 md:pl-10 pr-4 py-1.5 md:py-2 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all h-9 md:h-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                </div>

                <TabsContent value="waitlist">
                    <WaitlistManagement
                        restaurant={businessInfo}
                        impersonatedOwnerId={impersonatedOwnerId}
                        employeeOfOwnerId={employeeOfOwnerId}
                        waitlistSeatingMode={waitlistSeatingMode}
                        onWaitlistUpdate={(entries) => setWaitlistCount(entries.length)}
                    />
                </TabsContent>

                <TabsContent value="upcoming">
                    <div className="space-y-3 md:space-y-6">
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

            <Dialog open={isWaitlistSettingsOpen} onOpenChange={setIsWaitlistSettingsOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings size={18} /> Waitlist Settings
                        </DialogTitle>
                        <DialogDescription>
                            Configure live waitlist behavior independently from dine-in QR ordering.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <Label className="font-semibold">Waitlist Status</Label>
                                <p className="text-xs text-muted-foreground mt-1">Enable or disable public waitlist joins.</p>
                            </div>
                            <Switch checked={isWaitlistEnabled} disabled={isWaitlistLoading} onCheckedChange={handleToggleWaitlist} />
                        </div>

                        <div className="space-y-2">
                            <Label className="font-semibold">Seating Mode</Label>
                            <div className="inline-flex rounded-lg border border-border overflow-hidden">
                                <Button
                                    type="button"
                                    variant={waitlistSeatingMode === 'table_assign' ? 'default' : 'ghost'}
                                    className="rounded-none"
                                    disabled={waitlistConfigLoading}
                                    onClick={() => handleWaitlistSeatingModeChange('table_assign')}
                                >
                                    Table
                                </Button>
                                <Button
                                    type="button"
                                    variant={waitlistSeatingMode === 'manual_seat' ? 'default' : 'ghost'}
                                    className="rounded-none"
                                    disabled={waitlistConfigLoading}
                                    onClick={() => handleWaitlistSeatingModeChange('manual_seat')}
                                >
                                    Manual
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="font-semibold">Manual Capacity</Label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={500}
                                    className="w-28 bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    value={capacityDraft}
                                    onChange={(e) => setCapacityDraft(e.target.value)}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={waitlistConfigLoading}
                                    onClick={() => handleWaitlistManualCapacitySave(capacityDraft)}
                                >
                                    <Save size={14} className="mr-2" /> Save
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Used for manual mode soft capacity alerts.</p>
                        </div>

                        <div className="space-y-2">
                            <Label className="font-semibold">No-show Lapse (Minutes)</Label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={120}
                                    className="w-28 bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    value={noShowTimeoutDraft}
                                    onChange={(e) => setNoShowTimeoutDraft(e.target.value)}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={waitlistConfigLoading}
                                    onClick={() => handleWaitlistNoShowTimeoutSave(noShowTimeoutDraft)}
                                >
                                    <Save size={14} className="mr-2" /> Save
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Used for auto no-show expiry after notify.</p>
                        </div>

                        <div className="pt-1">
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={() => setIsWaitlistQrOpen(true)} disabled={!isWaitlistEnabled}>
                                    <QrCode size={15} className="mr-2" /> Get QR Code
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={waitlistConfigLoading}
                                    onClick={handleResetDailyWaitlistCounter}
                                >
                                    {waitlistConfigLoading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
                                    Reset Daily Count
                                </Button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline">Close</Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <WaitlistQrModal isOpen={isWaitlistQrOpen} onClose={() => setIsWaitlistQrOpen(false)} restaurant={businessInfo} />
            <HistoryModal
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                bookingsHistory={past}
                restaurant={businessInfo}
                impersonatedOwnerId={impersonatedOwnerId}
                employeeOfOwnerId={employeeOfOwnerId}
                onOpenAnalytics={() => setIsWaitlistAnalyticsOpen(true)}
            />
            <WaitlistAnalyticsModal
                isOpen={isWaitlistAnalyticsOpen}
                onClose={() => setIsWaitlistAnalyticsOpen(false)}
                impersonatedOwnerId={impersonatedOwnerId}
                employeeOfOwnerId={employeeOfOwnerId}
            />
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

