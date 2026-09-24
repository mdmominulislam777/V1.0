/**
 * HIGHFY TV - TheSportsDB Adapter
 * Normalizes raw TheSportsDB API responses into Unified Event objects.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('../eventModel.js');
    const broadcasterResolver = require('../broadcasterResolver.js');
    module.exports = factory(eventModel, broadcasterResolver);
  } else {
    root.HighFyTheSportsDbAdapter = factory(root.HighFyEventModel, root.HighFyBroadcasterResolver);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel, BroadcasterResolver) {
  'use strict';

  const { createUnifiedEvent } = EventModel;
  const { resolveBroadcasters } = BroadcasterResolver;

  function mapSportCategory(strSport) {
    const s = String(strSport || '').toLowerCase().trim();
    if (s.includes('cricket')) return 'cricket';
    if (s.includes('soccer') || s.includes('football')) return 'football';
    if (s.includes('basket')) return 'basketball';
    if (s.includes('tennis')) return 'tennis';
    if (s.includes('rugby')) return 'rugby';
    if (s.includes('baseball') || s.includes('mlb')) return 'baseball';
    if (s.includes('hockey') || s.includes('ice hockey')) return 'hockey';
    if (s.includes('motor') || s.includes('formula') || s.includes('racing')) return 'motorsport';
    if (s.includes('combat') || s.includes('fight') || s.includes('wwe') || s.includes('mma') || s.includes('boxing')) return 'combat';
    return s || 'sports';
  }

  function parseEventTimestamp(raw) {
    if (raw.strTimestamp) {
      let tsStr = String(raw.strTimestamp).trim();
      if (!tsStr.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(tsStr)) {
        tsStr = tsStr.replace(' ', 'T') + 'Z';
      }
      const parsed = Date.parse(tsStr);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }
    if (raw.dateEvent) {
      const timePart = raw.strTime ? raw.strTime.split('+')[0].split('Z')[0].trim() : '12:00:00';
      const parsed = Date.parse(`${raw.dateEvent}T${timePart}Z`);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  }

  function normalizeTheSportsDbEvent(raw) {
    if (!raw || !raw.idEvent) return null;

    // Team names
    let homeName = (raw.strHomeTeam || '').trim();
    let awayName = (raw.strAwayTeam || '').trim();
    const rawTitle = (raw.strEvent || '').trim();

    if ((!homeName || homeName.toLowerCase() === 'home team') && rawTitle.includes(' vs ')) {
      const parts = rawTitle.split(' vs ');
      homeName = parts[0].trim();
      awayName = parts[1].trim();
    } else if ((!homeName || homeName.toLowerCase() === 'home team') && rawTitle.includes(' v ')) {
      const parts = rawTitle.split(' v ');
      homeName = parts[0].trim();
      awayName = parts[1].trim();
    }

    if (!homeName || homeName.toLowerCase() === 'home team' || !awayName || awayName.toLowerCase() === 'away team') {
      if (!rawTitle || rawTitle.toLowerCase().includes('home team')) return null;
      homeName = rawTitle;
      awayName = raw.strLeague || 'Match';
    }

    const homeLogo = raw.strHomeTeamBadge || raw.strThumb || '';
    const awayLogo = raw.strAwayTeamBadge || '';
    const startTimeIso = parseEventTimestamp(raw);
    const sport = mapSportCategory(raw.strSport);

    // Deep broadcaster inspection
    const bcastResult = resolveBroadcasters(raw);

    // Score
    const hasHomeScore = raw.intHomeScore !== null && raw.intHomeScore !== undefined && raw.intHomeScore !== '';
    const hasAwayScore = raw.intAwayScore !== null && raw.intAwayScore !== undefined && raw.intAwayScore !== '';
    const score = (hasHomeScore || hasAwayScore) ? {
      home: String(raw.intHomeScore ?? ''),
      away: String(raw.intAwayScore ?? '')
    } : null;

    return createUnifiedEvent({
      id: `tsdb-${raw.idEvent}`,
      externalId: String(raw.idEvent),
      sport,
      league: raw.strLeague || 'Sports League',
      tournament: raw.strLeague || 'Tournament',
      title: rawTitle || `${homeName} vs ${awayName}`,
      homeTeam: { name: homeName, logo: homeLogo },
      awayTeam: { name: awayName, logo: awayLogo },
      homeLogo,
      awayLogo,
      startTime: startTimeIso,
      rawStatus: raw.strStatus,
      venue: `${raw.strVenue || ''}${raw.strCountry ? `, ${raw.strCountry}` : ''}`.trim() || null,
      country: raw.strCountry || null,
      broadcaster: bcastResult.broadcaster,
      broadcasters: bcastResult.broadcasters,
      source: 'TheSportsDB',
      verified: bcastResult.verified,
      score
    });
  }

  function transformTheSportsDbResponse(json) {
    if (!json) return [];
    const events = Array.isArray(json.events) ? json.events : (Array.isArray(json) ? json : []);
    const normalized = [];
    for (const raw of events) {
      const event = normalizeTheSportsDbEvent(raw);
      if (event) normalized.push(event);
    }
    return normalized;
  }

  return {
    normalizeTheSportsDbEvent,
    transformTheSportsDbResponse,
    mapSportCategory
  };
});
