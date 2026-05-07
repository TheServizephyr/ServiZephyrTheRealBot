import { getFirestore } from '@/lib/firebase-admin';

const ADMIN_CONFIG_COLLECTION = 'admins';
const ADMIN_CONFIG_DOC_ID = 'servizephyr';

function splitEmails(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getAdminSupportEmail() {
    try {
        const firestore = await getFirestore();
        const snap = await firestore.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_CONFIG_DOC_ID).get();
        if (!snap.exists) return '';
        return String(snap.data()?.supportEmail || '').trim();
    } catch {
        return '';
    }
}

async function resolveRecipients() {
    const envRecipients = splitEmails(process.env.ADMIN_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL_TO);
    if (envRecipients.length > 0) return envRecipients;

    const supportEmail = await getAdminSupportEmail();
    return splitEmails(supportEmail);
}

function getIncidentUrl(incidentId) {
    const baseUrl = String(
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.VERCEL_URL ||
        ''
    ).trim();

    const normalizedBase = baseUrl
        ? (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`)
        : 'https://www.servizephyr.com';

    return `${normalizedBase.replace(/\/+$/, '')}/admin-dashboard/ops-incidents?incident=${encodeURIComponent(incidentId)}`;
}

function buildEmailText({ incident, event, incidentUrl }) {
    return [
        `[${String(incident.severity || 'error').toUpperCase()}] ${incident.title || incident.message || 'ServiZephyr incident'}`,
        '',
        `Source: ${incident.source || 'unknown'}`,
        `Area: ${incident.area || 'general'}`,
        `Route: ${incident.route || event?.path || 'unknown'}`,
        `Environment: ${incident.environment || process.env.NODE_ENV || 'unknown'}`,
        `Count: ${incident.count || 1}`,
        `Incident ID: ${incident.id}`,
        `Open: ${incidentUrl}`,
        '',
        'Message:',
        incident.message || event?.message || 'No message provided',
        '',
        event?.stack ? `Stack:\n${String(event.stack).slice(0, 4000)}` : '',
    ].filter(Boolean).join('\n');
}

function buildEmailHtml({ incident, event, incidentUrl }) {
    const severity = escapeHtml(String(incident.severity || 'error').toUpperCase());
    const title = escapeHtml(incident.title || incident.message || 'ServiZephyr incident');
    const message = escapeHtml(incident.message || event?.message || 'No message provided');
    const stack = event?.stack ? escapeHtml(String(event.stack).slice(0, 4000)) : '';

    return `
        <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
            <p style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#b91c1c;font-weight:700">${severity}</p>
            <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
            <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Source</td><td>${escapeHtml(incident.source || 'unknown')}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Area</td><td>${escapeHtml(incident.area || 'general')}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Route</td><td>${escapeHtml(incident.route || event?.path || 'unknown')}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Environment</td><td>${escapeHtml(incident.environment || process.env.NODE_ENV || 'unknown')}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Count</td><td>${escapeHtml(incident.count || 1)}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#6b7280">Incident ID</td><td>${escapeHtml(incident.id)}</td></tr>
            </table>
            <p><a href="${escapeHtml(incidentUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px">Open in Admin Panel</a></p>
            <h2 style="font-size:15px;margin-top:22px">Message</h2>
            <pre style="white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:12px;font-size:13px">${message}</pre>
            ${stack ? `<h2 style="font-size:15px;margin-top:22px">Stack</h2><pre style="white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:12px;font-size:12px">${stack}</pre>` : ''}
        </div>
    `;
}

export async function sendOpsIncidentEmail({ incident, event }) {
    const recipients = await resolveRecipients();
    if (recipients.length === 0) {
        return { sent: false, reason: 'missing_recipient' };
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!resendApiKey) {
        return { sent: false, reason: 'missing_resend_api_key' };
    }

    const from = String(process.env.OPS_ALERT_EMAIL_FROM || 'ServiZephyr Alerts <alerts@servizephyr.com>').trim();
    const incidentUrl = getIncidentUrl(incident.id);
    const subject = `[ServiZephyr ${String(incident.severity || 'error').toUpperCase()}] ${String(incident.title || incident.message || 'Production incident').slice(0, 120)}`;

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: recipients,
            subject,
            text: buildEmailText({ incident, event, incidentUrl }),
            html: buildEmailHtml({ incident, event, incidentUrl }),
        }),
    });

    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`Resend email failed (${response.status}): ${responseText.slice(0, 300)}`);
    }

    let parsed = null;
    try {
        parsed = JSON.parse(responseText);
    } catch {
        parsed = { raw: responseText.slice(0, 300) };
    }

    return {
        sent: true,
        provider: 'resend',
        recipients,
        providerMessageId: parsed?.id || null,
    };
}
