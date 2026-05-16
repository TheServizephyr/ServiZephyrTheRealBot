'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { BarChart3, BriefcaseBusiness, IndianRupee, Loader2, MapPin, MessageSquareText, Phone, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import InfoDialog from '@/components/InfoDialog';

const defaultPartner = {
  name: '',
  phone: '',
  email: '',
  assignedArea: '',
  assignedZones: '',
  status: 'training',
  trainingStatus: 'not_started',
  notes: '',
};

const statusLabels = {
  training: 'Training',
  active: 'Active',
  inactive: 'Inactive',
};

const trainingLabels = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  certified: 'Certified',
};

const pitchStatusLabels = {
  interested: 'Interested',
  follow_up: 'Follow-Up',
  demo_scheduled: 'Demo',
  rejected: 'Rejected',
  onboarded: 'Onboarded',
  not_available: 'Not Available',
};

const paymentStatusLabels = {
  pending: 'Payment Pending',
  paid: 'Payment Received',
};

const pitchStatusTone = {
  interested: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300',
  follow_up: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300',
  demo_scheduled: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-300',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300',
  onboarded: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/50 dark:text-green-300',
  not_available: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
};

const paymentTone = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300',
};

const PITCH_PAGE_SIZE = 25;

const formatCurrency = (value) => (
  Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  })
);

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function ToneBadge({ children, className }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function DetailTile({ label, value, children }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      {children || <p className="mt-1 font-semibold">{value || 'N/A'}</p>}
    </div>
  );
}

export default function AdminSalesPage() {
  const [partners, setPartners] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [pitchSearch, setPitchSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState('all');
  const [pitchStatusFilter, setPitchStatusFilter] = useState('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [pitchPage, setPitchPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [selectedPitch, setSelectedPitch] = useState(null);
  const [partnerForm, setPartnerForm] = useState(defaultPartner);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const getHeaders = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Authentication required.');
    const token = await currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const loadSales = async () => {
    setLoading(true);
    try {
      const headers = await getHeaders();
      const response = await fetch('/api/admin/sales/partners', { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load sales operations.');
      setPartners(data.partners || []);
      setPitches(data.pitches || []);
      setCounts(data.counts || {});
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPartners = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return partners;
    return partners.filter((partner) => [
      partner.name,
      partner.phone,
      partner.email,
      partner.assignedArea,
      ...(partner.assignedZones || []),
    ].join(' ').toLowerCase().includes(query));
  }, [partners, search]);

  const partnerById = useMemo(() => (
    new Map(partners.map((partner) => [partner.id, partner]))
  ), [partners]);

  const partnerStats = useMemo(() => {
    const stats = new Map(partners.map((partner) => [partner.id, {
      ...partner,
      pitches: 0,
      onboarded: 0,
      paid: 0,
      monthlyCommission: 0,
      latestPitchAt: null,
    }]));

    pitches.forEach((pitch) => {
      const current = stats.get(pitch.partnerId);
      if (!current) return;
      current.pitches += 1;
      if (pitch.pitchStatus === 'onboarded') current.onboarded += 1;
      if (pitch.commissionEligible) current.paid += 1;
      current.monthlyCommission += Number(pitch.monthlyCommissionAmount || 0);
      const pitchDate = pitch.pitchDate || pitch.createdAt;
      if (!current.latestPitchAt || new Date(pitchDate || 0) > new Date(current.latestPitchAt || 0)) {
        current.latestPitchAt = pitchDate;
      }
    });

    return Array.from(stats.values()).sort((a, b) => b.pitches - a.pitches);
  }, [partners, pitches]);

  const filteredPitches = useMemo(() => {
    const query = pitchSearch.trim().toLowerCase();
    return pitches.filter((pitch) => {
      if (selectedPartnerId !== 'all' && pitch.partnerId !== selectedPartnerId) return false;
      if (pitchStatusFilter !== 'all' && pitch.pitchStatus !== pitchStatusFilter) return false;
      if (paymentStatusFilter === 'paid' && pitch.paymentStatus !== 'paid') return false;
      if (paymentStatusFilter === 'pending' && pitch.paymentStatus !== 'pending') return false;
      if (paymentStatusFilter === 'commission_eligible' && !pitch.commissionEligible) return false;
      if (!query) return true;
      const partner = partnerById.get(pitch.partnerId);
      return [
        pitch.partnerName,
        partner?.employeeId,
        partner?.phone,
        partner?.assignedArea,
        pitch.restaurantName,
        pitch.ownerName,
        pitch.ownerPhone,
        pitch.location,
        pitch.notes,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [partnerById, paymentStatusFilter, pitchSearch, pitchStatusFilter, pitches, selectedPartnerId]);

  useEffect(() => {
    setPitchPage(1);
  }, [paymentStatusFilter, pitchSearch, pitchStatusFilter, selectedPartnerId]);

  const pitchPageCount = Math.max(1, Math.ceil(filteredPitches.length / PITCH_PAGE_SIZE));
  const currentPitchPage = Math.min(pitchPage, pitchPageCount);
  const visiblePitches = filteredPitches.slice((currentPitchPage - 1) * PITCH_PAGE_SIZE, currentPitchPage * PITCH_PAGE_SIZE);
  const selectedPitchPartner = selectedPitch ? partnerById.get(selectedPitch.partnerId) : null;

  const openCreate = () => {
    setEditingPartner(null);
    setPartnerForm(defaultPartner);
    setDialogOpen(true);
  };

  const openEdit = (partner) => {
    setEditingPartner(partner);
    setPartnerForm({
      name: partner.name || '',
      phone: partner.phone || '',
      email: partner.email || '',
      assignedArea: partner.assignedArea || '',
      assignedZones: (partner.assignedZones || []).join(', '),
      status: partner.status || 'training',
      trainingStatus: partner.trainingStatus || 'not_started',
      notes: partner.notes || '',
    });
    setDialogOpen(true);
  };

  const updatePartnerForm = (field, value) => setPartnerForm((prev) => ({ ...prev, [field]: value }));

  const savePartner = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const headers = await getHeaders();
      const endpoint = editingPartner ? `/api/admin/sales/partners/${editingPartner.id}` : '/api/admin/sales/partners';
      const response = await fetch(endpoint, {
        method: editingPartner ? 'PATCH' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(partnerForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save sales partner.');
      setDialogOpen(false);
      setInfoDialog({ isOpen: true, title: 'Saved', message: editingPartner ? 'Sales partner updated.' : 'Sales partner created.' });
      await loadSales();
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales Operations</h1>
          <p className="text-muted-foreground">Manage sales partners, pitch activity, and onboarding progress.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadSales}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New Partner</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><Users className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Partners</p><p className="text-2xl font-bold">{counts.partners || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Active</p><p className="text-2xl font-bold">{counts.activePartners || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BarChart3 className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Pitches</p><p className="text-2xl font-bold">{counts.totalPitches || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><IndianRupee className="h-8 w-8 text-green-500" /><div><p className="text-sm text-muted-foreground">Monthly Commission</p><p className="text-2xl font-bold">{formatCurrency(counts.monthlyCommission || 0)}</p><p className="text-xs text-muted-foreground">{counts.paidOnboarded || 0} paid onboarded</p></div></CardContent></Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Sales Partners</CardTitle>
          <div className="relative md:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search partners..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading...</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Employee ID</TableHead><TableHead>Area</TableHead><TableHead>Status</TableHead><TableHead>Training</TableHead><TableHead>Pitches</TableHead><TableHead>Onboarded</TableHead><TableHead>Commission</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredPartners.length === 0 ? <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No sales partners found.</TableCell></TableRow> : filteredPartners.map((partner) => {
                  const stats = partnerStats.find((entry) => entry.id === partner.id) || partner;
                  return (
                  <TableRow key={partner.id}>
                    <TableCell><div className="font-semibold">{partner.name}</div><div className="text-sm text-muted-foreground">{partner.phone} {partner.email ? `· ${partner.email}` : ''}</div></TableCell>
                    <TableCell><Badge variant="outline">{partner.employeeId || 'Not generated'}</Badge></TableCell>
                    <TableCell><div>{partner.assignedArea}</div><div className="text-xs text-muted-foreground">{(partner.assignedZones || []).join(', ')}</div></TableCell>
                    <TableCell><Badge variant={partner.status === 'active' ? 'default' : 'secondary'}>{statusLabels[partner.status] || partner.status}</Badge></TableCell>
                    <TableCell>{trainingLabels[partner.trainingStatus] || partner.trainingStatus}</TableCell>
                    <TableCell><div className="font-semibold">{stats.pitches || 0}</div><div className="text-xs text-muted-foreground">latest {formatDate(stats.latestPitchAt)}</div></TableCell>
                    <TableCell><div className="font-semibold">{stats.onboarded || 0}</div><div className="text-xs text-muted-foreground">{stats.paid || 0} paid</div></TableCell>
                    <TableCell>{formatCurrency(stats.monthlyCommission || 0)}/mo</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => openEdit(partner)}>Edit</Button></TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Pitch Review Console</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Compact review table for salesman, restaurant, notes, payment, and commission.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{filteredPitches.length} records</Badge>
              <Badge variant="outline">25 per page</Badge>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_220px_220px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={pitchSearch} onChange={(event) => setPitchSearch(event.target.value)} placeholder="Search restaurant, salesman, phone, area, notes..." className="pl-9" />
            </div>
            <select value={selectedPartnerId} onChange={(event) => setSelectedPartnerId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">All salesmen</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
            <select value={pitchStatusFilter} onChange={(event) => setPitchStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">All pitch statuses</option>
              {Object.entries(pitchStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">All payments</option>
              <option value="pending">Payment pending</option>
              <option value="paid">Payment received</option>
              <option value="commission_eligible">Commission eligible</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredPitches.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No pitch activity found.</div>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border">
                <div className="max-h-[640px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                      <TableRow>
                        <TableHead className="min-w-[230px]">Restaurant / Owner</TableHead>
                        <TableHead className="min-w-[210px]">Salesman</TableHead>
                        <TableHead className="min-w-[185px]">Status</TableHead>
                        <TableHead className="min-w-[150px]">Payment</TableHead>
                        <TableHead className="min-w-[135px]">Monthly</TableHead>
                        <TableHead className="min-w-[135px]">Commission</TableHead>
                        <TableHead className="min-w-[260px]"><span className="inline-flex items-center gap-2"><MessageSquareText className="h-4 w-4" />Notes</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visiblePitches.map((pitch) => {
                        const partner = partnerById.get(pitch.partnerId);
                        return (
                          <TableRow
                            key={pitch.id}
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer align-top transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                            onClick={() => setSelectedPitch(pitch)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedPitch(pitch);
                              }
                            }}
                          >
                            <TableCell className="py-3">
                              <div className="font-semibold">{pitch.restaurantName}</div>
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" />{pitch.location || 'Location N/A'}</div>
                              <div className="mt-2 text-sm">{pitch.ownerName || 'Owner N/A'}</div>
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" />{pitch.ownerPhone || 'Phone N/A'}</div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="font-semibold">{pitch.partnerName || partner?.name || 'Unassigned'}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{partner?.employeeId || 'No employee ID'}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{partner?.assignedArea || 'No area'}</div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="flex flex-col items-start gap-1.5">
                                <ToneBadge className={pitchStatusTone[pitch.pitchStatus] || pitchStatusTone.follow_up}>{pitchStatusLabels[pitch.pitchStatus] || pitch.pitchStatus}</ToneBadge>
                                <ToneBadge className={pitch.onboardingStatus === 'verified' ? pitchStatusTone.onboarded : pitchStatusTone.demo_scheduled}>{pitch.onboardingStatus === 'verified' ? 'Verified' : 'In Progress'}</ToneBadge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">{formatDate(pitch.pitchDate)}</div>
                            </TableCell>
                            <TableCell className="py-3">
                              {pitch.pitchStatus === 'onboarded' ? (
                                <ToneBadge className={paymentTone[pitch.paymentStatus] || paymentTone.pending}>{paymentStatusLabels[pitch.paymentStatus] || pitch.paymentStatus}</ToneBadge>
                              ) : (
                                <span className="text-sm text-muted-foreground">N/A</span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 font-semibold">{pitch.pitchStatus === 'onboarded' ? `${formatCurrency(pitch.monthlySubscriptionAmount)}/mo` : 'N/A'}</TableCell>
                            <TableCell className="py-3 font-semibold">{formatCurrency(pitch.monthlyCommissionAmount || 0)}/mo</TableCell>
                            <TableCell className="py-3">
                              <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-sm leading-relaxed" title={pitch.notes || ''}>
                                {pitch.notes || 'No notes added.'}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>Showing {(currentPitchPage - 1) * PITCH_PAGE_SIZE + 1}-{Math.min(currentPitchPage * PITCH_PAGE_SIZE, filteredPitches.length)} of {filteredPitches.length}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPitchPage <= 1} onClick={() => setPitchPage((page) => Math.max(1, page - 1))}>Previous</Button>
                  <span>Page {currentPitchPage} of {pitchPageCount}</span>
                  <Button variant="outline" size="sm" disabled={currentPitchPage >= pitchPageCount} onClick={() => setPitchPage((page) => Math.min(pitchPageCount, page + 1))}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedPitch)} onOpenChange={(open) => {
        if (!open) setSelectedPitch(null);
      }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          {selectedPitch ? (
            <>
              <DialogHeader>
                <div className="flex flex-col gap-3 pr-8 md:flex-row md:items-start md:justify-between">
                  <div>
                    <DialogTitle className="text-2xl">{selectedPitch.restaurantName}</DialogTitle>
                    <DialogDescription className="mt-1 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />{selectedPitch.location || 'Location N/A'}
                    </DialogDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ToneBadge className={pitchStatusTone[selectedPitch.pitchStatus] || pitchStatusTone.follow_up}>{pitchStatusLabels[selectedPitch.pitchStatus] || selectedPitch.pitchStatus}</ToneBadge>
                    <ToneBadge className={selectedPitch.onboardingStatus === 'verified' ? pitchStatusTone.onboarded : pitchStatusTone.demo_scheduled}>{selectedPitch.onboardingStatus === 'verified' ? 'Verified' : 'In Progress'}</ToneBadge>
                    {selectedPitch.pitchStatus === 'onboarded' ? <ToneBadge className={paymentTone[selectedPitch.paymentStatus] || paymentTone.pending}>{paymentStatusLabels[selectedPitch.paymentStatus] || selectedPitch.paymentStatus}</ToneBadge> : null}
                  </div>
                </div>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-3">
                <DetailTile label="Monthly Amount" value={selectedPitch.pitchStatus === 'onboarded' ? `${formatCurrency(selectedPitch.monthlySubscriptionAmount)}/mo` : 'N/A'} />
                <DetailTile label="Commission" value={`${formatCurrency(selectedPitch.monthlyCommissionAmount || 0)}/mo`} />
                <DetailTile label="Commission Eligible" value={selectedPitch.commissionEligible ? 'Yes' : 'No'} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="font-semibold">Restaurant & Owner</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailTile label="Restaurant" value={selectedPitch.restaurantName} />
                    <DetailTile label="Location" value={selectedPitch.location} />
                    <DetailTile label="Owner Name" value={selectedPitch.ownerName || 'Owner N/A'} />
                    <DetailTile label="Owner Phone" value={selectedPitch.ownerPhone || 'Phone N/A'} />
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold">Salesman</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailTile label="Name" value={selectedPitch.partnerName || selectedPitchPartner?.name || 'Unassigned'} />
                    <DetailTile label="Employee ID" value={selectedPitchPartner?.employeeId || 'No employee ID'} />
                    <DetailTile label="Phone" value={selectedPitchPartner?.phone || 'No phone'} />
                    <DetailTile label="Area" value={selectedPitchPartner?.assignedArea || 'No area'} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <DetailTile label="Pitch Date" value={formatDate(selectedPitch.pitchDate)} />
                <DetailTile label="Follow-Up Date" value={formatDate(selectedPitch.followUpAt)} />
                <DetailTile label="Created" value={formatDate(selectedPitch.createdAt)} />
                <DetailTile label="Updated" value={formatDate(selectedPitch.updatedAt)} />
              </div>

              <div className="rounded-lg border bg-card p-4">
                <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"><MessageSquareText className="h-4 w-4" />Salesman Notes</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{selectedPitch.notes || 'No notes added by salesman.'}</p>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingPartner ? 'Edit Sales Partner' : 'Create Sales Partner'}</DialogTitle><DialogDescription>Assign area, training state, and dashboard eligibility.</DialogDescription></DialogHeader>
          <form onSubmit={savePartner} className="grid gap-4 md:grid-cols-2">
            <div><Label>Name</Label><Input value={partnerForm.name} onChange={(event) => updatePartnerForm('name', event.target.value)} required /></div>
            <div><Label>Phone</Label><Input value={partnerForm.phone} onChange={(event) => updatePartnerForm('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} maxLength={10} required /></div>
            <div><Label>Email</Label><Input type="email" value={partnerForm.email} onChange={(event) => updatePartnerForm('email', event.target.value)} /></div>
            <div><Label>Assigned Area</Label><Input value={partnerForm.assignedArea} onChange={(event) => updatePartnerForm('assignedArea', event.target.value)} required /></div>
            <div className="md:col-span-2"><Label>Assigned Zones</Label><Input value={partnerForm.assignedZones} onChange={(event) => updatePartnerForm('assignedZones', event.target.value)} placeholder="Muradnagar, Modinagar, Sector 1" /></div>
            <div><Label>Status</Label><select value={partnerForm.status} onChange={(event) => updatePartnerForm('status', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="training">Training</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            <div><Label>Training Status</Label><select value={partnerForm.trainingStatus} onChange={(event) => updatePartnerForm('trainingStatus', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="certified">Certified</option></select></div>
            <div className="md:col-span-2"><Label>Notes</Label><Textarea rows={3} value={partnerForm.notes} onChange={(event) => updatePartnerForm('notes', event.target.value)} /></div>
            <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Partner</Button><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
