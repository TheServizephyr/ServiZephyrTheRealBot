'use client';

import { useEffect, useState } from 'react';
import { Laptop, RefreshCw, WifiOff } from 'lucide-react';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { listOfflineQueueItems, OFFLINE_QUEUE_UPDATED_EVENT } from '@/lib/desktop/offlineStore';

export default function OfflineDesktopStatus({ className = '' }) {
  const [isOffline, setIsOffline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncConnectionState = () => setIsOffline(window.navigator.onLine === false);
    syncConnectionState();
    window.addEventListener('online', syncConnectionState);
    window.addEventListener('offline', syncConnectionState);
    return () => {
      window.removeEventListener('online', syncConnectionState);
      window.removeEventListener('offline', syncConnectionState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadQueueCount = async () => {
      if (!desktop) return;
      try {
        const items = await listOfflineQueueItems('owner_offline_sync_queue');
        if (!cancelled) {
          setQueueCount(Array.isArray(items) ? items.length : 0);
        }
      } catch {
        if (!cancelled) setQueueCount(0);
      }
    };

    const handleQueueUpdate = (event) => {
      const detail = event?.detail || {};
      if (String(detail.queueName || '') !== 'owner_offline_sync_queue') return;
      if (!cancelled) {
        setQueueCount(Number(detail.count || 0));
      }
    };

    loadQueueCount();
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    const timer = setInterval(loadQueueCount, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    };
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground ${className}`}>
      <Laptop className="h-3.5 w-3.5" />
      <span>Desktop</span>
      {isOffline && (
        <>
          <span className="text-border">•</span>
          <WifiOff className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-600">Offline</span>
        </>
      )}
      <span className="text-border">•</span>
      <RefreshCw className="h-3.5 w-3.5" />
      <span>{queueCount} queued</span>
    </div>
  );
}
