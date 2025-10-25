
'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building } from 'lucide-react';
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

const OwnerLocationPage = () => {
    const router = useRouter();
    
    const [mapCenter, setMapCenter] = useState({ lat: 27.1751, lng: 78.0421 }); // Default Agra
    const [addressDetails, setAddressDetails] = useState(null);
    const [addressLabel, setAddressLabel] = useState('Work');
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const debounceTimeout = useRef(null);
    
    
    const fetchInitialLocation = async () => {
        setLoading(true);
        setError('');
        try {
            const user = auth.currentUser;
            if (!user) {
                router.push('/');
                return;
            }
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/settings', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.address && data.address.latitude && data.address.longitude) {
                    const { latitude, longitude, ...addr } = data.address;
                    const coords = { lat: latitude, lng: longitude };
                    setMapCenter(coords);
                    setAddressDetails({ 
                        ...addr,
                        street: addr.street || '',
                        city: addr.city || '',
                        pincode: addr.postalCode || '',
                        state: addr.state || '',
                        country: addr.country || 'IN',
                        fullAddress: addr.full || `${addr.street}, ${addr.city}`,
                        latitude, 
                        longitude 
                    });
                     setSearchQuery(addr.street ? `${addr.street}, ${addr.city}` : '');
                     setLoading(false);
                } else {
                    getCurrentGeolocation(); // No saved location, get current
                }
            } else {
                 getCurrentGeolocation(); // API error, get current
            }
        } catch (err) {
            setError("Failed to fetch saved location. Trying to get current location...");
            getCurrentGeolocation();
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchInitialLocation();
            } else {
                router.push('/');
            }
        });
        return () => unsubscribe();
    }, [router]);

    const getCurrentGeolocation = () => {
        setLoading(true);
        setError('');
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const coords = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };
                    setMapCenter(coords);
                    reverseGeocode(coords);
                },
                (err) => {
                    setError('Could not get your location. Please search manually or check browser permissions.');
                    setLoading(false);
                    setMapCenter({ lat: 27.1751, lng: 78.0421 }); // Agra default
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        } else {
            setError("Geolocation is not supported by your browser.");
            setLoading(false);
        }
    };

    useEffect(() => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        if (searchQuery.length > 2 && searchQuery !== addressDetails?.fullAddress) {
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
        setMapCenter(coords); 
        reverseGeocode(coords);
    };

    const handleAddressFieldChange = (field, value) => {
        setAddressDetails(prev => ({ ...prev, [field]: value }));
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

    const handleSaveLocation = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser || !addressDetails) {
            setInfoDialog({ isOpen: true, title: "Error", message: "User not logged in or location not set." });
            return;
        }

        setIsSaving(true);
        try {
            const idToken = await currentUser.getIdToken();
            const locationToSave = {
                street: addressDetails.street,
                city: addressDetails.city,
                state: addressDetails.state,
                postalCode: addressDetails.pincode,
                country: addressDetails.country,
                latitude: addressDetails.latitude,
                longitude: addressDetails.longitude,
            };

            const res = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ address: locationToSave }),
            });
            
            if(!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to save location");
            }
            setInfoDialog({ isOpen: true, title: "Success", message: "Your business location has been updated successfully!" });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };


    return (
        <div className="h-full flex flex-col bg-background text-foreground">
             <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <div className="p-4 border-b border-border flex-shrink-0 z-10 space-y-4">
                <div>
                    <h1 className="text-2xl font-bold">Set Your Business Location</h1>
                    <p className="text-muted-foreground text-sm">Search, or drag the pin to set your location. Then, fine-tune the address details below.</p>
                </div>
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
            </div>

            <div className="flex-grow flex flex-col md:flex-row relative">
                <div className="w-full h-64 md:h-full md:flex-1">
                    <GoogleMap 
                        center={mapCenter}
                        onPinDragEnd={reverseGeocode}
                    />
                </div>
                <div className="w-full md:w-1/3 md:max-w-md flex-shrink-0 bg-card border-t md:border-t-0 md:border-l border-border p-4 space-y-4 overflow-y-auto">
                      <Button 
                        variant="secondary" 
                        className="w-full h-12 shadow-lg flex items-center gap-2"
                        onClick={getCurrentGeolocation}
                        disabled={loading}
                    >
                        {loading && !addressDetails ? <Loader2 className="animate-spin"/> : <LocateFixed/>} 
                        Use My Current Location
                    </Button>
                    
                    {loading && !addressDetails ? (
                        <div className="flex items-center gap-3 p-4 justify-center">
                            <Loader2 className="animate-spin text-primary"/>
                            <span className="text-muted-foreground">{error || 'Fetching location...'}</span>
                        </div>
                    ) : error && !addressDetails ? (
                         <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                             <AlertTriangle size={16}/> {error}
                         </div>
                    ) : addressDetails ? (
                        <div className="space-y-4">
                            <div>
                                <p className="font-bold text-lg flex items-center gap-2 mb-2"><MapPin size={20} className="text-primary"/> Fine-tune Address</p>
                                <div className="grid grid-cols-1 gap-3">
                                    <Input value={addressDetails.street || ''} onChange={(e) => handleAddressFieldChange('street', e.target.value)} placeholder="Street / Area"/>
                                    <Input value={addressDetails.city || ''} onChange={(e) => handleAddressFieldChange('city', e.target.value)} placeholder="City"/>
                                    <Input value={addressDetails.pincode || ''} onChange={(e) => handleAddressFieldChange('pincode', e.target.value)} placeholder="Pincode"/>
                                    <Input value={addressDetails.state || ''} onChange={(e) => handleAddressFieldChange('state', e.target.value)} placeholder="State"/>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                <Label>Label as:</Label>
                                <Button type="button" variant={addressLabel === 'Work' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Work')}><Building size={14} className="mr-2"/> Work</Button>
                            </div>
                            <Button onClick={handleSaveLocation} disabled={!addressDetails.street || isSaving} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2"/>}
                                {isSaving ? 'Saving...' : 'Save Business Location'}
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default OwnerLocationPage;
