'use client';

export const SCREEN_ORIENTATION_AUTO = 'auto';
export const SCREEN_ORIENTATION_PORTRAIT = 'portrait';
export const SCREEN_ORIENTATION_LANDSCAPE = 'landscape';

export const isStandaloneDisplayMode = () => {
  if (typeof window === 'undefined') return false;

  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone ||
    String(document.referrer || '').startsWith('android-app://')
  );
};

export const getScreenOrientationLabel = () => {
  if (typeof window === 'undefined') return 'Unknown';

  const type = String(window.screen?.orientation?.type || '').toLowerCase();
  if (type.includes('landscape')) return 'Landscape';
  if (type.includes('portrait')) return 'Portrait';

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: portrait)').matches ? 'Portrait' : 'Landscape';
  }

  return 'Unknown';
};

export const allowAnyScreenOrientation = async () => {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'Screen orientation can only be changed in the browser.' };
  }

  const orientationApi = window.screen?.orientation;
  if (!orientationApi) {
    return { ok: false, message: 'This browser does not expose screen orientation controls.' };
  }

  if (typeof orientationApi.unlock === 'function') {
    try {
      orientationApi.unlock();
    } catch {
      // Ignore unlock failures. Some browsers expose the method but do not allow it.
    }
  }

  if (!isStandaloneDisplayMode() || typeof orientationApi.lock !== 'function') {
    return { ok: true, message: 'Auto-rotate preference refreshed.' };
  }

  try {
    await orientationApi.lock('any');
  } catch {
    // Keep this best-effort. Some runtimes reject "any" even after unlock.
  }

  return { ok: true, message: 'Auto-rotate preference refreshed.' };
};

const getOrientationLockTarget = (mode) => {
  if (mode === SCREEN_ORIENTATION_PORTRAIT) return 'portrait';
  if (mode === SCREEN_ORIENTATION_LANDSCAPE) return 'landscape';
  return 'any';
};

const getOrientationSuccessMessage = (mode) => {
  if (mode === SCREEN_ORIENTATION_PORTRAIT) return 'Portrait mode requested.';
  if (mode === SCREEN_ORIENTATION_LANDSCAPE) return 'Landscape mode requested.';
  return 'Auto-rotate restored.';
};

export const requestScreenOrientation = async (mode = SCREEN_ORIENTATION_AUTO) => {
  if (mode === SCREEN_ORIENTATION_AUTO) {
    return allowAnyScreenOrientation();
  }

  if (typeof window === 'undefined') {
    return { ok: false, message: 'Screen orientation can only be changed in the browser.' };
  }

  const orientationApi = window.screen?.orientation;
  if (!orientationApi || typeof orientationApi.lock !== 'function') {
    return {
      ok: false,
      message: 'This device/browser does not allow forcing orientation from the app.',
    };
  }

  const target = getOrientationLockTarget(mode);

  try {
    await orientationApi.lock(target);
    return { ok: true, message: getOrientationSuccessMessage(mode) };
  } catch (initialError) {
    const rootElement = document.documentElement;
    const canTryFullscreen =
      !isStandaloneDisplayMode() &&
      !document.fullscreenElement &&
      typeof rootElement?.requestFullscreen === 'function';

    if (canTryFullscreen) {
      try {
        await rootElement.requestFullscreen();
        await orientationApi.lock(target);
        return {
          ok: true,
          message: `${getOrientationSuccessMessage(mode)} Fullscreen was enabled to help the browser apply it.`,
        };
      } catch {
        // Fall through to the final failure message below.
      }
    }

    const errorMessage = initialError?.message ? String(initialError.message) : '';
    return {
      ok: false,
      message: errorMessage
        ? `Orientation request was blocked: ${errorMessage}`
        : 'This browser blocked the orientation change. If you are in a browser tab, try fullscreen or install the app.',
    };
  }
};
