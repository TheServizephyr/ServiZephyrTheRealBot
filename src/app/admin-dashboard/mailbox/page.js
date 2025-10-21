
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Inbox, RefreshCw, AlertTriangle, User, FileText, Clock, Trash2, ChevronRight, CheckCircle, Mail, Mailbox } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const MailboxPage = () => {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedReport, setSelectedReport] = useState(null);

    const fetchReports = async (isManual = false) => {
        if (!isManual) setLoading(true);
        setError(null);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Admin authentication required.");
            const idToken = await user.getIdToken();

            const res = await fetch('/api/admin/mailbox', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch reports.');
            }
            const data = await res.json();
            setReports(data.reports || []);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isManual) setLoading(false);
        }
    };
    
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchReports();
            } else {
                setLoading(false);
                setError("You must be logged in as an admin to view this page.");
            }
        });
        return () => unsubscribe();
    }, []);

    const handleMarkAsResolved = async (reportId) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Admin authentication required.");
            const idToken = await user.getIdToken();

            await fetch('/api/admin/mailbox', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reportId })
            });

            // Optimistically update UI
            setReports(prev => prev.map(r => r.id === reportId ? { ...r, resolved: true } : r));
            if(selectedReport && selectedReport.id === reportId) {
                setSelectedReport(prev => ({...prev, resolved: true}));
            }
        } catch (err) {
            alert(`Failed to resolve: ${err.message}`);
        }
    };

    const handleDelete = async (reportId) => {
        if (!window.confirm("Are you sure you want to permanently delete this report?")) return;
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Admin authentication required.");
            const idToken = await user.getIdToken();
            await fetch('/api/admin/mailbox', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reportId })
            });
            setReports(prev => prev.filter(r => r.id !== reportId));
            if(selectedReport && selectedReport.id === reportId) {
                setSelectedReport(null);
            }
        } catch(err) {
            alert(`Failed to delete: ${err.message}`);
        }
    };

    return (
        <div className="h-full flex flex-col md:flex-row bg-background text-foreground">
            <div className={cn("flex flex-col border-r border-border", selectedReport ? "hidden md:flex w-full md:w-1/3" : "w-full")}>
                <div className="p-4 border-b border-border flex justify-between items-center">
                    <h1 className="text-xl font-bold flex items-center gap-2"><Mailbox/> Admin Mailbox</h1>
                     <Button onClick={() => fetchReports(true)} variant="ghost" size="icon">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''}/>
                    </Button>
                </div>
                <div className="overflow-y-auto">
                    {loading ? (
                        <p className="p-4 text-muted-foreground">Loading reports...</p>
                    ) : error ? (
                        <p className="p-4 text-destructive">{error}</p>
                    ) : reports.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            <Inbox size={48} className="mx-auto mb-4"/>
                            <h2 className="font-semibold">All Clear!</h2>
                            <p>No reports from users at this time.</p>
                        </div>
                    ) : (
                        reports.map(report => (
                            <div 
                                key={report.id}
                                onClick={() => setSelectedReport(report)}
                                className={cn(
                                    "p-4 border-b border-border cursor-pointer hover:bg-muted",
                                    selectedReport?.id === report.id && "bg-muted",
                                    report.resolved && "opacity-50"
                                )}
                            >
                                <div className="flex justify-between items-start">
                                    <p className="font-semibold text-foreground truncate w-4/5">{report.errorTitle}</p>
                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                        {formatDistanceToNow(parseISO(report.timestamp), { addSuffix: true })}
                                    </span>
                                </div>
                                <p className="text-sm text-muted-foreground truncate">{report.user.displayName || report.user.email}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className={cn("flex-1 flex-col", selectedReport ? "flex" : "hidden md:flex")}>
                {selectedReport ? (
                    <>
                        <div className="p-4 border-b border-border">
                             <Button variant="ghost" size="icon" className="md:hidden mr-2" onClick={() => setSelectedReport(null)}>
                                <ChevronRight className="rotate-180"/>
                            </Button>
                            <h2 className="text-lg font-bold text-foreground inline-block">{selectedReport.errorTitle}</h2>
                        </div>
                        <div className="p-6 flex-grow overflow-y-auto space-y-6">
                            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted">
                                <div className="p-3 bg-background rounded-full"><User/></div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Reported By</p>
                                    <p className="font-semibold">{selectedReport.user.displayName} ({selectedReport.user.email})</p>
                                </div>
                            </div>
                             <div className="flex items-center gap-4 p-4 rounded-lg bg-muted">
                                <div className="p-3 bg-background rounded-full"><FileText/></div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Page</p>
                                    <p className="font-semibold font-mono">{selectedReport.pathname}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted">
                                <div className="p-3 bg-background rounded-full"><Clock/></div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Time</p>
                                    <p className="font-semibold">{new Date(selectedReport.timestamp).toLocaleString()}</p>
                                </div>
                            </div>
                            <div className="border-t border-border pt-4">
                                <h3 className="font-semibold mb-2">Error Message:</h3>
                                <p className="text-muted-foreground bg-muted p-4 rounded-lg whitespace-pre-wrap">{selectedReport.errorMessage}</p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-border bg-card flex justify-end gap-2">
                             <Button variant="destructive" onClick={() => handleDelete(selectedReport.id)}><Trash2 size={16} className="mr-2"/>Delete</Button>
                             {!selectedReport.resolved ? (
                                <Button variant="default" onClick={() => handleMarkAsResolved(selectedReport.id)}><CheckCircle size={16} className="mr-2"/> Mark as Resolved</Button>
                             ) : (
                                 <div className="flex items-center gap-2 text-sm font-semibold text-green-500"><CheckCircle size={16}/> Resolved</div>
                             )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Mail size={48} className="mx-auto mb-4"/>
                            <p>Select a report to view its details.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MailboxPage;
