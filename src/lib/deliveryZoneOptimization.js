function toFiniteCoordinate(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizePoint(point) {
    if (Array.isArray(point) && point.length >= 2) {
        const lat = toFiniteCoordinate(point[0]);
        const lng = toFiniteCoordinate(point[1]);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    if (!point || typeof point !== 'object') return null;

    const lat = toFiniteCoordinate(point.lat ?? point.latitude);
    const lng = toFiniteCoordinate(point.lng ?? point.lon ?? point.longitude);
    if (lat === null || lng === null) return null;
    return { lat, lng };
}

function extractZonePoints(zone = {}) {
    const points = [];

    if (Array.isArray(zone?.polygons)) {
        zone.polygons.forEach((polygon) => {
            if (!Array.isArray(polygon)) return;
            polygon.forEach((point) => {
                const normalizedPoint = normalizePoint(point);
                if (normalizedPoint) points.push(normalizedPoint);
            });
        });
    }

    if (Array.isArray(zone?.boundary)) {
        zone.boundary.forEach((point) => {
            const normalizedPoint = normalizePoint(point);
            if (normalizedPoint) points.push(normalizedPoint);
        });
    }

    return points;
}

function toCartesianPoint(point, referenceLatitude) {
    const kmPerDegLat = 110.574;
    const kmPerDegLng = 111.320 * Math.cos((referenceLatitude * Math.PI) / 180);

    return {
        x: point.lng * kmPerDegLng,
        y: point.lat * kmPerDegLat,
        source: point,
    };
}

function fromCartesianPoint(point, referenceLatitude) {
    const kmPerDegLat = 110.574;
    const kmPerDegLng = 111.320 * Math.cos((referenceLatitude * Math.PI) / 180);

    if (!Number.isFinite(kmPerDegLng) || Math.abs(kmPerDegLng) < Number.EPSILON) return null;

    return {
        lat: point.y / kmPerDegLat,
        lng: point.x / kmPerDegLng,
    };
}

function distanceBetweenPoints(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPointInsideCircle(point, circle) {
    if (!circle) return false;
    return distanceBetweenPoints(point, circle.center) <= circle.radius + 1e-9;
}

function circleFromOnePoint(point) {
    return {
        center: { x: point.x, y: point.y },
        radius: 0,
    };
}

function circleFromTwoPoints(a, b) {
    return {
        center: {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        },
        radius: distanceBetweenPoints(a, b) / 2,
    };
}

function circleFromThreePoints(a, b, c) {
    const d = (a.x * (b.y - c.y)) + (b.x * (c.y - a.y)) + (c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;

    const ux = (
        ((a.x ** 2 + a.y ** 2) * (b.y - c.y))
        + ((b.x ** 2 + b.y ** 2) * (c.y - a.y))
        + ((c.x ** 2 + c.y ** 2) * (a.y - b.y))
    ) / (2 * d);

    const uy = (
        ((a.x ** 2 + a.y ** 2) * (c.x - b.x))
        + ((b.x ** 2 + b.y ** 2) * (a.x - c.x))
        + ((c.x ** 2 + c.y ** 2) * (b.x - a.x))
    ) / (2 * d);

    const center = { x: ux, y: uy };

    return {
        center,
        radius: distanceBetweenPoints(center, a),
    };
}

function makeCircleWithTwoBoundaryPoints(points, pointA, pointB) {
    let circle = circleFromTwoPoints(pointA, pointB);
    if (points.every((point) => isPointInsideCircle(point, circle))) return circle;

    for (let i = 0; i < points.length; i += 1) {
        const pointC = points[i];
        if (isPointInsideCircle(pointC, circle)) continue;

        const candidate = circleFromThreePoints(pointA, pointB, pointC);
        if (!candidate) continue;
        if (points.every((point) => isPointInsideCircle(point, candidate))) {
            circle = candidate;
        }
    }

    return circle;
}

function makeMinimumEnclosingCircle(points) {
    if (!Array.isArray(points) || points.length === 0) return null;

    let circle = null;

    for (let i = 0; i < points.length; i += 1) {
        const pointA = points[i];
        if (circle && isPointInsideCircle(pointA, circle)) continue;

        circle = circleFromOnePoint(pointA);

        for (let j = 0; j < i; j += 1) {
            const pointB = points[j];
            if (isPointInsideCircle(pointB, circle)) continue;

            circle = circleFromTwoPoints(pointA, pointB);

            for (let k = 0; k < j; k += 1) {
                const pointC = points[k];
                if (isPointInsideCircle(pointC, circle)) continue;
                circle = makeCircleWithTwoBoundaryPoints(points.slice(0, j + 1), pointA, pointB);
                if (isPointInsideCircle(pointC, circle)) continue;

                const circumcircle = circleFromThreePoints(pointA, pointB, pointC);
                if (circumcircle && points.slice(0, i + 1).every((point) => isPointInsideCircle(point, circumcircle))) {
                    circle = circumcircle;
                }
            }
        }
    }

    return circle;
}

export function getDeliveryZoneOptimizationCircle(zones = []) {
    if (!Array.isArray(zones) || zones.length === 0) return null;

    const relevantZones = zones.filter((zone) => {
        const isExplicitlyInactive = zone?.isActive === false || zone?.is_active === false;
        return !isExplicitlyInactive;
    });

    const allPoints = relevantZones.flatMap((zone) => extractZonePoints(zone));
    if (allPoints.length === 0) return null;

    const referenceLatitude = allPoints.reduce((sum, point) => sum + point.lat, 0) / allPoints.length;
    const cartesianPoints = allPoints.map((point) => toCartesianPoint(point, referenceLatitude));
    const circle = makeMinimumEnclosingCircle(cartesianPoints);
    if (!circle) return null;

    const center = fromCartesianPoint(circle.center, referenceLatitude);
    if (!center) return null;

    return {
        center,
        radiusKm: Number(circle.radius.toFixed(3)),
        pointCount: allPoints.length,
    };
}

export function isPointInsideOptimizationCircle(point, circle) {
    const normalizedPoint = normalizePoint(point);
    if (!normalizedPoint || !circle?.center) return false;

    const referenceLatitude = (normalizedPoint.lat + Number(circle.center.lat)) / 2;
    const cartesianPoint = toCartesianPoint(normalizedPoint, referenceLatitude);
    const cartesianCenter = toCartesianPoint(circle.center, referenceLatitude);
    const radiusKm = Number(circle.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm < 0) return false;

    return distanceBetweenPoints(cartesianPoint, cartesianCenter) <= radiusKm + 1e-9;
}
