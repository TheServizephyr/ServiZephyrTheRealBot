
'use client';

import React, { useRef, useCallback } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl';
import 'mappls-gl/dist/mappls-gl.css';
import { Loader2 } from 'lucide-react';

const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

const MapplsMap = ({ initialCenter, onPinDragEnd }) => {
    const mapRef = useRef();

    const onMarkerDragEnd = useCallback(event => {
        const { lng, lat } = event.lngLat;
        onPinDragEnd({ lat, lng });
    }, [onPinDragEnd]);

    if (typeof window === 'undefined') {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>;
    }

    if (!MAPPLS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Mappls API Key not found.</p></div>;
    }

    return (
        <Map
            ref={mapRef}
            mapLib={typeof window !== 'undefined' ? window.mapplsgl : null}
            mapplsAccessToken={MAPPLS_API_KEY}
            initialViewState={{
                longitude: initialCenter.lng,
                latitude: initialCenter.lat,
                zoom: 14
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="https://apis.mappls.com/advancedmaps/api/v1/mappls-default-style"
        >
            <NavigationControl position="top-right" />
            <Marker
                longitude={initialCenter.lng}
                latitude={initialCenter.lat}
                draggable
                onDragEnd={onMarkerDragEnd}
            >
                <div style={{ fontSize: '2.5rem' }}>📍</div>
            </Marker>
        </Map>
    );
};

export default MapplsMap;
