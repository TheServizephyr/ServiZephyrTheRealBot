'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { recoverFromChunkLoadError, reportClientIncident } from '@/lib/opsClientReporter';

export default function AppError({ error, reset }) {
  const [isRecoveringChunk, setIsRecoveringChunk] = useState(false);

  useEffect(() => {
    const isChunkLoadError = recoverFromChunkLoadError(error);
    setIsRecoveringChunk(isChunkLoadError);

    reportClientIncident({
      source: 'next_app_error_boundary',
      area: 'react',
      severity: 'error',
      title: 'React route error boundary',
      message: error?.message || 'Route render failed',
      error,
      context: {
        digest: error?.digest || null,
        chunkRecovery: isChunkLoadError ? 'reload_scheduled' : null,
      },
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
          <div>
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isRecoveringChunk ? 'Refreshing the latest version...' : 'The team has been notified automatically.'}
            </p>
          </div>
          <Button onClick={reset} className="w-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
