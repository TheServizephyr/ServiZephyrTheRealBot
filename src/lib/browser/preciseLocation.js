export const REQUIRED_LOCATION_ACCURACY_METERS = 50;

const MANUAL_BOOKING_FALLBACK = 'If you are unable to turn on location, please ask the Bookings Manager to add you manually.';

const buildCustomerMessage = (reason, steps) => `Reason: ${reason}\n\nRequired action: ${steps}\n\n${MANUAL_BOOKING_FALLBACK}`;

const createLocationError = (kind, title, message, cause = null) => {
    const error = new Error(message);
    error.name = 'PreciseLocationError';
    error.kind = kind;
    error.userTitle = title;
    if (cause) error.cause = cause;
    return error;
};

export function getLocationErrorDetails(error) {
    return {
        title: error?.userTitle || 'Location Check Failed',
        message: error?.message || buildCustomerMessage(
            'Your current location could not be verified.',
            'Enable location services and Precise Location, check your internet connection, and then retry.'
        ),
        kind: error?.kind || 'unknown',
    };
}

export function getServerLocationErrorDetails(code, payload = {}) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (normalizedCode === 'LOCATION_NOT_CONFIGURED') {
        return {
            title: 'Restaurant Location Is Not Configured',
            message: buildCustomerMessage(
                'The restaurant has not finished setting its booking location.',
                'Please contact the restaurant before trying the location-based booking again.'
            ),
            kind: 'restaurant_location_missing',
        };
    }
    if (normalizedCode === 'LOCATION_REQUIRED') {
        return {
            title: 'Location Permission Required',
            message: buildCustomerMessage(
                'Your live location was not received, so the booking could not be verified.',
                'Enable location services on your device, allow location access for servizephyr.com, enable Precise Location, and then retry.'
            ),
            kind: 'permission_denied',
        };
    }
    if (normalizedCode === 'LOCATION_ACCURACY_LOW') {
        return {
            title: 'Precise Location Required',
            message: buildCustomerMessage(
                'Your current location is not accurate enough for the required 50-meter check.',
                'Enable location services and Precise Location, move to an open area, wait a few seconds, and then retry.'
            ),
            kind: 'low_accuracy',
        };
    }
    if (normalizedCode === 'OUTSIDE_LOCATION_RADIUS') {
        const distanceMeters = Number(payload?.distanceMeters);
        const distanceText = Number.isFinite(distanceMeters) ? ` You appear to be approximately ${Math.round(distanceMeters)} meters away.` : '';
        return {
            title: 'You Are Outside the Booking Area',
            message: buildCustomerMessage(
                `Location-based booking is allowed only within 50 meters of the restaurant.${distanceText}`,
                'Please move closer to the restaurant, wait for GPS to update, and then retry.'
            ),
            kind: 'outside_radius',
        };
    }
    return null;
}

export function getPreciseBrowserLocation({ timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            reject(createLocationError(
                'unsupported',
                'Location Not Supported',
                buildCustomerMessage(
                    'This browser does not support live location access.',
                    'Open this page in the latest version of Chrome or Safari and try again.'
                )
            ));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    capturedAt: new Date(position.timestamp).toISOString(),
                };

                if (!Number.isFinite(location.accuracy) || location.accuracy > REQUIRED_LOCATION_ACCURACY_METERS) {
                    const roundedAccuracy = Number.isFinite(location.accuracy) ? Math.round(location.accuracy) : null;
                    reject(createLocationError(
                        'low_accuracy',
                        'Precise Location Required',
                        buildCustomerMessage(
                            `${roundedAccuracy ? `Your current location accuracy is approximately ${roundedAccuracy} meters. ` : ''}The booking requires accuracy within 50 meters.`,
                            'Enable location services and Precise Location, move to an open area, wait a few seconds, and then retry.'
                        )
                    ));
                    return;
                }

                resolve(location);
            },
            (locationError) => {
                if (locationError?.code === 1) {
                    reject(createLocationError(
                        'permission_denied',
                        'Location Permission Required',
                        buildCustomerMessage(
                            'Location access is blocked for servizephyr.com, so the booking could not be verified.',
                            'Open the browser site settings, set Location to Allow, enable Precise Location on your phone, and then retry.'
                        ),
                        locationError
                    ));
                    return;
                }
                if (locationError?.code === 2) {
                    reject(createLocationError(
                        'position_unavailable',
                        'Current Location Not Available',
                        buildCustomerMessage(
                            'Your device could not provide a current location.',
                            'Enable location services and internet access, move to an open area, wait a few seconds, and then retry.'
                        ),
                        locationError
                    ));
                    return;
                }
                if (locationError?.code === 3) {
                    reject(createLocationError(
                        'timeout',
                        'Location Check Timed Out',
                        buildCustomerMessage(
                            'A precise location was not received within 15 seconds.',
                            'Keep location services and Precise Location enabled, move to an open area, and then retry.'
                        ),
                        locationError
                    ));
                    return;
                }

                reject(createLocationError(
                    'unknown',
                    'Location Check Failed',
                    buildCustomerMessage(
                        'Your current location could not be verified.',
                        'Enable location services and Precise Location, check your internet connection, and then retry.'
                    ),
                    locationError
                ));
            },
            { enableHighAccuracy: true, timeout, maximumAge: 0 }
        );
    });
}
