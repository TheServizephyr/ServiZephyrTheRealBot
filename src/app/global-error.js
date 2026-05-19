'use client';

import { useEffect } from 'react';
import { recoverFromChunkLoadError, reportClientIncident } from '@/lib/opsClientReporter';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    const isChunkLoadError = recoverFromChunkLoadError(error);

    reportClientIncident({
      source: 'next_global_error_boundary',
      area: 'react_root',
      severity: 'critical',
      title: 'Root application error boundary',
      message: error?.message || 'Root render failed',
      error,
      context: {
        digest: error?.digest || null,
        chunkRecovery: isChunkLoadError ? 'reload_scheduled' : null,
      },
    });
  }, [error]);

  return (
    <html>
      <body>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Arial, sans-serif' }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: '#666', marginBottom: 18 }}>The team has been notified automatically.</p>
            <button
              onClick={reset}
              style={{ border: 0, background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
