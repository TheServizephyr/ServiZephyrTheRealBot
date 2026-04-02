
'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { motion } from 'framer-motion';
import dynamicImport from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save, Truck, Map as MapIcon, IndianRupee, ToggleRight, Settings, Loader2, XCircle, Maximize2, PencilLine, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

export const dynamic = 'force-dynamic';

const DeliveryZoneMapEditor = dynamicImport(
    () => import('@/components/OwnerDashboard/DeliveryZoneMapEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="h-[420px] rounded-2xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                Loading map editor...
            </div>
        ),
    }
);

const DEFAULT_ORDER_SLAB_RULES = [
    { maxOrder: 100, fee: 10 },
    { maxOrder: 200, fee: 20 }
];

const DEFAULT_MAP_CENTER = { lat: 28.6139, lng: 77.2090 };
const ZONE_COLOR_OPTIONS = [
    '#0f766e',
    '#2563eb',
    '#7c3aed',
    '#db2777',
    '#ea580c',
    '#ca8a04',
];

const DEFAULT_ZONE_SAMPLE = [
    {
        zone_id: 'SEC_62_NOIDA',
        name: 'Noida Sector 62',
        priority: 1,
        is_active: true,
        is_blocked: false,
        baseFee: 20,
        color: ZONE_COLOR_OPTIONS[0],
        boundary: [
            [28.628, 77.361],
            [28.629, 77.372],
            [28.621, 77.377],
            [28.618, 77.366]
        ],
        pricingTiers: [
            { minOrder: 0, maxOrder: 200, deliveryFee: 50, label: 'Starter orders' },
            { minOrder: 201, maxOrder: 500, deliveryFee: 30, label: 'Growth basket' },
            { minOrder: 501, maxOrder: -1, deliveryFee: 0, label: 'Free delivery' }
        ]
    }
];

const normalizeOrderSlabRules = (rules = []) => {
    if (!Array.isArray(rules) || rules.length === 0) {
        return [...DEFAULT_ORDER_SLAB_RULES];
    }

    const normalized = rules
        .map((rule) => ({
            maxOrder: Number(rule?.maxOrder) || 0,
            fee: Number(rule?.fee) || 0
        }))
        .filter((rule) => rule.maxOrder > 0)
        .sort((a, b) => a.maxOrder - b.maxOrder);

    if (normalized.length === 0) {
        return [...DEFAULT_ORDER_SLAB_RULES];
    }

    if (normalized.length === 1) {
        const fallbackRule = DEFAULT_ORDER_SLAB_RULES[1];
        const fallbackMax = Math.max(normalized[0].maxOrder + 1, fallbackRule.maxOrder);
        return [normalized[0], { maxOrder: fallbackMax, fee: fallbackRule.fee }];
    }

    return normalized.slice(0, 2);
};

const normalizePricingTier = (tier = {}) => {
    const minOrder = Number(tier?.minOrder);
    const parsedMaxOrder = Number(tier?.maxOrder);
    const parsedDeliveryFee = Number(tier?.deliveryFee ?? tier?.fee ?? tier?.amount);
    const parsedFeeAdjustment = Number(tier?.feeAdjustment ?? tier?.adjustment);

    return {
        minOrder: Number.isFinite(minOrder) ? minOrder : 0,
        maxOrder: tier?.maxOrder === -1 || parsedMaxOrder === -1
            ? -1
            : (Number.isFinite(parsedMaxOrder) ? parsedMaxOrder : -1),
        deliveryFee: Number.isFinite(parsedDeliveryFee) ? parsedDeliveryFee : null,
        feeAdjustment: Number.isFinite(parsedFeeAdjustment) ? parsedFeeAdjustment : null,
        label: String(tier?.label || '').trim(),
    };
};

const toBoundaryPoint = (point) => {
    if (Array.isArray(point) && point.length >= 2) {
        const lat = Number(point[0]);
        const lng = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
    }

    if (!point || typeof point !== 'object') return null;

    const lat = Number(point.lat ?? point.latitude);
    const lng = Number(point.lng ?? point.lon ?? point.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
};

const extractBoundaryFromGeojson = (geojson) => {
    if (!geojson || typeof geojson !== 'object') return [];

    if (geojson.type === 'Polygon' && Array.isArray(geojson.coordinates?.[0])) {
        return geojson.coordinates[0]
            .map((pair) => Array.isArray(pair) && pair.length >= 2 ? toBoundaryPoint([pair[1], pair[0]]) : null)
            .filter(Boolean);
    }

    if (geojson.type === 'MultiPolygon' && Array.isArray(geojson.coordinates?.[0]?.[0])) {
        return geojson.coordinates[0][0]
            .map((pair) => Array.isArray(pair) && pair.length >= 2 ? toBoundaryPoint([pair[1], pair[0]]) : null)
            .filter(Boolean);
    }

    return [];
};

const buildZoneDraft = (zone = {}, index = 0) => ({
    zone_id: String(zone?.zone_id || zone?.zoneId || zone?.id || `zone_${index + 1}`).trim(),
    name: String(zone?.name || zone?.zoneName || `Zone ${index + 1}`).trim(),
    priority: Number.isFinite(Number(zone?.priority)) ? String(Number(zone.priority)) : String(index),
    status: zone?.is_blocked === true || zone?.isBlocked === true ? 'blocked' : 'active',
    deliveryFee: Number.isFinite(Number(zone?.baseFee)) ? String(Number(zone.baseFee)) : '0',
    color: String(zone?.color || ZONE_COLOR_OPTIONS[index % ZONE_COLOR_OPTIONS.length]).trim() || ZONE_COLOR_OPTIONS[0],
});

const normalizeDeliveryZonesForForm = (zones = []) => {
    if (!Array.isArray(zones)) return [];

    return zones
        .map((zone, index) => {
            const explicitBoundary = Array.isArray(zone?.boundary)
                ? zone.boundary
                    .map(toBoundaryPoint)
                    .filter(Boolean)
                : [];
            const fallbackBoundary = explicitBoundary.length >= 3 ? explicitBoundary : extractBoundaryFromGeojson(zone?.geojson);
            const boundary = fallbackBoundary.length >= 3 ? fallbackBoundary : [];

            return {
                zone_id: String(zone?.zone_id || zone?.zoneId || zone?.id || `zone_${index + 1}`).trim(),
                name: String(zone?.name || zone?.zoneName || `Zone ${index + 1}`).trim(),
                priority: Number.isFinite(Number(zone?.priority)) ? Number(zone.priority) : index,
                is_active: true,
                is_blocked: zone?.is_blocked === true || zone?.isBlocked === true,
                baseFee: Number.isFinite(Number(zone?.baseFee)) ? Number(zone.baseFee) : 0,
                color: String(zone?.color || ZONE_COLOR_OPTIONS[index % ZONE_COLOR_OPTIONS.length]).trim() || ZONE_COLOR_OPTIONS[0],
                boundary,
                geojson: zone?.geojson && typeof zone.geojson === 'object' ? zone.geojson : null,
                pricingTiers: Array.isArray(zone?.pricingTiers) ? zone.pricingTiers.map(normalizePricingTier) : [],
            };
        })
        .filter((zone) => zone.boundary.length >= 3 || zone.geojson);
};

const serializeDeliveryZones = (zones = []) => JSON.stringify(normalizeDeliveryZonesForForm(zones), null, 2);

const parseDeliveryZonesEditor = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return { zones: [], error: null };

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        return { zones: [], error: 'Zone JSON is not valid. Please check commas, quotes, and brackets.' };
    }

    if (!Array.isArray(parsed)) {
        return { zones: [], error: 'Zone JSON must be an array of zones.' };
    }

    const zones = normalizeDeliveryZonesForForm(parsed);
    if (parsed.length > 0 && zones.length === 0) {
        return { zones: [], error: 'Each zone needs either a valid boundary with 3+ points or a GeoJSON polygon.' };
    }

    const invalidTier = zones.some((zone) => zone.pricingTiers.some((tier) => tier.maxOrder !== -1 && tier.maxOrder < tier.minOrder));
    if (invalidTier) {
        return { zones: [], error: 'A pricing tier has `maxOrder` smaller than `minOrder`.' };
    }

    return { zones, error: null };
};

const toFiniteCoordinate = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const calculateHaversineKm = (start, end) => {
    const startLat = toFiniteCoordinate(start?.lat);
    const startLng = toFiniteCoordinate(start?.lng);
    const endLat = toFiniteCoordinate(end?.lat);
    const endLng = toFiniteCoordinate(end?.lng);
    if ([startLat, startLng, endLat, endLng].some((value) => value === null)) return null;

    const toRadians = (value) => (value * Math.PI) / 180;
    const dLat = toRadians(endLat - startLat);
    const dLng = toRadians(endLng - startLng);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(startLat)) * Math.cos(toRadians(endLat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getAutoFittedGlobalRadiusKm = (businessCoordinates, zones = [], fallbackRadius = 5) => {
    if (!businessCoordinates || !Array.isArray(zones)) return fallbackRadius;

    const activeZones = zones.filter((zone) => zone?.is_blocked !== true && Array.isArray(zone?.boundary) && zone.boundary.length >= 3);
    if (activeZones.length === 0) return fallbackRadius;

    let maxDistanceKm = 0;
    for (const zone of activeZones) {
        for (const point of zone.boundary) {
            const distanceKm = calculateHaversineKm(
                businessCoordinates,
                { lat: point?.[0], lng: point?.[1] }
            );
            if (distanceKm !== null) {
                maxDistanceKm = Math.max(maxDistanceKm, distanceKm);
            }
        }
    }

    if (maxDistanceKm <= 0) return fallbackRadius;
    return Math.max(0.5, Number((maxDistanceKm + 0.15).toFixed(2)));
};

function DeliverySettingsPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const desktopRuntime = useMemo(() => isDesktopApp(), []);
    const deliverySettingsCacheKey = useMemo(() => [
        'owner_delivery_settings_v1',
        impersonatedOwnerId || 'self',
        employeeOfOwnerId || 'none',
    ].join(':'), [employeeOfOwnerId, impersonatedOwnerId]);

    const [settings, setSettings] = useState({
        deliveryEnabled: true,
        deliveryRadius: [5],
        deliveryFeeType: 'fixed',
        deliveryFixedFee: 30,
        deliveryBaseDistance: 0,
        deliveryPerKmFee: 5,
        deliveryFreeThreshold: 500,
        // NEW: Road factor & free zone
        roadDistanceFactor: 1.0,
        freeDeliveryRadius: 0,
        freeDeliveryMinOrder: 0,
        // NEW: Tiered charges
        deliveryTiers: [], // Array of { minOrder: number, fee: number }
        // NEW: Order slab + distance engine
        deliveryOrderSlabRules: [...DEFAULT_ORDER_SLAB_RULES],
        deliveryOrderSlabAboveFee: 0,
        deliveryOrderSlabBaseDistance: 1,
        deliveryOrderSlabPerKmFee: 15,
        deliveryEngineMode: 'legacy',
        deliveryUseZones: false,
        zoneFallbackToLegacy: true,
        deliveryZones: [],
        businessCoordinates: null,
    });
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [zoneEditorValue, setZoneEditorValue] = useState('[]');
    const [zoneEditorError, setZoneEditorError] = useState('');
    const [isZoneStudioOpen, setIsZoneStudioOpen] = useState(false);
    const [isZoneDetailsOpen, setIsZoneDetailsOpen] = useState(false);
    const [zoneDraft, setZoneDraft] = useState(null);
    const [resumeZoneStudioAfterEdit, setResumeZoneStudioAfterEdit] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) {
                    setLoading(false);
                    return;
                }
                const idToken = await user.getIdToken();

                const queryParams = new URLSearchParams();
                if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
                if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
                const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

                const res = await fetch(`/api/owner/delivery-settings${queryString}`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (!res.ok) throw new Error("Failed to load settings.");
                const data = await res.json();
                const toNum = (value, fallback = 0) => {
                    const n = Number(value);
                    return Number.isFinite(n) ? n : fallback;
                };
                const lat = Number(data?.coordinates?.lat ?? data?.latitude ?? data?.address?.latitude ?? data?.businessAddress?.latitude);
                const lng = Number(data?.coordinates?.lng ?? data?.longitude ?? data?.address?.longitude ?? data?.businessAddress?.longitude);
                const normalizedSettings = {
                    // Keep threshold unified across "Free Over" and "Bonus Min Order".
                    // Prefer explicit free-over value, fallback to global min-order override.
                    // This keeps UI and backend behavior aligned.
                    deliveryFreeThreshold: toNum(data.deliveryFreeThreshold, 0) > 0
                        ? toNum(data.deliveryFreeThreshold, 0)
                        : toNum(data.freeDeliveryMinOrder, 500),
                    deliveryEnabled: data.deliveryEnabled,
                    deliveryRadius: [toNum(data.deliveryRadius, 5)],
                    deliveryFeeType: data.deliveryFeeType || 'fixed',
                    deliveryFixedFee: toNum(data.deliveryFixedFee, 30),
                    deliveryBaseDistance: toNum(data.deliveryBaseDistance, 0),
                    deliveryPerKmFee: toNum(data.deliveryPerKmFee, 5),
                    // NEW: Road factor & free zone
                    roadDistanceFactor: toNum(data.roadDistanceFactor, 1.0),
                    freeDeliveryRadius: toNum(data.freeDeliveryRadius, 0),
                    freeDeliveryMinOrder: toNum(data.deliveryFreeThreshold, 0) > 0
                        ? toNum(data.deliveryFreeThreshold, 0)
                        : toNum(data.freeDeliveryMinOrder, 0),
                    // NEW: Tiered charges
                    deliveryTiers: (data.deliveryTiers || []).map(t => ({
                        minOrder: toNum(t?.minOrder, 0),
                        fee: toNum(t?.fee, 0),
                    })),
                    deliveryOrderSlabRules: normalizeOrderSlabRules(data.deliveryOrderSlabRules),
                    deliveryOrderSlabAboveFee: toNum(data.deliveryOrderSlabAboveFee, 0),
                    deliveryOrderSlabBaseDistance: Math.max(0, toNum(data.deliveryOrderSlabBaseDistance, 1)),
                    deliveryOrderSlabPerKmFee: Math.max(0, toNum(data.deliveryOrderSlabPerKmFee, 15)),
                    deliveryEngineMode: data.deliveryEngineMode || 'legacy',
                    deliveryUseZones: data.deliveryUseZones === true,
                    zoneFallbackToLegacy: data.zoneFallbackToLegacy !== false,
                    deliveryZones: normalizeDeliveryZonesForForm(data.deliveryZones || []),
                    businessCoordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
                };
                setSettings(normalizedSettings);
                setZoneEditorValue(serializeDeliveryZones(normalizedSettings.deliveryZones));
                setZoneEditorError('');
                if (desktopRuntime) {
                    await setOfflineNamespace('owner_delivery_settings', deliverySettingsCacheKey, normalizedSettings);
                }
            } catch (error) {
                let restored = false;
                if (desktopRuntime) {
                    const desktopPayload = await getOfflineNamespace('owner_delivery_settings', deliverySettingsCacheKey, null);
                    if (desktopPayload) {
                        const restoredSettings = {
                            ...desktopPayload,
                            deliveryEngineMode: desktopPayload.deliveryEngineMode || 'legacy',
                            deliveryUseZones: desktopPayload.deliveryUseZones === true,
                            zoneFallbackToLegacy: desktopPayload.zoneFallbackToLegacy !== false,
                            deliveryZones: normalizeDeliveryZonesForForm(desktopPayload.deliveryZones || []),
                            businessCoordinates: desktopPayload.businessCoordinates || null,
                        };
                        setSettings(restoredSettings);
                        setZoneEditorValue(serializeDeliveryZones(restoredSettings.deliveryZones));
                        setZoneEditorError('');
                        restored = true;
                    }
                }
                if (!restored) {
                    setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load settings: ${error.message}` });
                }
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchSettings();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router, impersonatedOwnerId, employeeOfOwnerId, desktopRuntime, deliverySettingsCacheKey]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated.");
            const idToken = await user.getIdToken();

            const toNum = (value, fallback = 0) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : fallback;
            };

            const deliveryUseZones = settings.deliveryUseZones === true;
            const { zones: parsedDeliveryZones, error: parsedDeliveryZoneError } = parseDeliveryZonesEditor(zoneEditorValue);
            if (deliveryUseZones && parsedDeliveryZoneError) {
                throw new Error(parsedDeliveryZoneError);
            }
            if (deliveryUseZones && parsedDeliveryZones.length === 0) {
                throw new Error('Hybrid zone mode is enabled, but no valid delivery zones are configured yet.');
            }

            const autoFittedRadiusKm = deliveryUseZones
                ? getAutoFittedGlobalRadiusKm(
                    settings.businessCoordinates,
                    parsedDeliveryZones,
                    toNum(settings.deliveryRadius[0], 5)
                )
                : toNum(settings.deliveryRadius[0], 5);

            const payload = {
                deliveryEnabled: settings.deliveryEnabled,
                deliveryRadius: autoFittedRadiusKm,
                deliveryFeeType: settings.deliveryFeeType,
                deliveryFixedFee: toNum(settings.deliveryFixedFee, 0),
                deliveryBaseDistance: toNum(settings.deliveryBaseDistance, 0),
                deliveryPerKmFee: toNum(settings.deliveryPerKmFee, 0),
                deliveryFreeThreshold: toNum(settings.deliveryFreeThreshold, 0),
                // NEW: Road factor & free zone
                roadDistanceFactor: toNum(settings.roadDistanceFactor, 1.0),
                freeDeliveryRadius: toNum(settings.freeDeliveryRadius, 0),
                // Keep threshold usable even after switching from "Free Over Amount" mode.
                freeDeliveryMinOrder: settings.deliveryFeeType === 'free-over'
                    ? toNum(settings.deliveryFreeThreshold, 0)
                    : toNum(settings.freeDeliveryMinOrder, 0),
                // NEW: Tiered charges
                deliveryTiers: settings.deliveryTiers.map(t => ({ minOrder: toNum(t.minOrder, 0), fee: toNum(t.fee, 0) })),
                // NEW: Order slab + distance engine
                deliveryOrderSlabRules: normalizeOrderSlabRules(settings.deliveryOrderSlabRules)
                    .map(rule => ({ maxOrder: toNum(rule.maxOrder, 0), fee: toNum(rule.fee, 0) })),
                deliveryOrderSlabAboveFee: toNum(settings.deliveryOrderSlabAboveFee, 0),
                deliveryOrderSlabBaseDistance: Math.max(0, toNum(settings.deliveryOrderSlabBaseDistance, 1)),
                deliveryOrderSlabPerKmFee: Math.max(0, toNum(settings.deliveryOrderSlabPerKmFee, 15)),
                deliveryEngineMode: deliveryUseZones ? 'hybrid-zones' : 'legacy',
                deliveryUseZones,
                zoneFallbackToLegacy: settings.zoneFallbackToLegacy !== false,
                deliveryZones: deliveryUseZones ? parsedDeliveryZones : settings.deliveryZones,
            };

            const queryParams = new URLSearchParams();
            if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
            if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
            const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

            const response = await fetch(`/api/owner/delivery-settings${queryString}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save settings');
            }

                setSettings(prev => ({
                    ...prev,
                    deliveryRadius: [payload.deliveryRadius],
                    deliveryEngineMode: payload.deliveryEngineMode,
                    deliveryUseZones: payload.deliveryUseZones,
                    zoneFallbackToLegacy: payload.zoneFallbackToLegacy,
                    deliveryZones: payload.deliveryZones,
                    businessCoordinates: prev.businessCoordinates || null,
                }));
            setZoneEditorValue(serializeDeliveryZones(payload.deliveryZones));
            setZoneEditorError('');
            if (desktopRuntime) {
                await setOfflineNamespace('owner_delivery_settings', deliverySettingsCacheKey, {
                    ...settings,
                    deliveryEngineMode: payload.deliveryEngineMode,
                    deliveryUseZones: payload.deliveryUseZones,
                    zoneFallbackToLegacy: payload.zoneFallbackToLegacy,
                    deliveryZones: payload.deliveryZones,
                    businessCoordinates: settings.businessCoordinates || null,
                });
            }
            setInfoDialog({
                isOpen: true,
                title: 'Success',
                message: deliveryUseZones
                    ? `Delivery settings saved successfully! The global radius was auto-fitted to ${payload.deliveryRadius} km.`
                    : 'Delivery settings saved successfully!'
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not save settings: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSettingChange = (key, value) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };

            // Keep threshold value shared between:
            // 1) Main engine "Free Over Amount"
            // 2) Bonus override "Min Order for Free Delivery"
            if (key === 'deliveryFreeThreshold') {
                const unifiedValue = Number(value) || 0;
                next.deliveryFreeThreshold = unifiedValue;
                next.freeDeliveryMinOrder = unifiedValue;
            }

            if (key === 'freeDeliveryMinOrder') {
                const unifiedValue = Number(value) || 0;
                next.freeDeliveryMinOrder = unifiedValue;
                next.deliveryFreeThreshold = unifiedValue;
            }

            // If user switches to free-over mode and threshold is empty,
            // prefill it from already configured global min-order.
            if (key === 'deliveryFeeType' && value === 'free-over' && (Number(prev.deliveryFreeThreshold) || 0) <= 0) {
                next.deliveryFreeThreshold = Number(prev.freeDeliveryMinOrder) || 0;
            }

            if (key === 'deliveryFeeType' && value === 'order-slab-distance') {
                next.deliveryOrderSlabRules = normalizeOrderSlabRules(prev.deliveryOrderSlabRules);
                next.deliveryOrderSlabBaseDistance = Number(prev.deliveryOrderSlabBaseDistance) > 0
                    ? Number(prev.deliveryOrderSlabBaseDistance)
                    : 1;
                next.deliveryOrderSlabPerKmFee = Number(prev.deliveryOrderSlabPerKmFee) >= 0
                    ? Number(prev.deliveryOrderSlabPerKmFee)
                    : 15;
            }

            if (key === 'deliveryUseZones') {
                next.deliveryUseZones = value === true;
                next.deliveryEngineMode = value === true ? 'hybrid-zones' : 'legacy';
            }

            return next;
        });
    }

    const applyZonesToState = (zones = []) => {
        const normalizedZones = normalizeDeliveryZonesForForm(zones);
        setSettings(prev => ({ ...prev, deliveryZones: normalizedZones }));
        setZoneEditorValue(serializeDeliveryZones(normalizedZones));
        setZoneEditorError('');
        if (zoneDraft?.zone_id && !normalizedZones.some((zone) => zone.zone_id === zoneDraft.zone_id)) {
            setIsZoneDetailsOpen(false);
            setZoneDraft(null);
        }
    };

    const openZoneDetailsEditor = (zoneOrId) => {
        const selectedZone = typeof zoneOrId === 'string'
            ? settings.deliveryZones.find((zone) => zone.zone_id === zoneOrId)
            : zoneOrId;

        if (!selectedZone) return;

        const zoneIndex = settings.deliveryZones.findIndex((zone) => zone.zone_id === selectedZone.zone_id);
        setZoneDraft(buildZoneDraft(selectedZone, zoneIndex >= 0 ? zoneIndex : 0));
        if (isZoneStudioOpen) {
            setResumeZoneStudioAfterEdit(true);
            setIsZoneStudioOpen(false);
        } else {
            setResumeZoneStudioAfterEdit(false);
        }
        setIsZoneDetailsOpen(true);
    };

    const closeZoneDetailsEditor = (open) => {
        setIsZoneDetailsOpen(open);
        if (!open) {
            setZoneDraft(null);
            if (resumeZoneStudioAfterEdit) {
                setIsZoneStudioOpen(true);
                setResumeZoneStudioAfterEdit(false);
            }
        }
    };

    const handleZoneDraftChange = (field, value) => {
        setZoneDraft((prev) => {
            if (!prev) return prev;
            if (field === 'status') {
                return { ...prev, status: value === 'blocked' ? 'blocked' : 'active' };
            }
            return { ...prev, [field]: value };
        });
    };

    const handleSaveZoneDetails = () => {
        if (!zoneDraft?.zone_id) return;

        const normalizedName = String(zoneDraft.name || '').trim();
        if (!normalizedName) {
            setInfoDialog({ isOpen: true, title: 'Zone Name Required', message: 'Please add a zone name before saving zone details.' });
            return;
        }

        const priority = Number(zoneDraft.priority);
        const baseFee = Number(zoneDraft.deliveryFee);
        const isBlocked = zoneDraft.status === 'blocked';

        const nextZones = settings.deliveryZones.map((zone, index) => {
            if (zone.zone_id !== zoneDraft.zone_id) return zone;

            return {
                ...zone,
                name: normalizedName,
                priority: Number.isFinite(priority) ? priority : index,
                is_active: true,
                is_blocked: isBlocked,
                baseFee: Number.isFinite(baseFee) ? baseFee : 0,
                color: String(zoneDraft.color || zone.color || ZONE_COLOR_OPTIONS[index % ZONE_COLOR_OPTIONS.length]).trim() || ZONE_COLOR_OPTIONS[0],
            };
        });

        applyZonesToState(nextZones);
        setIsZoneDetailsOpen(false);
        setZoneDraft(null);
        if (resumeZoneStudioAfterEdit) {
            setIsZoneStudioOpen(true);
            setResumeZoneStudioAfterEdit(false);
        }
    };

    const handleNewZoneCreated = (zone) => {
        if (!zone) return;
        const zoneIndex = Array.isArray(settings.deliveryZones) ? settings.deliveryZones.length : 0;
        setZoneDraft(buildZoneDraft(zone, zoneIndex));
        setIsZoneDetailsOpen(true);
    };

    const handleApplyZoneJson = () => {
        const { zones, error } = parseDeliveryZonesEditor(zoneEditorValue);
        if (error) {
            setZoneEditorError(error);
            return;
        }
        applyZonesToState(zones);
    };

    const handleLoadSampleZones = () => {
        applyZonesToState(DEFAULT_ZONE_SAMPLE);
        setSettings(prev => ({
            ...prev,
            deliveryUseZones: true,
            deliveryEngineMode: 'hybrid-zones',
        }));
    };

    const handleFormatZoneJson = () => {
        const { zones, error } = parseDeliveryZonesEditor(zoneEditorValue);
        if (error) {
            setZoneEditorError(error);
            return;
        }
        setZoneEditorValue(serializeDeliveryZones(zones));
        setZoneEditorError('');
    };

    const handleClearZones = () => {
        applyZonesToState([]);
    };

    const addTier = () => {
        setSettings(prev => ({
            ...prev,
            deliveryTiers: [...prev.deliveryTiers, { minOrder: 0, fee: 0 }]
        }));
    };

    const removeTier = (index) => {
        setSettings(prev => ({
            ...prev,
            deliveryTiers: prev.deliveryTiers.filter((_, i) => i !== index)
        }));
    };

    const updateTier = (index, field, value) => {
        setSettings(prev => {
            const newTiers = [...prev.deliveryTiers];
            newTiers[index] = { ...newTiers[index], [field]: value };
            return { ...prev, deliveryTiers: newTiers };
        });
    };

    const updateOrderSlabRule = (index, field, value) => {
        setSettings(prev => {
            const normalizedRules = normalizeOrderSlabRules(prev.deliveryOrderSlabRules);
            normalizedRules[index] = {
                ...normalizedRules[index],
                [field]: value
            };

            if (field === 'maxOrder' && index === 1) {
                const firstMax = Number(normalizedRules[0]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[0].maxOrder;
                if ((Number(normalizedRules[1]?.maxOrder) || 0) <= firstMax) {
                    normalizedRules[1].maxOrder = firstMax + 1;
                }
            }

            if (field === 'maxOrder' && index === 0) {
                const firstMax = Number(normalizedRules[0]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[0].maxOrder;
                const secondMax = Number(normalizedRules[1]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[1].maxOrder;
                if (secondMax <= firstMax) {
                    normalizedRules[1].maxOrder = firstMax + 1;
                }
            }

            return { ...prev, deliveryOrderSlabRules: normalizedRules };
        });
    };

    const zoneSummary = useMemo(() => {
        const zones = Array.isArray(settings.deliveryZones) ? settings.deliveryZones : [];
        return {
            total: zones.length,
            blocked: zones.filter((zone) => zone.is_blocked === true).length,
            tiers: zones.reduce((count, zone) => count + (Array.isArray(zone.pricingTiers) ? zone.pricingTiers.length : 0), 0),
            points: zones.reduce((count, zone) => count + (Array.isArray(zone.boundary) ? zone.boundary.length : 0), 0),
        };
    }, [settings.deliveryZones]);

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }

    const orderSlabRules = normalizeOrderSlabRules(settings.deliveryOrderSlabRules);
    const firstOrderSlab = orderSlabRules[0] || DEFAULT_ORDER_SLAB_RULES[0];
    const secondOrderSlab = orderSlabRules[1] || DEFAULT_ORDER_SLAB_RULES[1];
    const sampleDistanceForSlabMode = Number(settings.deliveryOrderSlabBaseDistance || 1) + 2;
    const extraSampleKm = Math.max(0, sampleDistanceForSlabMode - Number(settings.deliveryOrderSlabBaseDistance || 1));
    const sampleSlabBase = Number(firstOrderSlab.fee || 0);
    const sampleSlabCharge = sampleSlabBase + (extraSampleKm * Number(settings.deliveryOrderSlabPerKmFee || 0));
    const isOverrideEngineLocked =
        settings.deliveryFeeType === 'tiered' ||
        settings.deliveryFeeType === 'order-slab-distance';

    return (
        <div className="p-4 md:p-8 space-y-8 max-w-5xl mx-auto pb-24">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <Dialog open={isZoneStudioOpen} onOpenChange={setIsZoneStudioOpen}>
                <DialogContent className="w-[96vw] max-w-[96vw] h-[94vh] p-0 overflow-hidden sm:rounded-2xl">
                    <div className="flex h-full flex-col">
                        <DialogHeader className="border-b px-6 py-5 pr-14">
                            <DialogTitle className="flex items-center gap-2 text-xl">
                                <MapIcon className="h-5 w-5 text-primary" />
                                Fullscreen Zone Studio
                            </DialogTitle>
                            <DialogDescription>
                                Pick a pen color, draw a polygon, then click the created zone or its card to edit name, priority, delivery status, and delivery fee.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto px-6 py-5">
                            <DeliveryZoneMapEditor
                                center={settings.businessCoordinates || DEFAULT_MAP_CENTER}
                                deliveryRadiusKm={Number(settings.deliveryRadius?.[0]) || 5}
                                zones={settings.deliveryZones}
                                onZonesChange={applyZonesToState}
                                onZoneCreated={handleNewZoneCreated}
                                onZoneSelect={openZoneDetailsEditor}
                                onValidationError={(message) => setInfoDialog({ isOpen: true, title: 'Polygon Outside Radius', message })}
                                selectedZoneId={zoneDraft?.zone_id || null}
                                heightClass="h-[68vh]"
                            />
                        </div>

                        <DialogFooter className="border-t px-6 py-4">
                            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span className="rounded-full border px-3 py-1">Zones: {zoneSummary.total}</span>
                                    <span className="rounded-full border px-3 py-1">Blocked: {zoneSummary.blocked}</span>
                                    <span className="rounded-full border px-3 py-1">Points: {zoneSummary.points}</span>
                                </div>
                                <Button type="button" variant="outline" onClick={() => setIsZoneStudioOpen(false)}>
                                    Close Studio
                                </Button>
                            </div>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isZoneDetailsOpen} onOpenChange={closeZoneDetailsEditor}>
                <DialogContent className="sm:max-w-xl z-[1200]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PencilLine className="h-4 w-4 text-primary" />
                            Edit Zone Details
                        </DialogTitle>
                        <DialogDescription>
                            Update the business rules attached to this polygon. Shape editing stays inside the map studio.
                        </DialogDescription>
                    </DialogHeader>

                    {zoneDraft && (
                        <div className="space-y-5">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="zone-name">Zone Name</Label>
                                    <Input
                                        id="zone-name"
                                        value={zoneDraft.name}
                                        onChange={(e) => handleZoneDraftChange('name', e.target.value)}
                                        placeholder="Zone 1"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="zone-priority">Priority</Label>
                                    <Input
                                        id="zone-priority"
                                        type="number"
                                        value={zoneDraft.priority}
                                        onChange={(e) => handleZoneDraftChange('priority', e.target.value)}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="zone-base-fee">Delivery Fee</Label>
                                    <Input
                                        id="zone-base-fee"
                                        type="number"
                                        value={zoneDraft.deliveryFee}
                                        onChange={(e) => handleZoneDraftChange('deliveryFee', e.target.value)}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="zone-id">Zone ID</Label>
                                    <Input id="zone-id" value={zoneDraft.zone_id} readOnly className="bg-muted/40" />
                                </div>
                            </div>

                            <div className="space-y-3 rounded-2xl border p-4">
                                <div>
                                    <p className="font-semibold">Zone Status</p>
                                    <p className="text-xs text-muted-foreground">Each polygon either allows delivery or blocks it entirely.</p>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button
                                        type="button"
                                        variant={zoneDraft.status === 'active' ? 'default' : 'outline'}
                                        className="justify-start rounded-xl"
                                        onClick={() => handleZoneDraftChange('status', 'active')}
                                    >
                                        Active
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={zoneDraft.status === 'blocked' ? 'destructive' : 'outline'}
                                        className="justify-start rounded-xl"
                                        onClick={() => handleZoneDraftChange('status', 'blocked')}
                                    >
                                        Blocked
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Palette className="h-4 w-4 text-primary" />
                                    <Label>Zone Color</Label>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    {ZONE_COLOR_OPTIONS.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => handleZoneDraftChange('color', color)}
                                            className={cn(
                                                'h-10 w-10 rounded-full border-2 transition-transform hover:scale-105',
                                                zoneDraft.color === color ? 'border-foreground scale-105' : 'border-border'
                                            )}
                                            style={{ backgroundColor: color }}
                                            aria-label={`Use ${color} zone color`}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => closeZoneDetailsEditor(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleSaveZoneDetails}>
                            Save Zone Details
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full hover:bg-muted">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                            Delivery Settings
                        </h1>
                        <p className="text-muted-foreground mt-1 font-medium">Configure how you deliver to your customers.</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                    <OfflineDesktopStatus />
                    <div className="flex items-center gap-3 px-4 py-3 bg-card border rounded-2xl shadow-sm">
                    <div className="flex flex-col">
                        <span className="text-sm font-bold">Accepting Orders</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                            {settings.deliveryEnabled ? 'Active' : 'Paused'}
                        </span>
                    </div>
                    <Switch
                        checked={settings.deliveryEnabled}
                        onCheckedChange={(val) => handleSettingChange('deliveryEnabled', val)}
                        className="data-[state=checked]:bg-green-500 scale-110 ml-2"
                    />
                    </div>
                </div>
            </header>

            {/* SECTION 1: CORE LOGISTICS */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <Card className="overflow-hidden border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 pb-8">
                        <CardTitle className="flex items-center gap-3 text-xl">
                            <div className="p-2 bg-primary/10 rounded-xl">
                                <MapIcon className="h-5 w-5 text-primary" />
                            </div>
                            Core Logistics
                        </CardTitle>
                        <CardDescription className="text-base">Define your reach and road adjustments.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 -mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            {/* Radius Slider */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Delivery Radius
                                        <span className="text-xs text-muted-foreground font-medium italic">Max distance for delivery</span>
                                    </Label>
                                    <span className="text-2xl font-black text-primary">{settings.deliveryRadius[0]} <small className="text-sm font-bold">km</small></span>
                                </div>
                                <Slider
                                    value={settings.deliveryRadius}
                                    onValueChange={(val) => handleSettingChange('deliveryRadius', val)}
                                    max={30}
                                    step={1}
                                    className="py-4"
                                />
                            </div>

                            {/* Road Factor Slider */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Road Adjustment
                                        <span className="text-xs text-muted-foreground font-medium italic">Multiplier for road turns</span>
                                    </Label>
                                    <span className="text-2xl font-black text-primary">{settings.roadDistanceFactor.toFixed(1)} <small className="text-sm font-bold">x</small></span>
                                </div>
                                <Slider
                                    value={[settings.roadDistanceFactor]}
                                    onValueChange={(val) => handleSettingChange('roadDistanceFactor', val[0])}
                                    min={1.0}
                                    max={2.0}
                                    step={0.1}
                                    className="py-4"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
                <Card className="overflow-hidden border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 pb-8">
                        <CardTitle className="flex items-center gap-3 text-xl">
                            <div className="p-2 bg-primary/10 rounded-xl">
                                <MapIcon className="h-5 w-5 text-primary" />
                            </div>
                            Hybrid Geofencing
                        </CardTitle>
                        <CardDescription className="text-base">
                            Layer global radius, mapped zones, and zone-level pricing without relying on external distance APIs.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 -mt-6 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="rounded-2xl border bg-card p-5 space-y-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <Label className="text-base font-bold">Enable Hybrid Zone Engine</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Global radius stays as the first filter. Matching zones then decide pricing or blocking.
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            When you click Apply Settings, the system also auto-optimizes the global radius to fit the active polygons.
                                        </p>
                                    </div>
                                    <Switch
                                        checked={settings.deliveryUseZones}
                                        onCheckedChange={(val) => handleSettingChange('deliveryUseZones', val)}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <Label className="text-sm font-bold">Outside Polygon Orders</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            If an order is inside the global radius but outside every polygon, either apply fallback pricing or reject it.
                                        </p>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Button
                                            type="button"
                                            variant={settings.zoneFallbackToLegacy ? 'default' : 'outline'}
                                            disabled={!settings.deliveryUseZones}
                                            className="justify-start rounded-xl"
                                            onClick={() => handleSettingChange('zoneFallbackToLegacy', true)}
                                        >
                                            Fallback Pricing
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={!settings.zoneFallbackToLegacy ? 'destructive' : 'outline'}
                                            disabled={!settings.deliveryUseZones}
                                            className="justify-start rounded-xl"
                                            onClick={() => handleSettingChange('zoneFallbackToLegacy', false)}
                                        >
                                            Reject Outside
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-2xl border bg-card p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Zones</p>
                                    <p className="text-3xl font-black text-primary mt-2">{zoneSummary.total}</p>
                                </div>
                                <div className="rounded-2xl border bg-card p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Blocked</p>
                                    <p className="text-3xl font-black text-destructive mt-2">{zoneSummary.blocked}</p>
                                </div>
                                <div className="rounded-2xl border bg-card p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Pricing Tiers</p>
                                    <p className="text-3xl font-black text-primary mt-2">{zoneSummary.tiers}</p>
                                </div>
                                <div className="rounded-2xl border bg-card p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Boundary Points</p>
                                    <p className="text-3xl font-black text-primary mt-2">{zoneSummary.points}</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <Label className="text-base font-bold">Visual Zone Drawing Tool</Label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">
                                            Open studio, pick pen color, then draw
                                        </span>
                                        <Button type="button" onClick={() => setIsZoneStudioOpen(true)} className="gap-2">
                                            <Maximize2 className="h-4 w-4" />
                                            Fullscreen Zone Studio
                                        </Button>
                                    </div>
                                </div>
                                {isZoneStudioOpen ? (
                                    <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                                        Fullscreen studio open hai, isliye niche wala preview map temporarily hide kiya gaya hai taaki Leaflet controls overlap na karein.
                                    </div>
                                ) : (
                                    <>
                                        <DeliveryZoneMapEditor
                                            center={settings.businessCoordinates || DEFAULT_MAP_CENTER}
                                            deliveryRadiusKm={Number(settings.deliveryRadius?.[0]) || 5}
                                            zones={settings.deliveryZones}
                                            onZonesChange={applyZonesToState}
                                            selectedZoneId={zoneDraft?.zone_id || null}
                                            onZoneSelect={openZoneDetailsEditor}
                                            onValidationError={(message) => setInfoDialog({ isOpen: true, title: 'Polygon Outside Radius', message })}
                                            readOnly
                                            heightClass="h-[320px]"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Preview only here. Drawing, shape editing, delete mode, and pen color selection all happen inside the fullscreen studio.
                                        </p>
                                    </>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <Button type="button" variant="outline" onClick={handleLoadSampleZones}>
                                    Load Sample Zone
                                </Button>
                                <Button type="button" variant="outline" onClick={handleFormatZoneJson}>
                                    Format JSON
                                </Button>
                                <Button type="button" variant="outline" onClick={handleApplyZoneJson}>
                                    Apply JSON
                                </Button>
                                <Button type="button" variant="ghost" onClick={handleClearZones} className="text-destructive hover:text-destructive">
                                    Clear Zones
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-base font-bold">Delivery Zone JSON</Label>
                                <p className="text-xs text-muted-foreground">
                                    Paste an array of zones using `boundary: [[lat, lng], ...]` and optional `pricingTiers`.
                                </p>
                                <Textarea
                                    value={zoneEditorValue}
                                    onChange={(e) => {
                                        setZoneEditorValue(e.target.value);
                                        if (zoneEditorError) setZoneEditorError('');
                                    }}
                                    className="min-h-[320px] font-mono text-xs"
                                    placeholder='[{"zone_id":"SEC_62_NOIDA","name":"Noida Sector 62","boundary":[[28.628,77.361],[28.629,77.372],[28.621,77.377]],"pricingTiers":[{"minOrder":0,"maxOrder":200,"deliveryFee":50}]}]'
                                />
                                {zoneEditorError && (
                                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                        {zoneEditorError}
                                    </div>
                                )}
                            </div>

                            {settings.deliveryZones.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {settings.deliveryZones.map((zone, index) => (
                                        <div
                                            key={zone.zone_id || index}
                                            className={cn(
                                                'rounded-2xl border bg-muted/20 p-4 space-y-3 transition-colors',
                                                zoneDraft?.zone_id === zone.zone_id ? 'border-primary bg-primary/5' : 'border-border'
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-3">
                                                    <span
                                                        className="mt-1 h-3.5 w-3.5 rounded-full border border-white/40"
                                                        style={{ backgroundColor: zone.color || ZONE_COLOR_OPTIONS[index % ZONE_COLOR_OPTIONS.length] }}
                                                    />
                                                    <div>
                                                        <p className="font-bold">{zone.name || `Zone ${index + 1}`}</p>
                                                        <p className="text-xs text-muted-foreground">{zone.zone_id || `zone_${index + 1}`}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right text-xs space-y-1">
                                                    <p className={cn('font-bold', zone.is_blocked ? 'text-destructive' : 'text-green-600')}>
                                                        {zone.is_blocked ? 'Blocked' : 'Active'}
                                                    </p>
                                                    <p className="text-muted-foreground">{Array.isArray(zone.boundary) ? zone.boundary.length : 0} points</p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                                                <p>
                                                    Delivery fee: {Number.isFinite(Number(zone.baseFee)) ? `Rs ${Number(zone.baseFee)}` : 'Use legacy fee'}
                                                </p>
                                                <p>
                                                    Priority: {Number.isFinite(Number(zone.priority)) ? Number(zone.priority) : index}
                                                </p>
                                                <p>
                                                    Pricing tiers: {Array.isArray(zone.pricingTiers) ? zone.pricingTiers.length : 0}
                                                </p>
                                                <p>Applies only inside this polygon</p>
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <p className="text-[11px] text-muted-foreground">
                                                    Click edit to manage `name`, `priority`, `status`, and `deliveryFee`.
                                                </p>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-2"
                                                    onClick={() => openZoneDetailsEditor(zone)}
                                                >
                                                    <PencilLine className="h-3.5 w-3.5" />
                                                    Edit
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* STEP 1: CHARGING ENGINE */}
            <div className="space-y-6">
                <div className="flex items-center gap-3 px-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white font-black text-sm shadow-lg shadow-primary/20">1</div>
                    <div className="flex flex-col">
                        <h2 className="text-xl font-bold tracking-tight">Main Charging Engine</h2>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Select one primary method</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {[
                        { id: 'fixed', label: 'Fixed Fee', icon: <IndianRupee className="h-5 w-5" />, desc: 'Simple flat rate' },
                        { id: 'per-km', label: 'Distance Based', icon: <Truck className="h-5 w-5" />, desc: 'Pay per Kilometre' },
                        { id: 'free-over', label: 'Free Over Amount', icon: <ToggleRight className="h-5 w-5" />, desc: 'Free for large orders' },
                        { id: 'tiered', label: 'Tiered Charges', icon: <Settings className="h-5 w-5" />, desc: 'Advanced rules' },
                        { id: 'order-slab-distance', label: 'Order Slab + KM', icon: <Truck className="h-5 w-5" />, desc: 'Amount slab + extra KM' }
                    ].map((strat) => {
                        const isActive = settings.deliveryFeeType === strat.id;
                        return (
                            <button
                                key={strat.id}
                                onClick={() => handleSettingChange('deliveryFeeType', strat.id)}
                                className={cn(
                                    "flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all duration-500 group relative overflow-hidden",
                                    isActive
                                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                        : "border-border bg-muted/20 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 hover:border-primary/40 hover:bg-muted/50"
                                )}
                            >
                                <div className="flex justify-between items-start w-full mb-3">
                                    <div className={cn(
                                        "p-2.5 rounded-xl transition-all duration-500",
                                        isActive ? "bg-primary text-white scale-110" : "bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary"
                                    )}>
                                        {strat.icon}
                                    </div>
                                    <Switch
                                        checked={isActive}
                                        onCheckedChange={() => handleSettingChange('deliveryFeeType', strat.id)}
                                        className="scale-75 data-[state=checked]:bg-primary"
                                    />
                                </div>

                                <span className={cn(
                                    "font-bold text-sm leading-tight mb-1 transition-colors",
                                    isActive ? "text-foreground" : "text-muted-foreground"
                                )}>
                                    {strat.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-medium leading-normal">
                                    {strat.desc}
                                </span>

                                {isActive && (
                                    <motion.div
                                        layoutId="active-glow"
                                        className="absolute inset-0 bg-primary/5 pointer-events-none"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* DYNAMIC CONFIG AREA */}
                <motion.div
                    key={settings.deliveryFeeType}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="min-h-[160px]"
                >
                    <Card className="border-2 border-primary/20 shadow-sm bg-card/50 backdrop-blur-sm">
                        <CardContent className="p-8">
                            {settings.deliveryFeeType === 'fixed' && (
                                <div className="max-w-md mx-auto space-y-4 text-center">
                                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Flat Fee Setup</p>
                                    <div className="flex items-center justify-center gap-4">
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-xl opacity-50">₹</span>
                                            <Input
                                                type="number"
                                                className="h-16 pl-10 pr-6 text-3xl font-black rounded-2xl border-2 w-48 text-center"
                                                value={settings.deliveryFixedFee}
                                                onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-sm font-medium text-muted-foreground mt-4 italic">Customers will always be charged ₹{settings.deliveryFixedFee} per order.</p>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'per-km' && (
                                <div className="max-w-2xl mx-auto space-y-8">
                                    <div className="text-center space-y-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Hybrid Distance Pricing</p>
                                        <p className="text-xs text-muted-foreground">Set a base fare for a minimum distance, then a rate per KM.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {/* Base Fare */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 1: Base Fare</Label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-10 pr-4 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryFixedFee}
                                                    onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                                />
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Minimum order fee</p>
                                        </div>

                                        {/* Included Distance */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 2: Included KM</Label>
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-4 pr-12 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryBaseDistance}
                                                    onChange={e => handleSettingChange('deliveryBaseDistance', e.target.value)}
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-sm opacity-50 text-muted-foreground">KM</span>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Distance covered by Base Fare</p>
                                        </div>

                                        {/* Thereafter Rate */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 3: Thereafter</Label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-10 pr-12 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryPerKmFee}
                                                    onChange={e => handleSettingChange('deliveryPerKmFee', e.target.value)}
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-primary text-xs">/km</span>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Charge for extra distance</p>
                                        </div>
                                    </div>

                                    {/* LIVE PREVIEW BOX */}
                                    <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                                            <Truck className="h-12 w-12 text-primary" />
                                        </div>
                                        <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-3">Simulated Breakdown:</h4>
                                        <div className="space-y-1 text-sm">
                                            <p className="font-medium">
                                                • Customer at <span className="text-primary font-bold">{Number(settings.deliveryBaseDistance) || 0}km</span> pays <span className="text-primary font-bold">₹{settings.deliveryFixedFee || 0}</span>
                                            </p>
                                            <p className="font-medium">
                                                • Customer at <span className="text-primary font-bold">{(Number(settings.deliveryBaseDistance) || 0) + 2}km</span> pays <span className="text-primary font-bold">₹{(Number(settings.deliveryFixedFee) || 0) + (2 * (Number(settings.deliveryPerKmFee) || 0))}</span>
                                            </p>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-primary/10">
                                            <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                                                Formula: ₹{settings.deliveryFixedFee || 0} Base + (Total KM - {settings.deliveryBaseDistance || 0}KM) × ₹{settings.deliveryPerKmFee || 0}/KM
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'order-slab-distance' && (
                                <div className="max-w-4xl mx-auto space-y-8">
                                    <div className="text-center space-y-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Order Slab + Distance Pricing</p>
                                        <p className="text-xs text-muted-foreground">
                                            First {settings.deliveryOrderSlabBaseDistance || 1}km gets amount-based base fare, then add per-km fee.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Order Under</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={firstOrderSlab.maxOrder}
                                                        onChange={(e) => updateOrderSlabRule(0, 'maxOrder', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={firstOrderSlab.fee}
                                                        onChange={(e) => updateOrderSlabRule(0, 'fee', Number(e.target.value))}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">e.g. Under Rs {firstOrderSlab.maxOrder} to Rs {firstOrderSlab.fee}</p>
                                        </div>

                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Order Under</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={secondOrderSlab.maxOrder}
                                                        onChange={(e) => updateOrderSlabRule(1, 'maxOrder', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={secondOrderSlab.fee}
                                                        onChange={(e) => updateOrderSlabRule(1, 'fee', Number(e.target.value))}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">e.g. Under Rs {secondOrderSlab.maxOrder} to Rs {secondOrderSlab.fee}</p>
                                        </div>

                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Above Second Slab</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={settings.deliveryOrderSlabAboveFee}
                                                        onChange={(e) => handleSettingChange('deliveryOrderSlabAboveFee', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="relative">
                                                        <Input
                                                            type="number"
                                                            className="h-11 pr-10 text-lg font-bold rounded-xl text-center"
                                                            value={settings.deliveryOrderSlabBaseDistance}
                                                            onChange={(e) => handleSettingChange('deliveryOrderSlabBaseDistance', Number(e.target.value))}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">km</span>
                                                    </div>
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                        <Input
                                                            type="number"
                                                            className="h-11 pl-8 pr-10 text-lg font-bold rounded-xl text-center"
                                                            value={settings.deliveryOrderSlabPerKmFee}
                                                            onChange={(e) => handleSettingChange('deliveryOrderSlabPerKmFee', Number(e.target.value))}
                                                        />
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary">/km</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Base for first {settings.deliveryOrderSlabBaseDistance || 1}km, then Rs {settings.deliveryOrderSlabPerKmFee || 0}/km</p>
                                        </div>
                                    </div>

                                    <div className="bg-primary/5 border border-primary/10 rounded-2xl p-5">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-2">Sample Preview</h4>
                                        <p className="text-sm font-medium">
                                            Under Rs {firstOrderSlab.maxOrder} and {settings.deliveryOrderSlabBaseDistance || 1}km: Rs {sampleSlabBase}
                                        </p>
                                        <p className="text-sm font-medium">
                                            Under Rs {firstOrderSlab.maxOrder} and {sampleDistanceForSlabMode}km: Rs {sampleSlabCharge}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'free-over' && (
                                <div className="max-w-md mx-auto space-y-4 text-center">
                                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Threshold Setup</p>
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-muted-foreground">Free delivery for orders above</span>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-12 pl-8 pr-4 text-xl font-black rounded-xl border-2 w-32 text-center"
                                                    value={settings.deliveryFreeThreshold}
                                                    onChange={e => handleSettingChange('deliveryFreeThreshold', Number(e.target.value))}
                                                />
                                            </div>
                                        </div>
                                        <div className="w-full h-px bg-border my-2" />
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-muted-foreground">Otherwise, charge</span>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-12 pl-8 pr-4 text-xl font-black rounded-xl border-2 w-28 text-center"
                                                    value={settings.deliveryFixedFee}
                                                    onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-sm font-medium text-muted-foreground mt-4 italic">Standard fee applies for small orders. This threshold is shared with Bonus Min Order and works for Fixed/Distance modes too.</p>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'tiered' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Order Value Rules</p>
                                        <Button onClick={addTier} variant="outline" size="sm" className="rounded-full border-primary/40 text-primary font-bold hover:bg-primary/5">
                                            + Add New Rule
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {settings.deliveryTiers.length === 0 && (
                                            <div className="col-span-full py-12 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center text-muted-foreground">
                                                <Settings className="h-10 w-10 opacity-20 mb-3" />
                                                <p className="font-semibold italic">No rules defined yet.</p>
                                                <Button variant="link" onClick={addTier} className="text-xs">Create your first rule</Button>
                                            </div>
                                        )}
                                        {settings.deliveryTiers.map((tier, index) => (
                                            <motion.div
                                                layout
                                                initial={{ scale: 0.95, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                key={index}
                                                className="relative p-5 rounded-2xl bg-muted/40 border-2 border-border shadow-sm group"
                                            >
                                                <button
                                                    onClick={() => removeTier(index)}
                                                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </button>

                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-tighter">If Order Amount ≥</Label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                            <Input
                                                                type="number"
                                                                className="h-10 pl-7 text-lg font-bold rounded-xl"
                                                                value={tier.minOrder}
                                                                onChange={(e) => updateTier(index, 'minOrder', e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-tighter">Delivery Charge</Label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                            <Input
                                                                type="number"
                                                                className={cn(
                                                                    "h-10 pl-7 text-lg font-bold rounded-xl",
                                                                    Number(tier.fee) === 0 ? "text-green-500 border-green-500/50 bg-green-500/5" : ""
                                                                )}
                                                                value={tier.fee}
                                                                onChange={(e) => updateTier(index, 'fee', e.target.value)}
                                                            />
                                                            {Number(tier.fee) === 0 && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-green-500">Free</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground text-center font-medium italic mt-4">
                                        💡 Tips: Add multiple tiers (e.g., ₹0-200: ₹40, ₹200-500: ₹20, Above ₹500: Free)
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* VISUAL CONNECTOR */}
            <div className="flex flex-col items-center py-4 opacity-20">
                <div className="w-px h-12 bg-gradient-to-b from-primary to-transparent" />
                <Settings className="h-4 w-4 text-primary animate-pulse" />
            </div>

            {/* STEP 2: GLOBAL OVERRIDES */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className={cn(
                    "transition-all duration-500",
                    isOverrideEngineLocked ? "opacity-40 grayscale pointer-events-none" : "opacity-100"
                )}
            >
                <div className="flex items-center gap-3 px-1 mb-6">
                    <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full font-black text-sm shadow-lg transition-colors",
                        isOverrideEngineLocked ? "bg-muted text-muted-foreground" : "bg-green-500 text-white shadow-green-500/20"
                    )}>2</div>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold tracking-tight">Bonus Overrides</h2>
                            {isOverrideEngineLocked && (
                                <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-black uppercase text-muted-foreground border">
                                    Disabled in Current Mode
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Global rules that skip the base fee</p>
                    </div>
                </div>

                <Card className={cn(
                    "border-2 shadow-sm overflow-hidden transition-colors",
                    isOverrideEngineLocked ? "border-muted" : "border-green-500/20"
                )}>
                    <CardHeader className={cn(
                        "transition-colors",
                        isOverrideEngineLocked ? "bg-muted/10" : "bg-green-500/5 border-b border-green-500/10"
                    )}>
                        <CardTitle className={cn(
                            "flex items-center gap-3 text-xl transition-colors",
                            isOverrideEngineLocked ? "text-muted-foreground" : "text-green-600 dark:text-green-400"
                        )}>
                            <div className={cn(
                                "p-2 rounded-xl transition-colors",
                                isOverrideEngineLocked ? "bg-muted/20" : "bg-green-500/10"
                            )}>
                                <Truck className="h-5 w-5" />
                            </div>
                            Fast & Free Zone
                        </CardTitle>
                        <CardDescription className="text-base">
                            {isOverrideEngineLocked
                                ? "Current engine already handles complete delivery logic. Global overrides are disabled."
                                : "Reward nearby or big orders with zero delivery fees."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            {/* RADIUS OVERRIDE */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Free Within Radius
                                        <span className="text-xs text-muted-foreground font-medium italic">Apply zero fee if distance ≤ radius</span>
                                    </Label>
                                    <span className={cn(
                                        "text-2xl font-black",
                                        settings.freeDeliveryRadius > 0 ? "text-green-500" : "text-muted-foreground opacity-40"
                                    )}>
                                        {settings.freeDeliveryRadius} <small className="text-xs font-bold uppercase tracking-widest">km</small>
                                    </span>
                                </div>
                                <Slider
                                    value={[settings.freeDeliveryRadius]}
                                    onValueChange={(val) => handleSettingChange('freeDeliveryRadius', val[0])}
                                    min={0}
                                    max={settings.deliveryRadius[0]}
                                    step={0.5}
                                    className="py-4"
                                />
                            </div>

                            {/* MIN ORDER OVERRIDE */}
                            <div className="space-y-6">
                                <Label className="text-base font-bold flex flex-col gap-1">
                                    Min Order for Free Delivery
                                    <span className="text-xs text-muted-foreground font-medium italic">Global threshold to skip all fees (shared with Free Over Amount)</span>
                                </Label>
                                <div className="relative group max-w-[200px]">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-xl text-muted-foreground group-focus-within:text-green-500 transition-colors">₹</span>
                                    <Input
                                        type="number"
                                        className="h-14 pl-10 pr-4 text-2xl font-black rounded-2xl border-2 focus:border-green-500 transition-all text-center"
                                        value={settings.freeDeliveryMinOrder}
                                        onChange={(e) => handleSettingChange('freeDeliveryMinOrder', Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        {settings.freeDeliveryRadius > 0 && (
                            <div className="mt-8 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center animate-pulse shadow-lg shadow-green-500/20">
                                    <Truck className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-green-700 dark:text-green-300 leading-tight">Dynamic Free Delivery Active!</p>
                                    <p className="text-xs font-semibold text-green-600/80 mt-1">
                                        Customers within <strong>{settings.freeDeliveryRadius}km</strong> get free shipping
                                        {settings.freeDeliveryMinOrder > 0 ? ` on orders above ₹${settings.freeDeliveryMinOrder}` : ''}.
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {/* SAVE ACTION */}
            {/* SAVE ACTION */}
            <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-4 bg-background/95 backdrop-blur-xl border-t z-40 flex items-center justify-center mt-auto">
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full max-w-sm h-14 rounded-2xl font-black text-lg bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                            Optimizing...
                        </>
                    ) : (
                        <>
                            <Save className="mr-3 h-6 w-6" />
                            Apply Settings
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default function DeliverySettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <DeliverySettingsPageContent />
        </Suspense>
    )
}

