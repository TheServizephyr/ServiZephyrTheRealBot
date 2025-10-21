
'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Mail, RefreshCw, AlertTriangle, User, Clock, Link as LinkIcon, Check, MoreVertical, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import InfoDialog from '@/components/InfoDialog';

const ReportRow = ({ report, onUpdateStatus }) => {
    const statusConfig = {
        'new': 'text-blue-400 bg-blue-500/10',
        'in_progress': 'text-yellow-400 bg-yellow-500/10',
        'resolved': 'text-green-400 bg-green-500/10',
    };

    return (
        <TableRow>
            <TableCell>
                <div className="font-medium text-foreground">{report.title}</div>
                <div className="text-sm text-muted-foreground truncate max-w-xs">{report.message}</div>
            </TableCell>
            <TableCell>
                <div className="font-medium">{report.user.name}</div>
                <div className="text-sm text-muted-foreground">{report.user.email}</div>
            </TableCell>
            <TableCell>
                <a href={report.path} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <LinkIcon size={14} /> {report.path}
                </a>
            </TableCell>
             <TableCell className="text-muted-foreground">
                {report.timestamp ? formatDistanceToNow(new Date(report.timestamp.seconds * 1000), { addSuffix: true }) : 'N/A'}
            </TableCell>
            <TableCell>
                 <span className={cn('px-2 py-1 text-xs font-semibold rounded-full capitalize', statusConfig[report.status])}>
                    {report.status}
                </span>
            </TableCell>
            <TableCell className="text-right">
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onUpdateStatus(report.id, 'in_progress')}>Mark as In Progress</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpdateStatus(report.id, 'resolved')}>Mark as Resolved</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-500"><Trash2 className="mr-2 h-4 w-4"/> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </TableCell>
        </TableRow>
    );
};


export default function MailboxPage() {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [activeTab, setActiveTab] = useState('new');

    const fetchReports = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
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
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load reports: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };
    
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchReports();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleUpdateStatus = async (reportId, status) => {
         try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();

            await fetch('/api/admin/mailbox', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ reportId, status }),
            });
            
            fetchReports(true); // Refresh data
        } catch(error) {
             setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to update status: ${error.message}` });
        }
    };

    const filteredReports = useMemo(() => {
        if (activeTab === 'all') return reports;
        return reports.filter(r => r.status === activeTab);
    }, [reports, activeTab]);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 md:p-6 space-y-6">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Admin Mailbox</h1>
                    <p className="text-muted-foreground mt-1">Review error reports submitted by restaurant owners.</p>
                </div>
                 <Button onClick={() => fetchReports(true)} variant="outline" disabled={loading}>
                    <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                </Button>
            </header>
            
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full md:w-auto">
                    <TabsTrigger value="new">New</TabsTrigger>
                    <TabsTrigger value="in_progress">In Progress</TabsTrigger>
                    <TabsTrigger value="resolved">Resolved</TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
                 <Card className="mt-4">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Report Details</TableHead>
                                        <TableHead>Submitted By</TableHead>
                                        <TableHead>Page</TableHead>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        [...Array(5)].map((_, i) => (
                                            <TableRow key={i}><TableCell colSpan={6} className="p-4"><div className="h-8 bg-muted rounded-md animate-pulse"></div></TableCell></TableRow>
                                        ))
                                    ) : filteredReports.length > 0 ? (
                                        filteredReports.map(report => (
                                            <ReportRow key={report.id} report={report} onUpdateStatus={handleUpdateStatus} />
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center p-16 text-muted-foreground">
                                                <Mail className="mx-auto h-12 w-12" />
                                                <p className="mt-4 font-semibold">Mailbox is empty!</p>
                                                <p className="text-sm">No reports in this category.</p>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </Tabs>
        </motion.div>
    );
}

