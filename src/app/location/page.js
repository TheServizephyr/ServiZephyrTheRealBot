'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback, lazy } from 'react';
// import { useRouter, useSearchParams } from 'next/navigation'; // Mocked below
import { motion, AnimatePresence } from 'framer-motion';

// --- MOCKS FOR IMPORTS ---

// Mocks for lucide-react
const createLucideIcon = (name) => (props) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={props.size || "24"}
        height={props.size || "24"}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`lucide lucide-${name} ${props.className || ''}`}
        {...props}
    >
        {/* Simple placeholder icons */}
        {name === 'map-pin' && <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>}
        {name === 'search' && <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>}
        {name === 'locate-fixed' && <><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/></>}
        {name === 'loader-2' && <path d="M21 12a9 9 0 1 1-6.219-8.56"/>}
        {name === 'arrow-left' && <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>}
        {name === 'alert-triangle' && <><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>}
        {name === 'save' && <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>}
        {name === 'home' && <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>}
        {name === 'building' && <><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></>}
        {name === 'chevron-up' && <path d="m18 15-6-6-6 6"/>}
        {name === 'globe' && <><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></>}
        {name === 'compass' && <><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/><circle cx="12" cy="12" r="2"/></>}
        <title>{name}</title>
    </svg>
);

const MapPin = createLucideIcon('map-pin');
const Search = createLucideIcon('search');
const LocateFixed = createLucideIcon('locate-fixed');
const Loader2 = createLucideIcon('loader-2');
const ArrowLeft = createLucideIcon('arrow-left');
const AlertTriangle = createLucideIcon('alert-triangle');
const Save = createLucideIcon('save');
const Home = createLucideIcon('home');
const Building = createLucideIcon('building');
const ChevronUp = createLucideIcon('chevron-up');
const Globe = createLucideIcon('globe');
const Compass = createLucideIcon('compass');

// Mock for UI components
const Button = React.forwardRef(({ children, variant, size, className, disabled, onClick, type = 'button', 'aria-label': ariaLabel, ...props }, ref) => (
    <button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
            'mock-button inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            variant === 'secondary' ? 'bg-gray-200 text-gray-800 shadow-sm hover:bg-gray-300' :
            variant === 'ghost' ? 'hover:bg-gray-100 hover:text-gray-900' :
            variant === 'outline' ? 'border border-gray-300 bg-transparent shadow-sm hover:bg-gray-100 hover:text-gray-900' :
            variant === 'default' ? 'bg-green-600 text-white shadow hover:bg-green-700' : // Explicit default style
            'bg-green-600 text-white shadow hover:bg-green-700', // Fallback default style
            size === 'icon' ? 'h-9 w-9' : size === 'sm' ? 'h-8 rounded-md px-3 text-xs' : 'h-9 px-4 py-2', // default size
            className
        )}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
        {...props}
    >
        {children}
    </button>
));
const Input = React.forwardRef(({ className, type, ...props }, ref) => (
    <input
        type={type}
        ref={ref}
        className={cn('mock-input flex h-9 w-full rounded-md border border-gray-300 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50', className)}
        {...props}
    />
));
const Label = React.forwardRef(({ children, className, ...props }, ref) => (
    <label ref={ref} className={cn('mock-label text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)} {...props}>
        {children}
    </label>
));

// Mock for InfoDialog
const InfoDialog = ({ isOpen, onClose, title, message }) => {
     useEffect(() => {
        if (isOpen) {
             console.log(`InfoDialog: ${title} - ${message}`);
        }
    }, [isOpen, title, message]);


    if (!isOpen) return null;
     // Basic non-blocking display
    return (
        <div style={{ position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#eee', border: '1px solid #ccc', padding: '10px 20px', zIndex: 1000, borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <strong style={{ marginRight: '10px'}}>{title}</strong>
            <span>{message}</span>
            <button onClick={onClose} style={{ marginLeft: '15px', padding: '2px 5px', cursor: 'pointer', border: '1px solid #aaa', background: '#ddd' }}>X</button>
        </div>
    );
};


// Mock for auth hook and firebase auth
const useAuth = () => ({ user: { displayName: 'Mock User', phoneNumber: '1234567890', getIdToken: async () => 'mock-token' } });
const auth = { /* Mock auth object if needed, currently useAuth provides mock user */ };

// Mock for cn utility
const cn = (...inputs) => {
  return inputs.filter(Boolean).join(' ');
};

// Mock for next/navigation hooks - Updated to be client-side safe
const useRouter = () => {
    // Return mock functions, actual logic relies on window which is client-side
    // Check for window to avoid SSR errors
    const [routerReady, setRouterReady] = useState(false);
    useEffect(() => {
      setRouterReady(true);
    }, []);

    return {
        back: useCallback(() => { if (routerReady) window.history.back(); }, [routerReady]),
        push: useCallback((url) => { if (routerReady) console.log(`Mock navigation to: ${url}`); /* window.location.href = url; */ }, [routerReady])
    };
};

const useSearchParams = () => {
    const [params, setParams] = useState(null);

    useEffect(() => {
        // Access window.location.search only on the client-side after mount
        setParams(new URLSearchParams(window.location.search || '?restaurantId=mockResto&returnUrl=/mockOrderPage'));
    }, []);

    // Return an object with a 'get' method, handle initial null state
    return {
        get: useCallback((key) => params ? params.get(key) : null, [params])
    };
};

// --- END OF MOCKS ---


// --- Google Map Specific Code ---

// State to hold the dynamically loaded map components
let GoogleMapsComponents = null;

const loadGoogleMapsScript = (apiKey, callback) => {
    if (!apiKey) {
        callback(new Error("API Key is missing. Cannot load Google Maps."));
        return;
    }
    // Check if running in a browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        console.warn("loadGoogleMapsScript called outside browser environment.");
        // Don't call callback with error here, let the useEffect handle it
        return;
    }

    if (GoogleMapsComponents) {
        console.log("Map components already loaded.");
        callback(null, GoogleMapsComponents);
        return;
    }

    const existingScript = document.getElementById('googleMapsScript');
    if (existingScript && window.google?.maps?.plugins?.react) {
         console.log("Map script exists and components seem ready.");
         GoogleMapsComponents = window.google.maps.plugins.react;
         callback(null, GoogleMapsComponents);
         return;
    } else if (existingScript) {
        console.log("Map script exists but components not ready, attaching listener.");
        let loadHandler = null; // Declare upfront for cleanup
        let errorHandler = null; // Declare upfront for cleanup

        loadHandler = () => {
            if (window.google?.maps?.plugins?.react) {
                console.log("Map components ready after listener triggered.");
                GoogleMapsComponents = window.google.maps.plugins.react;
                callback(null, GoogleMapsComponents);
            } else {
                console.error("Script loaded via listener, but google.maps.plugins.react not found.");
                callback(new Error("Failed to initialize map components after script load."));
            }
            // Clean up listener in both success and error cases
             if (loadHandler) existingScript.removeEventListener('load', loadHandler);
             if (errorHandler) existingScript.removeEventListener('error', errorHandler);
        };
         errorHandler = () => {
             console.error("Error loading existing Google Maps script.");
             callback(new Error("Error loading existing Google Maps script."));
             if (loadHandler) existingScript.removeEventListener('load', loadHandler);
             if (errorHandler) existingScript.removeEventListener('error', errorHandler);
        };
        existingScript.addEventListener('load', loadHandler);
        existingScript.addEventListener('error', errorHandler);
        return;
    }


    console.log("Loading Google Maps script...");
    const script = document.createElement('script');
    script.id = 'googleMapsScript';
    // Use the v=beta channel to get AdvancedMarker AND react plugin
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=beta&libraries=marker,places`; // Places might be needed for search later
    script.async = true;
    script.defer = true;
    script.onload = () => {
        // Double check if google.maps is loaded
        if (window.google?.maps?.plugins?.react) {
            console.log("Google Maps script loaded successfully.");
            GoogleMapsComponents = window.google.maps.plugins.react;
            callback(null, GoogleMapsComponents);
        } else {
            console.error("Script loaded, but google.maps.plugins.react object not found.");
            callback(new Error("Failed to initialize map components. Check API key permissions for Maps JavaScript API & React plugin."));
        }
    };
    script.onerror = (error) => {
        console.error("Failed to load Google Maps script:", error);
        callback(new Error("Failed to load Google Maps script. Check network or API key restrictions."));
    };
    document.head.appendChild(script);
};

//--- Map Inner Component (Handles map instance logic) ---
const MapInnerComponent = ({ center, onCenterChanged }) => {
    // Ensure components are loaded before trying to use the hook
    if (!GoogleMapsComponents) {
        console.warn("MapInnerComponent rendered before GoogleMapsComponents were loaded.");
        return null;
    }
    const { useMap } = GoogleMapsComponents;
    const map = useMap(); // Get map instance from the context provided by <Map>
    const isFirstRender = useRef(true); // Track initial render
    const isDragging = useRef(false); // Track if user is currently dragging

    // Effect 1: Imperatively update map center when the 'center' prop changes (e.g., from button click)
    useEffect(() => {
        if (isFirstRender.current) {
            // On first render, ensure the map actually centers on the initial prop
            if (map && center){
                 console.log("MapInner: [First Render] Setting initial center:", center);
                 map.setCenter(center);
            }
            isFirstRender.current = false;
            return;
        }

        if (map && center && !isDragging.current) { // Only move map if not currently dragging
            const currentMapCenter = map.getCenter().toJSON();
            // Check if the center has actually changed significantly to avoid potential loops
            const latChanged = Math.abs(currentMapCenter.lat - center.lat) > 1e-6;
            const lngChanged = Math.abs(currentMapCenter.lng - center.lng) > 1e-6;

            if (latChanged || lngChanged) {
                console.log("MapInner: [Prop Change] Setting map center imperatively:", center);
                map.setCenter(center);
                // The 'idle' listener will eventually call onCenterChanged after the move
            } else {
                 console.log("MapInner: [Prop Change] Center prop hasn't changed significantly, not moving map.");
            }
        } else if (isDragging.current) {
             console.log("MapInner: [Prop Change] Ignored due to active dragging.");
        }
    }, [map, center]); // Re-run when map instance or center prop changes

    // Effect 2: Add listeners for drag start/end and idle
    useEffect(() => {
        // Ensure map and onCenterChanged are available, and check for window (client-side)
        if (!map || !onCenterChanged || typeof window === 'undefined') return;

        console.log("MapInner: Adding listeners (dragstart, idle)");
        let idleListener = null;
        let dragStartListener = null;

        // Ensure google.maps.event is available before adding listeners
        if (window.google && window.google.maps && window.google.maps.event) {
            dragStartListener = map.addListener('dragstart', () => {
                console.log("MapInner: dragstart detected");
                isDragging.current = true;
            });

            // Use 'idle' which fires after map movement stops (pan, zoom, setCenter)
            idleListener = map.addListener('idle', () => {
                // Check if map object still exists (important for cleanup phase)
                if (!map.getCenter) {
                    console.warn("MapInner: Idle listener fired but map object seems invalid.");
                    return;
                }
                const newCenter = map.getCenter().toJSON();
                console.log("MapInner: Map idle, new center:", newCenter);

                // Determine if the center changed significantly since the last known prop `center`
                const centerPropChangedSignificantly = center && (Math.abs(newCenter.lat - center.lat) > 1e-6 || Math.abs(newCenter.lng - center.lng) > 1e-6);

                // Call handler if dragging just stopped OR if it idled after a significant imperative move
                if (isDragging.current) {
                    console.log("MapInner: [Drag End] Calling onCenterChanged");
                    onCenterChanged(newCenter); // Call handler after drag stops
                    isDragging.current = false; // Reset drag flag AFTER calling handler
                } else if (centerPropChangedSignificantly) {
                    console.log("MapInner: [Idle after Imperative Move] Calling onCenterChanged");
                    onCenterChanged(newCenter);
                } else {
                    console.log("MapInner: Idle detected, but not after drag or significant imperative move relative to props.");
                }
            });
        } else {
             console.error("MapInner: google.maps.event not available when trying to add listeners.");
        }


        // Cleanup listeners
        return () => {
            console.log("MapInner: Removing listeners");
             // Use google.maps.event.removeListener for robust cleanup
             if (window.google && window.google.maps && window.google.maps.event) {
                 if (dragStartListener) google.maps.event.removeListener(dragStartListener);
                 if (idleListener) google.maps.event.removeListener(idleListener);
             }
            isDragging.current = false; // Reset on cleanup
        };
         // IMPORTANT: Include center in dependencies. If the parent component's logic changes 'center'
         // AND fires 'onCenterChanged' simultaneously, this ensures the listener logic correctly
         // identifies whether the 'idle' event corresponds to the *new* prop center or an old one.
    }, [map, onCenterChanged, center]);

    return null; // This component does not render anything itself
};


//--- Map Controls Component ---
const MapControls = () => {
    // Ensure components are loaded before trying to use the hook
    if (!GoogleMapsComponents) return null;
    const { useMap } = GoogleMapsComponents;
    const map = useMap();
    const [mapTypeId, setMapTypeId] = useState('roadmap');

    const toggleMapType = () => {
        const newTypeId = mapTypeId === 'roadmap' ? 'satellite' : 'roadmap';
        setMapTypeId(newTypeId);
        if (map) map.setMapTypeId(newTypeId);
    };

    const resetNorth = () => {
        if (map) {
            map.setHeading(0); // Reset heading to 0 (North)
            map.setTilt(0); // Optionally reset tilt as well
        }
    };

    return (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
             <Button
                variant="secondary"
                size="icon"
                onClick={toggleMapType}
                className="h-12 w-12 rounded-full shadow-lg bg-white" // Added bg-white for visibility
                aria-label="Toggle map type"
            >
                <Globe />
            </Button>
             <Button
                variant="secondary"
                size="icon"
                onClick={resetNorth}
                className="h-12 w-12 rounded-full shadow-lg bg-white" // Added bg-white for visibility
                aria-label="Reset map to North"
            >
                <Compass />
            </Button>
        </div>
    );
};


//--- Main Google Map Component Definition ---
const GoogleMapComponent = ({ center, onCenterChanged }) => {
    // Ensure components are loaded before rendering
    if (!GoogleMapsComponents) {
        console.error("Attempted to render GoogleMapComponent before components loaded.");
        return <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500">Initializing Map...</div>;
    }

    // Destructure map components from the dynamically loaded object
    const { Map } = GoogleMapsComponents;

    return (
        <div className="w-full h-full relative">
            <Map
                mapId="servizephyr_location_map_v5" // Ensure unique ID
                style={{ width: '100%', height: '100%' }}
                defaultCenter={center} // Set initial center only ONCE
                defaultZoom={15}
                gestureHandling={'greedy'} // Allow touch gestures
                disableDefaultUI={true} // Hide default controls (zoom, etc.)
                tilt={0} // Disable tilt initially
                // Control map center via MapInnerComponent's useEffect using map.setCenter()
                // Do NOT use the 'center' prop here as it can conflict with imperative updates
                // center={center}
            >
                {/* Include the inner component to manage state sync and idle event */}
                <MapInnerComponent center={center} onCenterChanged={onCenterChanged} />
            </Map>
            {/* Center Marker Pin */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none z-[5]">
                 {/* Make pin appear above the center point, ensure high z-index */}
                <div style={{ fontSize: '2.5rem' }}>📍</div>
            </div>
             <MapControls /> {/* Add map type/north controls */}
        </div>
    );
};


// --- Location Page Logic ---

const LocationPageInternal = () => {
     // State to track if component is mounted on client
    const [isClient, setIsClient] = useState(false);
    useEffect(() => {
        // This effect runs only on the client
        setIsClient(true);
    }, []);

    // **MOVED STATE DECLARATIONS UP**
    const [mapCenter, setMapCenter] = useState({ lat: 28.6139, lng: 77.2090 }); // Default to Delhi
    const [addressDetails, setAddressDetails] = useState(null);
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customLabel, setCustomLabel] = useState('');
    const [showCustomLabelInput, setShowCustomLabelInput] = useState(false);
    const [loading, setLoading] = useState(false); // Only true during API calls/geolocation fetch
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [isPanelOpen, setIsPanelOpen] = useState(true);
    const [mapsInitializing, setMapsInitializing] = useState(true);
    const [mapsInitError, setMapsInitError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // Refs
    const geocodeTimeoutRef = useRef(null); // Ref for geocode debounce
    const debounceTimeout = useRef(null); // Ref for search debounce
    const initialLocationFetched = useRef(false); // Flag for initial fetch

    const router = useRouter(); // Mocked hook, safe to call always
    const searchParams = useSearchParams(); // Mocked hook, accesses window only after mount via useEffect

    // State for URL params, initialized later
    const [restaurantId, setRestaurantId] = useState(null);
    const [returnUrl, setReturnUrl] = useState('/mock-default-order-page'); // Default fallback

    const { user } = useAuth(); // Mocked hook

    // --- Geocoding Function ---
    const reverseGeocode = useCallback((coords) => {
        // Debounce geocoding
        if (geocodeTimeoutRef.current) {
            clearTimeout(geocodeTimeoutRef.current);
        }
        console.log("reverseGeocode requested for:", coords);
        setLoading(true); // Show loading indicator for geocoding
        setError('');

        geocodeTimeoutRef.current = setTimeout(async () => {
             console.log("Debounced reverseGeocode running for:", coords);
            try {
                // --- MOCK RESPONSE ---
                await new Promise(res => setTimeout(res, 400));
                const mockAddress = {
                    road: `Mock Road ${Math.floor(Math.random() * 100)}`,
                    neighbourhood: "Mock Area", city: "Mock City",
                    pincode: `1100${Math.floor(Math.random() * 90 + 10)}`,
                    state: "Mock State", country: "IN",
                    formatted_address: `Mock Address @ ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
                };
                // --- END MOCK ---
                setAddressDetails({
                    street: mockAddress.road || mockAddress.neighbourhood || '', city: mockAddress.city || '',
                    pincode: mockAddress.pincode || '', state: mockAddress.state || '',
                    country: mockAddress.country || 'IN', fullAddress: mockAddress.formatted_address,
                    latitude: coords.lat, longitude: coords.lng,
                });
                // Update search query ONLY if it wasn't the source of the change
                // Check if searchQuery state exists before comparing
                if (searchQuery !== mockAddress.formatted_address) {
                     setSearchQuery(mockAddress.formatted_address);
                }
            } catch (err) {
                console.error("Geocoding error:", err);
                setError('Could not fetch address details.');
                setAddressDetails(null);
            } finally {
                setLoading(false); // Hide geocoding loading indicator
            }
        }, 200); // Slightly longer debounce for geocoding
    // Include state setters in dependency array if ESLint requires, though usually not needed for setters
    }, [searchQuery]); // Dependency needed to potentially skip searchQuery update

    // --- Map Center Change Handler (Called by MapInnerComponent on idle) ---
    const handleMapCenterChange = useCallback((coords) => {
        console.log("handleMapCenterChange (from MapInner idle):", coords);
        // Update state and trigger geocode IF coordinates significantly changed
         setMapCenter(prevCenter => {
            if (!prevCenter || Math.abs(prevCenter.lat - coords.lat) > 1e-7 || Math.abs(prevCenter.lng - coords.lng) > 1e-7) {
                 reverseGeocode(coords);
                 return coords;
            }
            console.log("handleMapCenterChange: Coords haven't changed significantly, skipping update.");
            return prevCenter;
        });
    }, [reverseGeocode]); // Depends only on reverseGeocode

    // --- Get Current Location Handler (for Button) ---
    const getCurrentLocation = useCallback(() => {
         // Ensure this only runs on the client
        if (!isClient || !navigator.geolocation) {
            setError("Geolocation is not supported or not available.");
            setLoading(false); // Ensure loading is turned off if geolocation isn't available
            return;
        }
        console.log("getCurrentLocation triggered");
        setLoading(true); // Use general loading state for GPS fetch
        setError('Fetching your location...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
                console.log("getCurrentLocation success:", coords);
                setMapCenter(coords); // Update state, MapInnerComponent handles map move
                // Let idle listener trigger reverseGeocode via handleMapCenterChange
                setLoading(false); // Hide GPS loading
                setError('');
            },
            (err) => {
                console.error("getCurrentLocation error:", err);
                let userErrorMessage = 'Could not get location. ';
                if (err.code === 1) userErrorMessage += 'Permission denied.';
                else if (err.code === 2) userErrorMessage += 'Position unavailable.';
                else if (err.code === 3) userErrorMessage += 'Request timed out.';
                else userErrorMessage += 'Unknown error.';
                setError(userErrorMessage);
                setLoading(false); // Hide GPS loading
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    }, [isClient]); // Depends on isClient

    // --- Load Google Maps Script & Initial Location (Client-Side Only) ---
    useEffect(() => {
        // Ensure this runs only on the client
        if (!isClient) {
            console.log("SSR: Skipping map load.");
            setMapsInitializing(false); // Mark as not initializing on server
            return;
        }

        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
         if (!apiKey) {
             console.error("API Key is missing or placeholder.");
             setMapsInitError("Google Maps API Key is not configured.");
             setMapsInitializing(false);
             return;
         }

        console.log("Client: Triggering script load.");
        setMapsInitializing(true); // Set loading state

        loadGoogleMapsScript(apiKey, (error, components) => {
            setMapsInitializing(false); // Mark initialization as complete
            if (error) {
                console.error("Error loading Google Maps script:", error);
                setMapsInitError(error.message || "Failed to load Google Maps.");
            } else {
                console.log("Google Maps script loaded and components ready.");
                // Trigger initial location fetch *only if not already fetched*
                if (!initialLocationFetched.current) {
                     getCurrentLocation(); // Now call getCurrentLocation
                     initialLocationFetched.current = true;
                }
            }
        });
        // We only want this effect to run once when isClient becomes true
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isClient]); // Run ONLY when isClient changes to true

     // Update URL params state once client-side and params are available
     useEffect(() => {
        if (isClient && searchParams) {
             const id = searchParams.get('restaurantId');
             const url = searchParams.get('returnUrl');
             setRestaurantId(id || 'defaultMockResto');
             setReturnUrl(url || `/mock-order/${id || 'defaultMockResto'}`);
             console.log("Client-side params set:", { restaurantId: id, returnUrl: url });
        }
    }, [isClient, searchParams]);


    // --- Search Debounce Effect ---
    useEffect(() => {
         // Ensure this runs only on the client
        if (!isClient) return;

        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        if (searchQuery && searchQuery.length > 2 && searchQuery !== addressDetails?.fullAddress) {
            console.log("Search query changed:", searchQuery);
            debounceTimeout.current = setTimeout(async () => {
                console.log("Debounced search running for:", searchQuery);
                try {
                    // --- MOCK SEARCH RESPONSE ---
                    await new Promise(res => setTimeout(res, 300));
                    const mockSuggestions = [
                        { eLoc: `s_${Date.now()}_1`, placeName: `Mock Place 1 for "${searchQuery}"`, placeAddress: `123 Mock St, ${searchQuery} City`, latitude: mapCenter.lat + 0.01 * Math.random(), longitude: mapCenter.lng + 0.01 * Math.random() },
                        { eLoc: `s_${Date.now()}_2`, placeName: `Mock Place 2 near query`, placeAddress: `456 Fake Ave, ${searchQuery} Town`, latitude: mapCenter.lat - 0.01 * Math.random(), longitude: mapCenter.lng - 0.01 * Math.random() },
                    ];
                    console.log("Mock search suggestions:", mockSuggestions);
                    // --- END MOCK ---
                    setSuggestions(mockSuggestions || []);
                } catch (err) {
                    console.error("Search API error:", err);
                    setSuggestions([]);
                }
            }, 500);
        } else {
            setSuggestions([]);
        }

        return () => {
            if (debounceTimeout.current) {
                clearTimeout(debounceTimeout.current);
            }
        };
    }, [isClient, searchQuery, addressDetails, mapCenter]); // Add isClient dependency


    // --- Other Handlers ---
    const handleSuggestionClick = (suggestion) => {
        console.log("Suggestion clicked:", suggestion);
        setSearchQuery(suggestion.placeAddress);
        setSuggestions([]);
        const coords = { lat: suggestion.latitude, lng: suggestion.longitude };
        // Directly update mapCenter state. MapInnerComponent handles the move.
        setMapCenter(coords);
        // Let the map's idle listener trigger handleMapCenterChange -> reverseGeocode
    };

    const handleAddressFieldChange = (field, value) => {
        setAddressDetails(prev => ({ ...prev, [field]: value }));
    };

    const handleLabelClick = (label) => {
        setAddressLabel(label);
        setShowCustomLabelInput(label === 'Other');
        if (label !== 'Other') {
            setCustomLabel('');
        }
    };

    const handleConfirmLocation = async () => {
         // Ensure localStorage is accessed only on client
        if (!isClient) return;

        if (!addressDetails || !addressDetails.street || !addressDetails.city || !addressDetails.pincode) {
             setInfoDialog({ isOpen: true, title: "Missing Details", message: "Please ensure Street, City, and Pincode are filled." });
             return;
        }

        const finalLabel = addressLabel === 'Other' ? (customLabel.trim() || 'Other') : addressLabel;
        const fullAddress = `${addressDetails.street}, ${addressDetails.city}, ${addressDetails.state || ''} - ${addressDetails.pincode}`;

        // Get potentially stored name/phone from localStorage (client-side only)
        const storedName = localStorage.getItem('lastKnownName') || 'User';
        const storedPhone = localStorage.getItem('lastKnownPhone') || '';

        const addressToSave = {
            id: `addr_${Date.now()}`,
            label: finalLabel,
            name: user?.displayName || storedName, // Use stored name if no user
            phone: user?.phoneNumber || storedPhone, // Use stored phone if no user
            street: addressDetails.street,
            city: addressDetails.city,
            state: addressDetails.state || '', // Ensure state is included
            pincode: addressDetails.pincode,
            country: addressDetails.country || 'IN',
            full: fullAddress.replace(/, $/, '').replace(/ - $/, ''), // Clean up trailing separators
            latitude: addressDetails.latitude,
            longitude: addressDetails.longitude
        };
        console.log("Saving address:", addressToSave);
        localStorage.setItem('customerLocation', JSON.stringify(addressToSave));

        if (user) {
            setIsSaving(true);
            try {
                console.log("Simulating API save for logged-in user...");
                await new Promise(res => setTimeout(res, 500));
                console.log("Mock API save successful.");
                router.push(returnUrl);
            } catch (err) {
                console.error("Mock save error:", err);
                setInfoDialog({ isOpen: true, title: "Mock Error", message: `Could not save location: ${err.message}` });
                 setIsSaving(false); // Ensure saving state is reset on error
            }
             // No finally block needed here as router.push navigates away
        } else {
             router.push(returnUrl);
        }
    };


    // --- Render Logic ---

     // Show initial loading / client-side check indicator OR map initializing state
     if (!isClient || mapsInitializing) {
         return (
             <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-100">
                 <Loader2 className="animate-spin text-green-600 h-12 w-12 mb-4" />
                 <p className="text-gray-600">{!isClient ? "Loading component..." : "Initializing Map..."}</p>
             </div>
        );
     }

    // Show error message if script loading failed
    if (mapsInitError) {
         return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50 text-red-700">
                 <AlertTriangle className="h-12 w-12 mb-4" />
                <h2 className="text-xl font-bold mb-2">Map Initialization Failed</h2>
                <p className="text-center max-w-sm">{mapsInitError}</p>
                <p className="text-sm mt-4">Please check the API key configuration and network connection.</p>
                {/* Optionally add a retry button */}
            </div>
        );
    }

     // Safeguard: Ensure components are loaded before proceeding
     if (!GoogleMapsComponents) {
         return <div className="flex items-center justify-center min-h-screen">Error: Map components failed to initialize after mount. Please refresh.</div>;
     }
    const { APIProvider } = GoogleMapsComponents;


    return (
        // APIProvider needs the key from your environment (mocked via process.env)
        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} libraries={['marker', 'places']}>
            <div className="h-screen w-screen flex flex-col bg-gray-50 text-gray-800 green-theme"> {/* Using gray defaults */}
                <InfoDialog
                    isOpen={infoDialog.isOpen}
                    onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                    title={infoDialog.title}
                    message={infoDialog.message}
                />
                 <header className="p-4 border-b border-gray-200 flex items-center gap-4 flex-shrink-0 z-10 bg-white/80 backdrop-blur-sm shadow-sm">
                     <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
                         <ArrowLeft size={20}/>
                     </Button>
                     <div className="relative w-full">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"/>
                         <Input
                            type="text"
                            placeholder="Search for area, street name..."
                            className="w-full pl-10 h-11 border-gray-300 focus:border-green-500 focus:ring-green-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                         />
                         {suggestions.length > 0 && (
                            <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto z-20">
                                {suggestions.map(s => (
                                    <div
                                        key={s.eLoc} // Use unique key
                                        onClick={() => handleSuggestionClick(s)}
                                        className="p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                                    >
                                        <p className="font-semibold text-sm text-gray-800">{s.placeName}</p>
                                        <p className="text-xs text-gray-500">{s.placeAddress}</p>
                                    </div>
                                ))}
                            </div>
                         )}
                     </div>
                 </header>

                 <div className="flex-grow relative">
                     {/* Map Component */}
                     <Suspense fallback={<div className="w-full h-full bg-gray-200 flex items-center justify-center"><Loader2 className="animate-spin text-green-600 h-8 w-8"/></div>}>
                          <GoogleMapComponent
                              center={mapCenter}
                              onCenterChanged={handleMapCenterChange}
                          />
                     </Suspense>

                     {/* Use Current Location Button */}
                     <Button
                        variant="secondary"
                        className="absolute top-4 right-4 z-10 h-12 rounded-full shadow-lg flex items-center gap-2 pr-4 bg-white hover:bg-gray-100 text-gray-700"
                        onClick={getCurrentLocation}
                        // Disable only when actively fetching GPS coords
                        disabled={loading && error === 'Fetching your location...'}
                     >
                         {/* Show loader only when fetching GPS */}
                        {(loading && error === 'Fetching your location...')
                            ? <Loader2 className="animate-spin h-5 w-5" />
                            : <LocateFixed className="h-5 w-5"/>
                        }
                        Use Current Location
                     </Button>
                 </div>

                 {/* Bottom Address Panel */}
                 <div className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 rounded-t-2xl shadow-lg">
                     <button
                        onClick={() => setIsPanelOpen(prev => !prev)}
                        className="w-full flex justify-between items-center cursor-pointer p-4"
                        aria-expanded={isPanelOpen}
                        aria-controls="location-details-panel"
                     >
                         <p className="font-bold text-lg flex items-center gap-2 text-gray-800">
                             <MapPin size={20} className="text-green-600"/> Set Delivery Location
                         </p>
                         <motion.div animate={{ rotate: isPanelOpen ? 180 : 0 }}>
                             <ChevronUp className="text-gray-500"/>
                         </motion.div>
                     </button>

                     <AnimatePresence initial={false}>
                     {isPanelOpen && (
                         <motion.div
                            id="location-details-panel"
                            key="content"
                            initial="collapsed"
                            animate="open"
                            exit="collapsed"
                            variants={{
                                open: { opacity: 1, height: "auto", transition: { duration: 0.3, ease: "easeOut" } },
                                collapsed: { opacity: 0, height: 0, transition: { duration: 0.2, ease: "easeIn" } }
                            }}
                            className="overflow-hidden"
                         >
                            <div className="px-4 pb-4 max-h-[calc(50vh - 60px)] overflow-y-auto"> {/* Adjust max-height */}
                                {/* Loading indicator specifically for geocoding */}
                                {loading && error !== 'Fetching your location...' && (
                                     <div className="flex items-center justify-center gap-3 p-4">
                                         <Loader2 className="animate-spin text-green-600 h-5 w-5"/>
                                         <span className="text-gray-500">Fetching address details...</span>
                                     </div>
                                 )}
                                 {/* Error display */}
                                 {error && error !== 'Fetching your location...' && !loading && ( // Show error only when not loading
                                     <div className="text-red-600 text-center font-semibold p-4 bg-red-100 rounded-lg flex items-center justify-center gap-2 my-2">
                                         <AlertTriangle size={16}/> {error}
                                     </div>
                                 )}
                                 {/* Address Details Form */}
                                 {addressDetails ? (
                                     <div className="space-y-3 pt-2">
                                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"> {/* Use sm breakpoint */}
                                             <Input value={addressDetails.street || ''} onChange={(e) => handleAddressFieldChange('street', e.target.value)} placeholder="House No, Street / Area *" required className="border-gray-300 focus:border-green-500 focus:ring-green-500"/>
                                             <Input value={addressDetails.city || ''} onChange={(e) => handleAddressFieldChange('city', e.target.value)} placeholder="City *" required className="border-gray-300 focus:border-green-500 focus:ring-green-500"/>
                                             <Input value={addressDetails.pincode || ''} onChange={(e) => handleAddressFieldChange('pincode', e.target.value)} placeholder="Pincode *" required className="border-gray-300 focus:border-green-500 focus:ring-green-500"/>
                                             <Input value={addressDetails.state || ''} onChange={(e) => handleAddressFieldChange('state', e.target.value)} placeholder="State" className="border-gray-300 focus:border-green-500 focus:ring-green-500"/>
                                         </div>
                                         <div className="pt-2">
                                             <Label className="text-gray-700">Label as:</Label>
                                             <div className="flex items-center flex-wrap gap-2 mt-2">
                                                 <Button type="button" variant={addressLabel === 'Home' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Home')}><Home size={14} className="mr-2"/> Home</Button>
                                                 <Button type="button" variant={addressLabel === 'Work' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Work')}><Building size={14} className="mr-2"/> Work</Button>
                                                 <Button type="button" variant={addressLabel === 'Other' ? 'default' : 'outline'} size="sm" onClick={() => handleLabelClick('Other')}><MapPin size={14} className="mr-2"/> Other</Button>
                                                 {showCustomLabelInput && (
                                                     <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} transition={{ duration: 0.3 }}>
                                                         <Input
                                                            type="text"
                                                            value={customLabel}
                                                            onChange={(e) => setCustomLabel(e.target.value)}
                                                            placeholder="e.g., Friend's House"
                                                            className="h-9 border-gray-300 focus:border-green-500 focus:ring-green-500"
                                                            maxLength={20} // Add max length
                                                         />
                                                     </motion.div>
                                                 )}
                                             </div>
                                         </div>
                                         <Button
                                             onClick={handleConfirmLocation}
                                             // Disable if geocoding is happening OR saving is happening OR required fields are empty
                                             disabled={loading || isSaving || !addressDetails.street || !addressDetails.city || !addressDetails.pincode}
                                             className="w-full h-12 text-lg font-bold bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400 mt-4"
                                         >
                                             {isSaving ? <Loader2 className="animate-spin h-5 w-5" /> : 'Confirm & Save Location'}
                                         </Button>
                                     </div>
                                 ) : !loading && !error ? ( // Show placeholder only if not loading and no error
                                     <div className="text-center text-gray-500 p-4">
                                         Search or use GPS to set your location pin.
                                     </div>
                                 ) : null} {/* Don't show placeholder if there's an error */}
                             </div>
                         </motion.div>
                     )}
                     </AnimatePresence>
                 </div>
             </div>
         </APIProvider>
     );
};


const App = () => {
     // Basic Error Boundary
     const [hasError, setHasError] = useState(false);
     const [errorInfo, setErrorInfo] = useState(null); // Store error details

     useEffect(() => {
         const errorHandler = (event) => { // Catches errors like ReferenceError
             console.error("ErrorBoundary caught an error event:", event.error, event.message);
             setHasError(true);
             setErrorInfo({ message: event.message, error: event.error });
         };
         const rejectionHandler = (event) => { // Catches unhandled promise rejections
              console.error("ErrorBoundary caught an unhandled rejection:", event.reason);
             setHasError(true);
             setErrorInfo({ message: "Unhandled promise rejection", reason: event.reason });
         };

         // Only add listeners on the client side
         if (typeof window !== 'undefined') {
             window.addEventListener('error', errorHandler);
             window.addEventListener('unhandledrejection', rejectionHandler);
         }

         return () => {
             // Only remove listeners on the client side
             if (typeof window !== 'undefined') {
                 window.removeEventListener('error', errorHandler);
                 window.removeEventListener('unhandledrejection', rejectionHandler);
             }
         };
     }, []);

     if (hasError) {
         return <div className="min-h-screen bg-red-50 text-red-700 flex flex-col items-center justify-center p-4">
                     <AlertTriangle className="h-12 w-12 mb-4" />
                    <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
                    <p>An unexpected error occurred. Please try refreshing the page.</p>
                     {/* Optionally display error details during development */}
                    {/* <pre className="mt-4 text-xs bg-red-100 p-2 rounded max-w-full overflow-auto">
                        {JSON.stringify(errorInfo, null, 2)}
                    </pre> */}
                 </div>;
     }

    // Wrap the LocationPageInternal in Suspense
    return (
        <Suspense fallback={<div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-green-600 h-16 w-16"/></div>}>
           <LocationPageInternal/>
        </Suspense>
    );
};


export default App; // Export App as default
bhai is code me se sabhi mocks hata do please