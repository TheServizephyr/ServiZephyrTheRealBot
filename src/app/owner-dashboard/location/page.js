
'use client';

import React, { useState, useEffect, Suspense, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NextDynamic from 'next/dynamic';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import { useAuth } from '@/firebase';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

export const dynamic = 'force-dynamic';

const GoogleMap = NextDynamic(() => import('@/components/GoogleMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const OwnerLocationPage = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const geocodeTimeoutRef = useRef(null);
    const desktopRuntime = useMemo(() => isDesktopApp(), []);
    const locationCacheKey = useMemo(() => [
        'owner_location_v1',
        impersonatedOwnerId || 'self',
        employeeOfOwnerId || 'none',
    ].join(':'), [employeeOfOwnerId, impersonatedOwnerId]);

    const [mapCenter, setMapCenter] = useState({ lat: 27.1751, lng: 78.0421 }); // Default Agra
    const [addressDetails, setAddressDetails] = useState(null);
    const [savedLocation, setSavedLocation] = useState(null); // NEW: Store initial saved location
    const [fullAddress, setFullAddress] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const debounceTimeout = useRef(null);


    const fetchInitialLocation = useCallback(async () => {
        setLoading(true);
        setError('');
        const startCurrentGeolocation = () => {
            setLoading(true);
            setError('');
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const coords = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                        };
                        handleMapIdle(coords);
                    },
                    () => {
                        setError('Could not get your location. Please search manually or check browser permissions.');
                        setLoading(false);
                        setMapCenter({ lat: 27.1751, lng: 78.0421 });
                    },
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                );
            } else {
                setError("Geolocation is not supported by your browser.");
                setLoading(false);
            }
        };
        try {
            const user = auth.currentUser;
            if (!user) {
                setLoading(false);
                return;
            }
            const idToken = await user.getIdToken();

            const queryParams = new URLSearchParams();
            if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
            if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
            const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

            const res = await fetch(`/api/owner/settings${queryString}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.address && data.address.latitude && data.address.longitude) {
                    const { latitude, longitude, ...addr } = data.address;

                    // NEW: Set the Saved Location for display
                    setSavedLocation(data.address);

                    const coords = { lat: latitude, lng: longitude };
                    setMapCenter(coords);
                    setAddressDetails({
                        street: addr.street || '',
                        city: addr.city || '',
                        pincode: addr.postalCode || '',
                        state: addr.state || '',
                        country: addr.country || 'IN',
                        latitude,
                        longitude
                    });
                    setFullAddress(addr.full || `${addr.street}, ${addr.city}`);
                    setSearchQuery(addr.full || `${addr.street}, ${addr.city}`);
                    if (desktopRuntime) {
                        await setOfflineNamespace('owner_location', locationCacheKey, {
                            savedLocation: data.address,
                            mapCenter: coords,
                            addressDetails: {
                                street: addr.street || '',
                                city: addr.city || '',
                                pincode: addr.postalCode || '',
                                state: addr.state || '',
                                country: addr.country || 'IN',
                                latitude,
                                longitude
                            },
                            fullAddress: addr.full || `${addr.street}, ${addr.city}`,
                            searchQuery: addr.full || `${addr.street}, ${addr.city}`,
                        });
                    }
                    setLoading(false);
                } else {
                    if (desktopRuntime) {
                        const desktopPayload = await getOfflineNamespace('owner_location', locationCacheKey, null);
                        if (desktopPayload) {
                            setSavedLocation(desktopPayload.savedLocation || null);
                            setMapCenter(desktopPayload.mapCenter || { lat: 27.1751, lng: 78.0421 });
                            setAddressDetails(desktopPayload.addressDetails || null);
                            setFullAddress(desktopPayload.fullAddress || '');
                            setSearchQuery(desktopPayload.searchQuery || desktopPayload.fullAddress || '');
                            setLoading(false);
                            return;
                        }
                    }
                    startCurrentGeolocation(); // No saved location, get current
                }
            } else {
                const desktopPayload = desktopRuntime
                    ? await getOfflineNamespace('owner_location', locationCacheKey, null)
                    : null;
                if (desktopPayload) {
                    setSavedLocation(desktopPayload.savedLocation || null);
                    setMapCenter(desktopPayload.mapCenter || { lat: 27.1751, lng: 78.0421 });
                    setAddressDetails(desktopPayload.addressDetails || null);
                    setFullAddress(desktopPayload.fullAddress || '');
                    setSearchQuery(desktopPayload.searchQuery || desktopPayload.fullAddress || '');
                    setLoading(false);
                } else {
                    startCurrentGeolocation(); // API error, get current
                }
            }
        } catch (err) {
            const desktopPayload = desktopRuntime
                ? await getOfflineNamespace('owner_location', locationCacheKey, null)
                : null;
            if (desktopPayload) {
                setSavedLocation(desktopPayload.savedLocation || null);
                setMapCenter(desktopPayload.mapCenter || { lat: 27.1751, lng: 78.0421 });
                setAddressDetails(desktopPayload.addressDetails || null);
                setFullAddress(desktopPayload.fullAddress || '');
                setSearchQuery(desktopPayload.searchQuery || desktopPayload.fullAddress || '');
                setLoading(false);
            } else {
                setError("Failed to fetch saved location. Trying to get current location...");
                startCurrentGeolocation();
            }
        }
    }, [desktopRuntime, employeeOfOwnerId, impersonatedOwnerId, locationCacheKey, handleMapIdle]);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchInitialLocation();
            } else {
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }, [fetchInitialLocation]);

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
                    handleMapIdle(coords);
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

        if (searchQuery.length > 2 && searchQuery !== fullAddress) {
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
    }, [searchQuery, fullAddress]);

    const handleSuggestionClick = (suggestion) => {
        setSearchQuery(suggestion.placeAddress);
        setSuggestions([]);
        const coords = { lat: suggestion.latitude, lng: suggestion.longitude };
        handleMapIdle(coords);
    };

    const reverseGeocode = useCallback(async (coords) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');

            setAddressDetails({
                street: data.street,
                city: data.city,
                pincode: data.pincode,
                state: data.state,
                country: data.country,
                latitude: coords.lat,
                longitude: coords.lng,
            });
            setFullAddress(data.formatted_address);
            setSearchQuery(data.formatted_address);

        } catch (err) {
            setError('Could not fetch address details for this pin location.');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleMapIdle = useCallback((coords) => {
        // FIX: Do NOT update mapCenter state here.
        // Updating state triggers re-render -> passes new 'center' prop to GoogleMap -> triggers map.setCenter -> triggers 'idle' -> Loop.
        // The map is already at 'coords' because the user dragged it. We just need to reverse geocode.

        if (geocodeTimeoutRef.current) {
            clearTimeout(geocodeTimeoutRef.current);
        }
        geocodeTimeoutRef.current = setTimeout(() => {
            reverseGeocode(coords);
        }, 500);
    }, [reverseGeocode]);


    const handleSaveLocation = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser || !addressDetails || !fullAddress.trim()) {
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
                full: fullAddress.trim(),
            };

            const queryParams = new URLSearchParams();
            if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
            if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
            const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

            const res = await fetch(`/api/owner/settings${queryString}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ address: locationToSave }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to save location");
            }
            setSavedLocation(locationToSave);
            if (desktopRuntime) {
                await setOfflineNamespace('owner_location', locationCacheKey, {
                    savedLocation: locationToSave,
                    mapCenter: { lat: locationToSave.latitude, lng: locationToSave.longitude },
                    addressDetails,
                    fullAddress: locationToSave.full,
                    searchQuery: locationToSave.full,
                });
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
                    <p className="text-muted-foreground text-sm">Search, or drag the map to set your pin. Then, fine-tune the address details below.</p>
                </div>
                <OfflineDesktopStatus />
                <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
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
                        onIdle={handleMapIdle}
                    />
                </div>
                <div className="w-full md:w-1/3 md:max-w-md flex-shrink-0 bg-card border-t md:border-t-0 md:border-l border-border p-4 space-y-4 overflow-y-auto">

                    {/* NEW: Current Saved Location Display */}
                    {savedLocation && (
                        <div className="bg-muted/30 p-4 rounded-lg border border-border mb-4">
                            <h3 className="font-semibold flex items-center gap-2 mb-2 text-primary">
                                <Building size={18} /> Current Registered Location
                            </h3>
                            <p className="text-sm font-medium">{savedLocation.full || `${savedLocation.street}, ${savedLocation.city}`}</p>
                            <div className="mt-2 text-xs text-muted-foreground grid grid-cols-2 gap-2">
                                <p><span className="font-semibold">Lat:</span> {savedLocation.latitude?.toFixed(6)}</p>
                                <p><span className="font-semibold">Lng:</span> {savedLocation.longitude?.toFixed(6)}</p>
                            </div>
                        </div>
                    )}

                    <Button
                        variant="secondary"
                        className="w-full h-12 shadow-lg flex items-center gap-2"
                        onClick={getCurrentGeolocation}
                    >
                        {(loading && error === 'Fetching your location...') ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                        Use My Current Location
                    </Button>

                    {loading && !addressDetails ? (
                        <div className="flex items-center gap-3 p-4 justify-center">
                            <Loader2 className="animate-spin text-primary" />
                            <span className="text-muted-foreground">{error || 'Fetching location...'}</span>
                        </div>
                    ) : error && !addressDetails ? (
                        <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    ) : addressDetails ? (
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="full-address" className="font-bold text-lg flex items-center gap-2 mb-2"><MapPin size={20} className="text-primary" /> Fine-tune Full Address</Label>
                                <Textarea
                                    id="full-address"
                                    value={fullAddress}
                                    onChange={(e) => setFullAddress(e.target.value)}
                                    placeholder="e.g., 123 Main St, Anytown, State 12345"
                                    className="h-28"
                                />
                                <p className="text-xs text-muted-foreground mt-1">This is the complete address that will be saved.</p>
                            </div>

                            <Button onClick={handleSaveLocation} disabled={!fullAddress.trim() || isSaving} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
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
