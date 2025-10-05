
"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Phone, Shield, Edit, Save, XCircle, Bell, Trash2, KeyRound, Eye, EyeOff, FileText, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { auth } from '@/lib/firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';


// --- Sub-components for better structure ---

const SectionCard = ({ title, description, children, footer }) => (
    <motion.div 
        className="bg-gray-800/50 border border-gray-700 rounded-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-bold text-white">{title}</h2>
            {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-gray-900/30 border-t border-gray-700 rounded-b-xl">{footer}</div>}
    </motion.div>
);

const DeleteAccountModal = ({ isOpen, setIsOpen }) => {
    const [confirmationText, setConfirmationText] = useState("");
    const isDeleteDisabled = confirmationText !== "DELETE";

    const handleDelete = async () => {
        try {
            const user = auth.currentUser;
            if (user) {
                await user.delete();
                alert("Account deleted successfully.");
                // You would typically redirect the user to a logged-out page here.
                window.location.href = "/";
            }
        } catch (error) {
            console.error("Error deleting account:", error);
            alert(`Failed to delete account: ${error.message}. You may need to sign in again to perform this action.`);
        } finally {
            setIsOpen(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md bg-red-900/20 border-red-500 text-white backdrop-blur-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-red-400">Permanently Delete Account</DialogTitle>
                    <DialogDescription className="text-red-300/80">
                        This action is irreversible. All your data, including restaurants, orders, and customer information, will be permanently lost.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="delete-confirm" className="font-semibold">To confirm, please type "DELETE" in the box below.</Label>
                    <input
                        id="delete-confirm"
                        type="text"
                        value={confirmationText}
                        onChange={(e) => setConfirmationText(e.target.value)}
                        className="mt-2 w-full p-2 border rounded-md bg-gray-800 border-red-500/50 text-white focus:ring-red-400"
                        placeholder="DELETE"
                    />
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button 
                        variant="destructive"
                        disabled={isDeleteDisabled}
                        onClick={handleDelete}
                    >
                        I understand, delete my account
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// --- Main Page Component ---
export default function SettingsPage() {
    const [user, setUser] = useState(null);
    const [editedUser, setEditedUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
    const [showNewPass, setShowNewPass] = useState(false);

    useEffect(() => {
        const fetchUserData = async () => {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                setLoading(false);
                return;
            }
            try {
                const idToken = await currentUser.getIdToken();
                const response = await fetch('/api/owner/settings', {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to fetch user data');
                }
                
                const data = await response.json();
                setUser(data);
                setEditedUser(data);
            } catch (error) {
                console.error("Error fetching user data:", error);
                alert(error.message);
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchUserData();
            } else {
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    const handleEditToggle = () => {
        if (isEditing) {
            setEditedUser(user);
        }
        setIsEditing(!isEditing);
    };

    const handleSave = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser || !editedUser) return;
        
        try {
            const idToken = await currentUser.getIdToken();
            const response = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}` 
                },
                body: JSON.stringify({
                    name: editedUser.name,
                    phone: editedUser.phone,
                    notifications: editedUser.notifications,
                    gstin: editedUser.gstin,
                    fssai: editedUser.fssai,
                    botPhoneNumberId: editedUser.botPhoneNumberId,
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update profile');
            }
            
            const updatedUser = await response.json();
            setUser(updatedUser);
            setEditedUser(updatedUser);
            setIsEditing(false);
            alert("Profile Updated Successfully!");

        } catch (error) {
            console.error("Error saving data:", error);
            alert(error.message);
        }
    };
    
    const handlePasswordUpdate = async (e) => {
        e.preventDefault();
        const currentUser = auth.currentUser;

        if (!currentUser) {
            alert("You must be logged in to change your password.");
            return;
        }
        if (passwords.new !== passwords.confirm) {
            alert("New password and confirm password do not match.");
            return;
        }
        if (passwords.new.length < 6) {
            alert("New password must be at least 6 characters long.");
            return;
        }
        
        try {
            const credential = EmailAuthProvider.credential(currentUser.email, passwords.current);
            await reauthenticateWithCredential(currentUser, credential);
            
            await updatePassword(currentUser, passwords.new);
            
            alert("Password updated successfully!");
            setPasswords({ current: '', new: '', confirm: '' });

        } catch (error) {
            console.error("Password update error:", error);
            alert(`Failed to update password: ${error.message}. Make sure your current password is correct.`);
        }
    };

    if (loading) {
        return (
            <div className="p-6 text-center h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        );
    }
    
    if (!user || !editedUser) {
         return (
            <div className="p-6 text-center h-screen flex items-center justify-center">
                <p>Could not load user data. Please log in again.</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 text-white min-h-screen bg-gray-900 space-y-8">
            <DeleteAccountModal isOpen={isDeleteModalOpen} setIsOpen={setDeleteModalOpen} />
            
            <h1 className="text-3xl font-bold tracking-tight">User Profile & Settings</h1>

            {/* Profile Information Section */}
            <SectionCard 
                title="Profile Information"
                description="View and manage your personal and restaurant details."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditing ? (
                            <>
                                <Button variant="secondary" onClick={handleEditToggle}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700"><Save className="mr-2 h-4 w-4"/> Save Changes</Button>
                            </>
                        ) : (
                            <Button onClick={handleEditToggle} className="bg-indigo-600 hover:bg-indigo-700"><Edit className="mr-2 h-4 w-4"/> Edit Profile</Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div className="flex flex-col items-center md:items-start gap-4">
                        <img 
                            src={user.profilePicture || `https://picsum.photos/seed/${user.email}/200/200`}
                            alt="Profile"
                            className="w-24 h-24 rounded-full border-4 border-gray-700"
                        />
                         <div className="text-center md:text-left">
                            <p className="text-2xl font-bold">{user.name}</p>
                             <span className="inline-flex items-center gap-2 mt-2 px-3 py-1 text-sm font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                <Shield size={14} />
                                {user.role || 'Owner'}
                            </span>
                        </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="fullName" className="flex items-center gap-2"><User size={14}/> Full Name</Label>
                            <input id="fullName" value={editedUser.name} onChange={e => setEditedUser({...editedUser, name: e.target.value})} disabled={!isEditing} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                        <div>
                            <Label htmlFor="email" className="flex items-center gap-2"><Mail size={14}/> Email Address</Label>
                            <input id="email" value={user.email} disabled className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14}/> Phone Number</Label>
                            <input id="phone" value={editedUser.phone} onChange={e => setEditedUser({...editedUser, phone: e.target.value})} disabled={!isEditing} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                        {user.role === 'owner' && (
                            <>
                                <div>
                                    <Label htmlFor="gstin" className="flex items-center gap-2"><FileText size={14}/> GSTIN</Label>
                                    <input id="gstin" value={editedUser.gstin} onChange={e => setEditedUser({...editedUser, gstin: e.target.value})} disabled={!isEditing} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 27ABCDE1234F1Z5"/>
                                </div>
                                <div>
                                    <Label htmlFor="fssai" className="flex items-center gap-2"><FileText size={14}/> FSSAI Number</Label>
                                    <input id="fssai" value={editedUser.fssai} onChange={e => setEditedUser({...editedUser, fssai: e.target.value})} disabled={!isEditing} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 10012345678901"/>
                                </div>
                                <div>
                                    <Label htmlFor="botPhoneNumberId" className="flex items-center gap-2"><Bot size={14}/> WhatsApp Bot Phone Number ID</Label>
                                    <input id="botPhoneNumberId" value={editedUser.botPhoneNumberId} onChange={e => setEditedUser({...editedUser, botPhoneNumberId: e.target.value})} disabled={!isEditing} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 15550921234"/>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </SectionCard>

            {/* Change Password Section */}
            <SectionCard
                title="Change Password"
                description="For your security, we recommend using a strong, unique password."
            >
                <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-md">
                     <div>
                        <Label htmlFor="currentPassword">Current Password</Label>
                        <input id="currentPassword" type="password" value={passwords.current} onChange={e => setPasswords({...passwords, current: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600" required />
                    </div>
                    <div className="relative">
                        <Label htmlFor="newPassword">New Password</Label>
                        <input id="newPassword" type={showNewPass ? "text" : "password"} value={passwords.new} onChange={e => setPasswords({...passwords, new: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600" required />
                        <button type="button" onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-9 text-gray-400">
                            {showNewPass ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                     <div>
                        <Label htmlFor="confirmPassword">Confirm New Password</Label>
                        <input id="confirmPassword" type="password" value={passwords.confirm} onChange={e => setPasswords({...passwords, confirm: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-gray-700 border-gray-600" required />
                    </div>
                    <div className="pt-2">
                        <Button type="submit"><KeyRound className="mr-2 h-4 w-4"/> Update Password</Button>
                    </div>
                </form>
            </SectionCard>

            {/* Notification Settings Section */}
            <SectionCard
                title="Notification Settings"
                description="Choose how you want to be notified."
            >
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                        <Label htmlFor="newOrders" className="flex flex-col">
                            <span>New Order Alerts</span>
                            <span className="text-xs text-gray-400">Receive an email for every new order placed.</span>
                        </Label>
                        <Switch id="newOrders" checked={editedUser.notifications.newOrders} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, newOrders: checked}})} disabled={!isEditing} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                         <Label htmlFor="dailySummary" className="flex flex-col">
                            <span>Daily Sales Summary</span>
                            <span className="text-xs text-gray-400">Get a WhatsApp message with your end-of-day sales report.</span>
                        </Label>
                        <Switch id="dailySummary" checked={editedUser.notifications.dailySummary} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, dailySummary: checked}})} disabled={!isEditing} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                         <Label htmlFor="marketing" className="flex flex-col">
                            <span>Promotional Emails</span>
                            <span className="text-xs text-gray-400">Receive news about new features and special offers.</span>
                        </Label>
                        <Switch id="marketing" checked={editedUser.notifications.marketing} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, marketing: checked}})} disabled={!isEditing} />
                    </div>
                </div>
            </SectionCard>
            
            {/* Delete Account Section */}
            <SectionCard
                title="Danger Zone"
                description="Manage risky account actions here."
            >
                <div className="flex justify-between items-center bg-red-900/20 p-4 rounded-lg border border-red-500/30">
                    <div>
                        <h3 className="font-bold text-red-400">Delete Account</h3>
                        <p className="text-sm text-red-300/80">Once you delete your account, there is no going back. Please be certain.</p>
                    </div>
                    <Button variant="destructive" onClick={() => setDeleteModalOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4"/> Delete My Account
                    </Button>
                </div>
            </SectionCard>

        </div>
    );
}
