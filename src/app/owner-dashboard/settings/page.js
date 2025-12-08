
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Mail, Phone, Shield, Edit, Save, XCircle, Bell, Trash2, KeyRound, Eye, EyeOff, FileText, Bot, Truck, Image as ImageIcon, Upload, X, IndianRupee, MapPin, Wallet, ChevronsUpDown, Check, ShoppingBag, Store, ConciergeBell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import Image from 'next/image';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import imageCompression from 'browser-image-compression';

export const dynamic = 'force-dynamic';

// --- Sub-components for better structure ---

const countries = [
    { value: 'IN', label: 'India', flag: '🇮🇳' },
    { value: 'US', label: 'United States', flag: '🇺🇸' },
    { value: 'AE', label: 'United Arab Emirates', flag: '🇦🇪' },
    { value: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
    { value: 'CA', label: 'Canada', flag: '🇨🇦' },
];

const CountrySelect = ({ value, onSelect, disabled }) => {
    const [open, setOpen] = useState(false);
    const selectedCountry = countries.find(c => c.value === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                    disabled={disabled}
                >
                    {selectedCountry ? `${selectedCountry.flag} ${selectedCountry.label}` : "Select country..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
                <Command>
                    <CommandInput placeholder="Search country..." />
                    <CommandEmpty>No country found.</CommandEmpty>
                    <CommandGroup>
                        {countries.map((country) => (
                            <CommandItem
                                key={country.value}
                                value={country.label}
                                onSelect={() => {
                                    onSelect(country.value);
                                    setOpen(false);
                                }}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        value === country.value ? "opacity-100" : "opacity-0"
                                    )}
                                />
                                {country.flag} {country.label}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                </Command>
            </PopoverContent>
        </Popover>
    );
};


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
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const isDeleteDisabled = confirmationText !== "DELETE";

    const handleDelete = async () => {
        try {
            const user = getAuth().currentUser;
            if (user) {
                await user.delete();
                setInfoDialog({ isOpen: true, title: 'Success', message: 'Account deleted successfully.' });
                // You would typically redirect the user to a logged-out page here.
                setTimeout(() => window.location.href = "/", 2000);
            }
        } catch (error) {
            console.error("Error deleting account:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to delete account: ${error.message}. You may need to sign in again to perform this action.` });
        } finally {
            setIsOpen(false);
        }
    };

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
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
        </>
    );
};


const ImageUpload = ({ label, currentImage, onFileSelect, isEditing }) => {
    const fileInputRef = React.useRef(null);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                // Compress image before uploading
                const compressionOptions = {
                    maxSizeMB: 1, // Max 1MB
                    maxWidthOrHeight: 2048, // Max dimension
                    useWebWorker: true,
                    fileType: 'image/jpeg' // Convert to JPEG
                };

                const compressedFile = await imageCompression(file, compressionOptions);
                console.log(`Original ${label} size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                console.log(`Compressed ${label} size: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

                const reader = new FileReader();
                reader.onloadend = () => {
                    onFileSelect(reader.result);
                };
                reader.readAsDataURL(compressedFile);
            } catch (error) {
                console.error('Image compression failed:', error);
                // Fallback to original file if compression fails
                const reader = new FileReader();
                reader.onloadend = () => {
                    onFileSelect(reader.result);
                };
                reader.readAsDataURL(file);
            }
        }
    };

    return (
        <div>
            <Label className="flex items-center gap-2"><ImageIcon size={14} /> {label}</Label>
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
                            <Upload size={16} className="mr-2" /> Upload
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};


// --- Main Page Component ---
function SettingsPageContent() {
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
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

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
                    address: data.address && typeof data.address === 'object' ? data.address : defaultAddress,
                    dineInModel: data.dineInModel || 'post-paid' // Default to Post-Paid
                };
                setUser(userData);
                setEditedUser(userData);
            } catch (error) {
                console.error("Error fetching user data:", error);
                setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
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

    const handleBannerFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                // Compress image before uploading
                const compressionOptions = {
                    maxSizeMB: 1, // Max 1MB
                    maxWidthOrHeight: 2048, // Max dimension
                    useWebWorker: true,
                    fileType: 'image/jpeg' // Convert to JPEG
                };

                const compressedFile = await imageCompression(file, compressionOptions);
                console.log(`Original banner size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                console.log(`Compressed banner size: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

                const reader = new FileReader();
                reader.onloadend = () => {
                    setEditedUser(prev => ({ ...prev, bannerUrls: [...(prev.bannerUrls || []), reader.result] }));
                };
                reader.readAsDataURL(compressedFile);
            } catch (error) {
                console.error('Banner compression failed:', error);
                // Fallback to original file if compression fails
                const reader = new FileReader();
                reader.onloadend = () => {
                    setEditedUser(prev => ({ ...prev, bannerUrls: [...(prev.bannerUrls || []), reader.result] }));
                };
                reader.readAsDataURL(file);
            }
        }
    };

    const removeBannerImage = (index) => {
        setEditedUser(prev => ({ ...prev, bannerUrls: prev.bannerUrls.filter((_, i) => i !== index) }));
    };

    const handlePaymentToggle = (type, value) => {
        setEditedUser(prev => {
            const newState = { ...prev, [type]: value };
            const {
                deliveryEnabled, pickupEnabled, dineInEnabled,
                deliveryOnlinePaymentEnabled, deliveryCodEnabled,
                pickupOnlinePaymentEnabled, pickupPodEnabled,
                dineInOnlinePaymentEnabled, dineInPayAtCounterEnabled
            } = newState;


            // Prevent disabling all order types
            if (!deliveryEnabled && !pickupEnabled && !dineInEnabled) {
                setInfoDialog({ isOpen: true, title: 'Invalid Selection', message: 'At least one order type (Delivery, Pickup, or Dine-In) must be enabled.' });
                return prev;
            }

            // Validation for Delivery
            if (deliveryEnabled && !deliveryOnlinePaymentEnabled && !deliveryCodEnabled) {
                setInfoDialog({ isOpen: true, title: 'Invalid Selection', message: 'At least one payment method must be enabled for Delivery.' });
                return prev;
            }
            // Validation for Pickup
            if (pickupEnabled && !pickupOnlinePaymentEnabled && !pickupPodEnabled) {
                setInfoDialog({ isOpen: true, title: 'Invalid Selection', message: 'At least one payment method must be enabled for Pickup.' });
                return prev;
            }
            // Validation for Dine-In
            if (dineInEnabled && !dineInOnlinePaymentEnabled && !dineInPayAtCounterEnabled) {
                setInfoDialog({ isOpen: true, title: 'Invalid Selection', message: 'At least one payment method must be enabled for Dine-In.' });
                return prev;
            }

            return newState;
        });
    };

    const handleSave = async (section) => {
        const currentUser = getAuth().currentUser;
        if (!currentUser || !editedUser) return;

        let payload = {};
        if (section === 'profile') {
            payload = {
                name: editedUser.name,
                restaurantName: editedUser.restaurantName,
                phone: editedUser.phone,
                notifications: editedUser.notifications,
                gstin: editedUser.gstin,
                fssai: editedUser.fssai,
                botPhoneNumberId: editedUser.botPhoneNumberId,
                botDisplayNumber: editedUser.botDisplayNumber,
                razorpayAccountId: editedUser.razorpayAccountId,
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
                isOpen: editedUser.isOpen,
                deliveryEnabled: editedUser.deliveryEnabled,
                pickupEnabled: editedUser.pickupEnabled,
                dineInEnabled: editedUser.dineInEnabled,
                dineInModel: editedUser.dineInModel, // The new Master Switch
                deliveryOnlinePaymentEnabled: editedUser.deliveryOnlinePaymentEnabled,
                deliveryCodEnabled: editedUser.deliveryCodEnabled,
                pickupOnlinePaymentEnabled: editedUser.pickupOnlinePaymentEnabled,
                pickupPodEnabled: editedUser.pickupPodEnabled,
                dineInOnlinePaymentEnabled: editedUser.dineInOnlinePaymentEnabled,
                dineInPayAtCounterEnabled: editedUser.dineInPayAtCounterEnabled,
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
                address: updatedUser.address && typeof updatedUser.address === 'object' ? updatedUser.address : defaultAddress,
                dineInModel: updatedUser.dineInModel || 'post-paid'
            };
            setUser(finalUser);
            setEditedUser(finalUser);
            if (section === 'profile') setIsEditingProfile(false);
            if (section === 'media') setIsEditingMedia(false);
            if (section === 'payment') setIsEditingPayment(false);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Updated Successfully!' });

        } catch (error) {
            console.error("Error saving data:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };

    const handlePasswordUpdate = async (e) => {
        e.preventDefault();
        const currentUser = getAuth().currentUser;

        if (!currentUser) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'You must be logged in to change your password.' });
            return;
        }
        if (passwords.new !== passwords.confirm) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'New password and confirm password do not match.' });
            return;
        }
        if (passwords.new.length < 6) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'New password must be at least 6 characters long.' });
            return;
        }

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, passwords.current);
            await reauthenticateWithCredential(currentUser, credential);

            await updatePassword(currentUser, passwords.new);

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Password updated successfully!' });
            setPasswords({ current: '', new: '', confirm: '' });

        } catch (error) {
            console.error("Password update error:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to update password: ${error.message}. Make sure your current password is correct.` });
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

    const isBusinessOwner = user.role === 'owner' || user.role === 'restaurant-owner' || user.role === 'shop-owner' || user.role === 'street-vendor';

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
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
                                <Button variant="secondary" onClick={() => handleEditToggle('profile')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                                <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save Profile</Button>
                            </>
                        ) : (
                            <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4" /> Edit Profile</Button>
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
                            <Label htmlFor="ownerName" className="flex items-center gap-2"><User size={14} /> Owner Name</Label>
                            <input id="ownerName" value={editedUser.name} onChange={e => setEditedUser({ ...editedUser, name: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                        {isBusinessOwner && (<div>
                            <Label htmlFor="restaurantName" className="flex items-center gap-2"><Store size={14} /> Restaurant Name</Label>
                            <input id="restaurantName" value={editedUser.restaurantName} onChange={e => setEditedUser({ ...editedUser, restaurantName: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>)}
                        <div>
                            <Label htmlFor="email" className="flex items-center gap-2"><Mail size={14} /> Email Address</Label>
                            <input id="email" value={user.email} disabled className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-50 disabled:cursor-not-allowed" />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14} /> Phone Number</Label>
                            <input id="phone" value={editedUser.phone} onChange={e => setEditedUser({ ...editedUser, phone: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" />
                        </div>
                    </div>
                    {isBusinessOwner && (
                        <>
                            <div className="space-y-4 md:col-span-2 p-4 border border-dashed border-border rounded-lg">
                                <h4 className="font-semibold flex items-center gap-2"><MapPin size={16} /> Restaurant Address</h4>
                                <div>
                                    <Label htmlFor="street">Street Address</Label>
                                    <input id="street" type="text" value={editedUser.address.street} onChange={(e) => handleAddressChange('street', e.target.value)} placeholder="Street Address" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="city">City</Label>
                                        <input id="city" type="text" value={editedUser.address.city} onChange={(e) => handleAddressChange('city', e.target.value)} placeholder="City" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile} />
                                    </div>
                                    <div>
                                        <Label htmlFor="postalCode">Postal Code</Label>
                                        <input id="postalCode" type="text" value={editedUser.address.postalCode} onChange={(e) => handleAddressChange('postalCode', e.target.value)} placeholder="Postal Code" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="state">State</Label>
                                        <input id="state" type="text" value={editedUser.address.state} onChange={(e) => handleAddressChange('state', e.target.value)} placeholder="State" required className="w-full mt-1 p-2 rounded-md bg-input border border-border" disabled={!isEditingProfile} />
                                    </div>
                                    <div>
                                        <Label htmlFor="country">Country</Label>
                                        <CountrySelect value={editedUser.address.country} onSelect={(val) => handleAddressChange('country', val)} disabled={!isEditingProfile} />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <Label htmlFor="gstin" className="flex items-center gap-2"><FileText size={14} /> GSTIN</Label>
                                    <input id="gstin" value={editedUser.gstin} onChange={e => setEditedUser({ ...editedUser, gstin: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 27ABCDE1234F1Z5" />
                                </div>
                                <div>
                                    <Label htmlFor="fssai" className="flex items-center gap-2"><FileText size={14} /> FSSAI Number</Label>
                                    <input id="fssai" value={editedUser.fssai} onChange={e => setEditedUser({ ...editedUser, fssai: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., 10012345678901" />
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <Label htmlFor="botPhoneNumberId" className="flex items-center gap-2"><Bot size={14} /> WhatsApp Bot Phone Number ID</Label>
                                    <input id="botPhoneNumberId" value={editedUser.botPhoneNumberId} onChange={e => setEditedUser({ ...editedUser, botPhoneNumberId: e.target.value })} disabled={!isEditingProfile || !!user.botPhoneNumberId} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="Auto-filled on connection" />
                                </div>
                                <div>
                                    <Label htmlFor="botDisplayNumber" className="flex items-center gap-2"><Phone size={14} /> WhatsApp Bot Display Number</Label>
                                    <input
                                        id="botDisplayNumber"
                                        value={editedUser.botDisplayNumber || ''}
                                        onChange={e => setEditedUser({ ...editedUser, botDisplayNumber: e.target.value })}
                                        disabled={!isEditingProfile || !!user.botDisplayNumber}
                                        className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed"
                                        placeholder={user.botDisplayNumber ? 'Auto-filled on connection' : 'e.g., 919876543210'}
                                    />
                                    {!user.botDisplayNumber && (
                                        <p className="text-xs text-muted-foreground mt-1">If this field is empty, please enter your bot's display number (e.g., 919876543210) once and save.</p>
                                    )}
                                </div>
                                <div>
                                    <Label htmlFor="razorpayAccountId" className="flex items-center gap-2"><Wallet size={14} /> Razorpay Account ID</Label>
                                    <input id="razorpayAccountId" value={editedUser.razorpayAccountId} onChange={e => setEditedUser({ ...editedUser, razorpayAccountId: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed" placeholder="e.g., acc_xxxxxxxxxxxxxx" />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </SectionCard>

            {isBusinessOwner && (
                <>
                    <SectionCard
                        title="Order & Payment Settings"
                        description="Configure how you accept orders from customers."
                        footer={
                            <div className="flex justify-end gap-3">
                                {isEditingPayment ? (
                                    <>
                                        <Button variant="secondary" onClick={() => handleEditToggle('payment')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                                        <Button onClick={() => handleSave('payment')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save Settings</Button>
                                    </>
                                ) : (
                                    <Button onClick={() => handleEditToggle('payment')}><Edit className="mr-2 h-4 w-4" /> Edit Order Settings</Button>
                                )}
                            </div>
                        }
                    >
                        <div className="space-y-6">
                            {editedUser.dineInEnabled && (
                                <div className="border-t border-border pt-6">
                                    <Label className="font-semibold text-lg">Dine-In Model (Master Switch)</Label>
                                    <p className="text-sm text-muted-foreground mb-4">Choose the primary billing flow for your dine-in customers.</p>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <button
                                            type="button"
                                            onClick={() => isEditingPayment && setEditedUser(prev => ({ ...prev, dineInModel: 'post-paid' }))}
                                            className={cn("p-4 border-2 rounded-lg text-left transition-all", editedUser.dineInModel === 'post-paid' ? 'border-primary bg-primary/10' : 'border-border', isEditingPayment ? 'cursor-pointer hover:border-primary' : 'cursor-not-allowed opacity-70')}
                                            disabled={!isEditingPayment}
                                        >
                                            <h4 className="font-bold">Bill at the End (Post-Paid)</h4>
                                            <p className="text-xs text-muted-foreground mt-1">Customers order freely and pay their total bill at the end. Ideal for fine dining, cafes.</p>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => isEditingPayment && setEditedUser(prev => ({ ...prev, dineInModel: 'pre-paid' }))}
                                            className={cn("p-4 border-2 rounded-lg text-left transition-all", editedUser.dineInModel === 'pre-paid' ? 'border-primary bg-primary/10' : 'border-border', isEditingPayment ? 'cursor-pointer hover:border-primary' : 'cursor-not-allowed opacity-70')}
                                            disabled={!isEditingPayment}
                                        >
                                            <h4 className="font-bold">Pay First (Pre-Paid)</h4>
                                            <p className="text-xs text-muted-foreground mt-1">Customers pay for their items before the order is sent to the kitchen. Ideal for QSRs, food courts.</p>
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div>
                                <Label className="font-semibold text-lg">Order Types</Label>
                                <p className="text-sm text-muted-foreground mb-4">Choose which types of orders your business will accept.</p>
                                <div className="grid md:grid-cols-3 gap-4">
                                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                        <Label htmlFor="deliveryEnabled" className="flex flex-col">
                                            <span className="font-semibold flex items-center gap-2"><Truck size={16} /> Delivery</span>
                                        </Label>
                                        <Switch id="deliveryEnabled" checked={editedUser.deliveryEnabled} onCheckedChange={(checked) => handlePaymentToggle('deliveryEnabled', checked)} disabled={!isEditingPayment} />
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                        <Label htmlFor="pickupEnabled" className="flex flex-col">
                                            <span className="font-semibold flex items-center gap-2"><ShoppingBag size={16} /> Pickup</span>
                                        </Label>
                                        <Switch id="pickupEnabled" checked={editedUser.pickupEnabled} onCheckedChange={(checked) => handlePaymentToggle('pickupEnabled', checked)} disabled={!isEditingPayment} />
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                        <Label htmlFor="dineInEnabled" className="flex flex-col">
                                            <span className="font-semibold flex items-center gap-2"><ConciergeBell size={16} /> Dine-In</span>
                                        </Label>
                                        <Switch id="dineInEnabled" checked={editedUser.dineInEnabled} onCheckedChange={(checked) => handlePaymentToggle('dineInEnabled', checked)} disabled={!isEditingPayment} />
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-border pt-6">
                                <Label className="font-semibold text-lg">Payment Methods</Label>
                                <p className="text-sm text-muted-foreground mb-4">Configure payment options for each order type.</p>
                                <div className="grid md:grid-cols-3 gap-6">
                                    {/* Delivery Payment Options */}
                                    <div className={cn("space-y-4 p-4 border rounded-lg", !editedUser.deliveryEnabled && "opacity-50")}>
                                        <h4 className="font-bold">For Delivery</h4>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="deliveryOnlinePaymentEnabled" className="text-sm">Online Payments</Label>
                                            <Switch id="deliveryOnlinePaymentEnabled" checked={editedUser.deliveryOnlinePaymentEnabled} onCheckedChange={(checked) => handlePaymentToggle('deliveryOnlinePaymentEnabled', checked)} disabled={!isEditingPayment || !editedUser.deliveryEnabled} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="deliveryCodEnabled" className="text-sm">Pay on Delivery (POD)</Label>
                                            <Switch id="deliveryCodEnabled" checked={editedUser.deliveryCodEnabled} onCheckedChange={(checked) => handlePaymentToggle('deliveryCodEnabled', checked)} disabled={!isEditingPayment || !editedUser.deliveryEnabled} />
                                        </div>
                                    </div>
                                    {/* Pickup Payment Options */}
                                    <div className={cn("space-y-4 p-4 border rounded-lg", !editedUser.pickupEnabled && "opacity-50")}>
                                        <h4 className="font-bold">For Pickup</h4>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="pickupOnlinePaymentEnabled" className="text-sm">Online Payments</Label>
                                            <Switch id="pickupOnlinePaymentEnabled" checked={editedUser.pickupOnlinePaymentEnabled} onCheckedChange={(checked) => handlePaymentToggle('pickupOnlinePaymentEnabled', checked)} disabled={!isEditingPayment || !editedUser.pickupEnabled} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="pickupPodEnabled" className="text-sm">Pay at Store</Label>
                                            <Switch id="pickupPodEnabled" checked={editedUser.pickupPodEnabled} onCheckedChange={(checked) => handlePaymentToggle('pickupPodEnabled', checked)} disabled={!isEditingPayment || !editedUser.pickupEnabled} />
                                        </div>
                                    </div>
                                    {/* Dine-In Payment Options */}
                                    <div className={cn("space-y-4 p-4 border rounded-lg", !editedUser.dineInEnabled && "opacity-50")}>
                                        <h4 className="font-bold">For Dine-In</h4>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="dineInOnlinePaymentEnabled" className="text-sm">Online Payments</Label>
                                            <Switch id="dineInOnlinePaymentEnabled" checked={editedUser.dineInOnlinePaymentEnabled} onCheckedChange={(checked) => handlePaymentToggle('dineInOnlinePaymentEnabled', checked)} disabled={!isEditingPayment || !editedUser.dineInEnabled} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="dineInPayAtCounterEnabled" className="text-sm">Pay at Counter</Label>
                                            <Switch id="dineInPayAtCounterEnabled" checked={editedUser.dineInPayAtCounterEnabled} onCheckedChange={(checked) => handlePaymentToggle('dineInPayAtCounterEnabled', checked)} disabled={!isEditingPayment || !editedUser.dineInEnabled} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </SectionCard>
                    <SectionCard
                        title="Media & Branding"
                        description="Upload your restaurant's logo and banner images."
                        footer={
                            <div className="flex justify-end gap-3">
                                {isEditingMedia ? (
                                    <>
                                        <Button variant="secondary" onClick={() => handleEditToggle('media')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                                        <Button onClick={() => handleSave('media')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save Media</Button>
                                    </>
                                ) : (
                                    <Button onClick={() => handleEditToggle('media')}><Edit className="mr-2 h-4 w-4" /> Edit Media</Button>
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
                                <Label className="flex items-center gap-2"><ImageIcon size={14} /> Banner Images</Label>
                                <div className="mt-2 flex flex-wrap items-center gap-4">
                                    {editedUser.bannerUrls?.map((url, index) => (
                                        <div key={index} className="relative group w-28 h-20 rounded-lg overflow-hidden border-2 border-border">
                                            <Image src={url} alt={`Banner ${index + 1}`} layout="fill" objectFit="cover" />
                                            {isEditingMedia && (
                                                <button
                                                    onClick={() => removeBannerImage(index)}
                                                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {isEditingMedia && (
                                        <>
                                            <input type="file" accept="image/*" ref={bannerInputRef} onChange={handleBannerFileChange} className="hidden" />
                                            <button type="button" onClick={() => bannerInputRef.current?.click()} className="w-28 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/50">
                                                <Upload size={20} />
                                                <span className="text-xs mt-1">Add Banner</span>
                                            </button>
                                        </>
                                    )}
                                </div>
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
                            <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save Notifications</Button>
                        ) : (
                            <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4" /> Edit Notifications</Button>
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
                        <Switch id="newOrders" checked={editedUser.notifications.newOrders} onCheckedChange={(checked) => setEditedUser({ ...editedUser, notifications: { ...editedUser.notifications, newOrders: checked } })} disabled={!isEditingProfile} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <Label htmlFor="dailySummary" className="flex flex-col">
                            <span>Daily Sales Summary</span>
                            <span className="text-xs text-muted-foreground">Get a WhatsApp message with your end-of-day sales report.</span>
                        </Label>
                        <Switch id="dailySummary" checked={editedUser.notifications.dailySummary} onCheckedChange={(checked) => setEditedUser({ ...editedUser, notifications: { ...editedUser.notifications, dailySummary: checked } })} disabled={!isEditingProfile} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <Label htmlFor="marketing" className="flex flex-col">
                            <span>Promotional Emails</span>
                            <span className="text-xs text-muted-foreground">Receive news about new features and special offers.</span>
                        </Label>
                        <Switch id="marketing" checked={editedUser.notifications.marketing} onCheckedChange={(checked) => setEditedUser({ ...editedUser, notifications: { ...editedUser.notifications, marketing: checked } })} disabled={!isEditingProfile} />
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
                        <input id="currentPassword" type="password" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                    </div>
                    <div className="relative">
                        <Label htmlFor="newPassword">New Password</Label>
                        <input id="newPassword" type={showNewPass ? "text" : "password"} value={passwords.new} onChange={e => setPasswords({ ...passwords, new: e.target.value })} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                        <button type="button" onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-9 text-muted-foreground">
                            {showNewPass ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    <div>
                        <Label htmlFor="confirmPassword">Confirm New Password</Label>
                        <input id="confirmPassword" type="password" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} className="mt-1 w-full p-2 border rounded-md bg-input border-border" required />
                    </div>
                    <div className="pt-2">
                        <Button type="submit"><KeyRound className="mr-2 h-4 w-4" /> Update Password</Button>
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
                        <Trash2 className="mr-2 h-4 w-4" /> Delete My Account
                    </Button>
                </div>
            </SectionCard>

        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <SettingsPageContent />
        </Suspense>
    )
}
