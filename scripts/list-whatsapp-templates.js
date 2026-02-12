/**
 * Lists WhatsApp templates for a WABA, optionally filtered by name substring.
 *
 * Usage:
 *   node -r dotenv/config scripts/list-whatsapp-templates.js dotenv_config_path=.env.local
 *   node -r dotenv/config scripts/list-whatsapp-templates.js --contains=welcome dotenv_config_path=.env.local
 */

const axios = require('axios');

function readArg(prefix) {
    const arg = process.argv.find((entry) => entry.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : '';
}

async function run() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const wabaId =
        process.env.WHATSAPP_WABA_ID ||
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
        process.env.META_WABA_ID ||
        readArg('--waba=');
    const contains = (readArg('--contains=') || '').toLowerCase();

    if (!accessToken) {
        throw new Error('Missing WHATSAPP_ACCESS_TOKEN');
    }
    if (!wabaId) {
        throw new Error('Missing WABA id. Pass --waba=<id> or set env WHATSAPP_WABA_ID');
    }

    let url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=200`;
    const out = [];
    while (url) {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const rows = response.data?.data || [];
        out.push(...rows);
        url = response.data?.paging?.next || null;
    }

    const filtered = contains
        ? out.filter((template) => String(template?.name || '').toLowerCase().includes(contains))
        : out;

    const mapped = filtered.map((template) => ({
        id: template.id,
        name: template.name,
        category: template.category,
        status: template.status,
        language: template.language,
    }));

    console.log(JSON.stringify(mapped, null, 2));
}

run().catch((error) => {
    const metaError = error?.response?.data?.error;
    if (metaError) {
        console.error(JSON.stringify(metaError, null, 2));
    } else {
        console.error(error?.message || error);
    }
    process.exit(1);
});

