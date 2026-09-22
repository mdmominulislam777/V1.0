/**
 * HIGHFY TV - SofaScore Adapter
 * Normalizes raw SofaScore API responses into Unified Event objects.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('../eventModel.js');
    const broadcasterResolver = require('../broadcasterResolver.js');
    module.exports = factory(eventModel, broadcasterResolver);
  } else {
    root.HighFySofaScoreAdapter = factory(root.HighFyEventModel, root.HighFyBroadcasterResolver);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel, BroadcasterResolver) {
  'use strict';

  const { createUnifiedEvent } = EventModel;
  const { resolveBroadcasters } = BroadcasterResolver;

  function mapSofaSport(sportObj) {
    const s = String(sportObj?.name || sportObj?.slug || sportObj || '').toLowerCase().trim();
    if (s.includes('cricket')) return 'cricket';
    if (s.includes('football') || s.includes('soccer')) return 'football';
    if (s.includes('basket')) return 'basketball';
    if (s.includes('tennis')) return 'tennis';
    if (s.includes('motor') || s.includes('formula')) return 'motorsport';
    if (s.includes('fight') || s.includes('combat') || s.includes('mma')) return 'combat';
    return s || 'football';
  }

  function normalizeSofaScoreEvent(raw) {
    if (!raw) return null;
    const eventId = raw.id || raw.customId;
    if (!eventId) return null;

    const home = raw.homeTeam || {};
    const away = raw.awayTeam || {};
    const homeName = (home.name || home.shortName || 'Home Team').trim();
    const awayName = (away.name || away.shortName || 'Away Team').trim();

    const homeLogo = home.id ? `https://api.sofascore.app/api/v1/team/${home.id}/image` : '';
    const awayLogo = away.id ? `https://api.sofascore.app/api/v1/team/${away.id}/image` : '';

    const tourn = raw.tournament || {};
    const leagueName = tourn.name || raw.season?.name || 'Tournament';

    let startTime = new Date().toISOString();
    if (raw.startTimestamp) {
      startTime = new Date(raw.startTimestamp * 1000).toISOString();
    }

    const sport = mapSofaSport(tourn.category?.sport || raw.sport);

    // Status mapping
    let rawStatus = 'upcoming';
    const statusType = (raw.status?.type || '').toLowerCase();
    if (statusType === 'inprogress') {
      rawStatus = 'live';
    } else if (statusType === 'finished') {
      rawStatus = 'finished';
    }

    // Broadcaster resolution
    const bcastResult = resolveBroadcasters(raw);

    // Score
    const homeScore = raw.homeScore?.current ?? raw.homeScore?.display ?? null;
    const awayScore = raw.awayScore?.current ?? raw.awayScore?.display ?? null;
    const score = (homeScore !== null || awayScore !== null) ? {
      home: String(homeScore ?? ''),
      away: String(awayScore ?? '')
    } : null;

    return createUnifiedEvent({
      id: `sofa-${eventId}`,
      externalId: String(eventId),
      sport,
      league: leagueName,
      tournament: leagueName,
      title: `${homeName} vs ${awayName}`,
      homeTeam: { name: homeName, logo: homeLogo },
      awayTeam: { name: awayName, logo: awayLogo },
      homeLogo,
      awayLogo,
      startTime,
      rawStatus,
      broadcaster: bcastResult.broadcaster,
      broadcasters: bcastResult.broadcasters,
      source: 'SofaScore',
      verified: bcastResult.verified,
      score
    });
  }

  function transformSofaScoreResponse(json) {
    if (!json) return [];
    const events = Array.isArray(json.events) ? json.events : (Array.isArray(json) ? json : []);
    const normalized = [];
    for (const raw of events) {
      const ev = normalizeSofaScoreEvent(raw);
      if (ev) normalized.push(ev);
    }
    return normalized;
  }

  return {
    normalizeSofaScoreEvent,
    transformSofaScoreResponse
  };
});
