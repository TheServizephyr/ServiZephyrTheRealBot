'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ClipboardList, 
  CheckCircle2, 
  XCircle, 
  ExternalLink, 
  FileText, 
  Image as ImageIcon, 
  Loader2, 
  Search, 
  Store, 
  Phone, 
  MapPin, 
  Clock,
  ArrowLeft,
  X,
  Check
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import InfoDialog from '@/components/InfoDialog';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function OnboardingAdminPage() {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('pending'); // default to pending for review action
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // Review Modal State
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Editable overrides
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const [editLat, setEditLat] = useState(0);
    const [editLng, setEditLng] = useState(0);
    const [editPlaceId, setEditPlaceId] = useState('');
    const [editCuisines, setEditCuisines] = useState([]);
    const [editCity, setEditCity] = useState('delhi');
    const [customCity, setCustomCity] = useState('');

    const popularCities = [
        { value: 'delhi', label: 'Delhi' },
        { value: 'noida', label: 'Noida' },
        { value: 'gurugram', label: 'Gurugram' },
        { value: 'ghaziabad', label: 'Ghaziabad' },
        { value: 'banaras', label: 'Banaras' },
        { value: 'custom', label: 'Custom City...' }
    ];

    const cuisineOptions = ['North Indian', 'Chinese', 'South Indian', 'Fast Food', 'Cafe'];

    const cacheKey = 'admin_onboarding_requests';

    const fetchRequests = async () => {
        setLoading(true);
        try {
            const currentUser = auth.currentUser;
            const headers = {};
            if (currentUser) {
                const idToken = await currentUser.getIdToken();
                headers.Authorization = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/admin/onboard-request', { headers });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.message || 'Failed to fetch onboarding requests');
            }
            const data = await res.json();
            setRequests(data.requests || []);

            // Cache for offline support
            const cachePayload = { ts: Date.now(), data: { requests: data.requests } };
            try {
                localStorage.setItem(cacheKey, JSON.stringify(cachePayload));
            } catch {}
            if (isDesktopApp()) {
                await setOfflineNamespace('admin_onboarding', cacheKey, cachePayload);
            }
        } catch (error) {
            console.error("[Onboarding Admin Page] Error:", error);
            let cached = null;
            try {
                const raw = localStorage.getItem(cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.data) cached = parsed.data;
                }
            } catch {}
            if (!cached && isDesktopApp()) {
                const desktopPayload = await getOfflineNamespace('admin_onboarding', cacheKey, null);
                cached = desktopPayload?.data || null;
            }
            if (cached?.requests) {
                setRequests(cached.requests);
                setInfoDialog({
                    isOpen: true,
                    title: "Offline Cache Active",
                    message: "Could not load live onboarding requests. Cached data is being shown."
                });
            } else {
                setInfoDialog({
                    isOpen: true,
                    title: "Error",
                    message: `Could not load onboarding requests: ${error.message}`
                });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    }, []);

    const openReviewModal = (req) => {
        setSelectedRequest(req);
        setEditName(req.restaurantName || '');
        setEditPhone(req.whatsappNumber || '');
        setEditAddress(req.location?.formattedAddress || '');
        setEditLat(req.location?.latitude || 0);
        setEditLng(req.location?.longitude || 0);
        setEditPlaceId(req.location?.placeId || '');
        setEditCuisines(req.cuisines || []);

        // Guess city or set default
        const lowerAddress = (req.location?.formattedAddress || '').toLowerCase();
        let guessedCity = 'delhi';
        if (lowerAddress.includes('noida')) guessedCity = 'noida';
        else if (lowerAddress.includes('gurugram') || lowerAddress.includes('gurgaon')) guessedCity = 'gurugram';
        else if (lowerAddress.includes('ghaziabad')) guessedCity = 'ghaziabad';
        else if (lowerAddress.includes('banaras') || lowerAddress.includes('varanasi')) guessedCity = 'banaras';
        
        setEditCity(guessedCity);
        setCustomCity('');
    };

    const closeReviewModal = () => {
        setSelectedRequest(null);
    };

    const handleCuisineToggle = (cuisine) => {
        if (editCuisines.includes(cuisine)) {
            setEditCuisines(editCuisines.filter(c => c !== cuisine));
        } else {
            setEditCuisines([...editCuisines, cuisine]);
        }
    };

    const handleProcessRequest = async (action) => {
        if (!selectedRequest) return;
        setIsSubmitting(true);

        try {
            const currentUser = auth.currentUser;
            const headers = { 'Content-Type': 'application/json' };
            if (currentUser) {
                const idToken = await currentUser.getIdToken();
                headers.Authorization = `Bearer ${idToken}`;
            }

            const payload = {
                requestId: selectedRequest.id,
                action,
                city: editCity === 'custom' ? customCity : editCity,
                restaurantName: editName,
                whatsappNumber: editPhone,
                cuisines: editCuisines,
                location: {
                    formattedAddress: editAddress,
                    latitude: Number(editLat),
                    longitude: Number(editLng),
                    placeId: editPlaceId
                }
            };

            const res = await fetch('/api/admin/onboard-request', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Failed to ${action} onboarding request.`);
            }

            setInfoDialog({
                isOpen: true,
                title: "Success",
                message: action === 'approve' 
                    ? `Restaurant "${editName}" approved successfully and listing is now LIVE!`
                    : 'Onboarding request rejected.'
            });

            closeReviewModal();
            fetchRequests();

        } catch (error) {
            console.error(`[Onboarding Review] Error ${action}ing:`, error);
            setInfoDialog({
                isOpen: true,
                title: "Processing Failed",
                message: error.message
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filter requests
    const filteredRequests = requests.filter(req => {
        const matchesSearch = 
            (req.restaurantName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (req.whatsappNumber || '').includes(searchTerm);
        
        const matchesTab = activeTab === 'all' || req.status === activeTab;
        return matchesSearch && matchesTab;
    });

    const getStatusBadge = (status) => {
        switch (status) {
            case 'approved':
                return <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/15">Approved</Badge>;
            case 'rejected':
                return <Badge className="bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/15">Rejected</Badge>;
            default:
                return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/15">Pending Review</Badge>;
        }
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ ...infoDialog, isOpen: false })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight">Restaurant Onboarding Review</h1>
                    <p className="text-muted-foreground mt-1">Verify details, customize locations, and approve self-onboarded restaurants.</p>
                    <div className="mt-2">
                        <OfflineDesktopStatus />
                    </div>
                </div>
                <Button onClick={fetchRequests} disabled={loading} className="gap-2 shrink-0 self-start sm:self-auto">
                    {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                    Refresh Data
                </Button>
            </header>

            {/* Filters and Search Bar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center bg-card p-4 rounded-xl border border-border">
                {/* Search Bar */}
                <div className="relative flex-grow max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by restaurant name or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-background border border-input focus:border-primary focus:ring-1 focus:ring-primary rounded-lg text-sm focus:outline-none transition-all text-foreground"
                    />
                </div>

                {/* Tabs filter */}
                <div className="flex bg-muted p-1 rounded-lg border border-border/80 shrink-0 self-start md:self-auto">
                    {['pending', 'approved', 'rejected', 'all'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold capitalize transition-all ${
                                activeTab === tab
                                    ? 'bg-card text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {tab === 'pending' ? 'Pending Review' : tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Listings Grid/Table */}
            <Card>
                <CardHeader className="pb-3 border-b">
                    <CardTitle className="text-lg">Applications ({filteredRequests.length})</CardTitle>
                    <CardDescription>Click on any request to view menus and approve/reject.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Restaurant Name</TableHead>
                                    <TableHead>WhatsApp Phone</TableHead>
                                    <TableHead>Location Address</TableHead>
                                    <TableHead>Submission Date</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="w-[100px] text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(4)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={6} className="p-4">
                                                <div className="h-10 bg-muted rounded-md animate-pulse"></div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : filteredRequests.length > 0 ? (
                                    filteredRequests.map((req) => (
                                        <TableRow 
                                            key={req.id} 
                                            onClick={() => openReviewModal(req)}
                                            className="cursor-pointer hover:bg-muted/40 transition-colors"
                                        >
                                            <TableCell className="font-bold flex items-center gap-2">
                                                <Store size={15} className="text-muted-foreground shrink-0" />
                                                {req.restaurantName}
                                            </TableCell>
                                            <TableCell className="font-medium whitespace-nowrap">
                                                <Phone size={13} className="inline mr-1.5 text-muted-foreground" />
                                                {req.whatsappNumber}
                                            </TableCell>
                                            <TableCell className="max-w-xs truncate text-muted-foreground">
                                                {req.location?.formattedAddress || 'N/A'}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                <Clock size={13} className="inline mr-1.5 text-muted-foreground" />
                                                {req.createdAt ? formatDistanceToNow(new Date(req.createdAt), { addSuffix: true }) : 'N/A'}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(req.status)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button size="sm" variant="outline" className="text-xs h-8">
                                                    Review
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center p-16 text-muted-foreground">
                                            <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/50" />
                                            <p className="mt-4 font-bold text-base">No onboarding requests found</p>
                                            <p className="text-sm">Requests matching your filter will appear here.</p>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* REVIEW MODAL / DRAWER */}
            <AnimatePresence>
                {selectedRequest && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 relative shadow-2xl space-y-6"
                        >
                            {/* Modal Header */}
                            <div className="flex items-start justify-between border-b pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                        <ClipboardList className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold tracking-tight">Review Merchant Request</h2>
                                        <p className="text-xs text-muted-foreground mt-0.5">Application ID: {selectedRequest.id}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={closeReviewModal}
                                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="space-y-4 text-sm">
                                {/* Status Alert Banner if processed */}
                                {selectedRequest.status !== 'pending' && (
                                    <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                                        selectedRequest.status === 'approved' 
                                            ? 'bg-emerald-500/5 border-emerald-500/25 text-emerald-500' 
                                            : 'bg-rose-500/5 border-rose-500/25 text-rose-500'
                                    }`}>
                                        {selectedRequest.status === 'approved' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                                        <div>
                                            <p className="font-bold">Request Already Processed</p>
                                            <p className="text-xs opacity-90 mt-0.5">
                                                This request was {selectedRequest.status} on {
                                                    selectedRequest.status === 'approved' 
                                                        ? new Date(selectedRequest.approvedAt).toLocaleString() 
                                                        : new Date(selectedRequest.rejectedAt).toLocaleString()
                                                }
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {/* 1. Restaurant Name (Editable) */}
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Restaurant Name</label>
                                        <input
                                            type="text"
                                            value={editName}
                                            disabled={selectedRequest.status !== 'pending'}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl focus:border-primary focus:ring-1 focus:ring-primary text-sm focus:outline-none transition-all"
                                        />
                                    </div>

                                    {/* 2. WhatsApp Number (Editable) */}
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">WhatsApp Number</label>
                                        <input
                                            type="tel"
                                            value={editPhone}
                                            disabled={selectedRequest.status !== 'pending'}
                                            onChange={(e) => setEditPhone(e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl focus:border-primary focus:ring-1 focus:ring-primary text-sm focus:outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                {/* 3. Google Maps Location Details (Editable) */}
                                <div className="border p-4 rounded-xl space-y-3 bg-muted/20">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">📍 Map Geocoding Details</span>
                                        <span className="text-[10px] text-muted-foreground font-mono">Place ID: {editPlaceId}</span>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-[11px] font-bold text-muted-foreground mb-1">Formatted Address</label>
                                        <textarea
                                            value={editAddress}
                                            disabled={selectedRequest.status !== 'pending'}
                                            onChange={(e) => setEditAddress(e.target.value)}
                                            rows={2}
                                            className="w-full px-3 py-2 bg-background border border-input rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-xs focus:outline-none transition-all resize-none"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-bold text-muted-foreground mb-1">Latitude</label>
                                            <input
                                                type="number"
                                                step="any"
                                                value={editLat}
                                                disabled={selectedRequest.status !== 'pending'}
                                                onChange={(e) => setEditLat(e.target.value)}
                                                className="w-full px-3 py-2 bg-background border border-input rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-xs focus:outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-muted-foreground mb-1">Longitude</label>
                                            <input
                                                type="number"
                                                step="any"
                                                value={editLng}
                                                disabled={selectedRequest.status !== 'pending'}
                                                onChange={(e) => setEditLng(e.target.value)}
                                                className="w-full px-3 py-2 bg-background border border-input rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-xs focus:outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 4. City Allocation (Critical for Location Filters) */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Assign Target City</label>
                                        <select
                                            value={editCity}
                                            disabled={selectedRequest.status !== 'pending'}
                                            onChange={(e) => setEditCity(e.target.value)}
                                            className="w-full px-3 py-2.5 bg-background border border-input rounded-xl focus:border-primary focus:ring-1 focus:ring-primary text-sm focus:outline-none transition-all appearance-none"
                                        >
                                            {popularCities.map(city => (
                                                <option key={city.value} value={city.value}>{city.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {editCity === 'custom' && (
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Custom City Name (lowercase)</label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="e.g. banaras, bangalore"
                                                value={customCity}
                                                onChange={(e) => setCustomCity(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                                                className="w-full px-3.5 py-2 bg-background border border-input rounded-xl focus:border-primary focus:ring-1 focus:ring-primary text-sm focus:outline-none transition-all"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 5. Cuisines Selection */}
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Verified Cuisines</label>
                                    <div className="flex flex-wrap gap-2">
                                        {cuisineOptions.map(cuisine => {
                                            const active = editCuisines.includes(cuisine);
                                            return (
                                                <button
                                                    key={cuisine}
                                                    type="button"
                                                    disabled={selectedRequest.status !== 'pending'}
                                                    onClick={() => handleCuisineToggle(cuisine)}
                                                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                                        active 
                                                            ? 'bg-primary/10 border-primary text-primary font-bold' 
                                                            : 'bg-background hover:bg-muted text-muted-foreground border-border'
                                                    }`}
                                                >
                                                    {cuisine}
                                                    {active && <Check size={12} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 6. Menu Attachments Review */}
                                <div className="border border-border/70 rounded-xl overflow-hidden">
                                    <div className="bg-muted/40 p-3 border-b border-border/70">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                            <FileText size={14} /> Submitted Menu Attachments ({selectedRequest.menuUrls?.length || 0})
                                        </span>
                                    </div>
                                    <div className="p-4 bg-muted/10 space-y-2.5 max-h-48 overflow-y-auto">
                                        {selectedRequest.menuUrls && selectedRequest.menuUrls.length > 0 ? (
                                            selectedRequest.menuUrls.map((url, idx) => {
                                                const isPdf = url.toLowerCase().endsWith('.pdf') || url.includes('/onboarding_assets/menus/') && !url.includes('.jpg') && !url.includes('.png') && !url.includes('.jpeg');
                                                return (
                                                    <a
                                                        key={idx}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center justify-between p-2.5 bg-background border rounded-lg hover:border-primary hover:text-primary transition-all text-xs font-semibold"
                                                    >
                                                        <div className="flex items-center gap-2 overflow-hidden mr-2">
                                                            {isPdf ? (
                                                                <FileText className="text-red-500 w-4 h-4 shrink-0" />
                                                            ) : (
                                                                <ImageIcon className="text-blue-500 w-4 h-4 shrink-0" />
                                                            )}
                                                            <span className="truncate max-w-xs">{url.split('/').pop() || `Menu File ${idx + 1}`}</span>
                                                        </div>
                                                        <span className="text-[10px] bg-muted px-2 py-0.5 rounded flex items-center gap-1">
                                                            Open <ExternalLink size={10} />
                                                        </span>
                                                    </a>
                                                );
                                            })
                                        ) : (
                                            <p className="text-xs text-muted-foreground py-2">No menu uploads available.</p>
                                        )}
                                    </div>
                                </div>

                                {/* Marketing Referral */}
                                <div className="text-xs text-muted-foreground">
                                    <span>Referral Source: <strong>{selectedRequest.referralSource || 'None'}</strong></span>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            {selectedRequest.status === 'pending' ? (
                                <div className="flex items-center justify-end gap-3 border-t pt-4">
                                    <Button
                                        variant="outline"
                                        disabled={isSubmitting}
                                        onClick={() => handleProcessRequest('reject')}
                                        className="border-rose-500/20 text-rose-500 hover:bg-rose-500/5 font-semibold text-xs py-2 px-4"
                                    >
                                        Reject Application
                                    </Button>
                                    <Button
                                        disabled={isSubmitting}
                                        onClick={() => handleProcessRequest('approve')}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-5 gap-2"
                                    >
                                        {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                        Approve & Go Live
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex justify-end border-t pt-4">
                                    <Button variant="outline" onClick={closeReviewModal}>
                                        Close Details
                                    </Button>
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
