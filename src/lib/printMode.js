const PRINT_MODE_STORAGE_KEY = 'servizephyr_print_mode';

export function normalizePrintMode(value = '') {
    const normalized = String(value || '').trim().toLowerCase();

    if (['kiosk', 'silent', 'auto'].includes(normalized)) {
        return 'kiosk';
    }

    return 'browser';
}

export function getPrintModeFromSearchParams(searchParams) {
    if (!searchParams?.get) return null;

    const rawValue =
        searchParams.get('printMode') ||
        searchParams.get('print_mode') ||
        searchParams.get('kioskPrinting');

    if (rawValue == null) return null;

    return normalizePrintMode(rawValue);
}

export function readStoredPrintMode() {
    if (typeof window === 'undefined') return 'browser';

    try {
        return normalizePrintMode(window.localStorage.getItem(PRINT_MODE_STORAGE_KEY));
    } catch {
        return 'browser';
    }
}

export function persistPrintMode(mode) {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(PRINT_MODE_STORAGE_KEY, normalizePrintMode(mode));
    } catch {
        // Ignore storage failures.
    }
}

export function resolvePreferredPrintMode(searchParams) {
    const queryMode = getPrintModeFromSearchParams(searchParams);

    if (queryMode) {
        persistPrintMode(queryMode);
        return queryMode;
    }

    return readStoredPrintMode();
}

export function isKioskPrintMode(mode) {
    return normalizePrintMode(mode) === 'kiosk';
}
