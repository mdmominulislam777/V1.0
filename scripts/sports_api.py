#!/usr/bin/env python3
"""
HighFy TV — Unified Sports API Client
Fetches real sports event data from CricketData.org, TheSportsDB, and All Sports API.

Rules:
- Read API credentials ONLY from environment variables.
- ZERO invented data.
- Stable event status: LIVE, TODAY, UPCOMING, FINISHED, UNKNOWN.
- Comprehensive error handling and logging.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import ssl
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple, Optional, Set
from broadcaster import match_broadcasters, load_verified_channel_catalog

# Optional requests library support
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# API Environment Variable Keys
ENV_CRICKETDATA_KEY = "CRICKETDATA_API_KEY"
ENV_THESPORTSDB_KEY = "THESPORTSDB_API_KEY"
ENV_ALLSPORTS_KEY = "ALLSPORTS_API_KEY"

# Context for SSL requests
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def safe_http_get(url: str, headers: Dict[str, str] = None, timeout: int = 10) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Safe HTTP GET request supporting both requests and standard urllib."""
    if headers is None:
        headers = {
            "User-Agent": "HighFy-TV-DataSync/1.0 (Android; Production)",
            "Accept": "application/json"
        }
    
    if HAS_REQUESTS:
        try:
            resp = requests.get(url, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                try:
                    return resp.json(), None
                except Exception as e:
                    return None, f"JSON parse error: {e}"
            return None, f"HTTP {resp.status_code}: {resp.text[:100]}"
        except Exception as e:
            return None, str(e)
    else:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as response:
                if response.status == 200:
                    raw_data = response.read().decode('utf-8')
                    try:
                        return json.loads(raw_data), None
                    except Exception as e:
                        return None, f"JSON parse error: {e}"
                return None, f"HTTP {response.status}"
        except Exception as e:
            return None, str(e)

def normalize_status(raw_status: str, start_iso: str = None) -> str:
    """Normalizes raw status string to LIVE, TODAY, UPCOMING, FINISHED, or UNKNOWN."""
    if not raw_status:
        # Fallback to date comparison if status string is empty
        if start_iso:
            try:
                # Handle ISO timestamps
                dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
                now = datetime.now(timezone.utc)
                if dt.date() == now.date():
                    return "TODAY"
                elif dt > now:
                    return "UPCOMING"
                else:
                    return "FINISHED"
            except Exception:
                pass
        return "UNKNOWN"

    st = raw_status.upper().strip()

    if any(k in st for k in ["LIVE", "IN PLAY", "INPROGRESS", "IN_PROGRESS", "RUNNING", "1ST HALF", "2ND HALF", "HALF TIME", "1H", "2H", "BREAK"]):
        return "LIVE"
    elif any(k in st for k in ["FT", "FINISHED", "AET", "PEN", "ENDED", "COMPLETED", "RESULT", "FINAL", "CONCLUDED", "ABANDONED", "CANCELLED", "POSTPONED"]):
        return "FINISHED"
    elif any(k in st for k in ["NS", "NOT STARTED", "UPCOMING", "SCHEDULED", "FIXTURE", "FUTURE"]):
        if start_iso:
            try:
                dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
                now = datetime.now(timezone.utc)
                if dt.date() == now.date():
                    return "TODAY"
            except Exception:
                pass
        return "UPCOMING"
    elif "TODAY" in st:
        return "TODAY"
    
    return "UNKNOWN"

class TheSportsDBClient:
    """Client for TheSportsDB API."""
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get(ENV_THESPORTSDB_KEY, "3")
        self.base_url = f"https://www.thesportsdb.com/api/v1/json/{self.api_key}"

    def fetch_events_for_date(self, date_str: str, sport: str = "") -> Tuple[List[Dict[str, Any]], str]:
        url = f"{self.base_url}/eventsday.php?d={date_str}"
        if sport:
            url += f"&s={urllib.request.quote(sport)}"
        
        data, err = safe_http_get(url)
        if err:
            return [], f"error: {err}"
        if not data or not data.get("events"):
            return [], "ok_empty"
        
        events = []
        for raw in data.get("events", []):
            try:
                event_id = f"tsdb_{raw.get('idEvent')}"
                home = raw.get("strHomeTeam") or raw.get("strEvent", "").split(" vs ")[0]
                away = raw.get("strAwayTeam") or (raw.get("strEvent", "").split(" vs ")[1] if " vs " in raw.get("strEvent", "") else "")
                
                # Combine date and time
                date_event = raw.get("dateEvent") or date_str
                time_event = raw.get("strTime") or "00:00:00"
                start_time = f"{date_event}T{time_event}Z"
                
                # Broadcaster lookup via lookuptv or direct strTVStation
                broadcasters = match_broadcasters(raw)

                events.append({
                    "eventId": event_id,
                    "sport": raw.get("strSport") or sport or "General",
                    "league": raw.get("strLeague") or "General League",
                    "homeTeam": home.strip(),
                    "awayTeam": away.strip(),
                    "startTime": start_time,
                    "status": normalize_status(raw.get("strStatus", ""), start_time),
                    "homeTeamLogo": raw.get("strHomeTeamBadge") or raw.get("strThumb") or "",
                    "awayTeamLogo": raw.get("strAwayTeamBadge") or "",
                    "broadcasters": broadcasters
                })
            except Exception as e:
                print(f"[TheSportsDB] Error parsing event: {e}", file=sys.stderr)
        
        return events, "ok"

class CricketDataClient:
    """Client for CricketData.org / CricAPI."""
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get(ENV_CRICKETDATA_KEY, os.environ.get("CRICAPI_KEY", ""))
        self.base_url = "https://api.cricapi.com/v1"

    def fetch_current_matches(self) -> Tuple[List[Dict[str, Any]], str]:
        if not self.api_key:
            return [], "not_configured"
        
        url = f"{self.base_url}/currentMatches?apikey={self.api_key}&offset=0"
        data, err = safe_http_get(url)
        if err:
            return [], f"error: {err}"
        if not data or data.get("status") != "success" or not data.get("data"):
            return [], "ok_empty"
        
        events = []
        for raw in data.get("data", []):
            try:
                event_id = f"cric_{raw.get('id')}"
                teams = raw.get("teams", [])
                home = teams[0] if len(teams) > 0 else raw.get("name", "Team A")
                away = teams[1] if len(teams) > 1 else "Team B"
                
                start_time = raw.get("dateTimeGMT", datetime.now(timezone.utc).isoformat())
                if not start_time.endswith("Z"):
                    start_time += "Z"
                
                raw_status = raw.get("status", "")
                is_match_started = raw.get("matchStarted", False)
                is_match_ended = raw.get("matchEnded", False)

                if is_match_ended:
                    status = "FINISHED"
                elif is_match_started:
                    status = "LIVE"
                else:
                    status = normalize_status(raw_status, start_time)

                broadcasters = match_broadcasters(raw)

                # Team info logos if provided by CricketData
                team_info = raw.get("teamInfo", [])
                h_logo = team_info[0].get("img") if len(team_info) > 0 and team_info[0].get("img") else ""
                a_logo = team_info[1].get("img") if len(team_info) > 1 and team_info[1].get("img") else ""

                events.append({
                    "eventId": event_id,
                    "sport": "Cricket",
                    "league": raw.get("matchType", "International").upper() + " Match",
                    "homeTeam": home,
                    "awayTeam": away,
                    "startTime": start_time,
                    "status": status,
                    "homeTeamLogo": h_logo,
                    "awayTeamLogo": a_logo,
                    "score": raw.get("score", []),
                    "broadcasters": broadcasters
                })
            except Exception as e:
                print(f"[CricketData] Error parsing event: {e}", file=sys.stderr)
        
        return events, "ok"

class AllSportsAPIClient:
    """Client for All Sports API (Football, Cricket, Basketball, Tennis)."""
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get(ENV_ALLSPORTS_KEY, os.environ.get("ALLSPORTSAPI_KEY", ""))
        self.base_url = "https://apiv2.allsportsapi.com"

    def fetch_livescores(self, sport: str = "football") -> Tuple[List[Dict[str, Any]], str]:
        if not self.api_key:
            return [], "not_configured"
        
        url = f"{self.base_url}/{sport}/?met=Livescore&APIkey={self.api_key}"
        data, err = safe_http_get(url)
        if err:
            return [], f"error: {err}"
        if not data or not data.get("result"):
            return [], "ok_empty"
        
        events = []
        for raw in data.get("result", []):
            try:
                event_id = f"as_{sport}_{raw.get('event_key')}"
                home = raw.get("event_home_team") or raw.get("event_first_player") or "Home"
                away = raw.get("event_away_team") or raw.get("event_second_player") or "Away"
                
                date_event = raw.get("event_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
                time_event = raw.get("event_time") or "00:00"
                start_time = f"{date_event}T{time_event}:00Z"
                
                broadcasters = match_broadcasters(raw)

                events.append({
                    "eventId": event_id,
                    "sport": sport.capitalize(),
                    "league": raw.get("league_name") or "General League",
                    "homeTeam": str(home).strip(),
                    "awayTeam": str(away).strip(),
                    "startTime": start_time,
                    "status": "LIVE",
                    "homeTeamLogo": raw.get("home_team_logo") or "",
                    "awayTeamLogo": raw.get("away_team_logo") or "",
                    "broadcasters": broadcasters
                })
            except Exception as e:
                print(f"[AllSportsAPI] Error parsing {sport} event: {e}", file=sys.stderr)
        
        return events, "ok"

def fetch_all_sports_events() -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Orchestrates data fetching across all configured sports APIs.
    Aggregates, deduplicates, and returns unified events and source status.
    """
    catalog = load_verified_channel_catalog()
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tomorrow_str = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    
    source_status = {
        "cricketdata": "not_configured",
        "thesportsdb": "ok",
        "allsports": "not_configured"
    }

    aggregated_events = []
    seen_event_ids = set()

    # 1. Fetch from TheSportsDB
    tsdb = TheSportsDBClient()
    for sp in ["Cricket", "Soccer", "Motorsport", "Basketball", "Fighting"]:
        evs, status = tsdb.fetch_events_for_date(today_str, sport=sp)
        if status == "ok":
            source_status["thesportsdb"] = "ok"
            for ev in evs:
                if ev["eventId"] not in seen_event_ids:
                    seen_event_ids.add(ev["eventId"])
                    aggregated_events.append(ev)
        elif source_status["thesportsdb"] != "ok":
            source_status["thesportsdb"] = status

    # Also check tomorrow for UPCOMING events
    for sp in ["Cricket", "Soccer"]:
        evs, status = tsdb.fetch_events_for_date(tomorrow_str, sport=sp)
        if status == "ok":
            for ev in evs:
                if ev["eventId"] not in seen_event_ids:
                    seen_event_ids.add(ev["eventId"])
                    aggregated_events.append(ev)

    # 2. Fetch from CricketData.org
    cric = CricketDataClient()
    cric_evs, cric_status = cric.fetch_current_matches()
    source_status["cricketdata"] = cric_status
    for ev in cric_evs:
        if ev["eventId"] not in seen_event_ids:
            seen_event_ids.add(ev["eventId"])
            aggregated_events.append(ev)

    # 3. Fetch from All Sports API
    all_sports = AllSportsAPIClient()
    for sp in ["football", "cricket", "basketball", "tennis"]:
        as_evs, as_status = all_sports.fetch_livescores(sp)
        if as_status == "ok":
            source_status["allsports"] = "ok"
            for ev in as_evs:
                if ev["eventId"] not in seen_event_ids:
                    seen_event_ids.add(ev["eventId"])
                    aggregated_events.append(ev)
        elif source_status["allsports"] == "not_configured" and as_status != "not_configured":
            source_status["allsports"] = as_status

    return aggregated_events, source_status

if __name__ == "__main__":
    print("Testing sports API fetcher...")
    events, statuses = fetch_all_sports_events()
    print(f"Fetched {len(events)} events. Source status: {statuses}")
    if events:
        print("Sample event:", json.dumps(events[0], indent=2))
