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
        // This effect runs only when scriptsLoaded, apiKey, or mapInitialized changes.
        if (scriptsLoaded && apiKey && !mapInitialized && mapRef.current) {
            // Ensure at least one valid location exists to center the map
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
        // This effect runs whenever locations change AFTER the map is initialized.
        if (mapInitialized && mapInstance.current) {
            // Simple approach: clear all markers and re-add them.
            // A more optimized approach would be to store marker instances and update their positions.
            if (mapInstance.current.removeMarker) {
                 mapInstance.current.removeMarker(); // This is a hypothetical function; Mappls might have a different way to clear markers.
            }
            
            const markers = [];

            if (restaurantLocation) {
                console.log("[LiveTrackingMap] Adding restaurant marker at:", restaurantLocation);
                markers.push(new window.mappls.Marker({
                    position: { lat: restaurantLocation.latitude, lng: restaurantLocation.longitude },
                    map: mapInstance.current,
                    title: "Restaurant",
                    icon_html: `<div style="background-color:red; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">R</div>`
                }));
            }

            if (customerLocation) {
                 console.log("[LiveTrackingMap] Adding customer marker at:", customerLocation);
                markers.push(new window.mappls.Marker({
                    position: { lat: customerLocation.latitude, lng: customerLocation.longitude },
                    map: mapInstance.current,
                    title: "You",
                    icon_html: `<div style="background-color:blue; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">C</div>`
                }));
            }
            
            if (riderLocation) {
                console.log("[LiveTrackingMap] Adding rider marker at:", riderLocation);
                markers.push(new window.mappls.Marker({
                    position: { lat: riderLocation.latitude, lng: riderLocation.longitude },
                    map: mapInstance.current,
                    title: "Rider",
                    icon_html: `<div style="background-color:green; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">D</div>`
                }));
            }
            
            // Adjust map bounds to show all markers
            if (markers.length > 1) {
                console.log("[LiveTrackingMap] Fitting map to bounds of", markers.length, "markers.");
                mapInstance.current.fitBounds(markers, { padding: 50 });
            } else if (markers.length === 1) {
                mapInstance.current.setCenter(markers[0].getPosition());
                mapInstance.current.setZoom(15);
            }
        }

    }, [restaurantLocation, customerLocation, riderLocation, mapInitialized]);

    if (!apiKey) {
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
                onError={() => {
                    console.error("[LiveTrackingMap] Failed to load Mappls map script.");
                    setError("Failed to load map service.");
                }}
            />
            <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
                {!scriptsLoaded && (
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
                      <div className="absolute inset-0 w-full h-full bg-destructive/10 flex items-center justify-center text-destructive">
                        <AlertTriangle className="mr-2" /> {error}
                    </div>
                 )}
            </div>
        </>
    );
};

export default LiveTrackingMap;
