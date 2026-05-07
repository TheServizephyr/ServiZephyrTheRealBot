'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientIncident } from '@/lib/opsClientReporter';

export default function AppError({ error, reset }) {
  useEffect(() => {
    reportClientIncident({
      source: 'next_app_error_boundary',
      area: 'react',
      severity: 'error',
      title: 'React route error boundary',
      message: error?.message || 'Route render failed',
      error,
      context: {
        digest: error?.digest || null,
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
            <p className="text-sm text-muted-foreground mt-1">The team has been notified automatically.</p>
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
