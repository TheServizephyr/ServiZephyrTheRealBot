
'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import MapplsMap from '@/components/MapplsMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const LocationPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restaurantId = searchParams.get('restaurantId');
    const returnUrl = searchParams.get('returnUrl') || `/order/${restaurantId}`;

    const [mapCenter, setMapCenter] = useState(null);
    
    const [addressDetails, setAddressDetails] = useState({
        house: '',
        landmark: '',
        city: '',
        pincode: '',
        fullAddress: '',
        lat: null,
        lng: null,
    });
    
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const debounceTimeout = useRef(null);

    // 1. Get User's Current Location
    const getCurrentLocation = () => {
        console.log("[LocationPage] Attempting to get current GPS location...");
        setLoading(true);
        setError('Fetching your location...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log("[LocationPage] Geolocation successful:", position.coords);
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                setMapCenter(coords);
                reverseGeocode(coords);
            },
            (err) => {
                console.error("[LocationPage] Geolocation error:", err);
                setError('Could not get your location. Please search manually or allow location access.');
                setLoading(false);
                setMapCenter({ lat: 28.6139, lng: 77.2090 });
            },
            { enableHighAccuracy: true }
        );
    };

    useEffect(() => {
        console.log("[LocationPage] Initial mount, calling getCurrentLocation.");
        getCurrentLocation();
    }, []);

    // 2. Reverse Geocode: Lat/Lng -> Address
    const reverseGeocode = async (coords) => {
        console.log("[LocationPage] Reverse geocoding for:", coords);
        setLoading(true);
        setError('');
        try {
            // Since we're using Leaflet now, we can switch to a free geocoding service like Nominatim
            // For simplicity and to avoid another dependency, we'll keep our Mappls API route for now, assuming it's still functional for geocoding.
            // A better solution would be to replace this with Nominatim or another free service.
            const res = await fetch(`/api/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
            console.log(`[LocationPage] /api/location/geocode response status: ${res.status}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
            
            console.log("[LocationPage] Reverse geocode result:", data);
            
            setAddressDetails({
                ...addressDetails,
                city: data.city,
                pincode: data.pincode,
                fullAddress: data.formatted_address,
                lat: coords.lat,
                lng: coords.lng,
            });
            
        } catch (err) {
            console.error("[LocationPage] Reverse geocode API error:", err);
            setError('Could not fetch address details for this location.');
        } finally {
            setLoading(false);
        }
    };
    
    // 3. Search Debouncing
    useEffect(() => {
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        if (searchQuery.length > 2) {
            debounceTimeout.current = setTimeout(async () => {
                console.log("[LocationPage] Searching for:", searchQuery);
                try {
                    // This can also be switched to Nominatim if the Mappls API is fully deprecated
                    const res = await fetch(`/api/location/search?query=${searchQuery}`);
                    console.log(`[LocationPage] /api/location/search response status: ${res.status}`);
                    if (!res.ok) throw new Error('Search failed.');
                    const data = await res.json();
                    console.log("[LocationPage] Search suggestions:", data);
                    setSuggestions(data || []);
                } catch (err) {
                    console.error("[LocationPage] Search API error:", err);
                }
            }, 300);
        } else {
            setSuggestions([]);
        }

        return () => clearTimeout(debounceTimeout.current);
    }, [searchQuery]);


    // 4. Handle Suggestion Selection
    const handleSuggestionClick = (suggestion) => {
        console.log("[LocationPage] Suggestion selected:", suggestion);
        setSearchQuery(suggestion.placeName);
        setSuggestions([]);
        const coords = { lat: suggestion.latitude, lng: suggestion.longitude };
        setMapCenter(coords); 
        reverseGeocode(coords);
    };

    // 5. Handle Confirm Location
    const handleConfirmLocation = () => {
        console.log("[LocationPage] Confirming location:", addressDetails);
        const locationData = {
            ...addressDetails,
            house: addressDetails.house,
            landmark: addressDetails.landmark,
            full: `${addressDetails.house ? addressDetails.house + ', ' : ''}${addressDetails.landmark ? addressDetails.landmark + ', ' : ''}${addressDetails.fullAddress}`,
            phone: localStorage.getItem('lastKnownPhone') || ''
        };
        localStorage.setItem('customerLocation', JSON.stringify(locationData));
        router.push(returnUrl);
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-background text-foreground">
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
                {mapCenter ? (
                     <MapplsMap 
                        initialCenter={mapCenter}
                        onPinDragEnd={reverseGeocode}
                     />
                ) : (
                    <div className="h-full w-full flex items-center justify-center bg-muted">
                        <Loader2 className="animate-spin text-primary h-8 w-8"/>
                    </div>
                )}
                 <Button 
                    variant="secondary" 
                    size="icon" 
                    className="absolute bottom-28 right-4 z-10 h-12 w-12 rounded-full shadow-lg"
                    onClick={getCurrentLocation}
                >
                    <LocateFixed/>
                </Button>
            </div>

            <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 25 }}
                className="bg-card border-t border-border p-4 rounded-t-2xl shadow-lg flex-shrink-0 z-10"
            >
                {loading ? (
                    <div className="flex items-center gap-3">
                        <Loader2 className="animate-spin text-primary"/>
                        <span className="text-muted-foreground">{error || 'Fetching address...'}</span>
                    </div>
                ) : error ? (
                     <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                         <AlertTriangle size={16}/> {error}
                     </div>
                ) : (
                    <div className="space-y-3">
                         <div>
                            <p className="font-bold text-lg flex items-center gap-2"><MapPin size={20} className="text-primary"/> {addressDetails.city}</p>
                            <p className="text-sm text-muted-foreground">{addressDetails.fullAddress}</p>
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                            <Input placeholder="House / Flat No." value={addressDetails.house} onChange={e => setAddressDetails(prev => ({...prev, house: e.target.value}))}/>
                            <Input placeholder="Landmark (Optional)" value={addressDetails.landmark} onChange={e => setAddressDetails(prev => ({...prev, landmark: e.target.value}))}/>
                         </div>
                         <Button onClick={handleConfirmLocation} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                            Confirm Location
                         </Button>
                    </div>
                )}
            </motion.div>
        </div>
    );
};

const LocationPage = () => (
    <Suspense fallback={<div>Loading...</div>}>
        <LocationPageInternal/>
    </Suspense>
);

export default LocationPage;
