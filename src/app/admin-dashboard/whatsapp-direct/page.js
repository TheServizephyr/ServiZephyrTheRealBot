'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Search,
  MessageSquare,
  RefreshCw,
  Bot,
  Clock3,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from 'lucide-react';

const defaultConfig = {
  platformName: 'ServiZephyr',
};

const statusTabs = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
];

const statusBadgeClass = {
  new: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  in_progress: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  resolved: 'bg-green-500/10 text-green-600 dark:text-green-300',
};

export default function AdminWhatsappDirectPage() {
  const [config, setConfig] = useState(defaultConfig);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const fetchData = async (manual = false) => {
    try {
      if (manual) setRefreshing(true);
      else setLoading(true);

      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication required.');
      const idToken = await currentUser.getIdToken();
      const headers = { Authorization: `Bearer ${idToken}` };

      const [settingsRes, mailboxRes] = await Promise.all([
        fetch('/api/admin/settings', { headers }),
        fetch('/api/admin/mailbox', { headers }),
      ]);

      if (!settingsRes.ok) {
        const errorData = await settingsRes.json();
        throw new Error(errorData.message || 'Failed to load admin settings.');
      }
      if (!mailboxRes.ok) {
        const errorData = await mailboxRes.json();
        throw new Error(errorData.message || 'Failed to load admin mailbox.');
      }

      const [settingsData, mailboxData] = await Promise.all([
        settingsRes.json(),
        mailboxRes.json(),
      ]);

      const nextReports = Array.isArray(mailboxData.reports) ? mailboxData.reports : [];
      setConfig({ ...defaultConfig, ...settingsData });
      setReports(nextReports);

      setSelectedReportId((prev) => {
        if (prev && nextReports.some((item) => item.id === prev)) return prev;
        return nextReports[0]?.id || null;
      });
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesTab = activeTab === 'all' ? true : report.status === activeTab;
      if (!matchesTab) return false;
      if (!query) return true;

      const haystack = [
        report.title,
        report.message,
        report.description,
        report.path,
        report.user?.name,
        report.user?.email,
        report.user?.phone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [reports, activeTab, search]);

  const selectedReport = useMemo(
    () => filteredReports.find((item) => item.id === selectedReportId) || filteredReports[0] || null,
    [filteredReports, selectedReportId]
  );

  useEffect(() => {
    if (selectedReport && selectedReport.id !== selectedReportId) {
      setSelectedReportId(selectedReport.id);
    }
  }, [selectedReport, selectedReportId]);

  const handleStatusUpdate = async (status) => {
    if (!selectedReport?.id) return;
    try {
      setSavingStatus(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Authentication required.');
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/admin/mailbox', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ reportId: selectedReport.id, status }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update report status.');
      }

      setReports((prev) => prev.map((item) => (item.id === selectedReport.id ? { ...item, status } : item)));
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />

      {loading ? (
        <div className="flex items-center justify-center h-[70vh]">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4 h-[calc(100vh-130px)]">
          <Card className="overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border bg-card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Chats</h2>
                    <p className="text-xs text-muted-foreground">{config.platformName} admin inbox</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => fetchData(true)} disabled={refreshing}>
                  <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} />
                </Button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports or messages"
                  className="pl-10"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'px-3 py-2 rounded-full text-sm whitespace-nowrap border transition-colors',
                      activeTab === tab.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredReports.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center p-6 text-muted-foreground">
                  No admin reports or conversations found for this filter.
                </div>
              ) : (
                filteredReports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedReportId(report.id)}
                    className={cn(
                      'w-full text-left px-4 py-4 border-b border-border/60 hover:bg-muted/40 transition-colors',
                      selectedReport?.id === report.id && 'bg-muted/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{report.title || 'Untitled report'}</p>
                        <p className="text-sm text-muted-foreground truncate">{report.user?.name || 'Unknown reporter'}</p>
                        <p className="text-sm text-muted-foreground truncate mt-1">{report.description || report.message || 'No detail provided'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">
                          {report.timestamp ? formatDistanceToNow(new Date(report.timestamp), { addSuffix: true }) : 'Unknown'}
                        </p>
                        <span className={cn('inline-flex mt-2 px-2 py-1 rounded-full text-xs font-medium capitalize', statusBadgeClass[report.status] || 'bg-muted text-muted-foreground')}>
                          {String(report.status || 'new').replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card className="overflow-hidden flex flex-col">
            {selectedReport ? (
              <>
                <div className="p-4 border-b border-border bg-card">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold truncate">{selectedReport.title || 'Admin Report'}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {selectedReport.user?.name || 'Unknown'} • {selectedReport.user?.email || 'No email'}
                      </p>
                    </div>
                    <span className={cn('px-3 py-1 rounded-full text-xs font-medium capitalize', statusBadgeClass[selectedReport.status] || 'bg-muted text-muted-foreground')}>
                      {String(selectedReport.status || 'new').replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
                  <div className="max-w-3xl space-y-5">
                    <div className="flex justify-start">
                      <div className="max-w-2xl rounded-2xl rounded-tl-sm bg-card border border-border px-4 py-3 shadow-sm">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                          <div>
                            <p className="font-semibold">{selectedReport.title || 'System report'}</p>
                            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                              {selectedReport.description || selectedReport.message || 'No detailed message available.'}
                            </p>
                            <div className="text-xs text-muted-foreground mt-3 flex flex-wrap gap-4">
                              <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {selectedReport.timestamp ? new Date(selectedReport.timestamp).toLocaleString('en-IN') : 'Unknown time'}</span>
                              <span>Reporter: {selectedReport.user?.type || 'Unknown'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-card border border-border px-4 py-4 space-y-3">
                      <p className="font-semibold">Report Context</p>
                      <div className="grid md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Path</p>
                          <p className="break-all">{selectedReport.path || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Phone</p>
                          <p>{selectedReport.user?.phone || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">UID</p>
                          <p className="break-all">{selectedReport.user?.uid || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Exact Timestamp</p>
                          <p className="break-all">{selectedReport.exactTimestamp || 'N/A'}</p>
                        </div>
                      </div>
                      {selectedReport.context?.browser?.userAgent && (
                        <div>
                          <p className="text-muted-foreground text-sm mb-1">User Agent</p>
                          <p className="text-sm break-all">{selectedReport.context.browser.userAgent}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-border bg-card">
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => handleStatusUpdate('in_progress')} disabled={savingStatus}>
                      Mark In Progress
                    </Button>
                    <Button onClick={() => handleStatusUpdate('resolved')} disabled={savingStatus}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark Resolved
                    </Button>
                    {selectedReport.path && (
                      <a href={selectedReport.path} target="_blank" rel="noreferrer">
                        <Button variant="ghost">
                          Open Path
                          <ExternalLink className="h-4 w-4 ml-2" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-8 text-muted-foreground">
                <div>
                  <Bot className="h-16 w-16 mx-auto mb-4 text-primary/70" />
                  <h3 className="text-3xl font-semibold text-foreground">Welcome to Admin WhatsApp Direct</h3>
                  <p className="mt-3 text-lg text-muted-foreground">
                    Select a report or admin-side conversation from the left panel to review system-wide issues.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
