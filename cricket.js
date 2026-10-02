/**
 * HIGHFY TV - Cricket Engine (RapidAPI Live Cricket Data)
 * Fetches real Live, Upcoming, and Finished cricket matches.
 * Compatible with GitHub Pages and Backend Server Proxy.
 */

class CricketEngine {
  constructor() {
    this.cacheKey = 'highfy_cricket_events_cache_v27';
    this.cache = {
      timestamp: 0,
      ttl: 60 * 1000, // 60 seconds cache for live score accuracy
      data: []
    };
    this.detailsCache = new Map();
    this.inFlightPromise = null;
    this.loadLocalCache();
  }

  /**
   * Deduplicate active (live/upcoming) cricket matches by team pair so bilateral series don't show 3 duplicate cards
   */
  deduplicateCricketSeries(list) {
    if (!Array.isArray(list)) return [];
    const seenActivePairs = new Map();
    const seenFinishedKeys = new Set();
    const activeResult = [];
    const finishedResult = [];

    const cleanTeamKey = (name) =>
      String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();

    const sanitizeEvent = (ev) => {
      if (!ev) return ev;
      const cleanOv = (ov) => String(ov || '').replace(/^\(+|\)+$/g, '').trim();
      if (ev.team1) ev.team1.overs = cleanOv(ev.team1.overs);
      if (ev.team2) ev.team2.overs = cleanOv(ev.team2.overs);
      if (ev.homeTeam) ev.homeTeam.overs = cleanOv(ev.homeTeam.overs);
      if (ev.awayTeam) ev.awayTeam.overs = cleanOv(ev.awayTeam.overs);

      // Self-heal any legacy cached limited-overs match where both innings were concatenated into team1.score
      const fmt = String(ev.matchFormat || ev.matchType || ev.tournament || '').toLowerCase();
      const isLimitedOvers = fmt.includes('odi') || fmt.includes('t20') || fmt.includes('t10') || fmt.includes('one day') || fmt.includes('hundred');
      const s1 = String(ev.team1?.score || '').trim();
      const s2 = String(ev.team2?.score || '').trim();
      if (isLimitedOvers && s1.includes(' & ') && !s2) {
        const parts = s1.split(' & ').map(p => p.trim()).filter(Boolean);
        if (parts.length === 2) {
          ev.team2.score = parts[0];
          ev.team1.score = parts[1];
          if (ev.awayTeam) ev.awayTeam.score = parts[0];
          if (ev.homeTeam) ev.homeTeam.score = parts[1];
          if (ev.team1.overs === '50 ov' || ev.team1.overs === '20 ov') {
            ev.team2.overs = ev.team1.overs;
            if (ev.awayTeam) ev.awayTeam.overs = ev.team1.overs;
            ev.team1.overs = '';
            if (ev.homeTeam) ev.homeTeam.overs = '';
          }
        }
      }
      return ev;
    };

    for (const rawEv of list) {
      if (!rawEv || !rawEv.id) continue;
      const ev = sanitizeEvent(rawEv);
      const t1 = cleanTeamKey(ev.team1?.name || ev.homeTeam?.name || '');
      const t2 = cleanTeamKey(ev.team2?.name || ev.awayTeam?.name || '');
      if (!t1 || !t2) continue;
      const pairKey = [t1, t2].sort().join('__vs__');
      const st = String(ev.status || '').toLowerCase();
      const datePart = ev.date || (ev.timestamp ? new Date(ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp).toISOString().split('T')[0] : 'nodate');

      if (st === 'finished') {
        const fKey = `${pairKey}::${datePart || ev.id}`;
        if (!seenFinishedKeys.has(fKey)) {
          seenFinishedKeys.add(fKey);
          finishedResult.push(ev);
        }
        continue;
      }

      const activeKey = `${pairKey}::${datePart}`;
      if (!seenActivePairs.has(activeKey)) {
        seenActivePairs.set(activeKey, ev);
        activeResult.push(ev);
      } else {
        const existing = seenActivePairs.get(activeKey);
        const exSt = String(existing.status || '').toLowerCase();
        const shouldReplace =
          (exSt !== 'live' && st === 'live') ||
          (exSt === 'upcoming' && st === 'upcoming' && ev.timestamp && (!existing.timestamp || ev.timestamp < existing.timestamp));
        if (shouldReplace) {
          const idx = activeResult.indexOf(existing);
          if (idx !== -1) activeResult[idx] = ev;
          seenActivePairs.set(activeKey, ev);
        }
      }
    }

    return [...activeResult, ...finishedResult];
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
              const evTs = ev.timestamp ? (ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp) : 0;
              if (evTs && (now - evTs > 24 * 60 * 60 * 1000)) {
                return false;
              }
              return true;
            })
            .map(ev => {
              const evTime = ev.timestamp ? (ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp) : 0;
              if (ev.status === 'live' && evTime && (now - evTime > 8.5 * 60 * 60 * 1000)) {
                return { ...ev, status: 'finished', timeOrTimer: 'FT', statusLabel: 'Finished' };
              }
              return ev;
            });
          this.cache.timestamp = parsed.timestamp || 0;
          this.cache.data = this.deduplicateCricketSeries(cleanData);
        }
      }
    } catch (e) {}

    if ((!this.cache.data || this.cache.data.length === 0) && typeof window !== 'undefined' && Array.isArray(window.EVENTS_DATA) && window.EVENTS_DATA.length > 0) {
      try {
        const now = Date.now();
        const seeded = window.EVENTS_DATA.filter(ev => {
          if (!ev || String(ev.sport || '').toLowerCase() !== 'cricket') return false;
          const evTs = ev.timestamp ? (ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp) : 0;
          return !evTs || (now - evTs <= 24 * 60 * 60 * 1000);
        });
        if (seeded.length > 0) {
          this.cache.data = this.deduplicateCricketSeries(seeded);
          this.cache.timestamp = Date.now() - 30000;
        }
      } catch (_) {}
    }
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
   * CricketData.org / CricAPI Key is strictly managed server-side via Cloudflare Worker secret CRICKETDATA_API_KEY
   * and proxied through /api/cricket/matches. Never stored or exposed in frontend/APK.
   */
  getCricketDataKey() {
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
        statusText.includes('stumps') ||
        statusText.includes('cancelled')) {
      return { status: 'finished', label: item.status || 'Match Concluded' };
    }

    // Time-based guard: if a match was scheduled > 8.5 hours ago, it cannot remain live
    const dateStr = item.dateTimeGMT || item.date || item.startTime;
    if (dateStr) {
      const ts = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').getTime();
      if (!isNaN(ts) && (Date.now() - ts > 8.5 * 60 * 60 * 1000)) {
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

    // 3. Direct Client-Side Multi-Day ESPN Cricket Scoreboard Fallback (for standalone Android APK / static hosting parity)
    try {
      const timezone = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
      const espnDates = [];
      for (let dOffset = 0; dOffset <= 2; dOffset++) {
        const dt = new Date(Date.now() + dOffset * 24 * 3600 * 1000);
        const dStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(dt).replace(/-/g, '');
        if (!espnDates.includes(dStr)) espnDates.push(dStr);
      }

      const espnResponses = await Promise.all(
        espnDates.map(d =>
          fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates=${d}`)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      );

      const espnMatches = [];
      const seenEspnIds = new Set();
      for (const espnJson of espnResponses) {
        const leagues = espnJson?.sports?.[0]?.leagues || [];
        for (const lg of leagues) {
          const leagueName = String(lg?.name || 'Cricket Series').trim();
          for (const evItem of lg?.events || []) {
            if (!evItem || !evItem.id || seenEspnIds.has(String(evItem.id))) continue;
            const comps = Array.isArray(evItem.competitors) ? evItem.competitors : [];
            const homeComp = comps.find(c => c.homeAway === 'home') || comps[0];
            const awayComp = comps.find(c => c.homeAway === 'away') || comps[1];
            const homeName = String(homeComp?.displayName || homeComp?.name || '').trim();
            const awayName = String(awayComp?.displayName || awayComp?.name || '').trim();
            if (!homeName || !awayName || /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(homeName) || /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(awayName)) {
              continue;
            }

            const rawStartStr = evItem.date || null;
            const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
            const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
            const timestamp = hasValidStart ? parsedStartMs : null;
            const elapsedMs = hasValidStart ? Date.now() - parsedStartMs : 0;
            if (hasValidStart && elapsedMs > 24 * 3600 * 1000) continue;

            const stateStr = String(evItem.status || evItem.fullStatus?.type?.state || 'pre').toLowerCase();
            const shortSumStr = String(evItem.summary || '').trim();
            const summaryStr = String(evItem.fullStatus?.longSummary || shortSumStr || 'Scheduled').trim();

            const splitEspnScore = (rawSc) => {
              const s = String(rawSc || '').trim();
              if (!s) return { score: '', overs: '' };
              const m = s.match(/^(.*?)\s*\(\s*([\d./]+)\s*(?:ov|overs)?\s*\)\s*$/i);
              if (m) return { score: m[1].trim(), overs: `${m[2]} ov` };
              return { score: s, overs: '' };
            };
            const parsedHomeSc = splitEspnScore(homeComp?.score);
            const parsedAwaySc = splitEspnScore(awayComp?.score);
            const homeScore = parsedHomeSc.score;
            const homeOvers = parsedHomeSc.overs;
            const awayScore = parsedAwaySc.score;
            const awayOvers = parsedAwaySc.overs;

            const isFutureUnstarted = hasValidStart && parsedStartMs > Date.now();
            const fullDescStr = String(evItem.fullStatus?.type?.description || '').trim();
            const rawLongSummary = String(evItem.fullStatus?.longSummary || '').trim();
            const hasActivePlaySignal = Boolean(
              homeScore || awayScore || (rawLongSummary && !/^(live|scheduled|match scheduled.*)$/i.test(rawLongSummary))
            );
            const isOverDurationOrStumps =
              (hasValidStart && elapsedMs > 8.5 * 3600 * 1000) ||
              /\bstumps\b/i.test(`${fullDescStr} ${shortSumStr} ${summaryStr}`);

            let status = 'upcoming';
            if (
              stateStr === 'post' ||
              isOverDurationOrStumps ||
              /(won by|won the match|drawn|tied|no result|abandoned|concluded|completed)/i.test(summaryStr)
            ) {
              status = 'finished';
            } else if (stateStr === 'in' && !isFutureUnstarted && hasActivePlaySignal) {
              status = 'live';
            } else if (!isFutureUnstarted && elapsedMs > 45 * 60 * 1000 && !hasActivePlaySignal) {
              continue;
            }

            const eventType = String(evItem.eventType || evItem.class?.eventType || evItem.class?.generalClassCard || 'ODI').toUpperCase();
            const matchDesc = String(evItem.title || evItem.eventType || eventType).trim();
            const venue = String(evItem.location || '').trim();
            const homeLogo = this.resolveHDLogo(homeName, homeComp?.logo || '');
            const awayLogo = this.resolveHDLogo(awayName, awayComp?.logo || '');
            const dhakaDate = hasValidStart
              ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(parsedStartMs))
              : '';
            const matchTimeStr = hasValidStart ? this.formatMatchTime(new Date(parsedStartMs).toISOString(), timezone) : 'Scheduled';

            seenEspnIds.add(String(evItem.id));
            espnMatches.push({
              id: `cr-cricapi-espn_${evItem.id}`,
              rawId: String(evItem.id),
              matchId: String(evItem.id),
              sport: 'cricket',
              sportName: 'Cricket',
              sportIcon: 'fa-baseball-bat-ball',
              title: `${homeName} vs ${awayName}`,
              name: `${homeName} vs ${awayName}`,
              seriesName: leagueName,
              tournament: leagueName,
              league: leagueName,
              matchDesc,
              matchFormat: eventType,
              matchType: eventType,
              startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
              status,
              statusText: summaryStr,
              statusLabel: status === 'live' ? 'LIVE' : status === 'finished' ? 'FT' : 'Upcoming',
              timestamp,
              date: dhakaDate,
              matchTime: matchTimeStr,
              timeOrTimer: status === 'live' ? 'LIVE' : status === 'finished' ? 'FT' : matchTimeStr,
              venue,
              isHot: status === 'live',
              isSpecial: status === 'live',
              team1: {
                teamId: homeComp?.abbreviation || homeName,
                name: homeName,
                shortName: homeComp?.abbreviation || '',
                logo: homeLogo,
                score: homeScore,
                overs: homeOvers
              },
              team2: {
                teamId: awayComp?.abbreviation || awayName,
                name: awayName,
                shortName: awayComp?.abbreviation || '',
                logo: awayLogo,
                score: awayScore,
                overs: awayOvers
              },
              homeTeam: { name: homeName, logo: homeLogo, score: homeScore, overs: homeOvers },
              awayTeam: { name: awayName, logo: awayLogo, score: awayScore, overs: awayOvers },
              broadcaster: evItem.broadcast || null,
              broadcasters: evItem.broadcast ? [evItem.broadcast] : [],
              subText: [leagueName, matchDesc, venue].filter(Boolean).join(' • '),
              source: 'ESPN-Fallback',
              streams: []
            });
          }
        }
      }

      if (espnMatches.length > 0) {
        return { success: true, status: 'success', data: espnMatches, source: 'ESPN-Fallback' };
      }
    } catch (espnErr) {
      console.warn('[CricketEngine] Direct ESPN fallback error:', espnErr.message);
    }

    // 4. Offline Bundled Seed Fallback (window.EVENTS_DATA)
    if (typeof window !== 'undefined' && Array.isArray(window.EVENTS_DATA) && window.EVENTS_DATA.length > 0) {
      const now = Date.now();
      const bundledCricket = window.EVENTS_DATA.filter(e => {
        if (!e || String(e.sport || '').toLowerCase() !== 'cricket') return false;
        const ts = e.timestamp ? (e.timestamp < 10000000000 ? e.timestamp * 1000 : e.timestamp) : 0;
        return !ts || (now - ts <= 24 * 3600 * 1000);
      });
      if (bundledCricket.length > 0) {
        return { success: true, status: 'success', data: bundledCricket, source: 'Bundled Seed' };
      }
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

    // Tier 4: ESPN Cricket Scoreboard fallback (Always live and free)
    try {
      const espnRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/cricket/scoreboard');
      if (espnRes.ok) {
        const espnJson = await espnRes.json();
        const events = Array.isArray(espnJson.events) ? espnJson.events : [];
        if (events.length > 0) {
          const espnMatches = [];
          for (const ev of events) {
            const comp = ev.competitions && ev.competitions[0];
            if (!comp) continue;
            const competitors = comp.competitors || [];
            const t1 = competitors[0] || {};
            const t2 = competitors[1] || {};
            const title = `${t1.team?.displayName || 'Team 1'} vs ${t2.team?.displayName || 'Team 2'}`;
            const state = ev.status?.type?.state || 'pre';
            const status = state === 'in' ? 'live' : (state === 'post' ? 'finished' : 'upcoming');
            espnMatches.push({
              id: `cr-espn-${ev.id}`,
              matchId: ev.id,
              sport: 'cricket',
              sportName: 'Cricket',
              sportIcon: 'fa-baseball-bat-ball',
              title,
              name: title,
              league: comp.notes?.[0]?.headline || ev.season?.name || 'International Cricket',
              status,
              statusText: ev.status?.type?.shortDetail || (status === 'live' ? 'LIVE' : 'Scheduled'),
              team1: { name: t1.team?.displayName || 'Team 1', logo: t1.team?.logo || '', score: t1.score || '' },
              team2: { name: t2.team?.displayName || 'Team 2', logo: t2.team?.logo || '', score: t2.score || '' },
              homeTeam: { name: t1.team?.displayName || 'Team 1', logo: t1.team?.logo || '', score: t1.score || '' },
              awayTeam: { name: t2.team?.displayName || 'Team 2', logo: t2.team?.logo || '', score: t2.score || '' },
              broadcaster: comp.broadcasts?.[0]?.names?.[0] || null,
              source: 'ESPN-Fallback',
              streams: []
            });
          }
          if (espnMatches.length > 0) {
            return { success: true, data: espnMatches, source: 'ESPN-Fallback' };
          }
        }
      }
    } catch (_) {}

    // Tier 5: Bundled window.EVENTS_DATA Cricket Matches
    if (typeof window !== 'undefined' && Array.isArray(window.EVENTS_DATA) && window.EVENTS_DATA.length > 0) {
      const bundledCricket = window.EVENTS_DATA.filter(e => e && String(e.sport || '').toLowerCase() === 'cricket');
      if (bundledCricket.length > 0) {
        return { success: true, data: bundledCricket, source: 'Bundled Seed' };
      }
    }

    return { error: 'no_matches', message: 'No live cricket matches at this time.' };
  }

  /**
   * Helper to resolve high-definition logos for cricket teams
   */
  resolveHDLogo(teamName, rawLogo) {
    if (typeof window !== 'undefined' && typeof window.getHighResTeamLogo === 'function') {
      return window.getHighResTeamLogo(teamName, rawLogo);
    }
    let cleanRaw = '';
    if (rawLogo && typeof rawLogo === 'string') {
      cleanRaw = rawLogo.trim();
      if (
        cleanRaw.includes('un.png') ||
        cleanRaw.includes('placeholder') ||
        cleanRaw.includes('default-team') ||
        cleanRaw.includes('ui-avatars.com')
      ) {
        cleanRaw = '';
      }
    }

    if (
      cleanRaw &&
      (cleanRaw.includes('thesportsdb.com') ||
        cleanRaw.includes('flagcdn.com') ||
        cleanRaw.includes('wikimedia.org') ||
        cleanRaw.includes('cricbuzz.com'))
    ) {
      if (cleanRaw.includes('/72x54/')) cleanRaw = cleanRaw.replace('/72x54/', '/300x300/');
      if (cleanRaw.includes('/w160/')) cleanRaw = cleanRaw.replace('/w160/', '/w320/');
      if (cleanRaw.startsWith('http://static.cricbuzz.com')) cleanRaw = cleanRaw.replace('http://', 'https://');
      return cleanRaw;
    }

    if (teamName) {
      const tLower = String(teamName)
        .toLowerCase()
        .replace(/\b(women|emerging|under-19|u19|a team|xi)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const map = {
        'india': 'https://r2.thesportsdb.com/images/media/team/badge/donl7g1646775159.png',
        'bangladesh': 'https://r2.thesportsdb.com/images/media/team/badge/j74o4t1646775146.png',
        'pakistan': 'https://r2.thesportsdb.com/images/media/team/badge/03o8241646775177.png',
        'england': 'https://r2.thesportsdb.com/images/media/team/badge/y5wcl81646775152.png',
        'australia': 'https://r2.thesportsdb.com/images/media/team/badge/zvm8581646775132.png',
        'sri lanka': 'https://r2.thesportsdb.com/images/media/team/badge/i5fqg01646775193.png',
        'south africa': 'https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png',
        'new zealand': 'https://r2.thesportsdb.com/images/media/team/badge/1yyh9s1646775166.png',
        'west indies': 'https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png',
        'afghanistan': 'https://r2.thesportsdb.com/images/media/team/badge/bzu3v71646775261.png',
        'ireland': 'https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png',
        'scotland': 'https://r2.thesportsdb.com/images/media/team/badge/78woeh1646775360.png',
        'netherlands': 'https://r2.thesportsdb.com/images/media/team/badge/um67l21779090256.png',
        'zimbabwe': 'https://r2.thesportsdb.com/images/media/team/badge/7ah0831646775278.png',
        'hong kong': 'https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png',
        'oman': 'https://r2.thesportsdb.com/images/media/team/badge/5ybzn71625862595.png',
        'namibia': 'https://r2.thesportsdb.com/images/media/team/badge/myxq3q1583580470.png',
        'nepal': 'https://r2.thesportsdb.com/images/media/team/badge/bn5wrv1646775335.png',
        'uae': 'https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png',
        'united arab emirates': 'https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png',
        'usa': 'https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png',
        'united states': 'https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png',
        'canada': 'https://r2.thesportsdb.com/images/media/team/badge/o49xhy1645907007.png',
        'papua new guinea': 'https://r2.thesportsdb.com/images/media/team/badge/swdkjm1646775345.png',
        'uganda': 'https://r2.thesportsdb.com/images/media/team/badge/155jix1625862051.png',
        'kenya': 'https://r2.thesportsdb.com/images/media/team/badge/oym2v91646775312.png',
        'kuwait': 'https://flagcdn.com/w320/kw.png',
        'bahamas': 'https://flagcdn.com/w320/bs.png',
        'cayman islands': 'https://flagcdn.com/w320/ky.png',
        'argentina': 'https://flagcdn.com/w320/ar.png',
        'mexico': 'https://flagcdn.com/w320/mx.png',
        'japan': 'https://flagcdn.com/w320/jp.png',
        'switzerland': 'https://flagcdn.com/w320/ch.png',
        'belgium': 'https://flagcdn.com/w320/be.png',
        'luxembourg': 'https://flagcdn.com/w320/lu.png',
        'china': 'https://flagcdn.com/w320/cn.png'
      };
      if (map[tLower]) return map[tLower];
      const sortedEntries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
      for (const [k, v] of sortedEntries) {
        if (k.length <= 4) {
          const regex = new RegExp(`(^|\\b|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|\\s|$)`, 'i');
          if (regex.test(tLower)) return v;
        } else if (tLower === k || tLower.includes(k)) {
          return v;
        }
      }
    }

    if (cleanRaw) {
      if (cleanRaw.includes('cricapi.com') || cleanRaw.includes('cdorgapi.b-cdn.net')) {
        cleanRaw = cleanRaw.replace(/([?&])w=\d+/i, '$1w=250');
      }
      return cleanRaw;
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
   * Normalize Cricket Match Data (handles Backend Normalized CricketData & CricAPI schemas)
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

      const t1Name = item.team1?.name || item.homeTeam?.name || 'Team 1';
      const t2Name = item.team2?.name || item.awayTeam?.name || 'Team 2';
      const t1ResolvedLogo = this.resolveHDLogo(t1Name, item.team1?.logo || item.homeTeam?.logo || item.t1img);
      const t2ResolvedLogo = this.resolveHDLogo(t2Name, item.team2?.logo || item.awayTeam?.logo || item.t2img);
      const cleanOvers = (ov) => String(ov || '').replace(/^\(+|\)+$/g, '').trim();
      const t1Ov = cleanOvers(item.team1?.overs || item.homeTeam?.overs || '');
      const t2Ov = cleanOvers(item.team2?.overs || item.awayTeam?.overs || '');

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
        team1: item.team1 ? { ...item.team1, logo: t1ResolvedLogo, overs: t1Ov } : { name: t1Name, logo: t1ResolvedLogo, score: '', overs: t1Ov },
        team2: item.team2 ? { ...item.team2, logo: t2ResolvedLogo, overs: t2Ov } : { name: t2Name, logo: t2ResolvedLogo, score: '', overs: t2Ov },
        homeTeam: item.homeTeam ? { ...item.homeTeam, logo: t1ResolvedLogo, overs: t1Ov } : { name: t1Name, logo: t1ResolvedLogo, score: item.team1?.score || '', overs: t1Ov },
        awayTeam: item.awayTeam ? { ...item.awayTeam, logo: t2ResolvedLogo, overs: t2Ov } : { name: t2Name, logo: t2ResolvedLogo, score: item.team2?.score || '', overs: t2Ov },
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

    // 2. Handle raw Cricket feed / CricAPI / CricketData payload item
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

    const teamInfoArr = Array.isArray(item.teamInfo) ? item.teamInfo : [];
    const findTeamInfo = (targetName, fallbackIdx) => {
      const targetLower = String(targetName || '').toLowerCase().trim();
      const exact = teamInfoArr.find(
        t => (t.name && String(t.name).toLowerCase().trim() === targetLower) ||
             (t.shortname && String(t.shortname).toLowerCase().trim() === targetLower)
      );
      if (exact) return exact;
      const partial = teamInfoArr.find(
        t => t.name && (String(t.name).toLowerCase().includes(targetLower) || targetLower.includes(String(t.name).toLowerCase()))
      );
      if (partial) return partial;
      if (teamInfoArr.length === 2 && teamInfoArr[fallbackIdx]) return teamInfoArr[fallbackIdx];
      return {};
    };
    const team1Info = findTeamInfo(team1Name, 0);
    const team2Info = findTeamInfo(team2Name, 1);

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
        if (lastP.home_overs) team1OversStr = `${lastP.home_overs} ov`;
      }
      const awayPeriods = periodScores.filter(p => p.away_score !== undefined && p.away_score !== null);
      if (awayPeriods.length > 0) {
        const lastP = awayPeriods[awayPeriods.length - 1];
        team2ScoreStr = `${lastP.away_score}/${lastP.away_wickets !== undefined ? lastP.away_wickets : 0}`;
        if (lastP.away_overs) team2OversStr = `${lastP.away_overs} ov`;
      }
    } else if (scores.length > 0) {
      const t1Norm = team1Name.toLowerCase().trim();
      const t2Norm = team2Name.toLowerCase().trim();
      for (let idx = 0; idx < scores.length; idx++) {
        const sc = scores[idx];
        const inngTeam = String(sc.inning || '')
          .toLowerCase()
          .replace(/\b(inning|innings|1st|2nd|3rd|4th|\d+)\b/g, ' ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const formatted = `${sc.r !== undefined ? sc.r : 0}/${sc.w !== undefined ? sc.w : 0}`;
        const formattedOvers = sc.o !== undefined && sc.o !== null && sc.o !== '' ? `${sc.o} ov` : '';
        const matchesT1 = Boolean(inngTeam) && (inngTeam === t1Norm || (inngTeam.includes(t1Norm) && !inngTeam.includes(t2Norm)) || (t1Norm.includes(inngTeam) && !t2Norm.includes(inngTeam)));
        const matchesT2 = Boolean(inngTeam) && (inngTeam === t2Norm || (inngTeam.includes(t2Norm) && !inngTeam.includes(t1Norm)) || (t2Norm.includes(inngTeam) && !t1Norm.includes(inngTeam)));
        const isT1 = matchesT1 ? true : matchesT2 ? false : idx % 2 === 0;
        if (isT1) {
          team1ScoreStr = team1ScoreStr ? `${team1ScoreStr} & ${formatted}` : formatted;
          if (formattedOvers) team1OversStr = formattedOvers;
        } else {
          team2ScoreStr = team2ScoreStr ? `${team2ScoreStr} & ${formatted}` : formatted;
          if (formattedOvers) team2OversStr = formattedOvers;
        }
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
        logo: this.resolveHDLogo(team1Name, homeComp?.logo || team1Info.img || item.t1img),
        score: team1ScoreStr,
        overs: team1OversStr
      },
      awayTeam: {
        name: team2Name,
        logo: this.resolveHDLogo(team2Name, awayComp?.logo || team2Info.img || item.t2img),
        score: team2ScoreStr,
        overs: team2OversStr
      },

      // UI View Adapters (team1 / team2)
      team1: {
        teamId: homeComp?.id,
        name: team1Name,
        shortName: homeComp?.abbreviation || team1Info.shortname || '',
        logo: this.resolveHDLogo(team1Name, homeComp?.logo || team1Info.img || item.t1img),
        score: team1ScoreStr,
        overs: team1OversStr
      },
      team2: {
        teamId: awayComp?.id,
        name: team2Name,
        shortName: awayComp?.abbreviation || team2Info.shortname || '',
        logo: this.resolveHDLogo(team2Name, awayComp?.logo || team2Info.img || item.t2img),
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
      try {
        console.log('[CricketEngine] Querying Cricket Live Feed...');
        const res = await this.fetchFromApi(`/currentMatches?offset=0`);

        if (res.error && (!res.data || res.data.length === 0)) {
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
          if (/(^|\b)(won by|won the|match won|match tied|match drawn|match ended|no result|abandoned|concluded|completed|winner|stumps)(\b|$)/i.test(txt)) {
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
            const maxElapsed = (fmt.includes('t20') || tourn.includes('t20') || fmt.includes('t10'))
              ? 4.5 * 3600 * 1000
              : 8.5 * 3600 * 1000;
            if (elapsed > maxElapsed) {
              e.status = 'finished';
              e.statusLabel = 'FINISHED';
              e.timeOrTimer = 'FT';
              return true;
            }
          }
          return false;
        };

        const isRecent24h = (e) => {
          if (!e.timestamp) return true;
          const ts = e.timestamp < 10000000000 ? e.timestamp * 1000 : e.timestamp;
          return (curNow - ts) <= 24 * 3600 * 1000;
        };

        const finishedMatches = normalized.filter(e => isCricketFinished(e) && isRecent24h(e));
        const liveMatches = normalized.filter(e => !isCricketFinished(e) && e.status === 'live');
        const upcomingMatches = normalized.filter(e => !isCricketFinished(e) && e.status === 'upcoming' && ((e.timestamp || curNow) >= curNow - 30 * 60 * 1000) && ((e.timestamp || curNow) <= fourteenDaysAhead || e.isSpecial));

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

        let finalEvents = this.deduplicateCricketSeries([...liveMatches, ...upcomingMatches, ...topFinished]);

        if (finalEvents.length > 0) {
          this.saveLocalCache(finalEvents, Date.now());
        } else if (Array.isArray(this.cache.data) && this.cache.data.length > 0) {
          console.log(`[CricketEngine] Network returned 0 matches, serving ${this.cache.data.length} cached matches.`);
          finalEvents = this.deduplicateCricketSeries(this.cache.data);
        }

        return {
          configured: true,
          events: finalEvents
        };
      } finally {
        this.inFlightPromise = null;
      }
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
