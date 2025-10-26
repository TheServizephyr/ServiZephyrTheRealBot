'use client';

import React, { useState, useEffect, useRef } from 'react';
import { APIProvider, Map, useMap, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Loader2, Globe, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// This is the key component that syncs the map state with React state
const MapInnerComponent = ({ center, onIdle }) => {
    const map = useMap(); // Get map instance from the context

    // Effect 1: Imperatively update map center when the 'center' prop changes from parent
    useEffect(() => {
        if (map && center) {
            const currentMapCenter = map.getCenter().toJSON();
            // Check if the center has actually changed to avoid infinite loops
            if (currentMapCenter.lat.toFixed(6) !== center.lat.toFixed(6) || currentMapCenter.lng.toFixed(6) !== center.lng.toFixed(6)) {
                 map.setCenter(center);
            }
        }
    }, [map, center]);

    // Effect 2: Add the 'idle' listener for drag detection
    useEffect(() => {
        if (!map || !onIdle) return;
        
        const idleListener = map.addListener('idle', () => {
            const newCenter = map.getCenter().toJSON();
            onIdle(newCenter);
        });
        
        // Cleanup listener on unmount
        return () => {
            if (idleListener) {
                idleListener.remove();
            }
        };
    }, [map, onIdle]);

    return null; // This component does not render anything itself
};


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


const GoogleMap = ({ center, onIdle }) => {
    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <div className="w-full h-full relative">
                <Map
                    mapId="servizephyr_map"
                    style={{ width: '100%', height: '100%' }}
                    center={center}
                    defaultZoom={15}
                    gestureHandling={'greedy'}
                    disableDefaultUI={true}
                    tilt={0}
                >
                  <MapInnerComponent center={center} onIdle={onIdle} />
                </Map>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                     <div style={{ fontSize: '2.5rem' }}>📍</div>
                </div>
                 <MapControls />
            </div>
        </APIProvider>
    );
};

export default GoogleMap;
