'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import dynamic from 'next/dynamic';
import { auth } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';

const GoogleMap = dynamic(() => import('@/components/GoogleMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>
});

const OwnerLocationPage = () => {
    const router = useRouter();
    
    // Default to Agra, near Tundla, for a better initial experience.
    const [mapCenter, setMapCenter] = useState({ lat: 27.1767, lng: 78.0081 }); 
    const [addressDetails, setAddressDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // Try to get user's current location on initial load.
    const getCurrentLocationAndSetMap = (fallbackToSaved = false) => {
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
                    // If user denies permission, then try fetching saved location.
                    setError('Could not get your location. Please search manually or allow location access.');
                    if (fallbackToSaved) fetchInitialLocation(); else setLoading(false);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        } else {
            if (fallbackToSaved) fetchInitialLocation(); else setLoading(false);
        }
    };
    
    // Function to fetch already saved location from backend.
    const fetchInitialLocation = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) {
                router.push('/');
                return;
            }
            const idToken = await user.getIdToken();
            const res = await fetch('/api/owner/locations', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.location) {
                    const { latitude, longitude, address } = data.location;
                    const coords = { lat: latitude, lng: longitude };
                    setMapCenter(coords);
                    setAddressDetails({ fullAddress: address, latitude, longitude });
                } else {
                    // If no saved location, try to get current geo-location.
                    getCurrentLocationAndSetMap(false);
                }
            } else {
                 getCurrentLocationAndSetMap(false);
            }
        } catch (err) {
            setError("Failed to fetch current location.");
            getCurrentLocationAndSetMap(false); // Fallback to geolocation
        } finally {
            setLoading(false);
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


    const reverseGeocode = async (coords) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
            
            setAddressDetails({
                fullAddress: data.formatted_address,
                latitude: coords.lat,
                longitude: coords.lng,
            });
            
        } catch (err) {
            setError('Could not fetch address details for this pin location.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveLocation = async () => {
        const user = auth.currentUser;
        if (!user || !addressDetails) {
            setInfoDialog({ isOpen: true, title: "Error", message: "User not logged in or location not set." });
            return;
        }

        setIsSaving(true);
        try {
            const idToken = await user.getIdToken();
            const locationToSave = {
                latitude: addressDetails.latitude,
                longitude: addressDetails.longitude,
                address: addressDetails.fullAddress,
            };

            const res = await fetch('/api/owner/locations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ location: locationToSave }),
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
             <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10">
                <div>
                    <h1 className="text-2xl font-bold">Set Your Business Location</h1>
                    <p className="text-muted-foreground text-sm">Drag the pin to the exact spot where customers or delivery riders should arrive.</p>
                </div>
            </header>

            <div className="flex-grow relative">
                 <GoogleMap 
                    center={mapCenter}
                    onPinDragEnd={reverseGeocode}
                 />
            </div>

            <motion.div 
                className="bg-card border-t border-border p-4 rounded-t-2xl shadow-lg flex-shrink-0 z-10"
            >
                {loading ? (
                    <div className="flex items-center gap-3">
                        <Loader2 className="animate-spin text-primary"/>
                        <span className="text-muted-foreground">{error || 'Fetching location...'}</span>
                    </div>
                ) : (
                    <div className="flex flex-col md:flex-row items-center gap-4">
                        <div className="flex-grow w-full">
                            <p className="font-bold text-lg flex items-center gap-2"><MapPin size={20} className="text-primary"/> Selected Location</p>
                            <p className="text-sm text-muted-foreground">{addressDetails?.fullAddress || 'Drag the pin on the map to set your location.'}</p>
                        </div>
                        <Button onClick={handleSaveLocation} disabled={!addressDetails || isSaving} className="w-full md:w-auto h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                            {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2"/>}
                            {isSaving ? 'Saving...' : 'Save Location'}
                        </Button>
                    </div>
                )}
            </motion.div>
        </div>
    );
};


export default OwnerLocationPage;
