'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const CANCELLATION_REASON_OPTIONS = [
    { value: 'customer_requested_cancellation', label: 'Customer asked to cancel' },
    { value: 'customer_not_picking_call', label: 'Customer not picking call' },
    { value: 'customer_changed_items', label: 'Customer changed items after confirmation' },
    { value: 'customer_refused_delivery', label: 'Customer refused to accept order' },
    { value: 'duplicate_order', label: 'Duplicate order' },
    { value: 'other', label: 'Other' },
];

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export default function OrderCancellationTool({
    accessParams = {},
    onCancelled = () => {},
    title = 'Cancel Accepted Order',
    helperText = 'Enter an order ID to review and cancel an accepted order after OTP verification.',
    compact = false,
}) {
    const [lookupId, setLookupId] = useState('');
    const [lookupLoading, setLookupLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [order, setOrder] = useState(null);
    const [selectedReason, setSelectedReason] = useState('');
    const [reasonNote, setReasonNote] = useState('');
    const [challengeId, setChallengeId] = useState('');
    const [maskedPhone, setMaskedPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSending, setOtpSending] = useState(false);
    const [otpVerifying, setOtpVerifying] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const accessQuery = useMemo(() => {
        const params = new URLSearchParams();
        Object.entries(accessParams || {}).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });
        return params;
    }, [accessParams]);

    const authedFetch = async (url, options = {}) => {
        const user = auth.currentUser;
        if (!user) throw new Error('Please login first.');
        const token = await user.getIdToken();
        return fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${token}`,
            },
        });
    };

    const resetFlow = () => {
        setSelectedReason('');
        setReasonNote('');
        setChallengeId('');
        setMaskedPhone('');
        setOtp('');
        setError('');
        setSuccess('');
    };

    const buildReasonPayload = () => {
        const selected = CANCELLATION_REASON_OPTIONS.find((option) => option.value === selectedReason);
        const label = selected?.label || '';
        const note = String(reasonNote || '').trim();

        if (!label) return '';
        if (selectedReason === 'other') return note;
        if (!note) return label;
        return `${label}: ${note}`;
    };

    const handleLookup = async () => {
        const normalized = String(lookupId || '').trim();
        if (!normalized) {
            setError('Please enter an order ID.');
            return;
        }

        try {
            setLookupLoading(true);
            setError('');
            setSuccess('');
            resetFlow();

            const url = new URL('/api/owner/order-cancellation', window.location.origin);
            accessQuery.forEach((value, key) => url.searchParams.set(key, value));

            const res = await authedFetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'lookup', orderId: normalized }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Order lookup failed.');

            setOrder(data.order || null);
            setDialogOpen(true);
        } catch (lookupError) {
            setError(lookupError.message || 'Order lookup failed.');
        } finally {
            setLookupLoading(false);
        }
    };

    const handleRequestOtp = async () => {
        if (!order?.orderId) return;
        if (!selectedReason) {
            setError('Please select a cancellation reason.');
            return;
        }

        const reason = buildReasonPayload();
        if (!reason || reason.trim().length < 5) {
            setError('Please add a proper cancellation reason.');
            return;
        }

        try {
            setOtpSending(true);
            setError('');
            setSuccess('');
            const url = new URL('/api/owner/order-cancellation', window.location.origin);
            accessQuery.forEach((value, key) => url.searchParams.set(key, value));

            const res = await authedFetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'request_otp',
                    orderId: order.orderId,
                    reason: reason.trim(),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'OTP request failed.');

            setChallengeId(data.challengeId || '');
            setMaskedPhone(data.maskedPhone || '');
            setSuccess(data.message || 'OTP sent successfully.');
        } catch (requestError) {
            setError(requestError.message || 'OTP request failed.');
        } finally {
            setOtpSending(false);
        }
    };

    const handleVerifyAndCancel = async () => {
        if (!challengeId) {
            setError('Please request OTP first.');
            return;
        }
        if (!otp || otp.trim().length !== 4) {
            setError('Please enter the 4-digit OTP.');
            return;
        }

        try {
            setOtpVerifying(true);
            setError('');
            const url = new URL('/api/owner/order-cancellation', window.location.origin);
            accessQuery.forEach((value, key) => url.searchParams.set(key, value));

            const res = await authedFetch(url.toString(), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId, otp: otp.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Cancellation failed.');

            setSuccess(data.message || 'Order cancelled successfully.');
            onCancelled(data);
            setOrder((prev) => prev ? {
                ...prev,
                status: 'cancelled',
                canCancel: false,
                cancelBlockedReason: 'This order is already cancelled.',
            } : prev);
        } catch (verifyError) {
            setError(verifyError.message || 'Cancellation failed.');
        } finally {
            setOtpVerifying(false);
        }
    };

    return (
        <>
            <div className={compact ? "space-y-2" : "rounded-xl border border-border bg-card p-4 mb-6 space-y-3"}>
                {!compact ? (
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{helperText}</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">{title}</p>
                    </div>
                )}
                <div className="flex flex-col gap-3 md:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={lookupId}
                            onChange={(event) => setLookupId(event.target.value)}
                            placeholder="Enter Order ID or Bill ID"
                            className="pl-9"
                        />
                    </div>
                    <Button onClick={handleLookup} disabled={lookupLoading}>
                        {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Find Order
                    </Button>
                </div>
                {compact ? <p className="text-[11px] text-muted-foreground">{helperText}</p> : null}
                {error && !dialogOpen && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { resetFlow(); setOrder(null); } }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Order Cancellation Review</DialogTitle>
                        <DialogDescription>
                            Review the order, enter a reason, request OTP on the owner&apos;s personal WhatsApp, then verify to cancel.
                        </DialogDescription>
                    </DialogHeader>

                    {order ? (
                        <div className="space-y-5">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-xl bg-muted/40 p-4">
                                    <p className="text-xs text-muted-foreground">Order ID</p>
                                    <p className="mt-1 font-semibold">{order.orderId}</p>
                                </div>
                                <div className="rounded-xl bg-muted/40 p-4">
                                    <p className="text-xs text-muted-foreground">Source</p>
                                    <p className="mt-1 font-semibold capitalize">{order.source}</p>
                                </div>
                                <div className="rounded-xl bg-muted/40 p-4">
                                    <p className="text-xs text-muted-foreground">Customer</p>
                                    <p className="mt-1 font-semibold">{order.customerName || 'Guest'}</p>
                                    {order.customerPhone ? <p className="text-xs text-muted-foreground mt-1">{order.customerPhone}</p> : null}
                                </div>
                                <div className="rounded-xl bg-muted/40 p-4">
                                    <p className="text-xs text-muted-foreground">Total</p>
                                    <p className="mt-1 font-semibold">{formatCurrency(order.totalAmount)}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{formatDateTime(order.createdAt)}</p>
                                </div>
                            </div>

                            <div className="rounded-xl border border-border p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold">Current Status</p>
                                        <p className="text-xs text-muted-foreground mt-1 capitalize">{String(order.status || 'unknown').replace(/_/g, ' ')}</p>
                                    </div>
                                    {!order.canCancel ? (
                                        <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500">
                                            <AlertTriangle className="h-4 w-4" />
                                            Cancellation blocked
                                        </div>
                                    ) : null}
                                </div>
                                {!order.canCancel && order.cancelBlockedReason ? (
                                    <p className="text-xs text-red-500 mt-3">{order.cancelBlockedReason}</p>
                                ) : null}
                            </div>

                            <div className="rounded-xl border border-border p-4">
                                <p className="text-sm font-semibold">Items</p>
                                <div className="mt-3 space-y-2">
                                    {(order.items || []).length > 0 ? (
                                        order.items.map((item, index) => (
                                            <div key={`${item.id || item.name}-${index}`} className="flex items-start justify-between gap-3 text-sm border-b border-border/60 pb-2 last:border-0 last:pb-0">
                                                <div>
                                                    <p className="font-medium">{item.quantity} x {item.name}</p>
                                                    {item.variant ? <p className="text-xs text-muted-foreground mt-1">{item.variant}</p> : null}
                                                </div>
                                                <span className="font-semibold">{formatCurrency(item.price)}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No items found.</p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-semibold">Cancellation Reason</label>
                                <select
                                    value={selectedReason}
                                    onChange={(event) => setSelectedReason(event.target.value)}
                                    disabled={!order.canCancel || !!challengeId}
                                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                                >
                                    <option value="">Select a reason</option>
                                    {CANCELLATION_REASON_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <Textarea
                                    value={reasonNote}
                                    onChange={(event) => setReasonNote(event.target.value)}
                                    placeholder={selectedReason === 'other'
                                        ? 'Describe the cancellation reason'
                                        : 'Optional internal note for audit trail'}
                                    className="min-h-[96px]"
                                    disabled={!order.canCancel || !!challengeId}
                                />
                            </div>

                            {challengeId ? (
                                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                                    <p className="text-sm font-semibold">OTP sent to owner WhatsApp {maskedPhone ? `(${maskedPhone})` : ''}</p>
                                    <Input
                                        value={otp}
                                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))}
                                        placeholder="Enter 4-digit OTP"
                                        maxLength={4}
                                    />
                                </div>
                            ) : null}

                            {error ? <p className="text-sm text-red-500">{error}</p> : null}
                            {success ? <p className="text-sm text-green-600">{success}</p> : null}

                            <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                                <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
                                {!challengeId ? (
                                    <Button onClick={handleRequestOtp} disabled={!order.canCancel || otpSending}>
                                        {otpSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Send OTP
                                    </Button>
                                ) : (
                                    <Button onClick={handleVerifyAndCancel} disabled={otpVerifying || !order.canCancel}>
                                        {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Verify OTP And Cancel Order
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    );
}
