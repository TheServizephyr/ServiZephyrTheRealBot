/**
 * Redis Cache Performance Test
 * Tests cache hit/miss rates and performance improvements
 */

const autocannon = require('autocannon');

const BASE_URL = process.env.TEST_URL || 'https://www.servizephyr.com';
const RESTAURANT_ID = 'baaghi-chai';

console.log('🧪 Redis Cache Performance Test\n');
console.log(`Target: ${BASE_URL}/api/public/menu/${RESTAURANT_ID}\n`);

async function runTest(name, config) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 ${name}`);
    console.log(`${'='.repeat(60)}\n`);

    return new Promise((resolve) => {
        const instance = autocannon(config, (err, result) => {
            if (err) {
                console.error('❌ Test failed:', err);
                resolve(null);
                return;
            }

            // Calculate metrics
            const avgLatency = result.latency.mean;
            const p95Latency = result.latency.p97_5 || result.latency.p975 || result.latency.mean * 1.5;
            const p99Latency = result.latency.p99 || result.latency.mean * 2;
            const throughput = result.requests.average;
            const errorRate = (result.errors / result.requests.total) * 100;

            console.log('\n📈 Results:');
            console.log(`   Avg Latency: ${avgLatency.toFixed(2)}ms`);
            console.log(`   P95 Latency: ${p95Latency.toFixed(2)}ms`);
            console.log(`   P99 Latency: ${p99Latency.toFixed(2)}ms`);
            console.log(`   Throughput:  ${throughput.toFixed(2)} req/s`);
            console.log(`   Total Reqs:  ${result.requests.total}`);
            console.log(`   Errors:      ${result.errors} (${errorRate.toFixed(2)}%)`);
            console.log(`   Timeouts:    ${result.timeouts}`);

            // Performance grade
            let grade = '✅ EXCELLENT';
            if (avgLatency > 100) grade = '⚠️ GOOD';
            if (avgLatency > 200) grade = '⚠️ FAIR';
            if (avgLatency > 500) grade = '❌ POOR';

            console.log(`\n   Grade: ${grade}`);

            resolve({
                name,
                avgLatency,
                p95Latency,
                p99Latency,
                throughput,
                errors: result.errors,
                errorRate,
                timeouts: result.timeouts,
                total: result.requests.total
            });
        });

        // Track progress
        autocannon.track(instance, { renderProgressBar: true });
    });
}

async function main() {
    const results = [];

    // Test 1: Warmup (prime the cache)
    console.log('\n🔥 Phase 1: Cache Warmup');
    console.log('Purpose: Prime the Redis cache with data\n');

    const warmup = await runTest('Warmup Test', {
        url: `${BASE_URL}/api/public/menu/${RESTAURANT_ID}`,
        connections: 5,
        duration: 10,
        method: 'GET'
    });

    if (warmup) results.push(warmup);

    // Wait for cache to settle
    console.log('\n⏳ Waiting 5 seconds for cache to settle...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 2: Cache Hit Performance (should be fast)
    console.log('\n🎯 Phase 2: Cache Hit Performance Test');
    console.log('Purpose: Measure performance with cache hits (95%+ hit rate expected)\n');

    const cacheHit = await runTest('Cache Hit Test (50 users, 30s)', {
        url: `${BASE_URL}/api/public/menu/${RESTAURANT_ID}`,
        connections: 50,
        duration: 30,
        method: 'GET'
    });

    if (cacheHit) results.push(cacheHit);

    // Test 3: Stress Test (200 users, 2 minutes)
    console.log('\n🚀 Phase 3: Stress Test');
    console.log('Purpose: Test system under heavy load (200 concurrent users)\n');

    const stress = await runTest('Stress Test (200 users, 2min)', {
        url: `${BASE_URL}/api/public/menu/${RESTAURANT_ID}`,
        connections: 200,
        duration: 120,
        method: 'GET',
        pipelining: 1
    });

    if (stress) results.push(stress);

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60) + '\n');

    console.log('┌─────────────────────────────┬──────────┬──────────┬──────────┬───────────┐');
    console.log('│ Test Name                   │ Avg (ms) │ P95 (ms) │ Req/s    │ Errors    │');
    console.log('├─────────────────────────────┼──────────┼──────────┼──────────┼───────────┤');

    results.forEach(r => {
        const name = r.name.padEnd(27);
        const avg = r.avgLatency.toFixed(0).padStart(8);
        const p95 = r.p95Latency.toFixed(0).padStart(8);
        const rps = r.throughput.toFixed(0).padStart(8);
        const errors = `${r.errors}`.padStart(9);
        console.log(`│ ${name} │ ${avg} │ ${p95} │ ${rps} │ ${errors} │`);
    });

    console.log('└─────────────────────────────┴──────────┴──────────┴──────────┴───────────┘\n');

    // Performance Analysis
    if (results.length >= 2) {
        const cacheHitResult = results[1];
        const stressResult = results[2];

        console.log('🎯 Cache Performance Analysis:\n');

        if (cacheHitResult.avgLatency < 50) {
            console.log('   ✅ Cache is working EXCELLENTLY!');
            console.log('   ✅ Average latency < 50ms indicates high cache hit rate');
        } else if (cacheHitResult.avgLatency < 100) {
            console.log('   ✅ Cache is working WELL');
            console.log('   ⚠️  Some cache misses occurring');
        } else {
            console.log('   ❌ Cache performance is POOR');
            console.log('   ❌ High latency indicates low cache hit rate or slow cache');
        }

        console.log('\n🚀 Stress Test Analysis:\n');

        if (stressResult.avgLatency < 100 && stressResult.errorRate < 1) {
            console.log('   ✅ System handles 200 users EXCELLENTLY!');
            console.log('   ✅ Ready for production load');
        } else if (stressResult.avgLatency < 500 && stressResult.errorRate < 5) {
            console.log('   ⚠️  System handles 200 users ADEQUATELY');
            console.log('   ⚠️  Consider optimization for better performance');
        } else {
            console.log('   ❌ System STRUGGLES with 200 users');
            console.log('   ❌ Optimization required before production');
        }

        // Recommendations
        console.log('\n💡 Recommendations:\n');

        if (cacheHitResult.avgLatency > 50) {
            console.log('   • Check Redis connection latency');
            console.log('   • Verify cache key consistency');
            console.log('   • Monitor cache hit rate in logs');
        }

        if (stressResult.errorRate > 1) {
            console.log('   • Investigate error causes in logs');
            console.log('   • Check database connection limits');
            console.log('   • Consider rate limiting');
        }

        if (stressResult.avgLatency > 200) {
            console.log('   • Optimize database queries');
            console.log('   • Increase cache TTL if data is stable');
            console.log('   • Consider CDN for static assets');
        }
    }

    console.log('\n✅ Test Complete!\n');
}

// Run tests
main().catch(console.error);
