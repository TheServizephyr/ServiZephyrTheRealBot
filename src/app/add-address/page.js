
'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building, User, Phone, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import dynamic from 'next/dynamic';
import { useUser } from '@/firebase';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const GoogleMap = dynamic(() => import('@/components/GoogleMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);


const AddAddressPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const geocodeTimeoutRef = useRef(null);

    const { user, isUserLoading } = useUser();

    // Security State
    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');
    const ref = searchParams.get('ref'); // CAPTURE REF for guest sessions
    const tableId = searchParams.get('table');

    const [mapCenter, setMapCenter] = useState({ lat: 28.6139, lng: 77.2090 });
    const [addressDetails, setAddressDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [fullAddress, setFullAddress] = useState('');
    const [landmark, setLandmark] = useState('');
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customAddressLabel, setCustomAddressLabel] = useState('');

    const returnUrl = searchParams.get('returnUrl') || '/';
    const useCurrent = searchParams.get('useCurrent') === 'true';

    useEffect(() => {
        // REMOVED SESSION VALIDATION: Allow adding addresses for all users (guests/logged-in/redirected)
        setIsTokenValid(true);
    }, []);

    const reverseGeocode = useCallback(async (coords) => {
        if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = setTimeout(async () => {
            setLoading(true); setError('');
            try {
                const res = await fetch(`/api/public/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
                setAddressDetails({
                    street: data.street || '',
                    city: data.city || data.town || data.village || '',
                    pincode: data.pincode || '',
                    state: data.state || '',
                    country: data.country || 'IN',
                    latitude: coords.lat,
                    longitude: coords.lng
                });
                setFullAddress(data.formatted_address || '');
            } catch (err) {
                setError('Could not fetch address details for this pin location.');
                setAddressDetails(null);
            } finally {
                setLoading(false);
            }
        }, 500);
    }, []);

    const handleMapIdle = useCallback((coords) => reverseGeocode(coords), [reverseGeocode]);

    const getCurrentGeolocation = useCallback(() => {
        setLoading(true); setError('Fetching your location...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
                setMapCenter(coords); reverseGeocode(coords); setError('');
            },
            (err) => {
                setError('Could not get your location. Please search manually or allow location access.');
                setLoading(false);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }, [reverseGeocode]);

    // Separate effect for initial data prefill to prevent overwriting user input
    useEffect(() => {
        let isMounted = true;
        const prefillData = async () => {
            try {
                // CRITICAL: Support both ref-based (new) and phone-based (legacy) flows
                // prioritizing logged-in user via Auth header

                const headers = { 'Content-Type': 'application/json' };
                if (user) {
                    try {
                        const idToken = await user.getIdToken();
                        headers['Authorization'] = `Bearer ${idToken}`;
                    } catch (e) {
                        console.warn("Error getting ID token:", e);
                    }
                }

                if (ref) {
                    // New flow: Use ref to lookup customer (token not required)
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ ref })
                    });
                    if (res.ok && isMounted) {
                        const customerData = await res.json();
                        console.log('[Add Address] Customer data from ref:', customerData);
                        setRecipientPhone(prev => prev || customerData.phone || '');
                        setRecipientName(prev => prev || customerData.name || '');
                        return; // Exit early
                    }
                }

                // Legacy flow: Use phone param or logged-in user phone
                const phoneToUse = phone || user?.phoneNumber;
                if (phoneToUse) {
                    setRecipientPhone(prev => prev || phoneToUse);
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ phone: phoneToUse })
                    });
                    if (res.ok && isMounted) {
                        const customerData = await res.json();
                        setRecipientName(prev => prev || customerData.name || '');
                    }
                }

                // Fallback to User Display Name
                if (user && isMounted) {
                    setRecipientName(prev => prev || user.displayName || '');
                }
            } catch (e) {
                console.warn("Could not prefill customer data:", e);
            }
        };

        if (isTokenValid) {
            prefillData();
        }

        return () => { isMounted = false; };
    }, [isTokenValid, user, phone, ref, token]); // Removed addressDetails dependencies

    // Effect for Geolocation (Separated)
    useEffect(() => {
        if (isTokenValid) {
            if (useCurrent && !addressDetails) {
                getCurrentGeolocation();
            } else if (!addressDetails) {
                reverseGeocode(mapCenter); // Initial reverse geocode for center
            }
        }
    }, [isTokenValid, useCurrent, getCurrentGeolocation, reverseGeocode]); // Removed addressDetails to prevent loops


    const handleConfirmLocation = async () => {
        if (!addressDetails || !recipientName.trim() || !recipientPhone.trim() || !fullAddress.trim()) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please fill all required fields: Contact Person, Phone, and the complete address." });
            return;
        }
        if (!/^\d{10}$/.test(recipientPhone.trim())) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please enter a valid 10-digit phone number." });
            return;
        }

        setIsSaving(true);

        const finalLabel = (addressLabel === 'Other' && customAddressLabel.trim()) ? customAddressLabel.trim() : addressLabel;

        const addressToSave = {
            id: `addr_${Date.now()}`,
            label: finalLabel,
            name: recipientName.trim(),
            phone: recipientPhone.trim(),
            street: addressDetails.street,
            landmark: landmark.trim(),
            city: addressDetails.city,
            state: addressDetails.state,
            pincode: addressDetails.pincode,
            country: addressDetails.country,
            full: fullAddress.trim(),
            latitude: parseFloat(addressDetails.latitude),
            longitude: parseFloat(addressDetails.longitude),
        };

        localStorage.setItem('customerLocation', JSON.stringify(addressToSave));

        try {
            const sessionIdentifierPhone = phone || user?.phoneNumber || recipientPhone;

            const apiPayload = {
                address: addressToSave,
                phone: sessionIdentifierPhone,
                // Pass Guest Identifiers for V2 Flow
                ref: searchParams.get('ref'),
                token: token
            };

            const headers = { 'Content-Type': 'application/json' };
            if (user) {
                const idToken = await user.getIdToken();
                headers['Authorization'] = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/user/addresses', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(apiPayload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to save address.');
            }

            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }


    return (
        <div className="h-screen w-screen flex flex-col bg-background text-foreground">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10 bg-background/80 backdrop-blur-sm">
                <Button variant="ghost" size="icon" onClick={() => router.push(returnUrl)}><ArrowLeft /></Button>
                <h1 className="text-xl font-bold">Add Address Details</h1>
            </header>

            <div className="flex-grow flex flex-col md:flex-row">
                <div className="md:w-1/2 h-64 md:h-full flex-shrink-0 relative">
                    <GoogleMap center={mapCenter} onIdle={handleMapIdle} />
                </div>

                <div className="p-4 flex-grow overflow-y-auto space-y-4 md:w-1/2">
                    <Button variant="secondary" className="w-full h-12 shadow-lg flex items-center gap-2 pr-4 bg-white text-black hover:bg-gray-200 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700" onClick={getCurrentGeolocation} disabled={loading && error.includes('Fetching')}>
                        {(loading && error.includes('Fetching')) ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use My Current Location
                    </Button>
                    {loading && !addressDetails ? (
                        <div className="flex items-center justify-center gap-3 p-4">
                            <Loader2 className="animate-spin text-primary" />
                            <span className="text-muted-foreground">{error || 'Fetching address details...'}</span>
                        </div>
                    ) : error && !addressDetails ? (
                        <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    ) : addressDetails ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                            <div>
                                <Label htmlFor="fullAddress">Complete Address *</Label>
                                <Textarea id="fullAddress" value={fullAddress} onChange={e => setFullAddress(e.target.value)} placeholder="e.g. House No. 42, Shivam Vihar, Near Post Office" required rows={3} className="mt-1" />
                                <p className="text-xs text-muted-foreground mt-1">Drag the map pin to get the address, then edit it here if needed.</p>
                            </div>
                            <div><Label htmlFor="landmark">Landmark (Optional)</Label><Input id="landmark" value={landmark} onChange={e => setLandmark(e.target.value)} placeholder="e.g., Near Post Office" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label htmlFor="recipientName">Contact Person *</Label><Input id="recipientName" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Your Name" required /></div>
                                <div><Label htmlFor="recipientPhone">Contact Number *</Label><Input id="recipientPhone" type="tel" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="10-digit number" required /></div>
                            </div>
                            <div>
                                <Label>Save address as</Label>
                                <div className="flex items-start flex-wrap gap-2 mt-2">
                                    <Button type="button" variant={addressLabel === 'Home' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Home')}><Home size={14} className="mr-2" /> Home</Button>
                                    <Button type="button" variant={addressLabel === 'Work' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Work')}><Building size={14} className="mr-2" /> Work</Button>
                                    <Button type="button" variant={addressLabel === 'Other' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Other')}><MapPin size={14} className="mr-2" /> Other</Button>
                                    <AnimatePresence>
                                        {addressLabel === 'Other' && (
                                            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
                                                <Input type="text" value={customAddressLabel} onChange={e => setCustomAddressLabel(e.target.value)} placeholder="Custom Label (e.g., Gym)" className="h-9" />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                            <div className="p-4 border-t border-border mt-4">
                                <Button onClick={handleConfirmLocation} disabled={loading || isSaving || !addressDetails} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} {isSaving ? 'Saving...' : 'Save Address & Continue'}
                                </Button>
                            </div>
                        </motion.div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

const AddAddressPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <AddAddressPageInternal />
    </Suspense>
);

export default AddAddressPage;
