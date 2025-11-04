
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const MapComponent = ({ restaurantLocation, customerLocations, riderLocation, onMapLoad }) => {
    const map = useMap();
    const [directionsService, setDirectionsService] = useState(null);
    const [directionsRenderer, setDirectionsRenderer] = useState(null);
    
    useEffect(() => {
        if (!map || !window.google) return;
        setDirectionsService(new window.google.maps.DirectionsService());
        setDirectionsRenderer(new window.google.maps.DirectionsRenderer({
            suppressMarkers: true,
            polylineOptions: {
                strokeColor: '#000000',
                strokeOpacity: 0.9,
                strokeWeight: 6,
            },
        }));
    }, [map]);

    useEffect(() => {
        if (directionsRenderer) {
            directionsRenderer.setMap(map);
        }
    }, [directionsRenderer, map]);

    const toLatLngLiteral = (loc) => {
        if (!loc) return null;
        // FIX: Added checks for .latitude and .longitude
        const lat = loc.lat ?? loc.latitude ?? loc._latitude;
        const lng = loc.lng ?? loc.longitude ?? loc._longitude;
        
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

    const routeOrigin = riderLatLng || restaurantLatLng;
    const routeDestination = customerLatLngs.length > 0 ? customerLatLngs[customerLatLngs.length - 1] : null;
    const routeWaypoints = customerLatLngs.length > 1 ? customerLatLngs.slice(0, -1) : [];

    useEffect(() => {
        if (!directionsService || !directionsRenderer || !routeOrigin || !routeDestination) {
            if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
            return;
        }

        const request = {
            origin: routeOrigin,
            destination: routeDestination,
            waypoints: routeWaypoints.map(wp => ({ location: wp, stopover: true })),
            travelMode: window.google.maps.TravelMode.DRIVING,
            optimizeWaypoints: true,
        };

        directionsService.route(request, (result, status) => {
            if (status === window.google.maps.DirectionsStatus.OK) {
                directionsRenderer.setDirections(result);
            } else {
                console.error(`[Directions Error] Failed to fetch directions, status: ${status}`);
            }
        });
    // --- FIX: Change the dependency array --- 
    }, [directionsService, directionsRenderer, routeOrigin, routeDestination, JSON.stringify(routeWaypoints)]); 
    
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
    
    useEffect(() => {
        if (map && onMapLoad) {
            onMapLoad(map);
        }
    }, [map, onMapLoad]);


    return (
        <>
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
      const riderLat = riderLocation?.lat ?? riderLocation?.latitude ?? riderLocation?._latitude;
      const riderLng = riderLocation?.lng ?? riderLocation?.longitude ?? riderLocation?._longitude;
      if(riderLat && riderLng) return {lat: riderLat, lng: riderLng};
      
      const restoLat = restaurantLocation?.lat ?? restaurantLocation?.latitude ?? restaurantLocation?._latitude;
      const restoLng = restaurantLocation?.lng ?? restaurantLocation?.longitude ?? restaurantLocation?._longitude;
      if(restoLat && restoLng) return {lat: restoLat, lng: restoLng};
      
      const firstCustomer = Array.isArray(props.customerLocations) && props.customerLocations[0] ? props.customerLocations[0] : customerLocation;
      const custLat = firstCustomer?.lat ?? firstCustomer?.latitude ?? firstCustomer?._latitude;
      const custLng = firstCustomer?.lng ?? firstCustomer?.longitude ?? firstCustomer?._longitude;
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
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['routes', 'marker']}>
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
