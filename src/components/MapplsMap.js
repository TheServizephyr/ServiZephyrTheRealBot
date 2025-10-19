'use client';

import React, { useEffect, useRef } from 'react';
import Script from 'next/script';
import { Loader2 } from 'lucide-react';

const MapplsMap = ({ onMapLoad, initialCenter, onPinDragEnd }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const markerInstance = useRef(null);
    const [scriptsLoaded, setScriptsLoaded] = React.useState(false);
    const [mapInitialized, setMapInitialized] = React.useState(false);

    const handleScriptLoad = () => {
        console.log("[MapplsMap] Mappls script loaded.");
        setScriptsLoaded(true);
    };

    useEffect(() => {
        if (scriptsLoaded && !mapInitialized && mapRef.current) {
            console.log("[MapplsMap] Scripts loaded, initializing map...");
            try {
                const centerPoint = initialCenter 
                    ? new window.mappls.LatLng(initialCenter.lat, initialCenter.lng)
                    : new window.mappls.LatLng(28.6139, 77.2090); // Default to Delhi

                mapInstance.current = new window.mappls.Map(mapRef.current, {
                    center: centerPoint,
                    zoom: 15,
                });

                mapInstance.current.on('load', () => {
                    console.log("[MapplsMap] Map instance loaded successfully.");
                    setMapInitialized(true);

                    // Add the draggable marker
                    markerInstance.current = new window.mappls.Marker({
                        map: mapInstance.current,
                        position: centerPoint,
                        draggable: true,
                        icon_html: `<div style="font-size: 2.5rem; color: #ef4444;">📍</div>`
                    });

                    // Add drag end listener
                    if (onPinDragEnd) {
                        markerInstance.current.on('dragend', () => {
                            const newPosition = markerInstance.current.getPosition();
                            console.log("[MapplsMap] Pin dragged to:", newPosition);
                            onPinDragEnd({ lat: newPosition.lat, lng: newPosition.lng });
                        });
                    }

                    if (onMapLoad) {
                        onMapLoad(mapInstance.current, markerInstance.current);
                    }
                });
            } catch (error) {
                console.error("[MapplsMap] Error initializing Mappls Map:", error);
            }
        }
    }, [scriptsLoaded, mapInitialized, initialCenter, onMapLoad, onPinDragEnd]);

    return (
        <>
            <Script
                src="https://apis.mappls.com/advancedmaps/api/290d3c63-8472-40f4-8a88-29cf977b2a59/map_sdk?layer=vector&v=3.0"
                onLoad={handleScriptLoad}
                onError={() => console.error("[MapplsMap] Failed to load Mappls script.")}
            />
            <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
                {!scriptsLoaded && (
                    <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
                        <Loader2 className="animate-spin text-primary mr-2" /> Loading Map SDK...
                    </div>
                )}
                 {scriptsLoaded && !mapInitialized && (
                    <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
                        <Loader2 className="animate-spin text-primary mr-2" /> Initializing Map...
                    </div>
                )}
            </div>
        </>
    );
};

export default MapplsMap;
