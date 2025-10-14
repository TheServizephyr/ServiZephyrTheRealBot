'use client';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default icon issue with Webpack
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const getCustomIcon = (color) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const restaurantIcon = getCustomIcon('red');
const customerIcon = getCustomIcon('blue');
const riderIcon = getCustomIcon('green');

export default function LiveTrackingMap({ restaurantLocation, customerLocation, riderLocation }) {
    
    const positions = [
        [restaurantLocation.latitude, restaurantLocation.longitude],
        ...(riderLocation ? [[riderLocation.latitude, riderLocation.longitude]] : []),
        [customerLocation.latitude, customerLocation.longitude]
    ];

    const bounds = L.latLngBounds(positions);
    
    return (
        <MapContainer
            bounds={bounds}
            scrollWheelZoom={true}
            style={{ height: '100%', width: '100%' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* Restaurant Marker */}
            <Marker position={[restaurantLocation.latitude, restaurantLocation.longitude]} icon={restaurantIcon}>
                <Popup>Restaurant</Popup>
            </Marker>

            {/* Customer Marker */}
            <Marker position={[customerLocation.latitude, customerLocation.longitude]} icon={customerIcon}>
                <Popup>Your Location</Popup>
            </Marker>
            
            {/* Rider Marker (only if location exists) */}
            {riderLocation && (
                <Marker position={[riderLocation.latitude, riderLocation.longitude]} icon={riderIcon}>
                    <Popup>Delivery Rider</Popup>
                </Marker>
            )}
            
            {/* Route Polyline */}
            {riderLocation && (
                 <Polyline positions={[[restaurantLocation.latitude, restaurantLocation.longitude], [riderLocation.latitude, riderLocation.longitude]]} color="gray" dashArray="5, 10" />
            )}
            {riderLocation && (
                 <Polyline positions={[[riderLocation.latitude, riderLocation.longitude], [customerLocation.latitude, customerLocation.longitude]]} color="blue" />
            )}
            {!riderLocation && (
                  <Polyline positions={[[restaurantLocation.latitude, restaurantLocation.longitude], [customerLocation.latitude, customerLocation.longitude]]} color="blue" dashArray="5, 10" />
            )}
            
        </MapContainer>
    );
}
