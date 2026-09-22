/**
 * HIGHFY TV - WWE / Combat Adapter
 * Normalizes WWE and Combat Sports fixtures into Unified Event objects.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('../eventModel.js');
    module.exports = factory(eventModel);
  } else {
    root.HighFyWweAdapter = factory(root.HighFyEventModel);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel) {
  'use strict';

  const { createUnifiedEvent } = EventModel;

  function normalizeWweEvent(raw) {
    if (!raw) return null;
    const id = raw.id || `wwe-${raw.name ? raw.name.toLowerCase().replace(/[^a-z0-9]/g, '-') : Math.random().toString(36).substring(2, 8)}`;

    const title = raw.title || raw.name || 'WWE Championship';
    const league = raw.league || raw.show || 'WWE';
    const startTime = raw.startTime || raw.timestamp ? new Date(raw.timestamp || raw.startTime).toISOString() : new Date().toISOString();

    const homeName = raw.team1?.name || raw.homeTeam?.name || raw.title || 'WWE Superstars';
    const awayName = raw.team2?.name || raw.awayTeam?.name || 'WWE Live';
    const homeLogo = raw.team1?.logo || raw.homeLogo || raw.logo || 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/WWE_Logo.svg/512px-WWE_Logo.svg.png';
    const awayLogo = raw.team2?.logo || raw.awayLogo || homeLogo;

    return createUnifiedEvent({
      id: String(id),
      externalId: raw.externalId || String(id),
      sport: 'combat',
      league,
      tournament: league,
      title,
      homeTeam: { name: homeName, logo: homeLogo },
      awayTeam: { name: awayName, logo: awayLogo },
      homeLogo,
      awayLogo,
      startTime,
      rawStatus: raw.status || 'upcoming',
      venue: raw.venue || 'WWE Arena',
      broadcaster: 'Sony Sports Ten 1 HD',
      broadcasters: ['Sony Sports Ten 1 HD', 'WWE Network'],
      channelId: 'ch-sony-sports-ten-1-hd',
      channelName: 'Sony Sports Ten 1 HD',
      source: 'WWE Official',
      verified: true
    });
  }

  function transformWweResponse(fixtures) {
    if (!Array.isArray(fixtures)) return [];
    return fixtures.map(normalizeWweEvent).filter(Boolean);
  }

  return {
    normalizeWweEvent,
    transformWweResponse
  };
});
