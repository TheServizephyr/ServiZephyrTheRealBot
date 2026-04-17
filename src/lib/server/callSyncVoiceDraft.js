import {
    buildCallSyncVoiceDraftPath,
    CALL_SYNC_VOICE_DRAFT_TTL_MS,
    isCallSyncVoiceDraftFresh,
} from '@/lib/call-sync';

function cloneJson(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function sanitizeCustomerDetails(customerDetails = {}) {
    return {
        name: String(customerDetails?.name || '').trim(),
        phone: String(customerDetails?.phone || '').trim(),
        address: String(customerDetails?.address || '').trim(),
        notes: String(customerDetails?.notes || '').trim(),
    };
}

function sanitizeDraftItem(item = {}) {
    const quantity = Math.max(1, Number(item?.quantity || 1) || 1);
    const price = Number(item?.price || item?.portion?.price || 0) || 0;
    const totalPrice = Number(item?.totalPrice || (price * quantity) || 0) || 0;
    const portionName = String(item?.portion?.name || '').trim();
    const portionLabel = String(item?.portion?.label || portionName).trim();

    return {
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim() || 'Item',
        categoryId: String(item?.categoryId || 'manual').trim() || 'manual',
        isVeg: item?.isVeg === true,
        quantity,
        price,
        totalPrice,
        cartItemId: String(item?.cartItemId || `${item?.id || 'item'}-${portionName || 'regular'}`).trim(),
        ...(portionName
            ? {
                portion: {
                    name: portionName,
                    label: portionLabel || portionName,
                    price: Number(item?.portion?.price || price) || price,
                },
            }
            : {}),
        ...(Number(item?.portionCount || 0) > 0 ? { portionCount: Number(item.portionCount) } : {}),
    };
}

function sanitizePendingCandidate(candidate = {}) {
    const entryId = String(candidate?.entryId || candidate?.itemId || '').trim();
    const name = String(candidate?.name || '').trim();
    if (!entryId || !name) return null;

    return {
        entryId,
        itemId: String(candidate?.itemId || entryId).trim(),
        name,
        categoryId: String(candidate?.categoryId || '').trim(),
        portionName: String(candidate?.portionName || '').trim(),
        confidence: Number(candidate?.confidence || 0) || 0,
        portionOptions: Array.isArray(candidate?.portionOptions)
            ? candidate.portionOptions.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 8)
            : [],
    };
}

function sanitizePendingItem(item = {}) {
    const id = String(item?.id || item?.lineId || '').trim();
    const spokenText = String(item?.spokenText || '').trim();
    const candidates = Array.isArray(item?.candidates)
        ? item.candidates.map(sanitizePendingCandidate).filter(Boolean)
        : [];

    if (!id || !spokenText || candidates.length === 0) return null;

    return {
        id,
        lineId: id,
        spokenText,
        quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
        requestedPortion: String(item?.requestedPortion || '').trim(),
        commandAction: String(item?.commandAction || 'add').trim() || 'add',
        reason: String(item?.reason || 'ambiguous-match').trim() || 'ambiguous-match',
        candidates,
    };
}

export function createEmptyCallSyncVoiceDraft(context = {}) {
    return {
        businessId: String(context?.businessId || '').trim(),
        collectionName: String(context?.collectionName || '').trim(),
        restaurantName: String(context?.restaurantName || '').trim(),
        businessType: String(context?.businessType || 'restaurant').trim() || 'restaurant',
        orderType: String(context?.orderType || 'delivery').trim() || 'delivery',
        activeTable: null,
        customerDetails: sanitizeCustomerDetails(),
        items: [],
        pendingItems: [],
        lastTranscript: '',
        lastAction: '',
        note: '',
        error: '',
        source: 'android_companion',
        lastCommandId: '',
        version: 0,
        updatedAt: 0,
        expiresAt: 0,
        unresolvedCount: 0,
    };
}

export function coerceCallSyncVoiceDraft(rawDraft = null, context = {}) {
    const emptyDraft = createEmptyCallSyncVoiceDraft(context);
    if (!rawDraft || typeof rawDraft !== 'object') return emptyDraft;

    const updatedAt = Number(rawDraft?.updatedAt || 0);
    if (updatedAt > 0 && !isCallSyncVoiceDraftFresh(updatedAt)) {
        return emptyDraft;
    }

    return {
        ...emptyDraft,
        ...cloneJson(rawDraft, {}),
        businessId: emptyDraft.businessId,
        collectionName: emptyDraft.collectionName,
        restaurantName: String(rawDraft?.restaurantName || emptyDraft.restaurantName).trim(),
        businessType: String(rawDraft?.businessType || emptyDraft.businessType).trim() || emptyDraft.businessType,
        orderType: String(rawDraft?.orderType || emptyDraft.orderType).trim() || emptyDraft.orderType,
        activeTable: rawDraft?.activeTable?.id
            ? {
                id: String(rawDraft.activeTable.id).trim(),
                name: String(rawDraft.activeTable.name || rawDraft.activeTable.id).trim(),
                status: String(rawDraft.activeTable.status || 'available').trim() || 'available',
            }
            : null,
        customerDetails: sanitizeCustomerDetails(rawDraft?.customerDetails),
        items: Array.isArray(rawDraft?.items) ? rawDraft.items.map(sanitizeDraftItem) : [],
        pendingItems: Array.isArray(rawDraft?.pendingItems)
            ? rawDraft.pendingItems.map(sanitizePendingItem).filter(Boolean)
            : [],
        lastTranscript: String(rawDraft?.lastTranscript || '').trim(),
        lastAction: String(rawDraft?.lastAction || '').trim(),
        note: String(rawDraft?.note || '').trim(),
        error: String(rawDraft?.error || '').trim(),
        source: String(rawDraft?.source || 'android_companion').trim() || 'android_companion',
        lastCommandId: String(rawDraft?.lastCommandId || '').trim(),
        version: Math.max(0, Number(rawDraft?.version || 0) || 0),
        updatedAt,
        expiresAt: Number(rawDraft?.expiresAt || 0) || 0,
        unresolvedCount: Math.max(0, Number(rawDraft?.unresolvedCount || 0) || 0),
    };
}

export async function readCallSyncVoiceDraft(rtdb, target, context = {}) {
    const path = buildCallSyncVoiceDraftPath(target);
    const snapshot = await rtdb.ref(path).get();
    const rawDraft = snapshot.exists() ? snapshot.val() : null;
    return coerceCallSyncVoiceDraft(rawDraft, {
        ...context,
        businessId: target?.businessId,
        collectionName: target?.collectionName,
    });
}

export async function writeCallSyncVoiceDraft(rtdb, target, draft = {}) {
    const path = buildCallSyncVoiceDraftPath(target);
    const normalizedDraft = coerceCallSyncVoiceDraft(draft, target);
    const payload = {
        ...normalizedDraft,
        expiresAt: Number(normalizedDraft?.expiresAt || (Date.now() + CALL_SYNC_VOICE_DRAFT_TTL_MS)),
    };
    await rtdb.ref(path).set(payload);
    return payload;
}

export async function clearCallSyncVoiceDraft(rtdb, target) {
    const path = buildCallSyncVoiceDraftPath(target);
    await rtdb.ref(path).remove();
}
