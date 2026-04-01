export function isDesktopApp() {
  if (typeof window === 'undefined') return false;
  if (window.servizephyrDesktop) return true;
  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  if (/electron/i.test(userAgent)) return true;
  const hostname = typeof window.location !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : '';
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export async function getDesktopRuntimeInfo() {
  if (!isDesktopApp()) {
    return {
      isDesktopApp: false,
      isPackaged: false,
      userDataPath: '',
      appVersion: '',
      baseUrl: '',
    };
  }

  try {
    return await window.servizephyrDesktop.getRuntimeInfo();
  } catch (error) {
    return {
      isDesktopApp: true,
      isPackaged: false,
      userDataPath: '',
      appVersion: '',
      baseUrl: '',
      error: error?.message || 'desktop_runtime_unavailable',
    };
  }
}
