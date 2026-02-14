/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import qrcode from 'qr.js';
import { promises as fs } from 'fs';
import path from 'path';

let cachedLogoDataUri = null;

function sanitizeUpiId(value) {
    return String(value || '').trim();
}

function safeText(value, fallback = '', maxLen = 80) {
    const normalized = String(value || fallback || '').replace(/\s+/g, ' ').trim();
    return normalized.slice(0, maxLen);
}

function sanitizePayeeName(value) {
    const cleaned = safeText(value, 'ServiZephyr', 48)
        .replace(/[^a-zA-Z0-9 .,&()/-]/g, '')
        .trim();
    return cleaned || 'ServiZephyr';
}

function buildUpiQuery(params = {}) {
    return Object.entries(params)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`)
        .join('&');
}

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount.toFixed(2);
}

function buildQrSvgDataUri(value) {
    const qrData = qrcode(value, qrcode.ErrorCorrectLevel.H);
    const modules = qrData?.modules || [];
    const moduleCount = Number(qrData?.moduleCount || 0);
    if (!Array.isArray(modules) || moduleCount <= 0) {
        throw new Error('QR generation failed.');
    }

    const quietZone = 4;
    const svgSize = moduleCount + (quietZone * 2);
    const darkCellsPath = [];

    for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount; col += 1) {
            if (!modules[row]?.[col]) continue;
            const x = col + quietZone;
            const y = row + quietZone;
            darkCellsPath.push(`M${x} ${y}h1v1H${x}z`);
        }
    }

    if (!darkCellsPath.length) {
        throw new Error('QR matrix is empty.');
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" shape-rendering="crispEdges">`,
        `<rect width="${svgSize}" height="${svgSize}" fill="#ffffff" />`,
        `<path d="${darkCellsPath.join('')}" fill="#111111" />`,
        '</svg>'
    ].join('');

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function getLogoDataUri() {
    if (cachedLogoDataUri) return cachedLogoDataUri;
    try {
        const logoPath = path.join(process.cwd(), 'public', 'logo.png');
        const fileBuffer = await fs.readFile(logoPath);
        cachedLogoDataUri = `data:image/png;base64,${fileBuffer.toString('base64')}`;
        return cachedLogoDataUri;
    } catch (error) {
        console.warn('[UPI QR Card] Could not load logo.png:', error?.message || error);
        return null;
    }
}

export function buildUpiLinkForQrCard({
    upiId,
    payeeName,
    amountFixed,
    note,
    transactionRef
}) {
    const cleanedUpiId = sanitizeUpiId(upiId);
    if (!cleanedUpiId || !cleanedUpiId.includes('@')) return null;
    const normalizedAmount = normalizeAmount(amountFixed);
    if (!normalizedAmount) return null;

    const cleanTr = safeText(transactionRef, '', 35).replace(/[^a-zA-Z0-9]/g, '');
    const upiQuery = buildUpiQuery({
        pa: cleanedUpiId,
        pn: sanitizePayeeName(payeeName),
        am: normalizedAmount,
        cu: 'INR',
        tn: safeText(note, 'Order Payment', 40),
        tr: cleanTr
    });

    return `upi://pay?${upiQuery}`;
}

export async function createUpiQrCardImageResponse({
    upiId,
    payeeName,
    restaurantName,
    amountFixed,
    orderDisplayId = '',
    note = '',
    transactionRef = ''
}) {
    const upiLink = buildUpiLinkForQrCard({
        upiId,
        payeeName,
        amountFixed,
        note,
        transactionRef
    });
    if (!upiLink) {
        throw new Error('Invalid UPI QR card payload.');
    }

    const logoDataUri = await getLogoDataUri();
    const safeRestaurantName = safeText(restaurantName || payeeName || 'Restaurant', 'Restaurant', 64);
    const safeOrderId = safeText(orderDisplayId, '', 20);
    const safeAmount = normalizeAmount(amountFixed);
    const safeUpiId = sanitizeUpiId(upiId);
    const qrSvgDataUri = buildQrSvgDataUri(upiLink);
    const qrSize = 360;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(145deg, #f5f7fa 0%, #dbe7ff 55%, #eef2ff 100%)',
                    padding: 26,
                    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                }}
            >
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'stretch',
                        justifyContent: 'space-between',
                        borderRadius: 28,
                        background: '#ffffff',
                        padding: '34px 40px',
                        boxShadow: '0 20px 42px rgba(15, 23, 42, 0.16)',
                        border: '1px solid rgba(17, 24, 39, 0.08)',
                    }}
                >
                    <div
                        style={{
                            width: '44%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            paddingRight: 20,
                        }}
                    >
                        <div
                            style={{
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                justifyContent: 'flex-start'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    fontSize: 52,
                                    fontWeight: 900,
                                    color: '#111827',
                                    letterSpacing: '0.3px',
                                    lineHeight: 1
                                }}
                            >
                                SCAN TO PAY
                            </div>

                            <div
                                style={{
                                    marginTop: 10,
                                    display: 'flex',
                                    fontSize: 24,
                                    color: '#4b5563',
                                    lineHeight: 1.25
                                }}
                            >
                                Open any UPI app and pay this exact amount
                            </div>

                            <div
                                style={{
                                    marginTop: 28,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    width: '100%'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        fontSize: 18,
                                        color: '#6b7280',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.8px'
                                    }}
                                >
                                    Restaurant
                                </div>
                                <div
                                    style={{
                                        display: 'flex',
                                        marginTop: 5,
                                        fontSize: 40,
                                        lineHeight: 1.05,
                                        fontWeight: 800,
                                        color: '#111827'
                                    }}
                                >
                                    {safeRestaurantName}
                                </div>
                            </div>

                            <div
                                style={{
                                    marginTop: 22,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    width: '100%'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        fontSize: 18,
                                        color: '#6b7280',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.8px'
                                    }}
                                >
                                    UPI ID
                                </div>
                                <div
                                    style={{
                                        display: 'flex',
                                        marginTop: 6,
                                        fontSize: 28,
                                        color: '#1f2937',
                                        lineHeight: 1.12
                                    }}
                                >
                                    {safeText(safeUpiId, 'Not Set', 48)}
                                </div>
                            </div>

                            {safeOrderId ? (
                                <div
                                    style={{
                                        marginTop: 18,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 22,
                                        color: '#374151',
                                        background: '#f3f4f6',
                                        padding: '8px 16px',
                                        borderRadius: 999
                                    }}
                                >
                                    Order ID: {safeOrderId}
                                </div>
                            ) : null}
                        </div>
                        <div
                            style={{
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'flex-end'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    fontSize: 20,
                                    color: '#6b7280',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px'
                                }}
                            >
                                Payable Amount
                            </div>
                            <div
                                style={{
                                    marginTop: 8,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 86,
                                    fontWeight: 900,
                                    color: '#047857',
                                    textAlign: 'center',
                                    lineHeight: 1
                                }}
                            >
                                Rs {safeAmount}
                            </div>

                            <div
                                style={{
                                    marginTop: 10,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 20,
                                    color: '#64748b'
                                }}
                            >
                                Powered by ServiZephyr
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            width: '56%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <div
                            style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 24,
                                padding: 22,
                                border: '3px solid #e5e7eb',
                                background: '#f8fafc'
                            }}
                        >
                            <div
                                style={{
                                    width: qrSize,
                                    height: qrSize,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 16,
                                    background: '#ffffff',
                                    overflow: 'hidden'
                                }}
                            >
                                <img
                                    src={qrSvgDataUri}
                                    alt="UPI QR"
                                    width={qrSize}
                                    height={qrSize}
                                    style={{ objectFit: 'contain' }}
                                />
                            </div>

                            <div
                                style={{
                                    position: 'absolute',
                                    width: 104,
                                    height: 104,
                                    borderRadius: 20,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#000000',
                                    border: '5px solid #ffffff',
                                    overflow: 'hidden'
                                }}
                            >
                                {logoDataUri ? (
                                    <img
                                        src={logoDataUri}
                                        alt="ServiZephyr"
                                        width={74}
                                        height={74}
                                        style={{ objectFit: 'contain' }}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            display: 'flex',
                                            color: '#facc15',
                                            fontSize: 34,
                                            fontWeight: 800
                                        }}
                                    >
                                        SZ
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 800
        }
    );
}

export async function generateUpiQrCardPngBuffer(params) {
    const response = await createUpiQrCardImageResponse(params);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
