
'use client';

import React, { useEffect, useRef } from 'react';
import Script from 'next/script';
import { Loader2, AlertTriangle } from 'lucide-react';

const MapplsMap = ({ onMapLoad, initialCenter, onPinDragEnd, onError }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const markerInstance = useRef(null);
    const [scriptsLoaded, setScriptsLoaded] = React.useState(false);
    const [mapInitialized, setMapInitialized] = React.useState(false);

    const apiKey = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

    const handleScriptLoad = () => {
        console.log("[MapplsMap] Mappls script loaded.");
        setScriptsLoaded(true);
    };

    const handleScriptError = () => {
        console.error("[MapplsMap] Failed to load Mappls script.");
        if (onError) {
            onError("Failed to load map service script.");
        }
    };

    useEffect(() => {
        if (scriptsLoaded && !mapInitialized && mapRef.current && apiKey) {
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

                    markerInstance.current = new window.mappls.Marker({
                        map: mapInstance.current,
                        position: centerPoint,
                        draggable: true,
                        icon_html: `<div style="font-size: 2.5rem; color: #ef4444;">📍</div>`
                    });

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
                if (onError) {
                    onError("Map initialization failed. " + error.message);
                }
            }
        }
    }, [scriptsLoaded, mapInitialized, initialCenter, onMapLoad, onPinDragEnd, apiKey, onError]);

    if (!apiKey) {
        console.error("[MapplsMap] CRITICAL: NEXT_PUBLIC_MAPPLS_API_KEY is not defined.");
        return (
             <div className="w-full h-full bg-destructive/10 flex items-center justify-center text-center p-2">
                <div>
                    <AlertTriangle className="mx-auto h-8 w-8 text-destructive"/>
                    <p className="text-destructive font-semibold mt-2">Map Configuration Error</p>
                    <p className="text-xs text-destructive/80">API Key is missing.</p>
                </div>
            </div>
        )
    }

    return (
        <>
            <Script
                src={`https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${apiKey}`}
                onLoad={handleScriptLoad}
                onError={handleScriptError}
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
