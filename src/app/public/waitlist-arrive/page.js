'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

function WaitlistArriveContent() {
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('pending');
    const [message, setMessage] = useState('Verifying your token...');

    useEffect(() => {
        const markArrival = async () => {
            const restaurantId = searchParams.get('rid');
            const entryId = searchParams.get('eid');
            const arrivalCode = searchParams.get('c');

            if (!restaurantId || !entryId || !arrivalCode) {
                setStatus('error');
                setMessage('Invalid arrival link.');
                setLoading(false);
                return;
            }

            try {
                const res = await fetch('/api/public/waitlist/arrive', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ restaurantId, entryId, arrivalCode }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.message || 'Could not verify token.');
                }
                setStatus('success');
                setMessage(data.message || 'Token verified.');
            } catch (error) {
                setStatus('error');
                setMessage(error.message || 'Could not verify token.');
            } finally {
                setLoading(false);
            }
        };

        void markArrival();
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-border shadow-xl">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">Waitlist Arrival</CardTitle>
                    <CardDescription>ServiZephyr Live Queue</CardDescription>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    {loading ? (
                        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                    ) : status === 'success' ? (
                        <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
                    ) : (
                        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
                    )}
                    <p className="text-sm text-muted-foreground">{message}</p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function WaitlistArrivePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        }>
            <WaitlistArriveContent />
        </Suspense>
    );
}
