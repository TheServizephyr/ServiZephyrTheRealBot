'use client';

import React, { useEffect, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const mapRef = useRef();

    useEffect(() => {
        if (mapRef.current && window.google) {
            const bounds = new window.google.maps.LatLngBounds();
            if (restaurantLocation) bounds.extend({ lat: restaurantLocation.lat, lng: restaurantLocation.lng });
            if (customerLocation) bounds.extend({ lat: customerLocation.lat, lng: customerLocation.lng });
            if (riderLocation) bounds.extend({ lat: riderLocation.lat, lng: riderLocation.lng });

            if (mapRef.current.map && !bounds.isEmpty()) {
                mapRef.current.map.fitBounds(bounds, 60);
            }
        }
    }, [restaurantLocation, customerLocation, riderLocation, mapRef.current]);

    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    const center = customerLocation || restaurantLocation || { lat: 28.6139, lng: 77.2090 };

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <Map
                ref={mapRef}
                mapId={'live_tracking_map'}
                style={{ width: '100%', height: '100%' }}
                defaultCenter={center}
                defaultZoom={12}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
            >
                {restaurantLocation && (
                    <AdvancedMarker position={{ lat: restaurantLocation.lat, lng: restaurantLocation.lng }}>
                        <div style={{ fontSize: '2rem' }}>🏢</div>
                    </AdvancedMarker>
                )}
                {customerLocation && (
                    <AdvancedMarker position={{ lat: customerLocation.lat, lng: customerLocation.lng }}>
                        <div style={{ fontSize: '2rem' }}>🏠</div>
                    </AdvancedMarker>
                )}
                {riderLocation && (
                    <AdvancedMarker position={{ lat: riderLocation.lat, lng: riderLocation.lng }}>
                         <div style={{ fontSize: '2.5rem' }}>🛵</div>
                    </AdvancedMarker>
                )}
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
