
'use client';

import React, { useEffect, useRef, useMemo } from 'react';
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


const MapComponent = ({ restaurantLocation, customerLocations, riderLocation, onMapLoad }) => {
    const map = useMap();

    // Use the onMapLoad prop to pass the map instance up to the parent
    useEffect(() => {
        if (map && onMapLoad) {
            onMapLoad(map);
        }
    }, [map, onMapLoad]);

    // --- START THE FIX ---
    // Convert all incoming GeoPoint-like objects to LatLngLiteral
    const toLatLngLiteral = (loc) => {
        if (!loc) return null;
        const lat = loc.lat ?? loc._latitude;
        const lng = loc.lng ?? loc._longitude;
        if (typeof lat === 'number' && typeof lng === 'number') {
            return { lat, lng };
        }
        return null;
    };

    const restaurantLatLng = useMemo(() => toLatLngLiteral(restaurantLocation), [restaurantLocation]);
    const riderLatLng = useMemo(() => toLatLngLiteral(riderLocation), [riderLocation]);
    const customerLatLngs = useMemo(() => customerLocations.map(loc => ({ ...toLatLngLiteral(loc), id: loc.id })).filter(loc => loc.lat && loc.lng), [customerLocations]);
    // --- END THE FIX ---

    useEffect(() => {
        if (map) {
            const bounds = new window.google.maps.LatLngBounds();
            if (restaurantLatLng) bounds.extend(restaurantLatLng);
            if (riderLatLng) bounds.extend(riderLatLng);
            customerLatLngs.forEach(loc => bounds.extend(loc));

            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, 80); // 80px padding
            }
        }
    }, [restaurantLatLng, customerLatLngs, riderLatLng, map]);

    const routeStart = riderLatLng || restaurantLatLng;

    return (
        <>
            {restaurantLatLng && (
                <AdvancedMarker position={restaurantLatLng}>
                    <div style={{ fontSize: '2rem' }}>🏢</div>
                </AdvancedMarker>
            )}
            {customerLatLngs.map(loc => (
                <AdvancedMarker key={loc.id} position={loc}>
                    <div style={{ fontSize: '2rem' }}>🏠</div>
                </AdvancedMarker>
            ))}
            {riderLatLng && (
                <AdvancedMarker position={riderLatLng}>
                     <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </AdvancedMarker>
            )}
            {/* Draw lines from start point to all customer locations */}
            {routeStart && customerLatLngs.map(customerLoc => (
                <RouteLine 
                    key={`route-${customerLoc.id}`} 
                    from={routeStart} 
                    to={customerLoc} 
                    isDashed={!riderLatLng} // Dashed if rider hasn't started moving
                />
            ))}
        </>
    );
}

const LiveTrackingMap = ({ restaurantLocation, customerLocations = [], riderLocation, mapRef }) => {
    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    const getCenter = () => {
      const riderLat = riderLocation?.lat ?? riderLocation?._latitude;
      const riderLng = riderLocation?.lng ?? riderLocation?._longitude;
      if(riderLat && riderLng) return {lat: riderLat, lng: riderLng};
      
      const restoLat = restaurantLocation?.lat ?? restaurantLocation?._latitude;
      const restoLng = restaurantLocation?.lng ?? restaurantLocation?._longitude;
      if(restoLat && restoLng) return {lat: restoLat, lng: restoLng};
      
      const firstCustomer = customerLocations[0];
      const custLat = firstCustomer?.lat ?? firstCustomer?._latitude;
      const custLng = firstCustomer?.lng ?? firstCustomer?._longitude;
      if(custLat && custLng) return {lat: custLat, lng: custLng};

      return { lat: 28.6139, lng: 77.2090 };
    }

    const center = getCenter();
    
    // Callback to get the map instance from the child component
    const handleMapLoad = (mapInstance) => {
        if (mapRef) {
            mapRef.current = mapInstance;
        }
    };


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
                     onMapLoad={handleMapLoad}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
