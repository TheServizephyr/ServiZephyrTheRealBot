import { NextResponse } from 'next/server';

import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MANUAL_ORDER_MODEL || 'openai/gpt-4o-mini';

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

export async function POST(req) {
    try {
        await verifyOwnerFeatureAccess(
            req,
            'manual-order',
            'manual_order_voice_parse',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const apiKey = coerceText(process.env.OPENROUTER_API_KEY);
        if (!apiKey) {
            return NextResponse.json(
                { message: 'OpenRouter key is not configured for voice fallback.', fallbackAvailable: false },
                { status: 503 }
            );
        }

        const body = await req.json();
        const transcript = coerceText(body?.transcript);
        if (!transcript) {
            return NextResponse.json({ message: 'Transcript is required.' }, { status: 400 });
        }

        const unresolvedItems = Array.isArray(body?.unresolvedItems)
            ? body.unresolvedItems.map(sanitizeUnresolvedItem).filter(Boolean)
            : [];
        if (unresolvedItems.length === 0) {
            return NextResponse.json({ message: 'At least one unresolved item is required.' }, { status: 400 });
        }

        const tableOptions = Array.isArray(body?.tableOptions)
            ? body.tableOptions.map(sanitizeTableOption).filter(Boolean).slice(0, 40)
            : [];

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: DEFAULT_OPENROUTER_MODEL,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You are resolving spoken restaurant billing commands for a POS counter.',
                            'Important rules:',
                            '1. Only choose from the provided candidates. Never invent items.',
                            '2. Keep speed and accuracy in mind. If a line is ambiguous, leave it unresolved.',
                            '3. If transcript clearly says delivery, pickup, or table, return that as desiredMode or targetTableId.',
                            '4. If line has requestedPortion, prefer candidates or portionOptions that match it.',
                            '5. Return compact JSON only.',
                            'JSON format:',
                            '{"desiredMode": "delivery|pickup|dine-in|null", "targetTableId": "string|null", "items": [{"lineId": "string", "entryId": "string", "portionName": "string|null", "confidence": 0.0}], "unresolvedLineIds": ["lineId"]}',
                        ].join('\n'),
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            transcript,
                            currentMode: coerceText(body?.currentMode) || null,
                            activeTableId: coerceText(body?.activeTableId) || null,
                            explicitMode: coerceText(body?.explicitMode) || null,
                            requestedTableReference: coerceText(body?.requestedTableReference) || null,
                            unresolvedItems,
                            tableOptions,
                        }),
                    },
                ],
            }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json(
                {
                    message: payload?.error?.message || payload?.message || 'OpenRouter voice resolution failed.',
                    fallbackAvailable: true,
                },
                { status: response.status || 502 }
            );
        }

        const content = payload?.choices?.[0]?.message?.content || '';
        const parsed = extractJsonObject(content);
        if (!parsed || typeof parsed !== 'object') {
            return NextResponse.json(
                { message: 'Voice resolver returned an invalid JSON payload.', fallbackAvailable: true },
                { status: 502 }
            );
        }

        return NextResponse.json({
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
        });
    } catch (error) {
        console.error('[Manual Order Voice Parse] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Voice parsing failed.' },
            { status: error?.status || 500 }
        );
    }
}
