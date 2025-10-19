
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { Loader2, AlertTriangle } from 'lucide-react';

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const [scriptsLoaded, setScriptsLoaded] = useState(false);
    const [mapInitialized, setMapInitialized] = useState(false);
    const [error, setError] = useState(null);

    const apiKey = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

    useEffect(() => {
        if (scriptsLoaded && apiKey && !mapInitialized && mapRef.current) {
            const initialCoords = customerLocation || restaurantLocation || { latitude: 28.6139, longitude: 77.2090 };
            console.log("[LiveTrackingMap] Initializing map with center:", initialCoords);

            try {
                const center = new window.mappls.LatLng(initialCoords.latitude, initialCoords.longitude);
                
                mapInstance.current = new window.mappls.Map(mapRef.current, {
                    center: center,
                    zoom: 14,
                });

                mapInstance.current.on('load', () => {
                    console.log("[LiveTrackingMap] Mappls Map instance Loaded!");
                    setMapInitialized(true);
                });

            } catch (err) {
                console.error("[LiveTrackingMap] Error initializing Mappls Map:", err);
                setError("Could not initialize map.");
            }
        }
    }, [scriptsLoaded, mapInitialized, apiKey, customerLocation, restaurantLocation]);

    useEffect(() => {
        if (mapInitialized && mapInstance.current) {
            console.log("[LiveTrackingMap] Map initialized. Updating markers.");
            
            // This is a simplified approach. For better performance, store marker instances and update them.
            // For now, let's assume we need to manage this better. A full implementation would be complex.
            // This part of the code might need a more robust marker management strategy.
            
            // Hypothetically clearing existing markers (Mappls API might differ)
            if (mapInstance.current.clearMarkers) {
                 mapInstance.current.clearMarkers();
            }

            const markers = [];

            if (restaurantLocation) {
                console.log("[LiveTrackingMap] Adding restaurant marker at:", restaurantLocation);
                 markers.push(new window.mappls.Marker({
                    map: mapInstance.current,
                    position: { lat: restaurantLocation.latitude, lng: restaurantLocation.longitude },
                    title: "Restaurant",
                    icon_html: `<div style="font-size: 2rem; color: #ef4444;">🏢</div>`
                }));
            }

            if (customerLocation) {
                 console.log("[LiveTrackingMap] Adding customer marker at:", customerLocation);
                markers.push(new window.mappls.Marker({
                    map: mapInstance.current,
                    position: { lat: customerLocation.latitude, lng: customerLocation.longitude },
                    title: "You",
                    icon_html: `<div style="font-size: 2rem; color: #3b82f6;">🏠</div>`
                }));
            }
            
            if (riderLocation) {
                console.log("[LiveTrackingMap] Adding rider marker at:", riderLocation);
                markers.push(new window.mappls.Marker({
                    map: mapInstance.current,
                    position: { lat: riderLocation.latitude, lng: riderLocation.longitude },
                    title: "Rider",
                     icon_html: `<div style="font-size: 2.5rem; color: #22c55e;">🛵</div>`
                }));
            }
            
            if (markers.length > 1) {
                console.log("[LiveTrackingMap] Fitting map to bounds of", markers.length, "markers.");
                try {
                   mapInstance.current.fitBounds(markers.map(m => m.getPosition()), { padding: 80, duration: 500 });
                } catch(e) {
                   console.error("[LiveTrackingMap] Error fitting bounds:", e);
                }
            } else if (markers.length === 1) {
                mapInstance.current.setCenter(markers[0].getPosition());
                mapInstance.current.setZoom(15);
            }
        }

    }, [restaurantLocation, customerLocation, riderLocation, mapInitialized]);

    if (!apiKey) {
        console.error("[LiveTrackingMap] CRITICAL: NEXT_PUBLIC_MAPPLS_API_KEY is not defined.");
        return (
            <div className="w-full h-full bg-destructive/10 flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="w-10 h-10 text-destructive mb-2"/>
                <p className="text-destructive font-semibold">Map Configuration Error</p>
                <p className="text-sm text-destructive/80">Mappls API Key is not configured for this application.</p>
            </div>
        )
    }

    return (
        <>
            <Script
                src={`https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${apiKey}`}
                onLoad={() => {
                    console.log("[LiveTrackingMap] Mappls script loaded successfully.");
                    setScriptsLoaded(true);
                }}
                onError={(e) => {
                    console.error("[LiveTrackingMap] Failed to load Mappls map script.", e);
                    setError("Failed to load map service.");
                }}
            />
            <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
                {!scriptsLoaded && !error && (
                    <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
                        <Loader2 className="animate-spin text-primary mr-2" /> Loading Map SDK...
                    </div>
                )}
                 {scriptsLoaded && !mapInitialized && !error && (
                    <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
                        <Loader2 className="animate-spin text-primary mr-2" /> Initializing Map...
                    </div>
                )}
                 {error && (
                      <div className="absolute inset-0 w-full h-full bg-destructive/10 flex items-center justify-center text-destructive p-4 text-center">
                        <AlertTriangle className="mr-2" /> {error}
                    </div>
                 )}
            </div>
        </>
    );
};

export default LiveTrackingMap;
