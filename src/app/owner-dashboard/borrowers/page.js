"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
    ArrowDownLeft,
    ArrowUpRight,
    Banknote,
    Clock3,
    History,
    MapPin,
    Phone,
    Plus,
    Trash2,
    User,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { getBestEffortIdToken } from '@/lib/client-session';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SYNC_TOKEN_TIMEOUT_MS = 3000;

const formatCurrency = (value) => `\u20B9${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const createBorrowerId = () => `borrower_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createBorrowerHistoryId = () => `borrower_history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createBorrowerMutationKey = () => `borrower_mutation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const normalizeBorrowerText = (value = '') => String(value ?? '').trim();
const normalizeBorrowerAddress = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeBorrowerPhone = (value = '') => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};
const isValidBorrowerPhone = (value = '') => /^\d{10}$/.test(String(value || ''));

const parseAmount = (value) => {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    if (!normalized) return NaN;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
};

const formatBorrowerLastEdited = (value) => {
    const timestamp = Number(value || 0);
    if (!timestamp) return 'Not saved yet';
    try {
        return new Intl.DateTimeFormat('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(timestamp));
    } catch {
        return 'Not saved yet';
    }
};

const normalizeBorrowerHistory = (entry = {}, index = 0) => {
    const rawDelta = Number(entry?.delta ?? entry?.amountDelta ?? entry?.change ?? 0);
    const fallbackType = rawDelta < 0 ? 'reduced' : 'added';
    const type = String(entry?.type || fallbackType).trim().toLowerCase() === 'reduced' ? 'reduced' : 'added';
    const amount = Math.abs(Number.isFinite(rawDelta) ? rawDelta : Number(entry?.amount || 0) || 0);
    const delta = type === 'reduced' ? -amount : amount;
    const updatedAt = Number(entry?.updatedAt || entry?.createdAt || 0) || 0;
    const resultingAmount = Number.isFinite(Number(entry?.resultingAmount))
        ? Number(entry.resultingAmount)
        : 0;

    return {
        id: String(entry?.id || `${createBorrowerHistoryId()}_${index}`),
        type,
        amount,
        delta,
        note: normalizeBorrowerText(entry?.note),
        updatedAt,
        resultingAmount,
    };
};

const createBorrowerCard = (borrower = {}) => {
    const name = normalizeBorrowerText(borrower?.name ?? borrower?.savedName);
    const phone = normalizeBorrowerPhone(borrower?.phone ?? borrower?.savedPhone);
    const address = normalizeBorrowerAddress(borrower?.address ?? borrower?.savedAddress);
    const history = (Array.isArray(borrower?.history) ? borrower.history : [])
        .map((entry, index) => normalizeBorrowerHistory(entry, index))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    const baseAmount = Number.isFinite(Number(borrower?.amount))
        ? Number(borrower.amount)
        : Number.isFinite(Number(borrower?.savedAmount))
            ? Number(borrower.savedAmount)
            : 0;
    const derivedAmount = history.length > 0
        ? Number(history[0]?.resultingAmount || 0)
        : baseAmount;

    return {
        id: String(borrower?.id || createBorrowerId()),
        name,
        phone,
        address,
        amount: Number(derivedAmount || 0),
        history,
        lastEditedAt: Number(borrower?.lastEditedAt || 0) || 0,
    };
};

const sortBorrowersByLastEdited = (borrowers = []) => (
    Array.isArray(borrowers) ? borrowers : []
).map((borrower) => createBorrowerCard(borrower)).sort(
    (left, right) => Number(right.lastEditedAt || 0) - Number(left.lastEditedAt || 0)
);

const serializeBorrowerCards = (borrowers = []) => (
    sortBorrowersByLastEdited(borrowers)
).map((borrower) => ({
    id: borrower.id,
    name: borrower.name,
    phone: borrower.phone,
    address: borrower.address,
    amount: borrower.amount,
    history: borrower.history.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        delta: entry.delta,
        note: entry.note,
        updatedAt: entry.updatedAt,
        resultingAmount: entry.resultingAmount,
    })),
    lastEditedAt: borrower.lastEditedAt,
}));

const INITIAL_CREATE_DRAFT = {
    name: '',
    phone: '',
    address: '',
};

const INITIAL_UPDATE_DRAFT = {
    borrowerId: '',
    mode: 'added',
    amount: '',
    note: '',
    requestKey: '',
};

export default function OwnerBorrowersPage() {
    const { toast } = useToast();
    const { user, isUserLoading } = useUser();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const desktopRuntime = useMemo(() => isDesktopApp(), []);
    const [borrowers, setBorrowers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [createDraft, setCreateDraft] = useState(INITIAL_CREATE_DRAFT);
    const [updateDraft, setUpdateDraft] = useState(INITIAL_UPDATE_DRAFT);
    const [historyBorrowerId, setHistoryBorrowerId] = useState('');
    const [isCreatingBorrower, setIsCreatingBorrower] = useState(false);
    const [isUpdatingBorrowerAmount, setIsUpdatingBorrowerAmount] = useState(false);
    const [isDeletingBorrowerId, setIsDeletingBorrowerId] = useState('');
    const createBorrowerInFlightRef = useRef(false);
    const updateBorrowerInFlightRef = useRef(false);
    const deleteBorrowerInFlightRef = useRef('');

    const borrowersCacheKey = useMemo(() => {
        const scope = impersonatedOwnerId
            ? `imp_${impersonatedOwnerId}`
            : employeeOfOwnerId
                ? `emp_${employeeOfOwnerId}`
                : 'owner_self';
        return `owner_custom_bill_cache_v2_${scope}__borrowers_v1`;
    }, [employeeOfOwnerId, impersonatedOwnerId]);

    const borrowersApiPath = useMemo(() => {
        const params = new URLSearchParams();
        if (impersonatedOwnerId) {
            params.set('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            params.set('employee_of', employeeOfOwnerId);
        }
        const query = params.toString();
        return query ? `/api/owner/borrowers?${query}` : '/api/owner/borrowers';
    }, [employeeOfOwnerId, impersonatedOwnerId]);

    const selectedHistoryBorrower = useMemo(
        () => borrowers.find((borrower) => borrower.id === historyBorrowerId) || null,
        [borrowers, historyBorrowerId]
    );

    const updateTargetBorrower = useMemo(
        () => borrowers.find((borrower) => borrower.id === updateDraft.borrowerId) || null,
        [borrowers, updateDraft.borrowerId]
    );

    const readLocalBorrowers = useCallback(() => {
        try {
            const raw = localStorage.getItem(borrowersCacheKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return sortBorrowersByLastEdited(parsed);
        } catch {
            return [];
        }
    }, [borrowersCacheKey]);

    const resolveCachedBorrowers = useCallback(async () => {
        const localBorrowers = readLocalBorrowers();
        if (localBorrowers.length > 0) return localBorrowers;
        if (!desktopRuntime) return [];

        try {
            const desktopBorrowers = await getOfflineNamespace('manual_borrowers', borrowersCacheKey, []);
            return sortBorrowersByLastEdited(desktopBorrowers);
        } catch {
            return [];
        }
    }, [borrowersCacheKey, desktopRuntime, readLocalBorrowers]);

    const writeCachedBorrowers = useCallback(async (nextBorrowers = []) => {
        const serialized = serializeBorrowerCards(nextBorrowers);

        try {
            localStorage.setItem(borrowersCacheKey, JSON.stringify(serialized));
        } catch {
            // Ignore local storage errors.
        }

        if (desktopRuntime) {
            try {
                await setOfflineNamespace('manual_borrowers', borrowersCacheKey, serialized);
            } catch {
                // Ignore desktop cache errors.
            }
        }

        return sortBorrowersByLastEdited(serialized);
    }, [borrowersCacheKey, desktopRuntime]);

    const getBorrowersIdToken = useCallback(async (currentUser = auth.currentUser || user) => (
        getBestEffortIdToken(currentUser, {
            timeoutMs: desktopRuntime ? SYNC_TOKEN_TIMEOUT_MS : 0,
        })
    ), [desktopRuntime, user]);

    const requestBorrowersApi = useCallback(async (method = 'GET', body = null) => {
        const currentUser = auth.currentUser || user;
        if (!currentUser) {
            throw new Error('Authentication is required.');
        }

        const idToken = await getBorrowersIdToken(currentUser);
        const response = await fetch(borrowersApiPath, {
            method,
            headers: {
                Authorization: `Bearer ${idToken}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(String(payload?.message || 'Unable to sync borrowers right now.'));
        }

        return payload;
    }, [borrowersApiPath, getBorrowersIdToken, user]);

    useEffect(() => {
        if (isUserLoading) return undefined;

        let isMounted = true;
        setIsLoading(true);

        const loadBorrowers = async () => {
            const cachedBorrowers = await resolveCachedBorrowers();
            if (!isMounted) return;

            if (cachedBorrowers.length > 0) {
                setBorrowers(cachedBorrowers);
                setIsLoading(false);
            }

            if (!user) {
                if (isMounted) {
                    setIsLoading(false);
                }
                return;
            }

            try {
                const payload = await requestBorrowersApi('GET');
                if (!isMounted) return;

                let syncedBorrowers = sortBorrowersByLastEdited(payload?.borrowers);
                if (syncedBorrowers.length === 0 && cachedBorrowers.length > 0) {
                    const migrationPayload = await requestBorrowersApi('PUT', {
                        borrowers: serializeBorrowerCards(cachedBorrowers),
                    });
                    if (!isMounted) return;
                    syncedBorrowers = sortBorrowersByLastEdited(migrationPayload?.borrowers);
                }

                setBorrowers(syncedBorrowers);
                await writeCachedBorrowers(syncedBorrowers);
            } catch (error) {
                console.error('Failed to sync borrowers:', error);
                if (isMounted && cachedBorrowers.length === 0) {
                    setBorrowers([]);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        loadBorrowers();
        return () => {
            isMounted = false;
        };
    }, [isUserLoading, requestBorrowersApi, resolveCachedBorrowers, user, writeCachedBorrowers]);

    const openCreateDialog = useCallback(() => {
        setCreateDraft(INITIAL_CREATE_DRAFT);
        setIsCreateDialogOpen(true);
    }, []);

    const handleCreateBorrower = useCallback(async () => {
        if (createBorrowerInFlightRef.current) return;

        const name = normalizeBorrowerText(createDraft.name);
        const phone = normalizeBorrowerPhone(createDraft.phone);
        const address = normalizeBorrowerAddress(createDraft.address);

        if (!name && !phone) {
            toast({
                title: 'Name or phone number required',
                description: 'Enter at least a name or a 10-digit phone number before saving.',
                variant: 'destructive',
            });
            return;
        }

        if (phone && !isValidBorrowerPhone(phone)) {
            toast({
                title: 'Invalid phone number',
                description: 'Phone number must be exactly 10 digits.',
                variant: 'destructive',
            });
            return;
        }

        createBorrowerInFlightRef.current = true;
        setIsCreatingBorrower(true);

        try {
            const payload = await requestBorrowersApi('POST', {
                name,
                phone,
                address,
            });
            const savedBorrower = createBorrowerCard(payload?.borrower || {
                name,
                phone,
                address,
                amount: 0,
                history: [],
                lastEditedAt: Date.now(),
            });
            const nextBorrowers = sortBorrowersByLastEdited([
                savedBorrower,
                ...borrowers.filter((borrower) => borrower.id !== savedBorrower.id),
            ]);

            setBorrowers(nextBorrowers);
            await writeCachedBorrowers(nextBorrowers);
            setCreateDraft(INITIAL_CREATE_DRAFT);
            setIsCreateDialogOpen(false);
            toast({
                title: 'Borrower saved',
                description: 'The borrower card has been created and synced to your account.',
                variant: 'success',
            });
        } catch (error) {
            toast({
                title: 'Unable to save borrower',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            createBorrowerInFlightRef.current = false;
            setIsCreatingBorrower(false);
        }
    }, [borrowers, createDraft.address, createDraft.name, createDraft.phone, requestBorrowersApi, toast, writeCachedBorrowers]);

    const handleDeleteBorrower = useCallback(async (borrowerId) => {
        if (!borrowerId || deleteBorrowerInFlightRef.current) return;

        deleteBorrowerInFlightRef.current = borrowerId;
        setIsDeletingBorrowerId(borrowerId);

        try {
            await requestBorrowersApi('DELETE', { borrowerId });
            const nextBorrowers = borrowers.filter((borrower) => borrower.id !== borrowerId);
            setBorrowers(nextBorrowers);

            if (historyBorrowerId === borrowerId) {
                setHistoryBorrowerId('');
            }
            if (updateDraft.borrowerId === borrowerId) {
                setUpdateDraft(INITIAL_UPDATE_DRAFT);
            }

            await writeCachedBorrowers(nextBorrowers);
            toast({
                title: 'Borrower deleted',
                description: 'The borrower card has been removed from your account.',
                variant: 'success',
            });
        } catch (error) {
            toast({
                title: 'Unable to delete borrower',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            if (deleteBorrowerInFlightRef.current === borrowerId) {
                deleteBorrowerInFlightRef.current = '';
            }
            setIsDeletingBorrowerId((current) => (current === borrowerId ? '' : current));
        }
    }, [borrowers, historyBorrowerId, requestBorrowersApi, toast, updateDraft.borrowerId, writeCachedBorrowers]);

    const openAmountDialog = useCallback((borrowerId, mode) => {
        setUpdateDraft({
            borrowerId,
            mode,
            amount: '',
            note: '',
            requestKey: createBorrowerMutationKey(),
        });
    }, []);

    const handleApplyAmountUpdate = useCallback(async () => {
        if (updateBorrowerInFlightRef.current) return;

        const borrower = borrowers.find((entry) => entry.id === updateDraft.borrowerId);
        if (!borrower) return;

        const rawAmount = parseAmount(updateDraft.amount);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
            toast({
                title: 'Enter a valid amount',
                description: 'Amount must be a positive number such as 500 or 300.',
                variant: 'destructive',
            });
            return;
        }

        const delta = updateDraft.mode === 'reduced' ? -rawAmount : rawAmount;
        const nextAmount = Number((borrower.amount + delta).toFixed(2));
        if (nextAmount < 0) {
            toast({
                title: 'Amount cannot go below zero',
                description: 'The reduction amount cannot be greater than the current outstanding total.',
                variant: 'destructive',
            });
            return;
        }

        updateBorrowerInFlightRef.current = true;
        setIsUpdatingBorrowerAmount(true);

        try {
            const payload = await requestBorrowersApi('PATCH', {
                borrowerId: borrower.id,
                mode: updateDraft.mode,
                amount: rawAmount,
                note: normalizeBorrowerText(updateDraft.note),
                operationKey: updateDraft.requestKey || createBorrowerMutationKey(),
            });
            const savedBorrower = createBorrowerCard(payload?.borrower || borrower);
            const nextBorrowers = sortBorrowersByLastEdited([
                savedBorrower,
                ...borrowers.filter((entry) => entry.id !== savedBorrower.id),
            ]);

            setBorrowers(nextBorrowers);
            await writeCachedBorrowers(nextBorrowers);
            setUpdateDraft(INITIAL_UPDATE_DRAFT);
            toast({
                title: updateDraft.mode === 'reduced' ? 'Amount reduced' : 'Amount added',
                description: `${updateDraft.mode === 'reduced' ? 'Reduced' : 'Added'} ${formatCurrency(rawAmount)} successfully.`,
                variant: 'success',
            });
        } catch (error) {
            toast({
                title: 'Unable to update amount',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            updateBorrowerInFlightRef.current = false;
            setIsUpdatingBorrowerAmount(false);
        }
    }, [borrowers, requestBorrowersApi, toast, updateDraft.amount, updateDraft.borrowerId, updateDraft.mode, updateDraft.note, updateDraft.requestKey, writeCachedBorrowers]);

    return (
        <>
            <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-muted-foreground">
                            Owner Dashboard
                        </p>
                        <h1 className="mt-2 flex items-center gap-3 text-3xl font-black tracking-tight text-foreground">
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                                <Banknote className="h-6 w-6" />
                            </span>
                            Borrowers
                        </h1>
                        <p className="mt-3 text-sm text-muted-foreground">
                            Borrower details are captured once. After that, each card stays in summary mode and only the red and green amount buttons are used.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <OfflineDesktopStatus />
                        <Button type="button" onClick={openCreateDialog} className="h-11 rounded-xl px-4" disabled={isCreatingBorrower || isUpdatingBorrowerAmount || Boolean(isDeletingBorrowerId)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Borrower
                        </Button>
                    </div>
                </div>

                <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-sm backdrop-blur sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center gap-3">
                        <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
                            {borrowers.length} borrower card{borrowers.length === 1 ? '' : 's'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Synced to your account and cached locally for faster reloads.
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-6 py-12 text-sm text-muted-foreground">
                            Loading borrowers...
                        </div>
                    ) : borrowers.length === 0 ? (
                        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted/20 via-background to-muted/10 px-6 py-12 text-center">
                            <div className="inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                                <Banknote className="h-8 w-8" />
                            </div>
                            <h2 className="mt-4 text-xl font-bold text-foreground">No borrowers added yet</h2>
                            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                                Start with the Add Borrower button to create a borrower card with amount tracking.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                            {borrowers.map((borrower, index) => (
                                <motion.div
                                    key={borrower.id}
                                    initial={{ opacity: 0, y: 16 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.18) }}
                                >
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setHistoryBorrowerId(borrower.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setHistoryBorrowerId(borrower.id);
                                            }
                                        }}
                                        className="rounded-2xl border border-border bg-background p-4 shadow-sm transition-colors hover:border-primary/40"
                                    >
                                        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-background px-4 py-3">
                                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-600">
                                                Outstanding
                                            </p>
                                            <p className="mt-2 text-3xl font-black tracking-tight text-foreground">
                                                {formatCurrency(borrower.amount)}
                                            </p>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                <span className="truncate">{borrower.name || 'No name saved'}</span>
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Phone className="h-4 w-4" />
                                                <span className="truncate">{borrower.phone || 'No phone saved'}</span>
                                            </div>

                                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                                <span className="line-clamp-2">{borrower.address || 'No address saved'}</span>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex gap-2" onClick={(event) => event.stopPropagation()}>
                                            <Button
                                                type="button"
                                                onClick={() => openAmountDialog(borrower.id, 'reduced')}
                                                disabled={isLoading || isUpdatingBorrowerAmount || isCreatingBorrower || Boolean(isDeletingBorrowerId)}
                                                className="h-10 flex-1 rounded-xl bg-red-600 text-white hover:bg-red-700"
                                            >
                                                <ArrowDownLeft className="mr-2 h-4 w-4" />
                                                Reduce
                                            </Button>
                                            <Button
                                                type="button"
                                                onClick={() => openAmountDialog(borrower.id, 'added')}
                                                disabled={isLoading || isUpdatingBorrowerAmount || isCreatingBorrower || Boolean(isDeletingBorrowerId)}
                                                className="h-10 flex-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                                            >
                                                <ArrowUpRight className="mr-2 h-4 w-4" />
                                                Add
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
                if (isCreatingBorrower) return;
                setIsCreateDialogOpen(open);
            }}>
                <DialogContent className="max-w-md bg-card text-foreground">
                    <DialogHeader>
                        <DialogTitle>Create Borrower</DialogTitle>
                        <DialogDescription>
                            Save borrower details once. After that, the card only needs amount updates.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <input
                                type="text"
                                value={createDraft.name}
                                onChange={(event) => setCreateDraft((prev) => ({ ...prev, name: event.target.value }))}
                                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                                placeholder="Borrower name"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Phone</Label>
                            <input
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={10}
                                value={createDraft.phone}
                                onChange={(event) => setCreateDraft((prev) => ({
                                    ...prev,
                                    phone: normalizeBorrowerPhone(event.target.value),
                                }))}
                                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                                placeholder="10-digit phone number"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Address</Label>
                            <textarea
                                rows={3}
                                value={createDraft.address}
                                onChange={(event) => setCreateDraft((prev) => ({ ...prev, address: event.target.value }))}
                                className="w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                                placeholder="Optional address"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)} disabled={isCreatingBorrower}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleCreateBorrower} disabled={isCreatingBorrower}>
                            {isCreatingBorrower ? 'Saving...' : 'Create Card'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(updateTargetBorrower)} onOpenChange={(open) => {
                if (isUpdatingBorrowerAmount) return;
                if (!open) setUpdateDraft(INITIAL_UPDATE_DRAFT);
            }}>
                <DialogContent className="max-w-md bg-card text-foreground">
                    <DialogHeader>
                        <DialogTitle>{updateDraft.mode === 'reduced' ? 'Reduce Amount' : 'Add Amount'}</DialogTitle>
                        <DialogDescription>
                            {updateTargetBorrower
                                ? `${updateDraft.mode === 'reduced' ? 'Reduce' : 'Add'} an amount for ${updateTargetBorrower.name || updateTargetBorrower.phone || 'this borrower'}. Current total: ${formatCurrency(updateTargetBorrower.amount)}`
                                : 'Update borrower amount'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Amount</Label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={updateDraft.amount}
                                onChange={(event) => setUpdateDraft((prev) => ({ ...prev, amount: event.target.value }))}
                                className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                                placeholder="e.g. 500"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Notes</Label>
                            <textarea
                                rows={3}
                                value={updateDraft.note}
                                onChange={(event) => setUpdateDraft((prev) => ({ ...prev, note: event.target.value }))}
                                className="w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                                placeholder="Optional note for this update"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setUpdateDraft(INITIAL_UPDATE_DRAFT)} disabled={isUpdatingBorrowerAmount}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleApplyAmountUpdate}
                            disabled={isUpdatingBorrowerAmount}
                            className={cn(
                                updateDraft.mode === 'reduced'
                                    ? 'bg-red-600 text-white hover:bg-red-700'
                                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            )}
                        >
                            {isUpdatingBorrowerAmount
                                ? 'Saving...'
                                : updateDraft.mode === 'reduced'
                                    ? 'Reduce Amount'
                                    : 'Add Amount'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(selectedHistoryBorrower)} onOpenChange={(open) => { if (!open) setHistoryBorrowerId(''); }}>
                <DialogContent className="flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden bg-card p-0 text-foreground sm:max-h-[90vh] sm:w-full">
                    <DialogHeader className="shrink-0 border-b border-border px-5 pb-4 pt-5 text-left sm:px-6">
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <History className="h-5 w-5" />
                            Borrower History
                        </DialogTitle>
                        <DialogDescription>
                            {selectedHistoryBorrower
                                ? `History for ${selectedHistoryBorrower.name || selectedHistoryBorrower.phone || 'this borrower'}. Current total: ${formatCurrency(selectedHistoryBorrower.amount)}`
                                : 'Borrower history'}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedHistoryBorrower ? (
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                            <div className="space-y-4 pr-1">
                                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                    <div className="grid gap-2 text-sm text-muted-foreground">
                                        <div className="flex items-center gap-2">
                                            <User className="h-4 w-4" />
                                            <span>{selectedHistoryBorrower.name || 'No name saved'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Phone className="h-4 w-4" />
                                            <span>{selectedHistoryBorrower.phone || 'No phone saved'}</span>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                            <span>{selectedHistoryBorrower.address || 'No address saved'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Clock3 className="h-4 w-4" />
                                            <span>Last edited {formatBorrowerLastEdited(selectedHistoryBorrower.lastEditedAt)}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-background px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-600">Current Amount</p>
                                        <p className="mt-1 text-2xl font-black text-foreground">{formatCurrency(selectedHistoryBorrower.amount)}</p>
                                    </div>
                                </div>

                                {selectedHistoryBorrower.history.length > 0 ? (
                                    <div className="space-y-3">
                                        {selectedHistoryBorrower.history.map((entry) => {
                                            const isReduced = entry.type === 'reduced';
                                            return (
                                                <div key={entry.id} className="rounded-2xl border border-border bg-muted/20 p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn(
                                                                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold',
                                                                    isReduced
                                                                        ? 'bg-red-500/10 text-red-700'
                                                                        : 'bg-emerald-500/10 text-emerald-700'
                                                                )}>
                                                                    {isReduced ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                                                                    {isReduced ? 'Reduced' : 'Added'}
                                                                </span>
                                                                <span className="text-sm font-semibold text-foreground">
                                                                    {isReduced ? '-' : '+'}{formatCurrency(entry.amount)}
                                                                </span>
                                                            </div>
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                {formatBorrowerLastEdited(entry.updatedAt)}
                                                            </p>
                                                        </div>

                                                        <div className="text-right">
                                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Resulting total</p>
                                                            <p className="text-lg font-black text-foreground">{formatCurrency(entry.resultingAmount)}</p>
                                                        </div>
                                                    </div>

                                                    {entry.note && (
                                                        <div className="mt-3 rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                                                            {entry.note}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-border bg-muted/10 px-4 py-10 text-center">
                                        <p className="text-sm font-semibold text-foreground">No history yet</p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Amount changes will appear here after you use the Add or Reduce buttons.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}

                    {selectedHistoryBorrower && (
                        <DialogFooter className="shrink-0 border-t border-border px-5 pb-5 pt-4 sm:px-6 sm:gap-0">
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={() => handleDeleteBorrower(selectedHistoryBorrower.id)}
                                disabled={isDeletingBorrowerId === selectedHistoryBorrower.id}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {isDeletingBorrowerId === selectedHistoryBorrower.id ? 'Deleting...' : 'Delete Borrower'}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
