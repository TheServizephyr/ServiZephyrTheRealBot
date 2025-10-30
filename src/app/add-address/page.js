'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building, User, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import dynamic from 'next/dynamic';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import { useUser } from '@/firebase';
import { cn } from '@/lib/utils';

const GoogleMap = dynamic(() => import('@/components/GoogleMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
});

const AddAddressPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const geocodeTimeoutRef = useRef(null);
    
    const { user, isUserLoading } = useUser();
    const [mapCenter, setMapCenter] = useState({ lat: 28.6139, lng: 77.2090 });
    const [addressDetails, setAddressDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [houseNo, setHouseNo] = useState('');
    const [landmark, setLandmark] = useState('');
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customAddressLabel, setCustomAddressLabel] = useState('');


    const returnUrl = searchParams.get('returnUrl') || '/';
    const useCurrent = searchParams.get('useCurrent') === 'true';

    // --- Geocoding and Location Logic ---

    const reverseGeocode = useCallback(async (coords) => {
        if (geocodeTimeoutRef.current) {
            clearTimeout(geocodeTimeoutRef.current);
        }
        geocodeTimeoutRef.current = setTimeout(async () => {
            setLoading(true);
            setError('');
            try {
                const res = await fetch(`/api/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
        
                setAddressDetails({
                    street: data.road || data.neighbourhood || '',
                    city: data.city || data.town || data.village || '',
                    pincode: data.pincode || '',
                    state: data.state || '',
                    country: data.country || 'IN',
                    latitude: coords.lat,
                    longitude: coords.lng,
                });
            } catch (err) {
                setError('Could not fetch address details for this pin location.');
                setAddressDetails(null);
            } finally {
                setLoading(false);
            }
        }, 1000);
    }, []);

    const handleMapIdle = useCallback((coords) => {
        reverseGeocode(coords);
    }, [reverseGeocode]);

    const getCurrentGeolocation = useCallback(() => {
        setLoading(true);
        setError('Fetching your location...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
                setMapCenter(coords); 
                reverseGeocode(coords);
                setError('');
            },
            (err) => {
                setError('Could not get your location. Please search manually or allow location access.');
                setLoading(false);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }, [reverseGeocode]);

    useEffect(() => {
        const prefillData = async () => {
            const phoneFromUrl = searchParams.get('phone');

            // If a user is logged into Firebase Auth, fetch their full profile data from the backend.
            if (user) {
                console.log("[add-address] Auth user detected. Fetching full profile from backend.");
                try {
                    const idToken = await user.getIdToken();
                    const response = await fetch('/api/owner/settings', { // Using the settings API to get full profile
                        headers: { 'Authorization': `Bearer ${idToken}` }
                    });
                    if (response.ok) {
                        const profileData = await response.json();
                        setRecipientName(profileData.name || user.displayName || '');
                        setRecipientPhone(profileData.phone || user.phoneNumber || phoneFromUrl || '');
                    } else {
                        // Fallback to basic auth info if API fails
                        setRecipientName(user.displayName || '');
                        setRecipientPhone(user.phoneNumber || phoneFromUrl || '');
                    }
                } catch (e) {
                    console.warn("Could not prefill from backend, using basic auth info.", e);
                    setRecipientName(user.displayName || '');
                    setRecipientPhone(user.phoneNumber || phoneFromUrl || '');
                }
                return;
            }

            // If no auth user, but phone in URL, look up customer data.
            if (phoneFromUrl) {
                console.log(`[add-address] No auth user. Looking up customer by phone: ${phoneFromUrl}`);
                try {
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phoneFromUrl }),
                    });
                    if (res.ok) {
                        const customerData = await res.json();
                        setRecipientName(customerData.name || '');
                    }
                } catch (e) {
                    console.warn("Could not prefill name from customer lookup", e);
                } finally {
                    setRecipientPhone(phoneFromUrl);
                }
            } else {
                 // Brand new user with no phone number provided.
                 console.log("[add-address] New user journey. All fields empty.");
                 setRecipientName('');
                 setRecipientPhone('');
            }
        };
        
        if (!isUserLoading) {
            prefillData();
            if (useCurrent) {
                getCurrentGeolocation();
            } else {
                reverseGeocode(mapCenter);
            }
        }
    }, [user, isUserLoading, useCurrent, searchParams]);


    // --- Save Logic ---

    const handleConfirmLocation = async () => {
        if (!addressDetails || !recipientName.trim() || !recipientPhone.trim() || !houseNo.trim()) {
             setInfoDialog({ isOpen: true, title: "Error", message: "Please fill all required fields: Contact Person, Phone, and House/Street No." });
             return;
        }
        if (!/^\d{10}$/.test(recipientPhone.trim())) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please enter a valid 10-digit phone number." });
            return;
        }

        setIsSaving(true);
        
        const fullAddress = `${houseNo}, ${landmark ? landmark + ', ' : ''}${addressDetails.street}, ${addressDetails.city}, ${addressDetails.state} - ${addressDetails.pincode}`;
        
        const finalLabel = (addressLabel === 'Other' && customAddressLabel.trim()) 
            ? customAddressLabel.trim() 
            : addressLabel;

        const addressToSave = {
            id: `addr_${Date.now()}`,
            label: finalLabel,
            name: recipientName.trim(),
            phone: recipientPhone.trim(),
            street: houseNo.trim(),
            landmark: landmark.trim(),
            city: addressDetails.city,
            state: addressDetails.state,
            pincode: addressDetails.pincode,
            country: addressDetails.country,
            full: fullAddress,
            latitude: addressDetails.latitude,
            longitude: addressDetails.longitude,
        };

        // If user is not logged in, just save to localStorage and redirect
        if (!user) {
            localStorage.setItem('customerLocation', JSON.stringify(addressToSave));
            router.push(returnUrl);
            return;
        }
        
        // If user is logged in, save to backend
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/user/addresses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify(addressToSave)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to save address.');
            }
            
            // Also set it as the current selected location for this session
            localStorage.setItem('customerLocation', JSON.stringify(addressToSave));
            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };


    return (
        <div className="h-screen w-screen flex flex-col bg-background text-foreground">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10 bg-background/80 backdrop-blur-sm">
                 <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft/></Button>
                 <h1 className="text-xl font-bold">Add Address Details</h1>
            </header>

            <div className="flex-grow flex flex-col">
                <div className="h-64 md:h-1/2 w-full flex-shrink-0 relative">
                     <GoogleMap 
                       center={mapCenter}
                       onIdle={handleMapIdle}
                    />
                    <Button 
                       variant="secondary" 
                       className="absolute bottom-4 right-4 z-10 h-12 rounded-full shadow-lg flex items-center gap-2 pr-4 bg-white text-foreground hover:bg-muted"
                       onClick={getCurrentGeolocation}
                       disabled={loading && error.includes('Fetching')}
                   >
                       {(loading && error.includes('Fetching')) ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                       Use Current Location
                   </Button>
                </div>
                
                <div className="p-4 flex-grow overflow-y-auto space-y-4">
                     {loading && !addressDetails ? (
                         <div className="flex items-center justify-center gap-3 p-4">
                             <Loader2 className="animate-spin text-primary"/>
                             <span className="text-muted-foreground">{error || 'Fetching address details...'}</span>
                         </div>
                     ) : error && !addressDetails ? (
                         <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                             <AlertTriangle size={16}/> {error}
                         </div>
                     ) : addressDetails ? (
                         <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-4">
                            <div>
                                <Label>Confirm your address</Label>
                                <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground border border-border">
                                    <p className="font-semibold text-foreground">{addressDetails.street}</p>
                                    <p>{addressDetails.city}, {addressDetails.state} - {addressDetails.pincode}</p>
                                </div>
                            </div>
                            
                            <div>
                                <Label htmlFor="houseNo">Complete Address / House No. *</Label>
                                <Input id="houseNo" value={houseNo} onChange={e => setHouseNo(e.target.value)} placeholder="e.g. House No. 42, Shivam Vihar" required />
                            </div>

                             <div>
                                <Label htmlFor="landmark">Landmark (Optional)</Label>
                                <Input id="landmark" value={landmark} onChange={e => setLandmark(e.target.value)} placeholder="e.g. Near Post Office" />
                            </div>

                             <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="recipientName">Contact Person *</Label>
                                    <Input id="recipientName" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Your Name" required />
                                </div>
                                <div>
                                    <Label htmlFor="recipientPhone">Contact Number *</Label>
                                    <Input id="recipientPhone" type="tel" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="10-digit number" required />
                                </div>
                            </div>

                            <div>
                                <Label>Save address as</Label>
                                 <div className="flex items-start flex-wrap gap-2 mt-2">
                                     <Button type="button" variant={addressLabel === 'Home' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Home')}><Home size={14} className="mr-2"/> Home</Button>
                                     <Button type="button" variant={addressLabel === 'Work' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Work')}><Building size={14} className="mr-2"/> Work</Button>
                                     <Button type="button" variant={addressLabel === 'Other' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Other')}><MapPin size={14} className="mr-2"/> Other</Button>
                                     <AnimatePresence>
                                        {addressLabel === 'Other' && (
                                            <motion.div 
                                                initial={{ width: 0, opacity: 0 }}
                                                animate={{ width: 'auto', opacity: 1 }}
                                                exit={{ width: 0, opacity: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <Input 
                                                    type="text" 
                                                    value={customAddressLabel}
                                                    onChange={e => setCustomAddressLabel(e.target.value)}
                                                    placeholder="Custom Label (e.g., Gym)" 
                                                    className="h-9"
                                                />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                         </motion.div>
                     ) : null}
                </div>
                
                <div className="p-4 border-t border-border flex-shrink-0">
                    <Button onClick={handleConfirmLocation} disabled={loading || isSaving || !addressDetails} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                        {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2"/>}
                        {isSaving ? 'Saving...' : 'Save Address & Continue'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

const AddAddressPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16"/></div>}>
       <AddAddressPageInternal/>
    </Suspense>
);

export default AddAddressPage;
