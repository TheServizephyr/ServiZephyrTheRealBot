
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { User, Mail, Phone, Edit, Save, XCircle, Bell, Trash2, KeyRound, Eye, EyeOff, FileText, Bot, Image as ImageIcon, Upload, X, IndianRupee, MapPin, Wallet, ShoppingBag, Store, ConciergeBell, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import Image from 'next/image';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';


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
                setTimeout(() => window.location.href = "/", 2000);
            }
        } catch (error) {
            console.error("Error deleting account:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to delete account: ${error.message}.` });
        } finally {
            setIsOpen(false);
        }
    };

    return (
        <>
        <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md bg-destructive/10 border-destructive text-foreground backdrop-blur-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-destructive-foreground">Permanently Delete Account</DialogTitle>
                    <DialogDescription className="text-destructive-foreground/80">
                        This action is irreversible. All your data will be permanently lost.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="delete-confirm" className="font-semibold">To confirm, type "DELETE".</Label>
                    <input id="delete-confirm" type="text" value={confirmationText} onChange={(e) => setConfirmationText(e.target.value)} className="mt-2 w-full p-2 border rounded-md bg-background border-destructive/50 text-foreground focus:ring-destructive" placeholder="DELETE" />
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button variant="destructive" disabled={isDeleteDisabled} onClick={handleDelete}>
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
  
    const handleFileChange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => onFileSelect(reader.result);
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


function VendorProfilePageContent() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [editedUser, setEditedUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isEditingMedia, setIsEditingMedia] = useState(false);
    const [isEditingPayment, setIsEditingPayment] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const defaultAddress = { street: '', city: '', state: '', postalCode: '', country: 'IN' };

    useEffect(() => {
        const fetchUserData = async () => {
            const currentUser = getAuth().currentUser;
            if (!currentUser) {
                setLoading(false);
                router.push('/');
                return;
            }
            try {
                const idToken = await currentUser.getIdToken();
                const response = await fetch('/api/owner/settings', {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!response.ok) throw new Error((await response.json()).message || 'Failed to fetch user data');
                
                const data = await response.json();
                const userData = { ...data, address: data.address || defaultAddress };
                setUser(userData);
                setEditedUser(userData);
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = getAuth().onAuthStateChanged(user => {
            if (user) fetchUserData();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router]);

    const handleEditToggle = (section) => {
        const toggles = {
            profile: [isEditingProfile, setIsEditingProfile],
            media: [isEditingMedia, setIsEditingMedia],
            payment: [isEditingPayment, setIsEditingPayment],
        };
        const [isEditing, setIsEditing] = toggles[section];
        if (isEditing) setEditedUser(user);
        setIsEditing(!isEditing);
    };

    const handleSave = async (section) => {
        const currentUser = getAuth().currentUser;
        if (!currentUser || !editedUser) return;
        
        let payload = {};
        if (section === 'profile') {
            payload = { name: editedUser.name, restaurantName: editedUser.restaurantName, phone: editedUser.phone };
        } else if (section === 'media') {
            payload = { logoUrl: editedUser.logoUrl, bannerUrls: editedUser.bannerUrls };
        } else if (section === 'payment') {
            payload = {
                isOpen: editedUser.isOpen,
                dineInOnlinePaymentEnabled: editedUser.dineInOnlinePaymentEnabled,
                dineInPayAtCounterEnabled: editedUser.dineInPayAtCounterEnabled,
            };
        }

        try {
            const idToken = await currentUser.getIdToken();
            const response = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error((await response.json()).message || 'Failed to update settings');
            
            const updatedUser = await response.json();
            const finalUser = { ...updatedUser, address: updatedUser.address || defaultAddress };
            setUser(finalUser);
            setEditedUser(finalUser);
            if (section === 'profile') setIsEditingProfile(false);
            if (section === 'media') setIsEditingMedia(false);
            if (section === 'payment') setIsEditingPayment(false);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Updated Successfully!' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };
    
    if (loading) {
        return <div className="p-6 text-center h-screen flex items-center justify-center"><Loader2 className="animate-spin h-16 w-16 text-primary"/></div>;
    }
    
    if (!user || !editedUser) {
        return <div className="p-6 text-center h-screen flex items-center justify-center"><p>Could not load user data. Please log in again.</p></div>;
    }

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            <DeleteAccountModal isOpen={isDeleteModalOpen} setIsOpen={setDeleteModalOpen} />
            
             <header className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push('/street-vendor-dashboard')}><ArrowLeft/></Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Stall Profile & Settings</h1>
                     <p className="text-muted-foreground mt-1">Manage your business details and payment options.</p>
                </div>
            </header>

            <SectionCard 
                title="Your Details"
                description="Manage your personal and business details."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditingProfile ? (
                            <>
                                <Button variant="secondary" onClick={() => handleEditToggle('profile')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save</Button>
                            </>
                        ) : (
                            <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4"/> Edit</Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="ownerName" className="flex items-center gap-2"><User size={14}/> Your Name</Label>
                            <input id="ownerName" value={editedUser.name} onChange={e => setEditedUser({...editedUser, name: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                        <div>
                            <Label htmlFor="restaurantName" className="flex items-center gap-2"><Store size={14}/> Stall/Business Name</Label>
                            <input id="restaurantName" value={editedUser.restaurantName} onChange={e => setEditedUser({...editedUser, restaurantName: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                    </div>
                     <div className="space-y-6">
                         <div>
                            <Label htmlFor="email" className="flex items-center gap-2"><Mail size={14}/> Email Address</Label>
                            <input id="email" value={user.email} disabled className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-50" />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14}/> Phone Number</Label>
                            <input id="phone" value={editedUser.phone} onChange={e => setEditedUser({...editedUser, phone: e.target.value})} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                     </div>
                </div>
            </SectionCard>

            <SectionCard
                title="Media & Branding"
                description="Upload your stall's logo and a banner for your order page."
                footer={
                     <div className="flex justify-end gap-3">
                        {isEditingMedia ? (
                            <>
                                <Button variant="secondary" onClick={() => handleEditToggle('media')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                <Button onClick={() => handleSave('media')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save</Button>
                            </>
                        ) : (
                            <Button onClick={() => handleEditToggle('media')}><Edit className="mr-2 h-4 w-4"/> Edit</Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <ImageUpload label="Logo" currentImage={editedUser.logoUrl} onFileSelect={(url) => setEditedUser({...editedUser, logoUrl: url})} isEditing={isEditingMedia} />
                    <ImageUpload label="Banner" currentImage={editedUser.bannerUrls?.[0]} onFileSelect={(url) => setEditedUser({...editedUser, bannerUrls: [url]})} isEditing={isEditingMedia} />
                </div>
            </SectionCard>

             <SectionCard
                title="Operational Settings"
                description="Control your stall's availability and payment methods."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditingPayment ? (
                            <>
                                <Button variant="secondary" onClick={() => handleEditToggle('payment')}><XCircle className="mr-2 h-4 w-4"/> Cancel</Button>
                                <Button onClick={() => handleSave('payment')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4"/> Save</Button>
                            </>
                        ) : (
                            <Button onClick={() => handleEditToggle('payment')}><Edit className="mr-2 h-4 w-4"/> Edit</Button>
                        )}
                    </div>
                }
            >
                 <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <Label htmlFor="isOpen" className="flex flex-col">
                            <span className="font-bold text-lg">Stall Status</span>
                            <span className="text-sm text-muted-foreground">Turn this off to temporarily stop all new orders.</span>
                        </Label>
                        <Switch id="isOpen" checked={editedUser.isOpen} onCheckedChange={(val) => setEditedUser({...editedUser, isOpen: val})} disabled={!isEditingPayment} />
                    </div>
                     <div className="grid md:grid-cols-2 gap-6 pt-6 border-t border-border">
                        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                             <h4 className="font-bold">Payment Methods</h4>
                              <div className="flex items-center justify-between">
                                <Label htmlFor="dineInOnlinePaymentEnabled" className="text-sm">Online Payments</Label>
                                <Switch id="dineInOnlinePaymentEnabled" checked={editedUser.dineInOnlinePaymentEnabled} onCheckedChange={(val) => setEditedUser({...editedUser, dineInOnlinePaymentEnabled: val})} disabled={!isEditingPayment} />
                            </div>
                             <div className="flex items-center justify-between">
                                <Label htmlFor="dineInPayAtCounterEnabled" className="text-sm">Pay at Counter</Label>
                                <Switch id="dineInPayAtCounterEnabled" checked={editedUser.dineInPayAtCounterEnabled} onCheckedChange={(val) => setEditedUser({...editedUser, dineInPayAtCounterEnabled: val})} disabled={!isEditingPayment} />
                            </div>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="Account Security">
                <Button variant="destructive" onClick={() => setDeleteModalOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4"/> Delete My Account
                </Button>
            </SectionCard>
        </div>
    );
}

export default function VendorProfilePage() {
    return (
        <Suspense fallback={<div className="p-6 text-center h-screen flex items-center justify-center"><Loader2 className="animate-spin h-16 w-16 text-primary"/></div>}>
            <VendorProfilePageContent />
        </Suspense>
    );
}
