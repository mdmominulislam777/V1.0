# HIGHFY TV — MASTER AI DEVELOPMENT INSTRUCTIONS

Lead Software Architect, Senior Frontend Developer & QA Engineer Guidelines for HighFy TV.
Objective: Production-ready, stable, mobile-first sports streaming web app.

---

## 1. CORE RULE — NEVER BREAK EXISTING FEATURES

Existing features must NEVER be changed, removed, or replaced unnecessarily.

Specifically protected features:
- Home / Live Events feed
- Sports category & filter tabs
- Live Events timeline & status logic
- Channel Categories & Category Manager
- Search functionality (channels, sports, leagues, teams)
- Favorites (Local storage persistence)
- Video Player (HLS.js / HTML5 Video)
- HLS / M3U8 playback & server switching
- Playlist parser & synchronization
- Bottom navigation (Live Event, Category, Sports)
- JSON data loading (channels.json, categories.json, events)
- Responsive mobile-first layout
- Existing UI components

---

## 2. DEVELOPMENT WORKFLOW

1. **ANALYZE**: Examine folder structure, components, JS/TS, CSS, JSON, API integration, player system, navigation, and state.
2. **PLAN**: Identify affected files, target components, data source, and backwards compatibility.
3. **IMPLEMENT**: Write clean, modular, and maintainable code without duplicating logic.
4. **TEST**: Verify console errors, broken paths/imports, API errors, mobile layout, player functionality, navigation, event filtering, and channel mapping.

---

## 3. REAL DATA INTEGRITY & STRICT BROADCAST VERIFICATION (LOCKED SYSTEM RULE)

- **LOCKED SYSTEM RULE**:
  1. শুধুমাত্র verified broadcast source থাকলেই channel দেখাবে।
  2. **Direct API data সর্বোচ্চ priority** (e.g. `event.broadcaster`, `event.broadcasters`, `event.strTVStation`, `event.tvStation`, `event.channelId`, `event.streams`)।
  3. **Verified logic-based mapping দ্বিতীয় priority** (e.g. authentic persistent audit cache, verified franchise contracts যেমন WWE South Asian Sony contract, verified explicit eventId mapping)।
  4. **শুধু `channels.json` metadata দিয়ে কখনো connection করা যাবে না** (`sports`, `leagues`, `teams` ইত্যাদি দেখে কোনো ম্যাচিং বৈধ নয়)।
  5. **Verification না থাকলে বাধ্যতামূলকভাবে “Live channel unavailable” দেখাবে**।
- **STRICT PROHIBITION**: কোনো fake, guessed, placeholder বা manually invented broadcaster/channel/URL ব্যবহার করা যাবে না।
- **BACKWARDS COMPATIBILITY & RE-VALIDATION**: Existing verified connections নষ্ট করা যাবে না এবং future API updates-এর সাথে স্বয়ংক্রিয় re-validation কার্যকর থাকবে।
- If data is unavailable, display a clean fallback state (e.g. *"No data available"* or *"Live channel unavailable"*).

---

## 4. SPORTS EVENT SYSTEM & DATA STRUCTURE

Event Structure:
```json
{
  "id": "event-123",
  "sport": "Football",
  "league": "Premier League",
  "title": "Arsenal vs Chelsea",
  "teams": ["Arsenal", "Chelsea"],
  "date": "2026-08-28",
  "time": "20:00",
  "status": "LIVE",
  "channelId": "ch-sony-sports-ten-1-hd"
}
```
- No direct stream URLs inside event objects. Use `channelId` references.

---

## 5. CHANNEL SYSTEM

Channel Structure:
```json
{
  "id": "ch-sony-sports-ten-1-hd",
  "name": "Sony Sports Ten 1 HD",
  "logo": "https://...",
  "category": "Sports",
  "sports": ["Football", "Tennis", "WWE"],
  "priority": 1,
  "active": true,
  "streamUrl": "https://..."
}
```

---

## 6. SPORTS → CHANNEL MATCHING RULES

- Events automatically match supported channels by sport.
- **Strict Prohibition**: Never assign Cricket channels to Football events, Tennis channels to Cricket events, or unrelated channels to WWE/Motorsport events.

---

## 7. CHANNEL PRIORITY & SELECTION

When multiple channels match an event:
1. `active === true`
2. Exact Sport Match
3. League Match (highest priority)
4. Channel priority value
5. First valid authenticated channel
6. If none available: `channelId: null` and display *"Live channel unavailable"*.

---

## 8. LIVE EVENTS STATUS & SORTING

Status values:
- `LIVE`: Match is actively occurring (Red LIVE badge).
- `UPCOMING`: Match has not started yet.
- `FINISHED`: Match has concluded.

Sorting order:
`LIVE` → `UPCOMING` → `FINISHED`

---

## 9. LIVE EVENT CARD SPECIFICATION

Cards must display:
- Sport name & League
- Team/Player logos & names
- Match Date & Time
- Status badge (Red LIVE / Upcoming / Finished)
- Channel Logo & Channel Name
- **Watch Live** button (only when valid, active matching stream exists)

---

## 10. PLAYER SYSTEM & HLS PLAYBACK

- Maintain full HLS.js streaming integrity.
- Controls: Play/Pause, Volume, Fullscreen, PiP, Seek, Quality/Server Switcher.
- Proper buffering indicators and user-friendly error banners.

---

## 11. UI DESIGN & MOBILE-FIRST ARCHITECTURE

- **Theme**: Premium Dark Charcoal background (`#0b0f19` / `#111827`), Red/Emerald accents, modern glassmorphism, soft glow, clean typography.
- **Mobile First**: Optimized touch targets (≥44px), smooth scrolling, sticky navigation, adaptive cards for Mobile, Tablet, and Desktop.

---

## 12. PERMANENT RESPONSE FORMAT (Section 27)

```
IMPLEMENTATION STATUS

✓ Completed:
- ...

✓ Files changed:
- ...

✓ Files added:
- ...

✓ Tested:
- ...

⚠ Remaining issue:
- None
```
