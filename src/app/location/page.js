'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, LocateFixed, Loader2, Plus, Home, Building, Trash2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import { useUser } from '@/firebase';

const SavedAddressCard = ({ address, onSelect, onDelete, isAuth }) => {
    const Icon = address.label === 'Home' ? Home : address.label === 'Work' ? Building : MapPin;
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4 flex gap-4 transition-all hover:border-primary hover:shadow-lg"
        >
            <div className="bg-muted p-3 rounded-full h-fit">
                <Icon size={24} className="text-primary" />
            </div>
            <div className="flex-grow cursor-pointer" onClick={() => onSelect(address)}>
                <h3 className="font-bold text-foreground">{address.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{address.full}</p>
                <p className="text-xs text-muted-foreground mt-2">Phone: {address.phone}</p>
            </div>
            {isAuth && (
              <div className="flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(address.id); }}>
                      <Trash2 size={16} />
                  </Button>
              </div>
            )}
        </motion.div>
    );
}

const SelectLocationInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isUserLoading } = useUser();

    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const returnUrl = searchParams.get('returnUrl') || '/';
    const phoneFromUrl = searchParams.get('phone');
    
    useEffect(() => {
        const fetchAddresses = async () => {
            // Determine which phone number to use, giving priority to the URL parameter.
            const phoneToLookup = phoneFromUrl || user?.phoneNumber;

            if (!phoneToLookup) {
                setLoading(false);
                setAddresses([]);
                return;
            }

            setLoading(true);
            setError('');

            try {
                console.log(`[LocationPage] Fetching addresses for phone: ${phoneToLookup}`);
                const res = await fetch('/api/customer/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: phoneToLookup }),
                });

                if (res.ok) {
                    const data = await res.json();
                    setAddresses(data.addresses || []);
                } else if (res.status === 404) {
                    setAddresses([]); // No addresses found is not an error state
                } else {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to look up customer data.');
                }
            } catch (err) {
                console.error("[LocationPage] Error fetching addresses:", err);
                setError(err.message);
                setAddresses([]);
            } finally {
                setLoading(false);
            }
        };

        // If a phone number is in the URL, fetch immediately.
        // Otherwise, wait for the user loading state to resolve.
        if (phoneFromUrl) {
            fetchAddresses();
        } else if (!isUserLoading) {
            fetchAddresses();
        }

    }, [phoneFromUrl, user, isUserLoading]);


    const handleSelectAddress = (address) => {
        localStorage.setItem('customerLocation', JSON.stringify(address));
        router.push(returnUrl);
    };

    const handleDeleteAddress = async (addressId) => {
        if (!window.confirm("Are you sure you want to delete this address?")) return;

        if (!user) {
             setInfoDialog({isOpen: true, title: 'Error', message: 'You must be logged in to delete an address.'});
             return;
        }

        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/user/addresses', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ addressId })
            });
            if (!res.ok) {
                 const data = await res.json();
                 throw new Error(data.message || 'Failed to delete address.');
            }
            setInfoDialog({isOpen: true, title: 'Success', message: 'Address deleted successfully.'});
            // Re-fetch addresses after deletion
            const phoneToLookup = phoneFromUrl || user?.phoneNumber;
             if (phoneToLookup) {
                const res = await fetch('/api/customer/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: phoneToLookup }),
                });
                 if (res.ok) {
                    const data = await res.json();
                    setAddresses(data.addresses || []);
                } else {
                    setAddresses([]);
                }
            }
        } catch (err) {
            setInfoDialog({isOpen: true, title: 'Error', message: err.message});
        }
    };
    
    const handleAddNewAddress = () => {
        router.push(`/add-address?returnUrl=${encodeURIComponent(returnUrl)}&phone=${phoneFromUrl || ''}`);
    }
    
    const handleUseCurrentLocation = () => {
        router.push(`/add-address?useCurrent=true&returnUrl=${encodeURIComponent(returnUrl)}&phone=${phoneFromUrl || ''}`);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border p-4 flex items-center gap-4">
                 <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft/></Button>
                 <h1 className="text-xl font-bold">Select a Location</h1>
            </header>

            <main className="p-4 container mx-auto">
                <div className="space-y-4">
                     <button onClick={handleUseCurrentLocation} className="w-full flex items-center text-left p-4 bg-card rounded-xl border border-border hover:bg-muted transition-colors">
                        <LocateFixed className="text-primary mr-4" />
                        <div>
                            <p className="font-semibold text-foreground">Use current location</p>
                            <p className="text-xs text-muted-foreground">Using GPS</p>
                        </div>
                    </button>
                     <button onClick={handleAddNewAddress} className="w-full flex items-center text-left p-4 bg-card rounded-xl border border-border hover:bg-muted transition-colors">
                        <Plus className="text-primary mr-4" />
                        <div>
                            <p className="font-semibold text-foreground">Add a new address</p>
                            <p className="text-xs text-muted-foreground">Pin your location on the map</p>
                        </div>
                    </button>
                </div>

                <div className="mt-8">
                    <h2 className="font-bold text-muted-foreground mb-4">SAVED ADDRESSES</h2>
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
                    ) : error ? (
                        <div className="text-center py-8 text-destructive">{error}</div>
                    ) : addresses.length > 0 ? (
                        <div className="space-y-4">
                            {addresses.map(address => (
                                <SavedAddressCard 
                                    key={address.id} 
                                    address={address} 
                                    onSelect={handleSelectAddress}
                                    onDelete={handleDeleteAddress}
                                    isAuth={!!user}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-muted-foreground">
                            <p>No saved addresses found.</p>
                            <p className="text-sm">Add a new address to get started.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default function SelectLocationPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16"/></div>}>
            <SelectLocationInternal />
        </Suspense>
    );
}
