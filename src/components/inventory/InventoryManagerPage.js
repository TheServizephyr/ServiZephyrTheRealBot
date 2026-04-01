'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, ArrowDown, ArrowUp, Boxes, History } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

function appendAccessParams(baseUrl, impersonatedOwnerId, employeeOfOwnerId) {
    const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (impersonatedOwnerId) {
        url.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
    } else if (employeeOfOwnerId) {
        url.searchParams.set('employee_of', employeeOfOwnerId);
    }
    return `${url.pathname}${url.search}`;
}

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function formatLedgerDate(value) {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

async function readInventoryCache(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.data) return parsed.data;
        }
    } catch {
        // Ignore malformed local cache.
    }

    if (!isDesktopApp()) return null;
    const desktopPayload = await getOfflineNamespace('owner_inventory', cacheKey, null);
    return desktopPayload?.data || null;
}

async function writeInventoryCache(cacheKey, data) {
    const payload = { ts: Date.now(), data };
    try {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
        // Ignore local storage issues.
    }
    if (isDesktopApp()) {
        await setOfflineNamespace('owner_inventory', cacheKey, payload);
    }
}

export default function InventoryManagerPage({ title = 'Inventory Management', subtitle = 'Track stock and keep items ready for orders.' }) {
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [adjustingId, setAdjustingId] = useState(null);
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [query, setQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [stockDrafts, setStockDrafts] = useState({});
    const [viewMode, setViewMode] = useState('all');
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [loadingLedger, setLoadingLedger] = useState(false);
    const [bulkDraft, setBulkDraft] = useState('');
    const [bulkUpdating, setBulkUpdating] = useState(false);
    const inventoryCacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_inventory::${scope}`;
    }, [employeeOfOwnerId, impersonatedOwnerId]);

    const loadInventory = useCallback(async (searchTerm = '') => {
        setLoading(true);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');

            const idToken = await user.getIdToken();
            const basePath = '/api/owner/inventory';
            const url = appendAccessParams(basePath, impersonatedOwnerId, employeeOfOwnerId);
            const urlObj = new URL(url, window.location.origin);
            urlObj.searchParams.set('limit', '200');
            if (searchTerm.trim()) {
                urlObj.searchParams.set('q', searchTerm.trim().toLowerCase());
            }

            const response = await fetch(urlObj.pathname + urlObj.search, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to fetch inventory.');

            const nextItems = Array.isArray(data.items) ? data.items : [];
            setItems(nextItems);
            await writeInventoryCache(inventoryCacheKey, {
                items: nextItems,
                ledgerEntries,
            });
        } catch (fetchError) {
            const cached = await readInventoryCache(inventoryCacheKey);
            if (cached?.items) {
                setItems(Array.isArray(cached.items) ? cached.items : []);
                if (Array.isArray(cached.ledgerEntries)) {
                    setLedgerEntries(cached.ledgerEntries);
                }
                setError('Showing cached inventory because the live fetch failed.');
            } else {
                setError(fetchError.message || 'Failed to load inventory.');
            }
        } finally {
            setLoading(false);
        }
    }, [employeeOfOwnerId, impersonatedOwnerId, inventoryCacheKey, ledgerEntries]);

    useEffect(() => {
        loadInventory('');
    }, [loadInventory]);

    const loadLedger = useCallback(async () => {
        setLoadingLedger(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');
            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/ledger?limit=20', impersonatedOwnerId, employeeOfOwnerId);
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to fetch inventory ledger.');
            const nextEntries = Array.isArray(data.entries) ? data.entries : [];
            setLedgerEntries(nextEntries);
            await writeInventoryCache(inventoryCacheKey, {
                items,
                ledgerEntries: nextEntries,
            });
        } catch (ledgerError) {
            setError(ledgerError.message || 'Failed to load inventory ledger.');
        } finally {
            setLoadingLedger(false);
        }
    }, [employeeOfOwnerId, impersonatedOwnerId, inventoryCacheKey, items]);

    useEffect(() => {
        loadLedger();
    }, [loadLedger]);

    useEffect(() => {
        setStockDrafts((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
                const id = item.id;
                if (!id) return;
                if (next[id] === undefined) {
                    next[id] = String(toNumber(item.stockOnHand, 0));
                }
            });
            return next;
        });
    }, [items]);

    const runSyncFromMenu = async () => {
        setSyncing(true);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');

            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/sync-from-menu', impersonatedOwnerId, employeeOfOwnerId);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Sync failed.');

            setSuccess(`Done. ${data.created} items added to stock and ${data.updated} items updated.`);
            await Promise.all([loadInventory(query), loadLedger()]);
        } catch (syncError) {
            setError(syncError.message || 'Sync failed.');
        } finally {
            setSyncing(false);
        }
    };

    const adjustStock = async (itemId, qtyDelta) => {
        setAdjustingId(itemId);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');
            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/adjust', impersonatedOwnerId, employeeOfOwnerId);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    itemId,
                    qtyDelta,
                    reason: 'manual_adjustment',
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Adjustment failed.');

            const updatedItem = data.item || {};
            setItems((prev) =>
                prev.map((item) =>
                    item.id === itemId
                        ? {
                            ...item,
                            stockOnHand: updatedItem.stockOnHand,
                            reserved: updatedItem.reserved,
                            available: updatedItem.available,
                        }
                        : item
                )
            );
            setStockDrafts((prev) => ({
                ...prev,
                [itemId]: String(toNumber(updatedItem.stockOnHand, 0)),
            }));
            setSuccess('Stock updated.');
            await loadLedger();
        } catch (adjustError) {
            setError(adjustError.message || 'Adjustment failed.');
        } finally {
            setAdjustingId(null);
        }
    };

    const setAbsoluteStock = async (item) => {
        const itemId = item?.id;
        if (!itemId) return;

        const currentStock = toNumber(item?.stockOnHand, 0);
        const targetRaw = stockDrafts[itemId];
        const targetStock = Number(targetRaw);

        if (!Number.isFinite(targetStock) || targetStock < 0) {
            setError('Please enter a valid stock number (0 or more).');
            return;
        }

        const qtyDelta = targetStock - currentStock;
        if (qtyDelta === 0) {
            setSuccess('Stock is already same.');
            return;
        }

        await adjustStock(itemId, qtyDelta);
    };

    const runBulkUpdate = async () => {
        const lines = bulkDraft
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length === 0) {
            setError('Paste at least one line in the format itemId,stock or sku,stock.');
            return;
        }

        const skuLookup = new Map(items.map((item) => [String(item.sku || '').trim().toLowerCase(), item.id]));
        const updates = [];
        for (const line of lines) {
            const [rawKey, rawStock] = line.split(',').map((value) => String(value || '').trim());
            const stockOnHand = Number(rawStock);
            const normalizedKey = rawKey.toLowerCase();
            const itemId = skuLookup.get(normalizedKey) || rawKey;

            if (!rawKey || !Number.isFinite(stockOnHand) || stockOnHand < 0) {
                setError(`Invalid bulk line: "${line}". Use itemId,stock or sku,stock.`);
                return;
            }

            updates.push({ itemId, stockOnHand });
        }

        setBulkUpdating(true);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');
            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/bulk-update', impersonatedOwnerId, employeeOfOwnerId);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ updates }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Bulk stock update failed.');

            setSuccess(`Bulk stock update done for ${data.updated || updates.length} item(s).`);
            setBulkDraft('');
            await Promise.all([loadInventory(query), loadLedger()]);
        } catch (bulkError) {
            setError(bulkError.message || 'Bulk stock update failed.');
        } finally {
            setBulkUpdating(false);
        }
    };

    const summary = useMemo(() => {
        const total = items.length;
        const outOfStock = items.filter((item) => toNumber(item.available) <= 0).length;
        const lowStock = items.filter((item) => {
            const reorderLevel = toNumber(item.reorderLevel, 0);
            if (reorderLevel <= 0) return false;
            return toNumber(item.available) <= reorderLevel;
        }).length;
        return { total, outOfStock, lowStock };
    }, [items]);

    const visibleItems = useMemo(() => {
        if (viewMode === 'out_of_stock') {
            return items.filter((item) => toNumber(item.available) <= 0);
        }
        if (viewMode === 'low_stock') {
            return items.filter((item) => {
                const reorderLevel = toNumber(item.reorderLevel, 0);
                return reorderLevel > 0 && toNumber(item.available) > 0 && toNumber(item.available) <= reorderLevel;
            });
        }
        if (viewMode === 'reorder') {
            return items.filter((item) => {
                const reorderLevel = toNumber(item.reorderLevel, 0);
                const reorderQty = toNumber(item.reorderQty, 0);
                return reorderLevel > 0 && reorderQty > 0 && toNumber(item.available) <= reorderLevel;
            });
        }
        return items;
    }, [items, viewMode]);

    const onSearchSubmit = (event) => {
        event.preventDefault();
        const normalized = searchDraft.trim().toLowerCase();
        setQuery(normalized);
        loadInventory(normalized);
    };

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                    <p className="text-muted-foreground mt-1">{subtitle}</p>
                    <div className="mt-2">
                        <OfflineDesktopStatus />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => loadInventory(query)} disabled={loading || syncing}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" onClick={loadLedger} disabled={loadingLedger || loading}>
                        <History className={`mr-2 h-4 w-4 ${loadingLedger ? 'animate-spin' : ''}`} />
                        Ledger
                    </Button>
                    <Button onClick={runSyncFromMenu} disabled={syncing || loading}>
                        {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                        Import Existing Items
                    </Button>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">How this works:</p>
                <p>1. Add/Delete products in Items tab.</p>
                <p>2. Open this Stock tab to update quantity.</p>
                <p>3. First time only: click <span className="text-foreground font-medium">Import Existing Items</span> to bring current items into stock manager.</p>
            </div>

            {error ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
            ) : null}
            {success ? (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">{success}</div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Total Items</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.total}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Low Stock</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.lowStock}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Out of Stock</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.outOfStock}</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button variant={viewMode === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('all')}>
                    All Items
                </Button>
                <Button variant={viewMode === 'low_stock' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('low_stock')}>
                    Low Stock
                </Button>
                <Button variant={viewMode === 'out_of_stock' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('out_of_stock')}>
                    Out Of Stock
                </Button>
                <Button variant={viewMode === 'reorder' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('reorder')}>
                    Reorder Needed
                </Button>
            </div>

            <form onSubmit={onSearchSubmit} className="flex flex-col gap-2 md:flex-row">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                        placeholder="Search by item name, SKU, barcode"
                        className="pl-9"
                    />
                </div>
                <Button type="submit" variant="outline" disabled={loading}>Search</Button>
            </form>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="font-medium text-foreground">Bulk Stock Update</p>
                    <p className="mt-1 text-sm text-muted-foreground">Paste one line per item: `itemId,stock` or `sku,stock`.</p>
                    <textarea
                        value={bulkDraft}
                        onChange={(event) => setBulkDraft(event.target.value)}
                        placeholder={"SKU-001,24\nitem_doc_id,8"}
                        className="mt-3 min-h-[130px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <div className="mt-3 flex justify-end">
                        <Button onClick={runBulkUpdate} disabled={bulkUpdating || loading}>
                            {bulkUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Apply Bulk Update
                        </Button>
                    </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="font-medium text-foreground">Recent Inventory Activity</p>
                            <p className="mt-1 text-sm text-muted-foreground">Latest stock adjustments, sales, restores, and count corrections.</p>
                        </div>
                    </div>
                    <div className="mt-3 max-h-[220px] overflow-auto">
                        {loadingLedger ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                                Loading ledger...
                            </div>
                        ) : ledgerEntries.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">No inventory activity yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {ledgerEntries.map((entry) => (
                                    <div key={entry.id} className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-foreground">{entry.name || entry.itemId}</span>
                                            <span className="text-xs text-muted-foreground">{formatLedgerDate(entry.createdAt)}</span>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                            <span>{entry.type || 'update'}{entry.sku ? ` • ${entry.sku}` : ''}</span>
                                            <span>{Number(entry.qtyDelta || 0) >= 0 ? '+' : ''}{entry.qtyDelta || 0}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border bg-muted/30">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Item Name</th>
                                <th className="px-4 py-3 text-left font-medium">SKU</th>
                                <th className="px-4 py-3 text-right font-medium">Stock In Hand</th>
                                <th className="px-4 py-3 text-right font-medium">Reserved</th>
                                <th className="px-4 py-3 text-right font-medium">Sellable Stock</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                                        Loading inventory...
                                    </td>
                                </tr>
                            ) : visibleItems.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                                        {items.length === 0 ? 'No stock items found. Click "Import Existing Items" once.' : 'No items match this inventory view.'}
                                    </td>
                                </tr>
                            ) : (
                                visibleItems.map((item) => {
                                    const onHand = toNumber(item.stockOnHand, 0);
                                    const reserved = toNumber(item.reserved, 0);
                                    const available = toNumber(item.available, onHand - reserved);
                                    return (
                                        <tr key={item.id} className="border-b border-border/60">
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{item.name || 'Unnamed Item'}</div>
                                                <div className="text-xs text-muted-foreground">{item.categoryId || 'general'}</div>
                                            </td>
                                            <td className="px-4 py-3">{item.sku || '-'}</td>
                                            <td className="px-4 py-3 text-right">{onHand}</td>
                                            <td className="px-4 py-3 text-right">{reserved}</td>
                                            <td className="px-4 py-3 text-right">{available}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2 flex-wrap">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => adjustStock(item.id, -1)}
                                                    >
                                                        <ArrowDown className="h-4 w-4 mr-1" />
                                                        -1
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => adjustStock(item.id, 1)}
                                                    >
                                                        {adjustingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4 mr-1" />}
                                                        +1
                                                    </Button>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        value={stockDrafts[item.id] ?? String(onHand)}
                                                        onChange={(event) =>
                                                            setStockDrafts((prev) => ({
                                                                ...prev,
                                                                [item.id]: event.target.value,
                                                            }))
                                                        }
                                                        className="h-8 w-20 text-right"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="default"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => setAbsoluteStock(item)}
                                                    >
                                                        Set Stock
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
