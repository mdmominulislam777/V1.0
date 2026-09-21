/**
 * HIGHFY TV - CHANNEL RESOLVER & AUTHORIZED STREAM BUILDER
 * Matches resolved broadcaster/channel signals against HighFy TV channel registry.
 * Strictly enforces sport isolation and multi-server architecture without guessing.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    let eventModel = null;
    try {
      eventModel = require('./eventModel.js');
    } catch (e) {
      try {
        eventModel = require('./sportsApi/eventModel.js');
      } catch (e2) {}
    }
    module.exports = factory(eventModel);
  } else {
    root.HighFyChannelResolver = factory(root.HighFyEventModel);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(EventModel) {
  'use strict';

  const createStream = EventModel?.createStream || function(data) { return data; };

  /**
   * Normalize channel or broadcaster string for comparison
   */
  function normalizeName(name) {
    if (!name || typeof name !== 'string') return '';
    return name
      .toLowerCase()
      .replace(/[\s\-_.]+/g, ' ')
      .replace(/\b(hd|sd|fhd|4k|live|stream|channel|tv|network)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Check if channel belongs to the specified sport category
   */
  function matchesSportIsolation(channel, sport) {
    if (!channel || !sport) return true;
    const spLower = sport.toLowerCase().trim();
    const chName = (channel.name || '').toLowerCase();
    const chCategory = (channel.category || '').toLowerCase().trim();
    const chSports = Array.isArray(channel.sports) ? channel.sports.map(s => String(s).toLowerCase().trim()) : [];

    // If channel specifies supported sports, strictly verify inclusion
    if (chSports.length > 0) {
      if (spLower === 'cricket') {
        if (!chSports.includes('cricket')) return false;
      } else if (spLower === 'football' || spLower === 'soccer') {
        if (!chSports.includes('football') && !chSports.includes('soccer')) return false;
      } else if (spLower === 'basketball') {
        if (!chSports.includes('basketball') && !chSports.includes('nba')) return false;
      } else if (spLower === 'tennis') {
        if (!chSports.includes('tennis')) return false;
      } else if (spLower === 'wwe' || spLower === 'combat') {
        if (!chSports.includes('wwe') && !chSports.includes('combat') && !chSports.includes('mma') && !chSports.includes('boxing')) return false;
      } else if (spLower === 'motorsport' || spLower === 'f1') {
        if (!chSports.includes('motorsport') && !chSports.includes('f1') && !chSports.includes('racing')) return false;
      }
    }

    // Name-level sport isolation guards
    if (spLower === 'cricket') {
      const isFootballSpecific = (chName.includes('football') || chName.includes('premier league') || chName.includes('la liga') || chName.includes('bundesliga') || chName.includes('serie a')) && !chName.includes('cricket');
      if (isFootballSpecific) return false;
    }

    if (spLower === 'football' || spLower === 'soccer') {
      const isCricketSpecific = (chName.includes('cricket') || chName.includes('willow') || chName.includes('star sports 1') || chName.includes('ptv sports') || chName.includes('t sports')) && !chName.includes('football');
      if (isCricketSpecific) return false;
    }

    if (spLower === 'basketball') {
      const isCricketSpecific = chName.includes('cricket') || chName.includes('willow');
      const isFootballSpecific = (chName.includes('premier league') || chName.includes('la liga') || chName.includes('bundesliga')) && !chName.includes('espn');
      if (isCricketSpecific || isFootballSpecific) return false;
    }

    if (spLower === 'tennis') {
      const isCricketSpecific = chName.includes('cricket') || chName.includes('willow');
      if (isCricketSpecific) return false;
    }

    if (spLower === 'combat' || spLower === 'wwe') {
      const isWweCh = chName.includes('wwe') || chName.includes('sony sports ten 1') || chName.includes('sony ten 1') || chSports.includes('wwe');
      return isWweCh;
    }

    return true;
  }

  /**
   * Validate stream URL (http, https, or internal /api/ stream proxy)
   */
  function isValidStreamUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.trim();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('/') || u.startsWith('./');
  }

  /**
   * Extract valid stream URL from a channel object
   */
  function getChannelStreamUrl(channel) {
    if (!channel) return null;
    const candidate = channel.streamUrl || channel.stream_url || channel.url || channel.link || (Array.isArray(channel.streams) && channel.streams[0]?.url);
    if (isValidStreamUrl(candidate)) {
      return candidate.trim();
    }
    return null;
  }

  /**
   * Collect all secondary/backup stream URLs for multi-server support
   */
  function getChannelServers(channel) {
    if (!channel) return [];
    const servers = [];
    const seenUrls = new Set();

    // 1. If channel has explicit streams array defined in registry
    if (Array.isArray(channel.streams) && channel.streams.length > 0) {
      channel.streams.forEach((st, idx) => {
        const url = st?.url;
        if (isValidStreamUrl(url) && !seenUrls.has(url.trim())) {
          seenUrls.add(url.trim());
          servers.push(createStream({
            id: st.id || `${channel.id}-st-${idx + 1}`,
            name: st.name || `Server ${servers.length + 1}`,
            serverLabel: st.serverLabel || `SERVER ${servers.length + 1} (${st.quality || 'HD'})`,
            quality: st.quality || '1080p FHD',
            url: url.trim(),
            provider: st.provider || channel.provider || 'HighFy Stream',
            verified: true,
            active: true,
            channelId: channel.id,
            channelName: channel.name,
            channelLogo: st.channelLogo || channel.logo || channel.image || ''
          }));
        }
      });
    }

    // 2. Primary stream if not already captured
    const primaryUrl = getChannelStreamUrl(channel);
    if (primaryUrl && !seenUrls.has(primaryUrl)) {
      seenUrls.add(primaryUrl);
      servers.unshift(createStream({
        id: `${channel.id}-srv-1`,
        name: `${channel.name} (Server 1 HD)`,
        serverLabel: 'SERVER 1 (1080P HD)',
        quality: channel.quality || '1080p FHD',
        url: primaryUrl,
        provider: channel.provider || 'HighFy Master',
        verified: true,
        active: true,
        channelId: channel.id,
        channelName: channel.name,
        channelLogo: channel.logo || channel.image || ''
      }));
    }

    // 3. Secondary / Alternative servers if configured
    if (Array.isArray(channel.servers)) {
      channel.servers.forEach((srv, idx) => {
        const url = srv?.url || srv?.streamUrl;
        if (isValidStreamUrl(url) && !seenUrls.has(url.trim())) {
          seenUrls.add(url.trim());
          servers.push(createStream({
            id: srv.id || `${channel.id}-srv-${servers.length + 1}`,
            name: srv.name || `Server ${servers.length + 1}`,
            serverLabel: srv.serverLabel || `SERVER ${servers.length + 1}`,
            quality: srv.quality || '720p HD',
            url: url.trim(),
            provider: srv.provider || channel.provider || 'HighFy Backup',
            verified: true,
            active: true,
            channelId: channel.id,
            channelName: channel.name,
            channelLogo: channel.logo || channel.image || ''
          }));
        }
      });
    }

    // 4. Channels with explicit backupUrls array
    if (Array.isArray(channel.backupUrls)) {
      channel.backupUrls.forEach((bUrl, idx) => {
        if (isValidStreamUrl(bUrl) && !seenUrls.has(bUrl.trim())) {
          seenUrls.add(bUrl.trim());
          servers.push(createStream({
            id: `${channel.id}-backup-${idx + 1}`,
            name: `${channel.name} Server ${servers.length + 1}`,
            serverLabel: `SERVER ${servers.length + 1} (BACKUP)`,
            quality: '720p HD',
            url: bUrl.trim(),
            provider: channel.provider || 'HighFy Backup',
            verified: true,
            active: true,
            channelId: channel.id,
            channelName: channel.name,
            channelLogo: channel.logo || channel.image || ''
          }));
        }
      });
    }

    return servers;
  }

  /**
   * Main Channel Resolver
   * Priority:
   * 1. exact channelId from API
   * 2. exact broadcasterId from API
   * 3. exact normalized broadcaster/channel name or provider/network token from API
   * 4. verified provider mapping (e.g. WWE franchise contract or explicit ID verification)
   * 5. no match -> Live channel unavailable
   */
  function resolveEventChannels(event, channelRegistry = []) {
    const eventId = String(event?.id || event?.rawId || event?.idEvent || 'UNKNOWN');
    const sport = (event?.sport || event?.sportName || '').toLowerCase().trim();
    const sportUpper = sport ? sport.toUpperCase() : 'UNKNOWN';
    const league = event?.league || event?.tournament || event?.seriesName || event?.competition || 'UNKNOWN';
    const homeTeam = event?.homeTeam?.name || event?.homeTeam || event?.team1?.name || (Array.isArray(event?.teams) ? event.teams[0] : '') || 'TBD';
    const awayTeam = event?.awayTeam?.name || event?.awayTeam || event?.team2?.name || (Array.isArray(event?.teams) ? event.teams[1] : '') || 'TBD';
    
    // Extract raw broadcaster signals from API without inventing any
    const rawBroadcasterTokens = [];
    if (typeof event?.broadcaster === 'string' && event.broadcaster.trim()) rawBroadcasterTokens.push(event.broadcaster.trim());
    if (Array.isArray(event?.broadcasters)) {
      event.broadcasters.forEach(b => { if (typeof b === 'string' && b.trim()) rawBroadcasterTokens.push(b.trim()); });
    }
    if (typeof event?.strTVStation === 'string' && event.strTVStation.trim()) rawBroadcasterTokens.push(event.strTVStation.trim());
    if (typeof event?.channelName === 'string' && event.channelName.trim()) rawBroadcasterTokens.push(event.channelName.trim());
    if (typeof event?.network === 'string' && event.network.trim()) rawBroadcasterTokens.push(event.network.trim());
    if (typeof event?.provider === 'string' && event.provider.trim()) rawBroadcasterTokens.push(event.provider.trim());

    const broadcasterFromApi = rawBroadcasterTokens.length > 0 ? rawBroadcasterTokens.join(', ') : 'NONE';
    const channelIdFromApi = event?.channelId || (Array.isArray(event?.channelIds) ? event.channelIds.join(', ') : 'NONE');

    if (!event || !Array.isArray(channelRegistry) || channelRegistry.length === 0) {
      const matchReason = 'EMPTY_EVENT_OR_REGISTRY';
      console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${broadcasterFromApi}" "${channelIdFromApi}" NONE ${matchReason} 0`);
      console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${broadcasterFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=0`);
      return {
        status: 'UNAVAILABLE',
        channelId: null,
        channelName: null,
        channelLogo: null,
        streams: [],
        verified: false,
        message: 'Live channel unavailable'
      };
    }

    const activeChannels = channelRegistry.filter(c => c && c.active !== false);
    let matchedChannel = null;
    let matchType = null;
    let matchReason = 'NO_VERIFIED_BROADCASTER_METADATA';

    // 1. Exact channelId from API
    if (event.channelId) {
      const cid = String(event.channelId).trim().toLowerCase();
      matchedChannel = activeChannels.find(c => {
        const chId = String(c.id || '').trim().toLowerCase();
        return chId === cid || chId === `ch-${cid}` || `ch-${chId}` === cid;
      });
      if (matchedChannel && matchesSportIsolation(matchedChannel, sport)) {
        matchType = 'exact_channel_id';
        matchReason = 'API_CHANNEL_ID_MATCH';
      } else {
        matchedChannel = null;
      }
    }

    // 2. Exact broadcasterId from API
    if (!matchedChannel && event.broadcasterId) {
      const bid = String(event.broadcasterId).trim().toLowerCase();
      matchedChannel = activeChannels.find(c => {
        const bId = String(c.broadcasterId || c.tvg_id || c.tvgId || '').trim().toLowerCase();
        return bId && bId === bid;
      });
      if (matchedChannel && matchesSportIsolation(matchedChannel, sport)) {
        matchType = 'exact_broadcaster_id';
        matchReason = 'API_BROADCASTER_ID_MATCH';
      } else {
        matchedChannel = null;
      }
    }

    // 3. Exact normalized broadcaster/channel name or provider/network token from API
    if (!matchedChannel && rawBroadcasterTokens.length > 0) {
      for (const bcast of rawBroadcasterTokens) {
        const normBcast = normalizeName(bcast);
        if (!normBcast || normBcast.length < 3) continue;

        // Try exact normalized name
        matchedChannel = activeChannels.find(c => {
          if (!matchesSportIsolation(c, sport)) return false;
          const normCh = normalizeName(c.name || '');
          return normCh === normBcast;
        });

        // Try high-confidence token inclusion if no exact match
        if (!matchedChannel) {
          matchedChannel = activeChannels.find(c => {
            if (!matchesSportIsolation(c, sport)) return false;
            const normCh = normalizeName(c.name || '');
            if (normCh.length > 3 && normBcast.length > 3) {
              return normCh.includes(normBcast) || normBcast.includes(normCh);
            }
            return false;
          });
        }

        if (matchedChannel) {
          matchType = 'normalized_broadcaster_name';
          matchReason = 'API_BROADCASTER_NAME_MATCH';
          break;
        }
      }
    }

    // 4. Verified provider mapping (Franchise contract or explicit event ID)
    if (!matchedChannel) {
      // 4a. WWE Flagship Contract
      const isWwe = sport === 'combat' || sport === 'wwe' || (league || '').toLowerCase().includes('wwe');
      if (isWwe) {
        matchedChannel = activeChannels.find(c => {
          const cId = String(c.id || '').toLowerCase();
          const cName = String(c.name || '').toLowerCase();
          return cId === 'jio-162' || cId === 'jio-3510' || cId === 'ch-sony-sports-ten-1-hd' || cId === 'sports-wwe-network' || cName.includes('sony ten 1') || cName.includes('wwe network');
        });
        if (matchedChannel) {
          matchType = 'verified_franchise_contract';
          matchReason = 'WWE_SOUTH_ASIA_FRANCHISE_CONTRACT';
        }
      }

      // 4b. Explicit event ID listed inside channel.events array
      if (!matchedChannel && event.id) {
        const evId = String(event.id);
        matchedChannel = activeChannels.find(c => {
          return Array.isArray(c.events) && c.events.map(String).includes(evId);
        });
        if (matchedChannel) {
          matchType = 'verified_event_id';
          matchReason = 'CHANNEL_REGISTRY_EVENT_ID_MATCH';
        }
      }
    }

    // 5. No match -> Strict fallback
    if (!matchedChannel) {
      if (rawBroadcasterTokens.length > 0) {
        matchReason = 'NO_AUTHORIZED_CHANNEL_FOR_BROADCASTER';
      } else {
        matchReason = 'NO_BROADCASTER_FROM_API';
      }
      console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${broadcasterFromApi}" "${channelIdFromApi}" NONE ${matchReason} 0`);
      console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${broadcasterFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=0`);
      return {
        status: 'UNAVAILABLE',
        channelId: null,
        channelName: null,
        channelLogo: null,
        streams: [],
        verified: false,
        message: 'Live channel unavailable'
      };
    }

    // Build multi-server authorized streams
    const servers = getChannelServers(matchedChannel);

    if (servers.length === 0 || !servers.some(s => s.active)) {
      matchReason = 'MATCHED_CHANNEL_HAS_NO_ACTIVE_STREAMS';
      console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${broadcasterFromApi}" "${channelIdFromApi}" NONE ${matchReason} 0`);
      console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${broadcasterFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=0`);
      return {
        status: 'UNAVAILABLE',
        channelId: matchedChannel.id,
        channelName: matchedChannel.name,
        channelLogo: matchedChannel.logo || '',
        streams: [],
        verified: false,
        message: 'Live channel unavailable'
      };
    }

    const channelMatchResult = matchedChannel.name || matchedChannel.id;
    const authorizedStreamCount = servers.length;

    console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${broadcasterFromApi}" "${channelIdFromApi}" "${channelMatchResult}" ${matchReason} ${authorizedStreamCount}`);
    console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${broadcasterFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="${channelMatchResult}" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=${authorizedStreamCount}`);

    return {
      status: 'MATCHED',
      matchType,
      channelId: matchedChannel.id,
      channelName: matchedChannel.name,
      channelLogo: matchedChannel.logo || matchedChannel.image || '',
      streams: servers,
      verified: true,
      message: 'Channel matched and verified'
    };
  }

  return {
    normalizeName,
    matchesSportIsolation,
    getChannelStreamUrl,
    getChannelServers,
    resolveEventChannels
  };
});
