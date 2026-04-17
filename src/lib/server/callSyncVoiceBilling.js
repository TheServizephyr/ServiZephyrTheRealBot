import {
    buildVoiceMenuIndex,
    findVoiceTableMatch,
    normalizeVoiceText,
    parseManualOrderVoiceCommand,
    serializeVoiceResolverPayload,
} from '@/lib/manual-order-voice';
import { CALL_SYNC_VOICE_DRAFT_TTL_MS } from '@/lib/call-sync';
import { calculateAvailable, INVENTORY_COLLECTION } from '@/lib/server/inventory';
import { resolveCallSyncTokenBinding } from '@/lib/server/callSyncTokens';
import {
    coerceCallSyncVoiceDraft,
    createEmptyCallSyncVoiceDraft,
    readCallSyncVoiceDraft,
    writeCallSyncVoiceDraft,
} from '@/lib/server/callSyncVoiceDraft';
import { resolveManualOrderVoiceWithAi } from '@/lib/server/manualOrderVoiceAi';

function normalizeBusinessType(value, collectionName = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
    if (normalized === 'restaurant') return 'restaurant';
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

function normalizeCompactPortions(item = {}) {
    if (Array.isArray(item?.portions) && item.portions.length > 0) {
        return item.portions.map((portion) => ({
            name: String(portion?.name || 'Regular'),
            price: Number(portion?.price ?? item?.price ?? 0) || 0,
        }));
    }

    const fallbackPrice = Number(item?.price ?? 0);
    return [{ name: 'Regular', price: Number.isFinite(fallbackPrice) ? fallbackPrice : 0 }];
}

function getItemAvailableStock(item = {}) {
    const raw = item?.availableStock ?? item?.available;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mergeMenuWithInventory(menu = {}, inventoryMap = {}) {
    return Object.fromEntries(
        Object.entries(menu || {}).map(([categoryId, items]) => [
            categoryId,
            Array.isArray(items)
                ? items.map((menuItem) => {
                    const stockInfo = inventoryMap[menuItem?.id] || null;
                    return {
                        ...menuItem,
                        availableStock: stockInfo ? getItemAvailableStock(stockInfo) : getItemAvailableStock(menuItem),
                        stockOnHand: stockInfo?.stockOnHand ?? menuItem?.stockOnHand,
                        reservedStock: stockInfo?.reserved ?? menuItem?.reservedStock,
                    };
                })
                : [],
        ])
    );
}

function toIsoString(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sortManualTablesByName(tables = []) {
    return [...tables].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
    }));
}

async function loadManualTablesForVoice(businessRef) {
    const snapshot = await businessRef.collection('manual_tables').get();
    return sortManualTablesByName(snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const currentOrder = data.currentOrder || null;
        return {
            id: doc.id,
            name: data.name || doc.id,
            status: data.status || 'available',
            currentOrder: currentOrder ? {
                ...currentOrder,
                occupiedAt: toIsoString(currentOrder.occupiedAt),
                orderDate: toIsoString(currentOrder.orderDate),
            } : null,
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
        };
    }));
}

async function loadVoiceMenuContext(businessRef, businessType = 'restaurant') {
    const [menuSnap, inventorySnap] = await Promise.all([
        businessRef.collection('menu').orderBy('order', 'asc').get(),
        businessType === 'store'
            ? businessRef.collection(INVENTORY_COLLECTION).get()
            : Promise.resolve(null),
    ]);

    const menu = {};
    menuSnap.docs
        .filter((doc) => doc.data()?.isDeleted !== true)
        .forEach((doc) => {
            const item = doc.data() || {};
            const categoryId = String(item?.categoryId || 'general').trim() || 'general';
            if (!menu[categoryId]) menu[categoryId] = [];
            menu[categoryId].push({
                id: doc.id,
                name: String(item?.name || 'Unnamed Item'),
                categoryId,
                isVeg: !!item?.isVeg,
                isAvailable: item?.isAvailable !== false,
                portions: normalizeCompactPortions(item),
                price: Number(item?.price ?? item?.portions?.[0]?.price ?? 0) || 0,
                tags: Array.isArray(item?.tags) ? item.tags : [],
                availableStock: getItemAvailableStock(item),
            });
        });

    if (businessType !== 'store' || !inventorySnap) {
        return menu;
    }

    const inventoryMap = inventorySnap.docs.reduce((acc, doc) => {
        const data = doc.data() || {};
        const stockOnHand = Number(data.stockOnHand || 0);
        const reserved = Number(data.reserved || 0);
        acc[doc.id] = {
            id: doc.id,
            ...data,
            stockOnHand,
            reserved,
            available: Number.isFinite(Number(data.available))
                ? Number(data.available)
                : calculateAvailable(stockOnHand, reserved),
        };
        return acc;
    }, {});

    return mergeMenuWithInventory(menu, inventoryMap);
}

function resolveVoiceSaleOption(entry = {}, explicitPortionName = '', requestedPortion = '') {
    const options = Array.isArray(entry?.saleOptions) ? entry.saleOptions : [];
    if (options.length === 0) return null;

    const normalizedNeedles = [
        String(explicitPortionName || '').trim(),
        String(requestedPortion || '').trim(),
    ]
        .map((value) => normalizeVoiceText(value))
        .filter(Boolean);

    const findOption = (needle = '') => {
        const normalizedNeedle = normalizeVoiceText(needle);
        if (!normalizedNeedle) return null;
        return options.find((option) => {
            const optionName = normalizeVoiceText(option?.name);
            const optionLabel = normalizeVoiceText(option?.label);
            return (
                optionName === normalizedNeedle ||
                optionLabel === normalizedNeedle ||
                optionName.includes(normalizedNeedle) ||
                optionLabel.includes(normalizedNeedle)
            );
        }) || null;
    };

    for (const needle of normalizedNeedles) {
        const match = findOption(needle);
        if (match) return match;
    }

    if (options.length === 1) return options[0];
    return options.find((option) => {
        const normalizedLabel = normalizeVoiceText(option?.label || option?.name);
        return normalizedLabel === 'regular' || normalizedLabel === 'full' || normalizedLabel === 'unit';
    }) || options[0];
}

function buildResolvedVoiceSelection(voiceMenuIndex = [], selection = {}) {
    const entryId = String(selection?.entryId || selection?.itemId || '').trim();
    if (!entryId) return null;

    const entry = voiceMenuIndex.find((candidate) => candidate.entryId === entryId || candidate.itemId === entryId);
    if (!entry?.item) return null;

    const selectedOption = resolveVoiceSaleOption(entry, selection?.portionName, selection?.requestedPortion);
    if (!selectedOption) return null;

    return {
        lineId: selection?.lineId || null,
        entry,
        item: entry.item,
        quantity: Math.max(1, parseInt(selection?.quantity, 10) || 1),
        requestedPortion: selection?.requestedPortion || '',
        commandAction: selection?.commandAction || 'add',
        spokenText: selection?.spokenText || '',
        selectedOption,
    };
}

function buildVoiceSelectionLabel(selection = {}) {
    const itemName = String(selection?.item?.name || selection?.entry?.name || 'Item').trim() || 'Item';
    const explicitPortion = String(selection?.requestedPortion || '').trim();
    const selectedPortion = String(selection?.selectedOption?.label || selection?.selectedOption?.name || '').trim();
    const shouldShowSelectedPortion = Boolean(
        explicitPortion ||
        (
            (selection?.commandAction || 'add') === 'add' &&
            Array.isArray(selection?.item?.portions) &&
            selection.item.portions.length > 1
        )
    );
    const portionLabel = explicitPortion || (shouldShowSelectedPortion ? selectedPortion : '');
    return portionLabel ? `${itemName} (${portionLabel})` : itemName;
}

function doesCartItemMatchVoiceSelection(cartItem = {}, selection = {}, requireSpecificPortion = false) {
    const targetItemId = String(selection?.item?.id || selection?.entry?.itemId || '').trim();
    if (!targetItemId || String(cartItem?.id || '').trim() !== targetItemId) {
        return false;
    }

    if (!requireSpecificPortion) return true;

    const cartPortion = normalizeVoiceText(cartItem?.portion?.label || cartItem?.portion?.name || 'regular');
    const targetPortion = normalizeVoiceText(
        selection?.selectedOption?.label ||
        selection?.selectedOption?.name ||
        selection?.requestedPortion ||
        ''
    );
    return Boolean(targetPortion) && cartPortion === targetPortion;
}

function createCartItemFromSelection(selection = {}) {
    const sourceItem = selection?.item || {};
    const selectedOption = selection?.selectedOption || {};
    const quantity = Math.max(1, parseInt(selection?.quantity, 10) || 1);
    const cartItemId = `${sourceItem.id}-${selectedOption.name}`;
    const portions = Array.isArray(sourceItem?.portions) ? sourceItem.portions : [];
    const hasMultiplePortions = portions.length > 1;

    const cartItem = {
        id: String(sourceItem?.id || '').trim(),
        name: String(sourceItem?.name || 'Item').trim(),
        categoryId: String(sourceItem?.categoryId || selection?.entry?.categoryId || 'manual').trim() || 'manual',
        isVeg: sourceItem?.isVeg === true,
        quantity,
        cartItemId,
        price: Number(selectedOption?.price || 0) || 0,
        totalPrice: (Number(selectedOption?.price || 0) || 0) * quantity,
    };

    if (portions.length > 0) {
        cartItem.portionCount = portions.length;
    }
    if (hasMultiplePortions || normalizeVoiceText(selectedOption?.label || selectedOption?.name) !== 'regular') {
        cartItem.portion = {
            name: String(selectedOption?.name || '').trim(),
            label: String(selectedOption?.label || selectedOption?.name || '').trim(),
            price: Number(selectedOption?.price || 0) || 0,
        };
    }

    return cartItem;
}

function appendResolvedVoiceItemsToCart(cartItems = [], resolvedSelections = []) {
    const nextCart = Array.isArray(cartItems) ? [...cartItems] : [];
    const addedLabels = [];

    resolvedSelections.forEach((selection) => {
        if (!selection?.item || !selection?.selectedOption) return;

        const quantityToAdd = Math.max(1, parseInt(selection.quantity, 10) || 1);
        const cartItemId = `${selection.item.id}-${selection.selectedOption.name}`;
        const existingIndex = nextCart.findIndex((cartItem) => cartItem.cartItemId === cartItemId);
        const existingItem = existingIndex >= 0 ? nextCart[existingIndex] : null;

        if (existingItem) {
            const nextQuantity = Number(existingItem.quantity || 0) + quantityToAdd;
            nextCart[existingIndex] = {
                ...existingItem,
                quantity: nextQuantity,
                totalPrice: Number(existingItem.price || 0) * nextQuantity,
            };
        } else {
            nextCart.push(createCartItemFromSelection(selection));
        }

        const portionLabel = Array.isArray(selection.item?.portions) && selection.item.portions.length > 1
            ? ` (${selection.selectedOption.label || selection.selectedOption.name})`
            : '';
        addedLabels.push(`${quantityToAdd} x ${selection.item.name}${portionLabel}`);
    });

    return { cartItems: nextCart, addedLabels };
}

function subtractResolvedVoiceItemsFromCart(cartItems = [], resolvedSelections = []) {
    const nextCart = Array.isArray(cartItems) ? [...cartItems] : [];
    const removedLabels = [];
    const missingLabels = [];

    resolvedSelections.forEach((selection) => {
        let remainingToRemove = Math.max(1, parseInt(selection.quantity, 10) || 1);
        const requireSpecificPortion = Boolean(selection?.requestedPortion);
        let removedCount = 0;

        for (let index = nextCart.length - 1; index >= 0 && remainingToRemove > 0; index -= 1) {
            const cartItem = nextCart[index];
            if (!doesCartItemMatchVoiceSelection(cartItem, selection, requireSpecificPortion)) continue;

            const nextQuantity = Number(cartItem.quantity || 0) - remainingToRemove;
            if (nextQuantity > 0) {
                removedCount += remainingToRemove;
                nextCart[index] = {
                    ...cartItem,
                    quantity: nextQuantity,
                    totalPrice: Number(cartItem.price || 0) * nextQuantity,
                };
                remainingToRemove = 0;
            } else {
                removedCount += Number(cartItem.quantity || 0);
                remainingToRemove -= Number(cartItem.quantity || 0);
                nextCart.splice(index, 1);
            }
        }

        if (removedCount > 0) {
            removedLabels.push(`${removedCount} x ${buildVoiceSelectionLabel(selection)}`);
        } else {
            missingLabels.push(buildVoiceSelectionLabel(selection));
        }
    });

    return { cartItems: nextCart, removedLabels, missingLabels };
}

function clearResolvedVoiceItemsFromCart(cartItems = [], resolvedSelections = []) {
    const currentCart = Array.isArray(cartItems) ? [...cartItems] : [];
    const removedCartItemIds = new Set();
    const clearedLabels = [];
    const missingLabels = [];

    resolvedSelections.forEach((selection) => {
        const requireSpecificPortion = Boolean(selection?.requestedPortion);
        const matchingItems = currentCart.filter((cartItem) => (
            doesCartItemMatchVoiceSelection(cartItem, selection, requireSpecificPortion)
        ));

        if (matchingItems.length === 0) {
            missingLabels.push(buildVoiceSelectionLabel(selection));
            return;
        }

        matchingItems.forEach((cartItem) => {
            removedCartItemIds.add(cartItem.cartItemId);
        });
        clearedLabels.push(buildVoiceSelectionLabel(selection));
    });

    return {
        cartItems: currentCart.filter((cartItem) => !removedCartItemIds.has(cartItem.cartItemId)),
        clearedLabels,
        missingLabels,
    };
}

function normalizeDraftCartItems(items = []) {
    return Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
            price: Number(item?.price || item?.portion?.price || 0) || 0,
            totalPrice: Number(item?.totalPrice || 0) || 0,
            cartItemId: String(item?.cartItemId || `${item?.id || 'item'}-${item?.portion?.name || 'regular'}`).trim(),
        }))
        : [];
}

function buildDraftFromTable(table = {}, context = {}) {
    const baseDraft = createEmptyCallSyncVoiceDraft({
        ...context,
        orderType: 'dine-in',
    });

    const currentOrder = table?.currentOrder || null;
    if (table?.status === 'occupied' && currentOrder?.isFinalized) {
        return {
            ok: false,
            message: `${table.name || 'Selected table'} is locked. Reopen it manually to edit.`,
            draft: null,
        };
    }

    const nextDraft = {
        ...baseDraft,
        orderType: 'dine-in',
        activeTable: table?.id
            ? {
                id: String(table.id).trim(),
                name: String(table.name || table.id).trim(),
                status: String(table.status || 'available').trim() || 'available',
            }
            : null,
        customerDetails: {
            name: String(currentOrder?.customerDetails?.name || '').trim(),
            phone: String(currentOrder?.customerDetails?.phone || '').trim(),
            address: String(currentOrder?.customerDetails?.address || '').trim(),
            notes: String(currentOrder?.customerDetails?.notes || '').trim(),
        },
        items: normalizeDraftCartItems(currentOrder?.items || []),
    };

    return {
        ok: true,
        message: `${table.name || 'Table'} selected for billing.`,
        draft: nextDraft,
    };
}

function preserveDraftMetadata(nextDraft = {}, previousDraft = {}) {
    return {
        ...nextDraft,
        version: previousDraft.version,
        lastTranscript: previousDraft.lastTranscript,
        lastAction: previousDraft.lastAction,
        note: previousDraft.note,
        error: '',
    };
}

function clearDraftContents(currentDraft = {}, overrides = {}) {
    return {
        ...currentDraft,
        orderType: overrides?.orderType || currentDraft?.orderType || 'delivery',
        activeTable: overrides?.activeTable === undefined ? currentDraft?.activeTable || null : overrides.activeTable,
        customerDetails: { name: '', phone: '', address: '', notes: '' },
        items: [],
        pendingItems: [],
        error: '',
        unresolvedCount: 0,
    };
}

function serializeDraftForResponse(draft = {}) {
    return {
        businessId: String(draft?.businessId || '').trim(),
        collectionName: String(draft?.collectionName || '').trim(),
        restaurantName: String(draft?.restaurantName || '').trim(),
        businessType: String(draft?.businessType || 'restaurant').trim() || 'restaurant',
        orderType: String(draft?.orderType || 'delivery').trim() || 'delivery',
        activeTable: draft?.activeTable?.id
            ? {
                id: String(draft.activeTable.id).trim(),
                name: String(draft.activeTable.name || draft.activeTable.id).trim(),
                status: String(draft.activeTable.status || 'available').trim() || 'available',
            }
            : null,
        customerDetails: {
            name: String(draft?.customerDetails?.name || '').trim(),
            phone: String(draft?.customerDetails?.phone || '').trim(),
            address: String(draft?.customerDetails?.address || '').trim(),
            notes: String(draft?.customerDetails?.notes || '').trim(),
        },
        items: Array.isArray(draft?.items) ? draft.items.map((item) => ({
            id: String(item?.id || '').trim(),
            name: String(item?.name || '').trim(),
            categoryId: String(item?.categoryId || '').trim(),
            quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
            price: Number(item?.price || 0) || 0,
            totalPrice: Number(item?.totalPrice || 0) || 0,
            cartItemId: String(item?.cartItemId || '').trim(),
            portion: item?.portion?.name
                ? {
                    name: String(item.portion.name).trim(),
                    label: String(item.portion.label || item.portion.name).trim(),
                    price: Number(item.portion.price || item.price || 0) || 0,
                }
                : null,
        })) : [],
        pendingItems: Array.isArray(draft?.pendingItems) ? draft.pendingItems : [],
        lastTranscript: String(draft?.lastTranscript || '').trim(),
        lastAction: String(draft?.lastAction || '').trim(),
        note: String(draft?.note || '').trim(),
        error: String(draft?.error || '').trim(),
        version: Math.max(0, Number(draft?.version || 0) || 0),
        updatedAt: Number(draft?.updatedAt || 0) || 0,
        expiresAt: Number(draft?.expiresAt || 0) || 0,
        unresolvedCount: Math.max(0, Number(draft?.unresolvedCount || 0) || 0),
        source: String(draft?.source || '').trim(),
    };
}

export async function resolveCallSyncVoiceBillingContext(firestore, token) {
    const resolvedBinding = await resolveCallSyncTokenBinding(firestore, token);
    if (!resolvedBinding?.target?.businessId || !resolvedBinding?.target?.collectionName) {
        return null;
    }

    const target = resolvedBinding.target;
    const businessRef = firestore.collection(target.collectionName).doc(target.businessId);
    const businessSnap = await businessRef.get();
    if (!businessSnap.exists) {
        return null;
    }

    const businessData = businessSnap.data() || {};
    const businessType = normalizeBusinessType(businessData?.businessType, target.collectionName);
    const [menu, manualTables] = await Promise.all([
        loadVoiceMenuContext(businessRef, businessType),
        loadManualTablesForVoice(businessRef),
    ]);
    const openItems = Array.isArray(businessData?.openItems) ? businessData.openItems : [];
    const voiceMenuIndex = buildVoiceMenuIndex(menu, openItems, businessType);

    return {
        token,
        target,
        businessRef,
        businessSnap,
        businessData,
        businessType,
        restaurantName: String(businessData?.name || '').trim() || 'ServiZephyr Outlet',
        menu,
        openItems,
        manualTables,
        voiceMenuIndex,
    };
}

function applyAiResolvedItems({
    aiResult,
    unresolvedLookup,
    parsedCommand,
    voiceMenuIndex,
}) {
    const resolvedSelections = Array.isArray(aiResult?.items)
        ? aiResult.items
            .filter((item) => Number(item?.confidence || 0) >= 0.72)
            .map((item) => {
                const unresolved = unresolvedLookup.get(item.lineId);
                return buildResolvedVoiceSelection(voiceMenuIndex, {
                    lineId: item.lineId,
                    entryId: item.entryId,
                    portionName: item.portionName,
                    quantity: unresolved?.quantity || 1,
                    requestedPortion: unresolved?.requestedPortion || '',
                    commandAction: unresolved?.commandAction || parsedCommand?.cartAction || 'add',
                    spokenText: unresolved?.spokenText || '',
                });
            })
            .filter(Boolean)
        : [];

    const unresolvedLineIds = new Set(unresolvedLookup.keys());
    resolvedSelections.forEach((selection) => {
        if (selection?.lineId) unresolvedLineIds.delete(selection.lineId);
    });
    (Array.isArray(aiResult?.unresolvedLineIds) ? aiResult.unresolvedLineIds : []).forEach((lineId) => {
        if (lineId) unresolvedLineIds.add(lineId);
    });

    return {
        resolvedSelections,
        unresolvedLineIds,
    };
}

export function buildCompanionVoiceSttKeyterms(voiceMenuIndex = []) {
    const seen = new Set();
    const ranked = (Array.isArray(voiceMenuIndex) ? voiceMenuIndex : [])
        .map((entry) => String(entry?.name || '').trim())
        .filter(Boolean)
        .sort((left, right) => {
            const tokenDiff = right.split(/\s+/).length - left.split(/\s+/).length;
            if (tokenDiff !== 0) return tokenDiff;
            return right.length - left.length;
        });

    const keyterms = [];
    let tokenBudget = 0;

    ranked.forEach((term) => {
        const normalized = term.toLowerCase();
        if (seen.has(normalized)) return;
        const tokens = term.split(/\s+/).filter(Boolean);
        if (!tokens.length) return;
        if (keyterms.length >= 90) return;
        if (tokenBudget + tokens.length > 420) return;
        seen.add(normalized);
        keyterms.push(term);
        tokenBudget += tokens.length;
    });

    return keyterms;
}

export async function bootstrapCallSyncVoiceDraft({ firestore, rtdb, token }) {
    const context = await resolveCallSyncVoiceBillingContext(firestore, token);
    if (!context) {
        return {
            ok: false,
            status: 404,
            message: 'Invalid call sync token.',
        };
    }

    const draft = await readCallSyncVoiceDraft(rtdb, context.target, {
        ...context.target,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
    });

    return {
        ok: true,
        status: 200,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
        sttKeyterms: buildCompanionVoiceSttKeyterms(context.voiceMenuIndex),
        draft: serializeDraftForResponse(draft),
    };
}

export async function processCallSyncVoiceTranscript({
    firestore,
    rtdb,
    token,
    transcript,
    commandId = '',
} = {}) {
    const context = await resolveCallSyncVoiceBillingContext(firestore, token);
    if (!context) {
        return {
            ok: false,
            status: 404,
            message: 'Invalid call sync token.',
        };
    }

    const normalizedTranscript = String(transcript || '').trim();
    if (!normalizedTranscript) {
        return {
            ok: false,
            status: 400,
            message: 'Transcript is required.',
        };
    }

    const currentDraft = await readCallSyncVoiceDraft(rtdb, context.target, {
        ...context.target,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
    });

    if (commandId && String(currentDraft?.lastCommandId || '').trim() === String(commandId).trim()) {
        return {
            ok: true,
            status: 200,
            applied: false,
            deduped: true,
            message: 'Voice command already applied.',
            restaurantName: context.restaurantName,
            businessType: context.businessType,
            sttKeyterms: buildCompanionVoiceSttKeyterms(context.voiceMenuIndex),
            draft: serializeDraftForResponse(currentDraft),
        };
    }

    let workingDraft = coerceCallSyncVoiceDraft(currentDraft, {
        ...context.target,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
    });

    let parsedCommand = parseManualOrderVoiceCommand({
        transcript: normalizedTranscript,
        menuIndex: context.voiceMenuIndex,
        manualTables: context.manualTables,
        currentMode: workingDraft.orderType || 'delivery',
    });

    const targetMode = parsedCommand.desiredMode || workingDraft.orderType || 'delivery';
    if (context.businessType === 'store' && targetMode === 'dine-in') {
        return {
            ok: true,
            status: 200,
            applied: false,
            message: 'Dine-in mode is not available for this store outlet.',
            restaurantName: context.restaurantName,
            businessType: context.businessType,
            draft: serializeDraftForResponse(workingDraft),
        };
    }

    let targetTable = parsedCommand.matchedTableId
        ? context.manualTables.find((table) => table.id === parsedCommand.matchedTableId) || null
        : (parsedCommand.requestedTableReference
            ? findVoiceTableMatch(context.manualTables, parsedCommand.requestedTableReference)
            : null);

    if (!targetTable && parsedCommand.requestedTableReference) {
        return {
            ok: true,
            status: 200,
            applied: false,
            message: `Table "${parsedCommand.requestedTableReference}" match nahi hua.`,
            restaurantName: context.restaurantName,
            businessType: context.businessType,
            draft: serializeDraftForResponse(workingDraft),
        };
    }

    if (targetTable) {
        const tableDraftResult = buildDraftFromTable(targetTable, {
            ...context.target,
            restaurantName: context.restaurantName,
            businessType: context.businessType,
        });
        if (!tableDraftResult.ok || !tableDraftResult.draft) {
            return {
                ok: true,
                status: 200,
                applied: false,
                message: tableDraftResult.message,
                restaurantName: context.restaurantName,
                businessType: context.businessType,
                draft: serializeDraftForResponse(workingDraft),
            };
        }
        workingDraft = preserveDraftMetadata(tableDraftResult.draft, workingDraft);
    } else if (targetMode !== (workingDraft.orderType || 'delivery')) {
        workingDraft = clearDraftContents(workingDraft, {
            orderType: targetMode,
            activeTable: targetMode === 'dine-in' ? workingDraft.activeTable : null,
        });
    }

    if (targetMode !== 'dine-in') {
        workingDraft.activeTable = null;
    } else if (targetTable) {
        workingDraft.activeTable = {
            id: String(targetTable.id).trim(),
            name: String(targetTable.name || targetTable.id).trim(),
            status: String(targetTable.status || 'available').trim() || 'available',
        };
    }
    workingDraft.orderType = targetMode;

    const cartAction = String(parsedCommand?.cartAction || 'add').trim() || 'add';
    if (cartAction === 'clear-all') {
        const clearedDraft = clearDraftContents(workingDraft, {
            orderType: targetMode,
            activeTable: targetMode === 'dine-in' ? workingDraft.activeTable : null,
        });
        const now = Date.now();
        const nextDraft = {
            ...clearedDraft,
            businessId: context.target.businessId,
            collectionName: context.target.collectionName,
            restaurantName: context.restaurantName,
            businessType: context.businessType,
            lastTranscript: normalizedTranscript,
            lastAction: 'Current bill cleared.',
            note: 'Current bill cleared.',
            source: 'android_companion',
            lastCommandId: String(commandId || '').trim(),
            version: Math.max(1, Number(workingDraft.version || 0) + 1),
            updatedAt: now,
            expiresAt: now + CALL_SYNC_VOICE_DRAFT_TTL_MS,
        };
        const storedDraft = await writeCallSyncVoiceDraft(rtdb, context.target, nextDraft);
        return {
            ok: true,
            status: 200,
            applied: true,
            message: nextDraft.note,
            restaurantName: context.restaurantName,
            businessType: context.businessType,
            draft: serializeDraftForResponse(storedDraft),
        };
    }

    const localResolvedSelections = parsedCommand.items
        .filter((item) => item.status === 'resolved')
        .map((item) => buildResolvedVoiceSelection(context.voiceMenuIndex, {
            lineId: item.lineId,
            entryId: item.selectedEntry?.entryId || item.selectedEntry?.itemId,
            portionName: item.selectedOption?.label || item.selectedOption?.name,
            quantity: item.quantity,
            requestedPortion: item.requestedPortion,
            commandAction: item.commandAction || cartAction,
            spokenText: item.spokenText,
        }))
        .filter(Boolean);

    let pendingItems = parsedCommand.items
        .filter((item) => item.status === 'pending' && Array.isArray(item.candidates) && item.candidates.length > 0)
        .map((item) => ({
            id: item.lineId,
            lineId: item.lineId,
            spokenText: item.spokenText,
            quantity: item.quantity,
            requestedPortion: item.requestedPortion,
            commandAction: item.commandAction || cartAction,
            reason: item.reason || 'ambiguous-match',
            candidates: item.candidates,
        }));

    let aiFallbackError = '';
    const aiEligiblePendingItems = pendingItems.filter((item) => item.reason !== 'portion-required' && item.reason !== 'family-ambiguous');
    if (aiEligiblePendingItems.length > 0) {
        const resolverPayload = serializeVoiceResolverPayload({
            ...parsedCommand,
            items: parsedCommand.items.filter((item) => (
                item.status !== 'pending' ||
                aiEligiblePendingItems.some((pendingItem) => pendingItem.id === item.lineId)
            )),
        });
        const unresolvedLookup = new Map(
            (resolverPayload?.unresolvedItems || []).map((item) => [item.lineId, item])
        );

        const aiResult = await resolveManualOrderVoiceWithAi({
            transcript: normalizedTranscript,
            currentMode: workingDraft.orderType,
            activeTableId: workingDraft?.activeTable?.id || null,
            explicitMode: parsedCommand.explicitMode || null,
            requestedTableReference: parsedCommand.requestedTableReference || null,
            unresolvedItems: resolverPayload?.unresolvedItems || [],
            tableOptions: context.manualTables.map((table) => ({
                id: table.id,
                name: table.name,
                status: table.status,
                isFinalized: !!table?.currentOrder?.isFinalized,
            })),
        });

        if (!aiResult.ok) {
            aiFallbackError = aiResult.message || '';
        } else {
            const aiSelectionResult = applyAiResolvedItems({
                aiResult,
                unresolvedLookup,
                parsedCommand,
                voiceMenuIndex: context.voiceMenuIndex,
            });
            const resolvedByAiLineIds = new Set(
                aiSelectionResult.resolvedSelections.map((selection) => selection.lineId).filter(Boolean)
            );
            pendingItems = pendingItems.filter((item) => (
                aiSelectionResult.unresolvedLineIds.has(item.id) && !resolvedByAiLineIds.has(item.id)
            ));
            localResolvedSelections.push(...aiSelectionResult.resolvedSelections);

            if (!targetTable && aiResult.targetTableId) {
                targetTable = context.manualTables.find((table) => table.id === aiResult.targetTableId) || targetTable;
            }
            if (aiResult.desiredMode && workingDraft.orderType !== aiResult.desiredMode && !targetTable) {
                workingDraft.orderType = aiResult.desiredMode;
                if (aiResult.desiredMode !== 'dine-in') {
                    workingDraft.activeTable = null;
                }
            }
        }
    }

    if (targetTable) {
        const currentActiveTableId = String(workingDraft?.activeTable?.id || '').trim();
        if (workingDraft.orderType !== 'dine-in' || currentActiveTableId !== String(targetTable.id || '').trim()) {
            const tableDraftResult = buildDraftFromTable(targetTable, {
                ...context.target,
                restaurantName: context.restaurantName,
                businessType: context.businessType,
            });
            if (!tableDraftResult.ok || !tableDraftResult.draft) {
                return {
                    ok: true,
                    status: 200,
                    applied: false,
                    message: tableDraftResult.message,
                    restaurantName: context.restaurantName,
                    businessType: context.businessType,
                    draft: serializeDraftForResponse(workingDraft),
                };
            }
            workingDraft = preserveDraftMetadata(tableDraftResult.draft, workingDraft);
        }
    }

    const unresolvedWithoutCandidates = parsedCommand.items.filter((item) => item.status === 'unresolved');

    let nextCart = normalizeDraftCartItems(workingDraft.items || []);
    let addedLabels = [];
    let removedLabels = [];
    let clearedLabels = [];
    let missingLabels = [];

    if (cartAction === 'subtract') {
        const subtractResult = subtractResolvedVoiceItemsFromCart(nextCart, localResolvedSelections);
        nextCart = subtractResult.cartItems;
        removedLabels = subtractResult.removedLabels;
        missingLabels = subtractResult.missingLabels;
    } else if (cartAction === 'clear-item') {
        const clearResult = clearResolvedVoiceItemsFromCart(nextCart, localResolvedSelections);
        nextCart = clearResult.cartItems;
        clearedLabels = clearResult.clearedLabels;
        missingLabels = clearResult.missingLabels;
    } else {
        const addResult = appendResolvedVoiceItemsToCart(nextCart, localResolvedSelections);
        nextCart = addResult.cartItems;
        addedLabels = addResult.addedLabels;
    }

    const summaryParts = [];
    if (targetTable?.name) {
        summaryParts.push(`${targetTable.name} selected`);
    } else if (targetMode !== (currentDraft.orderType || 'delivery')) {
        summaryParts.push(`${targetMode.replace(/-/g, ' ')} mode selected`);
    }
    if (addedLabels.length > 0) {
        summaryParts.push(`Added ${addedLabels.join(', ')}`);
    }
    if (removedLabels.length > 0) {
        summaryParts.push(`Removed ${removedLabels.join(', ')}`);
    }
    if (clearedLabels.length > 0) {
        summaryParts.push(`Cleared ${clearedLabels.join(', ')}`);
    }
    if (pendingItems.length > 0) {
        summaryParts.push(
            pendingItems
                .map((item) => (
                    item.reason === 'portion-required'
                        ? `Choose portion for "${item.spokenText}"`
                        : `Confirm "${item.spokenText}"`
                ))
                .join(', ')
        );
    }
    if (unresolvedWithoutCandidates.length > 0) {
        summaryParts.push(`Could not match ${unresolvedWithoutCandidates.map((item) => `"${item.spokenText}"`).join(', ')}`);
    }
    if (missingLabels.length > 0) {
        summaryParts.push(`Not found in current cart ${missingLabels.join(', ')}`);
    }
    if (aiFallbackError && addedLabels.length === 0 && removedLabels.length === 0 && clearedLabels.length === 0) {
        summaryParts.push(aiFallbackError);
    }
    if (summaryParts.length === 0) {
        summaryParts.push('No cart changes were applied.');
    }

    const summary = summaryParts.join('. ');
    const now = Date.now();
    const nextDraft = {
        ...workingDraft,
        businessId: context.target.businessId,
        collectionName: context.target.collectionName,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
        orderType: workingDraft.orderType || targetMode,
        activeTable: workingDraft.orderType === 'dine-in' && workingDraft.activeTable?.id
            ? workingDraft.activeTable
            : null,
        items: nextCart,
        pendingItems,
        lastTranscript: normalizedTranscript,
        lastAction: summary,
        note: summary,
        error: '',
        source: 'android_companion',
        lastCommandId: String(commandId || '').trim(),
        version: Math.max(1, Number(workingDraft.version || 0) + 1),
        updatedAt: now,
        expiresAt: now + CALL_SYNC_VOICE_DRAFT_TTL_MS,
        unresolvedCount: unresolvedWithoutCandidates.length,
    };

    const storedDraft = await writeCallSyncVoiceDraft(rtdb, context.target, nextDraft);
    return {
        ok: true,
        status: 200,
        applied: true,
        message: summary,
        restaurantName: context.restaurantName,
        businessType: context.businessType,
        sttKeyterms: buildCompanionVoiceSttKeyterms(context.voiceMenuIndex),
        draft: serializeDraftForResponse(storedDraft),
    };
}
