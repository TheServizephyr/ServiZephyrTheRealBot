'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useUser } from '@/firebase';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  BadgeCheck,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  IndianRupee,
  Layers3,
  Loader2,
  LogOut,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Store,
  Target,
  TrendingUp,
  UserRound,
  Users,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { logoutClientSession } from '@/lib/client-session';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { useTheme } from 'next-themes';

const MONTHLY_PITCH_TARGET = 40;
const MONTHLY_ONBOARDING_TARGET = 8;
const COMMISSION_RATE = 0.3;

const createEmptyPitch = () => ({
  restaurantName: '',
  ownerName: '',
  ownerPhone: '',
  location: '',
  pitchDate: new Date().toISOString().slice(0, 10),
  pitchStatus: 'follow_up',
  monthlySubscriptionAmount: '',
  paymentStatus: 'pending',
  followUpAt: '',
  notes: '',
});

const pitchStatusLabels = {
  interested: 'Interested',
  follow_up: 'Follow-Up Required',
  demo_scheduled: 'Demo Scheduled',
  rejected: 'Rejected',
  onboarded: 'Onboarded',
  not_available: 'Not Available',
};

const onboardingStatusLabels = {
  in_progress: 'In Progress',
  verified: 'Verified',
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

const onboardingTone = {
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300',
};

const paymentTone = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300',
};

const statusOptions = Object.entries(pitchStatusLabels);
const paymentOptions = Object.entries(paymentStatusLabels);

const navigationItems = [
  { value: 'home', label: 'Command Center', href: '/sales-dashboard', icon: BarChart3 },
  { value: 'pitches', label: 'Pitch Tracker', href: '/sales-dashboard/pitches', icon: ClipboardList },
  { value: 'onboarding', label: 'Onboarding', href: '/sales-dashboard/onboarding', icon: Store },
  { value: 'earnings', label: 'Earnings', href: '/sales-dashboard/earnings', icon: IndianRupee },
  { value: 'area', label: 'Territory', href: '/sales-dashboard/area', icon: MapPin },
];

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value || 0)));

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatInputDate = (value) => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const formatCurrency = (value) => (
  Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  })
);

const getPitchTimestamp = (pitch) => {
  const date = new Date(pitch.pitchDate || pitch.createdAt || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const isOnboardedPitch = (pitch) => pitch.pitchStatus === 'onboarded';

const isCommissionEligible = (pitch) => (
  pitch.pitchStatus === 'onboarded' && pitch.paymentStatus === 'paid' && Number(pitch.monthlySubscriptionAmount || 0) > 0
);

const getMonthlyCommissionAmount = (pitch) => (
  isCommissionEligible(pitch) ? Math.round(Number(pitch.monthlySubscriptionAmount || 0) * COMMISSION_RATE) : 0
);

const isOpenPitch = (pitch) => !['onboarded', 'rejected', 'not_available'].includes(pitch.pitchStatus);

const getFollowUpTimestamp = (pitch) => {
  if (!pitch.followUpAt) return Number.MAX_SAFE_INTEGER;
  const date = new Date(pitch.followUpAt);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
};

function ToneBadge({ children, className }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, detail, tone = 'text-primary' }) {
  return (
    <Card className="rounded-lg border-border bg-card">
      <CardContent className="flex min-h-32 items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className={`h-5 w-5 ${tone}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
          {detail ? <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressMetric({ label, value, helper, tone = 'bg-primary' }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{value}%</span>
      </div>
      <Progress value={value} className="h-2" indicatorClassName={tone} />
      {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function PipelineColumn({ title, count, pitches, emptyText, onEdit }) {
  return (
    <section className="min-h-80 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="secondary">{count}</Badge>
      </div>
      <div className="space-y-3 p-3">
        {pitches.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : pitches.map((pitch) => (
          <button
            key={pitch.id}
            type="button"
            onClick={() => onEdit(pitch)}
            className="w-full rounded-md border border-border bg-background p-3 text-left transition-colors hover:bg-muted/50"
          >
            <p className="truncate font-semibold">{pitch.restaurantName}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{pitch.location}</p>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatDate(pitch.pitchDate)}</span>
              {pitch.followUpAt ? <span>{formatDate(pitch.followUpAt)}</span> : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function PitchRow({ pitch, onEdit }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{pitch.restaurantName}</h3>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{pitch.location}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-4 w-4" />
              {pitch.ownerName || 'Owner N/A'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Phone className="h-4 w-4" />
              {pitch.ownerPhone}
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onEdit(pitch)}>Edit</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ToneBadge className={pitchStatusTone[pitch.pitchStatus] || pitchStatusTone.follow_up}>
          {pitchStatusLabels[pitch.pitchStatus] || pitch.pitchStatus}
        </ToneBadge>
        <ToneBadge className={onboardingTone[pitch.onboardingStatus] || onboardingTone.in_progress}>
          {onboardingStatusLabels[pitch.onboardingStatus] || pitch.onboardingStatus}
        </ToneBadge>
        {pitch.pitchStatus === 'onboarded' ? (
          <ToneBadge className={paymentTone[pitch.paymentStatus] || paymentTone.pending}>
            {paymentStatusLabels[pitch.paymentStatus] || pitch.paymentStatus}
          </ToneBadge>
        ) : null}
        <Badge variant="outline">{formatDate(pitch.pitchDate)}</Badge>
        {pitch.pitchStatus === 'onboarded' && Number(pitch.monthlySubscriptionAmount || 0) > 0 ? (
          <Badge variant="secondary">{formatCurrency(pitch.monthlySubscriptionAmount)}/mo</Badge>
        ) : null}
        {pitch.followUpAt ? <Badge variant="secondary">Follow-up {formatDate(pitch.followUpAt)}</Badge> : null}
      </div>
      {pitch.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{pitch.notes}</p> : null}
    </div>
  );
}

function SalesSidebar({ partner, currentView }) {
  return (
    <aside className="border-b border-border bg-card text-card-foreground shadow-sm lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-[260px] lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex h-[65px] shrink-0 items-center justify-between gap-3 border-b border-border px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="ServiZephyr" width={40} height={40} className="h-10 w-10" />
          <h2 className="text-xl font-bold text-primary">ServiZephyr</h2>
        </Link>
      </div>

      <div className="px-4 py-4">
        <div className="rounded-lg border border-border bg-background/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales Ops</p>
            <ToneBadge className={partner?.status === 'active' ? pitchStatusTone.onboarded : pitchStatusTone.follow_up}>
              {partner?.status || 'training'}
            </ToneBadge>
          </div>
          <p className="truncate text-sm font-semibold">{partner?.name || 'Sales Partner'}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{partner?.employeeId || 'Employee ID pending'}</p>
          <p className="mt-3 flex items-center gap-2 truncate text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {partner?.assignedArea || 'Area not assigned'}
          </p>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto px-4 pb-4 lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.value;
          return (
            <Link
              key={item.value}
              href={item.href}
              className={`flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors lg:w-full ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-border p-4 lg:block">
        <div className="rounded-lg border border-border bg-background/60 p-4 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">Field workflow</p>
          <p className="mt-1">Pitch, follow up, onboard, and keep every restaurant update measurable.</p>
        </div>
      </div>
    </aside>
  );
}

export default function SalesDashboardClient({ view = 'home' }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, isUserLoading } = useUser();
  const [partner, setPartner] = useState(null);
  const [counts, setCounts] = useState({});
  const [pitches, setPitches] = useState([]);
  const [pitchForm, setPitchForm] = useState(createEmptyPitch);
  const [editingPitchId, setEditingPitchId] = useState('');
  const [activationRequired, setActivationRequired] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [activating, setActivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
      router.push(`/login?redirect=${encodeURIComponent(pathname || '/sales-dashboard')}`);
      return;
    }
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isUserLoading, router, pathname]);

  const dashboardData = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const sorted = [...pitches].sort((a, b) => getPitchTimestamp(b) - getPitchTimestamp(a));
    const currentMonthPitches = sorted.filter((pitch) => {
      const date = new Date(pitch.pitchDate || pitch.createdAt || 0);
      return !Number.isNaN(date.getTime()) && date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    });
    const onboarded = sorted.filter(isOnboardedPitch);
    const currentMonthOnboarded = currentMonthPitches.filter(isOnboardedPitch);
    const followUps = sorted.filter((pitch) => pitch.pitchStatus === 'follow_up');
    const demos = sorted.filter((pitch) => pitch.pitchStatus === 'demo_scheduled');
    const interested = sorted.filter((pitch) => pitch.pitchStatus === 'interested');
    const rejected = sorted.filter((pitch) => pitch.pitchStatus === 'rejected');
    const unavailable = sorted.filter((pitch) => pitch.pitchStatus === 'not_available');
    const onboardingInProgress = sorted.filter((pitch) => pitch.pitchStatus !== 'onboarded');
    const verified = sorted.filter(isOnboardedPitch);
    const paidOnboarded = sorted.filter(isCommissionEligible);
    const activeProspects = sorted.filter(isOpenPitch);
    const followUpQueue = sorted
      .filter((pitch) => isOpenPitch(pitch) && (pitch.pitchStatus === 'follow_up' || pitch.followUpAt))
      .sort((a, b) => getFollowUpTimestamp(a) - getFollowUpTimestamp(b))
      .slice(0, 6);
    const dueFollowUps = followUpQueue.filter((pitch) => {
      if (!pitch.followUpAt) return false;
      const followUpDate = new Date(pitch.followUpAt);
      return !Number.isNaN(followUpDate.getTime()) && followUpDate.setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0);
    });
    const conversionRate = sorted.length ? clampPercent((onboarded.length / sorted.length) * 100) : 0;
    const pitchTargetProgress = clampPercent((currentMonthPitches.length / MONTHLY_PITCH_TARGET) * 100);
    const onboardingTargetProgress = clampPercent((currentMonthOnboarded.length / MONTHLY_ONBOARDING_TARGET) * 100);
    const projectedMonthly = sorted.reduce((sum, pitch) => sum + getMonthlyCommissionAmount(pitch), 0);

    return {
      sorted,
      total: sorted.length,
      currentMonthPitches,
      onboarded,
      paidOnboarded,
      currentMonthOnboarded,
      followUps,
      demos,
      interested,
      rejected,
      unavailable,
      onboardingInProgress,
      verified,
      activeProspects,
      followUpQueue,
      dueFollowUps,
      conversionRate,
      pitchTargetProgress,
      onboardingTargetProgress,
      projectedMonthly,
      totalProjectedSixMonths: projectedMonthly * 6,
      counts: {
        totalPitches: counts.totalPitches || sorted.length,
        followUps: counts.followUps || followUps.length,
        demos: counts.demos || demos.length,
        onboarded: counts.onboarded || onboarded.length,
        paidOnboarded: counts.paidOnboarded || paidOnboarded.length,
        monthlyCommission: counts.monthlyCommission || projectedMonthly,
      },
    };
  }, [pitches, counts]);

  const filteredPitches = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return dashboardData.sorted.filter((pitch) => {
      const matchesStatus = statusFilter === 'all' || pitch.pitchStatus === statusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      return [
        pitch.restaurantName,
        pitch.ownerName,
        pitch.ownerPhone,
        pitch.location,
        pitch.notes,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [dashboardData.sorted, searchTerm, statusFilter]);

  const pipelineGroups = useMemo(() => ({
    lead: dashboardData.sorted.filter((pitch) => ['interested', 'follow_up'].includes(pitch.pitchStatus)).slice(0, 5),
    demo: dashboardData.demos.slice(0, 5),
    onboarding: dashboardData.sorted.filter((pitch) => pitch.onboardingStatus === 'in_progress' || pitch.pitchStatus === 'onboarded').slice(0, 5),
    closed: dashboardData.onboarded.slice(0, 5),
  }), [dashboardData]);

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
    setPitchForm(createEmptyPitch());
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
      if (pathname !== '/sales-dashboard/pitches') {
        router.push('/sales-dashboard/pitches');
      }
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
      pitchDate: formatInputDate(pitch.pitchDate),
      pitchStatus: pitch.pitchStatus || 'follow_up',
      monthlySubscriptionAmount: pitch.monthlySubscriptionAmount ? String(pitch.monthlySubscriptionAmount) : '',
      paymentStatus: pitch.paymentStatus || 'pending',
      followUpAt: pitch.followUpAt || '',
      notes: pitch.notes || '',
    });
    if (pathname !== '/sales-dashboard/pitches') {
      try {
        sessionStorage.setItem('sales_dashboard_edit_pitch_id', pitch.id);
      } catch {
        // Ignore storage failures.
      }
      router.push('/sales-dashboard/pitches');
    }
  };

  useEffect(() => {
    if (view !== 'pitches' || pitches.length === 0 || editingPitchId) return;
    let savedPitchId = '';
    try {
      savedPitchId = sessionStorage.getItem('sales_dashboard_edit_pitch_id') || '';
      sessionStorage.removeItem('sales_dashboard_edit_pitch_id');
    } catch {
      savedPitchId = '';
    }
    if (!savedPitchId) return;
    const pitch = pitches.find((entry) => entry.id === savedPitchId);
    if (pitch) editPitch(pitch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pitches, editingPitchId]);

  if (isUserLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
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
      <SalesSidebar partner={partner} currentView={view} />

      <div className="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden lg:pl-[260px]">
        <header className="h-[65px] shrink-0 border-b border-border bg-card">
          <div className="flex h-full items-center justify-between gap-3 px-4 md:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ServiZephyr Sales Operations</p>
              <h1 className="truncate text-lg font-bold tracking-tight md:text-2xl">
                {navigationItems.find((item) => item.value === view)?.label || 'Sales Dashboard'}
              </h1>
              <p className="hidden text-sm text-muted-foreground md:block">
                {partner?.name || 'Sales Partner'} | {partner?.employeeId || 'Employee ID pending'} | {partner?.assignedArea || 'Area not assigned'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={loadDashboard} title="Refresh">
                <RefreshCw className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => logoutClientSession({ redirectTo: '/login' })} title="Logout">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={BriefcaseBusiness}
            label="Total Pitches"
            value={dashboardData.counts.totalPitches}
            detail={`${dashboardData.currentMonthPitches.length} this month`}
            tone="text-sky-600"
          />
          <StatCard
            icon={CalendarClock}
            label="Follow-Ups"
            value={dashboardData.counts.followUps}
            detail={`${dashboardData.dueFollowUps.length} due now`}
            tone="text-amber-600"
          />
          <StatCard
            icon={Users}
            label="Demo Pipeline"
            value={dashboardData.counts.demos}
            detail={`${dashboardData.activeProspects.length} active prospects`}
            tone="text-indigo-600"
          />
          <StatCard
            icon={IndianRupee}
            label="Projected Monthly"
            value={formatCurrency(dashboardData.projectedMonthly)}
            detail={`${dashboardData.counts.paidOnboarded} paid onboarded`}
            tone="text-emerald-600"
          />
        </section>

        {message ? (
          <div className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {message}
          </div>
        ) : null}

        {view === 'home' ? (
          <div className="mt-6 space-y-6">
            <section className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    Monthly Operating Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <ProgressMetric
                    label="Pitch Activity"
                    value={dashboardData.pitchTargetProgress}
                    helper={`${dashboardData.currentMonthPitches.length}/${MONTHLY_PITCH_TARGET} pitches logged this month`}
                    tone="bg-sky-600"
                  />
                  <ProgressMetric
                    label="Onboarding Progress"
                    value={dashboardData.onboardingTargetProgress}
                    helper={`${dashboardData.currentMonthOnboarded.length}/${MONTHLY_ONBOARDING_TARGET} onboardings this month`}
                    tone="bg-emerald-600"
                  />
                  <ProgressMetric
                    label="Conversion"
                    value={dashboardData.conversionRate}
                    helper={`${dashboardData.onboarded.length} converted from ${dashboardData.total} total pitches`}
                    tone="bg-indigo-600"
                  />
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BellRing className="h-5 w-5 text-amber-600" />
                    Priority Queue
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboardData.followUpQueue.length === 0 ? (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No follow-ups pending.</div>
                  ) : dashboardData.followUpQueue.map((pitch) => (
                    <button
                      key={pitch.id}
                      type="button"
                      onClick={() => editPitch(pitch)}
                      className="flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{pitch.restaurantName}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{pitch.location}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">{pitch.followUpAt ? formatDate(pitch.followUpAt) : 'Open'}</Badge>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={TrendingUp} label="Interested" value={dashboardData.interested.length} detail="Warm leads" tone="text-emerald-600" />
              <StatCard icon={Clock3} label="In Onboarding" value={dashboardData.onboardingInProgress.length} detail="Setup in progress" tone="text-indigo-600" />
              <StatCard icon={CheckCircle2} label="Verified" value={dashboardData.verified.length} detail="Pitch marked onboarded" tone="text-green-600" />
              <StatCard icon={Layers3} label="Closed / Unavailable" value={dashboardData.rejected.length + dashboardData.unavailable.length} detail="Market feedback" tone="text-rose-600" />
            </section>

            <section className="grid gap-4 lg:grid-cols-4">
              <PipelineColumn title="Leads" count={pipelineGroups.lead.length} pitches={pipelineGroups.lead} emptyText="No active leads." onEdit={editPitch} />
              <PipelineColumn title="Demo" count={pipelineGroups.demo.length} pitches={pipelineGroups.demo} emptyText="No demos scheduled." onEdit={editPitch} />
              <PipelineColumn title="Onboarding" count={pipelineGroups.onboarding.length} pitches={pipelineGroups.onboarding} emptyText="No onboarding work yet." onEdit={editPitch} />
              <PipelineColumn title="Closed" count={pipelineGroups.closed.length} pitches={pipelineGroups.closed} emptyText="No onboarded restaurants yet." onEdit={editPitch} />
            </section>
          </div>
        ) : null}

        {view === 'pitches' ? (
          <div className="mt-6">
            <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    {editingPitchId ? 'Update Pitch' : 'Add Pitch'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={savePitch} className="space-y-4">
                    <div>
                      <Label htmlFor="restaurantName">Restaurant Name</Label>
                      <Input id="restaurantName" value={pitchForm.restaurantName} onChange={(event) => updatePitchForm('restaurantName', event.target.value)} required />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="ownerName">Owner Name</Label>
                        <Input id="ownerName" value={pitchForm.ownerName} onChange={(event) => updatePitchForm('ownerName', event.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="ownerPhone">Owner Phone</Label>
                        <Input id="ownerPhone" value={pitchForm.ownerPhone} onChange={(event) => updatePitchForm('ownerPhone', event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" maxLength={10} required />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="location">Location</Label>
                      <Textarea id="location" value={pitchForm.location} onChange={(event) => updatePitchForm('location', event.target.value)} rows={2} required />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="pitchDate">Pitch Date</Label>
                        <Input id="pitchDate" type="date" value={pitchForm.pitchDate} onChange={(event) => updatePitchForm('pitchDate', event.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="followUpAt">Follow-Up Date</Label>
                        <Input id="followUpAt" type="date" value={pitchForm.followUpAt} onChange={(event) => updatePitchForm('followUpAt', event.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="pitchStatus">Pitch Status</Label>
                        <select id="pitchStatus" value={pitchForm.pitchStatus} onChange={(event) => updatePitchForm('pitchStatus', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label>Onboarding Status</Label>
                        <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                          {pitchForm.pitchStatus === 'onboarded' ? 'Verified automatically' : 'In progress automatically'}
                        </div>
                      </div>
                    </div>
                    {pitchForm.pitchStatus === 'onboarded' ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="monthlySubscriptionAmount">Monthly Amount</Label>
                          <Input
                            id="monthlySubscriptionAmount"
                            type="number"
                            min="0"
                            step="1"
                            value={pitchForm.monthlySubscriptionAmount}
                            onChange={(event) => updatePitchForm('monthlySubscriptionAmount', event.target.value.replace(/[^\d]/g, ''))}
                            placeholder="500, 600, 1000..."
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="paymentStatus">Payment Status</Label>
                          <select id="paymentStatus" value={pitchForm.paymentStatus} onChange={(event) => updatePitchForm('paymentStatus', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                            {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea id="notes" value={pitchForm.notes} onChange={(event) => updatePitchForm('notes', event.target.value)} rows={4} />
                    </div>
                    {message ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {editingPitchId ? 'Update Pitch' : 'Add Pitch'}
                      </Button>
                      {editingPitchId ? <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button> : null}
                    </div>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:flex-row md:items-center md:justify-between">
                  <div className="relative md:w-80">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search pitches..." className="pl-9" />
                  </div>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm md:w-56">
                    <option value="all">All statuses</option>
                    {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>

                {filteredPitches.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No pitches found.</div>
                ) : filteredPitches.map((pitch) => (
                  <PitchRow key={pitch.id} pitch={pitch} onEdit={editPitch} />
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {view === 'onboarding' ? (
          <div className="mt-6 space-y-5">
            <section className="grid gap-4 md:grid-cols-3">
              <StatCard icon={Store} label="In Progress" value={dashboardData.onboardingInProgress.length} detail="Pitch not onboarded yet" tone="text-indigo-600" />
              <StatCard icon={ShieldCheck} label="Verified" value={dashboardData.verified.length} detail="Pitch marked onboarded" tone="text-emerald-600" />
              <StatCard icon={IndianRupee} label="Payment Received" value={dashboardData.paidOnboarded.length} detail="Eligible for commission" tone="text-green-600" />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              {dashboardData.sorted.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground lg:col-span-2">No onboarding records yet.</div>
              ) : dashboardData.sorted.map((pitch) => (
                  <Card key={pitch.id} className="rounded-lg">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold">{pitch.restaurantName}</p>
                          <p className="mt-1 truncate text-sm text-muted-foreground">{pitch.location}</p>
                        </div>
                        <ToneBadge className={onboardingTone[pitch.onboardingStatus] || onboardingTone.in_progress}>
                          {onboardingStatusLabels[pitch.onboardingStatus] || pitch.onboardingStatus}
                        </ToneBadge>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-muted-foreground">Pitch</p>
                          <p className="font-semibold">{formatDate(pitch.pitchDate)}</p>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-muted-foreground">Owner</p>
                          <p className="truncate font-semibold">{pitch.ownerName || 'N/A'}</p>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-muted-foreground">Phone</p>
                          <p className="font-semibold">{pitch.ownerPhone}</p>
                        </div>
                      </div>
                      {pitch.pitchStatus === 'onboarded' ? (
                        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-muted-foreground">Monthly Amount</p>
                            <p className="font-semibold">{formatCurrency(pitch.monthlySubscriptionAmount)}</p>
                          </div>
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-muted-foreground">Payment</p>
                            <p className="font-semibold">{paymentStatusLabels[pitch.paymentStatus] || pitch.paymentStatus}</p>
                          </div>
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-muted-foreground">Commission</p>
                            <p className="font-semibold">{formatCurrency(getMonthlyCommissionAmount(pitch))}/mo</p>
                          </div>
                        </div>
                      ) : null}
                      <Button variant="outline" size="sm" className="mt-4" onClick={() => editPitch(pitch)}>Update Status</Button>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        ) : null}

        {view === 'earnings' ? (
          <div className="mt-6 space-y-5">
            <section className="grid gap-4 md:grid-cols-3">
              <StatCard icon={IndianRupee} label="Confirmed Monthly" value={formatCurrency(dashboardData.projectedMonthly)} detail={`${Math.round(COMMISSION_RATE * 100)}% after payment received`} tone="text-emerald-600" />
              <StatCard icon={CalendarClock} label="Six Month Value" value={formatCurrency(dashboardData.totalProjectedSixMonths)} detail="Paid onboarded accounts only" tone="text-indigo-600" />
              <StatCard icon={BadgeCheck} label="Eligible Accounts" value={dashboardData.paidOnboarded.length} detail="Onboarded + payment received" tone="text-green-600" />
            </section>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Commission Ledger</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {dashboardData.paidOnboarded.length === 0 ? (
                  <div className="rounded-md border border-dashed p-10 text-center text-muted-foreground">No commission eligible restaurants yet.</div>
                ) : dashboardData.paidOnboarded.map((pitch) => (
                  <div key={pitch.id} className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{pitch.restaurantName}</p>
                      <p className="truncate text-sm text-muted-foreground">{pitch.location} | {formatCurrency(pitch.monthlySubscriptionAmount)}/mo</p>
                    </div>
                    <ToneBadge className={paymentTone.paid}>Paid</ToneBadge>
                    <p className="text-lg font-bold">{formatCurrency(getMonthlyCommissionAmount(pitch))}/mo</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {view === 'area' ? (
          <div className="mt-6 space-y-5">
            <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    Assigned Territory
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Primary Area</p>
                    <p className="mt-1 text-2xl font-bold">{partner?.assignedArea || 'Not assigned'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(partner?.assignedZones || []).length === 0 ? (
                      <Badge variant="outline">No zones assigned</Badge>
                    ) : partner.assignedZones.map((zone) => (
                      <Badge key={zone} variant="secondary">{zone}</Badge>
                    ))}
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-muted-foreground">Partner</p>
                      <p className="font-semibold">{partner?.name || 'N/A'}</p>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-muted-foreground">Training</p>
                      <p className="font-semibold">{partner?.trainingStatus || 'not_started'}</p>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-muted-foreground">Phone</p>
                      <p className="font-semibold">{partner?.phone || 'N/A'}</p>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-muted-foreground">Email</p>
                      <p className="truncate font-semibold">{partner?.email || 'N/A'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle>Area Coverage</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboardData.sorted.length === 0 ? (
                    <div className="rounded-md border border-dashed p-10 text-center text-muted-foreground">No area activity logged yet.</div>
                  ) : dashboardData.sorted.slice(0, 10).map((pitch) => (
                    <button
                      key={pitch.id}
                      type="button"
                      onClick={() => editPitch(pitch)}
                      className="grid w-full gap-3 rounded-md border p-4 text-left transition-colors hover:bg-muted/60 md:grid-cols-[1fr_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{pitch.restaurantName}</p>
                        <p className="mt-1 flex items-center gap-2 truncate text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4 shrink-0" />
                          {pitch.location}
                        </p>
                      </div>
                      <ToneBadge className={pitchStatusTone[pitch.pitchStatus] || pitchStatusTone.follow_up}>
                        {pitchStatusLabels[pitch.pitchStatus] || pitch.pitchStatus}
                      </ToneBadge>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </section>
          </div>
        ) : null}
      </div>
      </div>
    </main>
  );
}
