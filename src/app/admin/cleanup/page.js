'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

export default function AdminCleanupPage() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const handleCleanup = async () => {
        setLoading(true);
        setResult(null);
        setError(null);

        try {
            const response = await fetch('/api/admin/cleanup-loadtest-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const data = await response.json();

            if (data.success) {
                setResult(data);
            } else {
                setError(data.message || 'Failed to cleanup orders');
            }
        } catch (err) {
            setError(err.message || 'Network error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background p-8">
            <div className="max-w-2xl mx-auto">
                <div className="bg-card border border-border rounded-xl p-8 shadow-lg">
                    <h1 className="text-3xl font-bold mb-2 text-foreground">🧹 Admin Cleanup Tool</h1>
                    <p className="text-muted-foreground mb-8">
                        Cancel all LoadTest orders from ashwani's-restaurant
                    </p>

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="text-amber-500 mt-0.5 flex-shrink-0" size={20} />
                            <div className="text-sm">
                                <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">Warning</p>
                                <p className="text-amber-600 dark:text-amber-400">
                                    This will cancel ALL orders with "LoadTest" or "Test User" in customer name.
                                    This action cannot be undone.
                                </p>
                            </div>
                        </div>
                    </div>

                    <Button
                        onClick={handleCleanup}
                        disabled={loading}
                        className="w-full"
                        variant="destructive"
                        size="lg"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Cancelling orders...
                            </>
                        ) : (
                            <>
                                <Trash2 className="mr-2 h-5 w-5" />
                                Cancel All LoadTest Orders
                            </>
                        )}
                    </Button>

                    {result && (
                        <div className="mt-6 bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <CheckCircle className="text-green-500 mt-0.5 flex-shrink-0" size={20} />
                                <div>
                                    <p className="font-semibold text-green-700 dark:text-green-300 mb-2">
                                        ✅ {result.message}
                                    </p>
                                    <p className="text-sm text-green-600 dark:text-green-400 mb-3">
                                        Cancelled {result.cancelled} order{result.cancelled !== 1 ? 's' : ''}
                                    </p>
                                    {result.orders && result.orders.length > 0 && (
                                        <details className="text-xs">
                                            <summary className="cursor-pointer text-green-600 dark:text-green-400 hover:underline mb-2">
                                                View cancelled orders ({result.orders.length})
                                            </summary>
                                            <div className="bg-background/50 rounded p-2 max-h-40 overflow-y-auto">
                                                {result.orders.map((order, i) => (
                                                    <div key={i} className="text-muted-foreground py-1">
                                                        • {order.name} ({order.id})
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="text-red-500 mt-0.5 flex-shrink-0" size={20} />
                                <div>
                                    <p className="font-semibold text-red-700 dark:text-red-300 mb-1">
                                        Error
                                    </p>
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                        {error}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
