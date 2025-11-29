import http from 'k6/http';
import { sleep, check } from 'k6';

// STRESS TEST - 500 Users, Maximum RPS, 1 MINUTE HOLD!
export const options = {
    stages: [
        { duration: '10s', target: 100 },   // Quick ramp to 100
        { duration: '10s', target: 300 },   // Push to 300
        { duration: '20s', target: 500 },   // Ramp to 500
        { duration: '60s', target: 500 },   // HOLD 500 USERS FOR 1 MINUTE! 🔥
        { duration: '10s', target: 0 },     // Quick ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<5000'], // Allow 5s for stress
        http_req_failed: ['rate<0.15'],    // Allow 15% failures (worst case)
    },
};

export default function () {
    // Minimal sleep for MAXIMUM RPS

    // Order page - main target
    let res = http.get('https://www.servizephyr.com/order/baaghi-chai');
    check(res, {
        'order page loaded': (r) => r.status === 200,
    });
    sleep(0.1); // Very short sleep = high RPS

    // Menu API
    res = http.get('https://www.servizephyr.com/api/public/menu/baaghi-chai');
    check(res, {
        'menu API working': (r) => r.status === 200,
    });
    sleep(0.1);

    // Homepage (some users)
    if (Math.random() < 0.2) {
        res = http.get('https://www.servizephyr.com');
        check(res, {
            'homepage loaded': (r) => r.status === 200,
        });
        sleep(0.1);
    }
}
