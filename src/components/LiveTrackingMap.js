
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
            if (polylineRef.current) {
                polylineRef.current.setMap(null);
            }
            return;
        };
  
        // Shared primary color for consistency
        const primaryColor = 'hsl(var(--primary))';

        // Style for the live, straight line (rider to customer)
        const straightLineOptions = {
            strokeColor: primaryColor,
            strokeOpacity: 0.8,
            strokeWeight: 5,
        };

        // Style for the initial, curved dashed line (restaurant to customer)
        const curvedDashedLineOptions = {
            strokeColor: primaryColor,
            strokeOpacity: 1, // FIX: Make the line visible
            strokeWeight: 0, // The main line is a series of icons, not a continuous stroke
            icons: [{
                icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    strokeWeight: 2, // Thinner dashes
                    scale: 3,
                },
                offset: '0',
                repeat: '12px' // Denser dashes
            }],
        };

        if (!polylineRef.current) {
            polylineRef.current = new window.google.maps.Polyline();
        }

        let path;
        if (isCurved) {
            polylineRef.current.setOptions(curvedDashedLineOptions);
            
            const fromLatLng = new window.google.maps.LatLng(from.lat, from.lng);
            const toLatLng = new window.google.maps.LatLng(to.lat, to.lng);
            
            const curvePoints = [];
            const numPoints = 50; 
            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                const lat = (1 - t) * (1 - t) * fromLatLng.lat() + 2 * (1 - t) * t * (fromLatLng.lat() + (toLatLng.lat() - fromLatLng.lat())*0.2) + t * t * toLatLng.lat();
                const lng = (1 - t) * (1 - t) * fromLatLng.lng() + 2 * (1 - t) * t * (fromLatLng.lng() + (toLatLng.lng() - fromLatLng.lng())*0.8) + t * t * toLatLng.lng();
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
  
    }, [map, from, to, isCurved]);
  
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
