'use client';
import React, { useEffect, useRef, useMemo } from 'react';
import 'mappls-gl/dist/mappls-gl.css';
import mappls from 'mappls-gl';

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const markers = useRef([]);

    // Memoize locations to prevent unnecessary re-renders
    const locations = useMemo(() => ({
        restaurant: restaurantLocation ? [restaurantLocation.longitude, restaurantLocation.latitude] : null,
        customer: customerLocation ? [customerLocation.longitude, customerLocation.latitude] : null,
        rider: riderLocation ? [riderLocation.longitude, riderLocation.latitude] : null,
    }), [restaurantLocation, customerLocation, riderLocation]);

    useEffect(() => {
        if (map.current || !mapContainer.current || !locations.restaurant || !locations.customer) return;

        const mapplsKey = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;
        if (!mapplsKey) {
            console.error("Mappls API key is not configured.");
            return;
        }

        map.current = new mappls.Map(mapContainer.current, {
            center: locations.restaurant,
            zoom: 12,
        });

        map.current.on('load', () => {
             // This ensures map.current is valid before proceeding
            if(!map.current) return;
            // Initial marker setup
            updateMarkers();
        });
        
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };

    }, [locations.restaurant, locations.customer]); // Initialize map only when essential locations are available

    useEffect(() => {
        // Update markers whenever locations change
        updateMarkers();
    }, [locations]);


    const createMarkerElement = (color, title) => {
        const el = document.createElement('div');
        el.className = 'mappls-marker';
        el.style.backgroundImage = `url(https://apis.mapmyindia.com/map_v3/2.png)`; // Using a standard Mappls icon sprite
        el.style.backgroundPosition = color;
        el.style.width = '32px';
        el.style.height = '40px';
        el.style.cursor = 'pointer';
        el.title = title;
        return el;
    };

    const updateMarkers = () => {
        if (!map.current || !map.current.isStyleLoaded()) return;

        // Clear existing markers
        markers.current.forEach(marker => marker.remove());
        markers.current = [];

        const bounds = new mappls.LngLatBounds();

        // Add Restaurant Marker
        if (locations.restaurant) {
            const restaurantMarkerEl = createMarkerElement('-169px -18px', 'Restaurant');
            const restaurantMarker = new mappls.Marker({ element: restaurantMarkerEl })
                .setLngLat(locations.restaurant)
                .addTo(map.current);
            markers.current.push(restaurantMarker);
            bounds.extend(locations.restaurant);
        }

        // Add Customer Marker
        if (locations.customer) {
            const customerMarkerEl = createMarkerElement('-127px -18px', 'Customer');
            const customerMarker = new mappls.Marker({ element: customerMarkerEl })
                .setLngLat(locations.customer)
                .addTo(map.current);
            markers.current.push(customerMarker);
            bounds.extend(locations.customer);
        }

        // Add Rider Marker
        if (locations.rider) {
            const riderMarkerEl = createMarkerElement('-88px -18px', 'Rider');
            const riderMarker = new mappls.Marker({ element: riderMarkerEl })
                .setLngLat(locations.rider)
                .addTo(map.current);
            markers.current.push(riderMarker);
            bounds.extend(locations.rider);
        }

        // Fit map to bounds if they are valid
        if (bounds.getNorthEast() && bounds.getSouthWest()) {
             map.current.fitBounds(bounds, {
                padding: { top: 50, bottom: 50, left: 50, right: 50 },
                maxZoom: 15,
                duration: 1000
            });
        }
    };
    
    return <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />;
};

export default LiveTrackingMap;
