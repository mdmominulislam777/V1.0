# HighFy TV — Production-Grade Load Testing Suite

Comprehensive, auditable, production-grade load and integrity testing suite built with [Grafana k6](https://k6.io) for the HighFy TV Cloudflare Worker and API backend.

---

## 1. Test Architecture Overview

The load test suite specifically targets the HighFy TV Cloudflare Worker and backend API architecture:
```
                      k6 Virtual Users (VUs)
                                 │
                                 ▼
           Cloudflare Worker / Express API Gateway (Port 3000 / Edge)
                                 │
       ┌─────────────────────────┴────────────────────────┐
       ▼                                                  ▼
In-Memory Unified Cache                             Provider Adapters
(TTL: 60s, <100ms response)                         - TheSportsDB
- Hot Kick-off Match Fixtures                       - CricketData.org / CricAPI
- In-flight Promise Deduplication                  - ESPN-Fallback / Cricbuzz
       │                                                  │
       ▼                                                  ▼
Verified Authorized Channels Catalog          Broadcaster Authorization Chain
(channels.json, 3,100+ channels)             (Anti-Fake, Universal Sport Isolation)
```

### Key Safety & Integrity Guarantees
- **Zero Fake Channels**: Never invents dummy/guessed channels or placeholder stream URLs (`fake_channel_detected: rate == 0`).
- **Zero Unverified Leaks**: If real broadcast data is unavailable, returns `verified: false`, `channelId: null`, and `channels: []` (`unverified_channel_detected: rate == 0`).
- **Provider Integrity**: Verifies returned data originates strictly from authorized providers (`TheSportsDB`, `CricketData.org`, `ESPN-Fallback`, `Cache`, etc.) (`provider_mismatch: rate == 0`).
- **Upstream Protection**: In-memory caching and request deduplication ensure high-traffic spikes (2,000 VUs) do NOT overwhelm third-party provider rate limits.
- **Zero Secret Leakage**: No API keys, credentials, or private secrets exist in the test source code. `BASE_URL` is passed via environment variables.

---

## 2. Directory Structure

```
tests/load/
├── README.md                  # Complete testing guide & execution instructions
├── health.js                  # Diagnostic service health & configuration test
├── broadcaster-integrity.js   # 6-category broadcaster verification & contract test
└── production-load.js         # Staged kick-off load test (up to 2,000 concurrent VUs)
```

---

## 3. Safe Step-by-Step Testing Sequence

To ensure infrastructure stability, **NEVER** run 2,000 VUs immediately. Follow this progressive staging sequence:

| Step | Stage | Target VUs | Execution Command | Purpose |
|------|-------|------------|-------------------|---------|
| **1** | Health Check | 5 VUs | `k6 run -e BASE_URL=... tests/load/health.js` | Basic endpoint availability & latency check |
| **2** | Integrity Verification | 5 VUs | `k6 run -e BASE_URL=... tests/load/broadcaster-integrity.js` | Contract, fake-channel & unverified rejection |
| **3** | Smoke Test | 10 VUs | `k6 run -e BASE_URL=... -e PROFILE=smoke tests/load/production-load.js` | Pacing & request validation |
| **4** | Staging Ramp | 100 VUs | `k6 run -e BASE_URL=... -e PROFILE=staging tests/load/production-load.js` | Multi-user cache behavior & error rate |
| **5** | Production Stress | 500 – 1000 VUs | `k6 run -e BASE_URL=... tests/load/production-load.js` | Mid-scale kick-off load |
| **6** | Full Kick-off Peak | 2,000 VUs | `k6 run -e BASE_URL=... tests/load/production-load.js` | Full kick-off match concurrency |

> ⚠️ **Proceed to the next stage ONLY if the previous stage passes with 0 server errors (5xx) and 0 integrity failures.**

---

## 4. Execution Commands

### A. Health & Config Test
Verifies `/api/health` and `/api/config` endpoints:
```bash
# Against local dev server:
k6 run -e BASE_URL=http://localhost:3000 tests/load/health.js

# Against deployed Cloudflare Worker:
k6 run -e BASE_URL=https://YOUR-WORKER-DOMAIN tests/load/health.js
```

### B. Broadcaster Integrity Test
Validates all 6 correctness categories (A–F) with zero tolerance for fake or unverified channels:
```bash
# Against local dev server:
k6 run -e BASE_URL=http://localhost:3000 tests/load/broadcaster-integrity.js

# Against deployed Cloudflare Worker:
k6 run -e BASE_URL=https://YOUR-WORKER-DOMAIN tests/load/broadcaster-integrity.js
```

### C. Production Staged Load Test
Simulates peak kick-off traffic on live fixtures:
```bash
# Smoke profile (10 VUs, ~20 seconds):
k6 run -e BASE_URL=http://localhost:3000 -e PROFILE=smoke tests/load/production-load.js

# Staging profile (100 VUs, ~2 minutes):
k6 run -e BASE_URL=https://YOUR-STAGING-DOMAIN -e PROFILE=staging tests/load/production-load.js

# Full production staged profile (2,000 VUs, ~9 minutes):
k6 run -e BASE_URL=https://YOUR-WORKER-DOMAIN tests/load/production-load.js
```

---

## 5. Staged Load Profile (Production)

The default `production-load.js` profile implements the standard sports kick-off curve:
- **00:00 – 00:30**: Ramp from 0 to **100 VUs** (Warm-up & cache priming)
- **00:30 – 01:30**: Ramp to **500 VUs** (Match countdown)
- **01:30 – 03:30**: Ramp to **1,000 VUs** (5 minutes to kick-off)
- **03:30 – 05:30**: Ramp to **2,000 VUs** (Kick-off spike)
- **05:30 – 07:30**: Hold at **2,000 VUs** (Live match start peak concurrency)
- **07:30 – 08:30**: Ramp down to **500 VUs** (Post kick-off stabilization)
- **08:30 – 09:00**: Ramp down to **0 VUs** (Cooldown)

---

## 6. Real Test Fixtures Used

The suite uses verified fixtures extracted directly from the project's authentic test fixtures (`data/sports-events.json` and `events.json`):

| Fixture ID | Sport | Description | Expected Result |
|------------|-------|-------------|-----------------|
| `espn-soccer-401917002` | Football | Manchester City vs Real Madrid (Sony Sports Ten 2 HD) | `status: "success"`, `verified: true`, `channelId: "ch-sony-sports-ten-2-hd"` |
| `espn-soccer-401917001` | Football | Paris Saint-Germain vs OH Leuven (Sony Sports Ten 2 HD) | `status: "success"`, `verified: true`, `channelId: "ch-sony-sports-ten-2-hd"` |
| `cr-cricapi-espn_1551344` | Cricket | Real match without broadcaster | `verified: false`, `channelId: null`, `channels: []` |
| `tsdb-2611747` | Baseball | Match on unverified network (TBS) | `verified: false`, `channelId: null` (Rejected) |
| `invalid-fixture-nonexistent-999999` | Football | Non-existent fixture | `verified: false`, `channelId: null`, `channels: []` |

---

## 7. Metrics & Interpretation

| Metric | Target Threshold | Interpretation |
|--------|------------------|----------------|
| `fake_channel_detected` | `rate == 0` | **CRITICAL INTEGRITY**. Triggers if any dummy name (e.g. "Example Sports", "Fake TV"), invalid ID, or non-authentic stream URL is returned. |
| `unverified_channel_detected` | `rate == 0` | **CRITICAL INTEGRITY**. Triggers if an unverified match (`verified: false`) returns a non-null `channelId` or populated stream array. |
| `provider_mismatch` | `rate == 0` | **INTEGRITY**. Triggers if returned data does not originate from an authorized provider source. |
| `server_errors` | `count == 0` | **STABILITY**. Counts HTTP 500, 501, 502, 503, 504 server crashes. |
| `invalid_fixture_errors` | `rate == 0` | **ROBUSTNESS**. Triggers if an invalid fixture ID returns 200 with guessed data instead of clean `verified: false`. |
| `schema_errors` | `rate == 0` | **CONTRACT**. Triggers if response JSON deviates from expected schema structure. |
| `rate_limited` | Informational | Counts HTTP 429 responses. Differentiates expected local rate limits from upstream provider limits. |
| `http_req_duration` | `p(95) < 500ms`, `p(99) < 1000ms` | Response latency across all virtual users. Cache hits typically respond in `<10ms`. |
| `http_req_failed` | `< 1%` | Network/transport failure rate (excluding expected negative tests like HTTP 400). |

### Interpreting HTTP 429 Responses
- **Worker / Gateway 429**: HighFy TV's local gateway protects against abusive single-IP scraping. In development/staging, `RATE_LIMIT_MAX` can be adjusted.
- **Upstream Provider 429**: If TheSportsDB or CricketData limits are exceeded, HighFy TV's resilient fallback switches to in-memory cached events or ESPN-Fallback without failing the user request.
- **Expected vs Unexpected**: 429 on un-cached endpoints indicates rate limits are working as designed. 429 on cached endpoints indicates gateway configuration needs scaling.

### Interpreting HTTP 5xx Responses
- **500 Internal Server Error**: Unhandled exception in route handling. Must be 0 in production.
- **502 Bad Gateway / 504 Gateway Timeout**: Upstream provider network drop. Handled via in-flight deduplication and timeout guards (6,000ms).

---

## 8. Summary Output Format

Every k6 test produces a scannable, standardized report upon completion:
```
==================================================
LOAD TEST RESULT
==================================================
Total requests:         1200
Failed requests:        0
HTTP 5xx:               0
HTTP 429:               0
p95 latency:            3.33ms
p99 latency:            0ms
Checks:                 100.00%
Fake channels:          0.00%
Unverified channels:    0.00%
Provider mismatches:    0.00%
Schema errors:          0.00%
Invalid fixture errors: 0.00%
--------------------------------------------------
FINAL RESULT:
PASS
==================================================
```
