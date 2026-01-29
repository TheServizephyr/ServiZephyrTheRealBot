'use client';

import React, { useEffect, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const MapComponent = ({ restaurantLocation, customerLocations, riderLocation, onMapLoad }) => {
    const map = useMap();

    const toLatLngLiteral = (loc) => {
        if (!loc) return null;
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

    // Auto-fit bounds to show all markers
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
                <AdvancedMarker position={riderLatLng} title="Delivery Partner">
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
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['marker']}>
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
