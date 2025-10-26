
'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import dynamic from 'next/dynamic';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import { useAuth } from '@/firebase';
import { cn } from '@/lib/utils';


const GoogleMap = dynamic(() => import('@/components/GoogleMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
});

const LocationPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    const returnUrl = searchParams.get('returnUrl') || `/order/${restaurantId}`;
    
    const { user } = useAuth();
    const [mapCenter, setMapCenter] = useState({ lat: 28.6139, lng: 77.2090 }); // Default to Delhi
    const [addressDetails, setAddressDetails] = useState(null);
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customLabel, setCustomLabel] = useState('');
    const [showCustomLabelInput, setShowCustomLabelInput] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const debounceTimeout = useRef(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [isPanelOpen, setIsPanelOpen] = useState(true);


    const getCurrentLocation = () => {
        setLoading(true);
        setError('Fetching your location...');
        
        if (!navigator.geolocation) {
            setError("Geolocation is not supported by your browser.");
            setLoading(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                handleMapCenterChange(coords); // Use the new handler
            },
            (err) => {
                setError('Could not get your location. Please search manually or allow location access.');
                setLoading(false);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    const reverseGeocode = async (coords) => {
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
                fullAddress: data.formatted_address,
                latitude: coords.lat,
                longitude: coords.lng,
            });
            setSearchQuery(data.formatted_address);
            
        } catch (err) {
            setError('Could not fetch address details for this pin location.');
        } finally {
            setLoading(false);
        }
    };
    
    // New handler to update state and fetch address
    const handleMapCenterChange = (coords) => {
        setMapCenter(coords);
        reverseGeocode(coords);
    };

    useEffect(() => {
        // Automatically try to get location on first load
        getCurrentLocation();
    }, []);

    useEffect(() => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        if (searchQuery && searchQuery !== addressDetails?.fullAddress) {
            debounceTimeout.current = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/location/search?query=${searchQuery}`);
                    if (!res.ok) throw new Error('Search failed.');
                    const data = await res.json();
                    setSuggestions(data || []);
                } catch (err) {
                    console.error("Search API error:", err);
                }
            }, 300);
        } else {
            setSuggestions([]);
        }

        return () => clearTimeout(debounceTimeout.current);
    }, [searchQuery, addressDetails]);

    const handleSuggestionClick = (suggestion) => {
        setSearchQuery(suggestion.placeAddress);
        setSuggestions([]);
        const coords = { lat: suggestion.latitude, lng: suggestion.longitude };
        handleMapCenterChange(coords); // Use the new handler
    };
    
    const handleAddressFieldChange = (field, value) => {
        setAddressDetails(prev => ({ ...prev, [field]: value }));
    };

    const handleLabelClick = (label) => {
        setAddressLabel(label);
        setShowCustomLabelInput(label === 'Other');
        if (label !== 'Other') {
            setCustomLabel('');
        }
    };


    const handleConfirmLocation = async () => {
        if (!addressDetails) {
             setInfoDialog({ isOpen: true, title: "Error", message: "Please set a location first." });
             return;
        }

        const finalLabel = addressLabel === 'Other' ? (customLabel.trim() || 'Other') : addressLabel;

        const addressToSave = {
            id: `addr_${Date.now()}`,
            label: finalLabel,
            name: user?.displayName || localStorage.getItem('lastKnownName') || 'User',
            phone: user?.phoneNumber || localStorage.getItem('lastKnownPhone') || '',
            street: addressDetails.street,
            city: addressDetails.city,
            state: addressDetails.state,
            pincode: addressDetails.pincode,
            country: addressDetails.country,
            full: `${addressDetails.street}, ${addressDetails.city}, ${addressDetails.state} - ${addressDetails.pincode}`,
        };

        if (!user) {
            localStorage.setItem('customerLocation', JSON.stringify(addressToSave));
            router.push(returnUrl);
            return;
        }

        setIsSaving(true);
        try {
            const idToken = await user.getIdToken();
            
            const res = await fetch('/api/user/addresses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify(addressToSave),
            });
            
            const resultData = await res.json();
            if (!res.ok) {
                throw new Error(resultData.message || "Failed to save new address.");
            }

            localStorage.setItem('customerLocation', JSON.stringify(addressToSave));
            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-background text-foreground green-theme">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
             <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10 bg-background/80 backdrop-blur-sm">
                <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft/></Button>
                <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"/>
                    <Input
                        type="text"
                        placeholder="Search for your location..."
                        className="w-full pl-10 h-11"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {suggestions.length > 0 && (
                        <div className="absolute top-full mt-2 w-full bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto z-20">
                            {suggestions.map(s => (
                                <div key={s.eLoc} onClick={() => handleSuggestionClick(s)} className="p-3 hover:bg-muted cursor-pointer border-b border-border last:border-b-0">
                                    <p className="font-semibold text-sm">{s.placeName}</p>
                                    <p className="text-xs text-muted-foreground">{s.placeAddress}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            <div className="flex-grow relative">
                 <GoogleMap 
                    center={mapCenter}
                    onCenterChanged={handleMapCenterChange}
                 />
                 <Button 
                    variant="secondary" 
                    className="absolute top-4 right-4 z-10 h-12 rounded-full shadow-lg flex items-center gap-2 pr-4"
                    onClick={getCurrentLocation}
                >
                    {loading && error === 'Fetching your location...' ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                    Use Current Location
                </Button>
            </div>
            
             <div className="fixed bottom-0 left-0 right-0 z-20 bg-card border-t border-border rounded-t-2xl shadow-lg">
                <button
                    onClick={() => setIsPanelOpen(prev => !prev)}
                    className="w-full flex justify-between items-center cursor-pointer p-4"
                >
                    <p className="font-bold text-lg flex items-center gap-2">
                        <MapPin size={20} className="text-primary"/> Set Delivery Location
                    </p>
                    <motion.div animate={{ rotate: isPanelOpen ? 180 : 0 }}>
                        <ChevronUp/>
                    </motion.div>
                </button>

                <AnimatePresence initial={false}>
                {isPanelOpen && (
                    <motion.div
                        key="content"
                        initial="collapsed"
                        animate="open"
                        exit="collapsed"
                        variants={{
                            open: { opacity: 1, height: "auto" },
                            collapsed: { opacity: 0, height: 0 }
                        }}
                        transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
                            {loading ? (
                                <div className="flex items-center gap-3">
                                    <Loader2 className="animate-spin text-primary"/>
                                    <span className="text-muted-foreground">{error || 'Fetching address...'}</span>
                                </div>
                            ) : error && !addressDetails ? (
                                <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                                    <AlertTriangle size={16}/> {error}
                                </div>
                            ) : addressDetails ? (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        <Input value={addressDetails.street || ''} onChange={(e) => handleAddressFieldChange('street', e.target.value)} placeholder="Street / Area"/>
                                        <Input value={addressDetails.city || ''} onChange={(e) => handleAddressFieldChange('city', e.target.value)} placeholder="City"/>
                                        <Input value={addressDetails.pincode || ''} onChange={(e) => handleAddressFieldChange('pincode', e.target.value)} placeholder="Pincode"/>
                                        <Input value={addressDetails.state || ''} onChange={(e) => handleAddressFieldChange('state', e.target.value)} placeholder="State"/>
                                    </div>
                                    <div className="pt-2">
                                        <Label>Label as:</Label>
                                        <div className="flex items-center flex-wrap gap-2 mt-2">
                                            <Button type="button" variant={addressLabel === 'Home' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Home')}><Home size={14} className="mr-2"/> Home</Button>
                                            <Button type="button" variant={addressLabel === 'Work' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Work')}><Building size={14} className="mr-2"/> Work</Button>
                                            <Button type="button" variant={addressLabel === 'Other' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Other')}><MapPin size={14} className="mr-2"/> Other</Button>
                                            {showCustomLabelInput && (
                                                <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} transition={{ duration: 0.3 }}>
                                                    <Input
                                                        type="text"
                                                        value={customLabel}
                                                        onChange={(e) => setCustomLabel(e.target.value)}
                                                        placeholder="e.g., Friend's House"
                                                        className="h-9"
                                                    />
                                                </motion.div>
                                            )}
                                        </div>
                                    </div>
                                    <Button onClick={handleConfirmLocation} disabled={!addressDetails.street || loading || isSaving} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                        {isSaving ? <Loader2 className="animate-spin" /> : 'Confirm & Save Location'}
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center text-muted-foreground p-4">
                                    Search for a location or use the GPS button to find your address.
                                </div>
                            )}
                        </div>
                    </motion.div>
                 )}
                 </AnimatePresence>
            </div>
        </div>
    );
};

const LocationPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16"/></div>}>
        <LocationPageInternal/>
    </Suspense>
);

export default LocationPage;
