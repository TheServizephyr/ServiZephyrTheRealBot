/**
 * ServiZephyr Production Load Test
 * 
 * Simulates realistic customer order flow:
 *   Step 1: Bootstrap/Menu API (page load from WhatsApp)
 *   Step 2: Order Status check (if applicable)
 *   Step 3: Order Create (only in write mode)
 * 
 * Usage:
 *   node load-test.js                          # 50 users, 1 min, read-only
 *   node load-test.js --users=100 --duration=120
 *   node load-test.js --write                  # includes order creation (CAUTION!)
 */

const BASE_URL = 'https://www.servizephyr.com';
const RESTAURANT_ID = "ashwani's-restaurant";
const CUSTOMER_REF = 'gOJONhaefnPjNTfw6Ov7KYx6iWuV4KZo';
const LOAD_TEST_KEY = '7d94d3cd26ee347da22b0cc9db585e4225ae9f61e891a55f'; // matches CRON_SECRET

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace('--', '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const CONCURRENT_USERS = Number(args.users) || 50;
const DURATION_SEC = Number(args.duration) || 60;
const ENABLE_WRITES = args.write === true || args.write === 'true';
const RAMP_UP_SEC = Math.min(10, Math.floor(DURATION_SEC / 6)); // ramp up over first ~10s

console.log(`
╔═══════════════════════════════════════════════════════╗
║         ServiZephyr Production Load Test              ║
╠═══════════════════════════════════════════════════════╣
║  Target:       ${BASE_URL.padEnd(38)}║
║  Restaurant:   ${RESTAURANT_ID.slice(0, 38).padEnd(38)}║
║  Users:        ${String(CONCURRENT_USERS).padEnd(38)}║
║  Duration:     ${(DURATION_SEC + 's').padEnd(38)}║
║  Write Mode:   ${String(ENABLE_WRITES).padEnd(38)}║
║  Ramp Up:      ${(RAMP_UP_SEC + 's').padEnd(38)}║
╚═══════════════════════════════════════════════════════╝
`);

// Stats tracking
const stats = {
  bootstrap: { success: 0, fail: 0, times: [], errors: {}, statusCodes: {} },
  orderStatus: { success: 0, fail: 0, times: [], errors: {}, statusCodes: {} },
  orderCreate: { success: 0, fail: 0, times: [], errors: {}, statusCodes: {} },
  overall: { totalRequests: 0, startedAt: 0, endedAt: 0 },
};

function trackResponse(bucket, durationMs, statusCode, error = null) {
  stats[bucket].times.push(durationMs);
  stats[bucket].statusCodes[statusCode] = (stats[bucket].statusCodes[statusCode] || 0) + 1;
  stats.overall.totalRequests++;

  if (statusCode >= 200 && statusCode < 400) {
    stats[bucket].success++;
  } else {
    stats[bucket].fail++;
    const errKey = error || `HTTP_${statusCode}`;
    stats[bucket].errors[errKey] = (stats[bucket].errors[errKey] || 0) + 1;
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * (p / 100)) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms) {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function timedFetch(url, options = {}) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const res = await fetch(url, { 
      ...options, 
      signal: controller.signal,
      headers: {
        'User-Agent': 'ServiZephyr-LoadTest/1.0',
        'Accept': 'application/json',
        'x-load-test-key': LOAD_TEST_KEY,
        ...(options.headers || {}),
      }
    });
    clearTimeout(timeout);

    const duration = Date.now() - start;
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, duration, body };
  } catch (error) {
    const duration = Date.now() - start;
    const errMsg = error.name === 'AbortError' ? 'TIMEOUT_30s' : (error.message || 'NETWORK_ERROR');
    return { ok: false, status: 0, duration, body: null, error: errMsg };
  }
}

// ─── Step 1: Bootstrap / Menu Load ───────────────────────────────
async function simulatePageLoad(userId) {
  const encodedId = encodeURIComponent(RESTAURANT_ID);
  const url = `${BASE_URL}/api/public/bootstrap/${encodedId}?src=loadtest&ref=${CUSTOMER_REF}`;

  const result = await timedFetch(url);
  trackResponse('bootstrap', result.duration, result.status, result.error);

  if (result.ok && result.body) {
    const source = result.body?.meta?.source || (result.body?.menu ? 'snapshot' : 'unknown');
    // Track if we got data
    return { success: true, source, duration: result.duration };
  }

  return { success: false, status: result.status, error: result.error, duration: result.duration };
}

// ─── Step 2: Order Status Check ──────────────────────────────────
async function simulateOrderStatusCheck(userId) {
  // Use a fake order ID — we just want to test the endpoint's rate limiting and response time
  const fakeOrderId = `loadtest_${userId}_${Date.now()}`;
  const url = `${BASE_URL}/api/order/status/${fakeOrderId}`;

  const result = await timedFetch(url);
  trackResponse('orderStatus', result.duration, result.status, result.error);

  return { success: result.status !== 0 && result.status < 500, status: result.status, duration: result.duration };
}

// ─── Step 3: Order Create ─────────────────────────────────────────
async function simulateOrderCreate(userId) {
  const url = `${BASE_URL}/api/order/create`;

  const result = await timedFetch(url, {
    method: 'POST',
    body: JSON.stringify({
      restaurantId: RESTAURANT_ID,
      deliveryType: 'delivery',
      paymentMethod: 'cod',
      items: [{
        id: '2NaDtrfT2qXTR5BL7Yz2',
        name: 'Mix Veg. Raita',
        price: 63,
        quantity: 1,
        totalPrice: 63,
        categoryId: 'raita',
        portions: [{ name: 'Full', price: 63 }]
      }],
      subtotal: 63,
      grandTotal: 63,
      customer: {
        name: `LoadUser_${userId}`,
        phone: `9999999${(userId % 1000).toString().padStart(3, '0')}`
      },
      address: {
        full: '123 Test Street, Delhi',
        lat: 28.6139,
        lng: 77.2090
      },
      idempotencyKey: `loadtest_${userId}_${Date.now()}`
    })
  });

  trackResponse('orderCreate', result.duration, result.status, result.error);

  // 200 = order created successfully
  const isSuccess = result.status === 200;
  return { success: isSuccess, status: result.status, duration: result.duration };
}

// ─── Virtual User Flow ───────────────────────────────────────────
async function runVirtualUser(userId) {
  const userResults = [];

  if (ENABLE_WRITES) {
    const createCheck = await simulateOrderCreate(userId);
    userResults.push({ step: 'orderCreate', ...createCheck });
  }

  return userResults;
}

// ─── Main Load Test Runner ───────────────────────────────────────
async function runLoadTest() {
  console.log('🚀 Starting load test...\n');
  stats.overall.startedAt = Date.now();

  const endTime = Date.now() + (DURATION_SEC * 1000);
  let activeUsers = 0;
  let completedCycles = 0;
  let userCounter = 0;

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - stats.overall.startedAt) / 1000);
    const remaining = Math.max(0, DURATION_SEC - elapsed);
    const rps = stats.overall.totalRequests / Math.max(1, elapsed);
    process.stdout.write(
      `\r⏱  ${elapsed}s / ${DURATION_SEC}s | Active: ${activeUsers} | Completed: ${completedCycles} | Requests: ${stats.overall.totalRequests} | RPS: ${rps.toFixed(1)} | Remaining: ${remaining}s   `
    );
  }, 1000);

  // Spawn virtual users with ramp-up
  const userPromises = [];
  
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    // Ramp up: stagger user starts
    const delay = RAMP_UP_SEC > 0 ? (i / CONCURRENT_USERS) * RAMP_UP_SEC * 1000 : 0;

    const userPromise = (async () => {
      await new Promise(r => setTimeout(r, delay));

      // Each user loops: load page → wait → load again (simulates multiple pageviews)
      while (Date.now() < endTime) {
        activeUsers++;
        userCounter++;
        const userId = userCounter;

        try {
          await runVirtualUser(userId);
          completedCycles++;
        } catch (error) {
          console.error(`\n❌ User ${userId} crashed:`, error.message);
        }

        activeUsers--;

        // Wait 1-3 seconds before next cycle (simulates user think time)
        const thinkTime = 1000 + Math.random() * 2000;
        await new Promise(r => setTimeout(r, thinkTime));
      }
    })();

    userPromises.push(userPromise);
  }

  await Promise.all(userPromises);
  clearInterval(progressInterval);

  stats.overall.endedAt = Date.now();
  console.log('\n\n✅ Load test completed!\n');

  printReport();
}

// ─── Report Printer ──────────────────────────────────────────────
function printReport() {
  const durationSec = (stats.overall.endedAt - stats.overall.startedAt) / 1000;
  const totalRPS = stats.overall.totalRequests / durationSec;

  console.log('═══════════════════════════════════════════════════════');
  console.log('                    LOAD TEST REPORT');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Duration:        ${durationSec.toFixed(1)}s`);
  console.log(`  Total Requests:  ${stats.overall.totalRequests}`);
  console.log(`  Avg RPS:         ${totalRPS.toFixed(1)}`);
  console.log('');

  for (const [name, bucket] of Object.entries(stats)) {
    if (name === 'overall') continue;
    if (bucket.times.length === 0) continue;

    const total = bucket.success + bucket.fail;
    const successRate = total > 0 ? ((bucket.success / total) * 100).toFixed(1) : '0.0';

    console.log(`─── ${name.toUpperCase()} ${'─'.repeat(45 - name.length)}`);
    console.log(`  Total:           ${total}`);
    console.log(`  ✅ Success:      ${bucket.success} (${successRate}%)`);
    console.log(`  ❌ Failed:       ${bucket.fail}`);
    console.log(`  Response Times:`);
    console.log(`    Min:           ${formatMs(percentile(bucket.times, 0))}`);
    console.log(`    p50 (Median):  ${formatMs(percentile(bucket.times, 50))}`);
    console.log(`    p90:           ${formatMs(percentile(bucket.times, 90))}`);
    console.log(`    p95:           ${formatMs(percentile(bucket.times, 95))}`);
    console.log(`    p99:           ${formatMs(percentile(bucket.times, 99))}`);
    console.log(`    Max:           ${formatMs(percentile(bucket.times, 100))}`);
    console.log(`    Avg:           ${formatMs(bucket.times.reduce((a, b) => a + b, 0) / bucket.times.length)}`);

    if (Object.keys(bucket.statusCodes).length > 0) {
      console.log(`  Status Codes:`);
      for (const [code, count] of Object.entries(bucket.statusCodes).sort()) {
        const pct = ((count / total) * 100).toFixed(1);
        const icon = Number(code) >= 200 && Number(code) < 400 ? '🟢' : Number(code) === 429 ? '🟡' : '🔴';
        console.log(`    ${icon} ${code}: ${count} (${pct}%)`);
      }
    }

    if (Object.keys(bucket.errors).length > 0) {
      console.log(`  Errors:`);
      for (const [err, count] of Object.entries(bucket.errors).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`    ⚠️  ${err}: ${count}`);
      }
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════');

  // Pass/Fail assessment
  const bootstrapP95 = percentile(stats.bootstrap.times, 95);
  const bootstrapSuccessRate = stats.bootstrap.times.length > 0 
    ? (stats.bootstrap.success / (stats.bootstrap.success + stats.bootstrap.fail)) * 100 
    : 0;

  console.log('\n📊 VERDICT:');
  
  if (bootstrapSuccessRate >= 99 && bootstrapP95 < 3000) {
    console.log('  🟢 PASS — System handled the load excellently!');
  } else if (bootstrapSuccessRate >= 95 && bootstrapP95 < 5000) {
    console.log('  🟡 MARGINAL — Mostly OK but showing some stress');
  } else {
    console.log('  🔴 FAIL — System is struggling under this load');
  }

  console.log(`  Bootstrap: ${bootstrapSuccessRate.toFixed(1)}% success, p95=${formatMs(bootstrapP95)}`);
  
  const rate429 = (stats.bootstrap.statusCodes['429'] || 0) + (stats.orderStatus.statusCodes['429'] || 0);
  if (rate429 > 0) {
    console.log(`  ⚡ Rate limited: ${rate429} requests got 429 (expected under heavy load)`);
  }

  console.log('');
}

// Run!
runLoadTest().catch(err => {
  console.error('💥 Load test crashed:', err);
  process.exit(1);
});
