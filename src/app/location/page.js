
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, LocateFixed, Plus, Home, Building, Trash2, ArrowLeft, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';


const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);

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

    // Security State
    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');

    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const returnUrl = searchParams.get('returnUrl') || '/';
    
    useEffect(() => {
        const verifyAndFetch = async () => {
            const phoneToUse = phone && phone.trim() !== '' ? phone : null;
            const tokenToUse = token && token.trim() !== '' ? token : null;

            // If token is present, it's a WhatsApp session, which takes priority.
            if (tokenToUse) {
                if (!phoneToUse) {
                    setTokenError("A phone number is required with the session token.");
                    setLoading(false);
                    return;
                }
                 try {
                    const res = await fetch('/api/auth/verify-token', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phoneToUse, token: tokenToUse }),
                    });
                    if (!res.ok) {
                        const errData = await res.json();
                        throw new Error(errData.message || "Session validation failed.");
                    }
                } catch (err) {
                    setTokenError(err.message);
                    setLoading(false);
                    return;
                }
            } 
            // If no token, check if the user is logged in via Firebase Auth.
            else if (!user && !isUserLoading) {
                setTokenError("No session token found. Please start your order from WhatsApp or log in.");
                setLoading(false);
                return;
            }
             // If we reach here, token is valid or user is logged in and loading is finished
             if (!isUserLoading) {
                setIsTokenValid(true);
                fetchAddresses(phoneToUse);
             }
        };

        const fetchAddresses = async (phoneToLookup) => {
            setLoading(true);
            setError('');
            
            try {
                // If phone number is in URL (from WhatsApp), use it for lookup.
                if (phoneToLookup) {
                    console.log(`[LocationPage] User via WhatsApp, fetching via customer lookup for phone: ${phoneToLookup}`);
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phoneToLookup }),
                    });

                    if (res.ok) {
                        const data = await res.json();
                        setAddresses(data.addresses || []);
                    } else if (res.status !== 404) {
                        const errorData = await res.json();
                        throw new Error(errorData.message || 'Failed to look up customer data.');
                    }
                }
                // If no phone from URL, but user is logged in via Firebase Auth
                else if (user) {
                    console.log("[LocationPage] User logged in via Auth, fetching via secure API.");
                    const idToken = await user.getIdToken();
                    const res = await fetch('/api/user/addresses', { headers: { 'Authorization': `Bearer ${idToken}` } });
                    if (!res.ok) throw new Error('Failed to fetch your saved addresses.');
                    const data = await res.json();
                    setAddresses(data.addresses || []);
                }
                 // If neither, then we can't fetch anything.
                else {
                    setAddresses([]);
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        verifyAndFetch();
    }, [user, isUserLoading, phone, token]);


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
            const res = await fetch('/api/user/addresses', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify({ addressId }) });
            if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete address.');
            setInfoDialog({isOpen: true, title: 'Success', message: 'Address deleted successfully.'});
            setAddresses(prev => prev.filter(addr => addr.id !== addressId));
        } catch (err) {
            setInfoDialog({isOpen: true, title: 'Error', message: err.message});
        }
    };
    
    const handleAddNewAddress = () => {
        const params = new URLSearchParams(searchParams); // Preserve existing params
        params.set('returnUrl', returnUrl);
        router.push(`/add-address?${params.toString()}`);
    }
    
    const handleUseCurrentLocation = () => {
        const params = new URLSearchParams(searchParams);
        params.set('returnUrl', returnUrl);
        params.set('useCurrent', 'true');
        router.push(`/add-address?${params.toString()}`);
    };
    
    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }
    
    if (!isTokenValid) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="animate-spin text-primary h-16 w-16"/>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border p-4 flex items-center gap-4">
                 <Button variant="ghost" size="icon" onClick={() => router.push(returnUrl)}><ArrowLeft/></Button>
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
                        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
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

    