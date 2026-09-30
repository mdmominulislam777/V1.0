/**
 * HIGHFY TV - Cloudflare Worker Backend API
 * Production-ready Edge Worker for Cricket and Sports APIs.
 * Fully compatible with Cloudflare Workers fetch(request, env, ctx) architecture.
 */

import channelsData from "../channels.json";

export interface Env {
  SPORTRADAR_CRICKET_API_KEY?: string;
  SPORTRADAR_CRICKET_TIER?: string;
  RAPIDAPI_KEY?: string;
  THESPORTSDB_API_KEY?: string;
  ALLSPORTSAPI_KEY?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-rapidapi-key, x-sportradar-api-key, x-sportradar-tier",
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

function sanitizeSportradarTier(t?: string | null, envTier?: string | null): string {
  let str = typeof t === "string" ? t.trim().toLowerCase() : "";
  if (!str && typeof envTier === "string" && envTier.trim() && envTier.length < 16) {
    str = envTier.trim().toLowerCase();
  }
  str = str.replace(/^cricket-/, "");
  if (!str || str.length > 8 || str.length >= 16) {
    return "t2";
  }
  return str;
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

function normalizeSportradarEvent(item: any): any {
  if (!item) return null;
  const sportEvent = item.sport_event || item;
  const statusObj = item.sport_event_status || {};
  const competitors = Array.isArray(sportEvent.competitors) ? sportEvent.competitors : [];
  const home = competitors.find((c: any) => c.qualifier === "home") || competitors[0] || {};
  const away = competitors.find((c: any) => c.qualifier === "away") || competitors[1] || {};
  const homeName = home.name || "Home Team";
  const awayName = away.name || "Away Team";
  const tournamentName = sportEvent.tournament?.name || sportEvent.season?.name || "Cricket Tournament";
  const tNameLower = tournamentName.toLowerCase();
  const rawType = String(
    sportEvent.type || sportEvent.format || sportEvent.tournament?.type || item.type || item.match_type || ""
  ).toLowerCase().trim();

  let matchFormat = "Cricket";
  let formatDurationMs = 6 * 3600 * 1000;
  let maxLiveSafeguardMs = 12 * 3600 * 1000;

  const isAuthoritativeTestType =
    rawType === "test" ||
    rawType === "first_class" ||
    rawType === "first-class" ||
    rawType === "fc" ||
    rawType === "multi_day" ||
    rawType.includes("test");
  const isAuthoritativeT20Type =
    rawType === "t20" ||
    rawType === "t20i" ||
    rawType === "twenty20" ||
    rawType === "t10" ||
    rawType === "100_ball" ||
    rawType.includes("t20");
  const isAuthoritativeOdiType =
    rawType === "odi" || rawType === "one_day" || rawType === "one-day" || rawType.includes("odi");

  const isTournamentTestOrFc =
    tNameLower.includes("test") ||
    tNameLower.includes("county") ||
    tNameLower.includes("first-class") ||
    tNameLower.includes("first class") ||
    tNameLower.includes("ranji") ||
    tNameLower.includes("ashes");

  if (isAuthoritativeTestType || (!isAuthoritativeT20Type && !isAuthoritativeOdiType && isTournamentTestOrFc)) {
    matchFormat = tNameLower.includes("county") ? "County" : "Test";
    formatDurationMs = 5 * 24 * 3600 * 1000;
    maxLiveSafeguardMs = 5.5 * 24 * 3600 * 1000;
  } else if (isAuthoritativeT20Type || tNameLower.includes("t20") || tNameLower.includes("ipl") || tNameLower.includes("bpl") || tNameLower.includes("psl")) {
    matchFormat = "T20";
    formatDurationMs = 4.25 * 3600 * 1000;
    maxLiveSafeguardMs = 10 * 3600 * 1000;
  } else if (isAuthoritativeOdiType || tNameLower.includes("odi") || tNameLower.includes("world cup")) {
    matchFormat = "ODI";
    formatDurationMs = 8.5 * 3600 * 1000;
    maxLiveSafeguardMs = 13 * 3600 * 1000;
  }

  const rawStartStr =
    sportEvent.scheduled ||
    sportEvent.start_time ||
    sportEvent.scheduled_start ||
    item.scheduled ||
    item.start_time ||
    item.startTime ||
    null;
  const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
  const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
  const timestamp: number | null = hasValidStart ? parsedStartMs : null;
  const startTimeIso: string | null = hasValidStart ? new Date(parsedStartMs).toISOString() : null;

  const rawEndStr =
    sportEvent.end_time ||
    sportEvent.scheduled_end ||
    item.end_time ||
    item.endTime ||
    item.scheduled_end ||
    null;
  const parsedEndMs = rawEndStr ? Date.parse(String(rawEndStr)) : NaN;
  const hasAuthoritativeEnd = !isNaN(parsedEndMs) && parsedEndMs > 0 && (!hasValidStart || parsedEndMs > parsedStartMs);
  const authoritativeEndTimeMs: number | null = hasAuthoritativeEnd ? parsedEndMs : null;

  const safeLiveWindowEndMs: number | null =
    authoritativeEndTimeMs !== null
      ? authoritativeEndTimeMs
      : hasValidStart
      ? parsedStartMs + formatDurationMs
      : null;
  const staleSafeguardEndMs: number | null =
    authoritativeEndTimeMs !== null
      ? authoritativeEndTimeMs
      : hasValidStart
      ? parsedStartMs + maxLiveSafeguardMs
      : null;
  const endTimeIso: string | null =
    authoritativeEndTimeMs !== null
      ? new Date(authoritativeEndTimeMs).toISOString()
      : safeLiveWindowEndMs !== null
      ? new Date(safeLiveWindowEndMs).toISOString()
      : null;

  const nowMs = Date.now();
  const rawStatus = String(statusObj.status || sportEvent.status || item.status || "").toLowerCase().trim();
  const matchStatus = String(statusObj.match_status || "").toLowerCase().trim();
  const isFromLiveFeed = Boolean(item._fromLiveSchedule);

  const isExplicitFinished =
    rawStatus === "closed" ||
    rawStatus === "ended" ||
    rawStatus === "finished" ||
    rawStatus === "complete" ||
    rawStatus === "completed" ||
    rawStatus === "abandoned" ||
    matchStatus === "ended" ||
    matchStatus === "completed" ||
    matchStatus === "abandoned" ||
    matchStatus === "closed" ||
    matchStatus === "finished";

  const isExplicitNonLive =
    rawStatus === "not_started" ||
    rawStatus === "delayed" ||
    rawStatus === "postponed" ||
    rawStatus === "cancelled" ||
    rawStatus === "canceled" ||
    rawStatus === "scheduled" ||
    matchStatus === "not_started" ||
    matchStatus === "delayed" ||
    matchStatus === "postponed" ||
    matchStatus === "cancelled" ||
    matchStatus === "canceled" ||
    matchStatus === "scheduled";

  const isExplicitLive =
    !isExplicitFinished &&
    !isExplicitNonLive &&
    (rawStatus === "live" ||
      rawStatus === "in_progress" ||
      rawStatus === "started" ||
      matchStatus === "in_progress" ||
      matchStatus === "live" ||
      matchStatus.includes("progress") ||
      matchStatus.includes("innings") ||
      rawStatus.includes("progress"));

  let status = "upcoming";
  let statusText = "Scheduled";

  if (isExplicitFinished) {
    status = "finished";
    statusText = statusObj.match_status || "Match Concluded";
  } else if (authoritativeEndTimeMs !== null && nowMs > authoritativeEndTimeMs) {
    status = "finished";
    statusText = statusObj.match_status || "Match Concluded";
  } else if (staleSafeguardEndMs !== null && nowMs > staleSafeguardEndMs) {
    status = "finished";
    statusText = statusObj.match_status || "Match Concluded";
  } else if (
    (isExplicitLive || (isFromLiveFeed && !isExplicitNonLive)) &&
    (!hasValidStart ||
      (nowMs >= parsedStartMs - 15 * 60 * 1000 &&
        (staleSafeguardEndMs === null || nowMs <= staleSafeguardEndMs)))
  ) {
    status = "live";
    statusText = statusObj.match_status && statusObj.match_status !== "not_started" ? statusObj.match_status : "LIVE NOW";
  } else if (
    hasValidStart &&
    !isExplicitNonLive &&
    safeLiveWindowEndMs !== null &&
    nowMs >= parsedStartMs &&
    nowMs <= safeLiveWindowEndMs
  ) {
    status = "live";
    statusText = statusObj.match_status && statusObj.match_status !== "not_started" ? statusObj.match_status : "LIVE NOW";
  } else if (
    hasValidStart &&
    !isExplicitLive &&
    !isExplicitNonLive &&
    safeLiveWindowEndMs !== null &&
    nowMs > safeLiveWindowEndMs
  ) {
    status = "finished";
    statusText = statusObj.match_status || "Match Concluded";
  } else {
    status = "upcoming";
    statusText = statusObj.match_status && statusObj.match_status !== "not_started" ? statusObj.match_status : "Upcoming";
  }

  const periodScores = Array.isArray(statusObj.period_scores) ? statusObj.period_scores : [];
  let homeScore = "";
  let homeOvers = "";
  let awayScore = "";
  let awayOvers = "";

  const homePeriods = periodScores.filter((p: any) => p.home_score !== undefined && p.home_score !== null);
  if (homePeriods.length > 0) {
    const lastP = homePeriods[homePeriods.length - 1];
    homeScore = `${lastP.home_score}/${lastP.home_wickets !== undefined ? lastP.home_wickets : 0}`;
    if (lastP.home_overs) homeOvers = `(${lastP.home_overs} ov)`;
  } else if (typeof home.score === "string" && home.score.trim()) {
    homeScore = home.score.trim();
  }

  const awayPeriods = periodScores.filter((p: any) => p.away_score !== undefined && p.away_score !== null);
  if (awayPeriods.length > 0) {
    const lastP = awayPeriods[awayPeriods.length - 1];
    awayScore = `${lastP.away_score}/${lastP.away_wickets !== undefined ? lastP.away_wickets : 0}`;
    if (lastP.away_overs) awayOvers = `(${lastP.away_overs} ov)`;
  } else if (typeof away.score === "string" && away.score.trim()) {
    awayScore = away.score.trim();
  }

  const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";
  const t1Logo = resolveHDTeamLogo(homeName, home.logo);
  const t2Logo = resolveHDTeamLogo(awayName, away.logo);

  const bData = resolveCricketBroadcastData(sportEvent, item);

  return {
    id: `cr-sportradar-${String(sportEvent.id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    rawId: sportEvent.id,
    matchId: sportEvent.id,
    sport: "cricket",
    sportName: "Cricket",
    sportIcon: "fa-baseball-bat-ball",
    title: `${homeName} vs ${awayName}`,
    name: `${homeName} vs ${awayName}`,
    seriesName: tournamentName,
    tournament: tournamentName,
    league: tournamentName,
    matchDesc: sportEvent.type || "Match",
    matchFormat,
    matchType: matchFormat,
    startTime: startTimeIso,
    endTime: endTimeIso,
    authoritativeEndTime: authoritativeEndTimeMs ? new Date(authoritativeEndTimeMs).toISOString() : null,
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
    venue: sportEvent.venue ? `${sportEvent.venue.name || ""}${sportEvent.venue.city_name ? `, ${sportEvent.venue.city_name}` : ""}`.trim() : "",
    isHot: status === "live",
    isSpecial: status === "live",
    team1: {
      teamId: home.id,
      name: homeName,
      shortName: home.abbreviation || "",
      logo: t1Logo,
      score: homeScore,
      overs: homeOvers,
    },
    team2: {
      teamId: away.id,
      name: awayName,
      shortName: away.abbreviation || "",
      logo: t2Logo,
      score: awayScore,
      overs: awayOvers,
    },
    homeTeam: {
      name: homeName,
      logo: t1Logo,
      score: homeScore,
      overs: homeOvers,
    },
    awayTeam: {
      name: awayName,
      logo: t2Logo,
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
    source: "Sportradar",
  };
}

async function fetchSportradarApi(
  endpoint: string,
  apiKey: string,
  tier = "t2"
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, status: 400, error: "Sportradar API key is missing." };
  }

  const cleanTier = sanitizeSportradarTier(tier);
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const sep = cleanEndpoint.includes("?") ? "&" : "?";
  const url = `https://api.sportradar.com/cricket-${cleanTier}/en/${cleanEndpoint}${sep}api_key=${encodeURIComponent(apiKey.trim())}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
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
        error: data?.message || data?.error || (text ? text.slice(0, 250) : res.statusText),
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 500, error: err.message || "Network error reaching Sportradar API" };
  }
}

async function getNormalizedSportradarCricketMatches(env: Env, customKey?: string, customTier?: string) {
  const activeKey = (customKey && customKey.trim()) || (env.SPORTRADAR_CRICKET_API_KEY || "").trim();
  if (!activeKey) {
    return {
      status: "missing_key",
      rateLimited: false,
      upstreamStatus: 400,
      total: 0,
      data: [],
    };
  }

  const tier = sanitizeSportradarTier(customTier, env.SPORTRADAR_CRICKET_TIER);
  const events: any[] = [];
  const seenIds = new Set<string>();

  const liveRes = await fetchSportradarApi("schedules/live/schedule.json", activeKey, tier);
  if (liveRes.status === 429) {
    return {
      status: "rate_limited",
      rateLimited: true,
      upstreamStatus: 429,
      message: liveRes.error || "Sportradar rate limit reached (HTTP 429)",
      total: 0,
      data: [],
    };
  }

  if (liveRes.ok && liveRes.data) {
    const list = Array.isArray(liveRes.data.sport_events)
      ? liveRes.data.sport_events
      : Array.isArray(liveRes.data.summaries)
      ? liveRes.data.summaries
      : [];
    for (const item of list) {
      if (item && typeof item === "object") {
        item._fromLiveSchedule = true;
      }
      const ev = normalizeSportradarEvent(item);
      if (ev && !seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        events.push(ev);
      }
    }
  }

  return {
    status: "success",
    rateLimited: false,
    upstreamStatus: liveRes.status || 200,
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
        sportradarConfigured: Boolean(env.SPORTRADAR_CRICKET_API_KEY && env.SPORTRADAR_CRICKET_API_KEY.trim()),
        rapidApiConfigured: Boolean(env.RAPIDAPI_KEY && env.RAPIDAPI_KEY.trim()),
        thesportsdbConfigured: true,
      });
    }

    // 3. Cricket Matches route (/api/cricket/matches)
    if (path === "/api/cricket/matches") {
      const result = await getNormalizedSportradarCricketMatches(env);
      if (result.status === "rate_limited" || result.rateLimited) {
        return jsonResponse({
          status: "rate_limited",
          source: "Sportradar",
          rateLimited: true,
          upstreamStatus: 429,
          message: result.message || "Sportradar rate limit reached (HTTP 429)",
          total: 0,
          data: [],
        });
      }

      if (result.status === "missing_key") {
        return jsonResponse(
          {
            status: "missing_key",
            source: "Sportradar",
            total: 0,
            data: [],
            message: "SPORTRADAR_CRICKET_API_KEY is not configured in Worker secrets.",
          },
          400
        );
      }

      return jsonResponse({
        status: "success",
        source: "Sportradar",
        rateLimited: false,
        upstreamStatus: result.upstreamStatus,
        total: result.total,
        data: result.data,
      });
    }

    // 4. Sportradar Cricket Matches route (/api/cricket/sportradar/matches)
    if (path === "/api/cricket/sportradar/matches") {
      const customKey = url.searchParams.get("api_key") || url.searchParams.get("key") || request.headers.get("x-sportradar-api-key") || undefined;
      const customTier = url.searchParams.get("tier") || request.headers.get("x-sportradar-tier") || undefined;
      const result = await getNormalizedSportradarCricketMatches(env, customKey, customTier);

      if (result.status === "rate_limited" || result.rateLimited) {
        return jsonResponse({
          status: "rate_limited",
          source: "Sportradar",
          tier: sanitizeSportradarTier(customTier, env.SPORTRADAR_CRICKET_TIER),
          rateLimited: true,
          upstreamStatus: 429,
          message: result.message || "Sportradar rate limit reached (HTTP 429)",
          total: 0,
          data: [],
        });
      }

      return jsonResponse({
        status: "success",
        source: "Sportradar",
        tier: sanitizeSportradarTier(customTier, env.SPORTRADAR_CRICKET_TIER),
        rateLimited: false,
        upstreamStatus: result.upstreamStatus,
        total: result.total,
        data: result.data,
      });
    }

    // 5. Sportradar Test route (/api/sportradar/test or /api/cricket/sportradar/test)
    if (path === "/api/sportradar/test" || path === "/api/cricket/sportradar/test") {
      const apiKey = (
        url.searchParams.get("key") ||
        url.searchParams.get("api_key") ||
        request.headers.get("x-sportradar-api-key") ||
        env.SPORTRADAR_CRICKET_API_KEY ||
        ""
      ).trim();

      const tier = sanitizeSportradarTier(
        url.searchParams.get("tier") || request.headers.get("x-sportradar-tier"),
        env.SPORTRADAR_CRICKET_TIER
      );

      if (!apiKey) {
        return jsonResponse(
          {
            valid: false,
            status: "missing_key",
            message: "Sportradar API key is required in Worker environment or request header.",
            tier,
          },
          400
        );
      }

      const start = Date.now();
      const testRes = await fetchSportradarApi("tournaments.json", apiKey, tier);
      const elapsed = Date.now() - start;

      if (testRes.ok && testRes.data) {
        const tournaments = Array.isArray(testRes.data.tournaments) ? testRes.data.tournaments : [];
        return jsonResponse({
          valid: true,
          status: "success",
          message: `Sportradar Cricket API key is VALID and working! (${tournaments.length} tournaments indexed)`,
          tier,
          latencyMs: elapsed,
          tournamentsCount: tournaments.length,
          sampleTournaments: tournaments.slice(0, 5).map((t: any) => ({
            id: t.id,
            name: t.name,
            category: t.category?.name || "Cricket",
          })),
        });
      }

      if (testRes.status === 429) {
        return jsonResponse(
          {
            valid: false,
            status: "rate_limited",
            source: "Sportradar",
            statusCode: 429,
            rateLimited: true,
            total: 0,
            data: [],
            tier,
            message: "Sportradar rate limit reached (HTTP 429).",
            error: testRes.error || "Limit Exceeded",
          },
          429
        );
      }

      return jsonResponse(
        {
          valid: false,
          status: "error",
          statusCode: testRes.status,
          tier,
          message: testRes.error || `Sportradar API error with HTTP status ${testRes.status}`,
        },
        testRes.status || 500
      );
    }

    // 6. Unknown API route
    return jsonResponse(
      {
        status: "not_found",
        message: `Endpoint ${path} not found on Cloudflare Worker backend`,
      },
      404
    );
  },
};
