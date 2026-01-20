
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
                strokeOpacity: 0.8,
                strokeWeight: 5,
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

    // FIXED: Dynamic Route Origin
    // If rider is assigned (riderLatLng exists), route is Rider -> Customer
    // Otherwise, route is Restaurant -> Customer
    const routeOrigin = riderLatLng || restaurantLatLng;

    // Logic: If rider is present, they are the moving origin.
    // If no rider yet, show path from Restaurant to Customer (static).

    const routeDestination = customerLatLngs.length > 0 ? customerLatLngs[customerLatLngs.length - 1] : null;
    const routeWaypoints = customerLatLngs.length > 1 ? customerLatLngs.slice(0, -1) : [];

    console.log('[LiveTrackingMap] Route data:', {
        origin: routeOrigin,
        destination: routeDestination,
        waypoints: routeWaypoints,
        hasDirectionsService: !!directionsService,
        hasDirectionsRenderer: !!directionsRenderer
    });

    useEffect(() => {
        if (!directionsService || !directionsRenderer || !routeOrigin || !routeDestination) {
            console.log('[LiveTrackingMap] Missing required data for directions:', {
                hasService: !!directionsService,
                hasRenderer: !!directionsRenderer,
                hasOrigin: !!routeOrigin,
                hasDestination: !!routeDestination
            });
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

        console.log('[LiveTrackingMap] Requesting directions:', request);

        directionsService.route(request, (result, status) => {
            console.log('[LiveTrackingMap] Directions response:', { status, result });
            if (status === window.google.maps.DirectionsStatus.OK) {
                directionsRenderer.setDirections(result);
                // Clear fallback line if directions succeed
                if (window.fallbackPolyline) {
                    window.fallbackPolyline.setMap(null);
                    window.fallbackPolyline = null;
                }
                console.log('[LiveTrackingMap] ✅ Directions rendered successfully!');
            } else {
                console.error(`[LiveTrackingMap] ❌ Directions failed, status: ${status}`);
                // FALLBACK: Draw dashed CURVED line (Bézier curve) if Directions API fails
                console.log('[LiveTrackingMap] ⚠️ Using fallback CURVED dashed line');

                if (window.fallbackPolyline) window.fallbackPolyline.setMap(null);

                // Helper to calculate Quadratic Bézier Curve points
                const getCurvedPath = (p1, p2) => {
                    const lat1 = p1.lat;
                    const lng1 = p1.lng;
                    const lat2 = p2.lat;
                    const lng2 = p2.lng;

                    // Calculate midpoint
                    const midLat = (lat1 + lat2) / 2;
                    const midLng = (lng1 + lng2) / 2;

                    // Calculate perpendicular offset for control point (curvature)
                    // Difference vector
                    const dLat = lat2 - lat1;
                    const dLng = lng2 - lng1;

                    // Perpendicular vector (-y, x) scaled by curvature factor (0.2)
                    // Adjust scale based on distance to keep curve proportional
                    const curvatureKey = 0.2;
                    const controlLat = midLat - (dLng * curvatureKey);
                    const controlLng = midLng + (dLat * curvatureKey);

                    const points = [];
                    for (let t = 0; t <= 1; t += 0.05) {
                        // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                        const l1 = (1 - t) * (1 - t);
                        const l2 = 2 * (1 - t) * t;
                        const l3 = t * t;

                        points.push({
                            lat: l1 * lat1 + l2 * controlLat + l3 * lat2,
                            lng: l1 * lng1 + l2 * controlLng + l3 * lng2
                        });
                    }
                    return points;
                };

                // FALLBACK: Revert to Curved Dotted Line (Aesthetically better than straight line over houses)
                // "straight nahi yarrrr... kisi ghar ya nadi ke upar se mat nikalo" -> Curved looks like a "flight path" which is acceptable as abstract.

                const curvedPath = getCurvedPath(routeOrigin, routeDestination);

                window.fallbackPolyline = new window.google.maps.Polyline({
                    path: curvedPath,
                    geodesic: true,
                    strokeColor: '#000000',
                    strokeOpacity: 0,
                    strokeWeight: 0,
                    icons: [{
                        icon: {
                            path: 'M 0,-1 0,1',
                            strokeOpacity: 1,
                            scale: 3,
                            strokeColor: '#000000',
                            strokeWeight: 2
                        },
                        offset: '0',
                        repeat: '20px'
                    }],
                    map: map
                });

                // Show Error on Map for the User
                const errorDiv = document.createElement('div');
                errorDiv.style.position = 'absolute';
                errorDiv.style.top = '10px';
                errorDiv.style.left = '50%';
                errorDiv.style.transform = 'translateX(-50%)';
                errorDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
                errorDiv.style.color = 'white';
                errorDiv.style.padding = '8px 12px';
                errorDiv.style.borderRadius = '20px';
                errorDiv.style.fontSize = '12px';
                errorDiv.style.fontWeight = 'bold';
                errorDiv.style.zIndex = '1000';
                errorDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
                errorDiv.innerText = '⚠️ Maps API Error: Setup Billing for Road Path';
                map.getDiv().appendChild(errorDiv);
            }
        });
    }, [routeOrigin, routeDestination, JSON.stringify(routeWaypoints), directionsService, directionsRenderer, map]);

    // Cleanup fallback on unmount
    useEffect(() => {
        return () => {
            if (window.fallbackPolyline) {
                window.fallbackPolyline.setMap(null);
                window.fallbackPolyline = null;
            }
        };
    }, []);

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


    const markerContainerStyle = {
        backgroundColor: 'white',
        borderRadius: '50%',
        padding: '8px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        fontSize: '1.5rem',
        border: '2px solid white'
    };

    return (
        <>
            {restaurantLatLng && (
                <AdvancedMarker position={restaurantLatLng} title="Restaurant">
                    <div style={markerContainerStyle}>
                        🍴
                    </div>
                </AdvancedMarker>
            )}
            {customerLatLngs.map(loc => (
                <AdvancedMarker key={loc.id} position={loc} title="Customer">
                    <div style={markerContainerStyle}>
                        🤵
                    </div>
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
        if (riderLat && riderLng) return { lat: riderLat, lng: riderLng };

        const restoLat = restaurantLocation?.lat ?? restaurantLocation?.latitude ?? restaurantLocation?._latitude;
        const restoLng = restaurantLocation?.lng ?? restaurantLocation?.longitude ?? restaurantLocation?._longitude;
        if (restoLat && restoLng) return { lat: restoLat, lng: restoLng };

        const firstCustomer = Array.isArray(props.customerLocations) && props.customerLocations[0] ? props.customerLocations[0] : customerLocation;
        const custLat = firstCustomer?.lat ?? firstCustomer?.latitude ?? firstCustomer?._latitude;
        const custLng = firstCustomer?.lng ?? firstCustomer?.longitude ?? firstCustomer?._longitude;
        if (custLat && custLng) return { lat: custLat, lng: custLng };

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
