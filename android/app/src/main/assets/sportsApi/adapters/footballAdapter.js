/**
 * HIGHFY TV - Football / AllSportsAPI Adapter
 * Normalizes raw Football / AllSportsAPI JSON responses into Unified Event objects.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('../eventModel.js');
    const broadcasterResolver = require('../broadcasterResolver.js');
    module.exports = factory(eventModel, broadcasterResolver);
  } else {
    root.HighFyFootballAdapter = factory(root.HighFyEventModel, root.HighFyBroadcasterResolver);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel, BroadcasterResolver) {
  'use strict';

  const { createUnifiedEvent } = EventModel;
  const { resolveBroadcasters } = BroadcasterResolver;

  function normalizeFootballEvent(raw) {
    if (!raw) return null;
    const matchId = raw.event_key || raw.match_id || raw.id;
    if (!matchId) return null;

    const homeName = (raw.event_home_team || raw.home_team_name || raw.homeTeam || 'Home Team').trim();
    const awayName = (raw.event_away_team || raw.away_team_name || raw.awayTeam || 'Away Team').trim();

    const homeLogo = raw.home_team_logo || raw.homeLogo || '';
    const awayLogo = raw.away_team_logo || raw.awayLogo || '';

    const league = raw.league_name || raw.tournament || raw.league || 'Football Championship';
    const title = `${homeName} vs ${awayName}`;

    let startTime = new Date().toISOString();
    if (raw.event_date && raw.event_time) {
      const parsed = Date.parse(`${raw.event_date}T${raw.event_time}Z`);
      if (!isNaN(parsed)) startTime = new Date(parsed).toISOString();
    } else if (raw.startTime || raw.timestamp) {
      const parsed = Date.parse(raw.startTime || raw.timestamp);
      if (!isNaN(parsed)) startTime = new Date(parsed).toISOString();
    }

    const rawStatus = raw.event_status || raw.status;
    const bcastResult = resolveBroadcasters(raw);

    const score = (raw.event_final_result || (raw.home_score !== undefined && raw.away_score !== undefined)) ? {
      home: String(raw.home_score ?? (raw.event_final_result ? raw.event_final_result.split('-')[0].trim() : '')),
      away: String(raw.away_score ?? (raw.event_final_result ? raw.event_final_result.split('-')[1].trim() : ''))
    } : null;

    return createUnifiedEvent({
      id: `fb-${matchId}`,
      externalId: String(matchId),
      sport: 'football',
      league,
      tournament: league,
      title,
      homeTeam: { name: homeName, logo: homeLogo },
      awayTeam: { name: awayName, logo: awayLogo },
      homeLogo,
      awayLogo,
      startTime,
      rawStatus,
      venue: raw.event_stadium || raw.venue || null,
      country: raw.country_name || null,
      broadcaster: bcastResult.broadcaster,
      broadcasters: bcastResult.broadcasters,
      source: 'Football API',
      verified: bcastResult.verified,
      score
    });
  }

  function transformFootballResponse(json) {
    if (!json) return [];
    const events = Array.isArray(json.result) ? json.result : (Array.isArray(json.events) ? json.events : (Array.isArray(json) ? json : []));
    return events.map(normalizeFootballEvent).filter(Boolean);
  }

  return {
    normalizeFootballEvent,
    transformFootballResponse
  };
});
