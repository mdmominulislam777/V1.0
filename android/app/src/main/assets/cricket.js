/**
 * HIGHFY TV - Cricket Engine (RapidAPI Live Cricket Data)
 * Fetches real Live, Upcoming, and Finished cricket matches.
 * Compatible with GitHub Pages and Backend Server Proxy.
 */

class CricketEngine {
  constructor() {
    this.cacheKey = 'highfy_cricket_events_cache';
    this.cache = {
      timestamp: 0,
      ttl: 5 * 60 * 1000, // 5 minutes cache to strictly preserve quota
      data: []
    };
    this.detailsCache = new Map();
    this.inFlightPromise = null;
    this.loadLocalCache();
  }

  /**
   * Hydrate cricket events from localStorage with stale-while-revalidate resilience
   */
  loadLocalCache() {
    try {
      const stored = localStorage.getItem(this.cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        // Stale-while-revalidate TTL: keep up to 24 hours as fallback
        if (parsed && (now - (parsed.timestamp || 0) < 24 * 60 * 60 * 1000) && Array.isArray(parsed.data) && parsed.data.length > 0) {
          const cleanData = parsed.data
            .filter(ev => {
              if (!ev || !ev.id) return false;
              const id = String(ev.id);
              if (id.startsWith('cricket-upcoming-') || id.startsWith('cricket-live-') || id.startsWith('dummy-') || id.startsWith('mock-') || id.startsWith('cr-cricbuzz-')) {
                return false;
              }
              if (ev.source && String(ev.source).toLowerCase().includes('cricbuzz')) {
                return false;
              }
              return true;
            })
            .map(ev => {
              const evTime = ev.timestamp || 0;
              if (ev.status === 'live' && (now - evTime > 12 * 60 * 60 * 1000)) {
                return { ...ev, status: 'finished', timeOrTimer: 'FT', statusLabel: 'Finished' };
              }
              return ev;
            });
          this.cache.timestamp = parsed.timestamp || 0;
          this.cache.data = cleanData;
        }
      }
    } catch (e) {}
  }

  /**
   * Save cricket events to localStorage
   */
  saveLocalCache(data, timestamp = Date.now()) {
    try {
      this.cache.timestamp = timestamp;
      this.cache.data = data;
      localStorage.setItem(this.cacheKey, JSON.stringify({ timestamp, data }));
    } catch (e) {}
  }

  /**
   * Get active RapidAPI Key
   */
  getRapidApiKey() {
    const localKey = localStorage.getItem('highfy_rapidapi_key');
    if (localKey && localKey.trim()) return localKey.trim();
    const configKey = window.CONFIG?.RAPIDAPI_KEY;
    if (configKey && configKey.trim()) return configKey.trim();
    return '';
  }

  /**
   * Get active CricketData.org / CricAPI Key (Server-managed; never hardcode in frontend/APK)
   */
  getCricketDataKey() {
    const localKey = localStorage.getItem('highfy_cricketdata_key') || localStorage.getItem('highfy_cricapi_key');
    if (localKey && localKey.trim()) return localKey.trim();
    const configKey = window.CONFIG?.CRICKETDATA_API_KEY || window.CONFIG?.CRICAPI_KEY;
    if (configKey && configKey.trim()) return configKey.trim();
    return '';
  }

  /**
   * Status Normalization for Cricket
   */
  parseStatus(item) {
    if (!item) return { status: 'upcoming', label: 'Upcoming' };

    const statusText = (item.status || '').toLowerCase().trim();
    const matchEnded = item.matchEnded === true || item.matchEnded === 'true';
    const matchStarted = item.matchStarted === true || item.matchStarted === 'true';

    // Finished criteria
    if (matchEnded || 
        statusText.includes('won by') || 
        statusText.includes('match drawn') || 
        statusText.includes('match tied') || 
        statusText.includes('no result') || 
        statusText.includes('abandoned') ||
        statusText.includes('awarded') ||
        statusText.includes('refused to play') ||
        statusText.includes('walkover') ||
        statusText.includes('concluded') ||
        statusText.includes('completed') ||
        statusText.includes('winner') ||
        statusText.includes('lost by') ||
        statusText.includes('target reached') ||
        statusText.includes('cancelled')) {
      return { status: 'finished', label: item.status || 'Match Concluded' };
    }

    // Time-based guard: if a match was scheduled > 14 hours ago and has no live overs update, it cannot be live
    const dateStr = item.dateTimeGMT || item.date || item.startTime;
    if (dateStr) {
      const ts = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').getTime();
      if (!isNaN(ts) && (Date.now() - ts > 14 * 60 * 60 * 1000)) {
        return { status: 'finished', label: item.status || 'Match Concluded' };
      }
    }

    // Live criteria
    if (matchStarted && !matchEnded) {
      return { status: 'live', label: item.status || 'In Progress' };
    }

    // Upcoming
    return { status: 'upcoming', label: item.status || 'Scheduled' };
  }

  /**
   * Format start time (Asia/Dhaka BST)
   */
  formatMatchTime(isoString, timezone = 'Asia/Dhaka') {
    if (typeof window !== 'undefined' && window.SportsCoordinator && typeof window.SportsCoordinator.formatEventTime === 'function') {
      return window.SportsCoordinator.formatEventTime(isoString, timezone);
    }
    if (!isoString) return 'Scheduled';
    try {
      let str = String(isoString).trim();
      if (!str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) str = str.replace(' ', 'T') + 'Z';
      const date = new Date(str);
      return date.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Core API Fetcher - Exclusively via Backend Server Proxy (/api/cricket/matches)
   */
  async fetchFromApi(endpoint) {
    const apiBase = window.CONFIG?.API_BASE_URL || '';
    // 1. Primary: Query backend CricketData.org proxy endpoint (Server-side key authentication)
    try {
      const proxyRes = await fetch(`${apiBase}/api/cricket/matches`);
      if (proxyRes.ok) {
        const json = await proxyRes.json();
        if (json && json.status === 'rate_limited') {
          return {
            error: 'rate_limited',
            status: 'rate_limited',
            source: json.source || 'CricketData.org',
            total: 0,
            data: [],
            message: json.message || 'Live Cricket data blocked by CricketData rate limit (HTTP 429).'
          };
        }
        if (json && Array.isArray(json.data) && json.data.length > 0) {
          return { success: true, status: json.status || 'success', data: json.data, source: json.source || 'CricketData.org' };
        }
      }
    } catch (proxyErr) {
      console.warn('[CricketEngine] Backend CricketData proxy note:', proxyErr.message);
    }

    // 2. Secondary: /api/cricket/cricapi/matches server-side proxy (No key exposed on client)
    try {
      const cricRes = await fetch(`${apiBase}/api/cricket/cricapi/matches`);
      if (cricRes.ok) {
        const cricJson = await cricRes.json();
        if (cricJson && cricJson.status === 'rate_limited') {
          return {
            error: 'rate_limited',
            status: 'rate_limited',
            source: cricJson.source || 'CricketData.org',
            total: 0,
            data: [],
            message: cricJson.message || 'Live Cricket data blocked by CricketData rate limit (HTTP 429).'
          };
        }
        if (cricJson && Array.isArray(cricJson.data) && cricJson.data.length > 0) {
          return { success: true, status: cricJson.status || 'success', data: cricJson.data, source: cricJson.source || 'CricketData.org' };
        }
      }
    } catch (cricFallbackErr) {
      console.warn('[CricketEngine] CricketData fallback error:', cricFallbackErr.message);
    }

    return { error: 'no_matches', status: 'empty', source: 'CricketData.org', total: 0, data: [], message: 'No live cricket matches available from CricketData.org.' };
  }

  /**
   * Helper to format Cricbuzz innings score
   */
  formatCricbuzzScore(scoreObj) {
    if (!scoreObj) return { score: '', overs: '' };
    const inng1 = scoreObj.inngs1 || {};
    const inng2 = scoreObj.inngs2 || {};
    const parts = [];
    let mainOvers = '';

    if (inng1.runs !== undefined) {
      parts.push(`${inng1.runs}/${inng1.wickets !== undefined ? inng1.wickets : 0}`);
      if (inng1.overs) mainOvers = `${inng1.overs} ov`;
    }
    if (inng2.runs !== undefined) {
      parts.push(`${inng2.runs}/${inng2.wickets !== undefined ? inng2.wickets : 0}`);
      if (inng2.overs) mainOvers = `${inng2.overs} ov`;
    }

    return {
      score: parts.join(' & '),
      overs: mainOvers
    };
  }

  /**
   * Parse Cricbuzz JSON datasets from /matches/v1/{live,upcoming,recent}
   */
  parseCricbuzzDatasets(datasets) {
    const events = [];
    const seenIds = new Set();
    const curNow = Date.now();
    const timezone = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';

    for (const json of datasets) {
      if (!json) continue;
      const typeMatches = Array.isArray(json.typeMatches) ? json.typeMatches : [];
      for (const tm of typeMatches) {
        const matchTypeCategory = tm.matchType || 'Cricket';
        const seriesMatches = Array.isArray(tm.seriesMatches) ? tm.seriesMatches : [tm];
        for (const sm of seriesMatches) {
          const seriesName = sm.seriesAdWrapper?.seriesName || sm.seriesName || matchTypeCategory || 'Cricket Series';
          const matches = sm.seriesAdWrapper?.matches || sm.matches || (sm.matchInfo ? [sm] : []);

          for (const m of matches) {
            const info = m.matchInfo || m;
            const matchId = String(info.matchId || info.id || '');
            if (!matchId || seenIds.has(matchId)) continue;
            seenIds.add(matchId);

            const t1 = info.team1 || {};
            const t2 = info.team2 || {};
            const t1Name = t1.teamName || t1.name || 'Team 1';
            const t2Name = t2.teamName || t2.name || 'Team 2';

            const t1Logo = this.resolveHDLogo(
              t1Name,
              t1.imageId ? `https://static.cricbuzz.com/a/img/v1/300x300/i1/c${t1.imageId}/team.jpg` : ''
            );
            const t2Logo = this.resolveHDLogo(
              t2Name,
              t2.imageId ? `https://static.cricbuzz.com/a/img/v1/300x300/i1/c${t2.imageId}/team.jpg` : ''
            );

            let startTimestamp = parseInt(info.startDate) || curNow;
            if (startTimestamp < 10000000000) startTimestamp *= 1000;
            const endTimestamp = parseInt(info.endDate)
              ? (parseInt(info.endDate) < 10000000000 ? parseInt(info.endDate) * 1000 : parseInt(info.endDate))
              : startTimestamp + 4 * 3600 * 1000;

            const rawState = String(info.state || '').toLowerCase();
            const rawStatus = String(info.status || '').toLowerCase();

            let status = 'upcoming';
            let statusText = info.status || info.matchDesc || 'Scheduled';

            if (
              rawState.includes('complete') ||
              rawStatus.includes('won by') ||
              rawStatus.includes('won the') ||
              rawStatus.includes('tied') ||
              rawStatus.includes('no result') ||
              rawStatus.includes('abandon') ||
              rawStatus.includes('drawn') ||
              rawStatus.includes('concluded')
            ) {
              status = 'finished';
              statusText = info.status || 'Match Concluded';
            } else if (
              rawState.includes('progress') ||
              rawState.includes('live') ||
              rawState.includes('toss') ||
              rawState.includes('stump') ||
              rawState.includes('delay') ||
              rawState.includes('rain') ||
              rawState.includes('break') ||
              rawStatus.includes('opt to') ||
              rawStatus.includes('need ') ||
              rawStatus.includes('trail by') ||
              rawStatus.includes('lead by')
            ) {
              status = 'live';
              statusText = info.status || 'LIVE NOW';
            } else if (curNow >= startTimestamp && curNow <= endTimestamp) {
              status = 'live';
              statusText = info.status || 'LIVE NOW';
            } else if (curNow > endTimestamp) {
              status = 'finished';
              statusText = info.status || 'Match Concluded';
            }

            const matchScore = m.matchScore || info.matchScore || {};
            const t1Score = this.formatCricbuzzScore(matchScore.team1Score);
            const t2Score = this.formatCricbuzzScore(matchScore.team2Score);

            const matchTimeStr = this.formatMatchTime(new Date(startTimestamp).toISOString(), timezone);

            const sNameLower = seriesName.toLowerCase();
            const t1Lower = t1Name.toLowerCase();
            const t2Lower = t2Name.toLowerCase();

            const isHot =
              status === 'live' ||
              sNameLower.includes('tour of') ||
              sNameLower.includes('tri-series') ||
              sNameLower.includes('world cup') ||
              sNameLower.includes('asia cup') ||
              sNameLower.includes('ipl') ||
              sNameLower.includes('bpl') ||
              sNameLower.includes('psl') ||
              sNameLower.includes('cpl') ||
              sNameLower.includes('hundred') ||
              sNameLower.includes('trophy') ||
              sNameLower.includes('india') ||
              sNameLower.includes('bangladesh') ||
              sNameLower.includes('pakistan') ||
              sNameLower.includes('australia') ||
              sNameLower.includes('england') ||
              sNameLower.includes('south africa') ||
              sNameLower.includes('sri lanka') ||
              sNameLower.includes('new zealand') ||
              sNameLower.includes('west indies') ||
              sNameLower.includes('afghanistan') ||
              t1Lower.includes('bangladesh') ||
              t2Lower.includes('bangladesh') ||
              t1Lower.includes('india') ||
              t2Lower.includes('india');

            let finalFormat = info.matchFormat || 'Cricket';
            if (sNameLower.includes('t20') || sNameLower.includes('blast') || sNameLower.includes('premier league')) {
              finalFormat = 'T20';
            } else if (sNameLower.includes('odi') || sNameLower.includes('one day')) {
              finalFormat = 'ODI';
            } else if (sNameLower.includes('test')) {
              finalFormat = 'Test';
            } else if (sNameLower.includes('hundred')) {
              finalFormat = 'Hundred';
            }

            const venueName = `${info.venueInfo?.ground || ''}${info.venueInfo?.city ? `, ${info.venueInfo.city}` : ''}`;

            events.push({
              id: `cr-cricbuzz-${matchId}`,
              matchId: matchId,
              seriesId: info.seriesId,
              sport: 'cricket',
              sportName: 'Cricket',
              sportIcon: 'fa-baseball-bat-ball',
              title: `${t1Name} vs ${t2Name}`,
              name: `${t1Name} vs ${t2Name}`,
              seriesName: seriesName,
              tournament: seriesName,
              league: seriesName,
              matchDesc: info.matchDesc || 'Match',
              matchFormat: finalFormat,
              matchType: finalFormat,
              status: status,
              statusText: statusText,
              statusLabel: status === 'live' ? 'LIVE' : (status === 'finished' ? 'FT' : 'Upcoming'),
              timestamp: startTimestamp,
              date: new Intl.DateTimeFormat('en-CA', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date(startTimestamp)),
              matchTime: matchTimeStr,
              timeOrTimer: status === 'live' ? 'LIVE' : (status === 'finished' ? 'FT' : matchTimeStr),
              venue: venueName,
              isHot: isHot,
              isSpecial: isHot,
              team1: {
                teamId: t1.teamId || t1.id,
                name: t1Name,
                shortName: t1.teamSName || '',
                logo: t1Logo,
                score: t1Score.score,
                overs: t1Score.overs,
              },
              team2: {
                teamId: t2.teamId || t2.id,
                name: t2Name,
                shortName: t2.teamSName || '',
                logo: t2Logo,
                score: t2Score.score,
                overs: t2Score.overs,
              },
              homeTeam: {
                name: t1Name,
                logo: t1Logo,
                score: t1Score.score,
                overs: t1Score.overs,
              },
              awayTeam: {
                name: t2Name,
                logo: t2Logo,
                score: t2Score.score,
                overs: t2Score.overs,
              },
              broadcaster: (info.broadcaster || info.tvStation || info.broadcastInfo || info.channelId || null),
              broadcasters: (info.broadcaster || info.tvStation || info.broadcastInfo || info.channelId ? [info.broadcaster || info.tvStation || info.broadcastInfo || info.channelId] : []),
              subText: `${finalFormat} • ${venueName || seriesName}`,
              source: 'Cricbuzz RapidAPI',
              streams: [],
            });
          }
        }
      }
    }
    return events;
  }

  /**
   * Direct fetch from Cricbuzz RapidAPI with multi-tier fallback (Direct -> CORS Proxies -> TheSportsDB)
   */
  async fetchDirectCricbuzzMatches(rapidKey) {
    // Cricbuzz API permanently disabled per user request
    return { success: false, data: [], message: 'Cricbuzz API disabled per user request' };
    const endpoints = ['live', 'upcoming', 'recent'];

    const fetchEndpoint = async (ep) => {
      const targetUrl = `https://${host}/matches/v1/${ep}`;
      const headers = {
        'x-rapidapi-key': key,
        'x-rapidapi-host': host
      };

      // Tier 1: Direct browser fetch to RapidAPI (Fastest, works on GitHub Pages & Android WebView)
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
        const res = await fetch(targetUrl, { headers, signal: controller?.signal });
        if (timer) clearTimeout(timer);
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.warn(`[CricketEngine] Direct fetch for ${ep} failed:`, err.message);
      }

      // Tier 2: Public CORS Proxy fallback (for restricted networks / adblockers)
      const corsProxies = [
        `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
      ];

      for (const proxyUrl of corsProxies) {
        try {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
          const pRes = await fetch(proxyUrl, { headers, signal: controller?.signal });
          if (timer) clearTimeout(timer);
          if (pRes.ok) {
            return await pRes.json();
          }
        } catch (e) {}
      }

      return null;
    };

    try {
      const results = await Promise.allSettled(endpoints.map(ep => fetchEndpoint(ep)));
      const datasets = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

      if (datasets.length > 0) {
        const parsedMatches = this.parseCricbuzzDatasets(datasets);
        if (parsedMatches.length > 0) {
          console.log(`[CricketEngine] Successfully extracted ${parsedMatches.length} Cricbuzz matches on client!`);
          return { success: true, data: parsedMatches, source: 'Cricbuzz RapidAPI' };
        }
      }
    } catch (e) {
      console.warn('[CricketEngine] Direct Cricbuzz error:', e);
    }

    // Tier 3: TheSportsDB Cricket endpoint fallback
    try {
      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: window.CONFIG?.TIMEZONE || 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const tsdbRes = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${todayStr}&s=Cricket`);
      if (tsdbRes.ok) {
        const tsdbJson = await tsdbRes.json();
        if (tsdbJson && Array.isArray(tsdbJson.events) && tsdbJson.events.length > 0) {
          const tsdbMatches = tsdbJson.events.map(ev => ({
            id: `cr-tsdb-${ev.idEvent}`,
            matchId: ev.idEvent,
            sport: 'cricket',
            sportName: 'Cricket',
            sportIcon: 'fa-baseball-bat-ball',
            title: ev.strEvent || `${ev.strHomeTeam} vs ${ev.strAwayTeam}`,
            name: ev.strEvent || `${ev.strHomeTeam} vs ${ev.strAwayTeam}`,
            league: ev.strLeague || 'Cricket',
            status: (ev.strStatus === 'Match Finished' || ev.strStatus === 'FT') ? 'finished' : (ev.strStatus?.toLowerCase().includes('live') ? 'live' : 'upcoming'),
            statusText: ev.strStatus || 'Scheduled',
            team1: { name: ev.strHomeTeam || 'Team 1', logo: ev.strThumb || '', score: ev.intHomeScore || '' },
            team2: { name: ev.strAwayTeam || 'Team 2', logo: ev.strThumb || '', score: ev.intAwayScore || '' },
            homeTeam: { name: ev.strHomeTeam || 'Team 1', logo: ev.strThumb || '', score: ev.intHomeScore || '' },
            awayTeam: { name: ev.strAwayTeam || 'Team 2', logo: ev.strThumb || '', score: ev.intAwayScore || '' },
            broadcaster: ev.strTVStation || null,
            source: 'TheSportsDB',
            streams: []
          }));
          return { success: true, data: tsdbMatches, source: 'TheSportsDB' };
        }
      }
    } catch (tsdbErr) {}

    return { error: 'no_matches', message: 'No live cricket matches at this time.' };
  }

  /**
   * Helper to resolve high-definition logos for cricket teams
   */
  resolveHDLogo(teamName, rawLogo) {
    if (typeof window !== 'undefined' && typeof window.getHighResTeamLogo === 'function') {
      return window.getHighResTeamLogo(teamName, rawLogo);
    }
    // 1. HIGHEST PRIORITY: If authentic original team logo is provided by feed/API, preserve and upgrade it!
    if (rawLogo && typeof rawLogo === 'string') {
      let clean = rawLogo.trim();
      if (clean && !clean.includes('un.png') && !clean.includes('placeholder') && !clean.includes('default-team')) {
        if (clean.includes('/72x54/')) clean = clean.replace('/72x54/', '/300x300/');
        if (clean.includes('/w160/')) clean = clean.replace('/w160/', '/w320/');
        if (clean.startsWith('http://static.cricbuzz.com')) clean = clean.replace('http://', 'https://');
        return clean;
      }
    }

    if (!teamName) return './assets/team-placeholder.svg';
    const tLower = teamName.toLowerCase().trim();
    const map = {
      'india': 'https://flagcdn.com/w320/in.png',
      'bangladesh': 'https://flagcdn.com/w320/bd.png',
      'pakistan': 'https://flagcdn.com/w320/pk.png',
      'england': 'https://flagcdn.com/w320/gb-eng.png',
      'australia': 'https://flagcdn.com/w320/au.png',
      'sri lanka': 'https://flagcdn.com/w320/lk.png',
      'south africa': 'https://flagcdn.com/w320/za.png',
      'new zealand': 'https://flagcdn.com/w320/nz.png',
      'west indies': 'https://static.cricbuzz.com/a/img/v1/300x300/i1/c170818/west-indies.jpg',
      'afghanistan': 'https://flagcdn.com/w320/af.png',
      'ireland': 'https://flagcdn.com/w320/ie.png',
      'scotland': 'https://flagcdn.com/w320/gb-sct.png',
      'netherlands': 'https://flagcdn.com/w320/nl.png',
      'zimbabwe': 'https://flagcdn.com/w320/zw.png',
      'hong kong': 'https://flagcdn.com/w320/hk.png',
      'oman': 'https://flagcdn.com/w320/om.png'
    };
    if (map[tLower]) return map[tLower];
    for (const [k, v] of Object.entries(map)) {
      if (k.length <= 3) {
        const regex = new RegExp(`(^|\\b|\\s)${k}(\\b|\\s|$)`, 'i');
        if (regex.test(tLower)) return v;
      } else {
        if (tLower === k || tLower.includes(k) || k.includes(tLower)) return v;
      }
    }
    return './assets/team-placeholder.svg';
  }

  /**
   * Helper to check if a string is a UUID or raw ID
   */
  isUuidString(str) {
    if (!str || typeof str !== 'string') return true;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(str.trim()) || /^[0-9a-f-]{12,}$/i.test(str.trim());
  }

  /**
   * Normalize Cricket Match Data (handles Backend Normalized Sportradar & Raw Sportradar schemas)
   */
  normalizeMatch(item) {
    if (!item) return null;

    const extractBroadcasterFields = (obj, sportEventObj) => {
      const tokens = [];
      const addVal = (v) => {
        if (!v) return;
        if (Array.isArray(v)) {
          v.forEach(addVal);
        } else if (typeof v === 'string') {
          v.split(/[,/|;+]|\band\b/i)
            .map(s => s.trim())
            .filter(s => s && !s.toLowerCase().includes('unknown') && !s.toLowerCase().includes('tbd'))
            .forEach(s => tokens.push(s));
        } else if (typeof v === 'object') {
          if (Array.isArray(v.names)) addVal(v.names);
          const candidate = v.name || v.channel_name || v.broadcaster_name || v.station || v.tv_name || v.channel || v.title || v.value || v.media?.shortName || v.media?.name || '';
          if (typeof candidate === 'string' && candidate.trim()) addVal(candidate);
        }
      };

      addVal(obj?.broadcaster);
      addVal(obj?.broadcasters);
      addVal(obj?.tv);
      addVal(obj?.broadcast);
      addVal(obj?.broadcasts);
      addVal(obj?.channel);
      addVal(obj?.channels);
      addVal(obj?.tv_channels);
      addVal(obj?.strTVStation);
      addVal(obj?.tvStation);
      if (sportEventObj && sportEventObj !== obj) {
        addVal(sportEventObj?.broadcaster);
        addVal(sportEventObj?.broadcasters);
        addVal(sportEventObj?.broadcast);
        addVal(sportEventObj?.broadcasts);
        addVal(sportEventObj?.channels);
        addVal(sportEventObj?.tv_channels);
      }

      const unique = Array.from(new Set(tokens));
      return {
        broadcaster: unique.length > 0 ? unique.slice(0, 3).join(', ') : null,
        broadcasters: unique
      };
    };

    // 1. If item is already normalized from backend CricketData proxy (/api/cricket/matches):
    const srcLower = String(item.source || '').toLowerCase();
    if (
      srcLower.includes('cricketdata') ||
      srcLower.includes('cricapi') ||
      item.source === 'Cricbuzz RapidAPI' ||
      item.source === 'RapidAPI Cricket' ||
      item.source === 'RapidAPI' ||
      (item.sport === 'cricket' && item.team1 && item.team2)
    ) {
      const statusLower = (item.status || 'upcoming').toLowerCase();
      const isLive = statusLower === 'live';
      const isFinished = statusLower === 'finished';
      const timezone = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';

      let timestamp = typeof item.timestamp === 'number' && !isNaN(item.timestamp) ? item.timestamp : null;
      if (timestamp && timestamp < 10000000000) timestamp *= 1000;
      if (!timestamp) {
        const rawDate = item.startTime || item.scheduled || item.date;
        const parsed = rawDate ? Date.parse(String(rawDate)) : NaN;
        timestamp = !isNaN(parsed) && parsed > 0 ? parsed : Date.now();
      }

      const matchTime = item.matchTime || this.formatMatchTime(new Date(timestamp).toISOString(), timezone);
      const bInfo = extractBroadcasterFields(item, item.sport_event);
      const rawIdStr = String(item.id || item.matchId || item.rawId || Date.now());
      const normalizedId = rawIdStr.startsWith('cr-cricapi-') || rawIdStr.startsWith('cr-cricketdata-')
        ? rawIdStr
        : `cr-cricapi-${rawIdStr.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      return {
        ...item,
        id: normalizedId,
        sport: 'cricket',
        sportName: 'Cricket',
        sportIcon: 'fa-baseball-bat-ball',
        timestamp,
        matchTime: matchTime,
        timeOrTimer: isLive ? 'LIVE' : (isFinished ? 'FT' : matchTime),
        status: statusLower,
        statusLabel: isLive ? 'LIVE' : (isFinished ? 'FINISHED' : 'Upcoming'),
        isHot: Boolean(item.isHot || isLive),
        broadcaster: item.broadcaster !== undefined ? item.broadcaster : bInfo.broadcaster,
        broadcasters: Array.isArray(item.broadcasters) && item.broadcasters.length > 0 ? item.broadcasters : bInfo.broadcasters,
        channelId: item.channelId || null,
        channelIds: Array.isArray(item.channelIds) ? item.channelIds : (item.channelId ? [item.channelId] : []),
        channelName: item.channelName || null,
        channelLogo: item.channelLogo || null,
        streamUrl: item.streamUrl || null,
        streams: Array.isArray(item.streams) ? item.streams : [],
        source: item.source && String(item.source).toLowerCase().includes('cricapi') ? item.source : 'CricketData.org'
      };
    }

    // 2. Handle raw Sportradar sport_event / summary payload or raw Cricket feed item
    const sportEvent = item.sport_event || item;
    const statusObj = item.sport_event_status || {};
    const rawEventId = sportEvent.id || item.id || item.matchId;
    if (!rawEventId) return null;

    const competitors = Array.isArray(sportEvent.competitors) ? sportEvent.competitors : [];
    const homeComp = competitors.find(c => c.qualifier === 'home') || competitors[0] || null;
    const awayComp = competitors.find(c => c.qualifier === 'away') || competitors[1] || null;

    const teams = item.teams || (item.teamInfo ? item.teamInfo.map(t => t.name) : []);
    const team1Name = homeComp?.name || teams[0] || item.teamInfo?.[0]?.name || 'Team 1';
    const team2Name = awayComp?.name || teams[1] || item.teamInfo?.[1]?.name || 'Team 2';

    const team1Info = item.teamInfo?.find(t => t.name === team1Name) || item.teamInfo?.[0] || {};
    const team2Info = item.teamInfo?.find(t => t.name === team2Name) || item.teamInfo?.[1] || {};

    const scores = Array.isArray(item.score) ? item.score : [];
    const periodScores = Array.isArray(statusObj.period_scores) ? statusObj.period_scores : [];

    // Extract score info for team 1 and team 2
    let team1ScoreStr = '';
    let team1OversStr = '';
    let team2ScoreStr = '';
    let team2OversStr = '';

    if (periodScores.length > 0) {
      const homePeriods = periodScores.filter(p => p.home_score !== undefined && p.home_score !== null);
      if (homePeriods.length > 0) {
        const lastP = homePeriods[homePeriods.length - 1];
        team1ScoreStr = `${lastP.home_score}/${lastP.home_wickets !== undefined ? lastP.home_wickets : 0}`;
        if (lastP.home_overs) team1OversStr = `(${lastP.home_overs} ov)`;
      }
      const awayPeriods = periodScores.filter(p => p.away_score !== undefined && p.away_score !== null);
      if (awayPeriods.length > 0) {
        const lastP = awayPeriods[awayPeriods.length - 1];
        team2ScoreStr = `${lastP.away_score}/${lastP.away_wickets !== undefined ? lastP.away_wickets : 0}`;
        if (lastP.away_overs) team2OversStr = `(${lastP.away_overs} ov)`;
      }
    } else {
      const t1ScoreObj = scores.find(s => s.inning && s.inning.toLowerCase().includes(team1Name.toLowerCase())) || scores[0];
      const t2ScoreObj = scores.find(s => s.inning && s.inning.toLowerCase().includes(team2Name.toLowerCase())) || scores[1];

      if (t1ScoreObj) {
        team1ScoreStr = `${t1ScoreObj.r || 0}/${t1ScoreObj.w !== undefined ? t1ScoreObj.w : 0}`;
        team1OversStr = t1ScoreObj.o !== undefined ? `(${t1ScoreObj.o} ov)` : '';
      }
      if (t2ScoreObj) {
        team2ScoreStr = `${t2ScoreObj.r || 0}/${t2ScoreObj.w !== undefined ? t2ScoreObj.w : 0}`;
        team2OversStr = t2ScoreObj.o !== undefined ? `(${t2ScoreObj.o} ov)` : '';
      }
    }

    const srRawStatus = String(statusObj.status || sportEvent.status || item.status || '').toLowerCase().trim();
    const srMatchStatus = String(statusObj.match_status || '').toLowerCase().trim();
    let statusParsed;
    if (srRawStatus === 'live' || srRawStatus === 'in_progress' || srRawStatus === 'started' || srMatchStatus === 'in_progress' || srMatchStatus === 'live') {
      statusParsed = { status: 'live', label: statusObj.match_status || 'LIVE' };
    } else if (srRawStatus === 'closed' || srRawStatus === 'ended' || srRawStatus === 'complete' || srRawStatus === 'completed' || srMatchStatus === 'ended' || srMatchStatus === 'completed') {
      statusParsed = { status: 'finished', label: statusObj.match_status || 'Match Concluded' };
    } else if (srRawStatus === 'not_started' || srRawStatus === 'scheduled' || srRawStatus === 'delayed' || srRawStatus === 'postponed') {
      statusParsed = { status: 'upcoming', label: statusObj.match_status || 'Scheduled' };
    } else {
      statusParsed = this.parseStatus(item);
    }

    const timezone = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    const dateStr = sportEvent.scheduled || sportEvent.start_time || item.dateTimeGMT || item.date || item.startTime;
    const matchTime = this.formatMatchTime(dateStr, timezone);
    const timestamp = dateStr ? new Date(String(dateStr).endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(String(dateStr)) ? dateStr : dateStr + 'Z').getTime() : Date.now();

    const isLive = statusParsed.status === 'live';
    const isFinished = statusParsed.status === 'finished';

    let timeOrTimer = matchTime;
    if (isLive) {
      timeOrTimer = 'LIVE';
    } else if (isFinished) {
      timeOrTimer = 'FT';
    }

    // Resolve clean human-readable series / tournament name (never display UUIDs)
    let tournamentName = '';
    if (sportEvent.tournament?.name && !this.isUuidString(sportEvent.tournament.name)) {
      tournamentName = sportEvent.tournament.name;
    } else if (sportEvent.season?.name && !this.isUuidString(sportEvent.season.name)) {
      tournamentName = sportEvent.season.name;
    } else if (item.series_name && !this.isUuidString(item.series_name)) {
      tournamentName = item.series_name;
    } else if (item.seriesName && !this.isUuidString(item.seriesName)) {
      tournamentName = item.seriesName;
    } else if (item.series && !this.isUuidString(item.series)) {
      tournamentName = item.series;
    } else if (item.name && !this.isUuidString(item.name)) {
      tournamentName = item.name;
    } else if (item.matchType) {
      tournamentName = `${item.matchType.toUpperCase()} Match`;
    } else {
      tournamentName = 'Cricket Series';
    }

    const tNameLower = tournamentName.toLowerCase();
    const rawFormatStr = String(sportEvent.type || sportEvent.tournament?.type || item.matchType || '').toLowerCase();
    let computedFormat = item.matchType || 'Cricket';
    if (tNameLower.includes('county') || tNameLower.includes('championship') || tNameLower.includes('first-class') || tNameLower.includes('first class')) {
      computedFormat = 'County';
    } else if (rawFormatStr.includes('t20') || tNameLower.includes('t20') || tNameLower.includes('blast') || tNameLower.includes('ipl') || tNameLower.includes('bpl') || tNameLower.includes('psl')) {
      computedFormat = 'T20';
    } else if (rawFormatStr.includes('odi') || tNameLower.includes('odi') || tNameLower.includes('champions trophy') || tNameLower.includes('one day') || tNameLower.includes('one-day')) {
      computedFormat = 'ODI';
    } else if (rawFormatStr.includes('test') || tNameLower.includes('test') || tNameLower.includes("president's trophy")) {
      computedFormat = 'Test';
    }

    const cleanTitle = `${team1Name} vs ${team2Name}`;
    const bInfo = extractBroadcasterFields(item, sportEvent);
    const venueStr = sportEvent.venue
      ? (typeof sportEvent.venue === 'string' ? sportEvent.venue : `${sportEvent.venue.name || ''}${sportEvent.venue.city_name ? `, ${sportEvent.venue.city_name}` : ''}`.trim())
      : (item.venue || '');

    return {
      id: `cr-cricapi-${String(rawEventId).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      rawId: rawEventId,
      matchId: rawEventId,
      sport: 'cricket',
      sportName: 'Cricket',
      sportIcon: 'fa-baseball-bat-ball',
      title: cleanTitle,
      name: cleanTitle,
      seriesName: tournamentName,
      league: tournamentName,
      tournament: tournamentName,
      matchFormat: computedFormat,
      matchType: computedFormat,
      status: statusParsed.status, // "live" | "upcoming" | "finished"
      statusLabel: isLive ? 'LIVE' : (isFinished ? 'FT' : 'Upcoming'),
      statusText: statusObj.match_status || item.status || statusParsed.label,
      startTime: dateStr,
      matchTime: matchTime,
      timestamp: isNaN(timestamp) ? Date.now() : timestamp,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isNaN(timestamp) ? Date.now() : timestamp)),
      venue: venueStr,
      isHot: isLive,

      // Common normalized standard format
      homeTeam: {
        name: team1Name,
        logo: this.resolveHDLogo(team1Name, homeComp?.logo || team1Info.img),
        score: team1ScoreStr,
        overs: team1OversStr
      },
      awayTeam: {
        name: team2Name,
        logo: this.resolveHDLogo(team2Name, awayComp?.logo || team2Info.img),
        score: team2ScoreStr,
        overs: team2OversStr
      },

      // UI View Adapters (team1 / team2)
      team1: {
        teamId: homeComp?.id,
        name: team1Name,
        shortName: homeComp?.abbreviation || '',
        logo: this.resolveHDLogo(team1Name, homeComp?.logo || team1Info.img),
        score: team1ScoreStr,
        overs: team1OversStr
      },
      team2: {
        teamId: awayComp?.id,
        name: team2Name,
        shortName: awayComp?.abbreviation || '',
        logo: this.resolveHDLogo(team2Name, awayComp?.logo || team2Info.img),
        score: team2ScoreStr,
        overs: team2OversStr
      },

      runs: '',
      wickets: '',
      overs: '',
      innings: scores,
      requiredRunRate: '',
      timeOrTimer: timeOrTimer,
      broadcaster: bInfo.broadcaster,
      broadcasters: bInfo.broadcasters,
      channelId: item.channelId || null,
      channelIds: Array.isArray(item.channelIds) ? item.channelIds : (item.channelId ? [item.channelId] : []),
      channelName: item.channelName || null,
      channelLogo: item.channelLogo || null,
      streamUrl: item.streamUrl || null,
      subText: item.channelName ? `${tournamentName} • ${item.channelName}` : tournamentName,
      scoreDetails: scores,
      streams: Array.isArray(item.streams) ? item.streams : [],
      source: 'CricketData.org'
    };
  }

  /**
   * Helper to check if a cricket match is a Special / Featured Match
   */
  isSpecialMatch(item) {
    if (!item) return false;
    const name = (item.name || '').toLowerCase();
    const series = (item.series_name || item.seriesName || item.series || '').toLowerCase();
    const matchType = (item.matchType || '').toLowerCase();
    const teams = item.teams ? item.teams.map(t => String(t).toLowerCase()) : [];

    const topTeams = [
      'bangladesh', 'india', 'pakistan', 'australia', 'england', 'south africa',
      'new zealand', 'sri lanka', 'west indies', 'afghanistan', 'ireland', 'scotland',
      'netherlands', 'zimbabwe', 'namibia', 'nepal', 'usa', 'canada', 'uae', 'oman'
    ];

    const topSeries = [
      'tour of', 'international', 'tri-series', 'world cup', 'asia cup',
      'champions trophy', 'test', 'odi', 't20i', 'continental cup',
      'ipl', 'bpl', 'psl', 'big bash', 'cpl', 'hundred', 'vitality',
      'duleep trophy', 'ranji', 'county championship', 'premier league'
    ];

    const hasTopTeam = topTeams.some(t => teams.some(tm => tm.includes(t)) || name.includes(t) || series.includes(t));
    const hasTopSeries = topSeries.some(s => series.includes(s) || name.includes(s) || matchType.includes(s));

    return hasTopTeam || hasTopSeries;
  }

  /**
   * Fetch All Cricket Matches (In-Flight Coalescing & Quota-Preserving Cache)
   */
  async getAllMatches(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && (now - this.cache.timestamp < this.cache.ttl) && this.cache.data.length > 0) {
      return {
        configured: true,
        events: this.cache.data
      };
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = (async () => {
      console.log('[CricketEngine] Querying Cricket Live Feed...');
      const res = await this.fetchFromApi(`/currentMatches?offset=0`);

      if (res.error && (!res.data || res.data.length === 0)) {
        this.inFlightPromise = null;
        if (res.error === 'rate_limited') {
          return {
            configured: false,
            status: 'rate_limited',
            source: res.source || 'CricketData.org',
            error: res.error,
            message: res.message,
            events: []
          };
        }
        if (this.cache.data && this.cache.data.length > 0) {
          return { configured: true, events: this.cache.data };
        }
        return { configured: false, status: res.status || 'empty', source: 'CricketData.org', error: res.error, message: res.message, events: [] };
      }

      const rawList = Array.isArray(res.data) ? res.data : [];
      const normalized = rawList
        .map(item => this.normalizeMatch(item))
        .filter(ev => ev !== null);

      // Tag special matches
      normalized.forEach(ev => {
        ev.isSpecial = this.isSpecialMatch({
          name: ev.title || ev.name,
          series_name: ev.tournament || ev.seriesName,
          matchType: ev.matchType || ev.matchFormat,
          teams: [ev.team1?.name, ev.team2?.name]
        });
        if (ev.isSpecial) {
          ev.isHot = true;
        }
      });

      // 14-Day Upcoming Window Bound: Keep full international tours, leagues and upcoming matches
      const curNow = Date.now();
      const fourteenDaysAhead = curNow + (14 * 24 * 60 * 60 * 1000);
      const isCricketFinished = (e) => {
        const coordFn =
          (typeof window !== 'undefined' && window.SportsCoordinator && typeof window.SportsCoordinator.isEventFinished === 'function'
            ? window.SportsCoordinator.isEventFinished.bind(window.SportsCoordinator)
            : null) ||
          (typeof window !== 'undefined' && window.sportsCoordinator && typeof window.sportsCoordinator.isEventFinished === 'function'
            ? window.sportsCoordinator.isEventFinished.bind(window.sportsCoordinator)
            : null) ||
          (typeof window !== 'undefined' && typeof window.isEventFinished === 'function' ? window.isEventFinished : null);
        if (coordFn) {
          const fin = coordFn(e);
          if (fin) {
            e.status = 'finished';
            e.statusLabel = 'FINISHED';
            e.timeOrTimer = 'FT';
          }
          return fin;
        }
        const st = (e.status || '').toLowerCase();
        if (st === 'finished' || st === 'ft' || st === 'ended' || st === 'completed') return true;
        if (e.authoritativeEndTime) {
          const authEnd = Date.parse(String(e.authoritativeEndTime));
          if (!isNaN(authEnd) && authEnd > 0 && curNow > authEnd) {
            e.status = 'finished';
            e.statusLabel = 'FINISHED';
            e.timeOrTimer = 'FT';
            return true;
          }
        }
        const txt = (String(e.statusText || '') + ' ' + String(e.matchDesc || '')).toLowerCase();
        if (/(^|\b)(won by|won the|match won|match tied|match drawn|match ended|no result|abandoned|concluded|completed|winner)(\b|$)/i.test(txt)) {
          e.status = 'finished';
          e.statusLabel = 'FINISHED';
          e.timeOrTimer = 'FT';
          return true;
        }
        if (e.timestamp) {
          const ts = e.timestamp < 10000000000 ? e.timestamp * 1000 : e.timestamp;
          const elapsed = curNow - ts;
          const fmt = String(e.matchFormat || e.matchType || '').toLowerCase();
          const tourn = String(e.tournament || e.league || e.seriesName || '').toLowerCase();
          const isTestOrFc =
            fmt.includes('test') || fmt.includes('county') || fmt.includes('first-class') || fmt.includes('first_class') ||
            tourn.includes('test') || tourn.includes('county') || tourn.includes('first-class') || tourn.includes('first class') ||
            tourn.includes("president's trophy") || tourn.includes('sheffield') || tourn.includes('ranji') || tourn.includes('ashes');
          const maxElapsed = isTestOrFc
            ? 5.5 * 24 * 3600 * 1000
            : (fmt.includes('odi') || tourn.includes('odi') || tourn.includes('one-day') || tourn.includes('one day'))
            ? 13 * 3600 * 1000
            : (fmt.includes('t20') || tourn.includes('t20'))
            ? 10 * 3600 * 1000
            : 12 * 3600 * 1000;
          if (elapsed > maxElapsed) {
            e.status = 'finished';
            e.statusLabel = 'FINISHED';
            e.timeOrTimer = 'FT';
            return true;
          }
        }
        return false;
      };

      const finishedMatches = normalized.filter(e => isCricketFinished(e));
      const liveMatches = normalized.filter(e => !isCricketFinished(e) && e.status === 'live');
      const upcomingMatches = normalized.filter(e => !isCricketFinished(e) && e.status === 'upcoming' && ((e.timestamp || curNow) <= fourteenDaysAhead || e.isSpecial));

      // Sort finished matches
      finishedMatches.sort((a, b) => {
        const spA = a.isSpecial ? 1 : 0;
        const spB = b.isSpecial ? 1 : 0;
        if (spB !== spA) return spB - spA;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
      const topFinished = finishedMatches.slice(0, 50);

      // Sort upcoming: Special first, then chronological
      upcomingMatches.sort((a, b) => {
        const spA = a.isSpecial ? 1 : 0;
        const spB = b.isSpecial ? 1 : 0;
        if (spB !== spA) return spB - spA;
        return (a.timestamp || 0) - (b.timestamp || 0);
      });

      let finalEvents = [...liveMatches, ...upcomingMatches, ...topFinished];

      if (finalEvents.length > 0) {
        this.saveLocalCache(finalEvents, Date.now());
      } else if (Array.isArray(this.cache.data) && this.cache.data.length > 0) {
        console.log(`[CricketEngine] Network returned 0 matches, serving ${this.cache.data.length} cached matches.`);
        finalEvents = this.cache.data;
      }

      this.inFlightPromise = null;
      return {
        configured: true,
        events: finalEvents
      };
    })();

    return this.inFlightPromise;
  }

  /**
   * Fetch Team Players Squad from RapidAPI
   */
  async getTeamPlayers(teamId) {
    if (!teamId) return [];
    try {
      const apiBase = window.CONFIG?.API_BASE_URL || '';
      const rapidKey = this.getRapidApiKey();
      const query = rapidKey ? `?teamid=${encodeURIComponent(teamId)}&rapidapikey=${encodeURIComponent(rapidKey)}` : `?teamid=${encodeURIComponent(teamId)}`;
      const res = await fetch(`${apiBase}/api/cricket/players${query}`, {
        headers: rapidKey ? { 'x-rapidapi-key': rapidKey } : {}
      });
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json.response) ? json.response : [];
      }
    } catch (e) {
      console.warn('[CricketEngine] Failed to fetch team players:', e);
    }
    return [];
  }

  /**
   * Fetch Cricket Teams list
   */
  async getTeams() {
    try {
      const apiBase = window.CONFIG?.API_BASE_URL || '';
      const rapidKey = this.getRapidApiKey();
      const query = rapidKey ? `?rapidapikey=${encodeURIComponent(rapidKey)}` : '';
      const res = await fetch(`${apiBase}/api/cricket/teams${query}`, {
        headers: rapidKey ? { 'x-rapidapi-key': rapidKey } : {}
      });
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json.response) ? json.response : [];
      }
    } catch (e) {
      console.warn('[CricketEngine] Failed to fetch teams:', e);
    }
    return [];
  }

  /**
   * Helper to map Team Name to RapidAPI Team ID
   */
  getTeamIdByName(name) {
    if (!name || typeof name !== 'string') return null;
    const n = name.toLowerCase().trim();
    const map = {
      'india': '2', 'ind': '2',
      'pakistan': '3', 'pak': '3',
      'australia': '4', 'aus': '4',
      'sri lanka': '5', 'sl': '5',
      'bangladesh': '6', 'ban': '6',
      'england': '9', 'eng': '9',
      'west indies': '10', 'wi': '10',
      'south africa': '11', 'sa': '11', 'rsa': '11',
      'new zealand': '13', 'nz': '13',
      'zimbabwe': '12', 'zim': '12',
      'afghanistan': '96', 'afg': '96',
      'ireland': '27', 'ire': '27',
      'scotland': '24', 'scot': '24',
      'netherlands': '23', 'ned': '23'
    };

    for (const [key, id] of Object.entries(map)) {
      if (n === key || n.includes(key)) return id;
    }
    return null;
  }

  /**
   * Fetch Detailed Scorecard & Team Squads
   */
  async getMatchDetails(matchId) {
    if (!matchId) return null;
    const cleanId = String(matchId).replace(/^cr-/, '').replace(/^rapid-/, '');

    if (this.detailsCache.has(cleanId)) {
      return this.detailsCache.get(cleanId);
    }

    let detailed = null;
    const res = await this.fetchFromApi(`/match_info?id=${cleanId}`);
    if (res.success && res.data) {
      detailed = this.normalizeMatch(res.data);
    }

    // If matching from local events list:
    if (!detailed && this.cache.data.length > 0) {
      const match = this.cache.data.find(e => e.id === matchId || e.rawId == cleanId || e.matchId == cleanId);
      if (match) detailed = { ...match };
    }

    if (detailed) {
      // Load squad players for teams if available
      const t1Id = detailed.team1?.teamId || this.getTeamIdByName(detailed.team1?.name);
      const t2Id = detailed.team2?.teamId || this.getTeamIdByName(detailed.team2?.name);

      const [p1, p2] = await Promise.all([
        t1Id ? this.getTeamPlayers(t1Id) : Promise.resolve([]),
        t2Id ? this.getTeamPlayers(t2Id) : Promise.resolve([]),
      ]);

      if (p1.length > 0) detailed.team1.players = p1;
      if (p2.length > 0) detailed.team2.players = p2;

      this.detailsCache.set(cleanId, detailed);
      return detailed;
    }

    return null;
  }

  /**
   * Test RapidAPI Cricket Key validity
   */
  async testApiKey(key, host = 'cricbuzz-cricket2.p.rapidapi.com') {
    if (!key) return { valid: false, message: 'Please enter a RapidAPI key' };
    try {
      const apiBase = window.CONFIG?.API_BASE_URL || '';
      const res = await fetch(`${apiBase}/api/cricket/test?key=${encodeURIComponent(key)}&host=${encodeURIComponent(host)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {}

    // Direct browser test for GitHub Pages / static hosting:
    try {
      const directRes = await fetch(`https://${host}/matches/v1/live`, {
        headers: {
          'x-rapidapi-key': key,
          'x-rapidapi-host': host
        }
      });
      if (directRes.ok) {
        return { valid: true, message: 'RapidAPI Cricket key is active & verified!' };
      }
      return { valid: false, message: `RapidAPI returned status HTTP ${directRes.status}` };
    } catch (e) {
      return { valid: false, message: e.message || 'Connection failed' };
    }
  }
}

window.CricketEngine = CricketEngine;
window.cricketEngine = new CricketEngine();
