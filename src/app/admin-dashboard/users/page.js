

'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { MoreVertical, Eye, UserX, UserCheck, Search, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import InfoDialog from '@/components/InfoDialog';


const UserRow = ({ user, onUpdateStatus }) => {
  const statusClasses = {
    Active: 'bg-green-500/10 text-green-400',
    Blocked: 'bg-red-500/10 text-red-400',
  };

  const roleClasses = {
    Owner: 'bg-primary/10 text-primary',
    Customer: 'bg-blue-500/10 text-blue-400',
    'Street Vendor': 'bg-orange-500/10 text-orange-400',
    'Shop Owner': 'bg-purple-500/10 text-purple-400',
    Rider: 'bg-cyan-500/10 text-cyan-400',
    Admin: 'bg-red-500/10 text-red-400'
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={user.profilePictureUrl || `https://picsum.photos/seed/${user.id}/40/40`} />
            <AvatarFallback>{user.name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{user.name}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">{user.email}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">{user.phone}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${roleClasses[user.role]}`}>
          {user.role}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">{user.joinDate ? new Date(user.joinDate).toLocaleDateString() : 'N/A'}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[user.status]}`}>
          {user.status}
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
            <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View Activity</DropdownMenuItem>
            {(user.role === 'Owner' || user.role === 'Street Vendor' || user.role === 'Shop Owner') && (
              <DropdownMenuItem onClick={() => {
                const dashboardPath = user.role === 'Street Vendor'
                  ? '/street-vendor-dashboard'
                  : '/owner-dashboard';
                window.location.href = `${dashboardPath}?impersonate_owner_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Owner
              </DropdownMenuItem>
            )}
            {user.role === 'Customer' && (
              <DropdownMenuItem onClick={() => {
                window.location.href = `/customer-dashboard?impersonate_user_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Customer
              </DropdownMenuItem>
            )}
            {user.role === 'Rider' && (
              <DropdownMenuItem onClick={() => {
                window.location.href = `/rider-dashboard?impersonate_user_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Rider
              </DropdownMenuItem>
            )}
            {user.status === 'Active' ? (
              <DropdownMenuItem className="text-red-500" onClick={() => onUpdateStatus(user.id, 'Blocked')}><UserX className="mr-2 h-4 w-4" /> Block User</DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-green-500" onClick={() => onUpdateStatus(user.id, 'Active')}><UserCheck className="mr-2 h-4 w-4" /> Unblock User</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', { headers });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch users');
      }
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleUpdateStatus = async (userId, newStatus) => {
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ userId, status: newStatus })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to update user');
      }
      fetchUsers();
    } catch (err) {
      setInfoDialog({ isOpen: true, title: "Error", message: err.message });
    }
  };

  const filteredUsers = (role) =>
    users.filter(u => u.role === role && (u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())));

  const renderTableContent = (role) => {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="text-center p-8">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          </TableCell>
        </TableRow>
      );
    }
    if (error) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="text-center p-8 text-destructive">
            Error: {error}
          </TableCell>
        </TableRow>
      );
    }
    const data = filteredUsers(role);
    if (data.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={7} className="text-center p-8 text-muted-foreground">
            No users found for this role.
          </TableCell>
        </TableRow>
      )
    }
    return data.map(u => <UserRow key={u.id} user={u} onUpdateStatus={handleUpdateStatus} />);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
      <Tabs defaultValue="owners">
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList className="w-full md:w-auto grid grid-cols-3 md:grid-cols-6">
            <TabsTrigger value="owners">Owners</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="street-vendors">Street Vendors</TabsTrigger>
            <TabsTrigger value="shop-owners">Shop Owners</TabsTrigger>
            <TabsTrigger value="riders">Riders</TabsTrigger>
            <TabsTrigger value="admins">Admins</TabsTrigger>
          </TabsList>
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Join Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TabsContent value="owners" className="contents">
                  {renderTableContent('Owner')}
                </TabsContent>
                <TabsContent value="customers" className="contents">
                  {renderTableContent('Customer')}
                </TabsContent>
                <TabsContent value="street-vendors" className="contents">
                  {renderTableContent('Street Vendor')}
                </TabsContent>
                <TabsContent value="shop-owners" className="contents">
                  {renderTableContent('Shop Owner')}
                </TabsContent>
                <TabsContent value="riders" className="contents">
                  {renderTableContent('Rider')}
                </TabsContent>
                <TabsContent value="admins" className="contents">
                  {renderTableContent('Admin')}
                </TabsContent>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>
    </motion.div>
  );
}
