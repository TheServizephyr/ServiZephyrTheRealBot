
'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// --- DIRECTIONS COMPONENT (WITH LOGGING) ---
const Directions = ({ from, to, waypoints = [] }) => {
    const map = useMap();
    const directionsServiceRef = useRef(null);
    const directionsRendererRef = useRef(null);

    // Effect to initialize the renderer and service
    useEffect(() => {
        if (!map || !window.google) return;
        console.log('[Directions Log] Initializing Directions Service and Renderer.');

        if (!directionsServiceRef.current) {
            directionsServiceRef.current = new window.google.maps.DirectionsService();
        }

        if (!directionsRendererRef.current) {
            directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: '#000000', // Black color for the route
                    strokeOpacity: 0.8,
                    strokeWeight: 6,
                },
            });
            console.log('[Directions Log] Renderer attached to map.');
            directionsRendererRef.current.setMap(map);
        }

        // Cleanup function
        return () => {
            if (directionsRendererRef.current) {
                console.log('[Directions Log] Cleaning up: Removing route from map.');
                directionsRendererRef.current.setMap(null);
            }
        };
    }, [map]);

    // Effect to calculate and render the route
    useEffect(() => {
        if (!map || !directionsRendererRef.current || !directionsServiceRef.current || !from || !to) {
            console.log('[Directions Log] Skipping route calculation: Missing map, renderer, service, from, or to.');
            if(!from) console.log('[Directions Log] Reason: "from" location is missing.');
            if(!to) console.log('[Directions Log] Reason: "to" location is missing.');
            return;
        }

        console.log('[Directions Log] Route calculation effect triggered.');
        console.log('[Directions Log] FROM:', JSON.stringify(from));
        console.log('[Directions Log] TO:', JSON.stringify(to));
        console.log('[Directions Log] WAYPOINTS:', JSON.stringify(waypoints));

        const request = {
            origin: from,
            destination: to,
            waypoints: waypoints.map(wp => ({ location: wp, stopover: true })),
            travelMode: window.google.maps.TravelMode.DRIVING,
            optimizeWaypoints: true,
        };

        console.log('[Directions Log] Sending request to Google Directions API.');
        directionsServiceRef.current.route(request, (result, status) => {
            // MOST IMPORTANT LOG: WHAT IS GOOGLE'S RESPONSE?
            console.log(`[Directions Log] Google Directions API responded with status: ${status}`);

            if (status === window.google.maps.DirectionsStatus.OK) {
                console.log('[Directions Log] SUCCESS: Route found. Setting directions on renderer.');
                if (directionsRendererRef.current) {
                    directionsRendererRef.current.setDirections(result);
                }
            } else {
                console.error(`[Directions Log] ERROR: Directions request failed due to ${status}.`);
            }
        });

    }, [from, to, waypoints, map]); // Re-run only when route data changes

    return null; 
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
            let extendCount = 0;
            if (restaurantLatLng) { bounds.extend(restaurantLatLng); extendCount++; }
            if (riderLatLng) { bounds.extend(riderLatLng); extendCount++; }
            customerLatLngs.forEach(loc => { bounds.extend(loc); extendCount++; });

            if (extendCount > 1) {
                map.fitBounds(bounds, 80);
            } else if (extendCount === 1) {
                map.setCenter(bounds.getCenter());
                map.setZoom(15);
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
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['routes']}>
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
