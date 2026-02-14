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
    const qrSize = 430;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                    padding: 48,
                    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                }}
            >
                <div
                    style={{
                        width: 760,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 32,
                        background: '#ffffff',
                        padding: '44px 38px',
                        boxShadow: '0 24px 48px rgba(15, 23, 42, 0.16)',
                        border: '1px solid rgba(255,255,255,0.35)'
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 62,
                            lineHeight: 1.05,
                            fontWeight: 800,
                            color: '#1a1a1a',
                            textAlign: 'center'
                        }}
                    >
                        {safeRestaurantName}
                    </div>

                    <div
                        style={{
                            width: '100%',
                            marginTop: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 22,
                            color: '#666666',
                            textAlign: 'center'
                        }}
                    >
                        {safeText(safeUpiId, 'Not Set', 48)}
                    </div>

                    <div
                        style={{
                            width: '100%',
                            marginTop: 32,
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
                                border: '3px solid #edf2f7',
                                background: '#f8f9fb'
                            }}
                        >
                            <div
                                style={{
                                    width: qrSize,
                                    height: qrSize,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 14,
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
                                    width: 88,
                                    height: 88,
                                    borderRadius: 16,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#000000',
                                    border: '4px solid #ffffff',
                                    overflow: 'hidden'
                                }}
                            >
                                {logoDataUri ? (
                                    <img
                                        src={logoDataUri}
                                        alt="ServiZephyr"
                                        width={62}
                                        height={62}
                                        style={{ objectFit: 'contain' }}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            display: 'flex',
                                            color: '#facc15',
                                            fontSize: 30,
                                            fontWeight: 800
                                        }}
                                    >
                                        SZ
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            width: '100%',
                            marginTop: 28,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column'
                        }}
                    >
                        <div
                            style={{
                                fontSize: 20,
                                color: '#888888',
                                textTransform: 'uppercase',
                                letterSpacing: '1px',
                                fontWeight: 600
                            }}
                        >
                            Payable Amount
                        </div>

                        <div
                            style={{
                                marginTop: 10,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 86,
                                fontWeight: 800,
                                color: '#059669',
                                textAlign: 'center',
                                lineHeight: 1.1
                            }}
                        >
                            Rs {safeAmount}
                        </div>
                    </div>

                    {safeOrderId ? (
                        <div
                            style={{
                                marginTop: 22,
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 22,
                                    color: '#6b7280',
                                    background: '#f1f5f9',
                                    padding: '10px 18px',
                                    borderRadius: 999
                                }}
                            >
                                Order ID: {safeOrderId}
                            </div>
                        </div>
                    ) : null}

                    <div
                        style={{
                            width: '100%',
                            marginTop: 30,
                            borderTop: '1px solid #eeeeee',
                            paddingTop: 20,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 20,
                                color: '#aaaaaa'
                            }}
                        >
                            Powered by <span style={{ fontWeight: 700, color: '#4a5568' }}>ServiZephyr</span>
                        </div>

                        <div
                            style={{
                                marginTop: 10,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 18,
                                color: '#9ca3af'
                            }}
                        >
                            GPay • PhonePe • Paytm
                        </div>
                    </div>
                </div>
            </div>
        ),
        {
            width: 1080,
            height: 1080
        }
    );
}

export async function generateUpiQrCardPngBuffer(params) {
    const response = await createUpiQrCardImageResponse(params);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
