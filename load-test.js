import http from 'k6/http';
import { sleep, check } from 'k6';

// Test configuration - Focus on ORDER PAGE
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // 20 users
    { duration: '1m', target: 50 },    // 50 users (normal traffic)
    { duration: '1m', target: 100 },   // 100 users (peak time)
    { duration: '30s', target: 150 },  // 150 users (stress test)
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% requests 3s se kam
    http_req_failed: ['rate<0.05'],    // 5% se kam failures
  },
};

export default function () {
  // Simulate real customer journey

  // Step 1: Homepage (10% customers)
  if (Math.random() < 0.1) {
    let res = http.get('https://www.servizephyr.com');
    check(res, {
      'homepage loaded': (r) => r.status === 200,
    });
    sleep(2);
  }

  // Step 2: ORDER PAGE - Main focus (90% traffic here!)
  let res = http.get('https://www.servizephyr.com/order/baaghi-chai');
  check(res, {
    'order page loaded': (r) => r.status === 200,
    'order page fast': (r) => r.timings.duration < 2000,
  });
  sleep(3); // Customer browses menu

  // Step 3: Menu API (customer viewing items)
  res = http.get('https://www.servizephyr.com/api/public/menu/baaghi-chai');
  check(res, {
    'menu API working': (r) => r.status === 200,
    'menu API fast': (r) => r.timings.duration < 1000,
  });
  sleep(2);

  // Step 4: Some customers check cart (30%)
  if (Math.random() < 0.3) {
    res = http.get('https://www.servizephyr.com/cart');
    check(res, {
      'cart loaded': (r) => r.status === 200,
    });
    sleep(1);
  }

  sleep(1);
}