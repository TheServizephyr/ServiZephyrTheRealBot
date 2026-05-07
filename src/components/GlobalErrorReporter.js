'use client';

import { useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { reportClientIncident, serializeClientError } from '@/lib/opsClientReporter';

function getCurrentUserSnapshot() {
  const user = auth?.currentUser;
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    phoneNumber: user.phoneNumber || null,
  };
}

export default function GlobalErrorReporter() {
  useEffect(() => {
    const handleWindowError = (event) => {
      const error = event?.error || {
        name: 'WindowError',
        message: event?.message || 'Unhandled browser error',
        stack: '',
      };

      reportClientIncident({
        source: 'client_window_error',
        area: 'browser',
        severity: 'error',
        title: 'Unhandled browser error',
        message: serializeClientError(error).message,
        error,
        user: getCurrentUserSnapshot(),
        context: {
          filename: event?.filename || '',
          lineno: event?.lineno || null,
          colno: event?.colno || null,
        },
      });
    };

    const handleUnhandledRejection = (event) => {
      const reason = event?.reason || 'Unhandled promise rejection';
      const serialized = serializeClientError(reason);

      reportClientIncident({
        source: 'client_unhandled_rejection',
        area: 'browser',
        severity: 'error',
        title: 'Unhandled browser promise rejection',
        message: serialized.message,
        error: reason instanceof Error ? reason : serialized,
        user: getCurrentUserSnapshot(),
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
