/**
 * Creates WhatsApp welcome CTA template:
 * - URL button 1: Food Order (opens website directly)
 * - URL button 2: Track Last Order (opens website directly)
 * - Quick reply: Need Help
 *
 * Usage:
 *   node -r dotenv/config scripts/create-whatsapp-welcome-cta-template.js dotenv_config_path=.env.local
 */

 const axios = require('axios');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function sanitizeTemplateName(name) {
    const candidate = String(name || 'servizephyr_welcome_cta_utility').toLowerCase();
    return candidate.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 512);
}

function normalizeBaseUrl(raw) {
    const url = String(raw || 'https://www.servizephyr.com').trim().replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(url)) {
        throw new Error(`Invalid WHATSAPP_CTA_BASE_URL: ${raw}`);
    }
    return url;
}

function readServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    }
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    const localPath = path.join(process.cwd(), 'servizephyr-firebase-adminsdk.json');
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    return null;
}

async function resolveWabaIdFromFirestore() {
    const serviceAccount = readServiceAccount();
    if (!serviceAccount) return null;

    if (!admin.apps.length) {
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId,
        });
    }

    const firestore = admin.firestore();
    const collections = ['restaurants', 'shops'];

    for (const collectionName of collections) {
        const snapshot = await firestore.collection(collectionName).limit(300).get();
        for (const doc of snapshot.docs) {
            const wabaId = String(doc.data()?.wabaId || '').trim();
            if (wabaId) {
                return wabaId;
            }
        }
    }

    return null;
}

async function run() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    let wabaId =
        process.env.WHATSAPP_WABA_ID ||
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
        process.env.META_WABA_ID;

    if (!accessToken) {
        throw new Error('Missing WHATSAPP_ACCESS_TOKEN in environment.');
    }
    if (!wabaId) {
        try {
            wabaId = await resolveWabaIdFromFirestore();
        } catch (firestoreLookupError) {
            console.warn('Could not auto-detect WABA ID from Firestore:', firestoreLookupError?.message || firestoreLookupError);
        }
    }
    if (!wabaId) {
        throw new Error('Missing WHATSAPP_WABA_ID and could not auto-detect wabaId from Firestore.');
    }

    const templateName = sanitizeTemplateName(process.env.WHATSAPP_WELCOME_CTA_TEMPLATE_NAME || 'servizephyr_welcome_cta_utility');
    const language = (process.env.WHATSAPP_WELCOME_CTA_TEMPLATE_LANGUAGE || 'en').trim();
    const baseUrl = normalizeBaseUrl(process.env.WHATSAPP_CTA_BASE_URL || 'https://www.servizephyr.com');
    const category = String(process.env.WHATSAPP_WELCOME_TEMPLATE_CATEGORY || 'UTILITY').trim().toUpperCase();
    const deleteFirst = String(process.env.WHATSAPP_TEMPLATE_DELETE_FIRST || 'false').trim().toLowerCase() === 'true';
    const allowCategoryChange = String(process.env.WHATSAPP_ALLOW_CATEGORY_CHANGE || 'false').trim().toLowerCase() === 'true';

    const validCategories = new Set(['UTILITY', 'MARKETING', 'AUTHENTICATION']);
    if (!validCategories.has(category)) {
        throw new Error(`Invalid WHATSAPP_WELCOME_TEMPLATE_CATEGORY: ${category}`);
    }

    if (deleteFirst) {
        try {
            const deleteRes = await axios.delete(
                `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                    params: { name: templateName },
                }
            );
            console.log('Existing template delete response:', JSON.stringify(deleteRes.data, null, 2));
        } catch (deleteError) {
            const metaDeleteError = deleteError?.response?.data?.error;
            if (metaDeleteError?.code === 132001 || metaDeleteError?.error_subcode === 2388044) {
                console.log('Template not found during delete-first step. Continuing with create...');
            } else if (metaDeleteError) {
                console.error('Delete-first Meta API error:', JSON.stringify(metaDeleteError, null, 2));
                throw deleteError;
            } else {
                throw deleteError;
            }
        }
    }

    const payload = {
        name: templateName,
        language,
        category,
        allow_category_change: allowCategoryChange,
        components: [
            {
                type: 'HEADER',
                format: 'TEXT',
                text: '{{1}}',
                example: {
                    header_text: ['ServiZephyr Restaurant']
                }
            },
            {
                type: 'BODY',
                text: 'Hi {{1}}! Choose an option below to continue quickly.',
                example: {
                    body_text: [['Customer']]
                }
            },
            {
                type: 'FOOTER',
                text: 'Powered by ServiZephyr'
            },
            {
                type: 'BUTTONS',
                buttons: [
                    {
                        type: 'URL',
                        text: 'Food Order',
                        url: `${baseUrl}/{{1}}`,
                        example: ['order/up-14-food-point?ref=demoRef']
                    },
                    {
                        type: 'URL',
                        text: 'Track Last Order',
                        url: `${baseUrl}/{{1}}`,
                        example: ['track/delivery/demoOrderId?token=demoToken&ref=demoRef&activeOrderId=demoOrderId']
                    },
                    {
                        type: 'QUICK_REPLY',
                        text: 'Need Help'
                    }
                ]
            }
        ]
    };

    console.log('========================================');
    console.log('Creating WhatsApp Welcome CTA Template');
    console.log(`WABA ID: ${wabaId}`);
    console.log(`Template: ${templateName}`);
    console.log(`Language: ${language}`);
    console.log(`Category: ${category}`);
    console.log(`Delete First: ${deleteFirst}`);
    console.log(`Allow Category Change: ${allowCategoryChange}`);
    console.log('========================================');

    try {
        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('Template created successfully.');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('Set these env values (if not already set):');
        console.log(`WHATSAPP_WELCOME_CTA_TEMPLATE_NAME=${templateName}`);
        console.log(`WHATSAPP_WELCOME_CTA_TEMPLATE_LANGUAGE=${language}`);
    } catch (error) {
        const metaError = error?.response?.data?.error;
        if (metaError) {
            console.error('Meta API error:', JSON.stringify(metaError, null, 2));
        } else {
            console.error('Request error:', error?.message || error);
        }
        process.exit(1);
    }
}

run().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
});
