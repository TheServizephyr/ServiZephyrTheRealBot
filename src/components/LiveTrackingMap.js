
'use client';

import React, { useEffect, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const RouteLine = ({ from, to, isDashed = false }) => {
    const map = useMap();
    const polylineRef = useRef(null);
  
    useEffect(() => {
        if (!map || !from || !to) {
            if (polylineRef.current) polylineRef.current.setMap(null);
            return;
        }
  
        const primaryColor = 'hsl(var(--primary))';
        const lineOptions = {
            strokeColor: primaryColor,
            strokeOpacity: 0.8,
            strokeWeight: 5,
            icons: isDashed ? [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3, strokeWeight: 2 },
                offset: '0',
                repeat: '12px'
            }] : []
        };
        
        if (!polylineRef.current) {
            polylineRef.current = new window.google.maps.Polyline();
        }
        
        polylineRef.current.setOptions(lineOptions);
        polylineRef.current.setPath([from, to]);
        polylineRef.current.setMap(map);
  
        return () => { if (polylineRef.current) polylineRef.current.setMap(null); };
    }, [map, from, to, isDashed]);
  
    return null;
};


const MapComponent = ({ restaurantLocation, customerLocations, riderLocation }) => {
    const map = useMap();

    useEffect(() => {
        if (map) {
            const bounds = new window.google.maps.LatLngBounds();
            if (restaurantLocation) bounds.extend(restaurantLocation);
            if (riderLocation) bounds.extend(riderLocation);
            customerLocations.forEach(loc => bounds.extend(loc));

            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, 80); // 80px padding
            }
        }
    }, [restaurantLocation, customerLocations, riderLocation, map]);

    const routeStart = riderLocation || restaurantLocation;

    return (
        <>
            {restaurantLocation && (
                <AdvancedMarker position={restaurantLocation}>
                    <div style={{ fontSize: '2rem' }}>🏢</div>
                </AdvancedMarker>
            )}
            {customerLocations.map(loc => (
                <AdvancedMarker key={loc.id} position={loc}>
                    <div style={{ fontSize: '2rem' }}>🏠</div>
                </AdvancedMarker>
            ))}
            {riderLocation && (
                <AdvancedMarker position={riderLocation}>
                     <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </AdvancedMarker>
            )}
            {/* Draw lines from start point to all customer locations */}
            {routeStart && customerLocations.map(customerLoc => (
                <RouteLine 
                    key={`route-${customerLoc.id}`} 
                    from={routeStart} 
                    to={customerLoc} 
                    isDashed={!riderLocation} // Dashed if rider hasn't started moving
                />
            ))}
        </>
    );
}

const LiveTrackingMap = ({ restaurantLocation, customerLocations = [], riderLocation }) => {
    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    const center = riderLocation || restaurantLocation || customerLocations[0] || { lat: 28.6139, lng: 77.2090 };

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <Map
                mapId={'live_tracking_map'}
                style={{ width: '100%', height: '100%' }}
                defaultCenter={center}
                defaultZoom={12}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
            >
                <MapComponent
                     restaurantLocation={restaurantLocation}
                     customerLocations={customerLocations}
                     riderLocation={riderLocation}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
