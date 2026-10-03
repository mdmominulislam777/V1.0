/**
 * HIGHFY TV - CHANNEL RESOLVER & AUTHORIZED STREAM BUILDER
 * Matches resolved broadcaster/channel signals against HighFy TV channel registry.
 * Strictly enforces sport isolation and multi-server architecture without guessing.
 * Separates Broadcaster Discovery from Playback Authorization.
 */

(function(root, factory) {
  let eventModel = null;
  if (typeof module === 'object' && module && module.exports) {
    try {
      eventModel = require('./eventModel.js');
    } catch (e) {
      try {
        eventModel = require('./sportsApi/eventModel.js');
      } catch (e2) {}
    }
  }
  const resolved = factory(eventModel || (typeof root !== 'undefined' ? root.HighFyEventModel : null));
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = resolved;
  }
  if (typeof root !== 'undefined') {
    root.HighFyChannelResolver = resolved;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.HighFyChannelResolver = resolved;
  }
  if (typeof window !== 'undefined') {
    window.HighFyChannelResolver = resolved;
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
        if (!chSports.some(s => s.includes('wwe') || s.includes('combat') || s.includes('mma') || s.includes('boxing') || s.includes('ufc'))) return false;
      } else if (spLower === 'motorsport' || spLower === 'f1') {
        if (!chSports.some(s => s.includes('motorsport') || s.includes('f1') || s.includes('formula') || s.includes('racing'))) return false;
      }
    }

    // Name-level sport isolation guards
    if (spLower === 'cricket') {
      const isFootballSpecific = (chName.includes('football') || chName.includes('premier league') || chName.includes('la liga') || chName.includes('bundesliga') || chName.includes('serie a')) && !chName.includes('cricket');
      if (isFootballSpecific) return false;
    }

    if (spLower === 'football' || spLower === 'soccer') {
      const isCricketSpecific = (chName.includes('cricket') || chName.includes('willow') || chName.includes('star sports 1') || chName.includes('ptv sports') || /\bt sports\b/i.test(chName)) && !chName.includes('football');
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
      const isCombatOrWweCh =
        chName.includes('wwe') ||
        chName.includes('ufc') ||
        chName.includes('sony sports') ||
        chName.includes('sony ten') ||
        chName.includes('tnt sports') ||
        chName.includes('dazn') ||
        chSports.some(s => s.includes('wwe') || s.includes('combat') || s.includes('boxing') || s.includes('ufc') || s.includes('mma'));
      return isCombatOrWweCh;
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
            name: st.name || `${channel.name} Server ${servers.length + 1}`,
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
            name: srv.name || `${channel.name} Server ${servers.length + 1}`,
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
   * Banned generic umbrella networks and OTT platforms that must NEVER auto-assign channels
   */
  const BANNED_UMBRELLA_OR_OTT = new Set([
    'starsports', 'starsportsselect', 'sonysports', 'skysports', 'tntsports',
    'dazn', 'beinsports', 'bein', 'eurosport', 'supersport', 'foxsports',
    'fancode', 'cricbuzz', 'hotstar', 'disneyhotstar', 'jiohotstar', 'peacock',
    'paramount', 'paramountplus', 'optussport', 'optus', 'primevideo', 'amazonprimevideo',
    'amazonprime', 'canal', 'viaplay', 'stansport', 'jiocinema', 'sports18', 'sports181',
    'starsportsnetwork', 'sonysportsnetwork', 'sonynetwork', 'sonyliv', 'skysportsnetwork',
    'tntsportsnetwork', 'beinsportsnetwork', 'tsn', 'mlbtv', 'wnbaleaguepass', 'nbaleaguepass',
    'nbatv', 'espnplus', 'appletv', 'appletvplus', 'fubo', 'fubotv', 'kayosports', 'sparksport'
  ]);

  /**
   * Deterministic verified broadcaster aliases mapped strictly to HighFy TV channels.json IDs
   */
  const EXPLICIT_CATALOG_ALIASES = {
    'tsports': ['ch-t-sports-hd', 'ch-ayna-019de785-3962-77a1-8f50-c541bb5a02c7', 'ch-t-sports-server-2'],
    'tsportshd': ['ch-t-sports-hd', 'ch-ayna-019de785-3962-77a1-8f50-c541bb5a02c7', 'ch-t-sports-server-2'],
    'gazitv': ['ch-gazi-tv'],
    'gtv': ['ch-gazi-tv'],
    'gazitelevision': ['ch-gazi-tv'],
    'gazi': ['ch-gazi-tv'],
    'maasranga': ['ch-maasranga-tv-hd'],
    'maasrangatv': ['ch-maasranga-tv-hd'],
    'nagorik': ['ch-nagorik-tv'],
    'nagoriktv': ['ch-nagorik-tv'],
    'starsports1hindi': ['ch-star-sports-1-hindi'],
    'starsportshindi': ['ch-star-sports-1-hindi'],
    'ss1hindi': ['ch-star-sports-1-hindi'],
    'starsports1': ['ch-star-sports-1-hd'],
    'starsportsone': ['ch-star-sports-1-hd'],
    'starsport1': ['ch-star-sports-1-hd'],
    'ss1': ['ch-star-sports-1-hd'],
    'starsportsselect1': ['ch-star-sports-s1-hd'],
    'starselect1': ['ch-star-sports-s1-hd'],
    'select1': ['ch-star-sports-s1-hd'],
    'ssselect1': ['ch-star-sports-s1-hd'],
    'starsportss1': ['ch-star-sports-s1-hd'],
    'starsportsselect2': ['ch-star-sports-sl-2'],
    'starselect2': ['ch-star-sports-sl-2'],
    'select2': ['ch-star-sports-sl-2'],
    'ssselect2': ['ch-star-sports-sl-2'],
    'starsportssl2': ['ch-star-sports-sl-2'],
    'willow': ['ch-willow-hd', 'ch-willow-sports'],
    'willowcricket': ['ch-willow-hd', 'ch-willow-sports'],
    'willowtv': ['ch-willow-hd', 'ch-willow-sports'],
    'willowusa': ['ch-willow-hd', 'ch-willow-sports'],
    'willowsports': ['ch-willow-sports', 'ch-willow-hd'],
    'willowsports2': ['ch-willow-sports-2'],
    'willow2': ['ch-willow-sports-2'],
    'willowxtra': ['ch-willow-cricket-extra'],
    'willowextra': ['ch-willow-cricket-extra'],
    'willowcricketextra': ['ch-willow-cricket-extra'],
    'ptvsports': ['ch-ptv-sports-hd'],
    'ptvsport': ['ch-ptv-sports-hd'],
    'ptv': ['ch-ptv-sports-hd'],
    'asports': ['ch-a-sports'],
    'asport': ['ch-a-sports'],
    'tensports': ['ch-ten-sports-hd'],
    'tensportspakistan': ['ch-ten-sports-hd'],
    'tensportspk': ['ch-ten-sports-hd'],
    'tencricket': ['ch-ten-cricket'],
    'sonyten1': ['ch-sony-sports-ten-1-hd', 'ch-sony-sports-1-hd', 'ch-sony-sports-ten-1'],
    'sonysportsten1': ['ch-sony-sports-ten-1-hd', 'ch-sony-sports-1-hd', 'ch-sony-sports-ten-1'],
    'ten1': ['ch-sony-sports-ten-1-hd', 'ch-sony-sports-1-hd', 'ch-sony-sports-ten-1'],
    'sonysports1': ['ch-sony-sports-ten-1-hd', 'ch-sony-sports-1-hd', 'ch-sony-sports-ten-1'],
    'sonyten2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
    'sonysportsten2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
    'ten2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
    'tensports2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
    'sonysports2': ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd'],
    'sonyten3': ['ch-sony-sports-ten-3'],
    'sonysportsten3': ['ch-sony-sports-ten-3'],
    'ten3': ['ch-sony-sports-ten-3'],
    'tensports3': ['ch-sony-sports-ten-3'],
    'sonyten3hindi': ['ch-sony-sports-ten-3'],
    'foxcricket': ['ch-fox-cricket-501'],
    'foxcricket501': ['ch-fox-cricket-501'],
    'foxsports501': ['ch-fox-cricket-501'],
    'astrocricket': ['ch-astro-cricbuz'],
    'astrocricbuz': ['ch-astro-cricbuz'],
    'astrofootball': ['ch-astro-football'],
    'skysportspremierleague': ['ch-sky-sports-epl'],
    'skysportspremier': ['ch-sky-sports-epl'],
    'skypremierleague': ['ch-sky-sports-epl'],
    'skysportsepl': ['ch-sky-sports-epl'],
    'skysportsmainevent': ['ch-sky-sports-epl'],
    'skyspmainev': ['ch-sky-sports-epl'],
    'skysppl': ['ch-sky-sports-epl'],
    'skysportsfootball': ['ch-sky-sports-football'],
    'skysportscricket': ['ch-sky-sports-cricket'],
    'skycricket': ['ch-sky-sports-cricket'],
    'skysportsf1': ['ch-sky-sports-f1'],
    'skyf1': ['ch-sky-sports-f1'],
    'skysportstennis': ['ch-sky-sports-tennis'],
    'skytennis': ['ch-sky-sports-tennis'],
    'skysportsgolf': ['ch-sky-sports-golf'],
    'skygolf': ['ch-sky-sports-golf'],
    'skysportsmix': ['ch-sky-sports-mix'],
    'skysportsracing': ['ch-sky-sports-racing'],
    'skyracing': ['ch-sky-sports-racing'],
    'skysportsaction': ['ch-sky-sports-action'],
    'skyaction': ['ch-sky-sports-action'],
    'tntsports1': ['ch-tnt-sports-1'],
    'tnt1': ['ch-tnt-sports-1'],
    'tntsports2': ['ch-tnt-sports-2'],
    'tnt2': ['ch-tnt-sports-2'],
    'tntsports3': ['ch-tnt-sports-3'],
    'tnt3': ['ch-tnt-sports-3'],
    'tntsports4': ['ch-tnt-sports-4'],
    'tnt4': ['ch-tnt-sports-4'],
    'dazn1': ['ch-dazn-1'],
    'dazn2': ['ch-dazn-2'],
    'dazn3': ['ch-dazn-3'],
    'dazn4': ['ch-dazn-4'],
    'dazn5': ['ch-dazn-5'],
    'daznlaliga': ['ch-dazn-laliga'],
    'eurosport1': ['ch-eurosport-1'],
    'eurosport2': ['ch-eurosport-2'],
    'ziggosport1': ['ch-ziggo-sport-1'],
    'ziggo1': ['ch-ziggo-sport-1'],
    'ziggosport2': ['ch-ziggo-sport-2'],
    'ziggo2': ['ch-ziggo-sport-2'],
    'ziggosport3': ['ch-ziggo-sport-3'],
    'ziggo3': ['ch-ziggo-sport-3'],
    'beinsports1': ['ch-bein-sports-1-hd'],
    'bein1': ['ch-bein-sports-1-hd'],
    'beinsports2': ['ch-bein-sports-2'],
    'bein2': ['ch-bein-sports-2'],
    'beinsports3': ['ch-bein-sports-3-hd'],
    'bein3': ['ch-bein-sports-3-hd'],
    'beinsports4': ['ch-bein-sports-4-hd'],
    'bein4': ['ch-bein-sports-4-hd'],
    'beinsports5': ['ch-bein-sports-5-hd'],
    'bein5': ['ch-bein-sports-5-hd'],
    'beinxtra': ['ch-bein-xtra', 'ch-bein-sports-xtra'],
    'beinsportsxtra': ['ch-bein-sports-xtra', 'ch-bein-xtra'],
    'ddsports': ['ch-dd-sports'],
    'qazsports': ['ch-qaz-sports-hd'],
    'qazsport': ['ch-qaz-sports-hd'],
    'mundialsports': ['ch-mundial-sports-hd'],
    'aspor': ['ch-a-spor'],
    'pksports': ['ch-pk-sports-hd'],
    'fifaplus': ['ch-ayna-019efa45-d8f0-7732-8263-6030073a34fe'],
    'motorvision': ['ch-motor-vision'],
    'cricketgold': ['ch-cricket-gold'],
    'espn': ['ch-espn'],
    'espn2': ['ch-espn-2'],
    'espn3': ['ch-espn-3'],
    'go3sport1': ['ch-go3-sport-1-hd'],
    'go3sport2': ['ch-go3-sport-2-hd'],
    'ufctv': ['ch-ufc-tv'],
    'ufcfightpass': ['ch-ufc-fight-pass'],
    'supersportlaliga': ['ch-super-sport-laliga'],
    'dsports': ['ch-dsports'],
    'directvsports': ['ch-dsports'],
    'goaltv': ['ch-goal-tv']
  };

  /**
   * Deterministic lookup of verified active channels for a normalized broadcaster token.
   * Never uses substring/fuzzy matching.
   */
  function findDeterministicChannels(normBcast, activeChannels, eventSport) {
    if (!normBcast || normBcast.length < 2) return [];
    if (BANNED_UMBRELLA_OR_OTT.has(normBcast)) return [];

    const matched = [];
    const seenIds = new Set();

    // 1. Check explicit deterministic alias catalog
    const mappedIds = EXPLICIT_CATALOG_ALIASES[normBcast];
    if (Array.isArray(mappedIds) && mappedIds.length > 0) {
      for (const cid of mappedIds) {
        const ch = activeChannels.find(c => c && (c.id === cid || c.id === `ch-${cid}`) && matchesSportIsolation(c, eventSport));
        if (ch && !seenIds.has(ch.id)) {
          seenIds.add(ch.id);
          matched.push(ch);
        }
      }
      return matched;
    }

    // 2. Exact normalized channel name match (only if unambiguous single match)
    const exactCandidates = activeChannels.filter(c => {
      if (!matchesSportIsolation(c, eventSport)) return false;
      const normCh = normalizeName(c.name || '');
      return normCh === normBcast;
    });

    if (exactCandidates.length === 1) {
      matched.push(exactCandidates[0]);
    }

    return matched;
  }

  /**
   * Enriches discovered broadcasters with authorization & playback status against HighFy TV channels
   * Maintains strict separation: Discovered != Authorized != Playable.
   * Never uses fuzzy substring matching.
   */
  function resolveDiscoveredBroadcasters(discoveredList, channelRegistry = [], eventSport = '') {
    if (!Array.isArray(discoveredList) || discoveredList.length === 0) {
      return [];
    }

    const activeChannels = Array.isArray(channelRegistry) ? channelRegistry.filter(c => c && c.active === true) : [];
    const results = [];
    const seenChannelIds = new Set();

    for (const bcast of discoveredList) {
      if (!bcast || !bcast.name) continue;
      const normBcast = normalizeName(bcast.name);
      if (!normBcast || normBcast.length < 2) continue;

      const matchedChannels = findDeterministicChannels(normBcast, activeChannels, eventSport);
      if (matchedChannels.length > 0) {
        for (const matchedChannel of matchedChannels) {
          if (seenChannelIds.has(matchedChannel.id)) continue;
          const servers = getChannelServers(matchedChannel);
          if (servers.length > 0 && servers.some(s => s.active)) {
            seenChannelIds.add(matchedChannel.id);
            results.push({
              ...bcast,
              name: matchedChannel.name || bcast.name,
              apiBroadcasterName: bcast.name,
              logo: matchedChannel.logo || matchedChannel.image || bcast.logo || null,
              channelId: matchedChannel.id,
              discovered: true,
              authorizationStatus: 'authorized',
              playbackStatus: 'playable',
              servers
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Main Channel Resolver for Event Model
   */
  function resolveEventChannels(event, channelRegistry = []) {
    const sport = (event?.sport || event?.sportName || '').toLowerCase().trim();
    const league = event?.league || event?.tournament || event?.seriesName || event?.competition || 'UNKNOWN';
    
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

    if (!event || !Array.isArray(channelRegistry) || channelRegistry.length === 0) {
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

    const activeChannels = channelRegistry.filter(c => c && c.active === true);
    const matchedChannels = [];
    const seenMatchedIds = new Set();
    let matchType = null;

    const addMatchedChannel = (ch, type) => {
      if (!ch || !ch.id || seenMatchedIds.has(ch.id)) return;
      seenMatchedIds.add(ch.id);
      matchedChannels.push(ch);
      if (!matchType) matchType = type;
    };

    // 1. Exact channelId from API
    if (event.channelId) {
      const cid = String(event.channelId).trim().toLowerCase();
      const found = activeChannels.find(c => {
        const chId = String(c.id || '').trim().toLowerCase();
        return chId === cid || chId === `ch-${cid}` || `ch-${chId}` === cid;
      });
      if (found && matchesSportIsolation(found, sport)) {
        addMatchedChannel(found, 'exact_channel_id');
      }
    }

    // 2. Exact broadcasterId from API
    if (event.broadcasterId) {
      const bid = String(event.broadcasterId).trim().toLowerCase();
      const found = activeChannels.find(c => {
        const bId = String(c.broadcasterId || c.tvg_id || c.tvgId || '').trim().toLowerCase();
        return bId && bId === bid;
      });
      if (found && matchesSportIsolation(found, sport)) {
        addMatchedChannel(found, 'exact_broadcaster_id');
      }
    }

    // 3. Deterministic normalized broadcaster/channel name from API (NO fuzzy substring matching)
    if (rawBroadcasterTokens.length > 0) {
      for (const bcast of rawBroadcasterTokens) {
        const parts = String(bcast).split(/[,/|;+&]|\band\b|\bor\b/i).map(p => p.trim()).filter(Boolean);
        for (const part of parts) {
          const normBcast = normalizeName(part);
          const deterministicMatches = findDeterministicChannels(normBcast, activeChannels, sport);
          for (const dm of deterministicMatches) {
            addMatchedChannel(dm, 'normalized_broadcaster_name');
          }
        }
      }
    }

    // 4. Verified explicit event ID mapping in catalog (if explicitly linked)
    if (matchedChannels.length === 0 && event.id) {
      const evId = String(event.id);
      const found = activeChannels.find(c => {
        return Array.isArray(c.events) && c.events.map(String).includes(evId);
      });
      if (found && matchesSportIsolation(found, sport)) {
        addMatchedChannel(found, 'verified_event_id');
      }
    }

    // 5. No match -> Strict fallback
    if (matchedChannels.length === 0) {
      return {
        status: 'UNAVAILABLE',
        channelId: null,
        channelName: null,
        channelLogo: null,
        channels: [],
        streams: [],
        verified: false,
        message: 'Live channel unavailable'
      };
    }

    // Build multi-server authorized streams across all verified matched channels
    const allServers = [];
    const verifiedChannels = [];
    const seenStreamUrls = new Set();

    for (const ch of matchedChannels) {
      const servers = getChannelServers(ch).filter(s => s && s.active && isValidStreamUrl(s.url));
      if (servers.length > 0) {
        verifiedChannels.push({
          id: ch.id,
          name: ch.name,
          logo: ch.logo || ch.image || '',
          category: ch.category || 'Sports',
          sports: Array.isArray(ch.sports) ? ch.sports : [],
          verified: true,
          servers
        });
        for (const srv of servers) {
          const key = `${ch.id}::${srv.url}`;
          if (!seenStreamUrls.has(key)) {
            seenStreamUrls.add(key);
            allServers.push(srv);
          }
        }
      }
    }

    const primaryChannel = verifiedChannels[0] || null;
    if (!primaryChannel || allServers.length === 0) {
      return {
        status: 'UNAVAILABLE',
        channelId: null,
        channelName: null,
        channelLogo: null,
        channels: [],
        streams: [],
        verified: false,
        message: 'Live channel unavailable'
      };
    }

    return {
      status: 'MATCHED',
      matchType,
      channelId: primaryChannel.id,
      channelName: primaryChannel.name,
      channelLogo: primaryChannel.logo || '',
      channels: verifiedChannels,
      streams: allServers,
      verified: true,
      message: 'Channel matched and verified'
    };
  }

  return {
    normalizeName,
    matchesSportIsolation,
    getChannelStreamUrl,
    getChannelServers,
    resolveDiscoveredBroadcasters,
    resolveEventChannels
  };
});
