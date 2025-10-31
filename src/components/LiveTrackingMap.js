
'use client';

import React, { useEffect, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const RouteLine = ({ from, to, isCurved = false }) => {
    const map = useMap();
    const polylineRef = useRef(null);
  
    useEffect(() => {
        if (!map || !from || !to) {
            // Clean up previous line if it exists
            if (polylineRef.current) {
                polylineRef.current.setMap(null);
            }
            return;
        };
  
        // Define line styles
        const straightLineOptions = {
            strokeColor: '#000000',
            strokeOpacity: 0.8,
            strokeWeight: 5,
        };

        const curvedDashedLineOptions = {
            strokeColor: 'hsl(var(--primary))',
            strokeOpacity: 0, // The line itself is invisible
            strokeWeight: 3,
            icons: [{
                icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    scale: 3,
                },
                offset: '0',
                repeat: '15px'
            }],
        };

        // Create a new polyline if it doesn't exist
        if (!polylineRef.current) {
            polylineRef.current = new window.google.maps.Polyline();
        }

        let path;
        if (isCurved) {
            polylineRef.current.setOptions(curvedDashedLineOptions);
            
            // Calculate a curve
            const fromLatLng = new window.google.maps.LatLng(from.lat, from.lng);
            const toLatLng = new window.google.maps.LatLng(to.lat, to.lng);
            
            const curvePoints = [];
            const numPoints = 20; // More points for a smoother curve
            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                // Simple quadratic curve calculation for a gentle arc
                const lat = (1 - t) * (1 - t) * fromLatLng.lat() + 2 * (1 - t) * t * (fromLatLng.lat() + toLatLng.lat()) / 2 + t * t * toLatLng.lat();
                const lng = (1 - t) * (1 - t) * fromLatLng.lng() + 2 * (1 - t) * t * (fromLatLng.lng() + toLatLng.lng()) / 2 + t * t * toLatLng.lng();
                curvePoints.push({ lat, lng });
            }
            path = curvePoints;

        } else {
            polylineRef.current.setOptions(straightLineOptions);
            path = [
                { lat: from.lat, lng: from.lng },
                { lat: to.lat, lng: to.lng },
            ];
        }
  
        polylineRef.current.setPath(path);
        polylineRef.current.setMap(map);
  
      // No cleanup function needed here as we are reusing the polyline instance
    }, [map, from, to, isCurved]);
  
    // Cleanup on component unmount
     useEffect(() => {
        return () => {
            if (polylineRef.current) {
                polylineRef.current.setMap(null);
            }
        };
    }, []);

    return null;
};


const MapComponent = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const map = useMap();

    useEffect(() => {
        if (map) {
            const bounds = new window.google.maps.LatLngBounds();
            if (restaurantLocation) bounds.extend(restaurantLocation);
            if (customerLocation) bounds.extend(customerLocation);
            if (riderLocation) bounds.extend(riderLocation);

            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, 80); // 80px padding
            }
        }
    }, [restaurantLocation, customerLocation, riderLocation, map]);

    const routeStart = riderLocation || restaurantLocation;
    const routeEnd = customerLocation;
    
    // Determine if the route should be shown and if it should be curved
    const showRoute = routeStart && routeEnd;
    const isCurved = !riderLocation && !!restaurantLocation;

    return (
        <>
            {restaurantLocation && (
                <AdvancedMarker position={restaurantLocation}>
                    <div style={{ fontSize: '2rem' }}>🏢</div>
                </AdvancedMarker>
            )}
            {customerLocation && (
                <AdvancedMarker position={customerLocation}>
                    <div style={{ fontSize: '2rem' }}>🏠</div>
                </AdvancedMarker>
            )}
            {riderLocation && (
                <AdvancedMarker position={riderLocation}>
                     <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </AdvancedMarker>
            )}
             {showRoute && <RouteLine from={routeStart} to={routeEnd} isCurved={isCurved} />}
        </>
    );
}

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    const center = customerLocation || restaurantLocation || { lat: 28.6139, lng: 77.2090 };

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
                     customerLocation={customerLocation}
                     riderLocation={riderLocation}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
