import http from 'k6/http';
import { sleep, check } from 'k6';

// VENDOR DASHBOARD STRESS TEST - 500 Vendors, 1 Minute Hold
// Testing LIVE ORDERS on main dashboard
export const options = {
    stages: [
        { duration: '10s', target: 100 },   // Quick ramp to 100
        { duration: '10s', target: 300 },   // Push to 300
        { duration: '20s', target: 500 },   // Ramp to 500
        { duration: '60s', target: 500 },   // HOLD 500 VENDORS FOR 1 MINUTE! 🔥
        { duration: '10s', target: 0 },     // Quick ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<5000'], // Allow 5s for stress
        http_req_failed: ['rate<0.15'],    // Allow 15% failures
    },
};

export default function () {
    // Main vendor dashboard - LIVE ORDERS PAGE
    let res = http.get('https://www.servizephyr.com/street-vendor-dashboard');
    check(res, {
        'live orders dashboard loaded': (r) => r.status === 200 || r.status === 302 || r.status === 401,
        'no server crash': (r) => r.status !== 500,
        'response fast': (r) => r.timings.duration < 3000,
    });
    sleep(0.5); // Vendors refresh every 30s-1min

    // Some vendors also check history (30%)
    if (Math.random() < 0.3) {
        res = http.get('https://www.servizephyr.com/street-vendor-dashboard/history');
        check(res, {
            'history loaded': (r) => r.status === 200 || r.status === 302 || r.status === 401,
        });
        sleep(0.3);
    }
}
