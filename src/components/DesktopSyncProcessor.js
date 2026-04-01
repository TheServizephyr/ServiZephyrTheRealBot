'use client';

import { useEffect, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { listOfflineQueueItems, removeOfflineQueueItem } from '@/lib/desktop/offlineStore';
import { getBestEffortIdToken } from '@/lib/client-session';

const QUEUE_NAME = 'owner_offline_sync_queue';
const SYNC_BASE_INTERVAL_MS = 15000;
const SYNC_MAX_BACKOFF_MS = 120000;

function isTransientNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('offline') ||
    message.includes('enotfound') ||
    message.includes('ehostunreach') ||
    message.includes('unavailable')
  );
}

function isServerWarmupError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('firebase admin sdk is not initialized') ||
    message.includes('token verification failed') ||
    message.includes('identitytoolkit')
  );
}

function buildScopedPath(pathname, item = {}) {
  const url = new URL(pathname, window.location.origin);
  if (item?.impersonatedOwnerId) {
    url.searchParams.set('impersonate_owner_id', item.impersonatedOwnerId);
  } else if (item?.employeeOfOwnerId) {
    url.searchParams.set('employee_of', item.employeeOfOwnerId);
  }
  return url.toString();
}

async function getAuthHeaders() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required for sync');
  }
  const idToken = await getBestEffortIdToken(currentUser);
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

async function ensureSuccessfulResponse(response, fallbackMessage) {
  if (response.ok) return response;

  let message = fallbackMessage;
  try {
    const payload = await response.json();
    message = payload?.message || message;
  } catch {
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
      // Ignore body parse failures.
    }
  }

  throw new Error(message);
}

async function replayOfflineItem(item) {
  const action = String(item?.action || '').trim();
  const payload = item?.payload || {};
  const headers = await getAuthHeaders();

  if (action === 'manual_bill_history_create') {
    const res = await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/custom-bill/history', item), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }), 'Failed to sync manual bill history');
    return true;
  }

  if (action === 'manual_table_create') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/manual-tables', item), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: payload?.name }),
    }), 'Failed to sync manual table create');
    return true;
  }

  if (action === 'manual_table_update') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/manual-tables', item), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ id: payload?.id, name: payload?.name }),
    }), 'Failed to sync manual table update');
    return true;
  }

  if (action === 'manual_table_delete') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath(`/api/owner/manual-tables?tableId=${encodeURIComponent(payload?.id || '')}`, item), {
      method: 'DELETE',
      headers: { Authorization: headers.Authorization },
    }), 'Failed to sync manual table delete');
    return true;
  }

  if (action === 'manual_table_occupy') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath(`/api/owner/manual-tables/${encodeURIComponent(payload?.tableId || '')}`, item), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ action: 'occupy', currentOrder: payload?.currentOrder }),
    }), 'Failed to sync manual table occupy');
    return true;
  }

  if (action === 'manual_table_finalize') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath(`/api/owner/manual-tables/${encodeURIComponent(payload?.tableId || '')}`, item), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ action: 'finalize' }),
    }), 'Failed to sync manual table finalize');
    return true;
  }

  if (action === 'manual_table_settle') {
    const historyRes = await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/custom-bill/history', item), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload?.bill || {}),
    }), 'Failed to sync manual table settle history');
    const historyData = await historyRes.json().catch(() => ({}));
    const historyId = historyData?.historyId;
    if (historyId) {
      await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/custom-bill/history', item), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'settle', historyIds: [historyId] }),
      }), 'Failed to settle synced history');
    }
    await ensureSuccessfulResponse(await fetch(buildScopedPath(`/api/owner/manual-tables/${encodeURIComponent(payload?.tableId || '')}`, item), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ action: 'free' }),
    }), 'Failed to free manual table after sync');
    return true;
  }

  if (action === 'dine_in_table_create') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/dine-in-tables', item), {
      method: 'POST',
      headers,
      body: JSON.stringify({ tableId: payload?.tableId, max_capacity: payload?.max_capacity }),
    }), 'Failed to sync dine-in table create');
    return true;
  }

  if (action === 'dine_in_table_update') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/dine-in-tables', item), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ tableId: payload?.tableId, newTableId: payload?.newTableId, newCapacity: payload?.newCapacity }),
    }), 'Failed to sync dine-in table update');
    return true;
  }

  if (action === 'dine_in_table_delete') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/dine-in-tables', item), {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ tableId: payload?.tableId }),
    }), 'Failed to sync dine-in table delete');
    return true;
  }

  if (action === 'dine_in_mark_cleaned') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/owner/dine-in-tables', item), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ tableId: payload?.tableId, action: 'mark_cleaned' }),
    }), 'Failed to sync dine-in mark cleaned');
    return true;
  }

  if (action === 'dine_in_clear_tab') {
    await ensureSuccessfulResponse(await fetch(buildScopedPath('/api/dine-in/clean-table', item), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        tabId: payload?.tabId,
        tableId: payload?.tableId,
        restaurantId: payload?.restaurantId || null,
        dineInTabId: payload?.dineInTabId || null,
      }),
    }), 'Failed to sync dine-in clear tab');
    return true;
  }

  return false;
}

export default function DesktopSyncProcessor() {
  const runningRef = useRef(false);
  const nextAttemptAtRef = useRef(0);
  const retryDelayRef = useRef(SYNC_BASE_INTERVAL_MS);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;

    const processQueue = async () => {
      if (cancelled || runningRef.current) return;
      if (typeof window !== 'undefined' && window.navigator.onLine === false) return;
      if (Date.now() < nextAttemptAtRef.current) return;

      runningRef.current = true;
      try {
        const items = await listOfflineQueueItems(QUEUE_NAME);
        if (!items.length) {
          retryDelayRef.current = SYNC_BASE_INTERVAL_MS;
          nextAttemptAtRef.current = 0;
          return;
        }

        for (const item of items) {
          if (cancelled) break;
          try {
            const handled = await replayOfflineItem(item);
            if (handled && item?.id) {
              await removeOfflineQueueItem(QUEUE_NAME, item.id);
            }
            retryDelayRef.current = SYNC_BASE_INTERVAL_MS;
            nextAttemptAtRef.current = 0;
          } catch (error) {
            const shouldBackOff = isTransientNetworkError(error) || isServerWarmupError(error);
            if (shouldBackOff) {
              nextAttemptAtRef.current = Date.now() + retryDelayRef.current;
              retryDelayRef.current = Math.min(retryDelayRef.current * 2, SYNC_MAX_BACKOFF_MS);
              break;
            }
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    processQueue();
    const timer = setInterval(processQueue, SYNC_BASE_INTERVAL_MS);
    window.addEventListener('online', processQueue);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', processQueue);
    };
  }, [desktop]);

  return null;
}
