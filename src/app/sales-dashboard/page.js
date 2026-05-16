'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { BarChart3, BriefcaseBusiness, CalendarClock, Loader2, LogOut, MapPin, Plus, RefreshCw, Store, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { logoutClientSession } from '@/lib/client-session';

const emptyPitch = {
  restaurantName: '',
  ownerName: '',
  ownerPhone: '',
  location: '',
  pitchDate: new Date().toISOString().slice(0, 10),
  pitchStatus: 'follow_up',
  onboardingStatus: 'not_started',
  followUpAt: '',
  notes: '',
};

const pitchStatusLabels = {
  interested: 'Interested',
  follow_up: 'Follow-Up Required',
  demo_scheduled: 'Demo Scheduled',
  rejected: 'Rejected',
  onboarded: 'Onboarded',
  not_available: 'Not Available',
};

const onboardingStatusLabels = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  verified: 'Verified',
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function SalesDashboardPage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const [partner, setPartner] = useState(null);
  const [counts, setCounts] = useState({});
  const [pitches, setPitches] = useState([]);
  const [pitchForm, setPitchForm] = useState(emptyPitch);
  const [editingPitchId, setEditingPitchId] = useState('');
  const [activationRequired, setActivationRequired] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [activating, setActivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const getHeaders = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Authentication required.');
    const token = await currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const loadDashboard = async () => {
    setLoading(true);
    setMessage('');
    try {
      const headers = await getHeaders();
      const response = await fetch('/api/sales/me', { headers, cache: 'no-store' });
      const data = await response.json();
      if (response.status === 428 || data.code === 'EMPLOYEE_ID_REQUIRED') {
        setActivationRequired(true);
        setPartner(null);
        setPitches([]);
        return;
      }
      if (!response.ok) throw new Error(data.message || 'Failed to load sales dashboard.');
      const pitchesResponse = await fetch('/api/sales/pitches', { headers, cache: 'no-store' });
      const pitchesData = await pitchesResponse.json();
      if (!pitchesResponse.ok) throw new Error(pitchesData.message || 'Failed to load pitches.');
      setPartner(data.partner);
      setCounts(data.counts || {});
      setPitches(pitchesData.pitches || []);
      setActivationRequired(false);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent('/sales-dashboard')}`);
      return;
    }
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isUserLoading, router]);

  const computedCounts = useMemo(() => ({
    total: pitches.length,
    followUps: pitches.filter((pitch) => pitch.pitchStatus === 'follow_up').length,
    demos: pitches.filter((pitch) => pitch.pitchStatus === 'demo_scheduled').length,
    onboarded: pitches.filter((pitch) => pitch.pitchStatus === 'onboarded' || pitch.onboardingStatus === 'verified').length,
    ...counts,
  }), [pitches, counts]);

  const activateDashboard = async (event) => {
    event.preventDefault();
    setActivating(true);
    setMessage('');
    try {
      const headers = await getHeaders();
      const response = await fetch('/api/sales/activate', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Invalid employee ID.');
      setEmployeeId('');
      setActivationRequired(false);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setActivating(false);
    }
  };

  const updatePitchForm = (field, value) => setPitchForm((prev) => ({ ...prev, [field]: value }));

  const resetForm = () => {
    setPitchForm(emptyPitch);
    setEditingPitchId('');
  };

  const savePitch = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const headers = await getHeaders();
      const response = await fetch(editingPitchId ? `/api/sales/pitches/${editingPitchId}` : '/api/sales/pitches', {
        method: editingPitchId ? 'PATCH' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(pitchForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save pitch.');
      resetForm();
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const editPitch = (pitch) => {
    setEditingPitchId(pitch.id);
    setPitchForm({
      restaurantName: pitch.restaurantName || '',
      ownerName: pitch.ownerName || '',
      ownerPhone: pitch.ownerPhone || '',
      location: pitch.location || '',
      pitchDate: pitch.pitchDate ? new Date(pitch.pitchDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      pitchStatus: pitch.pitchStatus || 'follow_up',
      onboardingStatus: pitch.onboardingStatus || 'not_started',
      followUpAt: pitch.followUpAt || '',
      notes: pitch.notes || '',
    });
  };

  if (isUserLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        Loading sales dashboard...
      </div>
    );
  }

  if (activationRequired) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <Card className="w-full max-w-md rounded-lg">
          <CardHeader>
            <CardTitle>Activate Sales Dashboard</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter the employee ID shared by admin to unlock your sales partner dashboard.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={activateDashboard} className="space-y-4">
              <div>
                <Label htmlFor="employeeId">Employee ID</Label>
                <Input
                  id="employeeId"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="SZSP-ABCDEFGH"
                  required
                />
              </div>
              {message ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message}</p> : null}
              <Button type="submit" disabled={activating} className="w-full">
                {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Activate Dashboard
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">ServiZephyr Sales Operations</p>
            <h1 className="text-3xl font-bold">Sales Partner Dashboard</h1>
            <p className="mt-1 text-muted-foreground">{partner?.name} · {partner?.assignedArea || 'No assigned area'}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadDashboard}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button variant="outline" onClick={() => logoutClientSession({ redirectTo: '/login' })}><LogOut className="mr-2 h-4 w-4" />Logout</Button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:grid-cols-4">
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Total Pitches</p><p className="text-2xl font-bold">{computedCounts.totalPitches || computedCounts.total || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><CalendarClock className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Follow-Ups</p><p className="text-2xl font-bold">{computedCounts.followUps || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><Users className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Demos</p><p className="text-2xl font-bold">{computedCounts.demos || 0}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BarChart3 className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Onboarded</p><p className="text-2xl font-bold">{computedCounts.onboarded || 0}</p></div></CardContent></Card>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-8 lg:grid-cols-[420px_1fr]">
        <Card className="rounded-lg">
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />{editingPitchId ? 'Update Pitch' : 'Add Pitch'}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={savePitch} className="space-y-4">
              <div><Label>Restaurant Name</Label><Input value={pitchForm.restaurantName} onChange={(event) => updatePitchForm('restaurantName', event.target.value)} required /></div>
              <div><Label>Owner Name</Label><Input value={pitchForm.ownerName} onChange={(event) => updatePitchForm('ownerName', event.target.value)} /></div>
              <div><Label>Owner Phone</Label><Input value={pitchForm.ownerPhone} onChange={(event) => updatePitchForm('ownerPhone', event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" maxLength={10} required /></div>
              <div><Label>Location</Label><Textarea value={pitchForm.location} onChange={(event) => updatePitchForm('location', event.target.value)} rows={2} required /></div>
              <div><Label>Pitch Date</Label><Input type="date" value={pitchForm.pitchDate} onChange={(event) => updatePitchForm('pitchDate', event.target.value)} /></div>
              <div><Label>Pitch Status</Label><select value={pitchForm.pitchStatus} onChange={(event) => updatePitchForm('pitchStatus', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{Object.entries(pitchStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><Label>Onboarding Status</Label><select value={pitchForm.onboardingStatus} onChange={(event) => updatePitchForm('onboardingStatus', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{Object.entries(onboardingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><Label>Follow-Up Date</Label><Input type="date" value={pitchForm.followUpAt} onChange={(event) => updatePitchForm('followUpAt', event.target.value)} /></div>
              <div><Label>Notes</Label><Textarea value={pitchForm.notes} onChange={(event) => updatePitchForm('notes', event.target.value)} rows={3} /></div>
              {message ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{editingPitchId ? 'Update Pitch' : 'Add Pitch'}</Button>
                {editingPitchId ? <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button> : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader><CardTitle>Restaurant Pitch Tracker</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {pitches.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No pitches added yet.</div>
            ) : pitches.map((pitch) => (
              <div key={pitch.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{pitch.restaurantName}</h3>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />{pitch.location}</p>
                    <p className="text-sm text-muted-foreground">Owner: {pitch.ownerName || 'N/A'} · {pitch.ownerPhone}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => editPitch(pitch)}>Edit</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge>{pitchStatusLabels[pitch.pitchStatus] || pitch.pitchStatus}</Badge>
                  <Badge variant="outline">{onboardingStatusLabels[pitch.onboardingStatus] || pitch.onboardingStatus}</Badge>
                  <Badge variant="secondary">{formatDate(pitch.pitchDate)}</Badge>
                </div>
                {pitch.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{pitch.notes}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
