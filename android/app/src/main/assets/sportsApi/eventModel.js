/**
 * HIGHFY TV - UNIFIED EVENT MODEL & STREAM MODEL
 * Standardized data models according to HighFy TV specifications.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.HighFyEventModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function() {
  'use strict';

  /**
   * Supported stream types
   */
  const STREAM_TYPES = {
    HLS: 'hls',
    DASH: 'dash',
    M3U8: 'm3u8',
    MPD: 'mpd'
  };

  /**
   * Determine stream type from URL
   */
  function detectStreamType(url) {
    if (!url || typeof url !== 'string') return STREAM_TYPES.HLS;
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.mpd')) return STREAM_TYPES.DASH;
    return STREAM_TYPES.HLS;
  }

  /**
   * Build Authorized Stream Object
   */
  function createStream({
    id = null,
    name = 'Server 1',
    url = '',
    type = null,
    quality = 'Auto',
    provider = 'HighFy Direct',
    verified = false,
    active = true,
    channelId = null,
    channelName = null,
    channelLogo = null
  } = {}) {
    const validUrl = typeof url === 'string' && url.trim().startsWith('http');
    const streamType = type || detectStreamType(url);
    const resolvedActive = Boolean(active && validUrl);

    return {
      id: id || `stream-${Math.random().toString(36).substring(2, 9)}`,
      name: name || 'Authorized Server',
      url: validUrl ? url.trim() : '',
      type: streamType,
      quality: quality || 'Auto',
      provider: provider || 'HighFy Verified',
      verified: Boolean(verified),
      active: resolvedActive,
      channelId: channelId || null,
      channelName: channelName || null,
      channelLogo: channelLogo || null
    };
  }

  /**
   * Normalize and classify match status
   * Priority: LIVE -> TODAY -> UPCOMING -> ENDED
   */
  function classifyStatus(rawStatus, startTime, endTime, timezone = 'Asia/Dhaka') {
    const now = Date.now();
    let startMs = 0;

    if (startTime) {
      const parsed = Date.parse(startTime);
      if (!isNaN(parsed)) startMs = parsed;
    }

    let endMs = 0;
    if (endTime) {
      const parsed = Date.parse(endTime);
      if (!isNaN(parsed)) endMs = parsed;
    }

    const stLower = String(rawStatus || '').toLowerCase().trim();

    // 1. Direct API Status priority
    if (stLower === 'live' || stLower === 'in_progress' || stLower === 'ongoing' || stLower === '1h' || stLower === '2h' || stLower === 'ht') {
      return 'LIVE';
    }
    if (stLower === 'finished' || stLower === 'ft' || stLower === 'ended' || stLower === 'aet' || stLower === 'postponed' || stLower === 'cancelled') {
      return 'ENDED';
    }

    // 2. Safe time-based calculation if start time is available
    if (startMs > 0) {
      const durationMs = endMs > startMs ? (endMs - startMs) : (3.5 * 3600 * 1000);
      const isPast = now > (startMs + durationMs);
      const isLiveNow = now >= startMs && now <= (startMs + durationMs);

      if (isPast) return 'ENDED';
      if (isLiveNow) return 'LIVE';

      // Check if match is scheduled for TODAY in Asia/Dhaka timezone
      try {
        const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
        const todayDhaka = dtf.format(new Date(now));
        const eventDhaka = dtf.format(new Date(startMs));
        if (todayDhaka === eventDhaka) {
          return 'TODAY';
        }
      } catch (e) {}

      return 'UPCOMING';
    }

    return 'UPCOMING';
  }

  /**
   * Format start time to human-readable string in Asia/Dhaka timezone
   */
  function formatDhakaTime(isoOrTimestamp, timezone = 'Asia/Dhaka') {
    if (!isoOrTimestamp) return '';
    try {
      const date = new Date(isoOrTimestamp);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(date);
    } catch (e) {
      return '';
    }
  }

  /**
   * Format date string in YYYY-MM-DD for Asia/Dhaka
   */
  function formatDhakaDate(isoOrTimestamp, timezone = 'Asia/Dhaka') {
    if (!isoOrTimestamp) return '';
    try {
      const date = new Date(isoOrTimestamp);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch (e) {
      return '';
    }
  }

  /**
   * Unified Event Model Factory
   */
  function createUnifiedEvent({
    id,
    externalId = null,
    sport = 'football',
    league = 'Sports League',
    tournament = null,
    title = '',
    homeTeam = null,
    awayTeam = null,
    homeLogo = '',
    awayLogo = '',
    startTime = null,
    endTime = null,
    status = null,
    rawStatus = null,
    venue = null,
    country = null,
    broadcaster = null,
    broadcasters = [],
    channelId = null,
    channelName = null,
    channelLogo = null,
    streams = [],
    source = 'Sports API',
    verified = false,
    score = null
  }) {
    // Sport normalization
    const normSport = (sport || 'football').toLowerCase().trim();

    // Home / Away team normalization
    const homeObj = typeof homeTeam === 'object' && homeTeam !== null
      ? { name: homeTeam.name || 'Home Team', logo: homeTeam.logo || homeLogo || '' }
      : { name: String(homeTeam || 'Home Team').trim(), logo: homeLogo || '' };

    const awayObj = typeof awayTeam === 'object' && awayTeam !== null
      ? { name: awayTeam.name || 'Away Team', logo: awayTeam.logo || awayLogo || '' }
      : { name: String(awayTeam || 'Away Team').trim(), logo: awayLogo || '' };

    const finalTitle = title || `${homeObj.name} vs ${awayObj.name}`;
    const finalLeague = league || tournament || 'Championship';
    const finalTournament = tournament || finalLeague;

    // Time calculations
    const computedStatus = status || classifyStatus(rawStatus, startTime, endTime);
    const timezone = 'Asia/Dhaka';
    const displayTime = formatDhakaTime(startTime, timezone);
    const displayDate = formatDhakaDate(startTime, timezone);

    // Broadcaster normalization
    const cleanedBroadcasters = Array.isArray(broadcasters)
      ? Array.from(new Set(broadcasters.map(b => String(b || '').trim()).filter(Boolean)))
      : [];
    const mainBroadcaster = (broadcaster && String(broadcaster).trim()) || (cleanedBroadcasters[0] || null);
    if (mainBroadcaster && !cleanedBroadcasters.includes(mainBroadcaster)) {
      cleanedBroadcasters.unshift(mainBroadcaster);
    }

    // Streams validation
    const validStreams = Array.isArray(streams) ? streams.map(s => createStream(s)) : [];

    // Timestamp numeric for sorting
    let timestamp = 0;
    if (startTime) {
      const parsed = Date.parse(startTime);
      if (!isNaN(parsed)) timestamp = parsed;
    }

    // HighFy Unified Event Object
    return {
      id: String(id || externalId || `event-${Math.random().toString(36).substring(2, 9)}`),
      externalId: externalId ? String(externalId) : null,
      sport: normSport,
      sportName: normSport.charAt(0).toUpperCase() + normSport.slice(1),
      league: finalLeague,
      tournament: finalTournament,
      title: finalTitle,
      name: finalTitle,
      homeTeam: homeObj,
      awayTeam: awayObj,
      homeLogo: homeObj.logo,
      awayLogo: awayObj.logo,
      startTime: startTime || new Date().toISOString(),
      endTime: endTime || null,
      timestamp: timestamp,
      status: computedStatus,
      statusLower: computedStatus.toLowerCase(),
      statusText: computedStatus === 'LIVE' ? 'LIVE NOW' : (computedStatus === 'ENDED' ? 'Full Time' : 'Scheduled'),
      statusLabel: computedStatus === 'LIVE' ? 'LIVE' : (computedStatus === 'ENDED' ? 'FT' : (computedStatus === 'TODAY' ? 'TODAY' : 'UPCOMING')),
      date: displayDate,
      time: displayTime,
      matchTime: displayTime,
      timeOrTimer: computedStatus === 'LIVE' ? 'LIVE' : (computedStatus === 'ENDED' ? 'FT' : displayTime),
      venue: venue || null,
      country: country || null,
      broadcaster: mainBroadcaster,
      broadcasters: cleanedBroadcasters,
      channelId: channelId || null,
      channelName: channelName || null,
      channelLogo: channelLogo || null,
      streams: validStreams,
      hasStream: validStreams.some(s => s.active),
      source: source || 'Sports API',
      verified: Boolean(verified),
      score: score || null,

      // HighFy TV UI Backwards Compatibility Bridges
      team1: {
        id: homeObj.id || null,
        name: homeObj.name,
        logo: homeObj.logo,
        score: score?.home ?? ''
      },
      team2: {
        id: awayObj.id || null,
        name: awayObj.name,
        logo: awayObj.logo,
        score: score?.away ?? ''
      },
      broadcastChannels: channelName ? [channelName] : [],
      broadcastingChannelDetails: channelId ? [{
        id: channelId,
        channelId: channelId,
        name: channelName || 'Authorized Channel',
        logo: channelLogo || '',
        active: validStreams.some(s => s.active),
        verified: Boolean(verified)
      }] : []
    };
  }

  /**
   * Deterministic Deduplication Key
   * externalId + sport + league + homeTeam + awayTeam + startTime
   */
  function generateDeduplicationKey(event) {
    if (!event) return '';
    const norm = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let sport = norm(event.sport || '');
    if (sport === 'soccer') sport = 'football';
    const league = norm(event.league || event.tournament || '');
    const home = norm(event.homeTeam?.name || event.homeTeam || event.team1?.name || '');
    const away = norm(event.awayTeam?.name || event.awayTeam || event.team2?.name || '');
    const teams = [home, away].filter(Boolean).sort().join('_');
    const start = norm(event.startTime ? event.startTime.split('T')[0] : (event.date || ''));

    return `${sport}_${league}_${teams}_${start}`;
  }

  return {
    STREAM_TYPES,
    detectStreamType,
    createStream,
    classifyStatus,
    formatDhakaTime,
    formatDhakaDate,
    createUnifiedEvent,
    generateDeduplicationKey
  };
});
