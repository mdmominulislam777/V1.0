/**
 * HIGHFY TV - Cloudflare Worker Backend API
 * Production-ready Edge Worker for Cricket and Sports APIs.
 * Fully compatible with Cloudflare Workers fetch(request, env, ctx) architecture.
 */

import channelsData from "../channels.json";

export interface Env {
  CRICKETDATA_API_KEY?: string;
  CRICAPI_KEY?: string;
  CRICKET_API_KEY?: string;
  RAPIDAPI_KEY?: string;
  THESPORTSDB_API_KEY?: string;
  ALLSPORTSAPI_KEY?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-rapidapi-key, x-cricapi-key, x-cricketdata-key",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

const HD_CRICKET_LOGOS_MAP: Record<string, string> = {
  india: "https://flagcdn.com/w320/in.png",
  ind: "https://flagcdn.com/w320/in.png",
  bangladesh: "https://flagcdn.com/w320/bd.png",
  ban: "https://flagcdn.com/w320/bd.png",
  pakistan: "https://flagcdn.com/w320/pk.png",
  pak: "https://flagcdn.com/w320/pk.png",
  england: "https://flagcdn.com/w320/gb-eng.png",
  eng: "https://flagcdn.com/w320/gb-eng.png",
  australia: "https://flagcdn.com/w320/au.png",
  aus: "https://flagcdn.com/w320/au.png",
  "sri lanka": "https://flagcdn.com/w320/lk.png",
  sl: "https://flagcdn.com/w320/lk.png",
  "south africa": "https://flagcdn.com/w320/za.png",
  sa: "https://flagcdn.com/w320/za.png",
  "new zealand": "https://flagcdn.com/w320/nz.png",
  nz: "https://flagcdn.com/w320/nz.png",
  "west indies": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170818/west-indies.jpg",
  wi: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170818/west-indies.jpg",
  afghanistan: "https://flagcdn.com/w320/af.png",
  afg: "https://flagcdn.com/w320/af.png",
  ireland: "https://flagcdn.com/w320/ie.png",
  scotland: "https://flagcdn.com/w320/gb-sct.png",
  netherlands: "https://flagcdn.com/w320/nl.png",
  zimbabwe: "https://flagcdn.com/w320/zw.png",
  nepal: "https://flagcdn.com/w320/np.png",
  usa: "https://flagcdn.com/w320/us.png",
  canada: "https://flagcdn.com/w320/ca.png",
  uae: "https://flagcdn.com/w320/ae.png",
  "chennai super kings": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170823/chennai-super-kings.jpg",
  csk: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170823/chennai-super-kings.jpg",
  "mumbai indians": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170829/mumbai-indians.jpg",
  mi: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170829/mumbai-indians.jpg",
  "royal challengers bengaluru": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
  "royal challengers bangalore": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
  rcb: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
  "kolkata knight riders": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170827/kolkata-knight-riders.jpg",
  kkr: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170827/kolkata-knight-riders.jpg",
  "delhi capitals": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170828/delhi-capitals.jpg",
  dc: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170828/delhi-capitals.jpg",
  "rajasthan royals": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170831/rajasthan-royals.jpg",
  rr: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170831/rajasthan-royals.jpg",
  "sunrisers hyderabad": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170830/sunrisers-hyderabad.jpg",
  srh: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170830/sunrisers-hyderabad.jpg",
  "gujarat titans": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225642/gujarat-titans.jpg",
  gt: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225642/gujarat-titans.jpg",
  "lucknow super giants": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225645/lucknow-super-giants.jpg",
  lsg: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225645/lucknow-super-giants.jpg",
  "punjab kings": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170824/punjab-kings.jpg",
  pbks: "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170824/punjab-kings.jpg",
};

function resolveHDTeamLogo(teamName: string, rawLogo?: string): string {
  if (rawLogo && typeof rawLogo === "string") {
    let clean = rawLogo.trim();
    if (clean && !clean.includes("un.png") && !clean.includes("placeholder") && !clean.includes("default-team")) {
      if (clean.includes("cricbuzz.com") && clean.includes("/72x54/")) {
        clean = clean.replace("/72x54/", "/300x300/");
      }
      if (clean.includes("flagcdn.com/w160/")) {
        clean = clean.replace("/w160/", "/w320/");
      }
      if (clean.startsWith("http://static.cricbuzz.com")) {
        clean = clean.replace("http://", "https://");
      }
      return clean;
    }
  }

  if (!teamName) return "./assets/team-placeholder.svg";
  const tLower = teamName.toLowerCase().trim();

  if (HD_CRICKET_LOGOS_MAP[tLower]) {
    return HD_CRICKET_LOGOS_MAP[tLower];
  }

  for (const [k, v] of Object.entries(HD_CRICKET_LOGOS_MAP)) {
    if (k.length <= 3) {
      const regex = new RegExp(`(^|\\b|\\s)${k}(\\b|\\s|$)`, "i");
      if (regex.test(tLower)) {
        return v;
      }
    } else {
      if (tLower === k || tLower.includes(k) || k.includes(tLower)) {
        return v;
      }
    }
  }

  return "./assets/team-placeholder.svg";
}

function formatDhakaEventTime(timestamp: number): string {
  try {
    const dateObj = new Date(timestamp);
    const timeStr = dateObj.toLocaleTimeString("en-US", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${timeStr} BST`;
  } catch {
    return "Scheduled";
  }
}

// Broadcaster & Channel Mapping Logic strictly based on API response
function resolveCricketBroadcastData(sportEvent: any, item: any) {
  const extracted: string[] = [];
  const srSources = [
    item?.channels,
    sportEvent?.channels,
    item?.broadcasters,
    sportEvent?.broadcasters,
    item?.tv_channels,
    sportEvent?.tv_channels,
    item?.broadcast,
    sportEvent?.broadcast,
    item?.broadcasts,
    sportEvent?.broadcasts,
    item?.geoBroadcasts,
    sportEvent?.geoBroadcasts,
    item?.strTVStation,
    sportEvent?.strTVStation,
    item?.tvStation,
    sportEvent?.tvStation,
    item?.media?.channels,
    sportEvent?.media?.channels,
    item?.media?.broadcasters,
    sportEvent?.media?.broadcasters,
    item?.coverage?.channels,
    sportEvent?.coverage?.channels,
    item?.coverage?.tv_channels,
    sportEvent?.coverage?.tv_channels,
    item?.coverage?.tv,
    sportEvent?.coverage?.tv,
    item?.sport_event_status?.broadcast,
    sportEvent?.sport_event_status?.broadcast,
    item?.sport_event_status?.channels,
    sportEvent?.sport_event_status?.channels,
  ];

  function extractFromEntry(entry: any) {
    if (!entry) return;
    if (Array.isArray(entry)) {
      for (const sub of entry) {
        extractFromEntry(sub);
      }
    } else if (typeof entry === "string") {
      const parts = entry
        .split(/[,/|;+]|\band\b/i)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const trimmed of parts) {
        if (trimmed && !trimmed.toLowerCase().includes("unknown") && !trimmed.toLowerCase().includes("tbd")) {
          extracted.push(trimmed);
        }
      }
    } else if (typeof entry === "object") {
      if (Array.isArray(entry.names)) {
        extractFromEntry(entry.names);
      }
      const name =
        entry.name ||
        entry.channel_name ||
        entry.broadcaster_name ||
        entry.station ||
        entry.tv_name ||
        entry.channel ||
        entry.title ||
        entry.value ||
        entry.media?.shortName ||
        entry.media?.name ||
        "";
      if (typeof name === "string" && name.trim()) {
        extractFromEntry(name);
      }
    }
  }

  for (const src of srSources) {
    extractFromEntry(src);
  }

  if (extracted.length === 0) {
    return {
      broadcaster: null,
      broadcasters: [],
      channelId: null,
      channelName: null,
      channelLogo: null,
      streamUrl: null,
      streams: [],
    };
  }

  const uniqueBroadcasters = Array.from(new Set(extracted.filter(Boolean)));
  const primaryBroadcaster = uniqueBroadcasters.slice(0, 3).join(", ");
  const allChannels = Array.isArray(channelsData) ? channelsData : [];

  const explicitServerAliases: Record<string, string[]> = {
    "t sports": ["ch-t-sports-hd", "ch-t-sports-server-2"],
    "t sports hd": ["ch-t-sports-hd", "ch-t-sports-server-2"],
    tsports: ["ch-t-sports-hd", "ch-t-sports-server-2"],
    "gazi tv": ["ch-gazi-tv"],
    gtv: ["ch-gazi-tv"],
    "gazi tv hd": ["ch-gazi-tv"],
    "gazi television": ["ch-gazi-tv"],
    gazi: ["ch-gazi-tv"],
    maasranga: ["ch-maasranga-tv-hd"],
    "maasranga tv": ["ch-maasranga-tv-hd"],
    "maasranga tv hd": ["ch-maasranga-tv-hd"],
    nagorik: ["ch-nagorik-tv"],
    "nagorik tv": ["ch-nagorik-tv"],
    "star sports 1 hindi": ["ch-star-sports-1-hindi"],
    "star sports hindi": ["ch-star-sports-1-hindi"],
    "star sports 1 hd hindi": ["ch-star-sports-1-hindi"],
    "ss1 hindi": ["ch-star-sports-1-hindi"],
    "star sports 1": ["ch-star-sports-1-hd"],
    "star sports 1 hd": ["ch-star-sports-1-hd"],
    "star sports one": ["ch-star-sports-1-hd"],
    "star sport 1": ["ch-star-sports-1-hd"],
    ss1: ["ch-star-sports-1-hd"],
    willow: ["ch-willow-hd", "ch-willow-sports"],
    "willow cricket": ["ch-willow-hd", "ch-willow-sports"],
    "willow tv": ["ch-willow-hd", "ch-willow-sports"],
    "willow hd": ["ch-willow-hd", "ch-willow-sports"],
    "willow usa": ["ch-willow-hd", "ch-willow-sports"],
    "willow sports": ["ch-willow-sports", "ch-willow-hd"],
    "willow sports 2": ["ch-willow-sports-2"],
    "willow 2": ["ch-willow-sports-2"],
    "willow extra": ["ch-willow-cricket-extra"],
    "willow xtra": ["ch-willow-cricket-extra"],
    "willow cricket extra": ["ch-willow-cricket-extra"],
    "ptv sports": ["ch-ptv-sports-hd"],
    "ptv sports hd": ["ch-ptv-sports-hd"],
    "ptv sport": ["ch-ptv-sports-hd"],
    ptv: ["ch-ptv-sports-hd"],
    "a sports": ["ch-a-sports"],
    "a sports hd": ["ch-a-sports"],
    asports: ["ch-a-sports"],
    "a sport": ["ch-a-sports"],
    "ten sports": ["ch-ten-sports-hd"],
    "ten sports hd": ["ch-ten-sports-hd"],
    "ten sports pakistan": ["ch-ten-sports-hd"],
    "ten sports pk": ["ch-ten-sports-hd"],
    "ten cricket": ["ch-ten-cricket"],
    "sony sports ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony sports ten 2 hd": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony ten 2 hd": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "ten sports 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony sports 2": ["ch-sony-sports-2-hd", "ch-sony-sports-ten-2-hd"],
    "sony sports 2 hd": ["ch-sony-sports-2-hd", "ch-sony-sports-ten-2-hd"],
    "sony sports ten 3": ["ch-sony-sports-ten-3"],
    "sony sports ten 3 hd": ["ch-sony-sports-ten-3"],
    "sony ten 3": ["ch-sony-sports-ten-3"],
    "sony ten 3 hd": ["ch-sony-sports-ten-3"],
    "ten 3": ["ch-sony-sports-ten-3"],
    "ten sports 3": ["ch-sony-sports-ten-3"],
    "sony ten 3 hindi": ["ch-sony-sports-ten-3"],
    "sky sports cricket": ["ch-sky-sports-cricket"],
    "sky cricket": ["ch-sky-sports-cricket"],
    "sky sports mix": ["ch-sky-sports-mix"],
    "fox cricket": ["ch-fox-cricket-501"],
    "fox cricket 501": ["ch-fox-cricket-501"],
    "fox sports 501": ["ch-fox-cricket-501"],
    "astro cricket": ["ch-astro-cricbuz"],
    "astro cricbuz": ["ch-astro-cricbuz"],
    "cricket gold": ["ch-cricket-gold"],
    "dd sports": ["ch-dd-sports"],
  };

  const matchedChannels: any[] = [];
  const seenChannelIds = new Set<string>();

  for (const bName of uniqueBroadcasters) {
    const bLower = bName.toLowerCase().trim();
    const mappedIds = explicitServerAliases[bLower];
    if (mappedIds && mappedIds.length > 0) {
      for (const mappedId of mappedIds) {
        const found = allChannels.find((c: any) => c && (c.id === mappedId || c.id === `ch-${mappedId}`));
        if (found && !seenChannelIds.has(found.id)) {
          seenChannelIds.add(found.id);
          matchedChannels.push(found);
        }
      }
    }
  }

  const primaryChannel = matchedChannels.length > 0 ? matchedChannels[0] : null;
  return {
    broadcaster: primaryBroadcaster,
    broadcasters: uniqueBroadcasters,
    channelId: primaryChannel ? primaryChannel.id : null,
    channelIds: matchedChannels.map((c: any) => c.id),
    channelName: primaryChannel ? primaryChannel.name : null,
    channelLogo: primaryChannel ? primaryChannel.logo || null : null,
    streamUrl: primaryChannel ? primaryChannel.streamUrl || primaryChannel.url || primaryChannel.stream_url || null : null,
    streams: matchedChannels.flatMap((ch: any) => ch.streams || []),
  };
}

function normalizeCricketDataEvent(item: any): any {
  if (!item) return null;
  const rawId = item.id || item.unique_id || item.match_id || "unknown";
  const name = item.name || item.title || "Cricket Match";
  const matchType = String(item.matchType || item.type || "Cricket").toUpperCase();
  const venue = item.venue || "";
  const statusText = item.status || "Scheduled";
  const statusLower = statusText.toLowerCase();

  const matchStarted = item.matchStarted === true || item.matchStarted === "true";
  const matchEnded = item.matchEnded === true || item.matchEnded === "true";

  let status = "upcoming";
  if (
    matchEnded ||
    statusLower.includes("won by") ||
    statusLower.includes("match drawn") ||
    statusLower.includes("match tied") ||
    statusLower.includes("no result") ||
    statusLower.includes("abandoned") ||
    statusLower.includes("completed") ||
    statusLower.includes("concluded")
  ) {
    status = "finished";
  } else if (matchStarted && !matchEnded) {
    status = "live";
  } else {
    status = "upcoming";
  }

  const teams = Array.isArray(item.teams) ? item.teams : [];
  const teamInfo = Array.isArray(item.teamInfo) ? item.teamInfo : [];
  let homeName = teams[0] || (name.includes(" vs ") ? name.split(" vs ")[0].split(",")[0].trim() : "Team 1");
  let awayName = teams[1] || (name.includes(" vs ") ? name.split(" vs ")[1].split(",")[0].trim() : "Team 2");

  const homeInfo = teamInfo.find((t: any) => t.name === homeName) || teamInfo[0] || {};
  const awayInfo = teamInfo.find((t: any) => t.name === awayName) || teamInfo[1] || {};

  const homeLogo = resolveHDTeamLogo(homeName, homeInfo.img);
  const awayLogo = resolveHDTeamLogo(awayName, awayInfo.img);

  const scoreList = Array.isArray(item.score) ? item.score : [];
  let homeScore = "";
  let homeOvers = "";
  let awayScore = "";
  let awayOvers = "";

  if (scoreList.length > 0) {
    for (const sc of scoreList) {
      const inng = String(sc.inning || "").toLowerCase();
      const runs = sc.r !== undefined ? sc.r : 0;
      const wkts = sc.w !== undefined ? sc.w : 0;
      const overs = sc.o !== undefined ? sc.o : 0;
      const formatted = `${runs}/${wkts}`;
      const formattedOvers = `(${overs} ov)`;

      if (inng.includes(homeName.toLowerCase()) || inng.includes("inning 1") || (!homeScore && scoreList.indexOf(sc) === 0)) {
        if (!homeScore) {
          homeScore = formatted;
          homeOvers = formattedOvers;
        } else {
          homeScore += ` & ${formatted}`;
        }
      } else {
        if (!awayScore) {
          awayScore = formatted;
          awayOvers = formattedOvers;
        } else {
          awayScore += ` & ${formatted}`;
        }
      }
    }
  }

  const rawStartStr = item.dateTimeGMT || item.date || item.startTime || null;
  const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr.endsWith("Z") ? rawStartStr : rawStartStr + "Z")) : NaN;
  const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
  const timestamp = hasValidStart ? parsedStartMs : null;

  const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";
  const tournamentName = item.series_id || item.seriesName || (name.includes(",") ? name.split(",").slice(1).join(",").trim() : "Cricket Series");

  const broadcastMockEvent = {
    tournament: { name: tournamentName },
    season: { name: tournamentName },
    type: matchType,
    competitors: [
      { qualifier: "home", name: homeName, id: homeInfo.shortname || homeName },
      { qualifier: "away", name: awayName, id: awayInfo.shortname || awayName }
    ]
  };
  const bData = resolveCricketBroadcastData(broadcastMockEvent, item);

  return {
    id: `cr-cricapi-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    rawId: rawId,
    matchId: rawId,
    sport: "cricket",
    sportName: "Cricket",
    sportIcon: "fa-baseball-bat-ball",
    title: `${homeName} vs ${awayName}`,
    name: `${homeName} vs ${awayName}`,
    seriesName: tournamentName,
    tournament: tournamentName,
    league: tournamentName,
    matchDesc: matchType,
    matchFormat: matchType,
    matchType: matchType,
    startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
    endTime: null,
    status,
    statusText,
    statusLabel: status === "live" ? "LIVE" : status === "finished" ? "FT" : "Upcoming",
    timestamp,
    date: hasValidStart
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Dhaka",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(parsedStartMs))
      : "",
    matchTime: matchTimeStr,
    timeOrTimer: status === "live" ? "LIVE" : status === "finished" ? "FT" : matchTimeStr,
    venue,
    isHot: status === "live",
    isSpecial: status === "live",
    team1: {
      teamId: homeInfo.shortname || homeName,
      name: homeName,
      shortName: homeInfo.shortname || "",
      logo: homeLogo,
      score: homeScore,
      overs: homeOvers,
    },
    team2: {
      teamId: awayInfo.shortname || awayName,
      name: awayName,
      shortName: awayInfo.shortname || "",
      logo: awayLogo,
      score: awayScore,
      overs: awayOvers,
    },
    homeTeam: {
      name: homeName,
      logo: homeLogo,
      score: homeScore,
      overs: homeOvers,
    },
    awayTeam: {
      name: awayName,
      logo: awayLogo,
      score: awayScore,
      overs: awayOvers,
    },
    broadcaster: bData.broadcaster,
    broadcasters: bData.broadcasters,
    channelId: bData.channelId,
    channelIds: bData.channelIds,
    channelName: bData.channelName,
    channelLogo: bData.channelLogo,
    streamUrl: bData.streamUrl,
    streams: bData.streams,
    subText: bData.channelName ? `${tournamentName} • ${bData.channelName}` : tournamentName,
    source: "CricketData.org",
  };
}

async function fetchCricketDataApi(
  endpoint: string,
  apiKey: string,
  offset = 0
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, status: 400, error: "CricketData API key is missing." };
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const sep = cleanEndpoint.includes("?") ? "&" : "?";
  const url = `https://api.cricapi.com/v1/${cleanEndpoint}${sep}apikey=${encodeURIComponent(apiKey.trim())}&offset=${offset}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HighFy-TV/4.2",
      },
      signal: AbortSignal.timeout(8000),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.reason || data?.message || (text ? text.slice(0, 250) : res.statusText),
      };
    }

    if (data && data.status === "failure") {
      return {
        ok: false,
        status: 400,
        error: data.reason || "CricketData API returned failure status",
        data,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 500, error: err.message || "Network error reaching CricketData.org API" };
  }
}

async function getNormalizedCricketDataMatches(env: Env, customKey?: string) {
  const activeKey =
    (customKey && customKey.trim()) ||
    (env.CRICKETDATA_API_KEY || env.CRICAPI_KEY || env.CRICKET_API_KEY || "").trim();

  if (!activeKey) {
    return {
      status: "missing_key",
      rateLimited: false,
      upstreamStatus: 400,
      total: 0,
      data: [],
    };
  }

  const events: any[] = [];
  const seenIds = new Set<string>();

  const currentRes = await fetchCricketDataApi("currentMatches", activeKey, 0);
  if (currentRes.status === 429) {
    return {
      status: "rate_limited",
      rateLimited: true,
      upstreamStatus: 429,
      message: currentRes.error || "CricketData.org rate limit reached (HTTP 429)",
      total: 0,
      data: [],
    };
  }

  if (currentRes.ok && currentRes.data && Array.isArray(currentRes.data.data)) {
    for (const item of currentRes.data.data) {
      const ev = normalizeCricketDataEvent(item);
      if (ev && !seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        events.push(ev);
      }
    }
  }

  return {
    status: "success",
    rateLimited: false,
    upstreamStatus: currentRes.status || 200,
    total: events.length,
    data: events,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Health check route
    if (path === "/api/health" || path === "/health") {
      return jsonResponse({
        status: "ok",
        secure: true,
        worker: true,
        cricketDataConfigured: Boolean((env.CRICKETDATA_API_KEY || env.CRICAPI_KEY || env.CRICKET_API_KEY) && (env.CRICKETDATA_API_KEY || env.CRICAPI_KEY || env.CRICKET_API_KEY)!.trim()),
        rapidApiConfigured: Boolean(env.RAPIDAPI_KEY && env.RAPIDAPI_KEY.trim()),
        thesportsdbConfigured: true,
      });
    }

    // 3. Cricket Matches route (/api/cricket/matches or /api/cricket/cricapi/matches)
    if (path === "/api/cricket/matches" || path === "/api/cricket/cricapi/matches") {
      const customKey =
        url.searchParams.get("api_key") ||
        url.searchParams.get("apikey") ||
        url.searchParams.get("key") ||
        request.headers.get("x-cricapi-key") ||
        request.headers.get("x-cricketdata-key") ||
        undefined;
      const result = await getNormalizedCricketDataMatches(env, customKey);
      if (result.status === "rate_limited" || result.rateLimited) {
        return jsonResponse({
          status: "rate_limited",
          source: "CricketData.org",
          rateLimited: true,
          upstreamStatus: 429,
          message: result.message || "CricketData rate limit reached (HTTP 429)",
          total: 0,
          data: [],
        });
      }

      if (result.status === "missing_key") {
        return jsonResponse(
          {
            status: "missing_key",
            source: "CricketData.org",
            total: 0,
            data: [],
            message: "CRICKETDATA_API_KEY is not configured in Worker secrets.",
          },
          400
        );
      }

      return jsonResponse({
        status: "success",
        source: "CricketData.org",
        rateLimited: false,
        upstreamStatus: result.upstreamStatus,
        total: result.total,
        data: result.data,
      });
    }

    // 4. CricketData Test route (/api/cricapi/test or /api/cricket/cricapi/test)
    if (path === "/api/cricapi/test" || path === "/api/cricket/cricapi/test") {
      const apiKey = (
        url.searchParams.get("key") ||
        url.searchParams.get("api_key") ||
        url.searchParams.get("apikey") ||
        request.headers.get("x-cricapi-key") ||
        request.headers.get("x-cricketdata-key") ||
        env.CRICKETDATA_API_KEY ||
        env.CRICAPI_KEY ||
        env.CRICKET_API_KEY ||
        ""
      ).trim();

      if (!apiKey) {
        return jsonResponse(
          {
            valid: false,
            status: "missing_key",
            message: "CricketData.org API key is required in Worker environment or request header.",
          },
          400
        );
      }

      const start = Date.now();
      const testRes = await fetchCricketDataApi("currentMatches", apiKey, 0);
      const elapsed = Date.now() - start;

      if (testRes.ok && testRes.data) {
        const matches = Array.isArray(testRes.data.data) ? testRes.data.data : [];
        return jsonResponse({
          valid: true,
          status: "success",
          source: "CricketData.org",
          message: `CricketData.org (CricAPI) key is VALID! (${matches.length} current matches found)`,
          latencyMs: elapsed,
          matchesCount: matches.length,
          info: testRes.data.info || {},
        });
      }

      return jsonResponse(
        {
          valid: false,
          status: "error",
          source: "CricketData.org",
          statusCode: testRes.status,
          message: testRes.error || `CricketData.org error with status ${testRes.status}`,
        },
        testRes.status || 500
      );
    }

    // 5. Unknown API route
    return jsonResponse(
      {
        status: "not_found",
        message: `Endpoint ${path} not found on Cloudflare Worker backend`,
      },
      404
    );
  },
};
