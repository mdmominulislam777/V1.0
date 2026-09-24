/**
 * HIGHFY TV - Central Sports Coordinator (sports.js)
 * Unifies Football (API-Football), Cricket (CricketData), and WWE into one normalized stream.
 * Handles deduplication, caching, auto-refresh, search, favorites, countdowns, and stream matching.
 * Compatible with GitHub Pages.
 */

class SportsCoordinator {
  constructor() {
    this.events = [];
    this.errors = {
      football: null,
      cricket: null,
      wwe: null
    };
    this.statusReports = {
      football: { configured: false, live: 0, upcoming: 0, finished: 0 },
      cricket: { configured: false, live: 0, upcoming: 0, finished: 0 },
      wwe: { configured: false, live: 0, upcoming: 0, finished: 0 },
      allsportsapi: { configured: false, live: 0, upcoming: 0, finished: 0 },
      sofascore: { configured: false, live: 0, upcoming: 0, finished: 0 }
    };
    this.lastUpdated = null;
    this.lastFetchTime = 0;
    this.fetchTtl = 5 * 60 * 1000; // 5 minutes coordinator cache
    this.channels = [];
    this.favKey = 'highfy_sports_favs';
    this.cacheKey = 'highfy_coordinator_events';
    this.mappingStorageKey = 'highfy_event_channel_map_v3';
    this.eventChannelMap = new Map();
    this.inFlightFetch = null;
    this.loadLocalCache();
    this.loadEventChannelMap();
    if (typeof window !== 'undefined' && window.HighFyEventEngine && !window.highfyEventEngine) {
      window.highfyEventEngine = new window.HighFyEventEngine.HighFyEventEngine({ channels: this.channels });
    }
  }

  /**
   * Hydrate events from localStorage with stale-while-revalidate resilience
   */
  loadLocalCache() {
    try {
      const stored = localStorage.getItem(this.cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        // Stale-while-revalidate TTL: Keep cache up to 24 hours as resilient fallback
        if (parsed && (now - (parsed.timestamp || 0) < 24 * 60 * 60 * 1000) && Array.isArray(parsed.events) && parsed.events.length > 0) {
          const cleanedEvents = parsed.events
            .filter(ev => {
              if (!ev || !ev.id) return false;
              const id = String(ev.id);
              if (id.startsWith('cricket-upcoming-') || id.startsWith('cricket-live-') || id.startsWith('football-live-') || id.startsWith('dummy-') || id.startsWith('mock-') || id.startsWith('sample-') || id.startsWith('cr-cricbuzz-')) {
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
          this.events = cleanedEvents;
          this.lastFetchTime = parsed.timestamp || 0;
          this.lastUpdated = new Date(this.lastFetchTime);
        }
      }
    } catch (e) {}

    // If events are still empty on cold boot, hydrate from local events.json seed
    if ((!this.events || this.events.length === 0) && typeof fetch !== 'undefined') {
      try {
        fetch('./events.json')
          .then(r => r.ok ? r.json() : null)
          .then(list => {
            if (Array.isArray(list) && list.length > 0 && (!this.events || this.events.length === 0)) {
              this.events = list;
              this.lastFetchTime = Date.now() - 10000;
              this.lastUpdated = new Date(this.lastFetchTime);
            }
          })
          .catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Save curated events to localStorage
   */
  saveLocalCache(events, timestamp = Date.now()) {
    try {
      this.events = events;
      this.lastFetchTime = timestamp;
      this.lastUpdated = new Date(timestamp);
      localStorage.setItem(this.cacheKey, JSON.stringify({ timestamp, events }));
    } catch (e) {}
  }

  /**
   * Load reliable Event-to-Channel Mapping from persistent storage
   */
  loadEventChannelMap() {
    try {
      const stored = localStorage.getItem(this.mappingStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        if (parsed && typeof parsed === 'object') {
          for (const [id, item] of Object.entries(parsed)) {
            // Keep mappings valid for up to 12 hours
            if (item && (now - (item.cachedAt || 0) < 12 * 60 * 60 * 1000)) {
              this.eventChannelMap.set(id, item);
            }
          }
        }
      }
    } catch (e) {}
  }

  /**
   * Save reliable Event-to-Channel Mapping both in-memory and to localStorage
   */
  saveEventChannelMap(eventOrId, channelOrId) {
    if (!eventOrId || !channelOrId) return;
    try {
      const candidateIds = [];
      if (typeof eventOrId === 'object') {
        if (eventOrId.id) candidateIds.push(String(eventOrId.id));
        if (eventOrId.rawId) candidateIds.push(String(eventOrId.rawId));
        if (eventOrId.idEvent) candidateIds.push(String(eventOrId.idEvent));
        if (eventOrId.matchId) candidateIds.push(String(eventOrId.matchId));
      } else {
        candidateIds.push(String(eventOrId));
      }

      let channelId = '';
      let channelName = '';
      if (typeof channelOrId === 'object' && channelOrId !== null) {
        channelId = channelOrId.id || channelOrId.channelId || '';
        channelName = channelOrId.name || channelOrId.channelName || '';
      } else {
        channelId = String(channelOrId || '');
      }

      if (!channelId) return;

      const payload = {
        channelId: channelId,
        channelName: channelName,
        cachedAt: Date.now(),
        verificationSource: (arguments.length > 2 && arguments[2]?.verificationSource) ? arguments[2].verificationSource : 'direct_api',
        sourceField: (arguments.length > 2 && arguments[2]?.sourceField) ? arguments[2].sourceField : 'rawBroadcaster',
        verificationDetail: (arguments.length > 2 && arguments[2]?.verificationDetail) ? arguments[2].verificationDetail : 'Verified from authentic API broadcaster token'
      };

      for (const id of candidateIds) {
        this.eventChannelMap.set(id, payload);
      }

      // Persist top 300 active mappings to avoid localStorage quota issues
      const obj = {};
      let count = 0;
      for (const [k, v] of this.eventChannelMap.entries()) {
        if (count++ > 300) break;
        obj[k] = v;
      }
      localStorage.setItem(this.mappingStorageKey, JSON.stringify(obj));
    } catch (e) {}
  }

  /**
   * Retrieve reliable mapped channel for an event without re-guessing
   * Returns the verified active Channel object from existing app channels
   */
  getMappedChannel(event) {
    if (!event) return null;
    const now = Date.now();
    const candidateIds = [
      event.id,
      event.rawId,
      event.idEvent,
      event.matchId,
      event.sofascoreId
    ].filter(Boolean).map(String);

    let foundEntry = null;
    for (const cid of candidateIds) {
      if (this.eventChannelMap.has(cid)) {
        const entry = this.eventChannelMap.get(cid);
        if (entry && (now - (entry.cachedAt || 0) < 24 * 60 * 60 * 1000)) {
          foundEntry = entry;
          break;
        }
      }
    }

    if (!foundEntry || !foundEntry.channelId) return null;

    // Verify channel still exists and is active in channels catalog
    const sportsChannels = this.getAllSportsChannels();
    const verifiedChannel = sportsChannels.find(c => 
      (c.id === foundEntry.channelId || c.id === `ch-${foundEntry.channelId}`) &&
      c.active !== false &&
      (c.stream_url || c.url || c.streamUrl)
    );

    if (verifiedChannel) {
      // Data integrity guard: Never allow T Sports to be recalled for EPL, La Liga, UCL or non-Bangladesh matches
      const chName = (verifiedChannel.name || '').toLowerCase();
      const sport = (event.sport || event.sportName || '').toLowerCase();
      const tourn = (event.tournament || event.league || '').toLowerCase();
      const country = (event.country || '').toLowerCase();
      const t1 = (event.team1?.name || event.homeTeam?.name || '').toLowerCase();
      const t2 = (event.team2?.name || event.awayTeam?.name || '').toLowerCase();
      const isTSports = chName.includes('t sports') || chName.includes('tsports');

      if (isTSports) {
        const isBD = tourn.includes('bangladesh') || tourn.includes('bpl') || country.includes('bangladesh') ||
          tourn.includes('dhaka') || t1.includes('bangladesh') || t2.includes('bangladesh');
        if (!isBD) return null; // Discard invalid cached mapping
      }
      
      verifiedChannel._mappingEntry = foundEntry;
      return verifiedChannel;
    }

    return null;
  }

  /**
   * Resolve authentic Fixture Broadcaster directly from API if missing
   */
  async resolveFixtureBroadcaster(event) {
    if (!event || event.source === 'Sportradar') return null;

    const fixtureId = event.rawId || event.idEvent || event.matchId || event.id;
    if (fixtureId) {
      try {
        const cleanId = String(fixtureId).replace(/^tsdb-/, '');
        const res = await fetch(`/api/fixture/broadcaster?fixtureId=${encodeURIComponent(cleanId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'success' && data.broadcaster) {
            event.broadcaster = data.broadcaster;
            event.broadcasters = data.broadcasters || [data.broadcaster];
            event.strTVStation = data.broadcaster;
          }
        }
      } catch (e) {
        console.warn('[SportsCoordinator] Fixture broadcaster resolve error:', e.message);
      }
    }

    return this.matchLiveStream(event);
  }

  /**
   * Set TV Channels list for live stream matching & automatically re-bind all events
   */
  setChannels(channelsList) {
    if (Array.isArray(channelsList)) {
      this.channels = channelsList;
      if (typeof window !== 'undefined') {
        if (window.highfyEventEngine) {
          window.highfyEventEngine.setChannels(channelsList);
        } else if (window.HighFyEventEngine) {
          window.highfyEventEngine = new window.HighFyEventEngine.HighFyEventEngine({ channels: channelsList });
        }
      }
      // Auto-bind streams to all currently loaded events with verified broadcast integrity
      if (Array.isArray(this.events) && this.events.length > 0) {
        this.events.forEach(ev => {
          const matchInfo = this.matchLiveStream(ev);
          ev.verificationSource = matchInfo.verificationSource || 'unverified';
          ev.sourceField = matchInfo.sourceField || null;
          ev.verificationDetail = matchInfo.verificationDetail || 'No verification';
          if (matchInfo.hasStream) {
            ev.streams = matchInfo.streams;
            ev.broadcastChannels = matchInfo.broadcastChannels;
            ev.broadcastingChannelDetails = matchInfo.broadcastingChannelDetails;
            ev.hasStream = true;
            ev.channelId = matchInfo.streams[0]?.channelId || ev.channelId;
          } else {
            ev.streams = [];
            ev.broadcastChannels = [];
            ev.broadcastingChannelDetails = [];
            ev.hasStream = false;
            ev.channelId = null;
          }
        });
      }
    }
  }

  /**
   * Core Sports Channels Catalog for instant 0-latency matching
   */
  getDefaultSportsChannels() {
    return [
      {
        id: "ch-t-sports-bd",
        name: "T Sports HD",
        category: "Sports",
        categories: ["Sports", "Bangla", "Cricket", "Football"],
        logo: "./assets/channel-logos/ch-t-sports-bd.png",
        stream_url: "https://tvsen3.aynaott.com/Sports1/mono.m3u8",
        url: "https://tvsen3.aynaott.com/Sports1/mono.m3u8",
        backupUrls: ["https://s1.itcnbd.live/T-Sports-HD/tracks-v1a1/mono.m3u8"],
        isHD: true
      },
      {
        id: "sports-t-sports-1",
        name: "T Sports Live 01",
        category: "Sports",
        categories: ["Sports", "Bangla", "Cricket"],
        logo: "./assets/channel-logos/sports-t-sports-1.png",
        stream_url: "https://tvsen3.aynaott.com/Sports1/mono.m3u8",
        url: "https://tvsen3.aynaott.com/Sports1/mono.m3u8",
        backupUrls: ["https://s1.itcnbd.live/T-Sports-HD/tracks-v1a1/mono.m3u8"],
        isHD: true
      },
      {
        id: "sports-star-sports-1",
        name: "Star Sports 1",
        category: "Sports",
        categories: ["Sports", "Cricket", "India"],
        logo: "./assets/channel-logos/sports-star-sports-1.png",
        stream_url: "https://cdn10.zohanayaan.com:1686/hls/star1in.m3u8?md5=_OOHBfSs4-F7nrHWdaOvRA&expires=1787160100",
        url: "https://cdn10.zohanayaan.com:1686/hls/star1in.m3u8?md5=_OOHBfSs4-F7nrHWdaOvRA&expires=1787160100",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-star-sports-1-hindi",
        name: "Star Sports 1 Hindi",
        category: "Sports",
        categories: ["Sports", "Cricket", "India"],
        logo: "./assets/channel-logos/sports-star-sports-1-hindi.png",
        stream_url: "https://cdn6.zohanayaan.com:1686/hls/starhindi.m3u8?md5=3uGoFkUteXHTq00tfl42UA&expires=1787160100",
        url: "https://cdn6.zohanayaan.com:1686/hls/starhindi.m3u8?md5=3uGoFkUteXHTq00tfl42UA&expires=1787160100",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-sony-ten-cricket",
        name: "Sony Ten Cricket",
        category: "Sports",
        categories: ["Sports", "Cricket", "International"],
        logo: "./assets/channel-logos/sports-sony-ten-cricket.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/ten_cricket/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/ten_cricket/playlist.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-sony-ten-1",
        name: "Sony Ten Sports 1 HD",
        category: "Sports",
        categories: ["Sports", "WWE", "Football", "Combat"],
        logo: "./assets/channel-logos/sports-sony-ten-1.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_1_hd/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_1_hd/playlist.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-sony-ten-2",
        name: "Sony Ten Sports 2 HD",
        category: "Sports",
        categories: ["Sports", "Football", "Champions League", "UEFA"],
        logo: "./assets/channel-logos/sports-sony-ten-2.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_2_hd/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_2_hd/playlist.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-sony-ten-5",
        name: "Sony Ten Sports 5 HD",
        category: "Sports",
        categories: ["Sports", "Cricket", "Football"],
        logo: "./assets/channel-logos/sports-sony-ten-5.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_5_hd/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_5_hd/playlist.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-willow-hd",
        name: "Willow HD",
        category: "Sports",
        categories: ["Sports", "Cricket", "International", "USA"],
        logo: "./assets/channel-logos/sports-willow-hd.png",
        stream_url: "https://cdn9.zohanayaan.com:1686/hls/willowusa.m3u8?md5=CYVJUG-GwQ16dfctgP2pOw&expires=1787160100",
        url: "https://cdn9.zohanayaan.com:1686/hls/willowusa.m3u8?md5=CYVJUG-GwQ16dfctgP2pOw&expires=1787160100",
        backupUrls: ["https://warm-caverns-48629-92fab798385f.herokuapp.com/https://d36r8jifhgsk5j.cloudfront.net/Willow_TV540p.m3u8"],
        isHD: true
      },
      {
        id: "sports-willow-hd-2",
        name: "Willow HD 2",
        category: "Sports",
        categories: ["Sports", "Cricket", "CPL"],
        logo: "./assets/channel-logos/sports-willow-hd-2.png",
        stream_url: "https://cdn9.zohanayaan.com:1686/hls/willowextra.m3u8?md5=hqyptd61oG74sdoV7hBQ5Q&expires=1787160101",
        url: "https://cdn9.zohanayaan.com:1686/hls/willowextra.m3u8?md5=hqyptd61oG74sdoV7hBQ5Q&expires=1787160101",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "ch-ptv-sports",
        name: "PTV Sports HD",
        category: "Sports",
        categories: ["Sports", "Cricket", "Pakistan"],
        logo: "./assets/channel-logos/ch-ptv-sports.png",
        stream_url: "https://cdn1.zohanayaan.com:1686/hls/ptvpk.m3u8?md5=r8px8GYKCr8Q05R23jrFEg&expires=1787160100",
        url: "https://cdn1.zohanayaan.com:1686/hls/ptvpk.m3u8?md5=r8px8GYKCr8Q05R23jrFEg&expires=1787160100",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "ch-ten-sports-pk",
        name: "Ten Sports Pakistan",
        category: "Sports",
        categories: ["Sports", "Cricket", "PSL"],
        logo: "./assets/channel-logos/ch-ten-sports-pk.png",
        stream_url: "https://cdn3.zohanayaan.com:1686/hls/tenspk.m3u8?md5=CN2FaffVJgR6__z8ctOa0Q&expires=1787160101",
        url: "https://cdn3.zohanayaan.com:1686/hls/tenspk.m3u8?md5=CN2FaffVJgR6__z8ctOa0Q&expires=1787160101",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "ch-a-sports-hd",
        name: "A Sports HD",
        category: "Sports",
        categories: ["Sports", "Cricket", "Pakistan"],
        logo: "./assets/channel-logos/ch-a-sports-hd.png",
        stream_url: "https://cdn8.zohanayaan.com:1686/hls/asportshd.m3u8?md5=IxS649coN83ERcq0m5uUrA&expires=1787160101",
        url: "https://cdn8.zohanayaan.com:1686/hls/asportshd.m3u8?md5=IxS649coN83ERcq0m5uUrA&expires=1787160101",
        backupUrls: ["https://playztv-apps.pages.dev/asports/index.m3u8"],
        isHD: true
      },
      {
        id: "sports-sky-sports-cricket",
        name: "Sky Sports Cricket",
        category: "Sports",
        categories: ["Sports", "Cricket", "UK", "Ashes"],
        logo: "./assets/channel-logos/sports-sky-sports-cricket.png",
        stream_url: "https://cdn9.zohanayaan.com:1686/hls/skyscric.m3u8?md5=vKqnXIQMF2pTw-rdyHo_dQ&expires=1787160102",
        url: "https://cdn9.zohanayaan.com:1686/hls/skyscric.m3u8?md5=vKqnXIQMF2pTw-rdyHo_dQ&expires=1787160102",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-supersport-premier",
        name: "SuperSport Premier League",
        category: "Sports",
        categories: ["Sports", "Football", "EPL", "Premier League"],
        logo: "./assets/channel-logos/sports-supersport-premier.png",
        stream_url: "https://s3.itcnbd.live/channel/ea25a516d781cb1c.m3u8",
        url: "https://s3.itcnbd.live/channel/ea25a516d781cb1c.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-bein-sports-hd",
        name: "beIN Sports HD",
        category: "Sports",
        categories: ["Sports", "Football", "La Liga", "Champions League"],
        logo: "./assets/channel-logos/sports-bein-sports-hd.png",
        stream_url: "http://6zirt9yx.otttv.pw/iptv/HEGN4VXXQQSYCA/6123/index.m3u8",
        url: "http://6zirt9yx.otttv.pw/iptv/HEGN4VXXQQSYCA/6123/index.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-wwe-network",
        name: "WWE Network Live",
        category: "Sports",
        categories: ["Sports", "WWE", "Combat", "Wrestling"],
        logo: "/assets/wwe-logos/wwe_official.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_1_hd/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/sony_sports_1_hd/playlist.m3u8",
        backupUrls: ["https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8"],
        isHD: true
      },
      {
        id: "sports-nba-tv",
        name: "NBA TV",
        category: "Sports",
        categories: ["Sports", "Basketball", "NBA"],
        logo: "./assets/channel-logos/sports-sky-sports-cricket.png",
        stream_url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        backupUrls: [],
        isHD: true
      },
      {
        id: "sports-sky-sports-f1",
        name: "Sky Sports F1",
        category: "Sports",
        categories: ["Sports", "Motorsport", "F1"],
        logo: "./assets/channel-logos/sports-sky-sports-cricket.png",
        stream_url: "http://6zirt9yx.otttv.pw/iptv/HEGN4VXXQQSYCA/7342/index.m3u8",
        url: "http://6zirt9yx.otttv.pw/iptv/HEGN4VXXQQSYCA/7342/index.m3u8",
        backupUrls: ["http://fastshare1.com:8080//live/25711345/late8airline/384213.ts"],
        isHD: true
      },
      {
        id: "sports-tennis-channel",
        name: "Tennis Channel",
        category: "Sports",
        categories: ["Sports", "Tennis"],
        logo: "./assets/channel-logos/sports-bein-sports-hd.png",
        stream_url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        backupUrls: [],
        isHD: true
      },
      {
        id: "sports-espn-hd",
        name: "ESPN HD",
        category: "Sports",
        categories: ["Sports", "Football", "Basketball", "Tennis", "Motorsport"],
        logo: "./assets/channel-logos/sports-bein-sports-hd.png",
        stream_url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        backupUrls: [],
        isHD: true
      },
      {
        id: "sports-eurosport-hd",
        name: "Eurosport HD",
        category: "Sports",
        categories: ["Sports", "Tennis", "Motorsport", "Hockey"],
        logo: "./assets/channel-logos/sports-sony-ten-1.png",
        stream_url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/euro_sports_hd/playlist.m3u8",
        url: "https://bldcmprod-cdn.toffeelive.com/cdn/live/euro_sports_hd/playlist.m3u8",
        backupUrls: ["http://151.80.18.177:86/Eurosport_2_HD/index.m3u8"],
        isHD: true
      },
      {
        id: "sports-usa-network",
        name: "USA Network",
        category: "Sports",
        categories: ["Sports", "WWE", "Combat"],
        logo: "/assets/wwe-logos/wwe_official.png",
        stream_url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        url: "https://live20.bozztv.com/giatvplayout7/giatv-209592/tracks-v1a1/mono.ts.m3u8",
        backupUrls: [],
        isHD: true
      }
    ];
  }

  /**
   * Get all active authentic channels in Sports category
   */
  getAllSportsChannels() {
    let list = [];
    if (Array.isArray(this.channels) && this.channels.length > 0) {
      list = this.channels.filter(ch => {
        if (!ch) return false;

        const name = (ch.name || '').toLowerCase();
        const cat = (ch.category || '').toLowerCase();
        const categories = Array.isArray(ch.categories) ? ch.categories.map(c => String(c).toLowerCase()) : [];

        // STRICT NON-SPORTS EXCLUSION (Block pure entertainment, serials, drama, movies, news, kids, music, religious)
        // Allow sports-broadcasting channels even if general Bengali (GTV, Nagorik, Maasranga)
        const isGeneralNonSports = name.includes('sab') || name.includes('max') || name.includes('entertainment') || 
                            name.includes('aath') || name.includes('pal') || name.includes('yay') || 
                            name.includes('cinema') || name.includes('movies') || name.includes('music') || 
                            name.includes('news') || name.includes('cartoon') || name.includes('kids') ||
                            name.includes('somoy') || name.includes('jamuna') || name.includes('ekattor') || 
                            name.includes('channel 24') || name.includes('dbc') || name.includes('atn news') ||
                            name.includes('zee bangla') || name.includes('star jalsha') || name.includes('colors') ||
                            name.includes('star plus') || name.includes('sony tv') || name.includes('bangla vision') ||
                            name.includes('quran') || name.includes('sunnah') || name.includes('makkah') || name.includes('madinah');
        
        const isSportsBroadcaster = name.includes('gtv') || name.includes('gazi tv') || name.includes('nagorik') || 
                                    name.includes('maasranga') || name.includes('t sports') || name.includes('tsports');
        if (isGeneralNonSports && !isSportsBroadcaster) return false;

        const isSportsCat = cat === 'sports' || categories.includes('sports') || categories.includes('cricket') || 
                            categories.includes('football') || categories.includes('tennis') || categories.includes('motorsport') || 
                            categories.includes('wwe');
        const hasSportsKeywords = name.includes('sport') || 
                                  name.includes('cricket') || name.includes('football') || 
                                  name.includes('fifa') || name.includes('ten sports') || 
                                  name.includes('sony ten') || name.includes('sony six') || 
                                  name.includes('sony sports') || name.includes('star sports') || 
                                  name.includes('willow') || name.includes('ptv sports') || 
                                  name.includes('tsports') || name.includes('t sports') || 
                                  name.includes('bein') || name.includes('supersport') || 
                                  name.includes('eurosport') || name.includes('wwe') ||
                                  name.includes('sports18') || name.includes('fancode') ||
                                  name.includes('dazn') || name.includes('ziggo') ||
                                  name.includes('tnt sports') || name.includes('khel') ||
                                  name.includes('espn') || name.includes('nba') ||
                                  name.includes('tennis channel') || name.includes('sky sports') ||
                                  name.includes('f1') || name.includes('formula') ||
                                  name.includes('usa network') || isSportsBroadcaster;

        return isSportsCat || hasSportsKeywords;
      });
    }

    if (list.length < 5) {
      // Merge with default core sports channels to guarantee complete sports selection
      const defaults = this.getDefaultSportsChannels();
      const existingIds = new Set(list.map(c => (c.id || c.name || '').toLowerCase()));
      defaults.forEach(d => {
        if (!existingIds.has((d.id || '').toLowerCase()) && !existingIds.has((d.name || '').toLowerCase())) {
          list.push(d);
        }
      });
    }

    // Securely decorate all sports channels with verified broadcast metadata (sports, leagues, priority)
    list.forEach(ch => {
      const meta = this.getVerifiedChannelMetadata(ch);
      if (meta) {
        if (!ch.sports || ch.sports.length === 0) ch.sports = meta.sports;
        if (!ch.leagues || ch.leagues.length === 0) ch.leagues = meta.leagues;
        if (!ch.priority || ch.priority === 0) ch.priority = meta.priority;
      }
    });

    return list;
  }

  /**
   * Verified sports broadcast metadata catalog mapping channels to authentic sports and league rights
   */
  getVerifiedChannelMetadata(ch) {
    if (!ch) return null;
    const id = String(ch.id || '').toLowerCase();
    const name = String(ch.name || '').toLowerCase();

    // English Premier League
    if (id === 'ch-sky-sports-epl' || name.includes('sky sports premier league')) {
      return { sports: ['Football'], leagues: ['English Premier League', 'Premier League', 'EPL'], priority: 10 };
    }
    if (id === 'ch-tnt-sports-1' || name === 'tnt sports 1') {
      return { sports: ['Football'], leagues: ['English Premier League', 'Premier League', 'UEFA Champions League'], priority: 9 };
    }
    if (id === 'ch-tnt-sports-2' || name === 'tnt sports 2') {
      return { sports: ['Football'], leagues: ['UEFA Europa League', 'UEFA Champions League', 'Italian Serie A', 'Serie A'], priority: 8 };
    }
    if (id === 'ch-tnt-sports-3' || name === 'tnt sports 3') {
      return { sports: ['Combat', 'Motorsport'], leagues: ['MotoGP', 'UFC', 'Boxing'], priority: 8 };
    }
    if (id === 'ch-tnt-sports-4' || name === 'tnt sports 4') {
      return { sports: ['Football', 'Rugby'], leagues: ['UEFA Europa Conference League', 'Premiership Rugby'], priority: 7 };
    }
    if (id === 'ch-sky-sports-football' || name.includes('sky sports football')) {
      return { sports: ['Football'], leagues: ['EFL', 'Scottish Premiership', 'Scottish League Cup', 'FA Cup', 'UEFA Nations League'], priority: 8 };
    }
    if (id === 'ch-star-sports-select-1' || name.includes('star sports select')) {
      return { sports: ['Football', 'Tennis', 'Motorsport'], leagues: ['English Premier League', 'Premier League', 'Wimbledon', 'Formula 1'], priority: 8 };
    }
    if (id === 'ch-bein-sports-1-hd' || name.includes('bein sports 1')) {
      return { sports: ['Football'], leagues: ['Spanish La Liga', 'La Liga', 'French Ligue 1', 'Ligue 1', 'UEFA Champions League', 'English Premier League'], priority: 9 };
    }
    if (id === 'ch-bein-sports-3-hd' || name.includes('bein sports 3')) {
      return { sports: ['Football'], leagues: ['French Ligue 1', 'Ligue 1', 'Spanish La Liga', 'La Liga', 'Italian Serie A', 'Serie A', 'German Bundesliga', 'Bundesliga'], priority: 8 };
    }
    if (id === 'ch-bein-sports-4-hd' || id === 'ch-bein-sports-5-hd' || name.includes('bein sports 4') || name.includes('bein sports 5')) {
      return { sports: ['Football'], leagues: ['French Ligue 1', 'Spanish La Liga'], priority: 7 };
    }
    if (id === 'ch-sony-sports-2-hd' || id === 'jio-891' || id === 'jio-3511' || name.includes('sony ten 2') || name.includes('sony sports 2')) {
      return { sports: ['Football', 'Combat'], leagues: ['UEFA Champions League', 'UEFA Europa League', 'German Bundesliga', 'Bundesliga', 'DFB-Pokal', 'UEFA Nations League', 'UFC'], priority: 9 };
    }
    if (id === 'jio-162' || id === 'jio-3510' || id === 'jio-514' || name.includes('sony ten 1') || name.includes('sony sports ten 1')) {
      return { sports: ['WWE', 'Combat', 'Tennis', 'Football'], leagues: ['WWE', 'Raw', 'SmackDown', 'NXT', 'PLE', 'WrestleMania', 'SummerSlam', 'Royal Rumble', 'Australian Open', 'Combat'], priority: 10 };
    }
    if (id === 'jio-524' || id === 'jio-892' || id === 'jio-3512' || name.includes('sony ten 3')) {
      return { sports: ['WWE', 'Football'], leagues: ['WWE', 'UEFA Champions League'], priority: 8 };
    }
    if (id === 'jio-155' || id === 'jio-3515' || id === 'jio-525' || name.includes('sony ten 5')) {
      return { sports: ['Tennis', 'Asian Games', 'Football'], leagues: ['Asian Games', 'UEFA Nations League', 'Tennis'], priority: 8 };
    }
    if (id === 'ch-dazn-1' || name === 'dazn 1') {
      return { sports: ['Football', 'Boxing', 'Combat'], leagues: ['Spanish La Liga', 'La Liga', 'Italian Serie A', 'Serie A', 'Boxing', 'Bellator', 'UFC'], priority: 7 };
    }
    if (id === 'ch-dazn-2' || name === 'dazn 2') {
      return { sports: ['Football', 'Combat'], leagues: ['Italian Serie A', 'Serie A', 'Combat'], priority: 7 };
    }
    // Cricket
    if (id === 'ch-sky-sports-cricket' || name.includes('sky sports cricket')) {
      return { sports: ['Cricket'], leagues: ['County Championship', 'County Championship Division One', 'County Championship Division Two', 'England', 'T20 Blast', 'The Hundred', 'ICC', 'Test', 'ODI', 'T20', 'Sri Lanka tour of England', 'Pakistan tour of England'], priority: 10 };
    }
    if (id === 'ch-star-sports-1-hd' || name === 'star sports 1 hd' || name === 'star sports 1') {
      return { sports: ['Cricket'], leagues: ['Asian Games', 'T20 Asian Games', "Women's Asian Games", 'Asia Cup', "Women's Asia Cup", 'India', 'ICC', 'ODI', 'T20', 'Test', 'IPL', 'One-Day Cup', 'Afghanistan vs India in India', 'Australia U19 tour of India', 'Australia A Women tour of India'], priority: 10 };
    }
    if (id === 'ch-star-sports-1-hindi' || name.includes('star sports 1 hindi')) {
      return { sports: ['Cricket'], leagues: ['Asian Games', 'T20 Asian Games', "Women's Asian Games", 'Asia Cup', 'India', 'ICC', 'IPL', 'Afghanistan vs India in India'], priority: 10 };
    }
    if (id === 'ch-t-sports-hd' || id === 'ch-t-sports-server-2' || name.includes('t sports') || name.includes('tsports')) {
      return { sports: ['Cricket', 'Football'], leagues: ['Bangladesh', 'BPL', 'DPL', 'Dhaka', 'Bangladesh A tour of South Africa', 'Asian Games', 'Asia Cup', 'Bangladesh Premier League'], priority: 10 };
    }
    if (id === 'ch-willow-hd' || id === 'ch-willow-hd-server-2' || name.includes('willow')) {
      return { sports: ['Cricket'], leagues: ['Caribbean Premier League', 'Womens Caribbean Premier League', 'CPL', 'One-Day Cup', 'Australia Domestic One-Day Cup', 'Sheffield Shield', 'ICC', 'ODI Series Zimbabwe vs Australia', 'T20 Series Zimbabwe vs South Africa', 'South Africa tour of Namibia', 'Australia tour of Zimbabwe'], priority: 9 };
    }
    if (id === 'ch-ptv-sports-hd' || name.includes('ptv sports')) {
      return { sports: ['Cricket'], leagues: ['Pakistan', 'PSL', 'National T20', 'Asia Cup', 'Asian Games', 'ICC', 'Pakistan tour of England'], priority: 9 };
    }
    // Motorsport & Tennis & NFL & Basketball & Rugby
    if (id === 'ch-sky-sports-f1' || name.includes('sky sports f1')) {
      return { sports: ['Motorsport', 'F1'], leagues: ['Formula 1', 'F1', 'FIA Formula 1 World Championship'], priority: 10 };
    }
    if (id === 'ch-sky-sports-tennis' || name.includes('sky sports tennis')) {
      return { sports: ['Tennis'], leagues: ['ATP World Tour', 'ATP', 'WTA Tour', 'WTA', 'Laver Cup', 'US Open', 'Australian Open', 'Wimbledon', 'Roland Garros', 'Tennis'], priority: 10 };
    }
    if (id === 'ch-eurosport-1' || id === 'ch-eurosport-2' || name.includes('eurosport')) {
      return { sports: ['Tennis', 'Cycling', 'Motorsport'], leagues: ['Australian Open', 'Roland Garros', 'ATP', 'WTA', 'Tour de France', 'Tennis'], priority: 8 };
    }
    if (id === 'ch-ziggo-sport-1' || id === 'ch-ziggo-sport-2' || id === 'ch-ziggo-sport-3' || name.includes('ziggo sport')) {
      return { sports: ['Football', 'Motorsport', 'Tennis'], leagues: ['ATP', 'WTA', 'Davis Cup', 'Wimbledon', 'Roland Garros', 'US Open', 'Australian Open', 'Tennis'], priority: 8 };
    }
    if (id === 'ch-espn' || id === 'ch-espn-2' || id === 'ch-espn-3' || name.includes('espn')) {
      return { sports: ['Basketball', 'Baseball', 'Football', 'American Football'], leagues: ['NBA', 'WNBA', 'NCAA', 'MLB', 'NFL', 'Basketball', 'Baseball'], priority: 9 };
    }
    if (id === 'ch-go3-sport-1-hd' || id === 'ch-go3-sport-2-hd' || name.includes('go3 sport')) {
      return { sports: ['Football', 'Basketball', 'Motorsport'], leagues: ['EuroLeague', 'NBA', 'Basketball', 'Motorsport'], priority: 8 };
    }
    if (id === 'ch-sky-sports-action' || name.includes('sky sports action') || name.includes('sky action')) {
      return { sports: ['Rugby', 'Combat', 'Motorsport', 'Basketball'], leagues: ['Premiership Rugby', 'The Rugby Championship', 'Super Rugby', 'Six Nations', 'Top 14 Rugby', 'NRL Rugby', 'Rugby', 'NBA'], priority: 9 };
    }
    if (id === 'ch-nfl-network' || name.includes('nfl network')) {
      return { sports: ['Football', 'American Football'], leagues: ['NFL', 'National Football League'], priority: 10 };
    }
    if (id === 'ch-motor-vision' || name.includes('motor vision')) {
      return { sports: ['Motorsport', 'F1'], leagues: ['Motorsport', 'Racing'], priority: 6 };
    }
    return null;
  }

  /**
   * Normalize broadcaster or TV Station string for robust matching
   * Strips HD, 4K, brackets, generic filler words, punctuation, etc.
   */
  normalizeBroadcasterName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      // Remove bracketed text e.g. (UK), (India), [Live], (BST)
      .replace(/\([^\)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      // Remove technical suffixes
      .replace(/\b(hd|fhd|uhd|4k|1080p|720p|stb|feed|mono)\b/gi, ' ')
      // Remove generic broadcast filler terms
      .replace(/\b(official|live|stream|television|network|channel|broadcast|station|tv)\b/gi, ' ')
      // Replace punctuation and symbols with space
      .replace(/[-_.:/\\,+|&]/g, ' ')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Comprehensive broadcaster and TV station aliases mapping to verified app channels.
   * PRODUCTION SAFEGUARD: Every key maps to ONE designated verified channel only.
   * No multi-channel alias expansion, no generic network or OTT guessing.
   */
  getBroadcasterAliases() {
    return {
      // Bangladesh Verified Broadcasters
      't sports': ['ch-t-sports-hd', 'ch-t-sports-server-2', 'sports-t-sports-1', 'ch-t-sports-bd'],
      't sports hd': ['ch-t-sports-hd', 'ch-t-sports-server-2', 'sports-t-sports-1', 'ch-t-sports-bd'],
      'tsports': ['ch-t-sports-hd', 'ch-t-sports-server-2', 'sports-t-sports-1', 'ch-t-sports-bd'],
      'gazi tv': ['ch-gazi-tv'],
      'gtv': ['ch-gazi-tv'],
      'gazi television': ['ch-gazi-tv'],
      'gazi': ['ch-gazi-tv'],
      'maasranga': ['ch-maasranga-tv-hd'],
      'maasranga tv': ['ch-maasranga-tv-hd'],
      'maasranga tv hd': ['ch-maasranga-tv-hd'],
      'nagorik': ['ch-nagorik-tv'],
      'nagorik tv': ['ch-nagorik-tv'],

      // Star Sports Specific Channels (Strict 1-to-1, No network-wide expansion)
      'star sports network': ['ch-star-sports-1-hd', 'ch-star-sports-1-hindi', 'ch-star-sports-select-1', 'jio-1984'],
      'star sports': ['ch-star-sports-1-hd', 'ch-star-sports-1-hindi', 'ch-star-sports-select-1', 'jio-1984'],
      'disney+ hotstar': ['ch-star-sports-1-hd', 'ch-star-sports-1-hindi', 'ch-star-sports-select-1', 'jio-1984'],
      'disney hotstar': ['ch-star-sports-1-hd', 'ch-star-sports-1-hindi', 'ch-star-sports-select-1', 'jio-1984'],
      'hotstar': ['ch-star-sports-1-hd', 'ch-star-sports-1-hindi', 'ch-star-sports-select-1', 'jio-1984'],
      'star sports 1 hindi': ['ch-star-sports-1-hindi'],
      'star sports hindi': ['ch-star-sports-1-hindi'],
      'ss1 hindi': ['ch-star-sports-1-hindi'],
      'star sports 1': ['ch-star-sports-1-hd', 'sports-star-sports-1'],
      'star sports 1 hd': ['ch-star-sports-1-hd', 'sports-star-sports-1'],
      'star sports one': ['ch-star-sports-1-hd', 'sports-star-sports-1'],
      'star sport 1': ['ch-star-sports-1-hd', 'sports-star-sports-1'],
      'ss1': ['ch-star-sports-1-hd', 'sports-star-sports-1'],
      'star sports 2 hindi': ['jio-1984', 'jio-1985'],
      'star sports 2 hd': ['jio-1984', 'jio-1985'],
      'star sports 2': ['jio-1984', 'jio-1985'],
      'ss2': ['jio-1984', 'jio-1985'],
      'star sports 2 tamil': ['jio-2853'],
      'star sports 2 telugu': ['jio-2852'],
      'star sports khel': ['jio-1998'],
      'star sports select 1': ['ch-star-sports-select-1'],
      'star sports select': ['ch-star-sports-select-1'],
      'star select 1': ['ch-star-sports-select-1'],
      'select 1': ['ch-star-sports-select-1'],
      'ss select 1': ['ch-star-sports-select-1'],

      // Willow Specific Channel
      'willow': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow cricket': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow tv': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow hd': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow usa': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow xtra': ['ch-willow-hd', 'ch-willow-hd-server-2'],
      'willow extra': ['ch-willow-hd', 'ch-willow-hd-server-2'],

      // Pakistan Verified Channels
      'ptv sports': ['ch-ptv-sports-hd'],
      'ptv sport': ['ch-ptv-sports-hd'],
      'ptv': ['ch-ptv-sports-hd'],
      'a sports': ['ch-a-sports-hd'],
      'asports': ['ch-a-sports-hd'],
      'a sport': ['ch-a-sports-hd'],
      'ten sports': ['ch-ten-sports-pk'],
      'ten sports pakistan': ['ch-ten-sports-pk'],
      'ten sports pk': ['ch-ten-sports-pk'],

      // Sony Specific Channels (Strict 1-to-1, No network-wide expansion)
      'sony sports network': ['jio-162', 'jio-3510', 'ch-sony-sports-2-hd', 'jio-892', 'jio-514'],
      'sony sports': ['jio-162', 'jio-3510', 'ch-sony-sports-2-hd', 'jio-892', 'jio-514'],
      'sonyliv': ['jio-162', 'jio-3510', 'ch-sony-sports-2-hd', 'jio-892', 'jio-514'],
      'sony liv': ['jio-162', 'jio-3510', 'ch-sony-sports-2-hd', 'jio-892', 'jio-514'],
      'sony network': ['jio-162', 'jio-3510', 'ch-sony-sports-2-hd', 'jio-892', 'jio-514'],
      'sony ten 1': ['jio-162', 'jio-3510', 'jio-514'],
      'sony ten 1 hd': ['jio-162', 'jio-3510', 'jio-514'],
      'sony sports ten 1': ['jio-162', 'jio-3510', 'jio-514'],
      'ten 1': ['jio-162', 'jio-3510', 'jio-514'],
      'ten sports 1': ['jio-162', 'jio-3510', 'jio-514'],
      'sony six': ['jio-162', 'jio-3510', 'jio-514'],

      'sony ten 2': ['jio-891', 'jio-3511', 'jio-523'],
      'sony ten 2 hd': ['jio-891', 'jio-3511', 'jio-523'],
      'sony sports ten 2': ['jio-891', 'jio-3511', 'jio-523'],
      'ten 2': ['jio-891', 'jio-3511', 'jio-523'],
      'ten sports 2': ['jio-891', 'jio-3511', 'jio-523'],

      'sony sports 2': ['ch-sony-sports-2-hd'],
      'sony sports 2 hd': ['ch-sony-sports-2-hd'],

      'sony ten 3': ['jio-892', 'jio-524', 'jio-3512'],
      'sony ten 3 hd': ['jio-892', 'jio-524', 'jio-3512'],
      'sony sports ten 3': ['jio-892', 'jio-524', 'jio-3512'],
      'ten 3': ['jio-892', 'jio-524', 'jio-3512'],
      'ten sports 3': ['jio-892', 'jio-524', 'jio-3512'],
      'sony ten 3 hindi': ['jio-892', 'jio-524', 'jio-3512'],

      'sony ten 4': ['jio-1774', 'jio-3514'],
      'sony ten 4 tamil': ['jio-1774', 'jio-3514'],
      'sony sports ten 4': ['jio-1774', 'jio-3514'],
      'ten 4': ['jio-1774', 'jio-3514'],
      'sony ten 4 telugu': ['jio-1775', 'jio-3513'],

      'sony ten 5': ['jio-155', 'jio-3515', 'jio-525'],
      'sony ten 5 hd': ['jio-155', 'jio-3515', 'jio-525'],
      'sony sports ten 5': ['jio-155', 'jio-3515', 'jio-525'],
      'ten 5': ['jio-155', 'jio-3515', 'jio-525'],
      'ten sports 5': ['jio-155', 'jio-3515', 'jio-525'],
      'sony six hd': ['jio-155', 'jio-3515', 'jio-525'],

      'sony aath': ['ch-sony-aath', 'jio-697'],

      // Sky Sports Specific Channels
      'sky sports premier league': ['ch-sky-sports-epl'],
      'sky sports premier': ['ch-sky-sports-epl'],
      'sky premier league': ['ch-sky-sports-epl'],
      'sky sports epl': ['ch-sky-sports-epl'],
      'sky sports football': ['ch-sky-sports-football'],
      'sky sports cricket': ['ch-sky-sports-cricket'],
      'sky cricket': ['ch-sky-sports-cricket'],
      'sky sports f1': ['ch-sky-sports-f1'],
      'sky f1': ['ch-sky-sports-f1'],
      'sky sports tennis': ['ch-sky-sports-tennis'],
      'sky tennis': ['ch-sky-sports-tennis'],
      'sky sports golf': ['ch-sky-sports-golf'],
      'sky golf': ['ch-sky-sports-golf'],
      'sky sports mix': ['ch-sky-sports-mix'],
      'sky sports racing': ['ch-sky-sports-racing'],
      'sky racing': ['ch-sky-sports-racing'],
      'sky sports action': ['ch-sky-sports-action'],

      // TNT Sports Specific Channels
      'tnt sports 1': ['ch-tnt-sports-1'],
      'tnt 1': ['ch-tnt-sports-1'],
      'tnt sports 2': ['ch-tnt-sports-2'],
      'tnt 2': ['ch-tnt-sports-2'],
      'tnt sports 3': ['ch-tnt-sports-3'],
      'tnt 3': ['ch-tnt-sports-3'],
      'tnt sports 4': ['ch-tnt-sports-4'],
      'tnt 4': ['ch-tnt-sports-4'],

      // DAZN Specific Channels
      'dazn 1': ['ch-dazn-1'],
      'dazn 2': ['ch-dazn-2'],
      'dazn 3': ['ch-dazn-3'],
      'dazn 4': ['ch-dazn-4'],
      'dazn 5': ['ch-dazn-5'],

      // EuroSport Specific Channels
      'eurosport 1': ['ch-eurosport-1'],
      'eurosport 2': ['ch-eurosport-2'],
      'eurosport hd': ['jio-875'],

      // Ziggo Sport Specific Channels
      'ziggo sport 1': ['ch-ziggo-sport-1'],
      'ziggo 1': ['ch-ziggo-sport-1'],
      'ziggo sport 2': ['ch-ziggo-sport-2'],
      'ziggo sport 3': ['ch-ziggo-sport-3'],

      // TSN Specific Channels
      'tsn 1': ['ch-tsn-1'],
      'tsn 2': ['ch-tsn-2'],
      'tsn 3': ['ch-tsn-3'],

      // beIN Sports Specific Channels
      'bein sports 1 hd': ['ch-bein-sports-1-hd'],
      'bein sports 1': ['ch-bein-sports-1-hd'],
      'bein 1': ['ch-bein-sports-1-hd'],
      'bein sports 3 hd': ['ch-bein-sports-3-hd'],
      'bein sports 3': ['ch-bein-sports-3-hd'],
      'bein 3': ['ch-bein-sports-3-hd'],
      'bein sports 4 hd': ['ch-bein-sports-4-hd'],
      'bein sports 4': ['ch-bein-sports-4-hd'],
      'bein 4': ['ch-bein-sports-4-hd'],
      'bein sports 5 hd': ['ch-bein-sports-5-hd'],
      'bein sports 5': ['ch-bein-sports-5-hd'],
      'bein 5': ['ch-bein-sports-5-hd'],
      'bein xtra': ['ch-bein-xtra'],
      'bein sports xtra': ['ch-bein-xtra'],

      // Other Specific Sports Channels
      'dd sports': ['ch-dd-sports', 'jio-204'],
      'dd national': ['ch-dd-sports', 'jio-204'],
      'qaz sports': ['ch-qaz-sports-hd'],
      'qazsport': ['ch-qaz-sports-hd'],
      'mundial sports': ['ch-mundial-sports-hd'],
      'a spor': ['ch-a-spor'],
      'aspor': ['ch-a-spor'],
      'pk sports': ['ch-pk-sports-hd'],
      'fifa+': ['ch-ayna-019efa45-d8f0-7732-8263-6030073a34fe'],
      'fifa plus': ['ch-ayna-019efa45-d8f0-7732-8263-6030073a34fe'],
      'red bull tv': ['jio-2779'],
      'pickleball now': ['jio-3243'],
      'world chess': ['jio-3499'],
      'all women sports network': ['jio-3146'],
      'awsn': ['jio-3146'],
      'nfl network': ['ch-nfl-network'],
      'motor vision': ['ch-motor-vision'],
      'motorvision': ['ch-motor-vision'],
      'cricket gold': ['ch-cricket-gold'],
      'espn': ['ch-espn'],
      'espn hd': ['ch-espn'],
      'espn 2': ['ch-espn-2'],
      'espn 3': ['ch-espn-3'],
      'go3 sport': ['ch-go3-sport-1-hd'],
      'go3 sport 1': ['ch-go3-sport-1-hd'],
      'go3 sport 2': ['ch-go3-sport-2-hd'],
      'sky sports action': ['ch-sky-sports-action'],
      'sky action': ['ch-sky-sports-action'],
      'premiership rugby': ['ch-sky-sports-action', 'ch-tnt-sports-2'],
      'nba tv': ['ch-espn', 'ch-go3-sport-1-hd'],
      'wnba league pass': ['ch-espn'],
      'usa net': ['ch-espn']
    };
  }

  /**
   * Banned generic networks or OTT names that MUST NOT automatically assign channels.
   * Prevents alias expansion and multi-channel guessing.
   */
  isBannedNetworkOrOttName(name) {
    if (!name) return false;
    const n = name.toLowerCase().trim();
    const banned = [
      'fancode',
      'cricbuzz',
      'peacock',
      'paramount',
      'paramount+',
      'optus sport',
      'optus',
      'prime video',
      'amazon prime video',
      'amazon prime',
      'viaplay',
      'stan sport',
      'jiocinema',
      'jio cinema',
      'sports18',
      'sports 18',
      'sports18 1',
      'supersport',
      'supersport cricket',
      'supersport premier league',
      'supersport football',
      'supersport premier',
      'supersport epl',
      'supersport grandstand',
      'supersport variety',
      'supersport rugby'
    ];
    return banned.includes(n);
  }

  /**
   * PRODUCTION FINAL SAFEGUARD:
   * Validates the complete 4-step authorization chain for each candidate channel:
   * 1. API Broadcaster token exists and is valid
   * 2. Explicit verified mapping connects the token to ONE authorized channel ID
   * 3. Target channel exists in verified catalog, is active (active !== false), and sport is compatible
   * 4. Channel contains at least one authentic, accessible stream URL (http/https)
   *
   * If ANY step of this chain is unverified, the channel is rejected and excluded.
   * If zero channels pass, "Live channel unavailable" is displayed.
   */
  validateAuthorizationChain(token, channel, event) {
    // 1. API Broadcaster Token check
    if (!token || typeof token !== 'string' || token.trim().length < 2) {
      return { valid: false, reason: 'Invalid or missing API broadcaster token' };
    }

    // 2. Verified Mapping check
    if (!channel || !channel.id) {
      return { valid: false, reason: 'No mapped channel provided' };
    }

    // 3. Authorized Channel check (active, verified catalog, strict sport separation)
    if (channel.active === false) {
      return { valid: false, reason: 'Channel marked inactive in catalog' };
    }

    if (event) {
      const evSport = (event.sport || event.sportName || '').toLowerCase().trim();
      const chName = (channel.name || '').toLowerCase();
      
      // Strict Sport Separation (Never assign Cricket to Football, Football to Cricket, etc.)
      const isCricketEvent = evSport.includes('cricket');
      const isFootballEvent = evSport.includes('football') || evSport.includes('soccer');
      const isTennisEvent = evSport.includes('tennis');
      const isMotorsportEvent = evSport.includes('motor') || evSport.includes('f1') || evSport.includes('racing');

      if (isFootballEvent && (chName.includes('cricket') || chName.includes('willow'))) {
        return { valid: false, reason: 'Sport mismatch: Cricket channel assigned to Football event' };
      }
      if (isCricketEvent && (chName.includes('premier league') || chName.includes('football') || chName.includes('f1') || chName.includes('racing') || chName.includes('tennis'))) {
        return { valid: false, reason: 'Sport mismatch: Non-cricket channel assigned to Cricket event' };
      }
      if (isTennisEvent && (chName.includes('cricket') || chName.includes('willow') || chName.includes('premier league'))) {
        return { valid: false, reason: 'Sport mismatch: Non-tennis channel assigned to Tennis event' };
      }
      if (isMotorsportEvent && (chName.includes('cricket') || chName.includes('willow') || chName.includes('football'))) {
        return { valid: false, reason: 'Sport mismatch: Non-motorsport channel assigned to Motorsport event' };
      }
    }

    // 4. Authorized Stream check
    const streamUrl = channel.stream_url || channel.url || channel.streamUrl;
    const hasDirectUrl = typeof streamUrl === 'string' && streamUrl.startsWith('http');
    const hasArrayStream = Array.isArray(channel.streams) && channel.streams.some(s => s && typeof s.url === 'string' && s.url.startsWith('http'));

    if (!hasDirectUrl && !hasArrayStream) {
      return { valid: false, reason: 'No authorized HTTP/HTTPS stream available on channel' };
    }

    return { valid: true };
  }

  /**
   * Precise whole-word and token matching between broadcaster metadata and internal channel/alias names.
   * Strictly prevents substring false positives (e.g. 'TNT Sports' or 'Sports' will NEVER match 'T Sports').
   */
  isBroadcasterMatch(token, aliasOrName) {
    if (!token || !aliasOrName) return false;
    const t = this.normalizeBroadcasterName(token);
    const a = this.normalizeBroadcasterName(aliasOrName);
    if (!t || !a) return false;
    if (t === a) return true;

    const tWords = t.split(/\s+/).filter(Boolean);
    const aWords = a.split(/\s+/).filter(Boolean);
    if (tWords.length === 0 || aWords.length === 0) return false;

    // Never match if alias has more words than token (e.g. token "sports" matching alias "t sports")
    if (tWords.length < aWords.length && aWords.length > 1) return false;

    // Every word of the alias/channel must exist as an EXACT whole word in the token words
    for (const aw of aWords) {
      if (!tWords.includes(aw)) return false;
    }
    return true;
  }

  /**
   * Match authentic broadcaster tokens against available active sports channels.
   * PRODUCTION SAFEGUARD:
   * - 1 token maps strictly to 1 verified channel.
   * - Generic network and OTT tokens are blocked.
   * - Validates complete 4-step authorization chain.
   */
  findMatchingChannelsForBroadcaster(rawBroadcaster, sportsChannels, event) {
    if (!rawBroadcaster || !Array.isArray(sportsChannels) || sportsChannels.length === 0) {
      return [];
    }

    const aliases = this.getBroadcasterAliases();
    // Split on delimiters (comma, semicolon, slash, pipe, 'and', '&')
    const tokens = String(rawBroadcaster)
      .split(/[,/|;+&]|\band\b|\bor\b/i)
      .map(t => t.trim())
      .filter(Boolean);

    const matchedChannels = [];
    const matchedIds = new Set();

    for (const token of tokens) {
      const normToken = this.normalizeBroadcasterName(token);
      if (!normToken || normToken.length < 2) continue;

      // Reject banned generic networks or OTT names (both raw token and normalized)
      if (this.isBannedNetworkOrOttName(token) || this.isBannedNetworkOrOttName(normToken)) {
        continue;
      }

      let foundForToken = false;

      // 1. Direct Alias Lookup with whole-word verification
      for (const [aliasKey, channelIds] of Object.entries(aliases)) {
        if (this.isBroadcasterMatch(token, aliasKey)) {
          for (const cid of channelIds) {
            const ch = sportsChannels.find(c => (c.id === cid || c.id === `ch-${cid}`) && c.active !== false);
            if (ch) {
              const chainCheck = this.validateAuthorizationChain(token, ch, event);
              if (chainCheck.valid && !matchedIds.has(ch.id)) {
                matchedIds.add(ch.id);
                matchedChannels.push(ch);
                foundForToken = true;
                break; // STRICT 1-TO-1: 1 token maps to 1 authorized channel
              }
            }
          }
          if (foundForToken) break;
        }
      }

      // 2. Direct Channel Name Comparison with whole-word verification
      if (!foundForToken) {
        for (const ch of sportsChannels) {
          if (ch.active === false) continue;
          if (this.isBroadcasterMatch(token, ch.name)) {
            const chainCheck = this.validateAuthorizationChain(token, ch, event);
            if (chainCheck.valid && !matchedIds.has(ch.id)) {
              matchedIds.add(ch.id);
              matchedChannels.push(ch);
              break; // STRICT 1-TO-1
            }
          }
        }
      }
    }

    return matchedChannels;
  }

  /**
   * Extract all authentic broadcaster string tokens and fields from an API event payload
   */
  collectAllApiBroadcasterTokens(event) {
    if (!event) return [];
    const rawList = [];

    const addRaw = (val, fieldName) => {
      if (!val) return;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed) rawList.push({ text: trimmed, field: fieldName });
      } else if (Array.isArray(val)) {
        val.forEach(item => addRaw(item, fieldName));
      } else if (typeof val === 'object') {
        const candidate = val.name || val.channelName || val.channel || val.tvStation || val.broadcaster || val.strTVStation;
        if (candidate && typeof candidate === 'string') {
          addRaw(candidate, fieldName);
        }
      }
    };

    addRaw(event.broadcaster, 'event.broadcaster');
    addRaw(event.broadcasters, 'event.broadcasters');
    addRaw(event.strTVStation, 'event.strTVStation');
    addRaw(event.tvStation, 'event.tvStation');
    addRaw(event.broadcast, 'event.broadcast');
    addRaw(event.channelName, 'event.channelName');
    addRaw(event.broadcastingChannel, 'event.broadcastingChannel');

    // Split compound strings into distinct normalized tokens
    const tokens = [];
    const seenTokenTexts = new Set();

    for (const item of rawList) {
      const parts = String(item.text)
        .split(/[,/|;+&]|\band\b|\bor\b/i)
        .map(p => p.trim())
        .filter(Boolean);

      for (const part of parts) {
        const norm = this.normalizeBroadcasterName(part);
        if (norm && norm.length >= 2 && !seenTokenTexts.has(norm)) {
          seenTokenTexts.add(norm);
          tokens.push({ text: part, normalized: norm, field: item.field });
        }
      }
    }

    return tokens;
  }

  /**
   * Intelligently pull, rank and connect authentic Sports channels to any match event.
   * Strictly adheres to Master Instructions: Real Data Integrity, Strict Sport Separation,
   * Channel Priority & Selection rules, and no fake/random channel assignment.
   */
  matchLiveStream(event) {
    if (!event) return { hasStream: false, streams: [], broadcastChannels: [], broadcastingChannelDetails: [], verificationSource: 'unverified', sourceField: null, verificationDetail: 'No event provided' };

    // Common event properties
    const sport = (event.sport || event.sportName || '').toLowerCase();
    const tourn = (event.tournament || event.league || event.seriesName || '').toLowerCase();
    const title = (event.title || '').toLowerCase();
    const eventId = String(event.id || event.rawId || event.idEvent || '');
    const sportsChannels = this.getAllSportsChannels();

    const verifiedChannelEntries = [];
    const seenChannelIds = new Set();

    // -------------------------------------------------------------------------------------
    // 1. Direct API Broadcaster / TV Station Auto Matching (HIGHEST PRIORITY - Direct API)
    // -------------------------------------------------------------------------------------
    const apiTokens = this.collectAllApiBroadcasterTokens(event);
    for (const token of apiTokens) {
      const matchedChannels = this.findMatchingChannelsForBroadcaster(token.text, sportsChannels, event);
      for (const ch of matchedChannels) {
        if (!seenChannelIds.has(ch.id)) {
          seenChannelIds.add(ch.id);
          const vDetail = `Direct API broadcaster token "${token.text}" from [${token.field}] matched authorized channel "${ch.name}" (${ch.id})`;
          
          // Save to audit cache for future fast resolution
          this.saveEventChannelMap(event, ch.id, {
            verificationSource: 'direct_api',
            sourceField: token.field,
            verificationDetail: vDetail
          });

          verifiedChannelEntries.push({
            channel: ch,
            source: `Direct API: ${token.text}`,
            sourceType: 'direct_api',
            sourceField: token.field,
            token: token.text,
            verificationDetail: vDetail
          });
        }
      }
    }

    // -------------------------------------------------------------------------------------
    // 2. Direct Explicit Channel ID declared in API response (Direct API Verified)
    // -------------------------------------------------------------------------------------
    const explicitCids = [];
    if (typeof event.channelId === 'string' && event.channelId.trim()) explicitCids.push(event.channelId.trim());
    if (Array.isArray(event.channelIds)) {
      event.channelIds.forEach(cid => { if (typeof cid === 'string' && cid.trim()) explicitCids.push(cid.trim()); });
    }
    if (Array.isArray(event.channels)) {
      event.channels.forEach(c => {
        if (typeof c === 'string' && c.trim()) explicitCids.push(c.trim());
        else if (c && c.id && typeof c.id === 'string') explicitCids.push(c.id.trim());
      });
    }

    for (const cid of explicitCids) {
      const explicitCh = sportsChannels.find(c => (c.id === cid || c.id === `ch-${cid}`) && c.active !== false);
      if (explicitCh && !seenChannelIds.has(explicitCh.id)) {
        const chainCheck = this.validateAuthorizationChain(cid, explicitCh, event);
        if (chainCheck.valid) {
          seenChannelIds.add(explicitCh.id);
          const vDetail = `API event payload explicitly declared channelId "${cid}" -> ${explicitCh.name}`;
          verifiedChannelEntries.push({
            channel: explicitCh,
            source: 'Direct API (Channel ID)',
            sourceType: 'direct_api',
            sourceField: 'event.channelId',
            token: cid,
            verificationDetail: vDetail
          });
        }
      }
    }

    // -------------------------------------------------------------------------------------
    // 3. Direct Authenticated Custom Streams on event payload (Direct API Verified)
    // -------------------------------------------------------------------------------------
    let directApiStreams = [];
    if (Array.isArray(event.streams) && event.streams.length > 0) {
      const validStreams = event.streams.filter(s => s && s.url && typeof s.url === 'string' && s.url.startsWith('http'));
      if (validStreams.length > 0) {
        directApiStreams = validStreams;
      }
    }

    // -------------------------------------------------------------------------------------
    // 4. Verified Logic-Based Sources (Second Priority - ONLY if no Direct API matched)
    // -------------------------------------------------------------------------------------
    if (verifiedChannelEntries.length === 0 && directApiStreams.length === 0) {
      // 4a. Reliable Mapped Channel Check (Authenticated Persistent Audit Cache)
      const mappedCh = this.getMappedChannel(event);
      if (mappedCh && mappedCh.active !== false && !seenChannelIds.has(mappedCh.id)) {
        const pUrl = mappedCh.stream_url || mappedCh.url || mappedCh.streamUrl;
        if (pUrl) {
          seenChannelIds.add(mappedCh.id);
          const entry = mappedCh._mappingEntry || {};
          const vDetail = entry.verificationDetail || `Verified event mapping from persistent audit cache for event ${eventId}`;
          verifiedChannelEntries.push({
            channel: mappedCh,
            source: 'Official Audit Cache',
            sourceType: 'verified_logic',
            sourceField: entry.sourceField || 'persistent_audit_cache',
            token: eventId,
            verificationDetail: vDetail
          });
        }
      }

      // 4b. Official WWE Flagship Franchise Contract (Verified Logic-Based)
      const isWwe = sport === 'wwe' || tourn.includes('wwe') || title.includes('wwe raw') || title.includes('monday night raw') || 
                    title.includes('wwe smackdown') || title.includes('friday night smackdown') || title.includes('wwe nxt');
      if (isWwe) {
        const wweChannel = sportsChannels.find(c => 
          (c.id === 'jio-162' || c.id === 'jio-3510' || c.id === 'ch-sony-sports-ten-1-hd' || c.id === 'sports-wwe-network' || (c.name || '').toLowerCase().includes('sony ten 1')) && 
          c.active !== false && (c.stream_url || c.url || c.streamUrl)
        );
        if (wweChannel && !seenChannelIds.has(wweChannel.id)) {
          seenChannelIds.add(wweChannel.id);
          verifiedChannelEntries.push({
            channel: wweChannel,
            source: 'Official WWE Contract',
            sourceType: 'verified_logic',
            sourceField: 'official_franchise_contract',
            token: 'WWE Contract',
            verificationDetail: 'WWE official exclusive South Asian broadcast rights contract -> Sony Sports Ten 1 HD'
          });
        }
      }

      // 4c. Explicit Event ID match (Verified Logic-Based)
      if (eventId && sportsChannels.length > 0) {
        const explicitIdCh = sportsChannels.find(ch => 
          ch.active !== false && Array.isArray(ch.events) && ch.events.map(String).includes(eventId) && (ch.stream_url || ch.url || ch.streamUrl)
        );
        if (explicitIdCh && !seenChannelIds.has(explicitIdCh.id)) {
          seenChannelIds.add(explicitIdCh.id);
          verifiedChannelEntries.push({
            channel: explicitIdCh,
            source: 'Verified Event ID',
            sourceType: 'verified_logic',
            sourceField: 'verified_event_id',
            token: eventId,
            verificationDetail: `Event ID ${eventId} explicitly verified on channel ${explicitIdCh.name}`
          });
        }
      }
    }

    // -------------------------------------------------------------------------------------
    // 5. Verification Check: No guessed/unverified channels allowed
    // -------------------------------------------------------------------------------------
    if (verifiedChannelEntries.length === 0 && directApiStreams.length === 0) {
      const devEvId = eventId || 'UNKNOWN';
      const devSport = (sport || 'UNKNOWN').toUpperCase();
      const devLeague = tourn || 'UNKNOWN';
      const devHome = event.homeTeam?.name || event.homeTeam || event.team1?.name || (Array.isArray(event.teams) ? event.teams[0] : '') || 'TBD';
      const devAway = event.awayTeam?.name || event.awayTeam || event.team2?.name || (Array.isArray(event.teams) ? event.teams[1] : '') || 'TBD';
      const devBcast = apiTokens.length > 0 ? apiTokens.map(t => t.text).join(', ') : (event.broadcaster || event.strTVStation || 'NONE');
      const devCid = event.channelId || (Array.isArray(event.channelIds) ? event.channelIds.join(', ') : 'NONE');
      const devReason = apiTokens.length > 0 ? 'NO_AUTHORIZED_CHANNEL_FOR_BROADCASTER' : 'NO_BROADCASTER_FROM_API';

      console.log(`[CHANNEL_RESOLVER] ${devEvId} ${devSport} "${devLeague}" "${devHome}" "${devAway}" "${devBcast}" "${devCid}" NONE ${devReason} 0`);
      console.log(`EVENT_ID=${devEvId} SPORT=${devSport} LEAGUE="${devLeague}" HOME_TEAM="${devHome}" AWAY_TEAM="${devAway}" BROADCASTER_FROM_API="${devBcast}" CHANNEL_ID_FROM_API="${devCid}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${devReason}" AUTHORIZED_STREAM_COUNT=0`);

      return {
        hasStream: false,
        streams: [],
        broadcastChannels: [],
        broadcastingChannelDetails: [],
        verificationSource: 'unverified',
        sourceField: null,
        verificationDetail: 'No verified broadcast data in API response or authentic event mapping'
      };
    }

    // -------------------------------------------------------------------------------------
    // 6. Aggregate All Verified Channels and Build Distinct Servers (Deduplicated)
    // -------------------------------------------------------------------------------------
    const allStreams = [];
    const broadcastingChannelDetails = [];
    const seenStreamUrls = new Set();

    for (const entry of verifiedChannelEntries) {
      const ch = entry.channel;
      const channelServers = [];
      const pUrl = ch.stream_url || ch.url || ch.streamUrl;
      const bUrls = ch.backupUrls || (ch.backup_stream_url ? [ch.backup_stream_url] : []);

      // If channel contains an authentic streams array with specific server names/labels
      if (Array.isArray(ch.streams) && ch.streams.length > 0) {
        ch.streams.forEach((cs, sIdx) => {
          if (cs && cs.url && typeof cs.url === 'string') {
            const normUrl = cs.url.trim().toLowerCase();
            if (!seenStreamUrls.has(normUrl)) {
              seenStreamUrls.add(normUrl);
              const serverLabel = cs.serverLabel || (sIdx === 0 ? 'SERVER 1 (1080P HD)' : `SERVER ${sIdx + 1} (BACKUP)`);
              const sObj = {
                name: cs.name || `${ch.name} (${serverLabel})`,
                serverLabel: serverLabel,
                channelName: ch.name,
                channelId: ch.id,
                channelLogo: ch.logo,
                url: cs.url,
                backupUrls: [],
                quality: cs.quality || (sIdx === 0 ? '1080p FHD' : '720p HD'),
                isHD: cs.isHD !== false,
                category: ch.category || 'Sports',
                source: entry.source,
                sourceType: entry.sourceType
              };
              channelServers.push(sObj);
              allStreams.push(sObj);
            }
          }
        });
      }

      // Primary stream URL
      if (pUrl && typeof pUrl === 'string') {
        const normPurl = pUrl.trim().toLowerCase();
        if (!seenStreamUrls.has(normPurl)) {
          seenStreamUrls.add(normPurl);
          const pServer = {
            name: `${ch.name} (Server 1 HD)`,
            serverLabel: 'SERVER 1 (1080P HD)',
            channelName: ch.name,
            channelId: ch.id,
            channelLogo: ch.logo,
            url: pUrl,
            backupUrls: bUrls,
            backupUrl: bUrls[0] || pUrl,
            quality: '1080p FHD',
            isHD: ch.isHD !== false,
            category: ch.category || 'Sports',
            source: entry.source,
            sourceType: entry.sourceType
          };
          channelServers.push(pServer);
          allStreams.push(pServer);
        }
      }

      // Secondary / Backup stream URLs
      bUrls.forEach((bUrl, bIdx) => {
        if (bUrl && typeof bUrl === 'string') {
          const normBurl = bUrl.trim().toLowerCase();
          if (!seenStreamUrls.has(normBurl)) {
            seenStreamUrls.add(normBurl);
            const bServer = {
              name: `${ch.name} (Server ${bIdx + 2} Backup)`,
              serverLabel: `SERVER ${bIdx + 2} (BACKUP)`,
              channelName: ch.name,
              channelId: ch.id,
              channelLogo: ch.logo,
              url: bUrl,
              backupUrls: [],
              quality: '720p HD',
              isHD: ch.isHD !== false,
              category: ch.category || 'Sports',
              source: entry.source,
              sourceType: entry.sourceType
            };
            channelServers.push(bServer);
            allStreams.push(bServer);
          }
        }
      });

      broadcastingChannelDetails.push({
        id: ch.id,
        name: ch.name,
        logo: ch.logo,
        category: ch.category || 'Sports',
        quality: ch.isHD !== false ? '1080p FHD' : '720p HD',
        streamUrl: pUrl,
        backupUrls: bUrls,
        source: entry.source,
        sourceType: entry.sourceType,
        sourceField: entry.sourceField,
        verificationDetail: entry.verificationDetail,
        servers: channelServers
      });
    }

    // Direct API stream objects (e.g. from Sportradar or custom authorized API streams)
    if (directApiStreams.length > 0) {
      directApiStreams.forEach((st, sIdx) => {
        const normUrl = (st.url || '').trim().toLowerCase();
        if (normUrl && !seenStreamUrls.has(normUrl)) {
          seenStreamUrls.add(normUrl);
          const stName = st.name || st.channelName || `Live Stream ${sIdx + 1}`;
          const serverLabel = st.serverLabel || (sIdx === 0 ? 'SERVER 1 (DIRECT API)' : `SERVER ${sIdx + 1} (BACKUP)`);
          const sObj = {
            name: stName,
            serverLabel: serverLabel,
            channelName: st.channelName || stName,
            channelId: st.channelId || `api-stream-${sIdx}`,
            channelLogo: st.channelLogo || st.logo || './assets/category-logos/live-events-hd.png',
            url: st.url,
            backupUrls: [],
            quality: st.quality || (sIdx === 0 ? '1080p FHD' : '720p HD'),
            isHD: st.isHD !== false,
            category: st.category || 'Sports',
            source: 'Direct API Stream',
            sourceType: 'direct_api'
          };
          allStreams.push(sObj);
          broadcastingChannelDetails.push({
            id: sObj.channelId,
            name: sObj.channelName,
            logo: sObj.channelLogo,
            category: sObj.category,
            quality: sObj.quality,
            streamUrl: sObj.url,
            backupUrls: [],
            source: 'Direct API Stream',
            sourceType: 'direct_api',
            sourceField: 'event.streams',
            verificationDetail: `API payload contained verified direct stream URL for ${sObj.channelName}`,
            servers: [sObj]
          });
        }
      });
    }

    const devEvId = eventId || 'UNKNOWN';
    const devSport = (sport || 'UNKNOWN').toUpperCase();
    const devLeague = tourn || 'UNKNOWN';
    const devHome = event.homeTeam?.name || event.homeTeam || event.team1?.name || (Array.isArray(event.teams) ? event.teams[0] : '') || 'TBD';
    const devAway = event.awayTeam?.name || event.awayTeam || event.team2?.name || (Array.isArray(event.teams) ? event.teams[1] : '') || 'TBD';
    const devBcast = apiTokens.length > 0 ? apiTokens.map(t => t.text).join(', ') : (event.broadcaster || event.strTVStation || 'NONE');
    const devCid = event.channelId || (Array.isArray(event.channelIds) ? event.channelIds.join(', ') : 'NONE');
    const devMatchRes = broadcastingChannelDetails.map(c => c.name).join(', ') || 'NONE';
    const devReason = verifiedChannelEntries[0]?.verificationDetail || (allStreams.length > 0 ? 'DIRECT_API_STREAM' : 'API_BROADCASTER_MATCH');
    const devStreamCnt = allStreams.length;

    console.log(`[CHANNEL_RESOLVER] ${devEvId} ${devSport} "${devLeague}" "${devHome}" "${devAway}" "${devBcast}" "${devCid}" "${devMatchRes}" ${devReason} ${devStreamCnt}`);
    console.log(`EVENT_ID=${devEvId} SPORT=${devSport} LEAGUE="${devLeague}" HOME_TEAM="${devHome}" AWAY_TEAM="${devAway}" BROADCASTER_FROM_API="${devBcast}" CHANNEL_ID_FROM_API="${devCid}" CHANNEL_MATCH_RESULT="${devMatchRes}" MATCH_REASON="${devReason}" AUTHORIZED_STREAM_COUNT=${devStreamCnt}`);

    return {
      hasStream: allStreams.length > 0,
      streams: allStreams,
      broadcastChannels: broadcastingChannelDetails.map(c => c.name),
      broadcastingChannelDetails: broadcastingChannelDetails,
      verificationSource: verifiedChannelEntries[0]?.sourceType || (directApiStreams.length > 0 ? 'direct_api' : 'unverified'),
      sourceField: verifiedChannelEntries[0]?.sourceField || (directApiStreams.length > 0 ? 'event.streams' : null),
      verificationDetail: verifiedChannelEntries.map(e => e.verificationDetail).join('; ') || 'Verified direct stream'
    };
  }

  /**
   * Format ISO date/timestamp to locale time string
   */
  static formatEventTime(timestamp, timezone = 'Asia/Dhaka') {
    if (!timestamp) return '';
    try {
      const opts = { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true };
      return new Intl.DateTimeFormat('en-US', opts).format(new Date(timestamp));
    } catch (e) {
      return '';
    }
  }

  /**
   * Check if an event is finished
   */
  static isEventFinished(event) {
    if (!event) return false;
    const status = String(event.status || '').toLowerCase().trim();
    if (status === 'live') return false;
    // Catch all typical API-Football, ESPN, TheSportsDB, and Cricket finished statuses
    const finishedStatuses = [
      'finished', 'ft', 'ended', 'completed', 'match finished', 'abandoned',
      'postponed', 'cancelled', 'match abandoned', 'match drawn', 'no result',
      'match won', 'won by', 'final', 'status_final'
    ];
    
    // Check strict status match
    if (finishedStatuses.includes(status)) return true;

    // Check status text for keywords
    const statusTxt = (String(event.statusText || '') + ' ' + String(event.matchDesc || '')).toLowerCase();
    if (/(^|\b)(won by|won the|match won|match tied|match drawn|match ended|no result|abandoned|concluded|completed|winner)(\b|$)/i.test(statusTxt)) {
      return true;
    }

    // Check if event timestamp is way too old (e.g., > 12 hours ago)
    if (event.timestamp) {
       const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
       if (event.timestamp < twelveHoursAgo) {
          return true; // Match is too old to still be live or upcoming realistically without status update
       }
    }

    return false;
  }

  isEventFinished(event) {
    return SportsCoordinator.isEventFinished(event);
  }


  /**
   * Determine if an event is high-profile (Special/Hot match)
   */
  isSpecialMatch(ev) {
    if (!ev) return false;
    const title = (ev.title || ev.name || '').toLowerCase();
    const tournament = (ev.tournament || ev.league || ev.seriesName || '').toLowerCase();
    const t1 = (ev.team1?.name || ev.homeTeam?.name || '').toLowerCase();
    const t2 = (ev.team2?.name || ev.awayTeam?.name || '').toLowerCase();
    const teams = [t1, t2];

    const hotKeywords = ['world cup', 'champions league', 'premier league', 'la liga', 'serie a', 'wwe', 'wrestlemania', 'summerslam', 'royal rumble', 'ipl', 'bpl', 'psl', 'world t20', 'asia cup', 'euro', 'copa america'];
    const hotTeams = ['india', 'australia', 'england', 'argentina', 'brazil', 'portugal', 'real madrid', 'barcelona', 'manchester united', 'manchester city', 'arsenal', 'liverpool', 'chelsea', 'bayern munich', 'psg', 'juventus', 'bangladesh', 'pakistan'];

    if (ev.isSpecial || ev.isHot) return true;
    if (hotKeywords.some(k => tournament.includes(k) || title.includes(k))) return true;
    if (teams.some(team => hotTeams.some(ht => team === ht || team.includes(ht)))) return true;

    return false;
  }


  /**
   * Generate a canonical fingerprint for matching identical sports events across different APIs
   */
  static getMatchFingerprint(ev) {
    if (!ev) return null;
    const sp = (ev.sport || '').toLowerCase().trim().replace(/soccer/, 'football');

    const cleanTeam = (name) => (name || '')
      .toLowerCase()
      .replace(/\b(fc|cf|sc|ac|afc|club|the|women|w)\b/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const isPlaceholder = (s) => {
      if (!s) return true;
      const lower = s.toLowerCase().trim();
      return lower === 'team 1' || lower === 'team 2' || lower === 'player 1' || lower === 'player 2' ||
             lower === 'home team' || lower === 'away team' || lower === 'home' || lower === 'away' ||
             lower === 'tbd' || lower === 'tba' || lower === 'unknown' || lower === 'to be decided';
    };

    const t1Raw = (ev.team1?.name || ev.homeTeam?.name || '').trim();
    const t2Raw = (ev.team2?.name || ev.awayTeam?.name || '').trim();

    // If either participant is an unconfirmed placeholder, reject it
    if (isPlaceholder(t1Raw) || isPlaceholder(t2Raw)) {
      return null;
    }

    const t1 = cleanTeam(t1Raw);
    const t2 = cleanTeam(t2Raw);

    let dateStr = (ev.date || '').split('T')[0];
    if (!dateStr && ev.timestamp) {
      try {
        const ts = ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp;
        dateStr = new Date(ts).toISOString().split('T')[0];
      } catch (e) {}
    }

    if (t1 && t2) {
      const sorted = [t1, t2].sort().join('__vs__');
      return `${sp}::${sorted}::${dateStr || 'nodate'}`;
    }

    const title = cleanTeam(ev.title || ev.name || '');
    if (!title || title.includes('tbd vs tbd') || title.includes('player 1 vs player 2') || title.includes('tba vs tba')) {
      return null;
    }
    return `${sp}::${title}::${dateStr || 'nodate'}`;
  }

  /**
   * Merge two instances of the same logical match from different sources
   */
  static mergeMatchEvents(existing, incoming) {
    if (!existing || !incoming) return existing || incoming;

    const statusPriority = { live: 3, upcoming: 2, finished: 1 };
    const exP = statusPriority[(existing.status || '').toLowerCase()] || 0;
    const inP = statusPriority[(incoming.status || '').toLowerCase()] || 0;

    if (inP > exP) {
      existing.status = incoming.status;
      existing.statusText = incoming.statusText || existing.statusText;
      existing.statusLabel = incoming.statusLabel || existing.statusLabel;
      existing.timeOrTimer = incoming.timeOrTimer || existing.timeOrTimer;
    }

    // Stream & broadcaster priority: if incoming has authentic stream, merge it
    if ((!existing.hasStream || !existing.channelId) && (incoming.hasStream && incoming.channelId)) {
      existing.hasStream = true;
      existing.channelId = incoming.channelId;
      existing.channelName = incoming.channelName || existing.channelName;
      existing.channelLogo = incoming.channelLogo || existing.channelLogo;
      existing.streams = incoming.streams || existing.streams;
      existing.broadcastChannels = incoming.broadcastChannels || existing.broadcastChannels;
      existing.broadcastingChannelDetails = incoming.broadcastingChannelDetails || existing.broadcastingChannelDetails;
      existing.verificationSource = incoming.verificationSource || existing.verificationSource;
      existing.sourceField = incoming.sourceField || existing.sourceField;
      existing.verificationDetail = incoming.verificationDetail || existing.verificationDetail;
    }

    if (!existing.broadcaster && incoming.broadcaster) {
      existing.broadcaster = incoming.broadcaster;
      existing.broadcasters = incoming.broadcasters || [incoming.broadcaster];
    }

    // Scores & logos enrichment
    if (!existing.score && incoming.score) {
      existing.score = incoming.score;
    }
    if (existing.team1 && incoming.team1) {
      if (!existing.team1.score && incoming.team1.score) existing.team1.score = incoming.team1.score;
      if (!existing.team1.overs && incoming.team1.overs) existing.team1.overs = incoming.team1.overs;
      if ((!existing.team1.logo || existing.team1.logo.includes('placeholder')) && incoming.team1.logo && !incoming.team1.logo.includes('placeholder')) {
        existing.team1.logo = incoming.team1.logo;
      }
    }
    if (existing.team2 && incoming.team2) {
      if (!existing.team2.score && incoming.team2.score) existing.team2.score = incoming.team2.score;
      if (!existing.team2.overs && incoming.team2.overs) existing.team2.overs = incoming.team2.overs;
      if ((!existing.team2.logo || existing.team2.logo.includes('placeholder')) && incoming.team2.logo && !incoming.team2.logo.includes('placeholder')) {
        existing.team2.logo = incoming.team2.logo;
      }
    }

    return existing;
  }

  /**
   * Determine if an event is obscure/noise and should be hidden
   */
  isObscureNoiseMatch(ev) {
    if (!ev) return false;
    const title = (ev.title || ev.name || '').toLowerCase();
    const tournament = (ev.tournament || ev.league || ev.seriesName || '').toLowerCase();
    
    // Obscure keywords to filter out (e.g. youth matches unless special)
    const noiseKeywords = [
      'u19 ', ' u19', 'u20 ', ' u20', 'u21 ', ' u21', 'u23 ', ' u23', 'youth', 'reserve'
    ];
    
    // Except if it's special
    if (ev.isSpecial || ev.isHot) return false;

    // Filter out if it matches noise keywords
    if (noiseKeywords.some(k => tournament.includes(k) || title.includes(k))) return true;

    return false;
  }

  curateEvents(rawEvents) {
    const now = Date.now();
    const tz = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    // Maximum 14 days ahead for cricket/special matches, 7 days for football, 30 days for tennis/basketball/rugby
    const maxCricketUpcomingTime = now + (14 * 24 * 60 * 60 * 1000);
    const maxFootballUpcomingTime = now + (7 * 24 * 60 * 60 * 1000);
    const maxOtherUpcomingTime = now + (30 * 24 * 60 * 60 * 1000);
    const minLiveTime = now - (12 * 60 * 60 * 1000);

    const liveList = [];
    const upcomingList = [];
    const finishedList = [];
    const seenCurationFingerprints = new Map();

    rawEvents.forEach(ev => {
      if (!ev || !ev.id) return;
      
      const fp = SportsCoordinator.getMatchFingerprint(ev);
      if (!fp) return; // Discard invalid or placeholder events

      if (seenCurationFingerprints.has(fp)) {
        const existing = seenCurationFingerprints.get(fp);
        SportsCoordinator.mergeMatchEvents(existing, ev);
        return;
      }
      seenCurationFingerprints.set(fp, ev);
      
      // Ensure proper timestamp parsing and format matchTime in Asia/Dhaka BST
      if (ev.timestamp && ev.timestamp < 10000000000) {
        ev.timestamp *= 1000;
      } else if (!ev.timestamp && ev.startTime) {
        let s = String(ev.startTime).trim();
        if (!s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
        ev.timestamp = new Date(s).getTime();
      }

      if (ev.timestamp && !isNaN(ev.timestamp)) {
        ev.matchTime = SportsCoordinator.formatEventTime(ev.timestamp, tz);
        try {
          ev.date = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(ev.timestamp));
        } catch (e) {}
      }

      // Check if finished via helper
      const isFin = this.isEventFinished(ev);
      if (isFin) {
        ev.status = 'finished';
        ev.statusLabel = 'FINISHED';
        if (!ev.timeOrTimer || ev.timeOrTimer.toLowerCase() === 'live') {
          ev.timeOrTimer = 'FT';
        }
      }

      const status = (ev.status || 'upcoming').toLowerCase();
      const sport = (ev.sport || '').toLowerCase();
      const isSpecial = this.isSpecialMatch(ev);
      ev.isSpecial = isSpecial;
      if (isSpecial) {
        ev.isHot = true;
      }

      const isNoise = this.isObscureNoiseMatch(ev);

      if (isFin || status === 'finished') {
        // Collect finished candidates
        finishedList.push(ev);
      } else if (status === 'live') {
        // Keep special live matches and top quality live matches, skip low-tier noise
        if (!isNoise || isSpecial) {
          liveList.push(ev);
        }
      } else if (status === 'upcoming') {
        const matchTime = ev.timestamp || now;
        let maxTime = maxOtherUpcomingTime;
        if (sport === 'cricket') maxTime = maxCricketUpcomingTime;
        else if (sport === 'football' || sport === 'soccer') maxTime = maxFootballUpcomingTime;
        if (matchTime >= minLiveTime && (matchTime <= maxTime || isSpecial)) {
          // If special or not obscure noise, include it
          if (isSpecial || !isNoise) {
            upcomingList.push(ev);
          }
        }
      }
    });

    // 1. Sort Live: Special matches first
    liveList.sort((a, b) => {
      const spA = a.isSpecial ? 1 : 0;
      const spB = b.isSpecial ? 1 : 0;
      return spB - spA;
    });

    // 2. Sort Upcoming: Special first if same time, chronological
    upcomingList.sort((a, b) => {
      const spA = a.isSpecial ? 1 : 0;
      const spB = b.isSpecial ? 1 : 0;
      if (spB !== spA) return spB - spA;
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    // 3. Finished Matches: Keep full pool of concluded games so Finished tab works seamlessly
    finishedList.sort((a, b) => {
      const spA = a.isSpecial ? 1 : 0;
      const spB = b.isSpecial ? 1 : 0;
      if (spB !== spA) return spB - spA;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    const curatedFinished = finishedList.slice(0, 50);

    // Combine: Live (top quality) -> Upcoming -> Finished (placed at the bottom per Rule 8)
    const combined = [...liveList, ...upcomingList, ...curatedFinished];

    // Ensure all curated events have streams and sports channels attached
    combined.forEach(ev => {
      const streamInfo = this.matchLiveStream(ev);
      ev.verificationSource = streamInfo.verificationSource || 'unverified';
      ev.sourceField = streamInfo.sourceField || null;
      ev.verificationDetail = streamInfo.verificationDetail || 'No verification';
      if (streamInfo && streamInfo.hasStream) {
        ev.streams = streamInfo.streams;
        ev.broadcastChannels = streamInfo.broadcastChannels;
        ev.broadcastingChannelDetails = streamInfo.broadcastingChannelDetails;
        ev.hasStream = true;
        ev.channelId = streamInfo.streams[0]?.channelId || ev.channelId;
      } else {
        ev.streams = [];
        ev.broadcastChannels = [];
        ev.broadcastingChannelDetails = [];
        ev.hasStream = false;
        ev.channelId = null;
      }
    });

    return combined;
  }
  async fetchAllEvents(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && (now - this.lastFetchTime < this.fetchTtl) && this.events.length > 0) {
      return this.events;
    }

    if (this.inFlightFetch) {
      return this.inFlightFetch;
    }

    this.inFlightFetch = (async () => {
      console.log('[SportsCoordinator] Fetching real sports events...');
      const sofascoreEngine = window.sofascoreEngine;
      const cricketEngine = window.cricketEngine;
      const thesportsdbEngine = window.thesportsdbEngine;
      const wweEngine = window.wweEngine;

      const fetches = [
        sofascoreEngine ? sofascoreEngine.getAllMatches(forceRefresh) : Promise.resolve({ configured: false, events: [] }),
        cricketEngine ? cricketEngine.getAllMatches(forceRefresh) : Promise.resolve({ configured: false, events: [] }),
        thesportsdbEngine ? thesportsdbEngine.getAllMatches(forceRefresh) : Promise.resolve({ configured: false, events: [] }),
        wweEngine ? wweEngine.getAllEvents(forceRefresh) : Promise.resolve({ configured: false, events: [] })
      ];

      const results = await Promise.allSettled(fetches);

      const ssRes = results[0].status === 'fulfilled' ? results[0].value : { configured: false, error: 'network_error', message: 'SofaScore load failed', events: [] };
      const crRes = results[1].status === 'fulfilled' ? results[1].value : { configured: false, error: 'network_error', message: 'Cricket load failed', events: [] };
      const tsdbRes = (results[2] && results[2].status === 'fulfilled') ? results[2].value : { configured: false, events: [] };
      const wweRes = (results[3] && results[3].status === 'fulfilled') ? results[3].value : { configured: false, error: 'not_configured', message: 'WWE not configured', events: [] };

      // Record error states
      this.errors.sofascore = ssRes.error ? { error: ssRes.error, message: ssRes.message } : null;
      this.errors.cricket = crRes.error ? { error: crRes.error, message: crRes.message } : null;
      this.errors.wwe = (wweRes.error && wweRes.error !== 'not_configured') ? { error: wweRes.error, message: wweRes.message } : null;

      const ssEvents = Array.isArray(ssRes.events) ? ssRes.events : [];
      const crEvents = Array.isArray(crRes.events) ? crRes.events : [];
      const tsdbEvents = Array.isArray(tsdbRes.events) ? tsdbRes.events : [];
      const wweEvents = Array.isArray(wweRes.events) ? wweRes.events : [];

      // Update status reports
      this.statusReports.sofascore = {
        configured: ssRes.configured !== false,
        error: ssRes.error || null,
        message: ssRes.message || '',
        live: ssEvents.filter(e => e.status === 'live').length,
        upcoming: ssEvents.filter(e => e.status === 'upcoming').length,
        finished: ssEvents.filter(e => e.status === 'finished').length,
        total: ssEvents.length
      };

      this.statusReports.cricket = {
        configured: crRes.configured !== false,
        error: crRes.error || null,
        message: crRes.message || '',
        live: crEvents.filter(e => e.status === 'live').length,
        upcoming: crEvents.filter(e => e.status === 'upcoming').length,
        finished: crEvents.filter(e => e.status === 'finished').length,
        total: crEvents.length
      };

      this.statusReports.thesportsdb = {
        configured: tsdbRes.configured !== false,
        error: tsdbRes.error || null,
        message: tsdbRes.message || '',
        live: tsdbEvents.filter(e => e.status === 'live').length,
        upcoming: tsdbEvents.filter(e => e.status === 'upcoming').length,
        finished: tsdbEvents.filter(e => e.status === 'finished').length,
        total: tsdbEvents.length
      };

      this.statusReports.wwe = {
        configured: wweRes.configured === true,
        error: wweRes.error || null,
        message: wweRes.message || '',
        live: wweEvents.filter(e => e.status === 'live').length,
        upcoming: wweEvents.filter(e => e.status === 'upcoming').length,
        finished: wweEvents.filter(e => e.status === 'finished').length,
        total: wweEvents.length
      };

      // Deduplicate and merge events across all sources
      const eventMap = new Map();
      const fingerprintMap = new Map();

      const addList = (list) => {
        if (!Array.isArray(list)) return;
        list.forEach(ev => {
          if (!ev || !ev.id) return;

          // Reject corrupt, placeholder or mock events
          const id = String(ev.id || '');
          if (id.startsWith('cricket-upcoming-') || id.startsWith('cricket-live-') || id.startsWith('football-live-') || id.startsWith('dummy-') || id.startsWith('mock-') || id.startsWith('sample-')) {
            return;
          }

          const fp = SportsCoordinator.getMatchFingerprint(ev);
          if (!fp) {
            return;
          }

          const t1 = (ev.team1?.name || ev.homeTeam?.name || '').trim().toLowerCase();
          const t2 = (ev.team2?.name || ev.awayTeam?.name || '').trim().toLowerCase();

          const sp = (ev.sport || '').toLowerCase();

          // Cricket data MUST strictly come ONLY from Sportradar API
          if (sp === 'cricket') {
            const isSportradar = (ev.source && String(ev.source).toLowerCase().includes('sportradar')) ||
                                 String(ev.id).startsWith('cr-sportradar-') ||
                                 String(ev.id).startsWith('sr:sport_event:') ||
                                 String(ev.id).startsWith('sr-');
            if (!isSportradar) {
              return; // Block all other cricket sources
            }
          }

          // WWE Tab strictly accepts authentic WWE and AEW fixtures
          if (sp === 'wwe') {
            const text = `${ev.title || ''} ${ev.league || ''} ${ev.tournament || ''} ${t1} ${t2}`.toLowerCase();
            const isWrestling = text.includes('wwe') || text.includes('raw') || text.includes('smackdown') || text.includes('nxt') || text.includes('aew') || text.includes('ple') || text.includes('wrestle');
            if (!isWrestling) return;
          }

          // Attach stream match
          const streamInfo = this.matchLiveStream(ev);
          ev.verificationSource = streamInfo.verificationSource || 'unverified';
          ev.sourceField = streamInfo.sourceField || null;
          ev.verificationDetail = streamInfo.verificationDetail || 'No verification';
          if (streamInfo.hasStream) {
            ev.streams = streamInfo.streams;
            ev.broadcastChannels = streamInfo.broadcastChannels;
            ev.broadcastingChannelDetails = streamInfo.broadcastingChannelDetails;
            ev.hasStream = true;
            ev.channelId = streamInfo.streams[0]?.channelId || ev.channelId;
            if (!ev.broadcaster && streamInfo.streams[0]?.channelName && ev.source !== 'Sportradar' && ev.source !== 'Sportradar Live') {
              ev.broadcaster = streamInfo.streams[0].channelName;
            }
          } else {
            ev.streams = [];
            ev.broadcastChannels = [];
            ev.broadcastingChannelDetails = [];
            ev.hasStream = false;
            ev.channelId = null;
          }

          // Deduplicate: if match already seen by ID or canonical fingerprint, merge
          if (eventMap.has(ev.id)) {
            const existing = eventMap.get(ev.id);
            SportsCoordinator.mergeMatchEvents(existing, ev);
            return;
          }

          if (fingerprintMap.has(fp)) {
            const existingId = fingerprintMap.get(fp);
            const existing = eventMap.get(existingId);
            if (existing) {
              SportsCoordinator.mergeMatchEvents(existing, ev);
              return;
            }
          }

          fingerprintMap.set(fp, ev.id);
          eventMap.set(ev.id, ev);
        });
      };

      // Always merge base authentic multi-sport seed from events.json (ensuring Tennis, Basketball, Rugby, Baseball, etc. are always present)
      let seedEvents = [];
      try {
        const seedRes = await fetch('./events.json');
        if (seedRes.ok) {
          const sJson = await seedRes.json();
          if (Array.isArray(sJson)) seedEvents = sJson;
        }
      } catch (_) {}

      addList(seedEvents);
      addList(tsdbEvents);
      addList(ssEvents);
      addList(crEvents);
      addList(wweEvents);

      // STRICT RULE: Only authentic events from sports APIs are accepted. Never fabricate or fall back to dummy/mock data.

      const rawMerged = Array.from(eventMap.values());

      // Apply strict Smart Curation (Next 3 days only, Special Matches, max 2-3 finished)
      const curated = this.curateEvents(rawMerged);

      if (curated.length > 0) {
        this.saveLocalCache(curated, Date.now());
      } else if (this.events && this.events.length > 0) {
        console.warn('[SportsCoordinator] Fresh fetch returned 0 events; retaining current cached events');
      } else {
        this.events = curated;
      }

      if (typeof window !== 'undefined' && window.highfyEventEngine) {
        if (typeof window.highfyEventEngine.setEvents === 'function') {
          window.highfyEventEngine.setEvents(curated);
        } else if (typeof window.highfyEventEngine.processIncomingEvents === 'function') {
          window.highfyEventEngine.processIncomingEvents(curated);
        }
      }

      // Update status reports based on curated list
      const getSportStats = (sp) => {
        const spList = curated.filter(e => (e.sport || '').toLowerCase() === sp);
        return {
          live: spList.filter(e => e.status === 'live').length,
          upcoming: spList.filter(e => e.status === 'upcoming').length,
          finished: spList.filter(e => e.status === 'finished').length,
          total: spList.length
        };
      };

      const fbStats = getSportStats('football');
      this.statusReports.football = {
        ...this.statusReports.football,
        ...fbStats
      };

      const crStats = getSportStats('cricket');
      this.statusReports.cricket = {
        ...this.statusReports.cricket,
        ...crStats
      };

      const wweStats = getSportStats('wwe');
      this.statusReports.wwe = {
        ...this.statusReports.wwe,
        ...wweStats
      };

      this.inFlightFetch = null;
      console.log(`[SportsCoordinator] Curated ${curated.length} high-quality events (Live: ${curated.filter(e => e.status === 'live').length}, Upcoming: ${curated.filter(e => e.status === 'upcoming').length}, Finished: ${curated.filter(e => e.status === 'finished').length})`);
      return this.events;
    })();

    return this.inFlightFetch;
  }

  /**
   * Check if an event is today in Bangladesh timezone (Asia/Dhaka BST)
   */
  isEventToday(ev) {
    if (!ev) return false;
    const status = (ev.status || '').toLowerCase();
    if (status === 'live') return true;

    const tz = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    const now = new Date();

    let todayLocalStr = '';
    let nowHour = 12;
    try {
      todayLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      nowHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now), 10);
    } catch (e) {
      todayLocalStr = now.toISOString().split('T')[0];
    }

    if (ev.timestamp && !isNaN(ev.timestamp)) {
      const ts = ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp;
      const evDate = new Date(ts);
      let evLocalStr = '';
      let evHour = 12;
      try {
        evLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(evDate);
        evHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(evDate), 10);
      } catch (e) {
        evLocalStr = evDate.toISOString().split('T')[0];
      }

      // 1. Same calendar day in Bangladesh (Asia/Dhaka)
      if (evLocalStr === todayLocalStr) return true;

      // 2. Early morning matches (00:00 to 05:59) are part of tonight's sports night in Bangladesh
      const [evY, evM, evD] = evLocalStr.split(/[-/]/).map(Number);
      const [nowY, nowM, nowD] = todayLocalStr.split(/[-/]/).map(Number);
      const evDateOnly = new Date(Date.UTC(evY, evM - 1, evD));
      const nowDateOnly = new Date(Date.UTC(nowY, nowM - 1, nowD));
      const dayDiff = Math.round((evDateOnly.getTime() - nowDateOnly.getTime()) / (24 * 3600 * 1000));

      if (dayDiff === 1 && evHour < 6) {
        return true;
      }

      // 3. If currently early morning (00:00 to 05:59) and event was last night
      if (nowHour < 6 && dayDiff === -1 && evHour >= 18) {
        return true;
      }

      return false;
    }

    if (ev.date) {
      if (ev.date === todayLocalStr) return true;
      if (String(ev.date).toLowerCase().trim() === 'today') return true;
    }

    return false;
  }

  /**
   * Filter Events by Sport and Status
   */
  getFilteredEvents({ sport = 'all', status = 'all', searchQuery = '' } = {}) {
    let list = this.events;

    // 1. Sport Filter (All, Football, Cricket, WWE)
    if (sport && sport.toLowerCase() !== 'all') {
      const sp = sport.toLowerCase();
      list = list.filter(e => (e.sport || '').toLowerCase() === sp);
    }

    // 2. Status Filter (ALL, TODAY, LIVE, UPCOMING, FINISHED, FAVORITES)
    // Strictly per user command: "লাল চিহ্নিত করা ফিনিস হ ওয়া ম্যাচ গুলো এখান থেকে মুছে দাও। এবং finished এর ওখানে রাখো"
    // Concluded/finished matches must NOT appear in ALL, TODAY, LIVE, UPCOMING or FAVORITES feeds.
    // Finished matches must only be shown under the dedicated 'FINISHED' tab.
    const st = (status || 'ALL').toUpperCase();
    if (st === 'FINISHED') {
      list = list.filter(e => this.isEventFinished(e));
    } else if (st === 'LIVE') {
      list = list.filter(e => !this.isEventFinished(e) && (e.status || '').toLowerCase() === 'live');
    } else if (st === 'UPCOMING') {
      list = list.filter(e => !this.isEventFinished(e) && (e.status || '').toLowerCase() === 'upcoming');
    } else if (st === 'TODAY') {
      list = list.filter(e => !this.isEventFinished(e) && this.isEventToday(e));
    } else if (st === 'FAVORITES') {
      const favs = this.getFavorites();
      list = list.filter(e => !this.isEventFinished(e) && favs.includes(e.id));
    } else {
      // Default / 'ALL' tab: only active (live + upcoming) matches
      list = list.filter(e => !this.isEventFinished(e));
    }

    // 3. Search Query Filter (team, league, tournament, venue, title)
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(e => {
        const title = (e.title || '').toLowerCase();
        const t1 = (e.team1?.name || e.homeTeam?.name || '').toLowerCase();
        const t2 = (e.team2?.name || e.awayTeam?.name || '').toLowerCase();
        const league = (e.league || '').toLowerCase();
        const tourn = (e.tournament || '').toLowerCase();
        const venue = (e.venue || '').toLowerCase();
        const sport = (e.sportName || e.sport || '').toLowerCase();
        const eventName = (e.eventName || '').toLowerCase();

        return title.includes(q) || t1.includes(q) || t2.includes(q) || league.includes(q) || tourn.includes(q) || venue.includes(q) || sport.includes(q) || eventName.includes(q);
      });
    }

    // Sort order per Rule 8: LIVE -> UPCOMING -> FINISHED
    if (!status || status.toUpperCase() === 'ALL') {
      list.sort((a, b) => {
        const order = ev => {
          if (!this.isEventFinished(ev) && (ev.status || '').toLowerCase() === 'live') return 0;
          if (!this.isEventFinished(ev) && (ev.status || '').toLowerCase() === 'upcoming') return 1;
          return 2; // Finished
        };

        const rankA = order(a);
        const rankB = order(b);
        if (rankA !== rankB) return rankA - rankB;

        if (rankA === 0) {
          const spA = a.isSpecial ? 1 : 0;
          const spB = b.isSpecial ? 1 : 0;
          return spB - spA;
        } else if (rankA === 1) {
          const spA = a.isSpecial ? 1 : 0;
          const spB = b.isSpecial ? 1 : 0;
          if (spB !== spA) return spB - spA;
          return (a.timestamp || 0) - (b.timestamp || 0);
        } else {
          // Finished: latest concluded first
          return (b.timestamp || 0) - (a.timestamp || 0);
        }
      });
    } else if (status.toUpperCase() === 'FINISHED') {
      // Finished tab: Sort by most recently concluded first
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    return list;
  }

  /**
   * Calculate Real-Time Countdown string for upcoming events
   */
  getCountdownString(timestamp) {
    if (!timestamp || isNaN(timestamp)) return '';
    const now = Date.now();
    const diff = timestamp - now;

    if (diff <= 0) return 'Starts soon';

    const seconds = Math.floor((diff / 1000) % 60);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    const pad = (n) => String(n).padStart(2, '0');

    if (days > 0) {
      return `Starts in ${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `Starts in ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Favorites Management (localStorage)
   */
  getFavorites() {
    try {
      return JSON.parse(localStorage.getItem(this.favKey) || '[]');
    } catch {
      return [];
    }
  }

  isFavorite(eventId) {
    if (!eventId) return false;
    return this.getFavorites().includes(eventId);
  }

  toggleFavorite(eventId) {
    if (!eventId) return false;
    const favs = this.getFavorites();
    const idx = favs.indexOf(eventId);
    let isFav = false;
    if (idx > -1) {
      favs.splice(idx, 1);
      isFav = false;
    } else {
      favs.push(eventId);
      isFav = true;
    }
    localStorage.setItem(this.favKey, JSON.stringify(favs));
    return isFav;
  }

  /**
   * Get Event Details with Deep Data
   */
  async getEventDetails(eventId) {
    if (!eventId) return null;
    const event = this.events.find(e => e.id === eventId);
    if (!event) return null;

    // If football/sofascore event, fetch head-to-head / details if available
    if (window.sofascoreEngine && (event.rawId || event.id)) {
      try {
        const h2h = await window.sofascoreEngine.getH2HEvents(event.rawId || event.id);
        if (h2h && Array.isArray(h2h) && h2h.length > 0) {
          event.h2h = h2h;
        }
      } catch (e) {}
    }

    // If cricket, fetch deep scorecard
    if (event.sport === 'cricket' && window.cricketEngine) {
      const detailed = await window.cricketEngine.getMatchDetails(event.rawId || event.id);
      if (detailed) {
        Object.assign(event, detailed);
      }
    }

    return event;
  }

  /**
   * Format Last Updated Time
   */
  getLastUpdatedString() {
    if (!this.lastUpdated) return 'Never';
    return this.lastUpdated.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  /**
   * Fetch SofaScore Official Sports List and Priorities
   */
  async getSofaScoreSportsList(countryCode = 'GB') {
    if (window.sofascoreEngine && typeof window.sofascoreEngine.getSportsList === 'function') {
      return await window.sofascoreEngine.getSportsList(countryCode);
    }
    return { status: 'error', sports: [], countrySportPriorities: [] };
  }
}

window.SportsCoordinator = SportsCoordinator;
window.sportsCoordinator = new SportsCoordinator();
window.formatEventTime = SportsCoordinator.formatEventTime;
window.isEventFinished = SportsCoordinator.isEventFinished;
