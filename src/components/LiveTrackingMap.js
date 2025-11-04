'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// --- DIRECTIONS COMPONENT (REFACTORED FOR STABILITY) ---
const Directions = ({ from, to, waypoints = [] }) => {
    const map = useMap();
    // Use useRef to hold the renderer instance. This prevents it from being recreated on every render,
    // which was the root cause of the previous infinite loop issue.
    const directionsRendererRef = useRef(null);

    // Effect to initialize or clear the directions renderer
    useEffect(() => {
        if (!map || !window.google) return;

        // Create the renderer only once and store it in the ref
        if (!directionsRendererRef.current) {
            directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: '#000000',
                    strokeOpacity: 0.8,
                    strokeWeight: 6,
                },
            });
        }
        
        // Associate the renderer with the current map instance
        directionsRendererRef.current.setMap(map);

        // Cleanup function: when the component unmounts, remove the route from the map.
        return () => {
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setMap(null);
            }
        };
    }, [map]);

    // Effect to calculate and render the route.
    // This now ONLY depends on the actual route data (from, to, waypoints).
    // It will not run infinitely anymore.
    useEffect(() => {
        if (!map || !directionsRendererRef.current || !from || !to) {
            return;
        }

        const directionsService = new window.google.maps.DirectionsService();

        const request = {
            origin: from,
            destination: to,
            waypoints: waypoints.map(wp => ({ location: wp, stopover: true })),
            travelMode: window.google.maps.TravelMode.DRIVING,
            optimizeWaypoints: true,
        };

        directionsService.route(request, (result, status) => {
            if (status === window.google.maps.DirectionsStatus.OK) {
                // If the route is found, set it on our persistent renderer instance.
                if (directionsRendererRef.current) {
                    directionsRendererRef.current.setDirections(result);
                }
            } else {
                console.error(`Directions request failed due to ${status}. This can happen if the locations are too far apart, not on a road, or if the API key has restrictions.`);
            }
        });

    }, [from, to, waypoints, map]); // Correct dependencies

    return null; // This component only renders on the map via the renderer
};


const MapComponent = ({ restaurantLocation, customerLocations, riderLocation, onMapLoad }) => {
    const map = useMap();

    useEffect(() => {
        if (map && onMapLoad) {
            onMapLoad(map);
        }
    }, [map, onMapLoad]);

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
    const customerLatLngs = useMemo(() =>
        (customerLocations || [])
            .map(loc => ({ ...toLatLngLiteral(loc), id: loc.id }))
            .filter(loc => loc.lat && loc.lng),
        [customerLocations]
    );

    useEffect(() => {
        if (map && window.google) {
            const bounds = new window.google.maps.LatLngBounds();
            if (restaurantLatLng) bounds.extend(restaurantLatLng);
            if (riderLatLng) bounds.extend(riderLatLng);
            customerLatLngs.forEach(loc => bounds.extend(loc));

            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, 80);
            }
        }
    }, [restaurantLatLng, customerLatLngs, riderLatLng, map]);

    const routeOrigin = riderLatLng || restaurantLatLng;
    const routeDestination = customerLatLngs.length > 0 ? customerLatLngs[customerLatLngs.length - 1] : null;
    const routeWaypoints = customerLatLngs.length > 1 ? customerLatLngs.slice(0, -1) : [];

    return (
        <>
            {/* Render Directions */}
            {routeOrigin && routeDestination && (
                <Directions
                    from={routeOrigin}
                    to={routeDestination}
                    waypoints={routeWaypoints}
                />
            )}

            {/* Render Markers */}
            {restaurantLatLng && (
                <AdvancedMarker position={restaurantLatLng} title="Restaurant">
                    <div style={{ fontSize: '2rem' }}>🏢</div>
                </AdvancedMarker>
            )}
            {customerLatLngs.map(loc => (
                <AdvancedMarker key={loc.id} position={loc} title="Customer">
                    <div style={{ fontSize: '2rem' }}>🏠</div>
                </AdvancedMarker>
            ))}
            {riderLatLng && (
                <AdvancedMarker position={riderLatLng} title="Rider">
                     <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </AdvancedMarker>
            )}
        </>
    );
}

const LiveTrackingMap = (props) => {
    const { restaurantLocation, riderLocation, customerLocation, mapRef } = props;

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
      
      const firstCustomer = Array.isArray(props.customerLocations) && props.customerLocations[0] ? props.customerLocations[0] : customerLocation;
      const custLat = firstCustomer?.lat ?? firstCustomer?._latitude;
      const custLng = firstCustomer?.lng ?? firstCustomer?._longitude;
      if(custLat && custLng) return {lat: custLat, lng: custLng};

      return { lat: 28.6139, lng: 77.2090 };
    }

    const center = getCenter();
    
    const handleMapLoad = (mapInstance) => {
        if (mapRef) {
            mapRef.current = mapInstance;
        }
    };


    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['geometry', 'routes']}>
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
                     customerLocations={Array.isArray(props.customerLocations) ? props.customerLocations : (customerLocation ? [customerLocation] : [])}
                     riderLocation={riderLocation}
                     onMapLoad={handleMapLoad}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
