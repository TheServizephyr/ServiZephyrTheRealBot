'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { AlertTriangle, BellRing, CheckCircle2, Clock, MailWarning, RefreshCw, Search, ShieldAlert, Siren, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

const STATUS_OPTIONS = ['all', 'new', 'reopened', 'investigating', 'resolved', 'muted'];
const SEVERITY_OPTIONS = ['all', 'critical', 'error', 'warning', 'info'];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function severityClass(severity) {
  if (severity === 'critical') return 'bg-red-500/10 text-red-500 border-red-500/30';
  if (severity === 'error') return 'bg-orange-500/10 text-orange-500 border-orange-500/30';
  if (severity === 'warning') return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
  return 'bg-sky-500/10 text-sky-500 border-sky-500/30';
}

function statusClass(status) {
  if (status === 'resolved') return 'bg-green-500/10 text-green-500 border-green-500/30';
  if (status === 'investigating') return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
  if (status === 'muted') return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30';
  if (status === 'reopened') return 'bg-purple-500/10 text-purple-500 border-purple-500/30';
  return 'bg-red-500/10 text-red-500 border-red-500/30';
}

function emailLabel(email) {
  if (!email?.lastStatus) return 'not attempted';
  if (email.lastStatus === 'sent') return 'sent';
  if (email.lastStatus === 'failed') return 'failed';
  if (email.lastStatus === 'skipped') return email.lastReason || 'skipped';
  return email.lastStatus;
}

function KpiCard({ title, value, subtitle, icon: Icon }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentDetails({ incident, onStatusChange }) {
  const [note, setNote] = useState(incident.adminNote || '');
  const [updating, setUpdating] = useState(false);

  const updateStatus = async (status) => {
    setUpdating(true);
    try {
      await onStatusChange(incident.id, status, note);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="border-t bg-muted/20 p-4 md:p-5 space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Incident ID</p>
          <p className="font-mono text-xs mt-1 break-all">{incident.id}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">First Seen</p>
          <p className="text-sm mt-1">{formatDate(incident.firstSeenAtISO || incident.firstSeenAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Email Alert</p>
          <p className="text-sm mt-1">{emailLabel(incident.email)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Changed By</p>
          <p className="text-sm mt-1 break-all">{incident.lastStatusChangedBy?.email || '-'}</p>
        </div>
      </div>

      {incident.stack ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Stack</p>
          <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap">{incident.stack}</pre>
        </div>
      ) : null}

      {incident.lastEvent?.context ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Last Event Context</p>
          <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap">
            {JSON.stringify(incident.lastEvent.context, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Admin Note</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add investigation note" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => updateStatus('investigating')} disabled={updating}>
            Investigating
          </Button>
          <Button variant="outline" onClick={() => updateStatus('muted')} disabled={updating}>
            Mute
          </Button>
          <Button onClick={() => updateStatus('resolved')} disabled={updating}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Resolve
          </Button>
        </div>
      </div>
    </div>
  );
}

function IncidentRow({ incident, expanded, onToggle, onStatusChange }) {
  const isCriticalOpen = ['critical', 'error'].includes(incident.severity) && !['resolved', 'muted'].includes(incident.status);

  return (
    <div className={cn('rounded-md border bg-card overflow-hidden', incident.pinned && 'border-primary/60')}>
      <button type="button" onClick={onToggle} className="w-full text-left p-4 hover:bg-muted/40 transition-colors">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={severityClass(incident.severity)}>{incident.severity || 'error'}</Badge>
              <Badge variant="outline" className={statusClass(incident.status)}>{incident.status || 'new'}</Badge>
              {isCriticalOpen ? <Badge variant="outline" className="border-red-500/30 text-red-500">needs attention</Badge> : null}
              {incident.email?.lastStatus === 'failed' ? <Badge variant="outline" className="border-red-500/30 text-red-500">email failed</Badge> : null}
            </div>
            <div>
              <p className="font-semibold break-words">{incident.title || incident.message || 'Production incident'}</p>
              <p className="text-sm text-muted-foreground mt-1 break-words">{incident.message || 'No message provided'}</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{incident.route || 'unknown route'}</span>
              <span>{incident.source || 'unknown source'}</span>
              <span>{incident.area || 'general'}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-right lg:min-w-[280px]">
            <div>
              <p className="text-xs text-muted-foreground">Count</p>
              <p className="font-semibold">{formatNumber(incident.count)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Seen</p>
              <p className="text-sm">{formatDate(incident.lastSeenAtISO || incident.lastSeenAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm truncate">{emailLabel(incident.email)}</p>
            </div>
          </div>
        </div>
      </button>
      {expanded ? <IncidentDetails incident={incident} onStatusChange={onStatusChange} /> : null}
    </div>
  );
}

export default function OpsIncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [stats, setStats] = useState({ total: 0, byStatus: {}, bySeverity: {}, emailFailures: 0 });
  const [sourceOptions, setSourceOptions] = useState([]);
  const [filters, setFilters] = useState({ status: 'all', severity: 'all', source: 'all', q: '' });
  const [expandedId, setExpandedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pinnedIncidentId, setPinnedIncidentId] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const incidentId = params.get('incident') || '';
    setPinnedIncidentId(incidentId);
    if (incidentId) setExpandedId(incidentId);
  }, []);

  const fetchIncidents = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
      }

      const params = new URLSearchParams({
        status: filters.status,
        severity: filters.severity,
        source: filters.source,
        q: filters.q,
        limit: '100',
      });
      if (pinnedIncidentId) params.set('incident', pinnedIncidentId);

      const response = await fetch(`/api/admin/ops-incidents?${params}`, {
        headers,
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Failed to load incidents');
      }

      const payload = await response.json();
      setIncidents(payload.incidents || []);
      setStats(payload.stats || { total: 0, byStatus: {}, bySeverity: {}, emailFailures: 0 });
      setSourceOptions(payload.sourceOptions || []);
    } catch (err) {
      setError(err.message || 'Failed to load incidents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, pinnedIncidentId]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  useEffect(() => {
    const interval = setInterval(() => fetchIncidents({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [fetchIncidents]);

  const updateStatus = async (incidentId, status, note) => {
    const currentUser = auth.currentUser;
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser) {
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }

    const response = await fetch('/api/admin/ops-incidents', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ incidentId, status, note }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || 'Failed to update incident');
    }
    await fetchIncidents({ silent: true });
  };

  const openCriticalCount = useMemo(() => {
    return incidents.filter((incident) =>
      ['critical', 'error'].includes(incident.severity) &&
      !['resolved', 'muted'].includes(incident.status)
    ).length;
  }, [incidents]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">System Incidents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Production errors, client crashes, backend failures and email alert status.
          </p>
        </div>
        <Button variant="outline" onClick={() => fetchIncidents({ silent: true })} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard title="Tracked Incidents" value={formatNumber(stats.total)} subtitle="Latest stored fingerprints" icon={ShieldAlert} />
        <KpiCard title="Open Critical/Error" value={formatNumber(openCriticalCount)} subtitle="Visible in current filter" icon={Siren} />
        <KpiCard title="Critical" value={formatNumber(stats.bySeverity?.critical)} subtitle="All fetched incidents" icon={AlertTriangle} />
        <KpiCard title="New/Reopened" value={formatNumber((stats.byStatus?.new || 0) + (stats.byStatus?.reopened || 0))} subtitle="Needs triage" icon={Clock} />
        <KpiCard title="Email Failures" value={formatNumber(stats.emailFailures)} subtitle="Check Resend/env config" icon={MailWarning} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[160px_160px_180px_1fr_auto] md:items-end">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Status</label>
              <select
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Severity</label>
              <select
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filters.severity}
                onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))}
              >
                {SEVERITY_OPTIONS.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Source</label>
              <select
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filters.source}
                onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value }))}
              >
                <option value="all">all</option>
                {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Search</label>
              <div className="mt-2 relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                  value={filters.q}
                  onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
                  placeholder="Route, message, source, ID"
                />
              </div>
            </div>
            <Button onClick={() => fetchIncidents({ silent: true })} disabled={refreshing}>
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Could not load incidents</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Incident Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Loading incidents...
            </div>
          ) : incidents.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-9 w-9 mx-auto mb-3" />
              No incidents match the current filters.
            </div>
          ) : (
            incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                expanded={expandedId === incident.id}
                onToggle={() => setExpandedId((current) => current === incident.id ? '' : incident.id)}
                onStatusChange={updateStatus}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
