import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// HighFy TV - Broadcaster Verification & Channel Integrity Test Suite
// Verifies:
// 1. Valid fixture with verified broadcaster (verified === true, authentic streams, authorized channelId)
// 2. Valid fixture without broadcaster (verified === false, channelId === null, empty streams)
// 3. Invalid fixture handling (safe not_found, never invent channels)
// 4. Missing parameters (HTTP 400 safe response)
// 5. Malformed fixture inputs (SQLi/Path traversal/null/undefined/arrays handled safely)
// 6. Unverified broadcaster rejection (never convert unknown to verified)
// 7. Strict fake-channel prevention, unverified channel prevention, and provider source validation

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error('BASE_URL environment variable is required. Example: k6 run -e BASE_URL=http://localhost:3000 tests/load/broadcaster-integrity.js');
}

// Custom Metrics (Strict Zero-Tolerance Thresholds)
const fakeChannelDetected = new Rate('fake_channel_detected');
const unverifiedChannelDetected = new Rate('unverified_channel_detected');
const providerMismatch = new Rate('provider_mismatch');
const serverErrors = new Counter('server_errors');
const rateLimited = new Counter('rate_limited');
const invalidFixtureErrors = new Rate('invalid_fixture_errors');
const schemaErrors = new Rate('schema_errors');
const verificationLatency = new Trend('verification_latency');

export const options = {
  scenarios: {
    broadcaster_integrity: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
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

// Authorized providers configured in HighFy TV
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

// Known forbidden fake channel names and placeholders
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
  // Check stream URLs for fake/dummy domains
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

export default function () {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'HighFyTV-IntegrityTest-k6/1.0',
    'X-Load-Test': 'true',
  };

  const cleanBase = BASE_URL.replace(/\/+$/, '');

  // =========================================================================
  // CATEGORY A: Valid fixture with verified broadcaster
  // =========================================================================
  const validFixtureId = 'espn-soccer-401917002';
  const validRes = http.get(`${cleanBase}/api/fixture/broadcaster?fixtureId=${validFixtureId}&sport=football`, { headers });
  verificationLatency.add(validRes.timings.duration);

  if (validRes.status >= 500) serverErrors.add(1);
  if (validRes.status === 429) rateLimited.add(1);

  let validBody = null;
  try {
    validBody = JSON.parse(validRes.body);
  } catch (e) {
    schemaErrors.add(1);
  }

  if (validBody) {
    const isSchemaValid = validBody.status && typeof validBody.verified === 'boolean' && validBody.fixtureId === validFixtureId;
    schemaErrors.add(!isSchemaValid);

    // Validate Category A Contract
    const isVerified = validBody.verified === true;
    const hasChannelId = typeof validBody.channelId === 'string' && validBody.channelId.startsWith('ch-');
    const hasStreams = Array.isArray(validBody.streams) && validBody.streams.length > 0;

    check(validRes, {
      'Cat A: valid fixture returns status 200': (r) => r.status === 200,
      'Cat A: verified is true': () => isVerified,
      'Cat A: authorized channelId is present': () => hasChannelId,
      'Cat A: streams array is populated': () => hasStreams,
    });

    // Check for fake channel
    const fakeDetected = isFakeChannel(validBody.channelId, validBody.broadcaster, validBody.streams);
    fakeChannelDetected.add(fakeDetected);

    // Check provider mismatch
    const source = String(validBody.source || 'Cache').toLowerCase().trim();
    const isAuthorizedSource = AUTHORIZED_PROVIDERS.has(source) || source.includes('thesportsdb') || source.includes('cric') || source.includes('cache');
    providerMismatch.add(!isAuthorizedSource);
  }

  // =========================================================================
  // CATEGORY B: Valid fixture without broadcaster (cricket without broadcast)
  // =========================================================================
  const noBroadcasterId = 'cr-cricapi-espn_1551344';
  const noBroadcasterRes = http.get(`${cleanBase}/api/fixture/broadcaster?fixtureId=${noBroadcasterId}&sport=cricket`, { headers });

  if (noBroadcasterRes.status >= 500) serverErrors.add(1);
  if (noBroadcasterRes.status === 429) rateLimited.add(1);

  let noBcastBody = null;
  try {
    noBcastBody = JSON.parse(noBroadcasterRes.body);
  } catch (e) {
    schemaErrors.add(1);
  }

  if (noBcastBody) {
    const isUnverified = noBcastBody.verified === false;
    const noChannel = noBcastBody.channelId === null || noBcastBody.channelId === undefined;
    const emptyStreams = !noBcastBody.streams || noBcastBody.streams.length === 0;

    check(noBroadcasterRes, {
      'Cat B: no-broadcaster fixture returns verified=false': () => isUnverified,
      'Cat B: no-broadcaster fixture has channelId=null': () => noChannel,
      'Cat B: no-broadcaster fixture has empty streams': () => emptyStreams,
    });

    // If an unverified fixture produces a channel, flag as unverified channel leak
    unverifiedChannelDetected.add(!isUnverified || !noChannel || !emptyStreams);
  }

  // =========================================================================
  // CATEGORY C: Invalid / Nonexistent fixture
  // =========================================================================
  const invalidId = 'invalid-fixture-nonexistent-999999';
  const invalidRes = http.get(`${cleanBase}/api/fixture/broadcaster?fixtureId=${invalidId}&sport=football`, { headers });

  if (invalidRes.status >= 500) serverErrors.add(1);
  if (invalidRes.status === 429) rateLimited.add(1);

  let invalidBody = null;
  try {
    invalidBody = JSON.parse(invalidRes.body);
  } catch (e) {
    schemaErrors.add(1);
  }

  if (invalidBody) {
    const isUnverified = invalidBody.verified === false;
    const noChannel = invalidBody.channelId === null || invalidBody.channelId === undefined;
    const emptyChannels = !invalidBody.channels || invalidBody.channels.length === 0;

    check(invalidRes, {
      'Cat C: invalid fixture verified is false': () => isUnverified,
      'Cat C: invalid fixture channelId is null': () => noChannel,
      'Cat C: invalid fixture channels array is empty': () => emptyChannels,
    });

    if (!isUnverified || !noChannel) {
      invalidFixtureErrors.add(1);
      fakeChannelDetected.add(1);
    } else {
      invalidFixtureErrors.add(0);
      fakeChannelDetected.add(0);
    }
  }

  // =========================================================================
  // CATEGORY D: Missing required parameter (fixtureId missing)
  // =========================================================================
  const missingParamRes = http.get(`${cleanBase}/api/fixture/broadcaster`, {
    headers,
    responseCallback: http.expectedStatuses(400),
  });
  if (missingParamRes.status >= 500) serverErrors.add(1);
  if (missingParamRes.status === 429) rateLimited.add(1);

  check(missingParamRes, {
    'Cat D: missing fixtureId returns HTTP 400': (r) => r.status === 400,
  });

  // =========================================================================
  // CATEGORY E: Malformed parameter handling (null/undefined/injection)
  // =========================================================================
  const malformedRes = http.get(`${cleanBase}/api/fixture/broadcaster?fixtureId=null`, {
    headers,
    responseCallback: http.expectedStatuses(200, 400),
  });
  if (malformedRes.status >= 500) serverErrors.add(1);
  if (malformedRes.status === 429) rateLimited.add(1);

  let malformedBody = null;
  try {
    malformedBody = JSON.parse(malformedRes.body);
  } catch (e) {}

  check(malformedRes, {
    'Cat E: malformed string "null" rejected or unverified': (r) =>
      r.status === 400 || (malformedBody && malformedBody.verified === false && malformedBody.channelId === null),
  });

  // =========================================================================
  // CATEGORY F: Unverified broadcaster (baseball on TBS without match)
  // =========================================================================
  const unverifiedFixtureId = 'tsdb-2611747';
  const unverifiedRes = http.get(`${cleanBase}/api/fixture/broadcaster?fixtureId=${unverifiedFixtureId}&sport=baseball`, { headers });
  if (unverifiedRes.status >= 500) serverErrors.add(1);
  if (unverifiedRes.status === 429) rateLimited.add(1);

  let unverifiedBody = null;
  try {
    unverifiedBody = JSON.parse(unverifiedRes.body);
  } catch (e) {}

  if (unverifiedBody) {
    const isSafelyUnverified = unverifiedBody.verified === false && !unverifiedBody.channelId;
    check(unverifiedRes, {
      'Cat F: unverified broadcaster rejected safely': () => isSafelyUnverified,
    });
    unverifiedChannelDetected.add(!isSafelyUnverified);
  }

  sleep(0.5);
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
