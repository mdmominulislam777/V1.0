import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// HighFy TV - Automated API Health & Availability Test Suite
// Verifies Cloudflare Worker / API endpoint availability, latency, and operational health.

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error('BASE_URL environment variable is required. Example: k6 run -e BASE_URL=http://localhost:3000 tests/load/health.js');
}

// Custom Metrics
const serverErrors = new Counter('server_errors');
const rateLimited = new Counter('rate_limited');
const healthSuccessRate = new Rate('health_success_rate');
const healthLatency = new Trend('health_latency');

export const options = {
  scenarios: {
    health_check: {
      executor: 'constant-vus',
      vus: 5,
      duration: '15s',
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    http_req_failed: ['rate<0.01'],
    health_success_rate: ['rate>0.99'],
    http_req_duration: ['p(95)<300', 'p(99)<500'],
  },
};

export default function () {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'HighFyTV-LoadTest-k6/1.0',
    'X-Load-Test': 'true',
  };

  // 1. Primary Health Endpoint Check
  const healthUrl = `${BASE_URL.replace(/\/+$/, '')}/api/health`;
  const healthRes = http.get(healthUrl, { headers });
  healthLatency.add(healthRes.timings.duration);

  if (healthRes.status >= 500) {
    serverErrors.add(1);
  }
  if (healthRes.status === 429) {
    rateLimited.add(1);
  }

  let healthBody = null;
  try {
    healthBody = JSON.parse(healthRes.body);
  } catch (e) {
    healthBody = null;
  }

  const isHealthOk = check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health content-type is json': (r) => (r.headers['Content-Type'] || r.headers['content-type'] || '').includes('application/json'),
    'health body status is ok': () => healthBody && healthBody.status === 'ok',
    'health body timestamp present': () => healthBody && Boolean(healthBody.timestamp),
  });

  healthSuccessRate.add(isHealthOk);

  // 2. Safe Public Configuration Check
  const configUrl = `${BASE_URL.replace(/\/+$/, '')}/api/config`;
  const configRes = http.get(configUrl, { headers });

  if (configRes.status >= 500) {
    serverErrors.add(1);
  }
  if (configRes.status === 429) {
    rateLimited.add(1);
  }

  let configBody = null;
  try {
    configBody = JSON.parse(configRes.body);
  } catch (e) {}

  check(configRes, {
    'config status is 200': (r) => r.status === 200,
    'config returns json': (r) => (r.headers['Content-Type'] || r.headers['content-type'] || '').includes('application/json'),
    'config has appName': () => configBody && Boolean(configBody.appName || configBody.status === 'ok'),
  });

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

  const isPassing = s5xx === 0 && failedReqs === 0 && (data.metrics.checks ? data.metrics.checks.values.rate === 1 : true);

  const report = [
    '==================================================',
    'HIGHFY TV HEALTH TEST RESULT',
    '==================================================',
    `Total requests:         ${totalReqs}`,
    `Failed requests:        ${failedReqs}`,
    `HTTP 5xx:               ${s5xx}`,
    `HTTP 429:               ${r429}`,
    `p95 latency:            ${p95}ms`,
    `p99 latency:            ${p99}ms`,
    `Checks:                 ${checkRate}%`,
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
