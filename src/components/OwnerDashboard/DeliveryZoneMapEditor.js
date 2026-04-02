'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const COLOR_OPTIONS = [
    '#0f766e',
    '#2563eb',
    '#7c3aed',
    '#db2777',
    '#ea580c',
    '#ca8a04',
];

function toMapCenter(center) {
    const lat = Number(center?.lat);
    const lng = Number(center?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_CENTER;
    return { lat, lng };
}

function createZoneId() {
    return `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isPointInsideRadius(point, center, radiusMeters) {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
        return false;
    }

    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    return L.latLng(Number(center?.lat), Number(center?.lng)).distanceTo(L.latLng(lat, lng)) <= radiusMeters;
}

function isBoundaryInsideRadius(boundary = [], center, radiusMeters) {
    if (!Array.isArray(boundary) || boundary.length < 3) return false;
    return boundary.every((point) => isPointInsideRadius(point, center, radiusMeters));
}

function normalizeBoundaryFromLayer(layer) {
    const latLngs = layer.getLatLngs();
    const ring = Array.isArray(latLngs?.[0]) ? latLngs[0] : latLngs;
    if (!Array.isArray(ring)) return [];

    return ring
        .map((point) => {
            const lat = Number(point?.lat);
            const lng = Number(point?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
        })
        .filter(Boolean);
}

function normalizeZoneForMap(zone = {}, index = 0, fallbackBoundary = [], fallbackColor = COLOR_OPTIONS[0]) {
    return {
        zone_id: String(zone?.zone_id || zone?.zoneId || zone?.id || createZoneId()).trim(),
        name: String(zone?.name || `Zone ${index + 1}`).trim(),
        priority: Number.isFinite(Number(zone?.priority)) ? Number(zone.priority) : index,
        is_active: true,
        is_blocked: zone?.is_blocked === true || zone?.isBlocked === true,
        baseFee: Number.isFinite(Number(zone?.baseFee)) ? Number(zone.baseFee) : 0,
        color: String(zone?.color || fallbackColor).trim() || fallbackColor,
        boundary: Array.isArray(zone?.boundary) && zone.boundary.length >= 3 ? zone.boundary : fallbackBoundary,
        geojson: null,
        pricingTiers: Array.isArray(zone?.pricingTiers) ? zone.pricingTiers : [],
    };
}

function getPolygonStyle(zone = {}, isSelected = false) {
    const color = String(zone?.color || COLOR_OPTIONS[0]).trim() || COLOR_OPTIONS[0];
    return {
        color,
        fillColor: color,
        fillOpacity: zone?.is_blocked ? (isSelected ? 0.18 : 0.12) : (isSelected ? 0.3 : 0.2),
        weight: isSelected ? 4 : 2,
        dashArray: zone?.is_blocked ? '6 4' : undefined,
    };
}

export default function DeliveryZoneMapEditor({
    center,
    deliveryRadiusKm = 5,
    zones = [],
    onZonesChange,
    onZoneCreated,
    onZoneSelect,
    onValidationError,
    selectedZoneId = null,
    readOnly = false,
    heightClass = 'h-[420px]',
}) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const featureGroupRef = useRef(null);
    const restaurantMarkerRef = useRef(null);
    const radiusCircleRef = useRef(null);
    const drawHandlerRef = useRef(null);
    const editHandlerRef = useRef(null);
    const deleteHandlerRef = useRef(null);
    const zonesRef = useRef(zones);
    const onZonesChangeRef = useRef(onZonesChange);
    const onZoneCreatedRef = useRef(onZoneCreated);
    const onZoneSelectRef = useRef(onZoneSelect);
    const onValidationErrorRef = useRef(onValidationError);
    const selectedColorRef = useRef(COLOR_OPTIONS[0]);
    const activeToolRef = useRef('pan');
    const hasFitBoundsRef = useRef(false);
    const safeCenterRef = useRef(toMapCenter(center));
    const deliveryRadiusKmRef = useRef(Number(deliveryRadiusKm) || 0);
    const selectedZoneIdRef = useRef(selectedZoneId);

    const safeCenter = useMemo(() => toMapCenter(center), [center]);
    const [selectedColor, setSelectedColor] = useState(
        String(zones?.[0]?.color || COLOR_OPTIONS[0]).trim() || COLOR_OPTIONS[0]
    );
    const [activeTool, setActiveTool] = useState('pan');

    useEffect(() => {
        zonesRef.current = zones;
    }, [zones]);

    useEffect(() => {
        onZonesChangeRef.current = onZonesChange;
    }, [onZonesChange]);

    useEffect(() => {
        onZoneCreatedRef.current = onZoneCreated;
    }, [onZoneCreated]);

    useEffect(() => {
        onZoneSelectRef.current = onZoneSelect;
    }, [onZoneSelect]);

    useEffect(() => {
        onValidationErrorRef.current = onValidationError;
    }, [onValidationError]);

    useEffect(() => {
        safeCenterRef.current = safeCenter;
    }, [safeCenter]);

    useEffect(() => {
        deliveryRadiusKmRef.current = Number(deliveryRadiusKm) || 0;
    }, [deliveryRadiusKm]);

    useEffect(() => {
        selectedZoneIdRef.current = selectedZoneId;
    }, [selectedZoneId]);

    useEffect(() => {
        selectedColorRef.current = selectedColor;
    }, [selectedColor]);

    useEffect(() => {
        activeToolRef.current = activeTool;
    }, [activeTool]);

    const getRadiusMeters = () => Math.max(0, Number(deliveryRadiusKmRef.current) || 0) * 1000;

    const notifyRadiusViolation = () => {
        onValidationErrorRef.current?.('Global radius ke bahar polygon draw ya edit nahi kar sakte.');
    };

    const renderZonesOnMap = (nextZones = []) => {
        const map = mapRef.current;
        const featureGroup = featureGroupRef.current;
        if (!map || !featureGroup) return;

        featureGroup.clearLayers();

        (nextZones || []).forEach((zone, index) => {
            if (!Array.isArray(zone?.boundary) || zone.boundary.length < 3) return;

            const polygon = L.polygon(zone.boundary, {
                ...getPolygonStyle(zone, selectedZoneIdRef.current === zone.zone_id),
                zoneId: zone.zone_id,
                zoneColor: zone.color,
            });

            polygon.bindTooltip(
                `${zone?.name || `Zone ${index + 1}`}${zone?.is_blocked ? ' (Blocked)' : ''}`,
                { sticky: true }
            );

            polygon.on('click', () => {
                if (activeToolRef.current !== 'pan') return;
                onZoneSelectRef.current?.(zone.zone_id);
            });

            featureGroup.addLayer(polygon);
        });

        if ((nextZones || []).length > 0) {
            const bounds = featureGroup.getBounds();
            if (bounds.isValid()) {
                map.fitBounds(bounds.pad(0.12));
                hasFitBoundsRef.current = true;
            }
        } else {
            hasFitBoundsRef.current = false;
        }
    };

    const disableAllTools = () => {
        drawHandlerRef.current?.disable();
        editHandlerRef.current?.disable();
        deleteHandlerRef.current?.disable();
        drawHandlerRef.current = null;
        editHandlerRef.current = null;
        deleteHandlerRef.current = null;
        setActiveTool('pan');
    };

    const syncZonesFromLayers = () => {
        const featureGroup = featureGroupRef.current;
        if (!featureGroup) return;

        const activeLayers = featureGroup.getLayers().filter((layer) => layer instanceof L.Polygon);
        const previousZonesById = new Map((zonesRef.current || []).map((zone) => [zone.zone_id, zone]));

        const nextZones = activeLayers
            .map((layer, index) => {
                const boundary = normalizeBoundaryFromLayer(layer);
                if (boundary.length < 3) return null;

                const layerZoneId = String(layer.options.zoneId || '').trim() || createZoneId();
                const previousZone = previousZonesById.get(layerZoneId);
                const layerColor = String(
                    layer.options.zoneColor || previousZone?.color || selectedColorRef.current
                ).trim() || selectedColorRef.current;

                layer.options.zoneId = layerZoneId;
                layer.options.zoneColor = layerColor;

                return normalizeZoneForMap(
                    {
                        ...previousZone,
                        zone_id: layerZoneId,
                        color: layerColor,
                    },
                    index,
                    boundary,
                    layerColor
                );
            })
            .filter(Boolean);

        onZonesChangeRef.current?.(nextZones);
    };

    const activateDrawTool = () => {
        if (readOnly || !mapRef.current) return;
        disableAllTools();

        const handler = new L.Draw.Polygon(mapRef.current, {
            allowIntersection: false,
            showArea: true,
            shapeOptions: {
                color: selectedColorRef.current,
                fillColor: selectedColorRef.current,
                fillOpacity: 0.2,
                weight: 2,
            },
        });

        drawHandlerRef.current = handler;
        setActiveTool('draw');
        handler.enable();
    };

    const activateEditTool = () => {
        if (readOnly || !mapRef.current || !featureGroupRef.current) return;
        disableAllTools();

        const handler = new L.EditToolbar.Edit(mapRef.current, {
            featureGroup: featureGroupRef.current,
            selectedPathOptions: {
                maintainColor: true,
            },
        });

        editHandlerRef.current = handler;
        setActiveTool('edit');
        handler.enable();
    };

    const activateDeleteTool = () => {
        if (readOnly || !mapRef.current || !featureGroupRef.current) return;
        disableAllTools();

        const handler = new L.EditToolbar.Delete(mapRef.current, {
            featureGroup: featureGroupRef.current,
        });

        deleteHandlerRef.current = handler;
        setActiveTool('delete');
        handler.enable();
    };

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return undefined;

        const map = L.map(mapContainerRef.current, {
            center: [safeCenter.lat, safeCenter.lng],
            zoom: 13,
            zoomControl: true,
        });
        mapRef.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        const featureGroup = new L.FeatureGroup();
        featureGroupRef.current = featureGroup;
        map.addLayer(featureGroup);

        map.on(L.Draw.Event.CREATED, (event) => {
            const layer = event.layer;
            const boundary = normalizeBoundaryFromLayer(layer);
            if (boundary.length < 3) return;
            if (!isBoundaryInsideRadius(boundary, safeCenterRef.current, getRadiusMeters())) {
                notifyRadiusViolation();
                setActiveTool('pan');
                return;
            }

            const nextZoneIndex = (zonesRef.current || []).length;
            const zoneColor = selectedColorRef.current;
            const createdZone = normalizeZoneForMap(
                {
                    zone_id: createZoneId(),
                    name: `Zone ${nextZoneIndex + 1}`,
                    color: zoneColor,
                },
                nextZoneIndex,
                boundary,
                zoneColor
            );

            layer.options.zoneId = createdZone.zone_id;
            layer.options.zoneColor = zoneColor;
            featureGroup.addLayer(layer);

            const nextZones = [...(zonesRef.current || []), createdZone];
            onZonesChangeRef.current?.(nextZones);
            onZoneCreatedRef.current?.(createdZone);
            setActiveTool('pan');
        });

        map.on(L.Draw.Event.EDITED, () => {
            const editedLayers = featureGroup.getLayers().filter((layer) => layer instanceof L.Polygon);
            const hasOutsidePolygon = editedLayers.some((layer) => {
                const boundary = normalizeBoundaryFromLayer(layer);
                return !isBoundaryInsideRadius(boundary, safeCenterRef.current, getRadiusMeters());
            });

            if (hasOutsidePolygon) {
                notifyRadiusViolation();
                renderZonesOnMap(zonesRef.current || []);
                setActiveTool('pan');
                return;
            }

            syncZonesFromLayers();
            setActiveTool('pan');
        });

        map.on(L.Draw.Event.DELETED, () => {
            syncZonesFromLayers();
            setActiveTool('pan');
        });

        map.on(L.Draw.Event.DRAWSTOP, () => setActiveTool('pan'));
        map.on(L.Draw.Event.EDITSTOP, () => setActiveTool('pan'));
        map.on(L.Draw.Event.DELETESTOP, () => setActiveTool('pan'));

        return () => {
            disableAllTools();
            map.off();
            map.remove();
            mapRef.current = null;
            featureGroupRef.current = null;
            restaurantMarkerRef.current = null;
            radiusCircleRef.current = null;
        };
        // We intentionally initialize Leaflet only once and keep reactive updates in separate effects.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (readOnly) {
            disableAllTools();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readOnly]);

    useEffect(() => {
        if (activeTool !== 'draw') return;
        activateDrawTool();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedColor]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const latLng = L.latLng(safeCenter.lat, safeCenter.lng);

        if (!restaurantMarkerRef.current) {
            restaurantMarkerRef.current = L.circleMarker(latLng, {
                radius: 7,
                color: '#1d4ed8',
                fillColor: '#2563eb',
                fillOpacity: 1,
                weight: 2,
            }).addTo(map).bindTooltip('Business location', { direction: 'top' });
        } else {
            restaurantMarkerRef.current.setLatLng(latLng);
        }

        const radiusMeters = Math.max(0, Number(deliveryRadiusKm) || 0) * 1000;
        if (!radiusCircleRef.current) {
            radiusCircleRef.current = L.circle(latLng, {
                radius: radiusMeters,
                color: '#3b82f6',
                weight: 1,
                fillColor: '#93c5fd',
                fillOpacity: 0.08,
                dashArray: '6 4',
            }).addTo(map);
            radiusCircleRef.current.bindTooltip('Global Radius Filter', {
                permanent: true,
                direction: 'top',
                offset: [0, -6],
            });
        } else {
            radiusCircleRef.current.setLatLng(latLng);
            radiusCircleRef.current.setRadius(radiusMeters);
        }

        if (!hasFitBoundsRef.current && !(zones?.length > 0)) {
            map.setView(latLng, 13);
        }
    }, [deliveryRadiusKm, safeCenter.lat, safeCenter.lng, zones?.length]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return undefined;

        const resizeHandle = window.setTimeout(() => {
            map.invalidateSize();
        }, 120);

        return () => window.clearTimeout(resizeHandle);
    }, [heightClass, readOnly]);

    useEffect(() => {
        renderZonesOnMap(zones);
    }, [selectedZoneId, zones]);

    return (
        <div className="space-y-3">
            {!readOnly && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant={activeTool === 'draw' ? 'default' : 'outline'}
                            onClick={activateDrawTool}
                        >
                            Draw Area
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={activeTool === 'edit' ? 'default' : 'outline'}
                            onClick={activateEditTool}
                            disabled={(zones || []).length === 0}
                        >
                            Edit Shape
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={activeTool === 'delete' ? 'destructive' : 'outline'}
                            onClick={activateDeleteTool}
                            disabled={(zones || []).length === 0}
                        >
                            Delete Shape
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={disableAllTools}
                        >
                            Pan Mode
                        </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">Pen Color</span>
                        {COLOR_OPTIONS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => setSelectedColor(color)}
                                className={cn(
                                    'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                                    selectedColor === color ? 'border-foreground scale-110' : 'border-white/20'
                                )}
                                style={{ backgroundColor: color }}
                                aria-label={`Select ${color} pen`}
                                title={`Use ${color} pen`}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div className="rounded-2xl border overflow-hidden bg-card">
                <div ref={mapContainerRef} className={cn('w-full', heightClass)} />
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="rounded-full border px-3 py-1 bg-background">Blue circle: Global Radius Filter</span>
                <span className="rounded-full border px-3 py-1 bg-background">Radius ke bahar polygon draw/edit block hai</span>
                <span className="rounded-full border px-3 py-1 bg-background">Selected pen sets the next zone color</span>
                <span className="rounded-full border px-3 py-1 bg-background">Click a zone in pan mode to open its details</span>
            </div>
        </div>
    );
}
