#!/usr/bin/env python3
"""
HighFy TV — Broadcaster Matching Engine
Strictly extracts broadcaster fields from real sports API responses
and deterministically matches them against verified HighFy TV channels.

Rules:
- ZERO invented broadcaster names.
- ZERO guessed mappings based on sport/league.
- "api_verified" ONLY when broadcaster is explicitly present in API and matches verified catalog.
- "name_only" when broadcaster is returned by API but not in HighFy TV verified catalog.
"""

import json
import os
import re
from typing import List, Dict, Any, Optional

# Pre-compiled normalization regex
CLEAN_REGEX = re.compile(r'[^a-z0-9]')

# Verified Alias Dictionary to HighFy TV Channel IDs
VERIFIED_BROADCASTER_ALIASES = {
    # T Sports & Gazi TV
    "tsports": "ch-t-sports-hd",
    "tsportshd": "ch-t-sports-hd",
    "tsport": "ch-t-sports-hd",
    "t_sports": "ch-t-sports-hd",
    "gazitv": "ch-gazi-tv",
    "gtv": "ch-gazi-tv",
    "gazitelevision": "ch-gazi-tv",
    "maasranga": "ch-maasranga-tv-hd",
    "maasrangatv": "ch-maasranga-tv-hd",
    "nagorik": "ch-nagorik-tv",
    "nagoriktv": "ch-nagorik-tv",

    # Willow TV
    "willow": "ch-willow-cricket",
    "willowtv": "ch-willow-cricket",
    "willowhd": "ch-willow-cricket",
    "willowcricket": "ch-willow-cricket",
    "willowsports": "ch-willow-cricket",

    # Sony Sports Network
    "sonysportsten1": "ch-sony-sports-ten-1-hd",
    "sonysportsten1hd": "ch-sony-sports-ten-1-hd",
    "sonysports1": "ch-sony-sports-ten-1-hd",
    "sonyten1": "ch-sony-sports-ten-1-hd",
    "sonyten1hd": "ch-sony-sports-ten-1-hd",
    "sonysportsten2": "ch-sony-sports-ten-2-hd",
    "sonysportsten2hd": "ch-sony-sports-ten-2-hd",
    "sonysports2": "ch-sony-sports-ten-2-hd",
    "sonyten2": "ch-sony-sports-ten-2-hd",
    "sonyten2hd": "ch-sony-sports-ten-2-hd",
    "sonysportsten3": "ch-sony-sports-ten-3-hd",
    "sonysportsten3hd": "ch-sony-sports-ten-3-hd",
    "sonysports3": "ch-sony-sports-ten-3-hd",
    "sonyten3": "ch-sony-sports-ten-3-hd",
    "sonyten3hd": "ch-sony-sports-ten-3-hd",
    "sonysportsten4": "ch-sony-sports-ten-4-hd",
    "sonysportsten4hd": "ch-sony-sports-ten-4-hd",
    "sonysports4": "ch-sony-sports-ten-4-hd",
    "sonyten4": "ch-sony-sports-ten-4-hd",
    "sonyten4hd": "ch-sony-sports-ten-4-hd",
    "sonysportsten5": "ch-sony-sports-ten-5-hd",
    "sonysportsten5hd": "ch-sony-sports-ten-5-hd",
    "sonysports5": "ch-sony-sports-ten-5-hd",
    "sonyten5": "ch-sony-sports-ten-5-hd",
    "sonyten5hd": "ch-sony-sports-ten-5-hd",
    "sonyliv": "ch-sony-sports-ten-1-hd",

    # Star Sports Network
    "starsports1": "ch-star-sports-1-hd",
    "starsports1hd": "ch-star-sports-1-hd",
    "starsportsone": "ch-star-sports-1-hd",
    "starsports1hindi": "ch-star-sports-1-hindi",
    "starsports1hindihd": "ch-star-sports-1-hindi",
    "starsportshindi": "ch-star-sports-1-hindi",
    "starsports2": "ch-star-sports-2-hd",
    "starsports2hd": "ch-star-sports-2-hd",
    "starsportsselect1": "ch-star-sports-select-1-hd",
    "starsportsselect1hd": "ch-star-sports-select-1-hd",
    "starsportsselect2": "ch-star-sports-select-2-hd",
    "starsportsselect2hd": "ch-star-sports-select-2-hd",

    # Sky Sports
    "skysportsmainevent": "ch-sky-sports-main-event",
    "skysportsmaineventhd": "ch-sky-sports-main-event",
    "skysportscricket": "ch-sky-sports-cricket",
    "skysportscrickethd": "ch-sky-sports-cricket",
    "skysportsfootball": "ch-sky-sports-football",
    "skysportsfootballhd": "ch-sky-sports-football",
    "skysportspremierleague": "ch-sky-sports-premier-league",
    "skysportspremierleaguehd": "ch-sky-sports-premier-league",
    "skysportspl": "ch-sky-sports-premier-league",
    "skysportsf1": "ch-sky-sports-f1",
    "skysportsf1hd": "ch-sky-sports-f1",
    "skysportsaction": "ch-sky-sports-action",
    "skysportsarena": "ch-sky-sports-arena",
    "skysportsgolf": "ch-sky-sports-golf",
    "skysportstennis": "ch-sky-sports-tennis",
    "skysportsnews": "ch-sky-sports-news",

    # beIN Sports
    "beinsports1": "ch-bein-sports-1-hd",
    "beinsports1hd": "ch-bein-sports-1-hd",
    "beinsports2": "ch-bein-sports-2-hd",
    "beinsports2hd": "ch-bein-sports-2-hd",
    "beinsports3": "ch-bein-sports-3-hd",
    "beinsports3hd": "ch-bein-sports-3-hd",
    "beinsportsextra": "ch-bein-sports-extra",

    # TNT Sports
    "tntsports1": "ch-tnt-sports-1",
    "tntsports1hd": "ch-tnt-sports-1",
    "tntsports2": "ch-tnt-sports-2",
    "tntsports3": "ch-tnt-sports-3",
    "tntsports4": "ch-tnt-sports-4",

    # PTV & A Sports
    "ptvsports": "ch-ptv-sports-hd",
    "ptvsportshd": "ch-ptv-sports-hd",
    "ptv": "ch-ptv-sports-hd",
    "asports": "ch-a-sports-hd",
    "asportshd": "ch-a-sports-hd",

    # TSN & EuroSport
    "tsn1": "ch-tsn-1",
    "tsn": "ch-tsn-1",
    "eurosport1": "ch-eurosport-1",
    "eurosport": "ch-eurosport-1",
    "superpsortgrandstand": "ch-supersport-grandstand",
    "supersport": "ch-supersport-grandstand"
}

def normalize_key(name: str) -> str:
    """Normalize string for dictionary lookup."""
    if not name:
        return ""
    return CLEAN_REGEX.sub('', str(name).lower())

def load_verified_channel_catalog(channels_json_path: str = "data/channels.json") -> Dict[str, Dict[str, Any]]:
    """Loads all verified channels from channels.json into an ID-indexed map."""
    catalog = {}
    if not os.path.exists(channels_json_path):
        # Fallback to root channels.json if data/channels.json is not yet created
        channels_json_path = "channels.json"
    
    if os.path.exists(channels_json_path):
        try:
            with open(channels_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                ch_list = data.get("channels", data) if isinstance(data, dict) else data
                if isinstance(ch_list, list):
                    for ch in ch_list:
                        cid = ch.get("id")
                        if cid and ch.get("status") == "verified" or ch.get("active", True):
                            catalog[cid] = ch
        except Exception as e:
            print(f"[broadcaster.py] Error reading {channels_json_path}: {e}")
    return catalog

def extract_broadcasters_from_raw_api(raw_event: Dict[str, Any]) -> List[str]:
    """
    Extracts all explicit broadcaster strings from raw sports API payloads.
    Inspects fields across TheSportsDB, CricketData, and All Sports API.
    """
    found = []

    # 1. Direct fields
    for key in ["strTVStation", "broadcaster", "tvStation", "channel", "strChannel", "broadcast", "tv"]:
        val = raw_event.get(key)
        if isinstance(val, str) and val.strip():
            found.append(val.strip())
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, str) and item.strip():
                    found.append(item.strip())
                elif isinstance(item, dict) and item.get("name"):
                    found.append(str(item["name"]).strip())

    # 2. Arrays of broadcasters
    for key in ["broadcasters", "tvStations", "channels", "streams"]:
        arr = raw_event.get(key)
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, str) and item.strip():
                    found.append(item.strip())
                elif isinstance(item, dict):
                    name = item.get("name") or item.get("channelName") or item.get("strTVStation")
                    if name and str(name).strip():
                        found.append(str(name).strip())

    # 3. Delimiter splitting (e.g. "Sky Sports Main Event, TNT Sports 1 / ESPN")
    split_results = []
    for b in found:
        # Split by comma, slash, pipe, semicolon
        parts = re.split(r'[,/|;]', b)
        for p in parts:
            clean = p.strip()
            if clean and len(clean) > 1:
                split_results.append(clean)

    # Deduplicate while preserving order
    seen = set()
    unique_broadcasters = []
    for b in split_results:
        low = b.lower()
        if low not in seen:
            seen.add(low)
            unique_broadcasters.append(b)

    return unique_broadcasters

def match_broadcasters(raw_event: Dict[str, Any], catalog: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """
    Takes a raw event from any sports API, extracts raw broadcaster names,
    and returns a standardized broadcasters array with verification status.
    """
    if catalog is None:
        catalog = load_verified_channel_catalog()

    raw_names = extract_broadcasters_from_raw_api(raw_event)
    broadcaster_results = []
    seen_channels = set()

    for name in raw_names:
        norm = normalize_key(name)
        matched_channel_id = None

        # Check explicit alias dictionary
        if norm in VERIFIED_BROADCASTER_ALIASES:
            candidate_id = VERIFIED_BROADCASTER_ALIASES[norm]
            if candidate_id in catalog:
                matched_channel_id = candidate_id

        # If not found in alias, check catalog IDs directly
        if not matched_channel_id:
            for cid, ch in catalog.items():
                ch_norm = normalize_key(ch.get("name", ""))
                cid_norm = normalize_key(cid)
                if norm == ch_norm or norm == cid_norm:
                    matched_channel_id = cid
                    break
                # Substring matching for full channel names (e.g. "T Sports HD" -> "T Sports")
                if len(norm) >= 4 and (norm in ch_norm or ch_norm in norm):
                    matched_channel_id = cid
                    break

        if matched_channel_id and matched_channel_id not in seen_channels:
            seen_channels.add(matched_channel_id)
            broadcaster_results.append({
                "name": name,
                "channelId": matched_channel_id,
                "verification": "api_verified"
            })
        elif not matched_channel_id:
            broadcaster_results.append({
                "name": name,
                "channelId": None,
                "verification": "name_only"
            })

    return broadcaster_results

if __name__ == "__main__":
    test_event = {
        "title": "Arsenal vs Chelsea",
        "strTVStation": "Sky Sports Premier League, TNT Sports 1, NBC Sports"
    }
    catalog = load_verified_channel_catalog()
    results = match_broadcasters(test_event, catalog)
    print("Test Match Output:")
    print(json.dumps(results, indent=2))
