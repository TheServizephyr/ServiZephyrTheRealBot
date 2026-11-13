export class ServiceApiError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'ServiceApiError';
        Object.assign(this, details);
    }
}

// No automatic retry: a timed-out write might already have succeeded.
export async function fetchServiceJson(url, options = {}, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetchImpl(url, { ...options, signal: controller.signal, cache: 'no-store' });
        if (response.status === 204) return null;
        const text = await response.text();
        if (response.headers.get('x-vercel-mitigated') === 'challenge') {
            throw new ServiceApiError('Your browser needs a security check. Refresh this page, then check the live status before repeating any action.', {
                status: response.status, code: 'SECURITY_CHECK',
                requestId: response.headers.get('x-vercel-id'),
            });
        }
        let data;
        try { data = JSON.parse(text); } catch {
            throw new ServiceApiError(`Server returned an unexpected response (HTTP ${response.status}). Please try again shortly.`, {
                status: response.status, code: 'INVALID_RESPONSE',
                requestId: response.headers.get('x-vercel-id') || response.headers.get('x-request-id'),
            });
        }
        if (!response.ok) {
            throw new ServiceApiError(data?.message || `Request failed (HTTP ${response.status}). Please try again shortly.`, {
                status: response.status, code: 'HTTP_ERROR', data,
                retryAfterSec: Number(response.headers.get('retry-after')) || 0,
            });
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new ServiceApiError('Server returned an invalid response. Please refresh shortly.', { status: response.status, code: 'INVALID_RESPONSE' });
        }
        return data;
    } catch (error) {
        if (controller.signal.aborted) {
            const isWrite = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase());
            throw new ServiceApiError(isWrite
                ? 'The server took too long to reply. Check the live status before repeating this action; it may have succeeded.'
                : 'The server took too long to reply. Please refresh shortly.', { status: response?.status || 0, code: 'TIMEOUT' });
        }
        throw error;
    } finally { clearTimeout(timer); }
}

export function createServiceRefreshQueue(load) {
    let current;
    let queued;
    const run = (afterCurrent = false) => {
        if (current) {
            if (!afterCurrent) return current;
            // A mutation requires one read after the older request, shared by callers.
            if (!queued) queued = current.catch(() => {}).then(() => {
                queued = null;
                return run();
            });
            return queued;
        }
        current = Promise.resolve().then(load).finally(() => { current = null; });
        return current;
    };
    return { run };
}
