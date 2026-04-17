const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MANUAL_ORDER_MODEL || 'openrouter/auto';

function coerceText(value = '') {
    return String(value || '').trim();
}

function sanitizeCandidate(candidate = {}) {
    const entryId = coerceText(candidate.entryId);
    const itemId = coerceText(candidate.itemId);
    const name = coerceText(candidate.name);
    if (!entryId || !itemId || !name) return null;

    return {
        entryId,
        itemId,
        name,
        portionName: coerceText(candidate.portionName),
        confidence: Number(candidate.confidence || 0),
        portionOptions: Array.isArray(candidate.portionOptions)
            ? candidate.portionOptions.map((option) => coerceText(option)).filter(Boolean).slice(0, 8)
            : [],
    };
}

function sanitizeUnresolvedItem(item = {}) {
    const lineId = coerceText(item.lineId);
    const spokenText = coerceText(item.spokenText);
    if (!lineId || !spokenText) return null;

    const candidates = Array.isArray(item.candidates)
        ? item.candidates.map(sanitizeCandidate).filter(Boolean).slice(0, 5)
        : [];
    if (candidates.length === 0) return null;

    return {
        lineId,
        spokenText,
        quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
        requestedPortion: coerceText(item.requestedPortion),
        commandAction: coerceText(item.commandAction) || 'add',
        reason: coerceText(item.reason) || 'ambiguous-match',
        candidates,
    };
}

function sanitizeTableOption(table = {}) {
    const id = coerceText(table.id);
    const name = coerceText(table.name);
    if (!id || !name) return null;
    return {
        id,
        name,
        status: coerceText(table.status) || 'available',
        isFinalized: table?.isFinalized === true,
    };
}

function extractJsonObject(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) return null;
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

const VOICE_PARSE_SYSTEM_PROMPT = [
    'You resolve spoken restaurant billing commands for a busy POS counter.',
    'Your job is only to disambiguate already shortlisted menu candidates.',
    'Rules:',
    '1. Only choose from the provided candidates. Never invent items or portions.',
    '2. If spoken words are generic like "roti", only choose a roti-like candidate. Never jump to a different family like raita, rice, paneer, or chaap unless the words clearly support it.',
    '3. If confidence is not strong, leave the line unresolved.',
    '4. If requestedPortion is present, prefer a matching portionName. If spokenText did not clearly specify half/full and the line reason says portion-required, leave it unresolved.',
    '5. Respect commandAction context such as add, subtract, or clear-item, but still only identify the correct menu item.',
    '6. If transcript clearly indicates delivery, pickup, or a table reference, return desiredMode or targetTableId when confident.',
    '7. Return strict compact JSON only, with no markdown and no explanation.',
    'JSON format:',
    '{"desiredMode":"delivery|pickup|dine-in|null","targetTableId":"string|null","items":[{"lineId":"string","entryId":"string","portionName":"string|null","confidence":0.0}],"unresolvedLineIds":["lineId"]}',
].join('\n');

export async function resolveManualOrderVoiceWithAi({
    transcript = '',
    currentMode = null,
    activeTableId = null,
    explicitMode = null,
    requestedTableReference = null,
    unresolvedItems = [],
    tableOptions = [],
} = {}) {
    const apiKey = coerceText(process.env.OPENROUTER_API_KEY);
    if (!apiKey) {
        return {
            ok: false,
            status: 503,
            message: 'OpenRouter key is not configured for voice fallback.',
            fallbackAvailable: false,
        };
    }

    const normalizedTranscript = coerceText(transcript);
    if (!normalizedTranscript) {
        return {
            ok: false,
            status: 400,
            message: 'Transcript is required.',
            fallbackAvailable: true,
        };
    }

    const sanitizedUnresolvedItems = Array.isArray(unresolvedItems)
        ? unresolvedItems.map(sanitizeUnresolvedItem).filter(Boolean)
        : [];
    if (sanitizedUnresolvedItems.length === 0) {
        return {
            ok: false,
            status: 400,
            message: 'At least one unresolved item is required.',
            fallbackAvailable: true,
        };
    }

    const sanitizedTableOptions = Array.isArray(tableOptions)
        ? tableOptions.map(sanitizeTableOption).filter(Boolean).slice(0, 40)
        : [];

    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: DEFAULT_OPENROUTER_MODEL,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: VOICE_PARSE_SYSTEM_PROMPT,
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        transcript: normalizedTranscript,
                        currentMode: coerceText(currentMode) || null,
                        activeTableId: coerceText(activeTableId) || null,
                        explicitMode: coerceText(explicitMode) || null,
                        requestedTableReference: coerceText(requestedTableReference) || null,
                        unresolvedItems: sanitizedUnresolvedItems,
                        tableOptions: sanitizedTableOptions,
                    }),
                },
            ],
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {
            ok: false,
            status: response.status || 502,
            message: payload?.error?.message || payload?.message || 'OpenRouter voice resolution failed.',
            fallbackAvailable: true,
        };
    }

    const content = payload?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed !== 'object') {
        return {
            ok: false,
            status: 502,
            message: 'Voice resolver returned an invalid JSON payload.',
            fallbackAvailable: true,
        };
    }

    return {
        ok: true,
        status: 200,
        desiredMode: ['delivery', 'pickup', 'dine-in'].includes(parsed?.desiredMode) ? parsed.desiredMode : null,
        targetTableId: coerceText(parsed?.targetTableId) || null,
        items: Array.isArray(parsed?.items)
            ? parsed.items
                .map((item) => ({
                    lineId: coerceText(item?.lineId),
                    entryId: coerceText(item?.entryId),
                    portionName: coerceText(item?.portionName) || null,
                    confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
                }))
                .filter((item) => item.lineId && item.entryId)
            : [],
        unresolvedLineIds: Array.isArray(parsed?.unresolvedLineIds)
            ? parsed.unresolvedLineIds.map((value) => coerceText(value)).filter(Boolean)
            : [],
        fallbackAvailable: true,
    };
}
