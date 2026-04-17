'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, Loader2, Mic, MicOff, Volume2, WandSparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function StatusPill({ children, className = '' }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', className)}>
            {children}
        </span>
    );
}

export default function VoiceBillingPanel(props) {
    const {
        supported = false,
        listening = false,
        processing = false,
        aiResolving = false,
        lastTranscript = '',
        lastAction = '',
        diagnostics = null,
        error = '',
        permissionState = 'unknown',
        rawErrorCode = '',
        microphoneProbe = null,
        currentModeLabel = 'delivery',
        activeTableLabel = '',
        logEntries = [],
        pendingItems = [],
        onToggleListening,
        onRunMicrophoneProbe,
        onOpenDebug,
        onUsePendingCandidate,
        onDismissPendingItem,
        className = '',
    } = props;

    const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
    const hasPendingItems = Array.isArray(pendingItems) && pendingItems.length > 0;

    useEffect(() => {
        if (hasPendingItems) {
            setIsConfirmDialogOpen(true);
        } else {
            setIsConfirmDialogOpen(false);
        }
    }, [hasPendingItems]);

    const statusPill = !supported ? (
        <StatusPill className="border-amber-500/30 bg-amber-500/10 text-amber-700">
            unavailable
        </StatusPill>
    ) : listening ? (
        <StatusPill className="border-rose-500/30 bg-rose-500/10 text-rose-700">
            <Volume2 className="h-3 w-3" />
            listening
        </StatusPill>
    ) : aiResolving ? (
        <StatusPill className="border-violet-500/30 bg-violet-500/10 text-violet-700">
            <BrainCircuit className="h-3 w-3" />
            ai resolving
        </StatusPill>
    ) : processing ? (
        <StatusPill className="border-sky-500/30 bg-sky-500/10 text-sky-700">
            <Loader2 className="h-3 w-3 animate-spin" />
            processing
        </StatusPill>
    ) : null;

    return (
        <>
            <div className={cn('rounded-2xl border border-border bg-muted/20 px-3 py-2 shadow-sm', className)}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                            Voice Billing
                        </span>
                        <StatusPill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                            {String(currentModeLabel || 'delivery').replace(/-/g, ' ')}
                        </StatusPill>
                        {activeTableLabel ? (
                            <StatusPill className="border-indigo-500/30 bg-indigo-500/10 text-indigo-700">
                                {activeTableLabel}
                            </StatusPill>
                        ) : null}
                        {statusPill}
                        {hasPendingItems ? (
                            <button
                                type="button"
                                onClick={() => setIsConfirmDialogOpen(true)}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 transition-colors hover:bg-amber-500/15"
                            >
                                <WandSparkles className="h-3 w-3" />
                                {pendingItems.length} confirm
                            </button>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {onOpenDebug ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onOpenDebug}
                                className="h-9 px-3 text-xs font-semibold"
                            >
                                Voice Debug
                            </Button>
                        ) : null}
                        {error && supported ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onRunMicrophoneProbe}
                                className="h-9 px-3 text-xs font-semibold"
                            >
                                Test Mic
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            onClick={onToggleListening}
                            disabled={!supported || (processing && !listening)}
                            className={cn(
                                'h-10 px-4 text-sm font-semibold',
                                listening ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-primary hover:bg-primary/90'
                            )}
                        >
                            {processing && !listening ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : listening ? (
                                <MicOff className="mr-2 h-4 w-4" />
                            ) : (
                                <Mic className="mr-2 h-4 w-4" />
                            )}
                            {listening ? 'Stop Voice' : 'Start Voice'}
                        </Button>
                    </div>
                </div>

                {(lastTranscript || lastAction || diagnostics?.note || logEntries?.length) ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl border border-border bg-background/80 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Last Heard
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-foreground">
                                {lastTranscript || diagnostics?.transcript || 'Waiting for transcript...'}
                            </p>
                        </div>
                        <div className="rounded-xl border border-border bg-background/80 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Last Action
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-foreground">
                                {lastAction || diagnostics?.note || 'No cart action yet.'}
                            </p>
                        </div>
                    </div>
                ) : null}

                {error ? (
                    <div className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-destructive">{error}</p>
                                {(rawErrorCode || microphoneProbe?.status || permissionState !== 'unknown') ? (
                                    <details className="mt-1 text-[10px] text-muted-foreground">
                                        <summary className="cursor-pointer select-none">Debug details</summary>
                                        <div className="mt-1 space-y-0.5">
                                            <p>Permission: {permissionState}</p>
                                            <p>Speech error: {rawErrorCode || 'none'}</p>
                                            <p>Mic probe: {microphoneProbe?.status || 'unknown'}</p>
                                            {microphoneProbe?.errorName ? <p>Probe error: {microphoneProbe.errorName}</p> : null}
                                        </div>
                                    </details>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
                <DialogContent className="max-w-xl border-border bg-card p-0 text-foreground sm:rounded-2xl">
                    <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
                        <DialogTitle>Confirm Voice Match</DialogTitle>
                        <DialogDescription>
                            Sirf unclear items yahan dikh rahe hain. Sahi option choose karte hi current bill update ho jayega.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
                        {pendingItems.map((pendingItem) => (
                            <div key={pendingItem.id} className="rounded-2xl border border-border bg-muted/20 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-foreground">
                                            {pendingItem.reason === 'portion-required'
                                                ? `"${pendingItem.spokenText}" ke liye portion choose karo`
                                                : pendingItem.reason === 'family-ambiguous'
                                                    ? `"${pendingItem.spokenText}" naam se multiple items mil rahe hain, sahi wala choose karo`
                                                : pendingItem.commandAction === 'clear-item'
                                                    ? `"${pendingItem.spokenText}" ko clear karne se pehle verify karo`
                                                    : pendingItem.commandAction === 'subtract'
                                                        ? `"${pendingItem.spokenText}" ko minus karne se pehle verify karo`
                                                        : `"${pendingItem.spokenText}" verify karo`}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Qty: {pendingItem.quantity}
                                            {pendingItem.requestedPortion ? ` • Portion: ${pendingItem.requestedPortion}` : ''}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 px-3 text-xs"
                                        onClick={() => onDismissPendingItem?.(pendingItem.id)}
                                    >
                                        Skip
                                    </Button>
                                </div>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {(pendingItem.candidates || []).map((candidate) => (
                                        <button
                                            key={`${pendingItem.id}-${candidate.entryId}-${candidate.portionName}`}
                                            type="button"
                                            onClick={() => onUsePendingCandidate?.(pendingItem.id, candidate)}
                                            className="rounded-xl border border-border bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                                        >
                                            <p className="text-sm font-semibold text-foreground">{candidate.name}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {candidate.portionName || 'Default portion'}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
