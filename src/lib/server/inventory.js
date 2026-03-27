import { FieldValue } from '@/lib/firebase-admin';

export const INVENTORY_COLLECTION = 'inventory_items';
export const INVENTORY_LEDGER_COLLECTION = 'inventory_ledger';
export const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

const MAX_TOKEN_LENGTH = 40;

export function normalizeSearchValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

export function buildSearchTokens(...values) {
    const tokens = new Set();

    values
        .flat()
        .forEach((value) => {
            const normalized = normalizeSearchValue(value);
            if (!normalized) return;

            tokens.add(normalized.slice(0, MAX_TOKEN_LENGTH));

            normalized
                .split(/[^a-z0-9]+/g)
                .filter(Boolean)
                .forEach((part) => {
                    tokens.add(part.slice(0, MAX_TOKEN_LENGTH));
                });
        });

    return Array.from(tokens).slice(0, 50);
}

export function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function calculateAvailable(onHand, reserved = 0) {
    const normalizedOnHand = toFiniteNumber(onHand, 0);
    const normalizedReserved = toFiniteNumber(reserved, 0);
    return Math.max(normalizedOnHand - normalizedReserved, 0);
}

export function deriveSellPrice(menuItem = {}) {
    if (Array.isArray(menuItem.portions) && menuItem.portions.length > 0) {
        const fullPortion = menuItem.portions.find(
            (portion) => String(portion?.name || '').trim().toLowerCase() === 'full'
        );
        return toFiniteNumber(fullPortion?.price ?? menuItem.portions[0]?.price, 0);
    }
    return toFiniteNumber(menuItem.price, 0);
}

export function createFallbackSku(name, itemId) {
    const normalizedName = normalizeSearchValue(name).replace(/[^a-z0-9]+/g, '');
    const prefix = (normalizedName.slice(0, 6) || 'item').toUpperCase();
    const suffix = String(itemId || '').slice(-4).toUpperCase();
    return `${prefix}-${suffix || '0000'}`;
}

export function createInventoryPayloadFromMenuItem(menuItemDoc, existingInventory = null) {
    const itemId = menuItemDoc.id;
    const menuItem = menuItemDoc.data() || {};
    const current = existingInventory || {};

    const stockOnHand = toFiniteNumber(
        current.stockOnHand,
        toFiniteNumber(menuItem.stockOnHand, toFiniteNumber(menuItem.stockQuantity, 0))
    );
    const reserved = toFiniteNumber(current.reserved, 0);
    const available = calculateAvailable(stockOnHand, reserved);
    const sellPrice = toFiniteNumber(current.sellPrice, deriveSellPrice(menuItem));
    const sku = String(current.sku || menuItem.sku || createFallbackSku(menuItem.name, itemId)).trim();
    const barcode = String(current.barcode || menuItem.barcode || '').trim();
    const brand = String(current.brand || menuItem.brand || '').trim();
    const productType = String(current.productType || menuItem.productType || menuItem.type || '').trim();
    const taxClass = String(current.taxClass || menuItem.taxClass || '').trim();
    const supplierSku = String(current.supplierSku || menuItem.supplierSku || '').trim();
    const now = FieldValue.serverTimestamp();

    const payload = {
        itemId,
        sourceMenuItemId: itemId,
        name: String(menuItem.name || 'Unnamed Item').trim(),
        categoryId: String(menuItem.categoryId || 'general').trim(),
        sku,
        barcode,
        brand,
        productType,
        taxClass,
        supplierSku,
        extraBarcodes: Array.isArray(current.extraBarcodes)
            ? current.extraBarcodes
            : (Array.isArray(menuItem.extraBarcodes) ? menuItem.extraBarcodes : []),
        sellPrice,
        menuPrice: deriveSellPrice(menuItem),
        unit: String(current.unit || menuItem.unit || 'unit').trim(),
        packSize: String(current.packSize || menuItem.packSize || '').trim(),
        isActive: menuItem.isAvailable !== false,
        isDeleted: menuItem.isDeleted === true,
        trackInventory: current.trackInventory !== false,
        stockOnHand,
        reserved,
        available,
        reorderLevel: toFiniteNumber(current.reorderLevel, 0),
        reorderQty: toFiniteNumber(current.reorderQty, 0),
        safetyStock: toFiniteNumber(current.safetyStock, 0),
        updatedAt: now,
        lastSyncedFromMenuAt: now,
        searchTokens: buildSearchTokens(
            menuItem.name,
            current.name,
            brand,
            productType,
            taxClass,
            supplierSku,
            sku,
            barcode,
            menuItem.categoryId
        ),
    };

    if (!existingInventory) {
        payload.createdAt = now;
    }

    return payload;
}

export function normalizeAdjustmentReason(reason) {
    const normalized = normalizeSearchValue(reason);
    if (!normalized) return 'manual_adjustment';

    const allowed = new Set([
        'manual_adjustment',
        'purchase',
        'sale',
        'return_in',
        'return_out',
        'damage',
        'expiry',
        'count_correction',
    ]);

    return allowed.has(normalized) ? normalized : 'manual_adjustment';
}

export function isInventoryManagedBusinessType(value) {
    const normalized = normalizeSearchValue(value);
    return normalized === 'shop' || normalized === 'store';
}

export function normalizeInventoryOrderItems(items = []) {
    const aggregated = new Map();

    (Array.isArray(items) ? items : []).forEach((item, index) => {
        const itemId = String(item?.id || item?.itemId || '').trim();
        if (!itemId || itemId.startsWith('manual-item-')) return;

        const quantity = Math.max(1, parseInt(item?.quantity ?? item?.qty ?? 1, 10) || 1);
        const existing = aggregated.get(itemId) || {
            itemId,
            name: String(item?.name || `Item ${index + 1}`).trim() || `Item ${index + 1}`,
            quantity: 0,
        };

        existing.quantity += quantity;
        if (!existing.name && item?.name) {
            existing.name = String(item.name).trim();
        }

        aggregated.set(itemId, existing);
    });

    return Array.from(aggregated.values());
}

function buildInventoryRestorePayload({ itemId, itemName, quantity, actorId }) {
    const stockOnHand = Math.max(0, toFiniteNumber(quantity, 0));
    const reserved = 0;
    const available = calculateAvailable(stockOnHand, reserved);
    const sku = createFallbackSku(itemName, itemId);

    return {
        itemId,
        sourceMenuItemId: itemId,
        name: itemName || 'Restored Item',
        categoryId: 'general',
        sku,
        barcode: '',
        extraBarcodes: [],
        sellPrice: 0,
        menuPrice: 0,
        unit: 'unit',
        packSize: '',
        isActive: true,
        isDeleted: false,
        trackInventory: true,
        stockOnHand,
        reserved,
        available,
        reorderLevel: 0,
        reorderQty: 0,
        safetyStock: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        restoredAt: FieldValue.serverTimestamp(),
        lastAdjustedBy: actorId || null,
        searchTokens: buildSearchTokens(itemName, sku, itemId),
    };
}

export async function applyInventoryMovementTransaction({
    transaction,
    businessRef,
    items = [],
    mode = 'sale',
    actorId = null,
    actorRole = 'system',
    referenceId = null,
    referenceType = 'order',
    note = '',
}) {
    const normalizedItems = normalizeInventoryOrderItems(items);
    if (normalizedItems.length === 0) {
        return { processedItems: [], totalQuantity: 0 };
    }

    const inventoryCollection = businessRef.collection(INVENTORY_COLLECTION);
    const ledgerCollection = businessRef.collection(INVENTORY_LEDGER_COLLECTION);
    const processedItems = [];

    for (const lineItem of normalizedItems) {
        const inventoryRef = inventoryCollection.doc(lineItem.itemId);
        const inventorySnap = await transaction.get(inventoryRef);
        const current = inventorySnap.exists ? (inventorySnap.data() || {}) : null;

        if (mode === 'sale') {
            if (!inventorySnap.exists) {
                throw {
                    status: 409,
                    message: `Inventory item "${lineItem.name}" is not ready yet. Open Inventory once and import existing items before taking orders.`,
                };
            }

            if (current.trackInventory === false) {
                continue;
            }

            const beforeOnHand = toFiniteNumber(current.stockOnHand, 0);
            const reserved = toFiniteNumber(current.reserved, 0);
            const available = toFiniteNumber(current.available, calculateAvailable(beforeOnHand, reserved));

            if (available < lineItem.quantity) {
                throw {
                    status: 409,
                    message: `Only ${available} unit(s) of "${current.name || lineItem.name}" are available right now.`,
                };
            }

            const afterOnHand = beforeOnHand - lineItem.quantity;
            const afterAvailable = calculateAvailable(afterOnHand, reserved);

            transaction.update(inventoryRef, {
                stockOnHand: afterOnHand,
                available: afterAvailable,
                updatedAt: FieldValue.serverTimestamp(),
                lastSoldAt: FieldValue.serverTimestamp(),
                lastAdjustedBy: actorId || null,
            });

            transaction.set(ledgerCollection.doc(), {
                itemId: lineItem.itemId,
                sku: current.sku || null,
                name: current.name || lineItem.name || null,
                type: 'sale',
                qtyDelta: -lineItem.quantity,
                before: {
                    stockOnHand: beforeOnHand,
                    reserved,
                    available,
                },
                after: {
                    stockOnHand: afterOnHand,
                    reserved,
                    available: afterAvailable,
                },
                note: note || null,
                actorId: actorId || null,
                actorRole: actorRole || 'system',
                referenceId: referenceId || null,
                referenceType: referenceType || 'order',
                createdAt: FieldValue.serverTimestamp(),
            });

            processedItems.push({
                itemId: lineItem.itemId,
                name: current.name || lineItem.name,
                quantity: lineItem.quantity,
                beforeOnHand,
                afterOnHand,
            });
            continue;
        }

        const restoreName = current?.name || lineItem.name || 'Restored Item';
        if (!inventorySnap.exists) {
            transaction.set(inventoryRef, buildInventoryRestorePayload({
                itemId: lineItem.itemId,
                itemName: restoreName,
                quantity: lineItem.quantity,
                actorId,
            }));

            transaction.set(ledgerCollection.doc(), {
                itemId: lineItem.itemId,
                sku: createFallbackSku(restoreName, lineItem.itemId),
                name: restoreName,
                type: 'return_in',
                qtyDelta: lineItem.quantity,
                before: {
                    stockOnHand: 0,
                    reserved: 0,
                    available: 0,
                },
                after: {
                    stockOnHand: lineItem.quantity,
                    reserved: 0,
                    available: lineItem.quantity,
                },
                note: note || null,
                actorId: actorId || null,
                actorRole: actorRole || 'system',
                referenceId: referenceId || null,
                referenceType: referenceType || 'order',
                createdAt: FieldValue.serverTimestamp(),
            });

            processedItems.push({
                itemId: lineItem.itemId,
                name: restoreName,
                quantity: lineItem.quantity,
                beforeOnHand: 0,
                afterOnHand: lineItem.quantity,
            });
            continue;
        }

        if (current.trackInventory === false) {
            continue;
        }

        const beforeOnHand = toFiniteNumber(current.stockOnHand, 0);
        const reserved = toFiniteNumber(current.reserved, 0);
        const available = toFiniteNumber(current.available, calculateAvailable(beforeOnHand, reserved));
        const afterOnHand = beforeOnHand + lineItem.quantity;
        const afterAvailable = calculateAvailable(afterOnHand, reserved);

        transaction.update(inventoryRef, {
            stockOnHand: afterOnHand,
            available: afterAvailable,
            updatedAt: FieldValue.serverTimestamp(),
            lastAdjustedBy: actorId || null,
            lastRestoredAt: FieldValue.serverTimestamp(),
        });

        transaction.set(ledgerCollection.doc(), {
            itemId: lineItem.itemId,
            sku: current.sku || null,
            name: restoreName,
            type: 'return_in',
            qtyDelta: lineItem.quantity,
            before: {
                stockOnHand: beforeOnHand,
                reserved,
                available,
            },
            after: {
                stockOnHand: afterOnHand,
                reserved,
                available: afterAvailable,
            },
            note: note || null,
            actorId: actorId || null,
            actorRole: actorRole || 'system',
            referenceId: referenceId || null,
            referenceType: referenceType || 'order',
            createdAt: FieldValue.serverTimestamp(),
        });

        processedItems.push({
            itemId: lineItem.itemId,
            name: restoreName,
            quantity: lineItem.quantity,
            beforeOnHand,
            afterOnHand,
        });
    }

    return {
        processedItems,
        totalQuantity: processedItems.reduce((sum, item) => sum + toFiniteNumber(item.quantity, 0), 0),
    };
}
