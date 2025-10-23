
'use client';

import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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

const restaurantIcon = new L.DivIcon({
    html: `<div style="font-size: 2rem; color: #ef4444;">🏢</div>`,
    iconSize: [32, 32],
    className: 'leaflet-div-icon'
});

const customerIcon = new L.DivIcon({
    html: `<div style="font-size: 2rem; color: #3b82f6;">🏠</div>`,
    iconSize: [32, 32],
    className: 'leaflet-div-icon'
});

const riderIcon = new L.DivIcon({
    html: `<div style="font-size: 2.5rem; color: #22c55e;">🛵</div>`,
    iconSize: [40, 40],
    className: 'leaflet-div-icon'
});


const MapUpdater = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const map = useMap();

    useEffect(() => {
        const bounds = [];
        if (restaurantLocation) bounds.push([restaurantLocation.latitude, restaurantLocation.longitude]);
        if (customerLocation) bounds.push([customerLocation.latitude, customerLocation.longitude]);
        if (riderLocation) bounds.push([riderLocation.latitude, riderLocation.longitude]);
        
        if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [map, restaurantLocation, customerLocation, riderLocation]);

    return null;
}

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    
    if (typeof window === 'undefined') {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>;
    }
    
    const center = customerLocation || restaurantLocation || { latitude: 28.6139, longitude: 77.2090 };

    return (
        <MapContainer center={[center.latitude, center.longitude]} zoom={13} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {restaurantLocation && (
                <Marker position={[restaurantLocation.latitude, restaurantLocation.longitude]} icon={restaurantIcon}>
                    <Popup>Restaurant</Popup>
                </Marker>
            )}
            {customerLocation && (
                 <Marker position={[customerLocation.latitude, customerLocation.longitude]} icon={customerIcon}>
                    <Popup>Your Location</Popup>
                </Marker>
            )}
            {riderLocation && (
                 <Marker position={[riderLocation.latitude, riderLocation.longitude]} icon={riderIcon}>
                    <Popup>Delivery Rider</Popup>
                </Marker>
            )}
            <MapUpdater 
                restaurantLocation={restaurantLocation} 
                customerLocation={customerLocation}
                riderLocation={riderLocation} 
            />
        </MapContainer>
    );
};

export default LiveTrackingMap;
