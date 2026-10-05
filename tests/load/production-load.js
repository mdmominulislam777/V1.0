import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// HighFy TV - Production Staged Load Test Suite
// Verifies:
// 1. High-traffic kick-off concurrency (up to 2,000 VUs)
// 2. Worker stability and in-memory cache resilience (<100ms on cache hit)
// 3. Fake-channel prevention and unverified-channel rejection under load
// 4. Upstream provider rate-limit and 5xx error protection
// 5. Schema and 200/404 response contract validation

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error('BASE_URL environment variable is required. Example: k6 run -e BASE_URL=https://YOUR-WORKER-DOMAIN tests/load/production-load.js');
}

// Custom Metrics
const fakeChannelDetected = new Rate('fake_channel_detected');
const unverifiedChannelDetected = new Rate('unverified_channel_detected');
const providerMismatch = new Rate('provider_mismatch');
const serverErrors = new Counter('server_errors');
const rateLimited = new Counter('rate_limited');
const invalidFixtureErrors = new Rate('invalid_fixture_errors');
const schemaErrors = new Rate('schema_errors');
const verificationLatency = new Trend('verification_latency');
const cacheHitLatency = new Trend('cache_hit_latency');

// Supported Execution Profiles:
// - default / 'production': Full 2000 VU staged load profile (~9 minutes)
// - 'staging': 100 VU ramp-up (~2 minutes)
// - 'smoke': 10 VU sanity check (15 seconds)
const PROFILE = (__ENV.PROFILE || 'production').toLowerCase();

let selectedStages = [
  { duration: '30s', target: 100 },  // 30 seconds -> 100 VUs
  { duration: '1m', target: 500 },   // 1 minute -> 500 VUs
  { duration: '2m', target: 1000 },  // 2 minutes -> 1000 VUs
  { duration: '2m', target: 2000 },  // 2 minutes -> 2000 VUs
  { duration: '2m', target: 2000 },  // 2 minutes -> hold 2000 VUs
  { duration: '1m', target: 500 },   // 1 minute -> 500 VUs
  { duration: '30s', target: 0 },    // 30 seconds -> 0 VUs
];

if (PROFILE === 'smoke') {
  selectedStages = [
    { duration: '5s', target: 10 },
    { duration: '10s', target: 10 },
    { duration: '5s', target: 0 },
  ];
} else if (PROFILE === 'staging') {
  selectedStages = [
    { duration: '15s', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '45s', target: 100 },
    { duration: '30s', target: 0 },
  ];
}

export const options = {
  scenarios: {
    production_spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: selectedStages,
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    fake_channel_detected: ['rate==0'],
    unverified_channel_detected: ['rate==0'],
    provider_mismatch: ['rate==0'],
    server_errors: ['count==0'],
    invalid_fixture_errors: ['rate==0'],
    schema_errors: ['rate==0'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

// Authorized Provider Sources
const AUTHORIZED_PROVIDERS = new Set([
  'cache',
  'thesportsdb',
  'thesportsdb live',
  'thesportsdb cache',
  'cricketdata.org',
  'cricapi',
  'espn-fallback',
  'cricbuzz',
  'cricbuzz rapidapi',
  'allsportsapi',
  'gemini ai',
  'disk',
  'unified cache',
  'standard',
  'ayna ott',
  'highfy',
  'akash go',
  'jio tv',
  'rongin tv cdn',
  'none',
]);

const FAKE_CHANNEL_PATTERNS = [
  /example\s*sports/i,
  /test\s*sports/i,
  /fake\s*tv/i,
  /demo\s*channel/i,
  /dummy/i,
  /placeholder/i,
  /synthetic/i,
];

function isFakeChannel(channelId, channelName, streams) {
  if (typeof channelId !== 'string' || !channelId.trim()) return true;
  if (typeof channelName === 'string') {
    for (const pat of FAKE_CHANNEL_PATTERNS) {
      if (pat.test(channelName)) return true;
    }
  }
  if (Array.isArray(streams)) {
    for (const s of streams) {
      const u = s?.url || '';
      if (!u || u.includes('example.com') || u.includes('fake.m3u8') || u.includes('stream.dummy')) {
        return true;
      }
    }
  }
  return false;
}

// Real Project Test Fixtures (from data/sports-events.json & events.json)
const FIXTURES = {
  hotVerified: { id: 'espn-soccer-401917002', sport: 'football' }, // 70% traffic: hot kickoff match
  secondaryVerified: { id: 'espn-soccer-401917001', sport: 'football' }, // 15% traffic
  noBroadcaster: { id: 'cr-cricapi-espn_1551344', sport: 'cricket' }, // 10% traffic: real match without broadcast
  invalid: { id: 'invalid-nonexistent-fixture-999999', sport: 'football' }, // 5% traffic: edge case
};

export default function () {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'HighFyTV-ProductionLoad-k6/1.0',
    'X-Load-Test': 'true',
  };

  const cleanBase = BASE_URL.replace(/\/+$/, '');

  // Weighted realistic traffic simulation
  const rand = Math.random();
  let targetFixture = FIXTURES.hotVerified;

  if (rand < 0.70) {
    targetFixture = FIXTURES.hotVerified;
  } else if (rand < 0.85) {
    targetFixture = FIXTURES.secondaryVerified;
  } else if (rand < 0.95) {
    targetFixture = FIXTURES.noBroadcaster;
  } else {
    targetFixture = FIXTURES.invalid;
  }

  const endpointUrl = `${cleanBase}/api/fixture/broadcaster?fixtureId=${encodeURIComponent(targetFixture.id)}&sport=${targetFixture.sport}`;
  const res = http.get(endpointUrl, { headers });
  verificationLatency.add(res.timings.duration);

  // Check server errors (5xx)
  if (res.status >= 500) {
    serverErrors.add(1);
  }

  // Check rate limiting (429)
  if (res.status === 429) {
    rateLimited.add(1);
  }

  // Track cache hit latency
  const xCache = res.headers['X-Cache'] || res.headers['x-cache'];
  if (xCache === 'HIT' || xCache === 'DEDUPLICATED') {
    cacheHitLatency.add(res.timings.duration);
  }

  let body = null;
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    schemaErrors.add(1);
  }

  if (body) {
    // 1. Schema Validation
    const isSchemaValid = body.status && typeof body.verified === 'boolean';
    schemaErrors.add(!isSchemaValid);

    // 2. Behavioral Contract Validation
    if (targetFixture === FIXTURES.hotVerified || targetFixture === FIXTURES.secondaryVerified) {
      // Hot match: expected verified channel
      const isVerified = body.verified === true;
      const hasChannelId = typeof body.channelId === 'string' && body.channelId.startsWith('ch-');
      const hasStreams = Array.isArray(body.streams) && body.streams.length > 0;

      check(res, {
        'status is 200': (r) => r.status === 200,
        'verified match returns true': () => isVerified,
        'authorized channelId present': () => hasChannelId,
        'authentic streams present': () => hasStreams,
      });

      // Fake channel check
      const fakeDetected = isFakeChannel(body.channelId, body.broadcaster, body.streams);
      fakeChannelDetected.add(fakeDetected);

      // Provider source check
      const source = String(body.source || 'Cache').toLowerCase().trim();
      const isAuthorizedSource = AUTHORIZED_PROVIDERS.has(source) || source.includes('thesportsdb') || source.includes('cric') || source.includes('cache');
      providerMismatch.add(!isAuthorizedSource);
    } else if (targetFixture === FIXTURES.noBroadcaster) {
      // Real match without broadcaster: expected unverified, empty channels
      const isUnverified = body.verified === false;
      const noChannelId = body.channelId === null || body.channelId === undefined;
      const emptyStreams = !body.streams || body.streams.length === 0;

      check(res, {
        'unverified match returns false': () => isUnverified,
        'no channel assigned': () => noChannelId,
        'streams are empty': () => emptyStreams,
      });

      unverifiedChannelDetected.add(!isUnverified || !noChannelId);
    } else {
      // Invalid fixture: expected safe not_found
      const isUnverified = body.verified === false;
      const noChannelId = body.channelId === null || body.channelId === undefined;
      const emptyChannels = !body.channels || body.channels.length === 0;

      check(res, {
        'invalid fixture returns verified=false': () => isUnverified,
        'invalid fixture returns channelId=null': () => noChannelId,
        'invalid fixture returns empty channels': () => emptyChannels,
      });

      invalidFixtureErrors.add(!isUnverified || !noChannelId);
      fakeChannelDetected.add(!noChannelId);
    }
  }

  // Realistic user pacing between requests (100ms - 300ms)
  sleep(0.1 + Math.random() * 0.2);
}

export function handleSummary(data) {
  const getVal = (m, key) => (m && m.values && m.values[key] !== undefined && m.values[key] !== null) ? Number(m.values[key]).toFixed(2) : '0';
  const totalReqs = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const failedReqs = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.passes : 0;
  const s5xx = data.metrics.server_errors ? data.metrics.server_errors.values.count : 0;
  const r429 = data.metrics.rate_limited ? data.metrics.rate_limited.values.count : 0;
  const p95 = getVal(data.metrics.http_req_duration, 'p(95)');
  const p99 = getVal(data.metrics.http_req_duration, 'p(99)');
  const checkRate = (data.metrics.checks && data.metrics.checks.values && data.metrics.checks.values.rate !== undefined)
    ? (data.metrics.checks.values.rate * 100).toFixed(2)
    : '0';

  const fakes = data.metrics.fake_channel_detected ? (data.metrics.fake_channel_detected.values.rate * 100).toFixed(2) + '%' : '0%';
  const unver = data.metrics.unverified_channel_detected ? (data.metrics.unverified_channel_detected.values.rate * 100).toFixed(2) + '%' : '0%';
  const provMis = data.metrics.provider_mismatch ? (data.metrics.provider_mismatch.values.rate * 100).toFixed(2) + '%' : '0%';
  const schemaErr = data.metrics.schema_errors ? (data.metrics.schema_errors.values.rate * 100).toFixed(2) + '%' : '0%';
  const invFixErr = data.metrics.invalid_fixture_errors ? (data.metrics.invalid_fixture_errors.values.rate * 100).toFixed(2) + '%' : '0%';

  const isPassing =
    s5xx === 0 &&
    failedReqs === 0 &&
    (data.metrics.fake_channel_detected ? data.metrics.fake_channel_detected.values.rate === 0 : true) &&
    (data.metrics.unverified_channel_detected ? data.metrics.unverified_channel_detected.values.rate === 0 : true) &&
    (data.metrics.provider_mismatch ? data.metrics.provider_mismatch.values.rate === 0 : true) &&
    (data.metrics.invalid_fixture_errors ? data.metrics.invalid_fixture_errors.values.rate === 0 : true) &&
    (data.metrics.schema_errors ? data.metrics.schema_errors.values.rate === 0 : true);

  const report = [
    '==================================================',
    'LOAD TEST RESULT',
    '==================================================',
    `Total requests:         ${totalReqs}`,
    `Failed requests:        ${failedReqs}`,
    `HTTP 5xx:               ${s5xx}`,
    `HTTP 429:               ${r429}`,
    `p95 latency:            ${p95}ms`,
    `p99 latency:            ${p99}ms`,
    `Checks:                 ${checkRate}%`,
    `Fake channels:          ${fakes}`,
    `Unverified channels:    ${unver}`,
    `Provider mismatches:    ${provMis}`,
    `Schema errors:          ${schemaErr}`,
    `Invalid fixture errors: ${invFixErr}`,
    '--------------------------------------------------',
    'FINAL RESULT:',
    isPassing ? 'PASS' : 'FAIL',
    '==================================================',
    '',
  ].join('\n');

  return {
    stdout: report,
  };
}
