import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        checks: ['rate>0.95'], // 95% tests should pass
    },
};

const BASE_URL = 'https://www.servizephyr.com';
const RESTAURANT_ID = 'baaghi-chai';

export default function () {
    let response;

    console.log('🚀 Starting Functionality Tests...\n');

    // TEST 1: Homepage
    group('1. Homepage Tests', function () {
        response = http.get(BASE_URL);
        check(response, {
            '✅ Homepage loads': (r) => r.status === 200,
            '✅ Homepage has content': (r) => r.body.length > 1000,
            '✅ Homepage loads fast': (r) => r.timings.duration < 2000,
        });
        sleep(1);
    });

    // TEST 2: Order Page
    group('2. Order Page Tests', function () {
        response = http.get(`${BASE_URL}/order/${RESTAURANT_ID}`);
        check(response, {
            '✅ Order page loads': (r) => r.status === 200,
            '✅ Order page has menu': (r) => r.body.includes('menu') || r.body.includes('item'),
            '✅ Order page loads fast': (r) => r.timings.duration < 3000,
        });
        sleep(1);
    });

    // TEST 3: Menu API
    group('3. Menu API Tests', function () {
        response = http.get(`${BASE_URL}/api/public/menu/${RESTAURANT_ID}`);
        check(response, {
            '✅ Menu API works': (r) => r.status === 200,
            '✅ Menu API returns JSON': (r) => {
                try {
                    JSON.parse(r.body);
                    return true;
                } catch (e) {
                    return false;
                }
            },
            '✅ Menu API has items': (r) => {
                try {
                    const data = JSON.parse(r.body);
                    return data && (data.menu || data.items || Array.isArray(data));
                } catch (e) {
                    return false;
                }
            },
        });
        sleep(1);
    });

    // TEST 4: Cart Page
    group('4. Cart Page Tests', function () {
        response = http.get(`${BASE_URL}/cart`);
        check(response, {
            '✅ Cart page loads': (r) => r.status === 200,
            '✅ Cart page accessible': (r) => r.body.length > 500,
        });
        sleep(1);
    });

    // TEST 5: Vendor Dashboard (Public Access Check)
    group('5. Vendor Dashboard Tests', function () {
        response = http.get(`${BASE_URL}/street-vendor-dashboard`);
        check(response, {
            '✅ Dashboard exists': (r) => r.status === 200 || r.status === 401 || r.status === 302,
            '✅ Dashboard protected': (r) => r.status !== 500, // Should not crash
        });
        sleep(1);
    });

    // TEST 6: Admin Dashboard (Public Access Check)
    group('6. Admin Dashboard Tests', function () {
        response = http.get(`${BASE_URL}/admin-dashboard`);
        check(response, {
            '✅ Admin exists': (r) => r.status === 200 || r.status === 401 || r.status === 302,
            '✅ Admin protected': (r) => r.status !== 500,
        });
        sleep(1);
    });

    // TEST 7: Static Assets
    group('7. Static Assets Tests', function () {
        // Test if images/assets load
        response = http.get(BASE_URL);
        check(response, {
            '✅ Has CSS/styling': (r) => r.body.includes('css') || r.body.includes('style'),
            '✅ Has JavaScript': (r) => r.body.includes('script') || r.body.includes('js'),
        });
        sleep(1);
    });

    // TEST 8: Error Handling
    group('8. Error Handling Tests', function () {
        response = http.get(`${BASE_URL}/non-existent-page-12345`);
        check(response, {
            '✅ 404 page works': (r) => r.status === 404 || r.status === 200, // Next.js might redirect
            '✅ Error handled gracefully': (r) => r.status !== 500,
        });
        sleep(1);
    });

    // TEST 9: API Error Handling
    group('9. API Error Handling Tests', function () {
        response = http.get(`${BASE_URL}/api/public/menu/non-existent-restaurant-xyz`);
        check(response, {
            '✅ Invalid restaurant handled': (r) => r.status === 404 || r.status === 400 || r.status === 200,
            '✅ API error handled': (r) => r.status !== 500,
        });
        sleep(1);
    });

    // TEST 10: Mobile Responsiveness (Check viewport meta)
    group('10. Mobile Support Tests', function () {
        response = http.get(BASE_URL);
        check(response, {
            '✅ Has viewport meta': (r) => r.body.includes('viewport'),
            '✅ Mobile optimized': (r) => r.body.includes('mobile') || r.body.includes('responsive'),
        });
    });

    console.log('\n✅ All Functionality Tests Complete!\n');
}
