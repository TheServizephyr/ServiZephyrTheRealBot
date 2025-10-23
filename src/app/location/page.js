
'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import dynamic from 'next/dynamic';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';


const MapplsMap = dynamic(() => import('@/components/MapplsMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
});

const LocationPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    const returnUrl = searchParams.get('returnUrl') || `/order/${restaurantId}`;
    
    const [mapCenter, setMapCenter] = useState({ lat: 28.7041, lng: 77.1025 }); // Default to Delhi
    const [addressDetails, setAddressDetails] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const debounceTimeout = useRef(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });


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
                setMapCenter(coords);
                reverseGeocode(coords);
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
                house: '',
                landmark: '',
                city: data.city,
                pincode: data.pincode,
                state: data.state,
                country: data.country,
                fullAddress: data.formatted_address,
                latitude: coords.lat,
                longitude: coords.lng,
            });
            
        } catch (err) {
            setError('Could not fetch address details for this location.');
        } finally {
            setLoading(false);
        }
    };
    
    useEffect(() => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        if (searchQuery.length > 2) {
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
    }, [searchQuery]);


    const handleSuggestionClick = (suggestion) => {
        setSearchQuery(suggestion.placeName);
        setSuggestions([]);
        const coords = { lat: suggestion.latitude, lng: suggestion.longitude };
        setMapCenter(coords); 
        reverseGeocode(coords);
    };

    const handleConfirmLocation = async () => {
        const user = auth.currentUser;
        if (!user) {
            // If user is not logged in, save to local storage and redirect
            localStorage.setItem('customerLocation', JSON.stringify(addressDetails));
            router.push(returnUrl);
            return;
        }

        if (!addressDetails) return;

        setLoading(true);
        try {
            const idToken = await user.getIdToken();
            const locationToSave = {
                id: `loc_${Date.now()}`,
                label: 'Other',
                name: user.displayName || 'Me',
                phone: user.phoneNumber || localStorage.getItem('lastKnownPhone') || '',
                full: `${addressDetails.house ? addressDetails.house + ', ' : ''}${addressDetails.landmark ? addressDetails.landmark + ', ' : ''}${addressDetails.fullAddress}`,
                ...addressDetails,
            };

            await fetch('/api/user/locations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify(locationToSave),
            });

            // Also update local storage for immediate use
            localStorage.setItem('customerLocation', JSON.stringify(locationToSave));
            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setLoading(false);
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
             <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10">
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
                 <MapplsMap 
                    initialCenter={mapCenter}
                    onPinDragEnd={reverseGeocode}
                 />
                 <Button 
                    variant="secondary" 
                    className="absolute bottom-28 right-4 z-10 h-12 rounded-full shadow-lg flex items-center gap-2 pr-4"
                    onClick={getCurrentLocation}
                >
                    <LocateFixed/> Use Current Location
                </Button>
            </div>

            <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 25 }}
                className="bg-card border-t border-border p-4 rounded-t-2xl shadow-lg flex-shrink-0 z-10"
            >
                {loading && !addressDetails ? (
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
                         <div>
                            <p className="font-bold text-lg flex items-center gap-2"><MapPin size={20} className="text-primary"/> {addressDetails.city || 'Location'}</p>
                            <p className="text-sm text-muted-foreground">{addressDetails.fullAddress || 'Drag the pin to set your precise location.'}</p>
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                            <Input placeholder="House / Flat No." value={addressDetails.house} onChange={e => setAddressDetails(prev => ({...prev, house: e.target.value}))}/>
                            <Input placeholder="Landmark (Optional)" value={addressDetails.landmark} onChange={e => setAddressDetails(prev => ({...prev, landmark: e.target.value}))}/>
                         </div>
                         <Button onClick={handleConfirmLocation} disabled={!addressDetails.fullAddress || loading} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                            {loading ? <Loader2 className="animate-spin" /> : 'Confirm & Save Location'}
                         </Button>
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground p-4">
                        Search for a location or use the GPS button to find your address.
                    </div>
                )}
            </motion.div>
        </div>
    );
};

const LocationPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16"/></div>}>
        <LocationPageInternal/>
    </Suspense>
);

export default LocationPage;
