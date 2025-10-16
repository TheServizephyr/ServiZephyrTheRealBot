
"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Phone, Shield, Edit, Save, XCircle, Bell, Trash2, KeyRound, Eye, EyeOff, FileText, Bot, Truck, Image as ImageIcon, Upload, X, IndianRupee, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import Image from 'next/image';

// --- Sub-components for better structure ---

const SectionCard = ({ title, description, children, footer }) => (
    <motion.div 
        className="bg-card border border-border rounded-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-muted/30 border-t border-border rounded-b-xl">{footer}</div>}
    </motion.div>
);

const DeleteAccountModal = ({ isOpen, setIsOpen }) => {
    const [confirmationText, setConfirmationText] = useState("");
    const isDeleteDisabled = confirmationText !== "DELETE";

    const handleDelete = async () => {
        try {
            const user = getAuth().currentUser;
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
            <DialogContent className="sm:max-w-md bg-destructive/10 border-destructive text-foreground backdrop-blur-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-destructive-foreground">Permanently Delete Account</DialogTitle>
                    <DialogDescription className="text-destructive-foreground/80">
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
                        className="mt-2 w-full p-2 border rounded-md bg-background border-destructive/50 text-foreground focus:ring-destructive"
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


const ImageUpload = ({ label, currentImage, onFileSelect, isEditing }) => {
    const fileInputRef = React.useRef(null);
  
    const handleFileChange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          onFileSelect(reader.result);
        };
        reader.readAsDataURL(file);
      }
    };
  
    return (
      <div>
        <Label className="flex items-center gap-2"><ImageIcon size={14}/> {label}</Label>
        <div className="mt-2 flex items-center gap-4">
          <div className="relative w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/50 overflow-hidden">
            {currentImage ? (
                <Image src={currentImage} alt={label} layout="fill" objectFit="cover" />
            ) : (
                <ImageIcon size={24} className="text-muted-foreground" />
            )}
          </div>
          {isEditing && (
            <>
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} className="mr-2"/> Upload
              </Button>
            </>
          )}
        </div>
      </div>
    );
};


// --- Main Page Component ---
export default function SettingsPage() {
    const [user, setUser] = useState(null);
    const [editedUser, setEditedUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isEditingMedia, setIsEditingMedia] = useState(false);
    const [isEditingPayment, setIsEditingPayment] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
    const [showNewPass, setShowNewPass] = useState(false);
    const bannerInputRef = React.useRef(null);

    const defaultAddress = {
        street: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN'
    };

    useEffect(() => {
        const fetchUserData = async () => {
            const currentUser = getAuth().currentUser;
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
                const userData = {
                    ...data,
                    bannerUrls: data.bannerUrls || [],
                    address: data.address && typeof data.address === 'object' ? data.address : defaultAddress
                };
                setUser(userData);
                setEditedUser(userData);
            } catch (error) {
                console.error("Error fetching user data:", error);
                alert(error.message);
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = getAuth().onAuthStateChanged(user => {
            if (user) {
                fetchUserData();
            } else {
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    const handleEditToggle = (section) => {
        if (section === 'profile') {
            if (isEditingProfile) {
                // When cancelling, revert changes
                setEditedUser(user);
            }
            setIsEditingProfile(!isEditingProfile);
        } else if (section === 'media') {
            if (isEditingMedia) {
                setEditedUser(user);
            }
            setIsEditingMedia(!isEditingMedia);
        } else if (section === 'payment') {
            if (isEditingPayment) {
                 setEditedUser(user);
            }
            setIsEditingPayment(!isEditingPayment);
        }
    };
    
    const handleAddressChange = (field, value) => {
      setEditedUser(prev => ({
          ...prev,
          address: { ...prev.address, [field]: value }
      }));
    };

    const handleBannerFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditedUser(prev => ({...prev, bannerUrls: [...(prev.bannerUrls || []), reader.result]}));
            };
            reader.readAsDataURL(file);
        }
    };

    const removeBannerImage = (index) => {
        setEditedUser(prev => ({...prev, bannerUrls: prev.bannerUrls.filter((_, i) => i !== index)}));
    };

    const handleSave = async (section) => {
        const currentUser = getAuth().currentUser;
        if (!currentUser || !editedUser) return;
        
        let payload = {};
        if (section === 'profile') {
            payload = {
                name: editedUser.name,
                phone: editedUser.phone,
                notifications: editedUser.notifications,
                gstin: editedUser.gstin,
                fssai: editedUser.fssai,
                botPhoneNumberId: editedUser.botPhoneNumberId,
                address: editedUser.address, // Pass the structured address
            };
        } else if (section === 'media') {
            payload = {
                logoUrl: editedUser.logoUrl,
                bannerUrls: editedUser.bannerUrls,
            };
        } else if (section === 'payment') {
            payload = {
                deliveryCharge: editedUser.deliveryCharge,
                codEnabled: editedUser.codEnabled,
            }
        }

        try {
            const idToken = await currentUser.getIdToken();
            const response = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}` 
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update settings');
            }
            
            const updatedUser = await response.json();
             const finalUser = {
                ...updatedUser,
                address: updatedUser.address && typeof updatedUser.address === 'object' ? updatedUser.address : defaultAddress
            };
            setUser(finalUser);
            setEditedUser(finalUser);
            if (section === 'profile') setIsEditingProfile(false);
            if (section === 'media') setIsEditingMedia(false);
            if (section === 'payment') setIsEditingPayment(false);
            alert("Updated Successfully!");

        } catch (error) {
            console.error("Error saving data:", error);
            alert(error.message);
        }
    };
    
    const handlePasswordUpdate = async (e) => {
        e.preventDefault();
        const currentUser = getAuth().currentUser;

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
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8">
            <DeleteAccountModal isOpen={isDeleteModalOpen} setIsOpen={setDeleteModalOpen} />
            
            <h1 className="text-3xl font-bold tracking-tight">User Profile & Settings</h1>

            {/* Profile Information Section */}
            <SectionCard 
                title="Profile Information"
                description="Manage your personal and restaurant business details."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditingProfile ? (
                            <>
                                <Button variant="secondary" onClick={() => handleEditToggle('profile')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save Profile</Button>
                            </>
                        ) : (
                            <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4"/> Edit Profile</Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                     <div className="flex items-center gap-4">
                         <div className="relative w-24 h-24 rounded-full border-4 border-border overflow-hidden">
                            <Image 
                                src={user.profilePicture || `https://picsum.photos/seed/${user.email}/200/200`}
                                alt="Profile"
                                layout="fill"
                                objectFit="cover"
                            />
                        </div>
                         <div>
                            <p className="text-2xl font-bold">{user.name}</p>
                             <span className="inline-flex items-center gap-2 mt-2 px-3 py-1 text-sm font-semibold rounded-full bg-primary/10 text-primary border border-primary/20">
                                <Shield size={14} />
                                {user.role || 'Owner'}
                            </span>
                        </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="fullName" className="flex items-center gap-2"><User size={14}/> Full Name</Label>
                            <input id="fullName" value={editedUser.name} onChange={e => setEditedUser({...editedUser, name: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                        <div>
                            <Label htmlFor="email" className="flex items-center gap-2"><Mail size={14}/> Email Address</Label>
                            <input id="email" value={user.email} disabled className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-50 disabled:cursor-not-allowed" />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14}/> Phone Number</Label>
                            <input id="phone" value={editedUser.phone} onChange={e => setEditedUser({...editedUser, phone: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                    </div>
                    {user.role === 'owner' && (
                        <>
                           <div className="space-y-4 md:col-span-2 p-4 border border-dashed border-border rounded-lg">
                                <h4 className="font-semibold flex items-center gap-2"><MapPin size={16}/> Restaurant Address</h4>
                                <div>
                                    <Label htmlFor="street">Street Address</Label>
                                    <input id="street" type="text" value={editedUser.address.street} onChange={(e) => handleAddressChange('street', e.target.value)} placeholder="Street Address" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile}/>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="city">City</Label>
                                        <input id="city" type="text" value={editedUser.address.city} onChange={(e) => handleAddressChange('city', e.target.value)} placeholder="City" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile}/>
                                    </div>
                                    <div>
                                        <Label htmlFor="postalCode">Postal Code</Label>
                                        <input id="postalCode" type="text" value={editedUser.address.postalCode} onChange={(e) => handleAddressChange('postalCode', e.target.value)} placeholder="Postal Code" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile}/>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="state">State</Label>
                                        <input id="state" type="text" value={editedUser.address.state} onChange={(e) => handleAddressChange('state', e.target.value)} placeholder="State" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile}/>
                                    </div>
                                    <div>
                                         <Label htmlFor="country">Country</Label>
                                         <input id="country" type="text" value={editedUser.address.country} onChange={(e) => handleAddressChange('country', e.target.value)} placeholder="Country" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile}/>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <Label htmlFor="gstin" className="flex items-center gap-2"><FileText size={14}/> GSTIN</Label>
                                    <input id="gstin" value={editedUser.gstin} onChange={e => setEditedUser({...editedUser, gstin: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 27ABCDE1234F1Z5"/>
                                </div>
                                <div>
                                    <Label htmlFor="fssai" className="flex items-center gap-2"><FileText size={14}/> FSSAI Number</Label>
                                    <input id="fssai" value={editedUser.fssai} onChange={e => setEditedUser({...editedUser, fssai: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 10012345678901"/>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <Label htmlFor="botPhoneNumberId" className="flex items-center gap-2"><Bot size={14}/> WhatsApp Bot Phone Number ID</Label>
                                    <input id="botPhoneNumberId" value={editedUser.botPhoneNumberId} onChange={e => setEditedUser({...editedUser, botPhoneNumberId: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 15550921234"/>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </SectionCard>

            {user.role === 'owner' && (
            <>
                <SectionCard
                    title="Media & Branding"
                    description="Upload your restaurant's logo and banner images."
                    footer={
                         <div className="flex justify-end gap-3">
                            {isEditingMedia ? (
                                <>
                                    <Button variant="secondary" onClick={() => handleEditToggle('media')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                    <Button onClick={() => handleSave('media')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save Media</Button>
                                </>
                            ) : (
                                <Button onClick={() => handleEditToggle('media')}><Edit className="mr-2 h-4 w-4"/> Edit Media</Button>
                            )}
                        </div>
                    }
                >
                    <div className="space-y-6">
                        <ImageUpload
                            label="Logo Image"
                            currentImage={editedUser.logoUrl}
                            onFileSelect={(dataUrl) => setEditedUser({ ...editedUser, logoUrl: dataUrl })}
                            isEditing={isEditingMedia}
                        />
                        <div>
                            <Label className="flex items-center gap-2"><ImageIcon size={14}/> Banner Images</Label>
                            <div className="mt-2 flex flex-wrap items-center gap-4">
                                {editedUser.bannerUrls?.map((url, index) => (
                                    <div key={index} className="relative group w-28 h-20 rounded-lg overflow-hidden border-2 border-border">
                                        <Image src={url} alt={`Banner ${index+1}`} layout="fill" objectFit="cover" />
                                        {isEditingMedia && (
                                            <button 
                                                onClick={() => removeBannerImage(index)}
                                                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X size={12}/>
                                            </button>
                                        )}
                                    </div>
                                ))}
                                    {isEditingMedia && (
                                    <>
                                        <input type="file" accept="image/*" ref={bannerInputRef} onChange={handleBannerFileChange} className="hidden" />
                                        <button type="button" onClick={() => bannerInputRef.current?.click()} className="w-28 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/50">
                                            <Upload size={20}/>
                                            <span className="text-xs mt-1">Add Banner</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </SectionCard>
                <SectionCard
                    title="Payment Settings"
                    description="Manage delivery charges and payment methods for your customers."
                     footer={
                        <div className="flex justify-end gap-3">
                            {isEditingPayment ? (
                                <>
                                    <Button variant="secondary" onClick={() => handleEditToggle('payment')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                    <Button onClick={() => handleSave('payment')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save Settings</Button>
                                </>
                            ) : (
                                <Button onClick={() => handleEditToggle('payment')}><Edit className="mr-2 h-4 w-4"/> Edit Payment Settings</Button>
                            )}
                        </div>
                    }
                >
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="deliveryCharge" className="flex items-center gap-2"><Truck size={14}/> Base Delivery Charge (₹)</Label>
                            <input id="deliveryCharge" type="number" value={editedUser.deliveryCharge} onChange={e => setEditedUser({...editedUser, deliveryCharge: e.target.value})} disabled={!isEditingPayment} className="mt-1 w-full max-w-xs p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 30"/>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <Label htmlFor="codEnabled" className="flex flex-col">
                                <span>Enable Cash on Delivery (COD)</span>
                                <span className="text-xs text-muted-foreground">Allow customers to pay with cash upon delivery.</span>
                            </Label>
                            <Switch id="codEnabled" checked={editedUser.codEnabled} onCheckedChange={(checked) => setEditedUser({...editedUser, codEnabled: checked})} disabled={!isEditingPayment} />
                        </div>
                    </div>
                </SectionCard>
            </>
            )}

            <SectionCard
                title="Notification Settings"
                description="Choose how you want to be notified."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditingProfile ? (
                            <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save Notifications</Button>
                        ) : (
                           <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4"/> Edit Notifications</Button>
                        )}
                    </div>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <Label htmlFor="newOrders" className="flex flex-col">
                            <span>New Order Alerts</span>
                            <span className="text-xs text-muted-foreground">Receive a real-time notification for every new order.</span>
                        </Label>
                        <Switch id="newOrders" checked={editedUser.notifications.newOrders} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, newOrders: checked}})} disabled={!isEditingProfile} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                         <Label htmlFor="dailySummary" className="flex flex-col">
                            <span>Daily Sales Summary</span>
                            <span className="text-xs text-muted-foreground">Get a WhatsApp message with your end-of-day sales report.</span>
                        </Label>
                        <Switch id="dailySummary" checked={editedUser.notifications.dailySummary} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, dailySummary: checked}})} disabled={!isEditingProfile} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                         <Label htmlFor="marketing" className="flex flex-col">
                            <span>Promotional Emails</span>
                            <span className="text-xs text-muted-foreground">Receive news about new features and special offers.</span>
                        </Label>
                        <Switch id="marketing" checked={editedUser.notifications.marketing} onCheckedChange={(checked) => setEditedUser({...editedUser, notifications: {...editedUser.notifications, marketing: checked}})} disabled={!isEditingProfile} />
                    </div>
                </div>
            </SectionCard>
            
            <SectionCard
                title="Change Password"
                description="For your security, we recommend using a strong, unique password."
            >
                <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-md">
                     <div>
                        <Label htmlFor="currentPassword">Current Password</Label>
                        <input id="currentPassword" type="password" value={passwords.current} onChange={e => setPasswords({...passwords, current: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                    </div>
                    <div className="relative">
                        <Label htmlFor="newPassword">New Password</Label>
                        <input id="newPassword" type={showNewPass ? "text" : "password"} value={passwords.new} onChange={e => setPasswords({...passwords, new: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                        <button type="button" onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-9 text-muted-foreground">
                            {showNewPass ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                     <div>
                        <Label htmlFor="confirmPassword">Confirm New Password</Label>
                        <input id="confirmPassword" type="password" value={passwords.confirm} onChange={e => setPasswords({...passwords, confirm: e.target.value})} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                    </div>
                    <div className="pt-2">
                        <Button type="submit"><KeyRound className="mr-2 h-4 w-4"/> Update Password</Button>
                    </div>
                </form>
            </SectionCard>

            <SectionCard
                title="Danger Zone"
                description="Manage risky account actions here."
            >
                <div className="flex justify-between items-center bg-destructive/10 p-4 rounded-lg border border-destructive/30">
                    <div>
                        <h3 className="font-bold text-destructive-foreground">Delete Account</h3>
                        <p className="text-sm text-destructive-foreground/80">Once you delete your account, there is no going back. Please be certain.</p>
                    </div>
                    <Button variant="destructive" onClick={() => setDeleteModalOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4"/> Delete My Account
                    </Button>
                </div>
            </SectionCard>

        </div>
    );
}
