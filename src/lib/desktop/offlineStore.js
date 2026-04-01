import { isDesktopApp } from './runtime';

export const OFFLINE_QUEUE_UPDATED_EVENT = 'servizephyr:desktop-offline-queue-updated';

function getDesktopOfflineApi() {
  if (typeof window === 'undefined') return null;
  return window.servizephyrDesktop?.offline || null;
}

function emitOfflineQueueUpdate(queueName, items) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_UPDATED_EVENT, {
    detail: {
      queueName: String(queueName || ''),
      items: Array.isArray(items) ? items : [],
      count: Array.isArray(items) ? items.length : 0,
    },
  }));
}

export async function getOfflineNamespace(namespace, scope, fallback = null) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return fallback;
  return api.getNamespace({ namespace, scope, fallback });
}

export async function getOfflineNamespaces(items = []) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) {
    return (Array.isArray(items) ? items : []).reduce((accumulator, entry = {}) => {
      const key = String(entry?.key || `${entry?.namespace || ''}::${entry?.scope || ''}`);
      accumulator[key] = entry?.fallback ?? null;
      return accumulator;
    }, {});
  }

  return api.getNamespaces({ items });
}

export async function setOfflineNamespace(namespace, scope, value) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return value;
  return api.setNamespace({ namespace, scope, value });
}

export async function patchOfflineNamespace(namespace, scope, patch) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return patch;
  return api.patchNamespace({ namespace, scope, patch });
}

export async function upsertOfflineCollectionItem(namespace, scope, item, idField = 'id') {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return item;
  return api.upsertCollectionItem({ namespace, scope, item, idField });
}

export async function removeOfflineCollectionItem(namespace, scope, id, idField = 'id') {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return id;
  return api.removeCollectionItem({ namespace, scope, id, idField });
}

export async function appendOfflineQueueItem(queueName, item) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return [item];
  const items = await api.appendQueueItem({ queueName, item });
  emitOfflineQueueUpdate(queueName, items);
  return items;
}

export async function listOfflineQueueItems(queueName) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return [];
  const items = await api.listQueueItems({ queueName });
  emitOfflineQueueUpdate(queueName, items);
  return items;
}

export async function removeOfflineQueueItem(queueName, id) {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return [];
  const items = await api.removeQueueItem({ queueName, id });
  emitOfflineQueueUpdate(queueName, items);
  return items;
}

export async function getOfflineStoreDebugInfo() {
  const api = getDesktopOfflineApi();
  if (!isDesktopApp() || !api) return null;
  return api.getDebugInfo();
}

export async function silentPrintDesktopHtml(payload = {}) {
  if (typeof window === 'undefined' || !isDesktopApp()) {
    return { ok: false, error: 'desktop_print_unavailable' };
  }

  const printApi = window.servizephyrDesktop?.print;
  if (!printApi?.silentHtml) {
    return { ok: false, error: 'desktop_print_unavailable' };
  }

  return printApi.silentHtml(payload);
}
