#!/usr/bin/env python3
"""
HighFy TV — Data Update Orchestrator
Main runner for GitHub Actions & local scheduled syncs.

Features:
- Queries configured sports APIs (TheSportsDB, CricketData, AllSports).
- Broadcaster matching with strict real-data verification.
- Generates data/sports-events.json, data/epg.json, and data/channels.json.
- Failure protection: Never overwrites valid existing dataset with empty data on transient API failures.
- Enforces strict validation via validator.py before finalizing data.
"""

import os
import sys
import json
from datetime import datetime, timezone
from typing import Dict, Any, List

from sports_api import fetch_all_sports_events
from validator import validate_all_datasets
from epg_parser import parse_and_sync_epg_data

DATA_DIR = "data"
CHANNELS_PATH = os.path.join(DATA_DIR, "channels.json")
EVENTS_PATH = os.path.join(DATA_DIR, "sports-events.json")
EPG_PATH = os.path.join(DATA_DIR, "epg.json")

def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs("logos/channels", exist_ok=True)

def load_previous_events() -> List[Dict[str, Any]]:
    """Loads previous valid events dataset for failure protection fallback."""
    if os.path.exists(EVENTS_PATH):
        try:
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                events = data.get("events", [])
                if isinstance(events, list) and len(events) > 0:
                    return events
        except Exception as e:
            print(f"[update.py] Warning: Could not read previous events: {e}", file=sys.stderr)
    return []

def generate_epg_from_events(events: List[Dict[str, Any]], channels: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generates normalized EPG payload from verified event-to-channel schedules."""
    channel_programs: Dict[str, List[Dict[str, Any]]] = {}
    channel_name_map = {c["id"]: c.get("name", c["id"]) for c in channels if "id" in c}

    for ev in events:
        eid = ev.get("eventId")
        title = f"{ev.get('homeTeam', '')} vs {ev.get('awayTeam', '')}"
        start = ev.get("startTime")
        # Approximate 3-hour duration for live broadcast
        if not start:
            continue
        
        try:
            # End time default
            clean_start = start.replace('Z', '+00:00')
            start_dt = datetime.fromisoformat(clean_start)
            end_dt = start_dt.replace(hour=(start_dt.hour + 3) % 24)
            end = end_dt.isoformat()
        except Exception:
            end = start

        for b in ev.get("broadcasters", []):
            if b.get("verification") == "api_verified" and b.get("channelId"):
                cid = b["channelId"]
                if cid not in channel_programs:
                    channel_programs[cid] = []
                channel_programs[cid].append({
                    "title": f"Live: {title} ({ev.get('league', 'Sports')})",
                    "start": start,
                    "end": end,
                    "eventId": eid
                })

    epg_channels = []
    for cid, progs in channel_programs.items():
        epg_channels.append({
            "channelId": cid,
            "channelName": channel_name_map.get(cid, cid),
            "programs": progs
        })

    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "channels": epg_channels
    }

def main():
    print("==========================================")
    print("HIGHFY TV — DATA AUTO-UPDATE ENGINE")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("==========================================")
    
    ensure_dirs()

    # 1. Load Channels Catalog
    if not os.path.exists(CHANNELS_PATH):
        # Build initial data/channels.json from root channels.json if missing
        if os.path.exists("channels.json"):
            with open("channels.json", "r", encoding="utf-8") as f:
                root_ch = json.load(f)
            formatted = []
            for c in root_ch:
                formatted.append({
                    "id": c.get("id"),
                    "name": c.get("name"),
                    "logo": c.get("logo", ""),
                    "category": c.get("category", "sports").lower(),
                    "country": "BD" if "t-sports" in c.get("id", "") else "GLOBAL",
                    "status": "verified" if c.get("active", True) else "unavailable",
                    "sources": [{"name": "Official", "type": "authorized", "url": c.get("streamUrl", c.get("url", ""))}]
                })
            ch_payload = {"updatedAt": datetime.now(timezone.utc).isoformat(), "channels": formatted}
            with open(CHANNELS_PATH, "w", encoding="utf-8") as f:
                json.dump(ch_payload, f, indent=2)
            print(f"✓ Initialized {CHANNELS_PATH} with {len(formatted)} channels")

    with open(CHANNELS_PATH, "r", encoding="utf-8") as f:
        channels_data = json.load(f)
    channels_list = channels_data.get("channels", [])

    # 2. Fetch Sports Events from APIs
    print("\n[1/3] Fetching sports events from configured APIs...")
    new_events, source_status = fetch_all_sports_events()
    print(f"✓ Fetched {len(new_events)} raw events. Statuses: {source_status}")

    # 3. Failure Protection
    previous_events = load_previous_events()
    final_events = new_events

    if len(new_events) == 0 and len(previous_events) > 0:
        # Check if all APIs failed
        all_failed = all(st.startswith("error") or st == "not_configured" for st in source_status.values())
        if all_failed:
            print("\n⚠️ API FAILURE: All external sports APIs returned errors or unavailable.")
            print(f"⚠️ ACTION: Preserving previous valid dataset ({len(previous_events)} events).")
            final_events = previous_events
        else:
            print("\nℹ️ APIs responded successfully with 0 active events for current window.")
    
    # Sort events by priority: LIVE -> TODAY -> UPCOMING -> FINISHED
    def event_sort_key(ev):
        st = ev.get("status", "UNKNOWN")
        order = {"LIVE": 0, "TODAY": 1, "UPCOMING": 2, "FINISHED": 3, "UNKNOWN": 4}
        return (order.get(st, 5), ev.get("startTime", ""))

    final_events.sort(key=event_sort_key)

    events_payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceStatus": source_status,
        "events": final_events
    }

    # 4. Generate EPG & Synchronize Verified Schedules
    print("\n[2/3] Generating EPG program guide from verified schedules...")
    epg_payload = parse_and_sync_epg_data(final_events, channels_list)

    # 5. Write Synchronized Output Files
    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(events_payload, f, indent=2, ensure_ascii=False)

    # Also keep root events.json synchronized if present
    if os.path.exists("events.json"):
        try:
            with open("events.json", "r", encoding="utf-8") as rf:
                root_evs = json.load(rf)
            if isinstance(root_evs, list):
                parse_and_sync_epg_data(root_evs, channels_list)
                with open("events.json", "w", encoding="utf-8") as wf:
                    json.dump(root_evs, wf, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[update.py] Note: root events sync notice: {e}")

    # 6. Run Strict Validator
    print("\n[3/3] Running data integrity and schema validation...")
    valid, report_text = validate_all_datasets(DATA_DIR)
    print(report_text)

    if not valid:
        print("\n❌ CRITICAL: Validation failed. Aborting update.", file=sys.stderr)
        sys.exit(1)

    print("\n✅ AUTO-UPDATE COMPLETED SUCCESSFULLY!")
    sys.exit(0)

if __name__ == "__main__":
    main()
