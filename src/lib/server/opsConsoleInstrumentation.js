import { buildConsoleIncidentPayload, reportIncident } from '@/lib/opsIncidentReporter';

const INSTALL_KEY = '__servizephyrOpsConsoleInstrumentationInstalled';
const ORIGINAL_ERROR_KEY = '__servizephyrOriginalConsoleError';

function shouldSkipConsoleArgs(args) {
    if (globalThis.__servizephyrSuppressConsoleIncidentCapture) return true;

    const message = args.map((arg) => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        return typeof arg === 'string' ? arg : '';
    }).join(' ');

    return (
        !message.trim() ||
        message.includes('[ops-incident]') ||
        message.includes('GET /api/admin/ops-incidents') ||
        message.includes('POST /api/ops/incident')
    );
}

export function installServerConsoleErrorReporter() {
    if (globalThis[INSTALL_KEY]) return;
    if (process.env.OPS_CAPTURE_SERVER_CONSOLE_ERROR === 'false') return;

    const originalError = console.error.bind(console);
    globalThis[ORIGINAL_ERROR_KEY] = originalError;

    console.error = (...args) => {
        originalError(...args);

        if (shouldSkipConsoleArgs(args)) return;

        try {
            const payload = buildConsoleIncidentPayload(args);
            globalThis.__servizephyrSuppressConsoleIncidentCapture = true;
            void reportIncident(payload)
                .catch(() => {})
                .finally(() => {
                    globalThis.__servizephyrSuppressConsoleIncidentCapture = false;
                });
        } catch {
            // Never let observability interfere with the application.
            globalThis.__servizephyrSuppressConsoleIncidentCapture = false;
        }
    };

    if (!globalThis.__servizephyrUnhandledRejectionReporterInstalled) {
        globalThis.__servizephyrUnhandledRejectionReporterInstalled = true;
        process.on('unhandledRejection', (reason) => {
            try {
                const error = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled rejection'));
                globalThis.__servizephyrSuppressConsoleIncidentCapture = true;
                void reportIncident({
                    source: 'server_unhandled_rejection',
                    area: 'server',
                    severity: 'critical',
                    title: 'Unhandled server promise rejection',
                    message: error.message,
                    error,
                }).catch(() => {}).finally(() => {
                    globalThis.__servizephyrSuppressConsoleIncidentCapture = false;
                });
            } catch {
                // Best-effort only.
                globalThis.__servizephyrSuppressConsoleIncidentCapture = false;
            }
        });
    }

    globalThis[INSTALL_KEY] = true;
}
