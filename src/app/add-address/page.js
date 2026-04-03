
'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building, User, Phone, Lock, Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import dynamic from 'next/dynamic';
import { useUser } from '@/firebase';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import AddAddressPageSkeleton from '@/components/AddAddressPageSkeleton';
import { normalizeDeliveryZones, findMatchingBlockedDeliveryZone, findMatchingDeliveryZone } from '@/lib/deliveryZones';
import {
    fetchCachedCustomerLookup,
    fetchCachedOrderStatus,
    fetchCachedRestaurantBootstrap,
    invalidateCustomerLookupCache,
    upsertCustomerAddressSnapshot,
} from '@/lib/client/runtimeFetchers';

const GoogleMap = dynamic(() => import('@/components/GoogleMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);

const DEFAULT_MAP_CENTER = { lat: 22.9734, lng: 78.6569 }; // India center fallback
const DEFAULT_EXACT_ZOOM = 16;
const DEFAULT_APPROX_ZOOM = 11;
const INDIA_FALLBACK_ZOOM = 5;
const PIN_GEOCODE_MIN_DELTA = 0.00003;
const PIN_GEOCODE_COOLDOWN_MS = 1500;
const INDIA_GEO_BOUNDS = {
    minLat: 6,
    maxLat: 38,
    minLng: 68,
    maxLng: 98,
};
const LEADING_PLUS_CODE_REGEX = /^\s*[A-Z0-9]{2,10}\+[A-Z0-9]{2,5}(?:(?=\s*,)|(?=\s+[A-Za-z]))\s*,?\s*/i;
const MEANINGFUL_ADDRESS_PREFIX_REGEX = /\b(house|flat|floor|shop|plot|gali|street|st|road|rd|sector|sec|phase|block|near|opp|opposite|village|vill|colony|apt|apartment|tower|building|bldg|home)\b/i;
const LEADING_CODELIKE_SEGMENT_REGEX = /^[A-Z0-9/-]{1,12}$/i;

const normalizeCoords = (coords = {}) => ({
    lat: Number(Number(coords?.lat || 0).toFixed(6)),
    lng: Number(Number(coords?.lng || 0).toFixed(6)),
});

const hasMeaningfulPinMove = (prev, next, threshold = PIN_GEOCODE_MIN_DELTA) => {
    if (!prev || !next) return true;
    return Math.abs(Number(prev.lat) - Number(next.lat)) > threshold || Math.abs(Number(prev.lng) - Number(next.lng)) > threshold;
};

const isUsableIndiaLocation = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5) return false;
    return (
        lat >= INDIA_GEO_BOUNDS.minLat &&
        lat <= INDIA_GEO_BOUNDS.maxLat &&
        lng >= INDIA_GEO_BOUNDS.minLng &&
        lng <= INDIA_GEO_BOUNDS.maxLng
    );
};

const isMeaningfulCustomerName = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return !!normalized && normalized !== 'guest' && normalized !== 'user';
};

const stripLeadingAddressNoise = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';

    const withoutPlusCode = text.replace(LEADING_PLUS_CODE_REGEX, '').trim();
    if (!withoutPlusCode) return text;

    const firstCommaIndex = withoutPlusCode.indexOf(',');
    if (firstCommaIndex <= 0) return withoutPlusCode;

    const firstSegment = withoutPlusCode.slice(0, firstCommaIndex).trim();
    const rest = withoutPlusCode.slice(firstCommaIndex + 1).trim();
    if (!firstSegment || !rest) return withoutPlusCode;

    const looksLikeMeaningfulPrefix =
        MEANINGFUL_ADDRESS_PREFIX_REGEX.test(firstSegment) ||
        /\s/.test(firstSegment);

    if (!looksLikeMeaningfulPrefix && LEADING_CODELIKE_SEGMENT_REGEX.test(firstSegment) && /\d/.test(firstSegment)) {
        return rest;
    }

    return withoutPlusCode;
};

const getNestedParamFromReturnUrl = (returnUrl, key) => {
    const safeReturnUrl = String(returnUrl || '').trim();
    if (!safeReturnUrl || !key) return '';
    try {
        const nestedUrl = new URL(safeReturnUrl, 'http://localhost');
        return nestedUrl.searchParams.get(key) || '';
    } catch {
        return '';
    }
};

const extractRestaurantIdFromReturnUrl = (returnUrl = '') => {
    const safeReturnUrl = String(returnUrl || '').trim();
    if (!safeReturnUrl) return '';
    try {
        const nestedUrl = new URL(safeReturnUrl, 'http://localhost');
        const match = nestedUrl.pathname.match(/^\/order\/([^/?#]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : '';
    } catch {
        return '';
    }
};

const toRadians = (value) => (Number(value) * Math.PI) / 180;
const toDegrees = (value) => (Number(value) * 180) / Math.PI;
const EARTH_RADIUS_KM = 6371;

const haversineDistanceKm = (from, to) => {
    if (!from || !to) return Infinity;
    const dLat = toRadians(Number(to.lat) - Number(from.lat));
    const dLng = toRadians(Number(to.lng) - Number(from.lng));
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const computeBearingDegrees = (from, to) => {
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const dLng = toRadians(Number(to.lng) - Number(from.lng));
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

const projectPointFromCenter = (center, bearingDeg, distanceKm) => {
    const angularDistance = Number(distanceKm) / EARTH_RADIUS_KM;
    const bearing = toRadians(bearingDeg);
    const lat1 = toRadians(center.lat);
    const lng1 = toRadians(center.lng);

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lng2 = lng1 + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

    return normalizeCoords({ lat: toDegrees(lat2), lng: toDegrees(lng2) });
};

const getRadiusZoom = (radiusKm = 5) => {
    const radius = Number(radiusKm);
    if (!Number.isFinite(radius) || radius <= 0.8) return 16;
    if (radius <= 1.5) return 15;
    if (radius <= 3) return 14;
    if (radius <= 5) return 13;
    if (radius <= 8) return 12;
    return DEFAULT_APPROX_ZOOM;
};

const NON_DELIVERABLE_LOCATION_MESSAGE = 'Sorry, your location is currently outside our delivery zone.';

const getZoneValidationState = ({ coords, serviceArea, normalizedZones }) => {
    if (!coords || !serviceArea) {
        return {
            allowed: true,
            state: 'unknown',
            message: '',
        };
    }

    const radiusKm = Number(serviceArea?.radiusKm);
    if (serviceArea?.center && Number.isFinite(radiusKm) && radiusKm > 0) {
        const distanceFromRestaurant = haversineDistanceKm(serviceArea.center, coords);
        if (distanceFromRestaurant > radiusKm) {
            return {
                allowed: false,
                state: 'outside-radius',
                message: NON_DELIVERABLE_LOCATION_MESSAGE,
            };
        }
    }

    const hybridZonesEnabled = serviceArea?.deliveryUseZones === true && normalizedZones.length > 0;
    if (!hybridZonesEnabled) {
        return {
            allowed: true,
            state: 'legacy-radius',
            message: '',
        };
    }

    const blockedZone = findMatchingBlockedDeliveryZone(normalizedZones, coords);
    if (blockedZone) {
        return {
            allowed: false,
            state: 'blocked-zone',
            message: NON_DELIVERABLE_LOCATION_MESSAGE,
        };
    }

    const matchedZone = findMatchingDeliveryZone(normalizedZones, coords);
    if (matchedZone) {
        return {
            allowed: true,
            state: 'active-zone',
            zone: matchedZone,
            message: '',
        };
    }

    if (serviceArea?.zoneFallbackToLegacy === false) {
        return {
            allowed: false,
            state: 'strict-zone-miss',
            message: NON_DELIVERABLE_LOCATION_MESSAGE,
        };
    }

    return {
        allowed: true,
        state: 'fallback-zone-miss',
        message: '',
    };
};

const AddAddressPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const geocodeTimeoutRef = useRef(null);
    const geocodeAbortRef = useRef(null);
    const geocodeRequestIdRef = useRef(0);
    const lastQueuedCoordsRef = useRef(null);
    const lastResolvedCoordsRef = useRef(null);
    const lastGeocodeStartAtRef = useRef(0);
    const idleSuppressionCenterRef = useRef(normalizeCoords(DEFAULT_MAP_CENTER));
    const initialLocationResolvedRef = useRef(false);

    const { user, isUserLoading } = useUser();

    const rawReturnUrl = searchParams.get('returnUrl') || '/';
    const phone =
        searchParams.get('phone') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'phone');
    const token =
        searchParams.get('token') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'token');
    const ref =
        searchParams.get('ref') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'ref'); // CAPTURE REF for guest sessions
    const activeOrderId =
        searchParams.get('activeOrderId') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'activeOrderId');
    const tableId =
        searchParams.get('table') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'table');
    const prefilledNameFromUrl =
        searchParams.get('name') ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'name') ||
        '';
    const restaurantIdFromReturnUrl =
        extractRestaurantIdFromReturnUrl(rawReturnUrl) ||
        getNestedParamFromReturnUrl(rawReturnUrl, 'restaurantId') ||
        searchParams.get('restaurantId') ||
        '';

    // Security State
    const [isTokenValid, setIsTokenValid] = useState(() => !token);
    const [isSessionChecking, setIsSessionChecking] = useState(() => Boolean(token));
    const [tokenError, setTokenError] = useState('');
    const [verifiedGuestId, setVerifiedGuestId] = useState('');

    const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER);
    const [mapZoom, setMapZoom] = useState(DEFAULT_EXACT_ZOOM);
    const [serviceArea, setServiceArea] = useState(null);
    const [serviceAreaResolved, setServiceAreaResolved] = useState(false);
    const [addressDetails, setAddressDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [permissionError, setPermissionError] = useState(null); // NEW: Persistent permission error
    const [, setLocationHint] = useState('');
    const [isPinAddressLoading, setIsPinAddressLoading] = useState(false);
    const [isMapExpanded, setIsMapExpanded] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [fullAddress, setFullAddress] = useState('');
    const [addressDetail, setAddressDetail] = useState('');
    const [landmark, setLandmark] = useState('');
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customAddressLabel, setCustomAddressLabel] = useState('');

    const normalizedDeliveryZones = useMemo(
        () => normalizeDeliveryZones(serviceArea?.deliveryZones || []),
        [serviceArea?.deliveryZones]
    );
    const currentPinValidation = useMemo(() => {
        if (!addressDetails) return null;
        const coords = {
            lat: Number(addressDetails.latitude),
            lng: Number(addressDetails.longitude),
        };
        if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
        return getZoneValidationState({
            coords,
            serviceArea,
            normalizedZones: normalizedDeliveryZones,
        });
    }, [addressDetails, normalizedDeliveryZones, serviceArea]);

    const requiresDeliveryValidation = Boolean(restaurantIdFromReturnUrl || activeOrderId);
    const isDeliveryValidationPending = requiresDeliveryValidation && !serviceAreaResolved;
    const canSaveAddress =
        !isSessionChecking &&
        !loading &&
        !isPinAddressLoading &&
        !isSaving &&
        !!addressDetails &&
        !!fullAddress.trim() &&
        !isDeliveryValidationPending &&
        currentPinValidation?.allowed !== false;

    const returnUrl = rawReturnUrl;
    const useCurrent =
        searchParams.get('useCurrent') === 'true' ||
        searchParams.get('currentLocation') === 'true';
    const editId = searchParams.get('editId');
    const editDataRaw = searchParams.get('editData');

    useEffect(() => {
        let isMounted = true;

        const loadServiceArea = async () => {
            if (editDataRaw) {
                if (isMounted) setServiceAreaResolved(true);
                return;
            }

            if (!isTokenValid) {
                if (isMounted) setServiceAreaResolved(false);
                return;
            }

            if (isMounted) setServiceAreaResolved(false);

            try {
                let resolvedRestaurantId = restaurantIdFromReturnUrl;
                let fallbackCenter = null;

                if (!resolvedRestaurantId && activeOrderId && token) {
                    const statusData = await fetchCachedOrderStatus({
                        orderId: activeOrderId,
                        token,
                        ttlMs: 30000,
                    }).catch(() => null);
                    if (statusData?.order) {
                        resolvedRestaurantId = String(statusData.order.restaurantId || '').trim();
                        const statusRestaurantLocation = statusData.order.restaurantLocation;
                        const fallbackLat = Number(statusRestaurantLocation?.lat ?? statusRestaurantLocation?.latitude);
                        const fallbackLng = Number(statusRestaurantLocation?.lng ?? statusRestaurantLocation?.longitude);
                        if (isUsableIndiaLocation(fallbackLat, fallbackLng)) {
                            fallbackCenter = normalizeCoords({ lat: fallbackLat, lng: fallbackLng });
                        }
                    }
                }

                if (!resolvedRestaurantId) {
                    if (isMounted) setServiceArea(null);
                    return;
                }

                const { menuData } = await fetchCachedRestaurantBootstrap({
                    restaurantId: resolvedRestaurantId,
                    phone,
                    token,
                    ref,
                    src: 'add_address',
                    ttlMs: 60000,
                });

                const restaurantLat = Number(menuData?.latitude);
                const restaurantLng = Number(menuData?.longitude);
                const radiusKm = Number(menuData?.deliveryRadius);
                const safeRadiusKm = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 5;

                if (!isUsableIndiaLocation(restaurantLat, restaurantLng)) {
                    if (isMounted && fallbackCenter) {
                        setServiceArea({
                            center: fallbackCenter,
                            radiusKm: safeRadiusKm,
                            restaurantId: resolvedRestaurantId,
                            deliveryUseZones: menuData?.deliveryUseZones === true,
                            zoneFallbackToLegacy: menuData?.zoneFallbackToLegacy !== false,
                            deliveryZones: Array.isArray(menuData?.deliveryZones) ? menuData.deliveryZones : [],
                        });
                    }
                    return;
                }

                if (isMounted) {
                    setServiceArea({
                        center: normalizeCoords({ lat: restaurantLat, lng: restaurantLng }),
                        radiusKm: safeRadiusKm,
                        restaurantId: resolvedRestaurantId,
                        deliveryUseZones: menuData?.deliveryUseZones === true,
                        zoneFallbackToLegacy: menuData?.zoneFallbackToLegacy !== false,
                        deliveryZones: Array.isArray(menuData?.deliveryZones) ? menuData.deliveryZones : [],
                    });
                }
            } catch (error) {
                console.warn('[Add Address] Failed to resolve restaurant service area:', error?.message || error);
                if (isMounted) setServiceArea(null);
            } finally {
                if (isMounted) setServiceAreaResolved(true);
            }
        };

        loadServiceArea();

        return () => {
            isMounted = false;
        };
    }, [activeOrderId, editDataRaw, isTokenValid, phone, ref, restaurantIdFromReturnUrl, token]);

    useEffect(() => {
        let isMounted = true;

        const verifySessionToken = async () => {
            // Backward compatible flow: if no token in URL, allow direct entry.
            if (!token) {
                if (isMounted) {
                    setTokenError('');
                    setIsTokenValid(true);
                    setIsSessionChecking(false);
                }
                return;
            }

            if (isMounted) {
                setTokenError('');
                setIsSessionChecking(true);
            }

            try {
                const payload = { token };
                if (phone) payload.phone = phone;
                if (ref) payload.ref = ref;
                if (tableId) payload.tableId = tableId;

                const verifyRes = await fetch('/api/auth/verify-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const verifyData = await verifyRes.json().catch(() => ({}));
                if (!verifyRes.ok) {
                    if (isMounted) {
                        setTokenError(verifyData.message || 'Session verification failed. Please request a new link.');
                        setIsTokenValid(false);
                    }
                    return;
                }

                if (verifyData?.guestId && isMounted) {
                    setVerifiedGuestId(String(verifyData.guestId));
                }
                if (isMounted) {
                    setIsTokenValid(true);
                }
            } catch (err) {
                if (isMounted) {
                    setTokenError('Session verification failed. Please request a new link.');
                    setIsTokenValid(false);
                }
            } finally {
                if (isMounted) {
                    setIsSessionChecking(false);
                }
            }
        };

        verifySessionToken();

        return () => {
            isMounted = false;
        };
    }, [token, phone, ref, tableId]);

    // Initialize edit data
    useEffect(() => {
        if (!editDataRaw || !isTokenValid) return;
        try {
            const data = JSON.parse(decodeURIComponent(editDataRaw));
            setAddressDetails({
                street: data.street || '',
                city: data.city || '',
                state: data.state || '',
                pincode: data.pincode || '',
                country: data.country || 'IN',
                latitude: data.latitude,
                longitude: data.longitude
            });
            setMapCenter({ lat: data.latitude, lng: data.longitude });
            setMapZoom(DEFAULT_EXACT_ZOOM);
            idleSuppressionCenterRef.current = normalizeCoords({ lat: data.latitude, lng: data.longitude });
            setFullAddress(data.mapAddress || data.full || '');
            setAddressDetail(data.addressDetail || '');
            setLandmark(data.landmark || '');
            setRecipientName(data.name || '');
            setRecipientPhone(data.phone || '');
            
            const standardLabels = ['Home', 'Work', 'Other'];
            if (standardLabels.includes(data.label)) {
                setAddressLabel(data.label);
            } else {
                setAddressLabel('Other');
                setCustomAddressLabel(data.label || '');
            }
            setLoading(false);
        } catch (e) {
            console.error('[Add Address] Failed to parse editData:', e);
        }
    }, [editDataRaw, isTokenValid]);

    useEffect(() => () => {
        if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
        if (geocodeAbortRef.current) geocodeAbortRef.current.abort();
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.overscrollBehavior = '';

        return undefined;
    }, []);

    useEffect(() => {
        if (!isMapExpanded) return undefined;

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, [isMapExpanded]);

    const getSavedCustomerLocation = useCallback(() => {
        try {
            const raw = localStorage.getItem('customerLocation');
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const lat = Number(parsed?.latitude ?? parsed?.lat);
            const lng = Number(parsed?.longitude ?? parsed?.lng);
            if (!isUsableIndiaLocation(lat, lng)) return null;

            return {
                coords: { lat, lng },
                full: String(parsed?.full || parsed?.mapAddress || '').trim(),
            };
        } catch {
            return null;
        }
    }, []);

    const reverseGeocode = useCallback(async (coords, options = {}) => {
        const { background = false, hint = '', force = false } = options;
        const normalizedCoords = normalizeCoords(coords);

        if (!force) {
            const requestStartedRecently = Date.now() - lastGeocodeStartAtRef.current < PIN_GEOCODE_COOLDOWN_MS;
            const matchesQueuedTarget = !hasMeaningfulPinMove(lastQueuedCoordsRef.current, normalizedCoords);
            const matchesResolvedTarget = !hasMeaningfulPinMove(lastResolvedCoordsRef.current, normalizedCoords);
            const matchesCurrentAddress =
                !!addressDetails &&
                !hasMeaningfulPinMove(
                    normalizeCoords({
                        lat: addressDetails.latitude,
                        lng: addressDetails.longitude,
                    }),
                    normalizedCoords
                );

            if (matchesCurrentAddress || matchesResolvedTarget || (matchesQueuedTarget && requestStartedRecently)) {
                return;
            }
        }

        lastQueuedCoordsRef.current = normalizedCoords;

        if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = setTimeout(async () => {
            if (geocodeAbortRef.current) geocodeAbortRef.current.abort();

            const controller = new AbortController();
            geocodeAbortRef.current = controller;
            const requestId = geocodeRequestIdRef.current + 1;
            geocodeRequestIdRef.current = requestId;
            lastGeocodeStartAtRef.current = Date.now();

            const shouldKeepMapInteractive = background && !!addressDetails;
            if (shouldKeepMapInteractive) {
                setIsPinAddressLoading(true);
            } else {
                setLoading(true);
            }

            setError('');
            try {
                const res = await fetch(`/api/public/location/geocode?lat=${normalizedCoords.lat}&lng=${normalizedCoords.lng}`, {
                    signal: controller.signal,
                    cache: 'no-store',
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
                if (requestId !== geocodeRequestIdRef.current) return;

                setAddressDetails({
                    street: data.street || '',
                    city: data.city || data.town || data.village || '',
                    pincode: data.pincode || '',
                    state: data.state || '',
                    country: data.country || 'IN',
                    latitude: normalizedCoords.lat,
                    longitude: normalizedCoords.lng
                });
                setFullAddress(stripLeadingAddressNoise(data.formatted_address || ''));
                lastResolvedCoordsRef.current = normalizedCoords;
                if (hint) setLocationHint(hint);
            } catch (err) {
                if (controller.signal.aborted || requestId !== geocodeRequestIdRef.current) return;
                if (shouldKeepMapInteractive && addressDetails) {
                    setLocationHint('Pin moved, but address update failed. Try dropping the pin again.');
                } else {
                    setError('Could not fetch address details for this pin location.');
                    setAddressDetails(null);
                }
            } finally {
                if (requestId === geocodeRequestIdRef.current) {
                    setIsPinAddressLoading(false);
                    setLoading(false);
                }
            }
        }, background ? 250 : 0);
    }, [addressDetails]);

    const applyRestaurantServiceAreaFallback = useCallback((hintMessage) => {
        if (!serviceArea?.center || !Number.isFinite(Number(serviceArea?.radiusKm))) {
            return false;
        }

        setMapCenter(serviceArea.center);
        setMapZoom(getRadiusZoom(serviceArea.radiusKm));
        idleSuppressionCenterRef.current = normalizeCoords(serviceArea.center);
        setLocationHint(hintMessage || 'Location permission is blocked, so we opened the restaurant delivery area. Keep the pin inside this service range.');
        reverseGeocode(serviceArea.center, {
            background: false,
            force: true,
        });
        return true;
    }, [reverseGeocode, serviceArea]);

    const handleMapIdle = useCallback((coords) => {
        const normalizedCoords = normalizeCoords(coords);
        if (
            idleSuppressionCenterRef.current &&
            !hasMeaningfulPinMove(idleSuppressionCenterRef.current, normalizedCoords)
        ) {
            idleSuppressionCenterRef.current = null;
            return;
        }

        if (permissionError && serviceArea?.center && Number.isFinite(Number(serviceArea?.radiusKm))) {
            const distanceFromRestaurant = haversineDistanceKm(serviceArea.center, normalizedCoords);
            const radiusKm = Number(serviceArea.radiusKm);
            if (distanceFromRestaurant > radiusKm) {
                const snapBearing = computeBearingDegrees(serviceArea.center, normalizedCoords);
                const snappedCoords = projectPointFromCenter(
                    serviceArea.center,
                    snapBearing,
                    Math.max(radiusKm - 0.03, 0.05)
                );
                idleSuppressionCenterRef.current = normalizeCoords(snappedCoords);
                setMapCenter(snappedCoords);
                setMapZoom(getRadiusZoom(radiusKm));
                setLocationHint(`Location permission is blocked, so the pin stays inside ${radiusKm} km delivery radius.`);
                reverseGeocode(snappedCoords, { background: false, force: true });
                return;
            }
        }

        reverseGeocode(normalizedCoords, { background: true });
    }, [permissionError, reverseGeocode, serviceArea]);

    const getIpApproximateLocation = useCallback(async () => {
        if (serviceArea?.center && Number.isFinite(Number(serviceArea?.radiusKm))) {
            applyRestaurantServiceAreaFallback();
            return;
        }

        setLoading(true);
        setError('Detecting your approximate location...');

        try {
            const res = await fetch('/api/public/location/ip', { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || 'Could not detect IP location.');
            }

            const lat = Number(data?.lat);
            const lng = Number(data?.lng);
            if (!isUsableIndiaLocation(lat, lng)) {
                throw new Error('IP location did not return a usable India coordinate.');
            }

            const coords = { lat, lng };
            setMapCenter(coords);
            setMapZoom(DEFAULT_APPROX_ZOOM);
            idleSuppressionCenterRef.current = normalizeCoords(coords);
            reverseGeocode(coords, {
                background: false,
                hint: 'Approximate location detected from network. You can fine-tune the pin without reloading the map.',
                force: true,
            });
        } catch (ipErr) {
            console.warn('[Add Address] IP location failed:', ipErr?.message || ipErr);
            setMapCenter(DEFAULT_MAP_CENTER);
            setMapZoom(INDIA_FALLBACK_ZOOM);
            idleSuppressionCenterRef.current = normalizeCoords(DEFAULT_MAP_CENTER);
            setLocationHint('Location permission is blocked, so we opened a safe India map view. Move the pin to your address.');
            setLoading(false);
            setError('');
        }
    }, [applyRestaurantServiceAreaFallback, reverseGeocode, serviceArea]);

    const getCurrentGeolocation = useCallback(() => {
        setLoading(true);
        setError('Fetching your location...');
        setPermissionError(null); // Clear previous permission errors on retry

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
                setMapCenter(coords);
                setMapZoom(DEFAULT_EXACT_ZOOM);
                idleSuppressionCenterRef.current = normalizeCoords(coords);
                reverseGeocode(coords, {
                    background: false,
                    hint: 'Current location detected. You can fine-tune the pin without reloading the map.',
                    force: true,
                });
                setError('');
            },
            (err) => {
                setLoading(false);
                let message = "Could not fetch location. Please move the map pin manually.";
                let isPermIssue = false;

                if (err.code === 1) {
                    message = "Location access blocked. Please enable permissions in your browser settings to use current location.";
                    isPermIssue = true;
                } else if (err.code === 3) {
                    message = "Location request timed out. Please check signal or retry.";
                    isPermIssue = true;
                }

                if (isPermIssue) {
                    setPermissionError(message); // Persist this!
                    if (!applyRestaurantServiceAreaFallback(`Location access is blocked, so you can set the pin only inside the restaurant's delivery radius.`)) {
                        getIpApproximateLocation();
                    }
                } else {
                    setError(message);
                }
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    }, [applyRestaurantServiceAreaFallback, getIpApproximateLocation, reverseGeocode]);

    // Separate effect for initial data prefill to prevent overwriting user input
    useEffect(() => {
        let isMounted = true;
        const prefillData = async () => {
            try {
                let hasPhoneFromLookup = false;
                let hasNameFromLookup = false;

                if (prefilledNameFromUrl && isMounted) {
                    setRecipientName(prev => prev || prefilledNameFromUrl);
                    hasNameFromLookup = true;
                }

                const phoneToUse = phone || user?.phoneNumber;
                if (phoneToUse) {
                    const normalizedPhoneFromUrlOrAuth = String(phoneToUse).replace(/\D/g, '').slice(-10);
                    if (normalizedPhoneFromUrlOrAuth) {
                        setRecipientPhone(prev => prev || normalizedPhoneFromUrlOrAuth);
                        hasPhoneFromLookup = true;
                    }
                }

                const customerData = await fetchCachedCustomerLookup({
                    phone: phoneToUse,
                    ref,
                    guestId: verifiedGuestId || undefined,
                    user,
                    ttlMs: 60000,
                }).catch((lookupError) => {
                    if (lookupError?.status !== 404) {
                        console.warn('[Add Address] Customer lookup failed:', lookupError?.message || lookupError);
                    }
                    return null;
                });

                if (customerData && isMounted) {
                    console.log('[Add Address] Customer data resolved:', customerData);
                    const resolvedName = String(customerData?.name || '').trim();
                    const resolvedPhone = String(customerData?.phone || '').replace(/\D/g, '').slice(-10);
                    if (isMeaningfulCustomerName(resolvedName)) {
                        setRecipientName(prev => prev || resolvedName);
                        hasNameFromLookup = true;
                    }
                    if (resolvedPhone) {
                        setRecipientPhone(prev => prev || resolvedPhone);
                        hasPhoneFromLookup = true;
                    }
                }

                // Fallback: get phone/name from active order itself (useful when URL has ref but no phone)
                if ((!hasPhoneFromLookup || !hasNameFromLookup) && activeOrderId && token) {
                    try {
                        const statusData = await fetchCachedOrderStatus({
                            orderId: activeOrderId,
                            token,
                            ttlMs: 30000,
                        });
                        const order = statusData?.order || {};
                        const orderName = String(order.customerName || '').trim();
                        const orderPhone = String(order.customerPhone || '').replace(/\D/g, '').slice(-10);
                        if (isMeaningfulCustomerName(orderName) && !hasNameFromLookup) {
                            setRecipientName(prev => prev || orderName);
                            hasNameFromLookup = true;
                        }
                        if (orderPhone && !hasPhoneFromLookup) {
                            setRecipientPhone(prev => prev || orderPhone);
                            hasPhoneFromLookup = true;
                        }
                    } catch (statusErr) {
                        console.warn('[Add Address] Could not fetch fallback order details:', statusErr?.message || statusErr);
                    }
                }

                // Fallback to User Display Name
                if (user && isMounted) {
                    setRecipientName(prev => prev || user.displayName || '');
                }
            } catch (e) {
                console.warn("Could not prefill customer data:", e);
            }
        };

        if (isTokenValid) {
            prefillData();
        }

        return () => { isMounted = false; };
    }, [isTokenValid, user, phone, ref, token, prefilledNameFromUrl, activeOrderId, verifiedGuestId]); // Removed addressDetails dependencies

    // Effect for initial location resolution (only once after token validation)
    useEffect(() => {
        if (!isTokenValid || !serviceAreaResolved || initialLocationResolvedRef.current || editDataRaw) return;

        initialLocationResolvedRef.current = true;
        if (useCurrent) {
            getCurrentGeolocation();
        } else if (serviceArea?.center && Number.isFinite(Number(serviceArea?.radiusKm))) {
            applyRestaurantServiceAreaFallback();
        } else {
            getIpApproximateLocation();
        }
    }, [applyRestaurantServiceAreaFallback, editDataRaw, getCurrentGeolocation, getIpApproximateLocation, isTokenValid, serviceArea, serviceAreaResolved, useCurrent]);


    const handleConfirmLocation = async () => {
        if (!addressDetails || !recipientName.trim() || !recipientPhone.trim() || !fullAddress.trim()) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please fill all required fields: Contact Person, Phone, and Complete Address." });
            return;
        }
        if (isDeliveryValidationPending) {
            return;
        }
        if (currentPinValidation && currentPinValidation.allowed === false) {
            setInfoDialog({ isOpen: true, title: 'Delivery Not Available', message: currentPinValidation.message });
            return;
        }
        if (!/^\d{10}$/.test(recipientPhone.trim())) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please enter a valid 10-digit phone number." });
            return;
        }

        setIsSaving(true);

        const finalLabel = (addressLabel === 'Other' && customAddressLabel.trim()) ? customAddressLabel.trim() : addressLabel;

        const cleanedFullAddress = stripLeadingAddressNoise(fullAddress);
        const combinedAddress = cleanedFullAddress;

        const addressToSave = {
            id: editId || `addr_${Date.now()}`,
            label: finalLabel,
            name: recipientName.trim(),
            phone: recipientPhone.trim(),
            street: addressDetails.street,
            addressDetail: '',
            landmark: '',
            city: addressDetails.city,
            state: addressDetails.state,
            pincode: addressDetails.pincode,
            country: addressDetails.country,
            full: combinedAddress,
            mapAddress: cleanedFullAddress,
            latitude: parseFloat(addressDetails.latitude),
            longitude: parseFloat(addressDetails.longitude),
        };

        localStorage.setItem('customerLocation', JSON.stringify(addressToSave));

        try {
            const sessionIdentifierPhone = phone || user?.phoneNumber || recipientPhone;

            const apiPayload = {
                address: addressToSave,
                phone: sessionIdentifierPhone,
                // Pass Guest Identifiers for V2 Flow
                ref: searchParams.get('ref'),
                token: token,
                activeOrderId
            };

            const headers = { 'Content-Type': 'application/json' };
            if (user) {
                const idToken = await user.getIdToken();
                headers['Authorization'] = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/user/addresses', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(apiPayload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to save address.');
            }

            upsertCustomerAddressSnapshot(addressToSave);
            invalidateCustomerLookupCache();
            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <AddAddressPageSkeleton statusText={isSessionChecking ? 'Preparing address page...' : 'Loading address details...'} />;
    }

    const isFullAddressMissing = !fullAddress.trim();
    const isRecipientNameMissing = !recipientName.trim();
    const isRecipientPhoneMissing = !recipientPhone.trim();
    const requiredFieldClassName =
        'mt-1 border-red-300 bg-red-50/80 focus-visible:ring-red-400 dark:border-red-900 dark:bg-red-950/30';
    const filledRequiredFieldClassName =
        'mt-1 border-border bg-background';
    const showBlockingMapOverlay = loading && !addressDetails;
    const mapShellClassName = isMapExpanded
        ? 'fixed inset-0 z-[80] h-[100dvh] w-screen bg-background'
        : 'md:w-1/2 h-[48dvh] min-h-[340px] md:h-full flex-shrink-0 relative';

    return (
        <div className="min-h-screen min-h-[100dvh] w-screen flex flex-col bg-background text-foreground customer-flow-surface">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '', type: '' })} title={infoDialog.title} message={infoDialog.message} type={infoDialog.type} />
            <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10 bg-background/80 backdrop-blur-sm">
                <Button variant="ghost" size="icon" onClick={() => router.push(returnUrl)}><ArrowLeft /></Button>
                <h1 className="text-xl font-bold">Add Address Details</h1>
            </header>

            <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                <div className={mapShellClassName}>
                    {showBlockingMapOverlay && (
                        <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                            <GoldenCoinSpinner />
                            <p className="mt-4 font-semibold text-lg animate-pulse">Fetching your location...</p>
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => setIsMapExpanded((prev) => !prev)}
                        className="absolute top-4 right-4 z-20 h-12 w-12 rounded-full shadow-lg"
                        aria-label={isMapExpanded ? 'Close full screen map' : 'Open full screen map'}
                    >
                        {isMapExpanded ? <X /> : <Maximize2 />}
                    </Button>
                    <GoogleMap
                        center={mapCenter}
                        zoom={mapZoom}
                        onIdle={handleMapIdle}
                        gestureHandling="greedy"
                    />
                </div>

                <div className="p-4 space-y-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:w-1/2 customer-flow-sheet">
                    <Button variant="secondary" className="w-full h-12 shadow-lg flex items-center gap-2 pr-4 bg-white text-black hover:bg-gray-200 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700" onClick={getCurrentGeolocation} disabled={loading || isPinAddressLoading}>
                        {loading ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use My Current Location
                    </Button>
                    {currentPinValidation?.allowed === false && currentPinValidation?.message && (
                        <div className={[
                            'rounded-xl border p-3 text-sm font-medium',
                            'border-destructive/30 bg-destructive/10 text-destructive'
                        ].join(' ')}>
                            <div className="flex items-start gap-2">
                                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                                <p>{currentPinValidation.message}</p>
                            </div>
                        </div>
                    )}
                    {permissionError && (
                        <div className="text-amber-700 dark:text-amber-300 text-sm font-medium p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                            {permissionError}
                        </div>
                    )}
                    {loading && !addressDetails ? (
                        <div className="flex items-center justify-center gap-3 p-4">
                            <Loader2 className="animate-spin text-primary" />
                            <span className="text-muted-foreground">{error || 'Fetching address details...'}</span>
                        </div>
                    ) : error && !addressDetails ? (
                        <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    ) : addressDetails ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between gap-3">
                                    <Label htmlFor="fullAddress">Complete Address *</Label>
                                    {isPinAddressLoading && (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Updating from pin...
                                        </div>
                                    )}
                                </div>
                                <Textarea id="fullAddress" value={fullAddress} onChange={e => setFullAddress(e.target.value)} required rows={3} className={isFullAddressMissing ? requiredFieldClassName : filledRequiredFieldClassName} />
                            </div>
                            {/* Address Details and Landmark intentionally hidden for now. */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="recipientName">Contact Person *</Label>
                                    <Input id="recipientName" value={recipientName} onChange={e => setRecipientName(e.target.value)} required className={isRecipientNameMissing ? requiredFieldClassName : filledRequiredFieldClassName} />
                                </div>
                                <div>
                                    <Label htmlFor="recipientPhone">Contact Number *</Label>
                                    <Input id="recipientPhone" type="tel" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} required className={isRecipientPhoneMissing ? requiredFieldClassName : filledRequiredFieldClassName} />
                                </div>
                            </div>
                            <div>
                                <Label>Save address as</Label>
                                <div className="flex items-start flex-wrap gap-2 mt-2">
                                    <Button type="button" variant={addressLabel === 'Home' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Home')}><Home size={14} className="mr-2" /> Home</Button>
                                    <Button type="button" variant={addressLabel === 'Work' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Work')}><Building size={14} className="mr-2" /> Work</Button>
                                    <Button type="button" variant={addressLabel === 'Other' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Other')}><MapPin size={14} className="mr-2" /> Other</Button>
                                    <AnimatePresence>
                                        {addressLabel === 'Other' && (
                                            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
                                                <Input type="text" value={customAddressLabel} onChange={e => setCustomAddressLabel(e.target.value)} placeholder="Custom Label (e.g., Gym)" className="h-9" />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                            <div className="p-4 border-t border-border mt-4">
                                <Button onClick={handleConfirmLocation} disabled={!canSaveAddress} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} {isSaving ? 'Saving...' : 'Save Address & Continue'}
                                </Button>
                            </div>
                        </motion.div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

const AddAddressPage = () => (
    <Suspense fallback={<AddAddressPageSkeleton />}>
        <AddAddressPageInternal />
    </Suspense>
);

export default AddAddressPage;
