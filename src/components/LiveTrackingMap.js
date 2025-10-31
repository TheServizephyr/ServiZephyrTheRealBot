
'use client';

import React, { useEffect, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const RouteLine = ({ from, to }) => {
    const map = useMap();
    const polylineRef = useRef(null);
  
    useEffect(() => {
      if (!map || !from || !to) return;
  
      if (!polylineRef.current) {
        polylineRef.current = new window.google.maps.Polyline({
          strokeColor: '#000000',
          strokeOpacity: 0.8,
          strokeWeight: 4,
          map: map,
        });
      }
  
      polylineRef.current.setPath([
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      ]);
  
      // Cleanup on unmount
      return () => {
        if (polylineRef.current) {
          polylineRef.current.setMap(null);
          polylineRef.current = null;
        }
      };
    }, [map, from, to]);
  
    return null; // This component does not render anything itself
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
                map.fitBounds(bounds, 60); // 60px padding
            }
        }
    }, [restaurantLocation, customerLocation, riderLocation, map]);

    const routeStart = riderLocation || restaurantLocation;
    const routeEnd = customerLocation;
    const showRoute = routeStart && routeEnd;
    
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
             {showRoute && <RouteLine from={routeStart} to={routeEnd} />}
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
