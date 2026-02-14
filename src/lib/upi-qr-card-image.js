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
    const qrBoxSize = 560;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(-45deg, #f6df85 0%, #ffffff 100%)',
                    padding: 30,
                    fontFamily: 'sans-serif'
                }}
            >
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 42,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 26,
                        background: 'linear-gradient(-45deg, #f7e7a6 0%, #fff7d6 100%)',
                        boxShadow: '0 22px 46px rgba(15, 23, 42, 0.20)'
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: 28,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            background: '#ffffff',
                            padding: '28px 30px 24px 30px'
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                width: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 74,
                                fontWeight: 800,
                                color: '#111111',
                                letterSpacing: '1px',
                                lineHeight: 1.05,
                                textAlign: 'center',
                                textShadow: '3px 3px 0 rgba(0,0,0,0.16)'
                            }}
                        >
                            SCAN TO PAY
                        </div>

                        <div
                            style={{
                                width: '100%',
                                marginTop: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 24,
                                lineHeight: 1.2,
                                color: '#475569',
                                fontWeight: 600,
                                textAlign: 'center'
                            }}
                        >
                            Use any UPI app to pay this exact amount
                        </div>

                        <div
                            style={{
                                marginTop: 18,
                                width: qrBoxSize,
                                height: qrBoxSize,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                position: 'relative',
                                background: '#ffffff',
                                borderRadius: 18,
                                border: '8px solid #111827',
                                overflow: 'hidden'
                            }}
                        >
                            <img
                                src={qrSvgDataUri}
                                alt="UPI QR"
                                width={qrBoxSize - 38}
                                height={qrBoxSize - 38}
                                style={{ objectFit: 'contain' }}
                            />

                            <div
                                style={{
                                    position: 'absolute',
                                    width: 126,
                                    height: 126,
                                    borderRadius: 22,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#111827',
                                    border: '6px solid #ffffff',
                                    boxShadow: '0 8px 16px rgba(0,0,0,0.28)',
                                    overflow: 'hidden'
                                }}
                            >
                                {logoDataUri ? (
                                    <img
                                        src={logoDataUri}
                                        alt="ServiZephyr"
                                        width={90}
                                        height={90}
                                        style={{ objectFit: 'contain' }}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            display: 'flex',
                                            color: '#facc15',
                                            fontSize: 42,
                                            fontWeight: 800
                                        }}
                                    >
                                        SZ
                                    </div>
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                marginTop: 14,
                                display: 'flex',
                                width: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 22,
                                color: '#475569',
                                fontWeight: 600,
                                textAlign: 'center'
                            }}
                        >
                            UPI ID: {safeText(safeUpiId, 'Not Set', 40)}
                        </div>

                        <div
                            style={{
                                marginTop: 8,
                                display: 'flex',
                                width: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 54,
                                fontWeight: 800,
                                color: '#111827',
                                textAlign: 'center',
                                lineHeight: 1.1
                            }}
                        >
                            {safeRestaurantName}
                        </div>

                        {safeOrderId ? (
                            <div
                                style={{
                                    marginTop: 8,
                                    display: 'flex',
                                    width: '100%',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 30,
                                    color: '#475569',
                                    fontWeight: 700
                                }}
                            >
                                Order ID: {safeOrderId}
                            </div>
                        ) : null}

                        <div
                            style={{
                                marginTop: 10,
                                display: 'flex',
                                width: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 64,
                                color: '#065f46',
                                fontWeight: 900,
                                lineHeight: 1
                            }}
                        >
                            INR {safeAmount}
                        </div>

                        <div
                            style={{
                                marginTop: 16,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '100%'
                            }}
                        >
                            <div style={{ display: 'flex', fontSize: 30, color: '#475569', fontWeight: 700 }}>
                                Powered by ServiZephyr
                            </div>
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
