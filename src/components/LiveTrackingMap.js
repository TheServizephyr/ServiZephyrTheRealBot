'use client';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// FIX: Default Leaflet icons can be broken in Next.js, so we re-set them.
const iconDefault = L.icon({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

const iconRestaurant = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const iconCustomer = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const iconRider = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = iconDefault;


const MapUpdater = ({ positions }) => {
    const map = useMap();
    useEffect(() => {
        if (positions.length > 0) {
            const bounds = L.latLngBounds(positions);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [positions, map]);
    return null;
};


const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    
    const positions = useMemo(() => {
        const points = [];
        if (restaurantLocation) points.push([restaurantLocation.latitude, restaurantLocation.longitude]);
        if (customerLocation) points.push([customerLocation.latitude, customerLocation.longitude]);
        if (riderLocation) points.push([riderLocation.latitude, riderLocation.longitude]);
        return points;
    }, [restaurantLocation, customerLocation, riderLocation]);

    if (!restaurantLocation || !customerLocation) {
        return (
            <div className="w-full h-full bg-muted flex items-center justify-center">
                <p className="text-muted-foreground">Location data is unavailable for this order.</p>
            </div>
        );
    }
    
    return (
        <MapContainer center={[restaurantLocation.latitude, restaurantLocation.longitude]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            
            <Marker position={[restaurantLocation.latitude, restaurantLocation.longitude]} icon={iconRestaurant}>
                <Popup>Restaurant</Popup>
            </Marker>
            
            <Marker position={[customerLocation.latitude, customerLocation.longitude]} icon={iconCustomer}>
                <Popup>Your Location</Popup>
            </Marker>

            {riderLocation && (
                 <Marker position={[riderLocation.latitude, riderLocation.longitude]} icon={iconRider}>
                    <Popup>Rider</Popup>
                </Marker>
            )}
            
            <MapUpdater positions={positions} />
        </MapContainer>
    );
};

export default LiveTrackingMap;
