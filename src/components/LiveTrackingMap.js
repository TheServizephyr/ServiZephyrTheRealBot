
'use client';

import React, { useEffect, useRef } from 'react';
import Map, { Marker, Popup, NavigationControl, Source, Layer } from 'react-map-gl';
import { Loader2 } from 'lucide-react';

const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const mapRef = useRef();

    useEffect(() => {
        if (mapRef.current && window.mapplsgl) {
            const mapplsgl = window.mapplsgl;
            const bounds = new mapplsgl.LngLatBounds();
            if (restaurantLocation) bounds.extend([restaurantLocation.longitude, restaurantLocation.latitude]);
            if (customerLocation) bounds.extend([customerLocation.longitude, customerLocation.latitude]);
            if (riderLocation) bounds.extend([riderLocation.longitude, riderLocation.latitude]);
            
            if (!bounds.isEmpty()) {
                mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });
            }
        }
    }, [restaurantLocation, customerLocation, riderLocation]);

    if (typeof window === 'undefined' || !window.mapplsgl) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>;
    }
     if (!MAPPLS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Mappls API Key not found.</p></div>;
    }

    const center = customerLocation || restaurantLocation || { latitude: 28.6139, longitude: 77.2090 };

    return (
        <Map
            ref={mapRef}
            mapLib={window.mapplsgl}
            mapplsAccessToken={MAPPLS_API_KEY}
            initialViewState={{
                longitude: center.longitude,
                latitude: center.latitude,
                zoom: 13
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="https://apis.mappls.com/advancedmaps/api/v1/mappls-default-style"
        >
            <NavigationControl position="top-right" />

            {restaurantLocation && (
                <Marker longitude={restaurantLocation.longitude} latitude={restaurantLocation.latitude} anchor="bottom">
                     <div style={{ fontSize: '2rem' }}>🏢</div>
                </Marker>
            )}
            {customerLocation && (
                <Marker longitude={customerLocation.longitude} latitude={customerLocation.latitude} anchor="bottom">
                    <div style={{ fontSize: '2rem' }}>🏠</div>
                </Marker>
            )}
            {riderLocation && (
                <Marker longitude={riderLocation.longitude} latitude={riderLocation.latitude} anchor="bottom">
                     <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </Marker>
            )}
        </Map>
    );
};

export default LiveTrackingMap;
