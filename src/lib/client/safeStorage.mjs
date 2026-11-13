// The property getter itself can throw in private/embedded browsers.
export function readBrowserStorage(kind, key) {
    try { return globalThis.window?.[kind]?.getItem(key) ?? null; } catch { return null; }
}
export function writeBrowserStorage(kind, key, value) {
    try { globalThis.window?.[kind]?.setItem(key, value); } catch { /* Keep the active page usable without persistence. */ }
}
export function removeBrowserStorage(kind, key) {
    try { globalThis.window?.[kind]?.removeItem(key); } catch { /* Persistence is optional. */ }
}
