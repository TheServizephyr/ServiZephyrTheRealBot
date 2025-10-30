
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, Store, Soup, Navigation, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const LocationMarker = ({ location, onMarkerClick }) => {
    const Icon = location.businessType === 'shop' ? Store : Soup;
    return (
        <AdvancedMarker 
            position={{ lat: location.lat, lng: location.lng }}
            onClick={() => onMarkerClick(location)}
        >
            <div className="p-2 bg-primary text-primary-foreground rounded-full shadow-lg">
                <Icon size={20} />
            </div>
        </AdvancedMarker>
    );
};

const DiscoverMap = ({ locations, initialCenter }) => {
    const [selectedLocation, setSelectedLocation] = useState(null);
    const map = useMap();

    useEffect(() => {
        if(map && initialCenter) {
            map.moveCamera({center: initialCenter, zoom: 14});
        }
    }, [initialCenter, map]);

    return (
        <>
            {locations.map(loc => (
                <LocationMarker key={loc.id} location={loc} onMarkerClick={setSelectedLocation} />
            ))}
            {selectedLocation && (
                <InfoWindow 
                    position={{ lat: selectedLocation.lat, lng: selectedLocation.lng }}
                    onCloseClick={() => setSelectedLocation(null)}
                >
                    <div className="p-2">
                        <h4 className="font-bold text-lg text-foreground">{selectedLocation.name}</h4>
                        <p className="text-sm text-muted-foreground">{selectedLocation.address}</p>
                        <Link href={`/order/${selectedLocation.id}`} className="text-primary font-bold text-sm mt-2 inline-block">
                            View Menu &rarr;
                        </Link>
                    </div>
                </InfoWindow>
            )}
        </>
    );
}

export default function DiscoverPage() {
    const [locations, setLocations] = useState([]);
    const [center, setCenter] = useState({ lat: 28.6139, lng: 77.2090 }); // Default to Delhi
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchLocations = async () => {
            try {
                const res = await fetch('/api/discover/locations');
                if (!res.ok) throw new Error('Failed to fetch locations');
                const data = await res.json();
                setLocations(data.locations || []);
            } catch (err) {
                setError(err.message);
            }
        };

        const getUserLocation = () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        setCenter({
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                        });
                        setLoading(false);
                    },
                    (err) => {
                        console.warn("Could not get user location:", err.message);
                        setError("Could not get your location. Please enable location services.");
                        setLoading(false);
                    }
                );
            } else {
                setError("Geolocation is not supported by your browser.");
                setLoading(false);
            }
        };
        
        getUserLocation();
        fetchLocations();

    }, []);

    return (
        <div className="relative h-[calc(100vh-148px)] md:h-[calc(100vh-81px)] w-full flex flex-col">
            <header className="absolute top-0 left-0 right-0 z-10 p-4">
                <div className="container mx-auto bg-background/80 backdrop-blur-md p-4 rounded-xl shadow-lg border border-border">
                    <h1 className="text-2xl font-bold tracking-tight">Discover Nearby</h1>
                    <p className="text-muted-foreground text-sm mt-1">Explore restaurants and shops near you.</p>
                </div>
            </header>
            
            <div className="flex-grow">
                {loading ? (
                    <div className="w-full h-full bg-muted flex flex-col items-center justify-center">
                        <Loader2 className="animate-spin text-primary h-12 w-12" />
                        <p className="mt-4 text-muted-foreground">Finding what's near you...</p>
                    </div>
                ) : error ? (
                    <div className="w-full h-full bg-muted flex flex-col items-center justify-center text-center p-4">
                        <AlertTriangle className="text-destructive h-12 w-12"/>
                         <p className="mt-4 text-destructive font-semibold">{error}</p>
                         <p className="text-sm text-muted-foreground mt-2">Please allow location access in your browser settings to use this feature.</p>
                    </div>
                ) : (
                    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                        <Map 
                            mapId="discover_map"
                            style={{ width: '100%', height: '100%' }}
                            defaultCenter={center}
                            defaultZoom={14}
                            gestureHandling={'greedy'}
                            disableDefaultUI={true}
                        >
                           <DiscoverMap locations={locations} initialCenter={center} />
                        </Map>
                    </APIProvider>
                )}
            </div>
        </div>
    );
}
