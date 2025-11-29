import http from 'k6/http';
import { sleep, check } from 'k6';

// ULTIMATE STRESS TEST - 1000 USERS!
export const options = {
    stages: [
        { duration: '15s', target: 200 },   // Ramp to 200
        { duration: '15s', target: 500 },   // Push to 500
        { duration: '30s', target: 1000 },  // MAX STRESS - 1000 USERS! 🔥
        { duration: '60s', target: 1000 },  // HOLD 1000 FOR 1 MINUTE!
        { duration: '10s', target: 0 },     // Quick ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<8000'], // Allow 8s for extreme stress
        http_req_failed: ['rate<0.2'],     // Allow 20% failures
    },
};

export default function () {
    let res;

    // 1. Homepage (10% users)
    if (Math.random() < 0.1) {
        res = http.get('https://www.servizephyr.com');
        check(res, {
            'homepage loaded': (r) => r.status === 200,
        });
        sleep(0.2);
    }

    // 2. Order Page (40% users - main traffic)
    if (Math.random() < 0.4) {
        res = http.get('https://www.servizephyr.com/order/baaghi-chai');
        check(res, {
            'order page loaded': (r) => r.status === 200,
        });
        sleep(0.2);
    }

    // 3. Vendor Dashboard (20% users)
    if (Math.random() < 0.2) {
        res = http.get('https://www.servizephyr.com/street-vendor-dashboard');
        check(res, {
            'vendor dashboard loaded': (r) => r.status === 200 || r.status === 302 || r.status === 401,
        });
        sleep(0.2);
    }

    // 4. Order Tracking (30% users - NEW!)
    if (Math.random() < 0.3) {
        res = http.get('https://www.servizephyr.com/track/pre-order/i6qf8ZKPj2wC2nuznC6N?token=cd-uGKgOrASIcQDYqco2PaPU');
        check(res, {
            'order tracking loaded': (r) => r.status === 200,
            'tracking fast': (r) => r.timings.duration < 3000,
        });
        sleep(0.2);
    }

    // 5. Menu API (some users)
    if (Math.random() < 0.2) {
        res = http.get('https://www.servizephyr.com/api/public/menu/baaghi-chai');
        check(res, {
            'menu API working': (r) => r.status === 200,
        });
        sleep(0.1);
    }

    sleep(0.1); // Minimal sleep for max RPS
}
