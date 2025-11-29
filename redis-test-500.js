import http from 'k6/http';
import { sleep, check } from 'k6';

// REDIS CACHING TEST - 500 Users
export const options = {
    stages: [
        { duration: '10s', target: 100 },
        { duration: '10s', target: 300 },
        { duration: '20s', target: 500 },
        { duration: '60s', target: 500 },  // Hold 500 for 1 minute
        { duration: '10s', target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<5000'],
        http_req_failed: ['rate<0.15'],
    },
};

export default function () {
    let res;

    // Order Page (40%)
    if (Math.random() < 0.4) {
        res = http.get('https://www.servizephyr.com/order/baaghi-chai');
        check(res, { 'order page loaded': (r) => r.status === 200 });
        sleep(0.2);
    }

    // Menu API (30%)
    if (Math.random() < 0.3) {
        res = http.get('https://www.servizephyr.com/api/public/menu/baaghi-chai');
        check(res, {
            'menu API working': (r) => r.status === 200,
            'menu fast': (r) => r.timings.duration < 1000,
        });
        sleep(0.1);
    }

    // Vendor Dashboard (20%)
    if (Math.random() < 0.2) {
        res = http.get('https://www.servizephyr.com/street-vendor-dashboard');
        check(res, { 'vendor dashboard loaded': (r) => r.status === 200 || r.status === 302 || r.status === 401 });
        sleep(0.2);
    }

    sleep(0.1);
}
