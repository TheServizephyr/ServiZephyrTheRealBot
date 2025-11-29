import http from 'k6/http';
import { sleep, check } from 'k6';

// 150 USERS - 5 MINUTE DURABILITY TEST (SAFE ZONE)
export const options = {
    stages: [
        { duration: '30s', target: 50 },    // Warm up
        { duration: '30s', target: 100 },   // Ramp to 100
        { duration: '1m', target: 150 },    // Ramp to 150
        { duration: '5m', target: 150 },    // HOLD 150 FOR 5 MINUTES! ✅
        { duration: '30s', target: 0 },     // Cool down
    ],
    thresholds: {
        http_req_duration: ['p(95)<3000'],  // 95% under 3s
        http_req_failed: ['rate<0.02'],     // Less than 2% failures
    },
};

export default function () {
    let res;

    // Order Page (main traffic)
    res = http.get('https://www.servizephyr.com/order/baaghi-chai');
    check(res, {
        'order page loaded': (r) => r.status === 200,
        'order page fast': (r) => r.timings.duration < 2000,
    });
    sleep(0.3);

    // Menu API (critical for caching test)
    if (Math.random() < 0.5) {
        res = http.get('https://www.servizephyr.com/api/public/menu/baaghi-chai');
        check(res, {
            'menu API working': (r) => r.status === 200,
            'menu cached': (r) => r.headers['X-Cache'] === 'HIT',
            'menu fast': (r) => r.timings.duration < 1000,
        });
        sleep(0.2);
    }

    // Vendor Dashboard
    if (Math.random() < 0.3) {
        res = http.get('https://www.servizephyr.com/street-vendor-dashboard');
        check(res, {
            'vendor dashboard loaded': (r) => r.status === 200 || r.status === 302 || r.status === 401,
        });
        sleep(0.2);
    }

    sleep(0.5); // Realistic user behavior
}
