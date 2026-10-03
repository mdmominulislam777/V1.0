#!/usr/bin/env python3
"""
HighFy TV — Data Integrity & Schema Validator
Strictly validates channels.json, sports-events.json, and epg.json.

Validates:
- JSON syntax & required fields
- Duplicate event IDs & duplicate channel IDs
- Invalid timestamps & status values
- Broadcaster integrity (api_verified vs name_only)
- Channel references & authorized sources
- URL formatting & security
"""

import json
import os
import sys
import re
from datetime import datetime
from typing import Dict, Any, List, Tuple

URL_REGEX = re.compile(r'^https?://[^\s/$.?#].[^\s]*$', re.IGNORECASE)
ALLOWED_STATUSES = {"LIVE", "TODAY", "UPCOMING", "FINISHED", "UNKNOWN"}
ALLOWED_CHANNEL_STATUSES = {"verified", "unavailable", "pending"}

class ValidationError(Exception):
    pass

def is_valid_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    # Allow relative URLs (e.g. /api/stream-proxy or ./assets/...)
    if url.startswith("/") or url.startswith("./"):
        return True
    return bool(URL_REGEX.match(url.strip()))

def is_valid_iso_timestamp(ts: str) -> bool:
    if not ts or not isinstance(ts, str):
        return False
    try:
        # Normalize trailing Z
        clean = ts.replace('Z', '+00:00')
        datetime.fromisoformat(clean)
        return True
    except Exception:
        return False

def validate_channels_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validates data/channels.json content."""
    report = {
        "valid": True,
        "total_channels": 0,
        "verified_channels": 0,
        "unavailable_channels": 0,
        "playable_sources": 0,
        "rejected_channels": 0,
        "channel_ids": set(),
        "errors": []
    }

    if not isinstance(data, dict):
        report["errors"].append("Root channels payload must be a JSON object")
        report["valid"] = False
        return report

    if "updatedAt" not in data or not is_valid_iso_timestamp(data["updatedAt"]):
        report["errors"].append("Missing or invalid 'updatedAt' timestamp in channels.json")
        report["valid"] = False

    channels_list = data.get("channels", [])
    if not isinstance(channels_list, list):
        report["errors"].append("'channels' field must be an array")
        report["valid"] = False
        return report

    report["total_channels"] = len(channels_list)

    for idx, ch in enumerate(channels_list):
        try:
            cid = ch.get("id")
            name = ch.get("name")
            status = ch.get("status", "verified")
            sources = ch.get("sources", [])

            if not cid or not isinstance(cid, str):
                raise ValidationError(f"Channel at index {idx} missing valid 'id'")
            if cid in report["channel_ids"]:
                raise ValidationError(f"Duplicate channel ID detected: '{cid}'")
            report["channel_ids"].add(cid)

            if not name or not isinstance(name, str):
                raise ValidationError(f"Channel '{cid}' missing valid 'name'")

            if status not in ALLOWED_CHANNEL_STATUSES:
                raise ValidationError(f"Channel '{cid}' has invalid status '{status}'")

            # Check sources
            if not isinstance(sources, list):
                raise ValidationError(f"Channel '{cid}' 'sources' must be an array")

            valid_source_count = 0
            for s_idx, src in enumerate(sources):
                if not isinstance(src, dict):
                    continue
                s_url = src.get("url")
                if s_url and is_valid_url(s_url):
                    valid_source_count += 1
                    report["playable_sources"] += 1

            if status == "verified":
                if valid_source_count > 0:
                    report["verified_channels"] += 1
                else:
                    report["unavailable_channels"] += 1
            else:
                report["unavailable_channels"] += 1

        except ValidationError as ve:
            report["rejected_channels"] += 1
            report["errors"].append(str(ve))
            report["valid"] = False
        except Exception as ex:
            report["rejected_channels"] += 1
            report["errors"].append(f"Unexpected error in channel {idx}: {ex}")
            report["valid"] = False

    return report

def validate_sports_events_data(data: Dict[str, Any], valid_channel_ids: set) -> Dict[str, Any]:
    """Validates data/sports-events.json content."""
    report = {
        "valid": True,
        "total_events": 0,
        "live_events": 0,
        "today_events": 0,
        "upcoming_events": 0,
        "finished_events": 0,
        "total_broadcasters": 0,
        "verified_broadcasters": 0,
        "name_only_broadcasters": 0,
        "rejected_events": 0,
        "event_ids": set(),
        "errors": []
    }

    if not isinstance(data, dict):
        report["errors"].append("Root sports-events payload must be a JSON object")
        report["valid"] = False
        return report

    if "updatedAt" not in data or not is_valid_iso_timestamp(data["updatedAt"]):
        report["errors"].append("Missing or invalid 'updatedAt' timestamp in sports-events.json")
        report["valid"] = False

    events = data.get("events", [])
    if not isinstance(events, list):
        report["errors"].append("'events' field must be an array")
        report["valid"] = False
        return report

    report["total_events"] = len(events)

    for idx, ev in enumerate(events):
        try:
            eid = ev.get("eventId")
            sport = ev.get("sport")
            home = ev.get("homeTeam")
            away = ev.get("awayTeam")
            start_time = ev.get("startTime")
            status = ev.get("status")
            broadcasters = ev.get("broadcasters", [])

            if not eid or not isinstance(eid, str):
                raise ValidationError(f"Event at index {idx} missing valid 'eventId'")
            if eid in report["event_ids"]:
                raise ValidationError(f"Duplicate event ID detected: '{eid}'")
            report["event_ids"].add(eid)

            if not sport or not isinstance(sport, str):
                raise ValidationError(f"Event '{eid}' missing 'sport'")
            if not home or not isinstance(home, str):
                raise ValidationError(f"Event '{eid}' missing 'homeTeam'")
            if not start_time or not is_valid_iso_timestamp(start_time):
                raise ValidationError(f"Event '{eid}' has invalid 'startTime': '{start_time}'")
            if status not in ALLOWED_STATUSES:
                raise ValidationError(f"Event '{eid}' has invalid status: '{status}'")

            if status == "LIVE":
                report["live_events"] += 1
            elif status == "TODAY":
                report["today_events"] += 1
            elif status == "UPCOMING":
                report["upcoming_events"] += 1
            elif status == "FINISHED":
                report["finished_events"] += 1

            # Validate Broadcasters
            if not isinstance(broadcasters, list):
                raise ValidationError(f"Event '{eid}' broadcasters must be an array")

            for b in broadcasters:
                if not isinstance(b, dict):
                    continue
                report["total_broadcasters"] += 1
                b_name = b.get("name")
                b_cid = b.get("channelId")
                b_ver = b.get("verification")

                if not b_name:
                    raise ValidationError(f"Event '{eid}' has broadcaster with missing name")

                if b_ver == "api_verified":
                    if not b_cid or b_cid not in valid_channel_ids:
                        raise ValidationError(f"Event '{eid}' claims api_verified but channelId '{b_cid}' is invalid or missing in catalog")
                    report["verified_broadcasters"] += 1
                elif b_ver == "name_only":
                    if b_cid is not None:
                        raise ValidationError(f"Event '{eid}' has name_only verification but specifies channelId '{b_cid}'")
                    report["name_only_broadcasters"] += 1
                else:
                    raise ValidationError(f"Event '{eid}' broadcaster '{b_name}' has invalid verification '{b_ver}'")

        except ValidationError as ve:
            report["rejected_events"] += 1
            report["errors"].append(str(ve))
            report["valid"] = False
        except Exception as ex:
            report["rejected_events"] += 1
            report["errors"].append(f"Unexpected error in event {idx}: {ex}")
            report["valid"] = False

    return report

def validate_epg_data(data: Dict[str, Any], valid_channel_ids: set) -> Dict[str, Any]:
    """Validates data/epg.json content."""
    report = {
        "valid": True,
        "channels_with_epg": 0,
        "total_programs": 0,
        "rejected_epg": 0,
        "errors": []
    }

    if not isinstance(data, dict):
        report["errors"].append("Root EPG payload must be a JSON object")
        report["valid"] = False
        return report

    if "updatedAt" not in data or not is_valid_iso_timestamp(data["updatedAt"]):
        report["errors"].append("Missing or invalid 'updatedAt' timestamp in epg.json")
        report["valid"] = False

    ch_list = data.get("channels", [])
    if not isinstance(ch_list, list):
        report["errors"].append("'channels' in epg.json must be an array")
        report["valid"] = False
        return report

    report["channels_with_epg"] = len(ch_list)

    for ch in ch_list:
        try:
            cid = ch.get("channelId")
            programs = ch.get("programs", [])
            if not cid or cid not in valid_channel_ids:
                raise ValidationError(f"EPG references unknown or unverified channelId: '{cid}'")
            if not isinstance(programs, list):
                raise ValidationError(f"EPG programs for '{cid}' must be an array")
            
            for p in programs:
                if not isinstance(p, dict):
                    continue
                if not p.get("title") or not is_valid_iso_timestamp(p.get("start")):
                    raise ValidationError(f"Invalid program entry in channel '{cid}'")
                report["total_programs"] += 1

        except ValidationError as ve:
            report["rejected_epg"] += 1
            report["errors"].append(str(ve))
            report["valid"] = False
        except Exception as ex:
            report["rejected_epg"] += 1
            report["errors"].append(f"Unexpected error in EPG channel: {ex}")
            report["valid"] = False

    return report

def validate_all_datasets(data_dir: str = "data") -> Tuple[bool, str]:
    """Runs complete validation across channels.json, sports-events.json, and epg.json."""
    ch_path = os.path.join(data_dir, "channels.json")
    ev_path = os.path.join(data_dir, "sports-events.json")
    epg_path = os.path.join(data_dir, "epg.json")

    overall_valid = True
    output_lines = []

    # 1. Validate Channels
    if not os.path.exists(ch_path):
        return False, f"CRITICAL: {ch_path} does not exist!"
    
    with open(ch_path, "r", encoding="utf-8") as f:
        ch_data = json.load(f)
    
    ch_report = validate_channels_data(ch_data)
    if not ch_report["valid"]:
        overall_valid = False

    # 2. Validate Sports Events
    ev_report = {"valid": True, "total_events": 0, "live_events": 0, "today_events": 0, "upcoming_events": 0, "verified_broadcasters": 0, "rejected_events": 0, "errors": []}
    if os.path.exists(ev_path):
        with open(ev_path, "r", encoding="utf-8") as f:
            ev_data = json.load(f)
        ev_report = validate_sports_events_data(ev_data, ch_report["channel_ids"])
        if not ev_report["valid"]:
            overall_valid = False

    # 3. Validate EPG
    epg_report = {"valid": True, "channels_with_epg": 0, "total_programs": 0, "rejected_epg": 0, "errors": []}
    if os.path.exists(epg_path):
        with open(epg_path, "r", encoding="utf-8") as f:
            epg_data = json.load(f)
        epg_report = validate_epg_data(epg_data, ch_report["channel_ids"])
        if not epg_report["valid"]:
            overall_valid = False

    status_str = "VALIDATION PASSED" if overall_valid else "VALIDATION FAILED"
    output_lines.append("==========================================")
    output_lines.append(f"{status_str}")
    output_lines.append("==========================================")
    output_lines.append(f"Channels (Total):               {ch_report['total_channels']}")
    output_lines.append(f"Verified Channels:              {ch_report['verified_channels']}")
    output_lines.append(f"Playable Authorized Sources:    {ch_report['playable_sources']}")
    output_lines.append(f"Unavailable Channels:           {ch_report['unavailable_channels']}")
    output_lines.append(f"Events (Total):                 {ev_report['total_events']}")
    output_lines.append(f"  - LIVE Events:                {ev_report.get('live_events', 0)}")
    output_lines.append(f"  - TODAY Events:               {ev_report.get('today_events', 0)}")
    output_lines.append(f"  - UPCOMING Events:            {ev_report.get('upcoming_events', 0)}")
    output_lines.append(f"  - FINISHED Events:            {ev_report.get('finished_events', 0)}")
    output_lines.append(f"Verified Broadcaster Links:     {ev_report.get('verified_broadcasters', 0)}")
    output_lines.append(f"Name-only Broadcasters:         {ev_report.get('name_only_broadcasters', 0)}")
    output_lines.append(f"EPG Channels Configured:        {epg_report.get('channels_with_epg', 0)}")
    output_lines.append(f"EPG Program Entries:            {epg_report.get('total_programs', 0)}")
    output_lines.append(f"Rejected Records:               {ch_report['rejected_channels'] + ev_report['rejected_events'] + epg_report['rejected_epg']}")
    output_lines.append("==========================================")

    all_errors = ch_report["errors"] + ev_report["errors"] + epg_report["errors"]
    if all_errors:
        output_lines.append("Errors / Warnings:")
        for err in all_errors[:10]:
            output_lines.append(f"  ❌ {err}")

    summary_text = "\n".join(output_lines)
    return overall_valid, summary_text

if __name__ == "__main__":
    valid, report = validate_all_datasets()
    print(report)
    sys.exit(0 if valid else 1)
