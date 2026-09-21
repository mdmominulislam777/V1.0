/**
 * HIGHFY TV - Cricket API Adapter
 * Normalizes raw Cricket API (Cricbuzz / RapidAPI / Live Cricket) responses into Unified Event objects.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('../eventModel.js');
    const broadcasterResolver = require('../broadcasterResolver.js');
    module.exports = factory(eventModel, broadcasterResolver);
  } else {
    root.HighFyCricketAdapter = factory(root.HighFyEventModel, root.HighFyBroadcasterResolver);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel, BroadcasterResolver) {
  'use strict';

  const { createUnifiedEvent } = EventModel;
  const { resolveBroadcasters } = BroadcasterResolver;

  function parseCricketTimestamp(val) {
    if (!val) return new Date().toISOString();
    if (typeof val === 'number') {
      const ms = val < 1e11 ? val * 1000 : val;
      return new Date(ms).toISOString();
    }
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      const ms = num < 1e11 ? num * 1000 : num;
      return new Date(ms).toISOString();
    }
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();
    return new Date().toISOString();
  }

  function normalizeCricketEvent(raw) {
    if (!raw) return null;

    // Reject placeholder / fake mock fixtures
    const rawIdStr = String(raw.matchId || raw.id || raw.externalId || '');
    if (rawIdStr.startsWith('dummy-') || rawIdStr.startsWith('mock-')) return null;

    const matchInfo = raw.matchInfo || raw;
    const matchId = matchInfo.matchId || matchInfo.id || raw.id;
    if (!matchId) return null;

    const team1Obj = matchInfo.team1 || raw.team1 || {};
    const team2Obj = matchInfo.team2 || raw.team2 || {};

    const homeName = team1Obj.teamName || team1Obj.name || matchInfo.team1Name || 'Team 1';
    const awayName = team2Obj.teamName || team2Obj.name || matchInfo.team2Name || 'Team 2';

    if (homeName.toLowerCase().includes('dummy') || awayName.toLowerCase().includes('dummy')) return null;

    const homeLogo = team1Obj.imageId ? `https://static.cricbuzz.com/a/img/v1/i1/c${team1Obj.imageId}/i.jpg` : (team1Obj.logo || raw.homeLogo || '');
    const awayLogo = team2Obj.imageId ? `https://static.cricbuzz.com/a/img/v1/i1/c${team2Obj.imageId}/i.jpg` : (team2Obj.logo || raw.awayLogo || '');

    const league = matchInfo.seriesName || matchInfo.series || raw.league || 'Cricket Series';
    const matchDesc = matchInfo.matchDesc || raw.matchDesc || '';
    const title = `${homeName} vs ${awayName}${matchDesc ? ` (${matchDesc})` : ''}`;

    const startTime = parseCricketTimestamp(matchInfo.startDate || raw.startTime || raw.timestamp);
    const endTime = matchInfo.endDate ? parseCricketTimestamp(matchInfo.endDate) : null;

    // Status
    const rawStatus = matchInfo.status || raw.status;

    // Broadcaster resolution
    const bcastResult = resolveBroadcasters(raw);

    // Score extraction if present
    let score = null;
    if (raw.score || raw.matchScore) {
      score = raw.score || raw.matchScore;
    }

    return createUnifiedEvent({
      id: `cricket-${matchId}`,
      externalId: String(matchId),
      sport: 'cricket',
      league,
      tournament: league,
      title,
      homeTeam: { name: homeName, logo: homeLogo },
      awayTeam: { name: awayName, logo: awayLogo },
      homeLogo,
      awayLogo,
      startTime,
      endTime,
      rawStatus,
      venue: matchInfo.venueInfo ? `${matchInfo.venueInfo.ground || ''}, ${matchInfo.venueInfo.city || ''}`.trim() : (raw.venue || null),
      broadcaster: bcastResult.broadcaster,
      broadcasters: bcastResult.broadcasters,
      source: 'Cricket API',
      verified: bcastResult.verified,
      score
    });
  }

  function transformCricketResponse(json) {
    if (!json) return [];
    const matches = [];

    // Handles Cricbuzz typeType wrapper
    if (Array.isArray(json.typeMatches)) {
      for (const typeItem of json.typeMatches) {
        if (Array.isArray(typeItem.seriesMatches)) {
          for (const series of typeItem.seriesMatches) {
            const seriesAd = series.seriesAdWrapper;
            if (seriesAd && Array.isArray(seriesAd.matches)) {
              for (const m of seriesAd.matches) {
                const norm = normalizeCricketEvent(m);
                if (norm) matches.push(norm);
              }
            }
          }
        }
      }
    } else if (Array.isArray(json.matches)) {
      for (const m of json.matches) {
        const norm = normalizeCricketEvent(m);
        if (norm) matches.push(norm);
      }
    } else if (Array.isArray(json)) {
      for (const m of json) {
        const norm = normalizeCricketEvent(m);
        if (norm) matches.push(norm);
      }
    }

    return matches;
  }

  return {
    normalizeCricketEvent,
    transformCricketResponse
  };
});
