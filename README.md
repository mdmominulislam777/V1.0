# HighFy TV — Production-Ready Auto-Update Data System

Automated, GitHub Actions-driven sports event synchronization, broadcaster verification, EPG generation, and channel management system for **HighFy TV** (Android Mobile & Android TV).

---

## 1. Repository Structure

```
HighFy-TV-Data/
│
├── .github/
│   └── workflows/
│       └── auto-update.yml       # Scheduled GitHub Actions workflow (runs every 30m)
│
├── data/
│   ├── channels.json             # Normalized verified channels and authorized sources
│   ├── sports-events.json        # Normalized sports events with verification metadata
│   └── epg.json                  # Program guide generated from verified match schedules
│
├── scripts/
│   ├── update.py                 # Main orchestrator script with failure protection
│   ├── sports_api.py             # Unified client for CricketData, TheSportsDB, AllSports
│   ├── broadcaster.py            # Broadcaster extraction & deterministic catalog matcher
│   └── validator.py              # Strict schema, timestamp, and security validator
│
├── logos/
│   └── channels/                 # Verified high-resolution channel logos
│
├── README.md                     # Technical architecture and developer guide
└── requirements.txt              # Python runtime dependencies
```

---

## 2. Required GitHub Secrets

Configure these environment variables in your GitHub Repository under **Settings → Secrets and variables → Actions**:

| Secret Name | Description | Default / Fallback |
| :--- | :--- | :--- |
| `CRICKETDATA_API_KEY` | CricketData.org / CricAPI API key | Read from env |
| `THESPORTSDB_API_KEY` | TheSportsDB API key | Defaults to `"3"` (Free Tier) |
| `ALLSPORTS_API_KEY` | All Sports API key (Livescore & Fixtures) | Optional / Configured |

*Note: Never hardcode API keys in any JSON file, script, or commit.*

---

## 3. How to Run Locally

### Prerequisites
- Python 3.10+ (Python 3.12 recommended)
- `pip`

### Step 1: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 2: Set Environment Variables (Optional)
```bash
export CRICKETDATA_API_KEY="your_cricketdata_key"
export THESPORTSDB_API_KEY="your_thesportsdb_key"
export ALLSPORTS_API_KEY="your_allsports_key"
```

### Step 3: Run Update Orchestrator
```bash
python scripts/update.py
```

### Step 4: Run Data Validator Independently
```bash
python scripts/validator.py
```

---

## 4. How GitHub Actions Works

1. **Schedule**: The workflow `.github/workflows/auto-update.yml` triggers automatically every 30 minutes via cron (`*/30 * * * *`), or manually via `workflow_dispatch`.
2. **Fetch**: `scripts/update.py` queries configured APIs, maps broadcasters against `data/channels.json`, and generates `sports-events.json` and `epg.json`.
3. **Validate**: `scripts/validator.py` ensures 100% data integrity, rejecting malformed URLs, broken references, duplicate IDs, or invalid statuses.
4. **Commit & Push**: If changes exist and validation passes, updates are committed with `"Auto update sports data"` and pushed directly to the repository.

---

## 5. JSON Schemas

### `data/sports-events.json`
```json
{
  "updatedAt": "2026-10-03T05:30:00Z",
  "sourceStatus": {
    "cricketdata": "ok",
    "thesportsdb": "ok",
    "allsports": "ok"
  },
  "events": [
    {
      "eventId": "tsdb_12345",
      "sport": "Soccer",
      "league": "Premier League",
      "homeTeam": "Arsenal",
      "awayTeam": "Chelsea",
      "startTime": "2026-10-03T19:00:00Z",
      "status": "LIVE",
      "homeTeamLogo": "https://...",
      "awayTeamLogo": "https://...",
      "broadcasters": [
        {
          "name": "Sky Sports Premier League",
          "channelId": "ch-sky-sports-premier-league",
          "verification": "api_verified"
        },
        {
          "name": "NBC Sports",
          "channelId": null,
          "verification": "name_only"
        }
      ]
    }
  ]
}
```

*Allowed Status Values:* `LIVE`, `TODAY`, `UPCOMING`, `FINISHED`, `UNKNOWN`.

### `data/channels.json`
```json
{
  "updatedAt": "2026-10-03T05:30:00Z",
  "channels": [
    {
      "id": "ch-t-sports-hd",
      "name": "T Sports HD",
      "logo": "https://...",
      "category": "sports",
      "country": "BD",
      "status": "verified",
      "sources": [
        {
          "name": "Official Server 1 (1080p FHD)",
          "type": "authorized",
          "url": "https://...",
          "quality": "1080p FHD"
        }
      ]
    }
  ]
}
```

### `data/epg.json`
```json
{
  "updatedAt": "2026-10-03T05:30:00Z",
  "channels": [
    {
      "channelId": "ch-t-sports-hd",
      "channelName": "T Sports HD",
      "programs": [
        {
          "title": "Live: Arsenal vs Chelsea (Premier League)",
          "start": "2026-10-03T19:00:00Z",
          "end": "2026-10-03T22:00:00Z",
          "eventId": "tsdb_12345"
        }
      ]
    }
  ]
}
```

---

## 6. Sports API Sources

1. **TheSportsDB**: Multi-sport event calendar, fixtures, and TV broadcast records (`lookuptv.php`).
2. **CricketData.org / CricAPI**: International & domestic cricket match status, live ball-by-ball updates, and broadcast schedules.
3. **All Sports API**: Real-time livescores and fixtures across football, basketball, cricket, and tennis.

---

## 7. Broadcaster Verification Rules

- **ZERO Guessed Mappings**: Never assign a broadcaster merely because a team, league, or sport is commonly shown on that network.
- **Strict Evidence**: Extract broadcaster names only from explicit API response fields (`strTVStation`, `broadcaster`, `tvStation`, etc.).
- **Verification Levels**:
  - `api_verified`: API returned a valid broadcaster name matching a verified playable channel in `data/channels.json`.
  - `name_only`: API returned a broadcaster name that is not in HighFy TV's verified channel catalog. The UI **never** treats `name_only` as a playable stream.

---

## 8. Channel Verification Rules

- Channel IDs must remain immutable and stable.
- Stream sources must be authorized and validated for HTTPS / proper streaming protocols.
- If a channel has no active authorized playable source, its status is marked as `unavailable`, displaying `"Live channel unavailable"` in the UI.

---

## 9. EPG System

- Built dynamically from verified match schedules and authorized broadcast times.
- Programs are tied to verified `eventId` and `channelId` references.
- No artificial schedules or placeholder programs.

---

## 10. Failure Handling & Protection

- **Transient Outage Defense**: If external APIs return temporary network errors or 0 events while a previous valid dataset exists (e.g. 178 events), `update.py` preserves the previous dataset and logs:
  ```
  API FAILURE: Keeping previous valid dataset
  ```
- **Never Overwrite Empty**: The system will not overwrite valid data with empty data unless the API confirms zero fixtures genuinely exist.

---

## 11. HighFy TV Integration

### Match Card Click Flow:
```
User Clicks Match Card
         ↓
Read event.broadcasters
         ↓
Find matching channelId
         ↓
Check data/channels.json (status == "verified")
         ↓
Open Channel / Server Selection Modal
         ↓
Show only Authorized Playable Servers (≥44px Touch / D-pad Focus)
         ↓
Play Stream via HLS.js / Fast Edge Proxy
```

*Fallback State:* If no verified playable channel exists, HighFy TV cleanly displays `"Live channel unavailable"`.

---

## 12. Security Rules

- **No Credentials in Frontend / JSON**: No API keys or tokens are stored in client-accessible JSON files.
- **Proxy Protection**: CORS-restricted or hotlink-protected streams are safely routed through `/api/stream-proxy`.
- **Validation Gates**: Every push is blocked if `scripts/validator.py` encounters invalid URLs, broken IDs, or malformed schemas.
