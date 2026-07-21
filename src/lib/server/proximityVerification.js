export const PUBLIC_INTAKE_RADIUS_METERS = 50;

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export function getBusinessCoordinates(businessData = {}) {
    const latitude = toFiniteNumber(
        businessData.coordinates?.lat
        ?? businessData.location?.lat
        ?? businessData.address?.latitude
        ?? businessData.businessAddress?.latitude
    );
    const longitude = toFiniteNumber(
        businessData.coordinates?.lng
        ?? businessData.location?.lng
        ?? businessData.address?.longitude
        ?? businessData.businessAddress?.longitude
    );
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
}

export function verifyPublicIntakeProximity(businessData = {}, body = {}) {
    const businessCoordinates = getBusinessCoordinates(businessData);
    if (!businessCoordinates) {
        return { ok: false, message: 'Restaurant location is not configured. Please contact the restaurant.' };
    }

    const latitude = toFiniteNumber(body.location?.latitude ?? body.latitude);
    const longitude = toFiniteNumber(body.location?.longitude ?? body.longitude);
    const accuracy = toFiniteNumber(body.location?.accuracy ?? body.locationAccuracy);
    if (latitude === null || longitude === null || accuracy === null) {
        return { ok: false, message: 'Live location is required. Please allow precise location access and try again.' };
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || accuracy > PUBLIC_INTAKE_RADIUS_METERS) {
        return { ok: false, message: 'Your location accuracy must be within 50 meters. Move outdoors or enable precise location and try again.' };
    }

    const earthRadiusMeters = 6371000;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latDelta = toRadians(businessCoordinates.latitude - latitude);
    const lngDelta = toRadians(businessCoordinates.longitude - longitude);
    const a = Math.sin(latDelta / 2) ** 2
        + Math.cos(toRadians(latitude)) * Math.cos(toRadians(businessCoordinates.latitude)) * Math.sin(lngDelta / 2) ** 2;
    const distanceMeters = earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (distanceMeters > PUBLIC_INTAKE_RADIUS_METERS) {
        return { ok: false, message: `You must be within 50 meters of the restaurant. You are approximately ${Math.round(distanceMeters)} meters away.` };
    }
    return { ok: true, distanceMeters: Math.round(distanceMeters), accuracyMeters: Math.round(accuracy) };
}
