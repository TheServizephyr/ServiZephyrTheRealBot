
'use client';

import React, { memo, useState, useEffect, useRef } from 'react';
import { APIProvider, Map, useMap, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Loader2, Globe, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || '';

// MapControls component (No change needed)
const MapControls = () => {
    const map = useMap();
    const [mapTypeId, setMapTypeId] = useState('roadmap');

    const toggleMapType = () => {
        const newTypeId = mapTypeId === 'roadmap' ? 'satellite' : 'roadmap';
        setMapTypeId(newTypeId);
        if (map) map.setMapTypeId(newTypeId);
    };
    
    const resetNorth = () => {
        if (map) {
            map.setHeading(0);
        }
    };

    return (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
             <Button
                variant="secondary"
                size="icon"
                onClick={toggleMapType}
                className="h-12 w-12 rounded-full shadow-lg"
                aria-label="Toggle map type"
            >
                <Globe />
            </Button>
             <Button
                variant="secondary"
                size="icon"
                onClick={resetNorth}
                className="h-12 w-12 rounded-full shadow-lg"
                aria-label="Reset map to North"
            >
                <Compass />
            </Button>
        </div>
    );
};


// Main GoogleMap Component (This is where the fix is)
const GoogleMap = ({ center, onIdle, zoom = 15 }) => {
    const mapRef = useRef(null);

    // This handler will be called *after* the drag (pan) or zoom finishes
    const handleIdle = () => {
        if (mapRef.current && onIdle) {
            const c = typeof mapRef.current.getCenter === 'function' ? mapRef.current.getCenter() : null;
            if (c) {
                if (typeof c.toJSON === 'function') onIdle(c.toJSON());
                else if (typeof c.lat === 'function') onIdle({ lat: c.lat(), lng: c.lng() });
            }
        }
    };

    // **THIS IS THE FIX:**
    // This effect runs ONLY when the 'center' prop changes 
    // (i.e., when the user clicks 'Search' or 'Use Current Location').
    // It manually tells the map to move to the new center.
    useEffect(() => {
        if (mapRef.current && center) {
            console.log("Forcing map to new center:", center);
            if (typeof mapRef.current.setCenter === 'function') mapRef.current.setCenter(center);
        }
    }, [center]); // <-- Runs only when 'center' prop changes

    useEffect(() => {
        if (mapRef.current && Number.isFinite(Number(zoom)) && typeof mapRef.current.setZoom === 'function') {
            mapRef.current.setZoom(Number(zoom));
        }
    }, [zoom]);

    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <div className="w-full h-full relative">
                <Map
                    mapId={GOOGLE_MAP_ID || undefined}
                    style={{ width: '100%', height: '100%' }}
                    
                    // **THE FIX:** Use 'defaultCenter' instead of 'center'
                    // This sets the map's position ONLY on the first load.
                    defaultCenter={center} 

                    defaultZoom={zoom}
                    gestureHandling={'cooperative'}
                    disableDefaultUI={true}
                    tilt={0}
                    
                    // We save the map instance to the ref when it's ready
                    onCameraChanged={(ev) => (mapRef.current = ev.map)} 
                    
                    // We still report when the drag/zoom is finished
                    onIdle={handleIdle} 
                >
                </Map>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                     <div style={{ fontSize: '2.5rem' }}>📍</div>
                </div>
                 <MapControls />
            </div>
        </APIProvider>
    );
};

export default memo(GoogleMap);
