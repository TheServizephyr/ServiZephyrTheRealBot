/**
 * SERVIZEPHYR PRODUCTION LOAD TEST - DINE-IN FLOW
 * ⚠️ SAFETY: No payment endpoints touched!
 * ✅ Tests: Menu fetch (Public) → Order create (dine-in) → Track page
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

export let options = {
    stages: [
        { duration: '30s', target: 5 },   // Warm-up
        { duration: '60s', target: 15 },  // Moderate load
        { duration: '60s', target: 30 },  // Heavy load
        { duration: '30s', target: 0 },   // Cool down
    ],
    thresholds: {
        http_req_duration: ['p(95)<5000'], // 95% requests under 5s
        http_req_failed: ['rate<0.1'],     // Less than 10% failure rate
    },
};

// 🔥 PRODUCTION URL
const BASE_URL = 'https://www.servizephyr.com';

// Test restaurant ID (use your actual restaurant ID)
const RESTAURANT_ID = 'ashwanis-restaurant';

// Headers
const headers = {
    'Content-Type': 'application/json',
};

export default function () {
    const tableId = `T${Math.floor(Math.random() * 5) + 1}`; // Random T1-T5
    const tabName = `LoadTest-${__VU}-${__ITER}`;

    /* ============ STEP 1: FETCH MENU (PUBLIC API) ============ */
    console.log(`[VU ${__VU}] Fetching menu...`);

    // ✅ FIX: Use Public Menu API (No Auth Required)
    let menuRes = http.get(
        `${BASE_URL}/api/public/menu/${RESTAURANT_ID}`,
        { headers }
    );

    check(menuRes, {
        '[Menu] Status 200': (r) => r.status === 200,
        '[Menu] Has items': (r) => {
            try {
                const body = JSON.parse(r.body);
                if (!body.menu) return false;
                // Check if any category has items inside the menu object
                return Object.values(body.menu).some(items => Array.isArray(items) && items.length > 0);
            } catch (e) {
                return false;
            }
        },
    });

    // Extract a real menu item for order
    let menuItems = [];
    try {
        const data = JSON.parse(menuRes.body);
        // Flatten menu object into array of items
        if (data.menu) {
            Object.values(data.menu).forEach(categoryItems => {
                if (Array.isArray(categoryItems)) {
                    menuItems.push(...categoryItems);
                }
            });
        }
    } catch (e) {
        console.error('[Menu] Parse error:', e);
    }

    if (menuItems.length === 0) {
        console.error('[Menu] No items found, aborting this iteration');
        sleep(2);
        return;
    }

    sleep(1); // User browsing menu

    /* ============ STEP 2: CREATE DINE-IN ORDER (WRITE) ============ */
    console.log(`[VU ${__VU}] Creating dine-in order...`);

    // Pick random menu items
    const item1 = menuItems[Math.floor(Math.random() * menuItems.length)];
    const item2 = menuItems[Math.floor(Math.random() * menuItems.length)];

    // Defensive check in case selected items are undefined
    if (!item1 || !item2) {
        console.error('[Order] Failed to pick random items');
        return;
    }

    const orderPayload = {
        restaurantId: RESTAURANT_ID,
        deliveryType: 'dine-in',
        tableId: tableId,
        tabName: tabName,
        paxCount: Math.floor(Math.random() * 4) + 1,
        items: [
            {
                id: item1.id,
                name: item1.name,
                price: item1.price || 100,
                quantity: Math.floor(Math.random() * 3) + 1,
                category: item1.categoryId || 'general',
            },
            {
                id: item2.id,
                name: item2.name,
                price: item2.price || 150,
                quantity: Math.floor(Math.random() * 2) + 1,
                category: item2.categoryId || 'general',
            },
        ],
        customerName: `LoadTest User ${__VU}`,
        customerPhone: `9999${String(__VU).padStart(6, '0')}`,
        paymentMethod: 'cash', // ⚠️ SAFE: No payment gateway
        grandTotal: ((item1.price || 100) * 2 + (item2.price || 150) * 1.5).toFixed(2),
        notes: '🧪 LOAD TEST ORDER - IGNORE',
    };

    let orderRes = http.post(
        `${BASE_URL}/api/order/create`,
        JSON.stringify(orderPayload),
        { headers }
    );

    check(orderRes, {
        '[Order Create] Status OK': (r) => r.status === 200 || r.status === 201,
        '[Order Create] Has orderId': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.orderId !== undefined;
            } catch (e) {
                return false;
            }
        },
    });

    let orderId;
    try {
        const orderData = JSON.parse(orderRes.body);
        orderId = orderData.orderId;
        console.log(`[VU ${__VU}] Order created: ${orderId}`);
    } catch (e) {
        console.error('[Order Create] Parse error:', e);
    }

    sleep(2); // Simulating order confirmation

    /* ============ STEP 3: TRACK DINE-IN ORDER (HOT PAGE) ============ */
    if (orderId) {

        // We hit the tracking API endpoint instead of the full HTML page to stress test the backend
        // The previous script tried to hit /track/dine-in?id=XXX which might just be the HTML page
        // Let's stick to the page URL for now as it triggers other API calls

        let trackRes = http.get(
            `${BASE_URL}/track/dine-in?id=${orderId}`,
            { headers }
        );

        check(trackRes, {
            '[Track] Page loads': (r) => r.status === 200,
        });
    }

    sleep(2);
}

export function handleSummary(data) {
    return {
        'stdout': JSON.stringify(data, null, 2),
        'load-test-summary.json': JSON.stringify(data),
    };
}
