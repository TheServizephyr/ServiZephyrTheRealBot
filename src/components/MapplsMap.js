
'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Loader2 } from 'lucide-react';

// FIX: Default icon issue with Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DraggableMarker = ({ initialCenter, onPinDragEnd }) => {
    const [position, setPosition] = React.useState([initialCenter.lat, initialCenter.lng]);
    const markerRef = useRef(null);
    const map = useMap();

    const eventHandlers = useMemo(
        () => ({
            dragend() {
                const marker = markerRef.current;
                if (marker != null) {
                    const newPos = marker.getLatLng();
                    setPosition([newPos.lat, newPos.lng]);
                    onPinDragEnd({ lat: newPos.lat, lng: newPos.lng });
                }
            },
        }),
        [onPinDragEnd],
    );

    useEffect(() => {
        map.panTo([initialCenter.lat, initialCenter.lng]);
        setPosition([initialCenter.lat, initialCenter.lng]);
    }, [initialCenter, map]);

    return (
        <Marker
            draggable={true}
            eventHandlers={eventHandlers}
            position={position}
            ref={markerRef}
        />
    );
};


const MapplsMap = ({ initialCenter, onPinDragEnd }) => {
    if (typeof window === 'undefined') {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>;
    }
    
    return (
        <MapContainer center={[initialCenter.lat, initialCenter.lng]} zoom={15} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <DraggableMarker initialCenter={initialCenter} onPinDragEnd={onPinDragEnd} />
        </MapContainer>
    );
};

export default MapplsMap;
