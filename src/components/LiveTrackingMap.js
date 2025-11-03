
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
            if (polylineRef.current) {
                polylineRef.current.setMap(null);
            }
            return;
        }
  
        const blackColor = '#000000'; // Black color for high visibility
        
        let lineOptions;

        if (isDashed) {
            // Options for a DOTTED line
            lineOptions = {
                path: [from, to],
                geodesic: true,
                strokeOpacity: 0, // Make the actual line invisible
                icons: [{
                    icon: {
                        path: 'M 0,-1 0,1', // A small vertical line
                        strokeColor: blackColor,
                        strokeOpacity: 1,
                        strokeWeight: 2, // Thicker dots for better visibility
                        scale: 3, // Size of the dot
                    },
                    offset: '0',
                    repeat: '15px' // Space between dots
                }]
            };
        } else {
            // Options for a SOLID line for when the rider is moving
            lineOptions = {
                path: [from, to],
                geodesic: true,
                strokeColor: blackColor,
                strokeOpacity: 0.8, // Slightly transparent solid line
                strokeWeight: 5,
                icons: [] // No icons for solid line
            };
        }
        
        if (!polylineRef.current) {
            polylineRef.current = new window.google.maps.Polyline();
        }
        
        polylineRef.current.setOptions(lineOptions);
        polylineRef.current.setMap(map);
  
        return () => { 
            if (polylineRef.current) {
                polylineRef.current.setMap(null); 
            }
        };
    }, [map, from, to, isDashed]);
  
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
        // Check for both GeoPoint format and standard {lat, lng}
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
            {routeStart && customerLatLngs.map(customerLoc => (
                <RouteLine 
                    key={`route-${customerLoc.id}`} 
                    from={routeStart} 
                    to={customerLoc} 
                    isDashed={!riderLatLng} // Dashed if rider location is not available
                />
            ))}
        </>
    );
}

const LiveTrackingMap = (props) => {
    console.log("DEBUG: Props received by LiveTrackingMap:", props);
    const { restaurantLocation, riderLocation, customerLocation, mapRef } = props;
    console.log("DEBUG: Customer Location Prop:", customerLocation);

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
                     customerLocations={Array.isArray(props.customerLocations) ? props.customerLocations : (customerLocation ? [customerLocation] : [])}
                     riderLocation={riderLocation}
                     onMapLoad={handleMapLoad}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
