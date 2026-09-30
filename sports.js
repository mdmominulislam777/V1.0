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
      allsportsapi: { configured: false, live: 0, upcoming: 0, finished: 0 }
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
      event.matchId
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
    if (!event || (event.source && (String(event.source).toLowerCase().includes('cricketdata') || String(event.source).toLowerCase().includes('cricapi')))) return null;

    const fixtureId = event.rawId || event.idEvent || event.matchId || event.id;
    if (fixtureId) {
      try {
        const cleanId = String(fixtureId).replace(/^tsdb-/, '');
        const apiBase = window.CONFIG?.API_BASE_URL || '';
        const res = await fetch(`${apiBase}/api/fixture/broadcaster?fixtureId=${encodeURIComponent(cleanId)}`);
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
   * Core Sports Channels Catalog fallback (disabled: strictly use verified channels.json catalog)
   */
  getDefaultSportsChannels() {
    return [];
  }

  /**
   * Get all active authentic channels in Sports category
   */
  getAllSportsChannels() {
    const sourceChannels = (Array.isArray(this.channels) && this.channels.length > 0)
      ? this.channels
      : (typeof window !== 'undefined' && Array.isArray(window.CHANNELS_DATA) ? window.CHANNELS_DATA : []);

    let list = [];
    if (Array.isArray(sourceChannels) && sourceChannels.length > 0) {
      list = sourceChannels.filter(ch => {
        if (!ch) return false;

        const name = (ch.name || '').toLowerCase();
        const cat = (ch.category || '').toLowerCase();
        const categories = Array.isArray(ch.categories) ? ch.categories.map(c => String(c).toLowerCase()) : [];
        const hasExplicitSportsArray = Array.isArray(ch.sports) && ch.sports.length > 0;

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
        if (isGeneralNonSports && !isSportsBroadcaster && !hasExplicitSportsArray) return false;

        const isSportsCat = cat === 'sports' || hasExplicitSportsArray || categories.includes('sports') || categories.includes('cricket') || 
                            categories.includes('football') || categories.includes('tennis') || categories.includes('motorsport') || 
                            categories.includes('wwe') || categories.includes('basketball') || categories.includes('baseball') ||
                            categories.includes('rugby') || categories.includes('golf') || categories.includes('combat') ||
                            categories.includes('combat sports') || categories.includes('boxing') || categories.includes('ufc') ||
                            categories.includes('hockey') || categories.includes('cycling') || categories.includes('american football');
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
                                  name.includes('ufc') || name.includes('motor vision') ||
                                  name.includes('usa network') || isSportsBroadcaster;

        return isSportsCat || hasSportsKeywords;
      });
    }

    // Securely decorate all sports channels with verified broadcast metadata (sports, leagues, priority)
    list.forEach(ch => {
      if (!ch) return;
      if (ch.sports !== undefined && !Array.isArray(ch.sports)) {
        ch.sports = (typeof ch.sports === 'string' && ch.sports.trim()) ? [ch.sports.trim()] : [];
      }
      if (ch.leagues !== undefined && !Array.isArray(ch.leagues)) {
        ch.leagues = (typeof ch.leagues === 'string' && ch.leagues.trim()) ? [ch.leagues.trim()] : [];
      }
      const meta = this.getVerifiedChannelMetadata(ch);
      if (meta) {
        if (!Array.isArray(ch.sports) || ch.sports.length === 0) ch.sports = meta.sports;
        if (!Array.isArray(ch.leagues) || ch.leagues.length === 0) ch.leagues = meta.leagues;
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

    // English Premier League & Football
    if (id === 'ch-sky-sports-epl' || name.includes('sky sports premier league')) {
      return { sports: ['Football'], leagues: ['English Premier League', 'Premier League', 'EPL'], priority: 10 };
    }
    if (id === 'ch-tnt-sports-1' || name === 'tnt sports 1') {
      return { sports: ['Football'], leagues: ['English Premier League', 'Premier League', 'UEFA Champions League'], priority: 9 };
    }
    if (id === 'ch-tnt-sports-2' || name === 'tnt sports 2') {
      return { sports: ['Football', 'Rugby', 'Motorsport'], leagues: ['UEFA Europa League', 'UEFA Champions League', 'Italian Serie A', 'Serie A', 'Premiership Rugby'], priority: 8 };
    }
    if (id === 'ch-tnt-sports-3' || name === 'tnt sports 3') {
      return { sports: ['Combat', 'Boxing', 'UFC'], leagues: ['MotoGP', 'UFC', 'Boxing'], priority: 8 };
    }
    if (id === 'ch-tnt-sports-4' || name === 'tnt sports 4') {
      return { sports: ['Motorsport', 'WWE', 'Combat'], leagues: ['UEFA Europa Conference League', 'WWE', 'Motorsport'], priority: 7 };
    }
    if (id === 'ch-sky-sports-football' || name.includes('sky sports football')) {
      return { sports: ['Football'], leagues: ['EFL', 'Scottish Premiership', 'Scottish League Cup', 'FA Cup', 'UEFA Nations League'], priority: 8 };
    }
    if (id === 'ch-star-sports-s1-hd' || id === 'ch-star-sports-sl-2' || id === 'ch-star-sports-select-1' || id === 'ch-star-sports-select-2' || name.includes('star sports select') || name.includes('star sports s1') || name.includes('star sports sl 2')) {
      return { sports: ['Football', 'Tennis', 'Motorsport'], leagues: ['English Premier League', 'Premier League', 'Wimbledon', 'Formula 1'], priority: 8 };
    }
    if (id === 'ch-bein-sports-1-hd' || name.includes('bein sports 1')) {
      return { sports: ['Football'], leagues: ['Spanish La Liga', 'La Liga', 'French Ligue 1', 'Ligue 1', 'UEFA Champions League', 'English Premier League'], priority: 9 };
    }
    if (id === 'ch-bein-sports-2' || name.includes('bein sports 2')) {
      return { sports: ['Football', 'Tennis', 'Basketball'], leagues: ['English Premier League', 'Spanish La Liga', 'UEFA Champions League'], priority: 8 };
    }
    if (id === 'ch-bein-sports-3-hd' || name.includes('bein sports 3')) {
      return { sports: ['Football', 'Tennis'], leagues: ['French Ligue 1', 'Ligue 1', 'Spanish La Liga', 'La Liga', 'Italian Serie A', 'Serie A', 'German Bundesliga', 'Bundesliga'], priority: 8 };
    }
    if (id === 'ch-bein-sports-4-hd' || name.includes('bein sports 4')) {
      return { sports: ['Football', 'Basketball'], leagues: ['French Ligue 1', 'Spanish La Liga', 'Basketball'], priority: 7 };
    }
    if (id === 'ch-bein-sports-5-hd' || name.includes('bein sports 5')) {
      return { sports: ['Football', 'Motorsport', 'Tennis'], leagues: ['French Ligue 1', 'Spanish La Liga', 'Tennis'], priority: 7 };
    }
    if (id === 'ch-bein-xtra' || id === 'ch-bein-sports-xtra' || name.includes('bein xtra') || name.includes('bein sports xtra')) {
      return { sports: ['Football', 'Tennis', 'Basketball'], leagues: ['Spanish La Liga', 'French Ligue 1'], priority: 7 };
    }
    if (id === 'ch-sony-sports-2-hd' || id === 'ch-sony-sports-ten-2-hd' || name.includes('sony ten 2') || name.includes('sony sports 2') || name.includes('sony sports ten 2')) {
      return { sports: ['Cricket', 'Football', 'Combat', 'WWE', 'Tennis'], leagues: ['UEFA Champions League', 'UEFA Europa League', 'German Bundesliga', 'Bundesliga', 'DFB-Pokal', 'UEFA Nations League', 'UFC', 'Sri Lanka Cricket', 'England Cricket', 'Pakistan Cricket', 'New Zealand Cricket', 'ICC', 'T20', 'ODI', 'Test', 'WWE'], priority: 9 };
    }
    if (id === 'ch-sony-sports-ten-3' || name.includes('sony ten 3') || name.includes('sony sports ten 3') || name.includes('sony sports 3')) {
      return { sports: ['Cricket', 'WWE', 'Football', 'Combat'], leagues: ['Cricket', 'Asia Cup', 'Sri Lanka Cricket', 'England Cricket', 'WWE', 'UEFA Champions League'], priority: 8 };
    }
    if (id === 'ch-dazn-1' || id === 'ch-dazn-2' || id === 'ch-dazn-3' || id === 'ch-dazn-4' || id === 'ch-dazn-5' || /^dazn [1-5]$/.test(name)) {
      return { sports: ['Football', 'Boxing', 'Combat'], leagues: ['Spanish La Liga', 'La Liga', 'Italian Serie A', 'Serie A', 'Boxing', 'Bellator', 'UFC'], priority: 7 };
    }
    if (id === 'ch-dazn-laliga' || id === 'ch-super-sport-laliga' || name.includes('laliga')) {
      return { sports: ['Football'], leagues: ['Spanish La Liga', 'La Liga'], priority: 8 };
    }
    if (id === 'ch-dsports' || name === 'dsports') {
      return { sports: ['Football'], leagues: ['Spanish La Liga', 'Copa America', 'Football'], priority: 7 };
    }
    // Cricket
    if (id === 'ch-sky-sports-cricket' || name.includes('sky sports cricket')) {
      return { sports: ['Cricket'], leagues: ['County Championship', 'County Championship Division One', 'County Championship Division Two', 'England', 'T20 Blast', 'The Hundred', 'ICC', 'Test', 'ODI', 'T20', 'Sri Lanka tour of England', 'Pakistan tour of England'], priority: 10 };
    }
    if (id === 'ch-sky-sports-mix' || name.includes('sky sports mix')) {
      return { sports: ['Cricket', 'Football', 'Motorsport'], leagues: ['The Hundred', 'Cricket', 'Women Cricket', 'Football'], priority: 8 };
    }
    if (id === 'ch-star-sports-1-hd' || name === 'star sports 1 hd' || name === 'star sports 1') {
      return { sports: ['Cricket', 'Kabaddi'], leagues: ['Asian Games', 'T20 Asian Games', "Women's Asian Games", 'Asia Cup', "Women's Asia Cup", 'India', 'ICC', 'ODI', 'T20', 'Test', 'IPL', 'One-Day Cup', 'Afghanistan vs India in India', 'Australia U19 tour of India', 'Australia A Women tour of India'], priority: 10 };
    }
    if (id === 'ch-star-sports-1-hindi' || name.includes('star sports 1 hindi')) {
      return { sports: ['Cricket'], leagues: ['Asian Games', 'T20 Asian Games', "Women's Asian Games", 'Asia Cup', 'India', 'ICC', 'IPL', 'Afghanistan vs India in India'], priority: 10 };
    }
    if (id === 'ch-t-sports-hd' || id === 'ch-t-sports-server-2' || name.includes('t sports') || name.includes('tsports')) {
      return { sports: ['Cricket', 'Football'], leagues: ['Bangladesh', 'BPL', 'DPL', 'Dhaka', 'Bangladesh A tour of South Africa', 'Asian Games', 'Asia Cup', 'Bangladesh Premier League'], priority: 10 };
    }
    if (id === 'ch-gazi-tv' || name === 'gazi tv' || name === 'gtv') {
      return { sports: ['Cricket'], leagues: ['Bangladesh', 'BPL', 'ICC', 'Asia Cup'], priority: 9 };
    }
    if (id === 'ch-maasranga-tv-hd' || id === 'ch-nagorik-tv' || name.includes('maasranga') || name.includes('nagorik')) {
      return { sports: ['Cricket', 'Football'], leagues: ['Bangladesh', 'BPL', 'ICC', 'Asia Cup'], priority: 8 };
    }
    if (id === 'ch-willow-hd' || id === 'ch-willow-sports' || id === 'ch-willow-sports-2' || id === 'ch-willow-cricket-extra' || name.includes('willow')) {
      return { sports: ['Cricket'], leagues: ['Caribbean Premier League', 'Womens Caribbean Premier League', 'CPL', 'One-Day Cup', 'Australia Domestic One-Day Cup', 'Sheffield Shield', 'ICC', 'ODI Series Zimbabwe vs Australia', 'T20 Series Zimbabwe vs South Africa', 'South Africa tour of Namibia', 'Australia tour of Zimbabwe'], priority: 9 };
    }
    if (id === 'ch-ptv-sports-hd' || name.includes('ptv sports')) {
      return { sports: ['Cricket'], leagues: ['Pakistan', 'PSL', 'National T20', 'Asia Cup', 'Asian Games', 'ICC', 'Pakistan tour of England'], priority: 9 };
    }
    if (id === 'ch-a-sports' || name === 'a sports' || name === 'a sports hd') {
      return { sports: ['Cricket'], leagues: ['Pakistan', 'PSL', 'ICC', 'Asia Cup'], priority: 9 };
    }
    if (id === 'ch-ten-sports-hd' || id === 'ch-ten-cricket' || name.includes('ten sports') || name.includes('ten cricket')) {
      return { sports: ['Cricket', 'Football', 'WWE'], leagues: ['Pakistan', 'Sri Lanka', 'ICC', 'Asia Cup'], priority: 8 };
    }
    if (id === 'ch-fox-cricket-501' || name.includes('fox cricket')) {
      return { sports: ['Cricket'], leagues: ['Australia', 'Big Bash', 'Sheffield Shield', 'Ashes', 'Border-Gavaskar', 'ICC'], priority: 9 };
    }
    if (id === 'ch-astro-cricbuz' || name.includes('astro cricket') || name.includes('astro cricbuz')) {
      return { sports: ['Cricket'], leagues: ['ICC', 'IPL', 'Cricket'], priority: 8 };
    }
    if (id === 'ch-cricket-gold' || name.includes('cricket gold')) {
      return { sports: ['Cricket'], leagues: ['Cricket', 'ICC'], priority: 7 };
    }
    if (id === 'ch-dd-sports' || name.includes('dd sports')) {
      return { sports: ['Cricket', 'Football', 'Olympic Sports'], leagues: ['India', 'ICC', 'Cricket'], priority: 7 };
    }
    // Motorsport & Tennis & Golf & Basketball & Rugby & Combat
    if (id === 'ch-sky-sports-f1' || name.includes('sky sports f1')) {
      return { sports: ['Motorsport', 'F1'], leagues: ['Formula 1', 'F1', 'FIA Formula 1 World Championship'], priority: 10 };
    }
    if (id === 'ch-sky-sports-tennis' || name.includes('sky sports tennis')) {
      return { sports: ['Tennis'], leagues: ['ATP World Tour', 'ATP', 'WTA Tour', 'WTA', 'Laver Cup', 'US Open', 'Australian Open', 'Wimbledon', 'Roland Garros', 'Tennis'], priority: 10 };
    }
    if (id === 'ch-sky-sports-golf' || name.includes('sky sports golf')) {
      return { sports: ['Golf'], leagues: ['PGA Tour', 'DP World Tour', 'LPGA', 'The Masters', 'Ryder Cup', 'Golf'], priority: 9 };
    }
    if (id === 'ch-sky-sports-racing' || name.includes('sky sports racing')) {
      return { sports: ['Motorsport'], leagues: ['Horse Racing', 'Motorsport'], priority: 7 };
    }
    if (id === 'ch-eurosport-1' || id === 'ch-eurosport-2' || name.includes('eurosport')) {
      return { sports: ['Tennis', 'Cycling', 'Motorsport'], leagues: ['Australian Open', 'Roland Garros', 'ATP', 'WTA', 'Tour de France', 'Tennis'], priority: 8 };
    }
    if (id === 'ch-ziggo-sport-1' || id === 'ch-ziggo-sport-2' || id === 'ch-ziggo-sport-3' || name.includes('ziggo sport')) {
      return { sports: ['Football', 'Motorsport', 'Tennis'], leagues: ['ATP', 'WTA', 'Davis Cup', 'Wimbledon', 'Roland Garros', 'US Open', 'Australian Open', 'Tennis'], priority: 8 };
    }
    if (id === 'ch-espn' || id === 'ch-espn-2' || id === 'ch-espn-3' || name.includes('espn')) {
      return { sports: ['Basketball', 'Baseball', 'Football', 'American Football', 'Tennis'], leagues: ['NBA', 'WNBA', 'NCAA', 'MLB', 'NFL', 'Basketball', 'Baseball'], priority: 9 };
    }
    if (id === 'ch-go3-sport-1-hd' || name.includes('go3 sport 1')) {
      return { sports: ['Football', 'Basketball'], leagues: ['EuroLeague', 'NBA', 'Basketball'], priority: 8 };
    }
    if (id === 'ch-go3-sport-2-hd' || name.includes('go3 sport 2')) {
      return { sports: ['Football', 'Motorsport'], leagues: ['Football', 'Motorsport'], priority: 8 };
    }
    if (id === 'ch-sky-sports-action' || name.includes('sky sports action') || name.includes('sky action')) {
      return { sports: ['Rugby', 'Combat', 'Boxing', 'Motorsport'], leagues: ['Premiership Rugby', 'The Rugby Championship', 'Super Rugby', 'Six Nations', 'Top 14 Rugby', 'NRL Rugby', 'Rugby'], priority: 9 };
    }
    if (id === 'ch-ufc-tv' || id === 'ch-ufc-fight-pass' || name.includes('ufc')) {
      return { sports: ['Combat', 'WWE'], leagues: ['UFC', 'MMA', 'Combat', 'WWE'], priority: 9 };
    }
    if (id === 'ch-motor-vision' || name.includes('motor vision')) {
      return { sports: ['Motorsport', 'F1'], leagues: ['Motorsport', 'Racing'], priority: 6 };
    }
    return null;
  }

  /**
   * Normalize broadcaster or TV Station string for robust matching
   * Strips technical suffixes (HD, SD, FHD, UHD, 4K) at word boundaries without stripping "TV" globally.
   */
  normalizeBroadcasterName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      // Remove bracketed text e.g. (UK), (India), [Live], (BST)
      .replace(/\([^\)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      // Remove only technical resolution suffixes at word boundaries
      .replace(/\b(hd|sd|fhd|uhd|4k)\b/gi, ' ')
      // Replace punctuation and symbols with space
      .replace(/[-_.:/\\,+|&]/g, ' ')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Comprehensive broadcaster and TV station aliases mapping strictly to verified channels in channels.json.
   * Synchronized with server.ts explicitServerAliases.
   */
  getBroadcasterAliases() {
    return {
      // Bangladesh Verified Broadcasters
      't sports': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
      't sports hd': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
      'tsports': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
      'gazi tv': ['ch-gazi-tv'],
      'gazi tv hd': ['ch-gazi-tv'],
      'gtv': ['ch-gazi-tv'],
      'gazi television': ['ch-gazi-tv'],
      'gazi': ['ch-gazi-tv'],
      'maasranga': ['ch-maasranga-tv-hd'],
      'maasranga tv': ['ch-maasranga-tv-hd'],
      'maasranga tv hd': ['ch-maasranga-tv-hd'],
      'nagorik': ['ch-nagorik-tv'],
      'nagorik tv': ['ch-nagorik-tv'],

      // Star Sports Specific Channels
      'star sports 1 hindi': ['ch-star-sports-1-hindi'],
      'star sports hindi': ['ch-star-sports-1-hindi'],
      'star sports 1 hd hindi': ['ch-star-sports-1-hindi'],
      'ss1 hindi': ['ch-star-sports-1-hindi'],
      'star sports 1': ['ch-star-sports-1-hd'],
      'star sports 1 hd': ['ch-star-sports-1-hd'],
      'star sports one': ['ch-star-sports-1-hd'],
      'star sport 1': ['ch-star-sports-1-hd'],
      'ss1': ['ch-star-sports-1-hd'],
      'star sports select 1': ['ch-star-sports-s1-hd'],
      'star sports select 1 hd': ['ch-star-sports-s1-hd'],
      'star select 1': ['ch-star-sports-s1-hd'],
      'select 1': ['ch-star-sports-s1-hd'],
      'ss select 1': ['ch-star-sports-s1-hd'],
      'star sports s1': ['ch-star-sports-s1-hd'],
      'star sports s1 hd': ['ch-star-sports-s1-hd'],
      'star sports select 2': ['ch-star-sports-sl-2'],
      'star sports select 2 hd': ['ch-star-sports-sl-2'],
      'star select 2': ['ch-star-sports-sl-2'],
      'select 2': ['ch-star-sports-sl-2'],
      'ss select 2': ['ch-star-sports-sl-2'],
      'star sports sl 2': ['ch-star-sports-sl-2'],

      // Willow Specific Channels
      'willow': ['ch-willow-hd', 'ch-willow-sports'],
      'willow cricket': ['ch-willow-hd', 'ch-willow-sports'],
      'willow tv': ['ch-willow-hd', 'ch-willow-sports'],
      'willow hd': ['ch-willow-hd', 'ch-willow-sports'],
      'willow usa': ['ch-willow-hd', 'ch-willow-sports'],
      'willow sports': ['ch-willow-sports', 'ch-willow-hd'],
      'willow sports 2': ['ch-willow-sports-2'],
      'willow 2': ['ch-willow-sports-2'],
      'willow xtra': ['ch-willow-cricket-extra'],
      'willow extra': ['ch-willow-cricket-extra'],
      'willow cricket extra': ['ch-willow-cricket-extra'],

      // Pakistan Verified Channels
      'ptv sports': ['ch-ptv-sports-hd'],
      'ptv sports hd': ['ch-ptv-sports-hd'],
      'ptv sport': ['ch-ptv-sports-hd'],
      'ptv': ['ch-ptv-sports-hd'],
      'a sports': ['ch-a-sports'],
      'a sports hd': ['ch-a-sports'],
      'asports': ['ch-a-sports'],
      'a sport': ['ch-a-sports'],
      'ten sports': ['ch-ten-sports-hd'],
      'ten sports hd': ['ch-ten-sports-hd'],
      'ten cricket': ['ch-ten-cricket'],
      'ten sports pakistan': ['ch-ten-sports-hd'],
      'ten sports pk': ['ch-ten-sports-hd'],

      // Sony Specific Channels
      'sony ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony ten 2 hd': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony sports ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony sports ten 2 hd': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'ten sports 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony sports 2': ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd'],
      'sony sports 2 hd': ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd'],
      'sony ten 3': ['ch-sony-sports-ten-3'],
      'sony ten 3 hd': ['ch-sony-sports-ten-3'],
      'sony sports ten 3': ['ch-sony-sports-ten-3'],
      'sony sports ten 3 hd': ['ch-sony-sports-ten-3'],
      'ten 3': ['ch-sony-sports-ten-3'],
      'ten sports 3': ['ch-sony-sports-ten-3'],
      'sony ten 3 hindi': ['ch-sony-sports-ten-3'],

      // Fox & Astro
      'fox cricket': ['ch-fox-cricket-501'],
      'fox cricket 501': ['ch-fox-cricket-501'],
      'fox sports 501': ['ch-fox-cricket-501'],
      'astro cricket': ['ch-astro-cricbuz'],
      'astro cricbuz': ['ch-astro-cricbuz'],
      'astro football': ['ch-astro-football'],

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
      'sky action': ['ch-sky-sports-action'],

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
      'dazn laliga': ['ch-dazn-laliga'],
      'dazn la liga': ['ch-dazn-laliga'],

      // EuroSport & Ziggo Sport Specific Channels
      'eurosport 1': ['ch-eurosport-1'],
      'eurosport 2': ['ch-eurosport-2'],
      'ziggo sport 1': ['ch-ziggo-sport-1'],
      'ziggo 1': ['ch-ziggo-sport-1'],
      'ziggo sport 2': ['ch-ziggo-sport-2'],
      'ziggo 2': ['ch-ziggo-sport-2'],
      'ziggo sport 3': ['ch-ziggo-sport-3'],
      'ziggo 3': ['ch-ziggo-sport-3'],

      // beIN Sports Specific Channels
      'bein sports 1 hd': ['ch-bein-sports-1-hd'],
      'bein sports 1': ['ch-bein-sports-1-hd'],
      'bein 1': ['ch-bein-sports-1-hd'],
      'bein sports 2 hd': ['ch-bein-sports-2'],
      'bein sports 2': ['ch-bein-sports-2'],
      'bein 2': ['ch-bein-sports-2'],
      'bein sports 3 hd': ['ch-bein-sports-3-hd'],
      'bein sports 3': ['ch-bein-sports-3-hd'],
      'bein 3': ['ch-bein-sports-3-hd'],
      'bein sports 4 hd': ['ch-bein-sports-4-hd'],
      'bein sports 4': ['ch-bein-sports-4-hd'],
      'bein 4': ['ch-bein-sports-4-hd'],
      'bein sports 5 hd': ['ch-bein-sports-5-hd'],
      'bein sports 5': ['ch-bein-sports-5-hd'],
      'bein 5': ['ch-bein-sports-5-hd'],
      'bein xtra': ['ch-bein-xtra', 'ch-bein-sports-xtra'],
      'bein sports xtra': ['ch-bein-sports-xtra', 'ch-bein-xtra'],

      // Other Verified Specific Sports Channels in channels.json
      'dd sports': ['ch-dd-sports'],
      'qaz sports': ['ch-qaz-sports-hd'],
      'qazsport': ['ch-qaz-sports-hd'],
      'mundial sports': ['ch-mundial-sports-hd'],
      'a spor': ['ch-a-spor'],
      'aspor': ['ch-a-spor'],
      'pk sports': ['ch-pk-sports-hd'],
      'fifa+': ['ch-ayna-019efa45-d8f0-7732-8263-6030073a34fe'],
      'fifa plus': ['ch-ayna-019efa45-d8f0-7732-8263-6030073a34fe'],
      'motor vision': ['ch-motor-vision'],
      'motorvision': ['ch-motor-vision'],
      'cricket gold': ['ch-cricket-gold'],
      'espn': ['ch-espn'],
      'espn hd': ['ch-espn'],
      'espn 2': ['ch-espn-2'],
      'espn2': ['ch-espn-2'],
      'espn 3': ['ch-espn-3'],
      'espn3': ['ch-espn-3'],
      'go3 sport 1': ['ch-go3-sport-1-hd'],
      'go3 sport 1 hd': ['ch-go3-sport-1-hd'],
      'go3 sport 2': ['ch-go3-sport-2-hd'],
      'go3 sport 2 hd': ['ch-go3-sport-2-hd'],
      'ufc tv': ['ch-ufc-tv'],
      'ufc fight pass': ['ch-ufc-fight-pass'],
      'super sport laliga': ['ch-super-sport-laliga'],
      'supersport laliga': ['ch-super-sport-laliga'],
      'supersport la liga': ['ch-super-sport-laliga'],
      'dsports': ['ch-dsports'],
      'directv sports': ['ch-dsports'],
      'goal tv': ['ch-goal-tv']
    };
  }

  /**
   * Banned generic networks or OTT names that MUST NOT automatically assign channels.
   * Prevents alias expansion and multi-channel guessing.
   */
  isBannedNetworkOrOttName(name) {
    if (!name || typeof name !== 'string') return false;
    const n = name.toLowerCase().trim();
    if (!n) return false;

    const genericUmbrella = [
      'star sports',
      'star sports select',
      'sony sports',
      'sky sports',
      'tnt sports',
      'dazn',
      'bein sports',
      'bein',
      'eurosport',
      'supersport',
      'fox sports'
    ];
    if (genericUmbrella.includes(n)) return true;

    // SuperSport umbrella & sub-channels (except verified SuperSport LaLiga in catalog)
    if ((n.includes('supersport') || n.includes('super sport')) && !n.includes('laliga') && !n.includes('la liga')) {
      return true;
    }

    const banned = [
      'fancode',
      'cricbuzz',
      'hotstar',
      'disney+ hotstar',
      'disney hotstar',
      'jiohotstar',
      'peacock',
      'paramount',
      'paramount+',
      'optus sport',
      'optus',
      'prime video',
      'amazon prime video',
      'amazon prime',
      'canal+',
      'viaplay',
      'stan sport',
      'jiocinema',
      'jio cinema',
      'sports18',
      'sports 18',
      'sports18 1',
      'star sports network',
      'sony sports network',
      'sony network',
      'sonyliv',
      'sony liv',
      'sky sports network',
      'tnt sports network',
      'bein sports network',
      'tsn',
      'supersport action',
      'supersport cricket',
      'supersport premier league',
      'supersport football',
      'supersport premier',
      'supersport epl',
      'supersport grandstand',
      'supersport variety',
      'supersport rugby',
      'mlb.tv',
      'mlb tv',
      'wnba league pass',
      'nba league pass',
      'nba tv',
      'espn+',
      'espn plus',
      'apple tv',
      'apple tv+',
      'fubo',
      'fubotv',
      'kayosports',
      'kayo sports',
      'spark sport'
    ];
    return banned.some(b => n.includes(b));
  }

  /**
   * Consistent WWE identification across event.sport, event.league, event.tournament, and event.title
   */
  isWweEvent(event) {
    if (!event || typeof event !== 'object') return false;
    const sp = String(event.sport || event.sportName || '').toLowerCase().trim();
    const lg = String(event.league || '').toLowerCase().trim();
    const tr = String(event.tournament || event.seriesName || '').toLowerCase().trim();
    const ti = String(event.title || event.eventName || '').toLowerCase().trim();
    const combined = `${sp} ${lg} ${tr} ${ti}`;
    return (
      sp === 'wwe' ||
      lg.includes('wwe') ||
      tr.includes('wwe') ||
      ti.includes('wwe') ||
      /\b(monday night raw|friday night smackdown|smackdown live|wrestlemania|summerslam|royal rumble|survivor series|crown jewel|bad blood)\b/i.test(combined)
    );
  }

  /**
   * Normalize any sport or category label into a canonical sport identifier.
   * Ignores generic platform/region/category labels (e.g., "Sports", "LiveTV", "Bangla").
   */
  normalizeSportTag(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.toLowerCase().trim();
    if (!s) return null;

    const genericLabels = new Set([
      'sports', 'sport', 'livetv', 'live tv', 'live', 'tv', 'entertainment', 'news',
      'movie', 'movies', 'cinema', 'music', 'kids', 'cartoon', 'religious', 'islamic',
      'infotainment', 'discovery', 'lifestyle', 'sports entertainment', 'travel',
      'documentary', 'bangla', 'bangladesh', 'india', 'indian', 'hindi', 'kolkata',
      'pakistan', 'international', 'uk', 'usa', 'arabic', 'akash go', 'ayana', 'ayna',
      'jio tv', 'toffee', 'jagobd', 'tata play', 'yupp tv', 'sony liv', 'bein sports',
      'standard', 'hd', 'fhd', 'sd', 'uhd', '4k', 'general'
    ]);
    if (genericLabels.has(s)) return null;

    if (s.includes('cricket') || s === 'ipl' || s === 'bpl' || s === 'psl' || s === 'cpl' || s === 'ashes' || s === 't20' || s === 'odi') {
      return 'cricket';
    }
    if (s === 'american football' || s === 'nfl' || s === 'ncaa football') {
      return 'american_football';
    }
    if (
      s === 'football' || s === 'soccer' || s.includes('football') || s.includes('soccer') ||
      s === 'epl' || s.includes('premier league') || s.includes('la liga') || s.includes('laliga') ||
      s.includes('serie a') || s.includes('bundesliga') || s.includes('ligue 1') ||
      s.includes('champions league') || s === 'uefa' || s.includes('europa league') || s === 'fifa'
    ) {
      return 'football';
    }
    if (s.includes('tennis') || s === 'atp' || s === 'wta' || s === 'wimbledon' || s === 'us open' || s === 'australian open' || s === 'roland garros') {
      return 'tennis';
    }
    if (s.includes('motor') || s === 'f1' || s.includes('formula 1') || s.includes('formula one') || s.includes('racing') || s === 'motogp') {
      return 'motorsport';
    }
    if (s.includes('basketball') || s === 'nba' || s === 'wnba' || s === 'euroleague' || s === 'cba') {
      return 'basketball';
    }
    if (s.includes('baseball') || s === 'mlb' || s === 'kbo' || s === 'npb') {
      return 'baseball';
    }
    if (s.includes('rugby') || s === 'six nations') {
      return 'rugby';
    }
    if (s.includes('golf') || s === 'pga' || s === 'lpga' || s === 'masters') {
      return 'golf';
    }
    if (s.includes('wwe') || s.includes('wrestling') || s === 'raw' || s === 'smackdown' || s === 'nxt' || s === 'aew') {
      return 'wwe';
    }
    if (s.includes('combat') || s.includes('boxing') || s === 'ufc' || s === 'mma' || s === 'bellator' || s.includes('martial')) {
      return 'combat';
    }
    if (s.includes('hockey') || s === 'nhl') {
      return 'hockey';
    }
    if (s.includes('cycling') || s === 'tour de france') {
      return 'cycling';
    }
    if (s.includes('kabaddi')) {
      return 'kabaddi';
    }
    if (s.includes('olympic') || s.includes('asian games') || s.includes('athletics')) {
      return 'olympic_sports';
    }
    if (s.includes('fishing') || s === 'outdoor') {
      return 'fishing';
    }
    return s;
  }

  /**
   * PRODUCTION FINAL SAFEGUARD:
   * Validates the complete 4-step authorization chain for each candidate channel:
   * 1. API Broadcaster token exists and is valid
   * 2. Explicit verified mapping connects the token to an authorized channel ID
   * 3. Target channel exists in verified catalog, is active (active === true), and sport is universally compatible
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

    // 3. Authorized Channel check (active, verified catalog, universal sport isolation)
    if (channel.active !== true) {
      return { valid: false, reason: 'Channel marked inactive in catalog' };
    }

    const cid = String(channel.id || '').toLowerCase().trim();
    const rawSports = Array.isArray(channel.sports)
      ? channel.sports.map(s => String(s).trim()).filter(Boolean)
      : (typeof channel.sports === 'string' && channel.sports.trim() ? [channel.sports.trim()] : []);
    const channelCategories = Array.isArray(channel.categories)
      ? channel.categories.map(c => String(c).trim()).filter(Boolean)
      : (typeof channel.categories === 'string' && channel.categories.trim() ? [channel.categories.trim()] : []);
    const meta = this.getVerifiedChannelMetadata(channel);
    const metaSports = (meta && Array.isArray(meta.sports)) ? meta.sports.map(s => String(s).trim()).filter(Boolean) : [];

    // Explicit non-Cricket channels that must NEVER map to Cricket unless channels.json explicitly tags them as Cricket
    const nonCricketDedicatedIds = new Set([
      'ch-tnt-sports-1',
      'ch-tnt-sports-2',
      'ch-tnt-sports-3',
      'ch-tnt-sports-4',
      'ch-sky-sports-action',
      'ch-star-sports-s1-hd',
      'ch-star-sports-sl-2',
      'ch-star-sports-select-1',
      'ch-star-sports-select-2',
      'ch-sky-sports-epl',
      'ch-sky-sports-football',
      'ch-sky-sports-f1',
      'ch-sky-sports-tennis',
      'ch-sky-sports-golf',
      'ch-sky-sports-racing'
    ]);

    if (event) {
      const rawEvSport = String(event.sport || event.sportName || '').trim();
      const isWweEv = this.isWweEvent(event);
      const evSportNorm = this.normalizeSportTag(rawEvSport) || (isWweEv ? 'wwe' : null);

      if (evSportNorm) {
        // Extract explicit sport tags from channel.sports and channel.categories first
        const explicitSportTags = Array.from(
          new Set(
            [...rawSports, ...channelCategories]
              .map(t => this.normalizeSportTag(t))
              .filter(Boolean)
          )
        );

        // Fall back to verified metadata sports ONLY if channel has no explicit sport tags in sports/categories
        const effectiveSportTags = explicitSportTags.length > 0
          ? explicitSportTags
          : Array.from(new Set(metaSports.map(t => this.normalizeSportTag(t)).filter(Boolean)));

        if (evSportNorm === 'cricket' && nonCricketDedicatedIds.has(cid) && !explicitSportTags.includes('cricket')) {
          return {
            valid: false,
            reason: `Sport mismatch: event sport is ${rawEvSport} but channel ${channel.name || cid} is a dedicated non-Cricket channel`
          };
        }

        const isCompatible = effectiveSportTags.some(tag => {
          if (tag === evSportNorm) return true;
          // Allow American Football / Football crossover on channels explicitly tagged with American Football or Football when event is NFL/American Football
          if (evSportNorm === 'american_football' && tag === 'football') return true;
          if (evSportNorm === 'football' && String(event.league || '').toLowerCase() === 'nfl' && tag === 'american_football') return true;
          // Allow WWE event (identified via sport, league, tournament, or title) to match WWE-tagged channels
          if (isWweEv && tag === 'wwe') return true;
          return false;
        });

        if (!isCompatible) {
          const channelSportLabel = (rawSports.length > 0 ? rawSports : (effectiveSportTags.length > 0 ? effectiveSportTags : ['unverified'])).join(', ');
          return {
            valid: false,
            reason: `Sport mismatch: event sport is ${rawEvSport || (isWweEv ? 'WWE' : 'Unknown')} but channel is ${channelSportLabel}`
          };
        }
      }
    }

    // 4. Authorized Stream check
    const isValidHttp = u => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
    const streamUrl = channel.stream_url || channel.url || channel.streamUrl;
    const hasDirectUrl = isValidHttp(streamUrl);
    const hasArrayStream = Array.isArray(channel.streams) && channel.streams.some(s => s && isValidHttp(s.url));

    if (!hasDirectUrl && !hasArrayStream) {
      return { valid: false, reason: 'No authorized HTTP/HTTPS stream available on channel' };
    }

    return { valid: true };
  }

  /**
   * Precise exact normalized matching between broadcaster metadata and internal channel/alias names.
   * Strictly prevents substring or subset-word false positives (e.g. 'Star Sports Select 1' will NEVER match 'Star Sports 1').
   */
  isBroadcasterMatch(token, aliasOrName) {
    if (!token || !aliasOrName) return false;
    const t = this.normalizeBroadcasterName(token);
    const a = this.normalizeBroadcasterName(aliasOrName);
    if (!t || !a) return false;
    return t === a;
  }

  /**
   * Match authentic broadcaster tokens against available active sports channels.
   * PRODUCTION SAFEGUARD:
   * - Retains all verified channels mapped to a matched broadcaster alias.
   * - Generic network and OTT tokens are blocked.
   * - Rejects ambiguous collisions if two channels share the same normalized name in fallback lookup.
   * - Validates complete 4-step authorization chain for every candidate channel.
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
      let aliasMatchedKey = false;

      // 1. Direct Alias Lookup with exact normalized verification (retains all valid channels for the alias)
      for (const [aliasKey, channelIds] of Object.entries(aliases)) {
        if (this.isBroadcasterMatch(token, aliasKey)) {
          aliasMatchedKey = true;
          const idList = Array.isArray(channelIds) ? channelIds : [channelIds];
          for (const cid of idList) {
            const ch = sportsChannels.find(c => c && (c.id === cid || c.id === `ch-${cid}`) && c.active === true);
            if (ch) {
              const chainCheck = this.validateAuthorizationChain(token, ch, event);
              if (chainCheck.valid) {
                foundForToken = true;
                if (!matchedIds.has(ch.id)) {
                  matchedIds.add(ch.id);
                  matchedChannels.push(ch);
                }
              }
            }
          }
        }
      }

      // 2. Direct Channel Name Comparison (only if not an explicit alias key; reject ambiguous collisions)
      if (!foundForToken && !aliasMatchedKey) {
        const validCandidates = [];
        for (const ch of sportsChannels) {
          if (!ch || ch.active !== true) continue;
          if (this.isBroadcasterMatch(token, ch.name)) {
            const chainCheck = this.validateAuthorizationChain(token, ch, event);
            if (chainCheck.valid) {
              validCandidates.push(ch);
            }
          }
        }
        if (validCandidates.length === 1 && !matchedIds.has(validCandidates[0].id)) {
          matchedIds.add(validCandidates[0].id);
          matchedChannels.push(validCandidates[0]);
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
      const explicitCh = sportsChannels.find(c => c && (c.id === cid || c.id === `ch-${cid}`) && c.active === true);
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
    // 3. Direct Authenticated Custom Streams on event payload
    //    STRICT RULE: Every event.stream MUST resolve to an existing channel in channels.json
    //    and pass validateAuthorizationChain(token, channel, event). Never create fake/synthetic channels.
    // -------------------------------------------------------------------------------------
    if (Array.isArray(event.streams) && event.streams.length > 0) {
      for (const st of event.streams) {
        if (!st || typeof st.url !== 'string' || !/^https?:\/\//i.test(st.url.trim())) continue;
        const stCid = typeof st.channelId === 'string' ? st.channelId.trim() : '';
        const stCname = typeof st.channelName === 'string' ? st.channelName.trim() : (typeof st.broadcaster === 'string' ? st.broadcaster.trim() : '');
        // Reject anonymous or placeholder streams
        if (!stCid && !stCname) continue;
        if (stCid.startsWith('api-stream-') || stCname.toLowerCase() === 'direct api stream' || /^live stream \d+$/i.test(stCname)) {
          continue;
        }

        let matchedCatalogChannels = [];
        if (stCid) {
          const byId = sportsChannels.find(c => c && (c.id === stCid || c.id === `ch-${stCid}`) && c.active === true);
          if (byId) matchedCatalogChannels = [byId];
        }
        if (matchedCatalogChannels.length === 0 && stCname) {
          matchedCatalogChannels = this.findMatchingChannelsForBroadcaster(stCname, sportsChannels, event);
        }

        for (const catalogCh of matchedCatalogChannels) {
          if (!catalogCh || seenChannelIds.has(catalogCh.id)) continue;
          const tokenForValidation = stCname || stCid || catalogCh.name;
          const chainCheck = this.validateAuthorizationChain(tokenForValidation, catalogCh, event);
          if (chainCheck.valid) {
            seenChannelIds.add(catalogCh.id);
            verifiedChannelEntries.push({
              channel: catalogCh,
              source: `Direct API: ${catalogCh.name}`,
              sourceType: 'direct_api',
              sourceField: 'event.streams',
              token: tokenForValidation,
              verificationDetail: `API stream verified for authorized catalog channel "${catalogCh.name}" (${catalogCh.id})`
            });
          }
        }
      }
    }

    // -------------------------------------------------------------------------------------
    // 4. Verified Logic-Based Sources (Second Priority - ONLY if no Direct API matched)
    // -------------------------------------------------------------------------------------
    if (verifiedChannelEntries.length === 0) {
      // 4a. Reliable Mapped Channel Check (Authenticated Persistent Audit Cache)
      const mappedCh = this.getMappedChannel(event);
      if (mappedCh && mappedCh.active === true && !seenChannelIds.has(mappedCh.id)) {
        const chainCheck = this.validateAuthorizationChain(mappedCh.name || mappedCh.id, mappedCh, event);
        if (chainCheck.valid) {
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
      const isWwe = this.isWweEvent(event);
      if (isWwe) {
        const wweCandidateIds = ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd', 'ch-sony-sports-ten-3', 'ch-tnt-sports-4'];
        for (const wweCid of wweCandidateIds) {
          const wweChannel = sportsChannels.find(c => c && c.id === wweCid && c.active === true);
          if (wweChannel && !seenChannelIds.has(wweChannel.id)) {
            const chainCheck = this.validateAuthorizationChain('WWE Contract', wweChannel, event);
            if (chainCheck.valid) {
              seenChannelIds.add(wweChannel.id);
              verifiedChannelEntries.push({
                channel: wweChannel,
                source: 'Official WWE Contract',
                sourceType: 'verified_logic',
                sourceField: 'official_franchise_contract',
                token: 'WWE Contract',
                verificationDetail: `WWE official South Asian broadcast rights contract -> ${wweChannel.name} (${wweChannel.id})`
              });
              break;
            }
          }
        }
      }

      // 4c. Explicit Event ID match (Verified Logic-Based)
      if (eventId && sportsChannels.length > 0) {
        const explicitIdCh = sportsChannels.find(ch => 
          ch && ch.active === true && Array.isArray(ch.events) && ch.events.map(String).includes(eventId) && (ch.stream_url || ch.url || ch.streamUrl)
        );
        if (explicitIdCh && !seenChannelIds.has(explicitIdCh.id)) {
          const chainCheck = this.validateAuthorizationChain(explicitIdCh.name || explicitIdCh.id, explicitIdCh, event);
          if (chainCheck.valid) {
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
    }

    // -------------------------------------------------------------------------------------
    // 5. Verification Check: No guessed/unverified channels allowed
    // -------------------------------------------------------------------------------------
    if (verifiedChannelEntries.length === 0) {
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
    const isValidHttpUrl = u => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

    for (const entry of verifiedChannelEntries) {
      const ch = entry.channel;
      const channelServers = [];
      const pUrl = ch.stream_url || ch.url || ch.streamUrl;
      const bUrls = Array.isArray(ch.backupUrls) ? ch.backupUrls : (ch.backup_stream_url ? [ch.backup_stream_url] : []);
      const defaultQuality = ch.streams?.[0]?.quality || (ch.isHD === false ? '720p HD' : '1080p FHD');

      // If channel contains an authentic streams array with specific server names/labels
      if (Array.isArray(ch.streams) && ch.streams.length > 0) {
        ch.streams.forEach((cs) => {
          if (cs && isValidHttpUrl(cs.url)) {
            const cleanUrl = cs.url.trim();
            const normUrl = cleanUrl.toLowerCase();
            if (!seenStreamUrls.has(`${ch.id}::${normUrl}`)) {
              seenStreamUrls.add(`${ch.id}::${normUrl}`);
              const sNum = channelServers.length + 1;
              const qLabel = cs.quality || (sNum === 1 ? defaultQuality : '720p HD');
              const rawLabel = cs.serverLabel || (sNum === 1 ? `Server 1 — ${qLabel}` : `Server ${sNum} — Backup`);
              const serverLabel = String(rawLabel).replace(/\(([^()]+)\)/g, '— $1').replace(/\s+/g, ' ').trim();
              const rawName = cs.name || `${ch.name} (${serverLabel})`;
              const cleanName = String(rawName).replace(/\(Server\s+(\d+)\s*\(([^()]+)\)\)/gi, '(Server $1 — $2)');
              const sObj = {
                name: cleanName,
                serverLabel: serverLabel,
                channelName: ch.name,
                channelId: ch.id,
                channelLogo: ch.logo,
                url: cleanUrl,
                backupUrls: [],
                quality: qLabel,
                isHD: cs.isHD !== undefined ? cs.isHD !== false : ch.isHD !== false,
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
      if (isValidHttpUrl(pUrl)) {
        const cleanPurl = pUrl.trim();
        const normPurl = cleanPurl.toLowerCase();
        if (!seenStreamUrls.has(`${ch.id}::${normPurl}`)) {
          seenStreamUrls.add(`${ch.id}::${normPurl}`);
          const sNum = channelServers.length + 1;
          const validBackups = bUrls.filter(isValidHttpUrl).map(u => u.trim());
          const pServer = {
            name: `${ch.name} (Server ${sNum} — ${defaultQuality})`,
            serverLabel: `Server ${sNum} — ${defaultQuality}`,
            channelName: ch.name,
            channelId: ch.id,
            channelLogo: ch.logo,
            url: cleanPurl,
            backupUrls: validBackups,
            backupUrl: validBackups[0] || cleanPurl,
            quality: defaultQuality,
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
      bUrls.forEach((bUrl) => {
        if (isValidHttpUrl(bUrl)) {
          const cleanBurl = bUrl.trim();
          const normBurl = cleanBurl.toLowerCase();
          if (!seenStreamUrls.has(`${ch.id}::${normBurl}`)) {
            seenStreamUrls.add(`${ch.id}::${normBurl}`);
            const sNum = channelServers.length + 1;
            const bServer = {
              name: `${ch.name} (Server ${sNum} — Backup)`,
              serverLabel: `Server ${sNum} — Backup`,
              channelName: ch.name,
              channelId: ch.id,
              channelLogo: ch.logo,
              url: cleanBurl,
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

      if (channelServers.length > 0) {
        broadcastingChannelDetails.push({
          id: ch.id,
          name: ch.name,
          logo: ch.logo,
          category: ch.category || 'Sports',
          quality: defaultQuality,
          streamUrl: channelServers[0].url,
          backupUrls: bUrls.filter(isValidHttpUrl).map(u => u.trim()),
          source: entry.source,
          sourceType: entry.sourceType,
          sourceField: entry.sourceField,
          verificationDetail: entry.verificationDetail,
          servers: channelServers
        });
      }
    }

    const devEvId = eventId || 'UNKNOWN';
    const devSport = (sport || 'UNKNOWN').toUpperCase();
    const devLeague = tourn || 'UNKNOWN';
    const devHome = event.homeTeam?.name || event.homeTeam || event.team1?.name || (Array.isArray(event.teams) ? event.teams[0] : '') || 'TBD';
    const devAway = event.awayTeam?.name || event.awayTeam || event.team2?.name || (Array.isArray(event.teams) ? event.teams[1] : '') || 'TBD';
    const devBcast = apiTokens.length > 0 ? apiTokens.map(t => t.text).join(', ') : (event.broadcaster || event.strTVStation || 'NONE');
    const devCid = event.channelId || (Array.isArray(event.channelIds) ? event.channelIds.join(', ') : 'NONE');
    const devMatchRes = broadcastingChannelDetails.map(c => c.name).join(', ') || 'NONE';
    const devReason = verifiedChannelEntries[0]?.verificationDetail || 'API_BROADCASTER_MATCH';
    const devStreamCnt = allStreams.length;

    console.log(`[CHANNEL_RESOLVER] ${devEvId} ${devSport} "${devLeague}" "${devHome}" "${devAway}" "${devBcast}" "${devCid}" "${devMatchRes}" ${devReason} ${devStreamCnt}`);
    console.log(`EVENT_ID=${devEvId} SPORT=${devSport} LEAGUE="${devLeague}" HOME_TEAM="${devHome}" AWAY_TEAM="${devAway}" BROADCASTER_FROM_API="${devBcast}" CHANNEL_ID_FROM_API="${devCid}" CHANNEL_MATCH_RESULT="${devMatchRes}" MATCH_REASON="${devReason}" AUTHORIZED_STREAM_COUNT=${devStreamCnt}`);

    return {
      hasStream: allStreams.length > 0,
      streams: allStreams,
      broadcastChannels: broadcastingChannelDetails.map(c => c.name),
      broadcastingChannelDetails: broadcastingChannelDetails,
      verificationSource: verifiedChannelEntries[0]?.sourceType || 'unverified',
      sourceField: verifiedChannelEntries[0]?.sourceField || null,
      verificationDetail: verifiedChannelEntries.map(e => e.verificationDetail).join('; ') || 'No verification'
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
    const nowMs = Date.now();
    const status = String(event.status || '').toLowerCase().trim();

    // 1. Authoritative end time check
    if (event.authoritativeEndTime) {
      const authEndMs = Date.parse(String(event.authoritativeEndTime));
      if (!isNaN(authEndMs) && authEndMs > 0 && nowMs > authEndMs) {
        return true;
      }
    }

    // 2. Explicit finished statuses
    const finishedStatuses = [
      'finished', 'ft', 'ended', 'completed', 'match finished', 'abandoned',
      'match abandoned', 'match drawn', 'no result',
      'match won', 'won by', 'final', 'status_final'
    ];
    if (finishedStatuses.includes(status)) return true;

    // 3. Status text keywords
    const statusTxt = (String(event.statusText || '') + ' ' + String(event.matchDesc || '')).toLowerCase();
    if (/(^|\b)(won by|won the|match won|match tied|match drawn|match ended|no result|abandoned|concluded|completed|winner)(\b|$)/i.test(statusTxt)) {
      return true;
    }

    // 4. Format-aware stale-LIVE safety ceiling
    if (event.timestamp) {
      const evTs = event.timestamp < 10000000000 ? event.timestamp * 1000 : event.timestamp;
      const sport = String(event.sport || event.sportName || '').toLowerCase();
      const fmt = String(event.matchFormat || event.matchType || event.matchDesc || '').toLowerCase();
      const tourn = String(event.tournament || event.league || event.seriesName || '').toLowerCase();

      let safeguardMs = 12 * 3600 * 1000;
      if (sport.includes('cricket')) {
        const isTestOrFc =
          fmt.includes('test') || fmt.includes('county') || fmt.includes('first-class') || fmt.includes('first_class') ||
          tourn.includes('test') || tourn.includes('county') || tourn.includes('first-class') || tourn.includes('first class') ||
          tourn.includes('sheffield') || tourn.includes('ranji') || tourn.includes('ashes') || tourn.includes('border-gavaskar') || tourn.includes('border gavaskar');
        if (isTestOrFc) {
          safeguardMs = 5.5 * 24 * 3600 * 1000;
        } else if (fmt.includes('odi') || tourn.includes('odi') || tourn.includes('one-day') || tourn.includes('one day')) {
          safeguardMs = 13 * 3600 * 1000;
        } else if (fmt.includes('t20') || tourn.includes('t20')) {
          safeguardMs = 10 * 3600 * 1000;
        } else {
          safeguardMs = 12 * 3600 * 1000;
        }
      }

      if (nowMs - evTs > safeguardMs) {
        return true;
      }
    }

    if (status === 'live') return false;

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
        const fmtLower = String(ev.matchFormat || ev.matchType || '').toLowerCase();
        const evMinTime = (sport === 'cricket' && (fmtLower === 'test' || fmtLower === 'county'))
          ? now - (5.5 * 24 * 60 * 60 * 1000)
          : minLiveTime;
        if (matchTime >= evMinTime && (matchTime <= maxTime || isSpecial)) {
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
      const cricketEngine = window.cricketEngine;
      const thesportsdbEngine = window.thesportsdbEngine;
      const wweEngine = window.wweEngine;

      const fetches = [
        cricketEngine ? cricketEngine.getAllMatches(forceRefresh) : Promise.resolve({ configured: false, events: [] }),
        thesportsdbEngine ? thesportsdbEngine.getAllMatches(forceRefresh) : Promise.resolve({ configured: false, events: [] }),
        wweEngine ? wweEngine.getAllEvents(forceRefresh) : Promise.resolve({ configured: false, events: [] })
      ];

      const results = await Promise.allSettled(fetches);

      const crRes = results[0].status === 'fulfilled' ? results[0].value : { configured: false, error: 'network_error', message: 'Cricket load failed', events: [] };
      const tsdbRes = (results[1] && results[1].status === 'fulfilled') ? results[1].value : { configured: false, events: [] };
      const wweRes = (results[2] && results[2].status === 'fulfilled') ? results[2].value : { configured: false, error: 'not_configured', message: 'WWE not configured', events: [] };

      // Record error states
      this.errors.cricket = crRes.error ? { error: crRes.error, message: crRes.message } : null;
      this.errors.wwe = (wweRes.error && wweRes.error !== 'not_configured') ? { error: wweRes.error, message: wweRes.message } : null;

      const crEvents = Array.isArray(crRes.events) ? crRes.events : [];
      const tsdbEvents = Array.isArray(tsdbRes.events) ? tsdbRes.events : [];
      const wweEvents = Array.isArray(wweRes.events) ? wweRes.events : [];

      // Update status reports
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

          // Cricket data MUST strictly come ONLY from CricketData.org / CricAPI
          if (sp === 'cricket') {
            const isCricketData = (ev.source && (String(ev.source).toLowerCase().includes('cricketdata') || String(ev.source).toLowerCase().includes('cricapi'))) ||
                                 String(ev.id).startsWith('cr-cricapi-') ||
                                 String(ev.id).startsWith('cr-cricketdata-');
            if (!isCricketData) {
              return; // Block other cricket sources
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
            if (!ev.broadcaster && streamInfo.streams[0]?.channelName && !String(ev.source || '').toLowerCase().includes('cricketdata') && !String(ev.source || '').toLowerCase().includes('cricapi')) {
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
   * Check if an event is within the 7-day display horizon in Bangladesh timezone
   */
  isEventWithin7Days(ev) {
    if (!ev) return false;

    // 1. Live events are ALWAYS included
    const status = (ev.status || '').toLowerCase().trim();
    if (status === 'live') return true;

    // 2. Today's events are ALWAYS included
    if (this.isEventToday(ev)) return true;

    // 3. Compare dates using Bangladesh timezone (Asia/Dhaka)
    const tz = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    const now = new Date();

    let todayLocalStr = '';
    try {
      todayLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch (e) {
      todayLocalStr = now.toISOString().split('T')[0];
    }

    const [nowY, nowM, nowD] = todayLocalStr.split(/[-/]/).map(Number);
    const startOfToday = new Date(Date.UTC(nowY, nowM - 1, nowD));

    let evDateObj = null;
    if (ev.timestamp && !isNaN(ev.timestamp)) {
      const ts = ev.timestamp < 10000000000 ? ev.timestamp * 1000 : ev.timestamp;
      evDateObj = new Date(ts);
    } else if (ev.date) {
      const dStr = String(ev.date).trim();
      if (dStr.toLowerCase() === 'today') return true;
      const parts = dStr.split(/[-/]/).map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        evDateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
      }
    }

    if (!evDateObj) return false;

    let evLocalStr = '';
    try {
      evLocalStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(evDateObj);
    } catch (e) {
      evLocalStr = evDateObj.toISOString().split('T')[0];
    }

    const [evY, evM, evD] = evLocalStr.split(/[-/]/).map(Number);
    const evDateOnly = new Date(Date.UTC(evY, evM - 1, evD));

    const timeDiff = evDateOnly.getTime() - startOfToday.getTime();
    const oneDayMs = 24 * 3600 * 1000;
    const dayDiff = Math.round(timeDiff / oneDayMs);

    // 7-day display horizon includes: Today (0) + Next 6 Days (1 to 6) = 7 days total.
    // Events beyond 6 days are excluded from feeds/counters.
    return (dayDiff >= 0 && dayDiff <= 6);
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
      list = list.filter(e => !this.isEventFinished(e) && (e.status || '').toLowerCase() === 'upcoming' && this.isEventWithin7Days(e));
    } else if (st === 'TODAY') {
      list = list.filter(e => !this.isEventFinished(e) && this.isEventToday(e));
    } else if (st === 'FAVORITES') {
      const favs = this.getFavorites();
      list = list.filter(e => !this.isEventFinished(e) && favs.includes(e.id));
    } else {
      // Default / 'ALL' tab: only active (live + upcoming) matches occurring within the 7-day display horizon
      list = list.filter(e => !this.isEventFinished(e) && this.isEventWithin7Days(e));
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
}

window.SportsCoordinator = SportsCoordinator;
window.sportsCoordinator = new SportsCoordinator();
window.formatEventTime = SportsCoordinator.formatEventTime;
window.isEventFinished = SportsCoordinator.isEventFinished;
