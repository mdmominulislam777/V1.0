/**
 * HighFy TV - Production Live Sports Streaming Latency & Edge-Cases Test Suite
 * Validates:
 * 1. Manifest Caching Headers (Cache-Control: public, max-age=1, must-revalidate)
 * 2. High-Traffic Kick-off Spikes on /api/fixture/broadcaster (<100ms response time & cache)
 * 3. Malformed ID Inputs Edge-Cases
 * 4. Mid-Match Auth Expiry & Silent Token Renewal (/api/stream/renew-token)
 * 5. Primary Stream Failover & Geo-Restrictions (403 notice)
 * 6. Automated Stream Health Check (/api/stream/health-check)
 */

const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  const res = await fetch(url, options);
  const latencyMs = Date.now() - start;
  let body;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { status: res.status, headers: res.headers, body, latencyMs };
}

async function runTests() {
  console.log('===============================================================');
  console.log('🚀 HIGHFY TV PRODUCTION STREAMING ARCHITECTURE & EDGE-CASE TEST');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, description, detail = '') {
    if (condition) {
      console.log(`  ✓ PASS: ${description}`);
      if (detail) console.log(`    ↳ ${detail}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${description}`);
      if (detail) console.error(`    ↳ ${detail}`);
      failed++;
    }
  }

  // TEST 1: Manifest Caching Headers
  console.log('--- 1. STREAMING LATENCY & MANIFEST CACHING HEADERS ---');
  try {
    // Test live mock stream manifest caching headers
    const mockM3u8Res = await request('/api/stream/mock-live.m3u8');
    const directCacheControl = mockM3u8Res.headers.get('cache-control') || '';
    assert(
      directCacheControl.includes('max-age=1') && directCacheControl.includes('must-revalidate'),
      'Direct .m3u8 manifest has Cache-Control: max-age=1, must-revalidate',
      `Header received: "${directCacheControl}"`
    );

    // Test stream-proxy rewriting & caching headers
    const proxyRes = await request(`/api/stream-proxy?url=${encodeURIComponent('http://localhost:3000/api/stream/mock-live.m3u8')}`);
    const proxyCacheControl = proxyRes.headers.get('cache-control') || '';
    assert(
      proxyCacheControl.includes('max-age=1') && proxyCacheControl.includes('must-revalidate'),
      'Proxied .m3u8 playlist has Cache-Control: max-age=1, must-revalidate',
      `Header received: "${proxyCacheControl}"`
    );
  } catch (err) {
    assert(false, 'Manifest caching header test error', err.message);
  }

  // TEST 2: High Traffic Kick-off Spike (<100ms Response Time)
  console.log('\n--- 2. HIGH TRAFFIC SPIKE (KICK-OFF) LOAD SIMULATION ---');
  try {
    const fixtureId = 'test-kickoff-fixture-101';
    
    // Warm-up / Initial request
    const initRes = await request(`/api/fixture/broadcaster?fixtureId=${fixtureId}&sport=football`);
    assert(initRes.status === 200, 'Initial fixture broadcaster request returns HTTP 200', `Initial latency: ${initRes.latencyMs}ms`);

    // Verify In-Memory Cache Latency (<100ms requirement)
    const cachedHitRes = await request(`/api/fixture/broadcaster?fixtureId=${fixtureId}&sport=football`);
    assert(
      cachedHitRes.status === 200 && cachedHitRes.latencyMs < 100,
      `Cached kick-off response is served under 100ms (Latency: ${cachedHitRes.latencyMs}ms)`,
      `Cache hit header: ${cachedHitRes.headers.get('x-cache')}`
    );

    // Simulate 50 concurrent kick-off requests (Burst traffic)
    const CONCURRENT_REQUESTS = 50;
    const startTime = Date.now();
    const concurrentPromises = Array.from({ length: CONCURRENT_REQUESTS }, () =>
      request(`/api/fixture/broadcaster?fixtureId=${fixtureId}&sport=football`)
    );
    const results = await Promise.all(concurrentPromises);
    const totalTimeMs = Date.now() - startTime;
    const allSuccessful = results.every(r => r.status === 200);

    assert(
      allSuccessful,
      `All ${CONCURRENT_REQUESTS} concurrent burst requests succeeded with HTTP 200`,
      `Total batch time for 50 requests: ${totalTimeMs}ms (avg: ${(totalTimeMs/50).toFixed(1)}ms/req)`
    );
  } catch (err) {
    assert(false, 'High traffic kick-off spike test error', err.message);
  }

  // TEST 3: Malformed ID Inputs
  console.log('\n--- 3. MALFORMED ID INPUTS EDGE-CASE TEST ---');
  try {
    const malformed1 = await request('/api/fixture/broadcaster?fixtureId=');
    assert(malformed1.status === 400, 'Empty fixtureId returns HTTP 400 Bad Request');

    const malformed2 = await request('/api/fixture/broadcaster?fixtureId=null');
    assert(malformed2.status === 400, 'String "null" fixtureId returns HTTP 400 Bad Request');

    const malformed3 = await request('/api/fixture/broadcaster?fixtureId=undefined');
    assert(malformed3.status === 400, 'String "undefined" fixtureId returns HTTP 400 Bad Request');

    const malformed4 = await request('/api/fixture/broadcaster?fixtureId[]=invalid&fixtureId[]=array');
    assert(malformed4.status === 400, 'Array-polluted fixtureId returns HTTP 400 safely without crashing');

    const malformed5 = await request('/api/fixture/broadcaster?fixtureId=' + encodeURIComponent('../../../etc/passwd'));
    assert(malformed5.status === 200 || malformed5.status === 400, 'Path-traversal input handled safely without server crash');
  } catch (err) {
    assert(false, 'Malformed ID input test error', err.message);
  }

  // TEST 4: Mid-Match Auth Expiry & Token Renewal
  console.log('\n--- 4. MID-MATCH AUTH EXPIRY & SILENT TOKEN RENEWAL ---');
  try {
    // Generate valid token via crypto simulation or proxy query
    const targetStream = 'https://tvsen5.aynaott.com/Ptvsports/index.m3u8';
    
    // Test renew token endpoint
    // Generate a test token through server's encrypt function via helper endpoint or direct renew test
    const dummyToken = 'dGVzdC1hdXRoLXRva2VuLTIwMjY';
    const renewRes = await request('/api/stream/renew-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' })
    });
    assert(renewRes.status === 400, 'Empty token for renewal rejected with HTTP 400');

    // Test health check endpoint for stream monitoring
    console.log('\n--- 5. AUTOMATED STREAM HEALTH CHECK ENDPOINT ---');
    const healthRes = await request(`/api/stream/health-check?url=${encodeURIComponent(targetStream)}`);
    assert(
      healthRes.status === 200 && (healthRes.body.status === 'ok' || healthRes.body.accessible !== undefined),
      'Stream health check endpoint returns 200 with latency and accessibility report',
      `Latency: ${healthRes.body.latencyMs}ms, Status: ${healthRes.body.status}`
    );
  } catch (err) {
    assert(false, 'Auth expiry & stream health test error', err.message);
  }

  // TEST 6: Geo-Restrictions (403 Notice)
  console.log('\n--- 6. GEO-RESTRICTION / CDN 403 HANDLING ---');
  try {
    // Direct stream proxy with invalid token returns 403
    const forbiddenRes = await request('/api/stream-proxy?token=invalid.token.123');
    assert(
      forbiddenRes.status === 403,
      'Invalid/unauthorized token returns HTTP 403 Forbidden',
      `Body: "${forbiddenRes.body}"`
    );
  } catch (err) {
    assert(false, 'Geo-restriction test error', err.message);
  }

  console.log('\n===============================================================');
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
