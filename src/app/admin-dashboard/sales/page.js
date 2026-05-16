'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { BarChart3, BriefcaseBusiness, Loader2, Plus, RefreshCw, Search, Users } from 'lucide-react';
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

export default function AdminSalesPage() {
  const [partners, setPartners] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
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
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BriefcaseBusiness className="h-8 w-8 text-green-500" /><div><p className="text-sm text-muted-foreground">Onboarded</p><p className="text-2xl font-bold">{counts.onboarded || 0}</p></div></CardContent></Card>
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
              <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Employee ID</TableHead><TableHead>Area</TableHead><TableHead>Status</TableHead><TableHead>Training</TableHead><TableHead>Pitches</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredPartners.length === 0 ? <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No sales partners found.</TableCell></TableRow> : filteredPartners.map((partner) => (
                  <TableRow key={partner.id}>
                    <TableCell><div className="font-semibold">{partner.name}</div><div className="text-sm text-muted-foreground">{partner.phone} {partner.email ? `· ${partner.email}` : ''}</div></TableCell>
                    <TableCell><Badge variant="outline">{partner.employeeId || 'Not generated'}</Badge></TableCell>
                    <TableCell><div>{partner.assignedArea}</div><div className="text-xs text-muted-foreground">{(partner.assignedZones || []).join(', ')}</div></TableCell>
                    <TableCell><Badge variant={partner.status === 'active' ? 'default' : 'secondary'}>{statusLabels[partner.status] || partner.status}</Badge></TableCell>
                    <TableCell>{trainingLabels[partner.trainingStatus] || partner.trainingStatus}</TableCell>
                    <TableCell>{partner.totalPitches || 0}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => openEdit(partner)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader><CardTitle>Recent Pitch Activity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {pitches.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No pitch activity yet.</div> : pitches.slice(0, 12).map((pitch) => (
            <div key={pitch.id} className="rounded-lg border p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div><p className="font-semibold">{pitch.restaurantName}</p><p className="text-sm text-muted-foreground">{pitch.partnerName} · {pitch.location}</p></div>
                <div className="flex flex-wrap gap-2"><Badge>{pitchStatusLabels[pitch.pitchStatus] || pitch.pitchStatus}</Badge><Badge variant="outline">{pitch.onboardingStatus}</Badge></div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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
