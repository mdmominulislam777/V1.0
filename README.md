# HighFy TV — Production-Ready Sports Streaming & TV Platform

HighFy TV is a production-ready, mobile-first sports streaming and live TV web/Android application with real-time broadcast matching, multi-server HLS playback, and offline data bundling.

---

## 1. Repository Structure

```
HighFy-TV/
│
├── .github/
│   └── workflows/                # Deployment and APK build pipelines
│
├── data/
│   ├── channels.json             # Normalized verified channels and authorized sources
│   ├── sports-events.json        # Normalized sports events with verification metadata
│   ├── epg.json                  # Program guide generated from verified match schedules
│   └── manual_channels.json      # Verified fallback broadcast contracts
│
├── public/                       # Static assets and production data files (auto-copied to dist/)
│   ├── channels.json
│   ├── events.json
│   ├── categories.json
│   ├── notifications.json
│   ├── version.json
│   └── data/                     # Data directory mirrored for production HTTP access
│
├── scripts/
│   ├── generate_bundled_data.cjs # Bundles local data assets and copies JSON files to public/ & dist/
│   └── sync-android-assets.cjs   # Synchronizes dist and assets to android/app/src/main/assets
│
├── server.ts                     # Secure Express backend with anti-sniff protection and API proxies
├── script.js                     # Core frontend application controller (HLS player, UI, tabs)
├── style.css                     # Mobile-first stylesheet with Tailwind CSS & custom design
├── index.html                    # HighFy TV SPA entry point
└── README.md                     # Technical architecture and developer guide
```

---

## 2. Environment Configuration

Configure these environment variables in your `.env` or deployment environment:

| Secret Name | Description | Default / Fallback |
| :--- | :--- | :--- |
| `STREAM_SECRET` | Mandatory secret for production anti-sniff token generation | Required in production |
| `CRICKETDATA_API_KEY` | CricketData.org / CricAPI API key | Read from env |
| `THESPORTSDB_API_KEY` | TheSportsDB API key | Defaults to `"3"` (Free Tier) |
| `ALLSPORTS_API_KEY` | All Sports API key (Livescore & Fixtures) | Optional / Configured |

*Note: Never commit secrets to source control.*

---

## 3. Data Architecture & Build Workflow

HighFy TV uses a resilient dual-layer data architecture:
1. **Dynamic Real-Time API Engine**: Live sports fixtures and broadcast details are resolved dynamically via server-side APIs (`/api/events`, `/api/fixture/broadcaster`, etc.) with in-memory caching to protect API quotas.
2. **Bundled & Static Fallback**: During build, `scripts/generate_bundled_data.cjs` bundles local datasets into `bundled_data.js` and mirrors all JSON files into `public/` and `dist/`, ensuring zero runtime downtime even during network interruptions.
3. **Android Asset Sync**: `scripts/sync-android-assets.cjs` mirrors all compiled production assets directly into `android/app/src/main/assets` for Android APK builds.

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

---

## 13. Manual Channel Sources & Verification (`data/manual_channels.json`)

When upstream providers (TheSportsDB or Cricket APIs) have no broadcast listings for a match, HighFy TV falls back to verified manual entries in `data/manual_channels.json`. Manual entries **never** override a non-empty provider result.

### How to Add a Manual Entry:
Add an entry object to the `entries` array in `data/manual_channels.json`:

```json
{
  "matchKey": {
    "sport": "Basketball",
    "league": "NBL",
    "homeTeam": "Adelaide 36ers",
    "awayTeam": "Melbourne United",
    "kickoffUtc": "2026-10-12T10:00:00Z"
  },
  "channels": [
    {
      "channelName": "ESPN Australia",
      "country": "Australia",
      "logoUrl": "https://r2.thesportsdb.com/images/media/channel/logo/espn.png"
    }
  ],
  "source": {
    "url": "https://nbl.com.au/watch/schedule",
    "name": "NBL Official Broadcast Guide"
  },
  "verifiedBy": "editor-name",
  "status": "verified"
}
```

### Strict Requirements:
1. **Real Source URL Mandatory**: Every entry **must** contain a valid, accessible `source.url` linking directly to an official fixture guide, broadcaster schedule, or federation website. Fictional, empty, or placeholder URLs are rejected at server startup.
2. **Non-Empty Channels**: `channels` must contain at least one valid channel with `channelName`.
3. **Status Check**: Only entries with `status: "verified"` will match and be displayed. Entries with `status: "pending"` or any other value are safely ignored.
4. **Time & Team Matching**: Matches use the exact same ±15 minute UTC window and team normalization (suffix removal, Levenshtein similarity ≥ 0.85).
5. **No Invented Channels**: Never add fabricated or unverified channel names. Invalid entries are logged and skipped on server startup without crashing.

---

## 14. Android Versioning Rules (`version.json` & `public/version.json`)

To ensure smooth OTA updates and proper Android app packaging:
1. **Always Synchronize**: Both `version.json` (at project root) and `public/version.json` must have identical values.
2. **Version Code Increment**: Whenever releasing a new APK build, increment `versionCode` by `+1` (integer) in both files.
3. **Semantic Versioning**: Update `version` and `versionName` (e.g. `"1.0.1"`, `"1.1.0"`) according to semantic versioning guidelines.
4. **Consistency Check**: The build pipeline and Android asset sync verify that both files match before building.

