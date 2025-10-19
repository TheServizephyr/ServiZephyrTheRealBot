'use client';

import React, { useEffect, useRef } from 'react';
import Script from 'next/script';
import { Loader2 } from 'lucide-react';

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const [scriptsLoaded, setScriptsLoaded] = React.useState(false);
    const [mapInitialized, setMapInitialized] = React.useState(false);

    useEffect(() => {
        if (scriptsLoaded && !mapInitialized && mapRef.current) {
            if (!restaurantLocation || !customerLocation) return;
            
            setMapInitialized(true);
            const center = new mappls.LatLng(customerLocation.latitude, customerLocation.longitude);
            
            mapInstance.current = new mappls.Map(mapRef.current, {
                center: center,
                zoom: 14,
            });

            mapInstance.current.on('load', () => {
                console.log("Mappls Map Loaded!");
            });
        }
    }, [scriptsLoaded, mapInitialized, restaurantLocation, customerLocation]);

    useEffect(() => {
        if (mapInstance.current) {
            const markers = [];
            
            // Clear existing markers logic here if Mappls provides it
            // For simplicity, we are re-adding, but in a real app, you'd manage marker instances.

            if (restaurantLocation) {
                const restaurantMarker = new mappls.Marker({
                    position: new mappls.LatLng(restaurantLocation.latitude, restaurantLocation.longitude),
                    map: mapInstance.current,
                    title: "Restaurant",
                     icon_html: `<div style="background-color:red; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white;">R</div>`
                });
                markers.push(restaurantMarker);
            }

            if (customerLocation) {
                const customerMarker = new mappls.Marker({
                    position: new mappls.LatLng(customerLocation.latitude, customerLocation.longitude),
                    map: mapInstance.current,
                    title: "You",
                    icon_html: `<div style="background-color:blue; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white;">C</div>`
                });
                markers.push(customerMarker);
            }
            
            if (riderLocation) {
                 const riderMarker = new mappls.Marker({
                    position: new mappls.LatLng(riderLocation.latitude, riderLocation.longitude),
                    map: mapInstance.current,
                    title: "Rider",
                     icon_html: `<div style="background-color:green; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; border: 2px solid white;">D</div>`
                });
                markers.push(riderMarker);
            }
            
            if(markers.length > 0) {
                mapInstance.current.fitBounds(markers);
            }
        }

    }, [restaurantLocation, customerLocation, riderLocation, mapInitialized]);

    return (
        <>
            <Script
                src="https://apis.mappls.com/advancedmaps/api/290d3c63-8472-40f4-8a88-29cf977b2a59/map_sdk?layer=vector"
                onLoad={() => setScriptsLoaded(true)}
                onError={() => console.error("Failed to load Mappls script.")}
            />
            <div ref={mapRef} style={{ width: '100%', height: '100%' }}>
                {!scriptsLoaded && (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                        <Loader2 className="animate-spin text-primary mr-2" /> Loading Map...
                    </div>
                )}
            </div>
        </>
    );
};

export default LiveTrackingMap;
