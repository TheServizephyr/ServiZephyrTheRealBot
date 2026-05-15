'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import InfoDialog from '@/components/InfoDialog';
import { BriefcaseBusiness, RefreshCw, Search, Store, UserCog, Users } from 'lucide-react';

const statusClasses = {
  active: 'bg-green-500/10 text-green-400',
  inactive: 'bg-red-500/10 text-red-400',
  pending: 'bg-yellow-500/10 text-yellow-400',
};

const roleClasses = {
  manager: 'bg-purple-500/10 text-purple-400',
  bookings_manager: 'bg-cyan-500/10 text-cyan-400',
  chef: 'bg-orange-500/10 text-orange-400',
  waiter: 'bg-blue-500/10 text-blue-400',
  cashier: 'bg-green-500/10 text-green-400',
  order_taker: 'bg-slate-500/20 text-slate-300',
  custom: 'bg-pink-500/10 text-pink-400',
};

const formatDate = (value, withTime = false) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
};

const searchableText = (item) => [
  item.name,
  item.email,
  item.phone,
  item.roleDisplay,
  item.role,
  item.businessName,
  item.businessTypeLabel,
  item.ownerName,
  item.ownerEmail,
  item.userId,
].filter(Boolean).join(' ').toLowerCase();

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeeTable({ data, loading, error, emptyText, onSelect }) {
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="p-8 text-center">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        </TableCell>
      </TableRow>
    );
  }

  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="p-8 text-center text-destructive">
          Error: {error}
        </TableCell>
      </TableRow>
    );
  }

  if (data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="p-8 text-center text-muted-foreground">
          {emptyText}
        </TableCell>
      </TableRow>
    );
  }

  return data.map((employee, index) => (
    <TableRow
      key={employee.id}
      className="cursor-pointer hover:bg-muted/30"
      onClick={() => onSelect(employee)}
    >
      <TableCell className="w-10 text-muted-foreground">{index + 1}</TableCell>
      <TableCell>
        <div className="min-w-[180px]">
          <p className="font-medium">{employee.name}</p>
          <p className="text-xs text-muted-foreground break-all">{employee.email}</p>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">{employee.phone}</TableCell>
      <TableCell>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${roleClasses[employee.role] || 'bg-muted text-muted-foreground'}`}>
          {employee.roleDisplay || employee.role}
        </span>
      </TableCell>
      <TableCell>
        <div className="min-w-[180px]">
          <p className="font-medium">{employee.businessName}</p>
          <p className="text-xs text-muted-foreground">{employee.businessTypeLabel}</p>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="min-w-[160px]">
          <p className="font-medium">{employee.ownerName || 'N/A'}</p>
          <p className="text-xs text-muted-foreground break-all">{employee.ownerEmail || 'N/A'}</p>
        </div>
      </TableCell>
      <TableCell>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClasses[employee.status] || statusClasses.active}`}>
          {employee.status}
        </span>
      </TableCell>
      <TableCell className="hidden xl:table-cell text-muted-foreground">
        {formatDate(employee.acceptedAt || employee.addedAt || employee.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onSelect(employee); }}>
          View
        </Button>
      </TableCell>
    </TableRow>
  ));
}

function SummaryTable({ summaries }) {
  if (summaries.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No restaurant or outlet has staff yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Restaurant / Outlet</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead className="text-right">Active</TableHead>
          <TableHead className="text-right">Inactive</TableHead>
          <TableHead className="text-right">Pending</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaries.map((summary) => (
          <TableRow key={`${summary.collectionName}:${summary.id}`}>
            <TableCell>
              <div>
                <p className="font-medium">{summary.businessName}</p>
                <p className="text-xs text-muted-foreground">{summary.businessTypeLabel}</p>
              </div>
            </TableCell>
            <TableCell>
              <div>
                <p className="font-medium">{summary.ownerName || 'N/A'}</p>
                <p className="text-xs text-muted-foreground break-all">{summary.ownerEmail || 'N/A'}</p>
              </div>
            </TableCell>
            <TableCell className="text-right">{summary.activeEmployees}</TableCell>
            <TableCell className="text-right">{summary.inactiveEmployees}</TableCell>
            <TableCell className="text-right">{summary.pendingInvites}</TableCell>
            <TableCell className="text-right font-semibold">{summary.totalEmployees + summary.pendingInvites}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const fetchEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/employees', { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch employee data');
      }

      setEmployees(data.employees || []);
      setPendingInvites(data.pendingInvites || []);
      setSummaries(data.summaries || []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.message);
      setInfoDialog({ isOpen: true, title: 'Error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const allPeople = useMemo(() => [...employees, ...pendingInvites], [employees, pendingInvites]);
  const query = search.trim().toLowerCase();
  const filterBySearch = (items) => (
    query ? items.filter((item) => searchableText(item).includes(query)) : items
  );

  const filtered = {
    all: filterBySearch(allPeople),
    active: filterBySearch(employees.filter((employee) => employee.status === 'active')),
    inactive: filterBySearch(employees.filter((employee) => employee.status === 'inactive')),
    pending: filterBySearch(pendingInvites),
  };

  const selectedAllowedPages = Array.isArray(selectedEmployee?.customAllowedPages)
    ? selectedEmployee.customAllowedPages
    : [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employee Management</h1>
          <p className="text-sm text-muted-foreground">
            Restaurant-wise staff accounts, roles, outlet links, and pending invitations.
          </p>
        </div>
        <Button variant="outline" onClick={fetchEmployees} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={Users} label="Total Employees" value={counts.totalEmployees || 0} />
        <StatCard icon={UserCog} label="Active" value={counts.activeEmployees || 0} />
        <StatCard icon={BriefcaseBusiness} label="Inactive" value={counts.inactiveEmployees || 0} />
        <StatCard icon={RefreshCw} label="Pending Invites" value={counts.pendingInvites || 0} />
        <StatCard icon={Store} label="Outlets With Staff" value={counts.businessesWithStaff || 0} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <TabsList className="w-full justify-start overflow-x-auto bg-muted/50 p-1 md:w-auto">
            <TabsTrigger value="all">All ({filtered.all.length})</TabsTrigger>
            <TabsTrigger value="active">Active ({filtered.active.length})</TabsTrigger>
            <TabsTrigger value="inactive">Inactive ({filtered.inactive.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({filtered.pending.length})</TabsTrigger>
            <TabsTrigger value="restaurants">By Restaurant ({summaries.length})</TabsTrigger>
          </TabsList>
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee, role, restaurant..."
              className="pl-10"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <TabsContent value="restaurants" className="m-0">
              {loading ? (
                <div className="p-8 text-center">
                  <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="p-8 text-center text-destructive">Error: {error}</p>
              ) : (
                <SummaryTable summaries={summaries} />
              )}
            </TabsContent>

            {['all', 'active', 'inactive', 'pending'].map((tab) => (
              <TabsContent key={tab} value={tab} className="m-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead className="hidden lg:table-cell">Phone</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Restaurant / Outlet</TableHead>
                      <TableHead className="hidden md:table-cell">Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden xl:table-cell">Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <EmployeeTable
                      data={filtered[tab]}
                      loading={loading}
                      error={error}
                      emptyText="No employees found for this tab."
                      onSelect={setSelectedEmployee}
                    />
                  </TableBody>
                </Table>
              </TabsContent>
            ))}
          </CardContent>
        </Card>
      </Tabs>

      <Dialog open={Boolean(selectedEmployee)} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedEmployee?.name || 'Employee Details'}</DialogTitle>
            <DialogDescription>
              Role and restaurant assignment details for this staff account.
            </DialogDescription>
          </DialogHeader>

          {selectedEmployee && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Employee Name</p>
                  <p className="font-medium">{selectedEmployee.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Role</p>
                  <p className="font-medium">{selectedEmployee.roleDisplay || selectedEmployee.role || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium break-all">{selectedEmployee.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="font-medium">{selectedEmployee.phone || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{selectedEmployee.status || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User ID</p>
                  <p className="font-medium break-all">{selectedEmployee.userId || selectedEmployee.inviteCode || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Restaurant / Outlet</p>
                  <p className="font-medium">{selectedEmployee.businessName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Business Type</p>
                  <p className="font-medium">{selectedEmployee.businessTypeLabel || selectedEmployee.businessType || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Owner</p>
                  <p className="font-medium">{selectedEmployee.ownerName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Owner Email</p>
                  <p className="font-medium break-all">{selectedEmployee.ownerEmail || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Joined / Invited</p>
                  <p className="font-medium">
                    {formatDate(selectedEmployee.acceptedAt || selectedEmployee.addedAt || selectedEmployee.createdAt, true)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Updated / Expiry</p>
                  <p className="font-medium">
                    {formatDate(selectedEmployee.updatedAt || selectedEmployee.expiresAt, true)}
                  </p>
                </div>
              </div>

              {selectedEmployee.role === 'custom' && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Custom Page Access</p>
                  {selectedAllowedPages.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedAllowedPages.map((page) => (
                        <span key={page} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {page}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No custom pages recorded.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
