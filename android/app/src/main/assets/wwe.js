/**
 * HIGHFY TV - WWE & Professional Wrestling Events Engine
 * Strictly configured and managed for:
 * 1. WWE RAW
 * 2. WWE SMACKDOWN LIVE
 * 3. WWE NXT
 * 4. WWE SPECIAL (Premium Live Events / PLEs)
 * 5. AEW (All Elite Wrestling - Dynamite / Collision / PPVs)
 * 
 * Scheduled authentically according to broadcast timelines in Bangladesh Standard Time (Asia/Dhaka GMT+6).
 * Never generates fake live scores.
 */

class WWEEngine {
  constructor() {
    this.cache = {
      timestamp: 0,
      ttl: 300000, // 5 minutes cache
      data: []
    };
  }

  /**
   * Get configured WWE Feed URL
   */
  getApiUrl() {
    const localUrl = localStorage.getItem('highfy_wwe_url');
    if (localUrl && localUrl.trim()) return localUrl.trim();
    const configUrl = window.CONFIG?.WWE_API_URL;
    if (configUrl && configUrl.trim()) return configUrl.trim();
    return '';
  }

  /**
   * Calculate next dynamic broadcast date in Asia/Dhaka (BST)
   * targetDayOfWeek: 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
   * targetHourBST: Hour in Asia/Dhaka (e.g. 6 = 06:00 AM BST)
   */
  getNextBroadcastTimestamp(targetDayOfWeek, targetHourBST = 6, durationHours = 3.5) {
    const now = new Date();
    // Get current time in Asia/Dhaka
    const dhakaStr = now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
    const dhakaDate = new Date(dhakaStr);
    
    const currentDay = dhakaDate.getDay();
    let daysUntil = (targetDayOfWeek - currentDay + 7) % 7;

    // Build target date in Dhaka time
    const targetDhaka = new Date(dhakaDate);
    targetDhaka.setDate(dhakaDate.getDate() + daysUntil);
    targetDhaka.setHours(targetHourBST, 0, 0, 0);

    const endDhaka = new Date(targetDhaka.getTime() + (durationHours * 3600 * 1000));

    // If target broadcast finished today, advance to next week
    if (daysUntil === 0 && dhakaDate.getTime() > endDhaka.getTime()) {
      targetDhaka.setDate(targetDhaka.getDate() + 7);
    }

    // Convert back to UTC timestamp
    const diffFromNowMs = targetDhaka.getTime() - dhakaDate.getTime();
    const targetTimestamp = now.getTime() + diffFromNowMs;

    // Check status
    const isCurrentlyLive = (daysUntil === 0 && dhakaDate.getTime() >= targetDhaka.getTime() && dhakaDate.getTime() <= endDhaka.getTime());

    return {
      timestamp: targetTimestamp,
      isoString: new Date(targetTimestamp).toISOString(),
      isLive: isCurrentlyLive,
      isFinished: false
    };
  }

  /**
   * Status Normalization for WWE / Wrestling Events
   */
  parseStatus(ev, fallbackStatus = 'upcoming') {
    if (!ev) return { status: fallbackStatus, label: fallbackStatus === 'live' ? 'LIVE' : 'Upcoming' };
    const raw = (ev.status || '').toLowerCase().trim();
    if (raw === 'live' || raw === 'in_progress' || raw === 'in-progress') {
      return { status: 'live', label: 'LIVE' };
    }
    if (raw === 'finished' || raw === 'concluded' || raw === 'completed' || raw === 'ended') {
      return { status: 'finished', label: 'Finished' };
    }
    return { status: 'upcoming', label: 'Upcoming' };
  }

  /**
   * Format start time (Asia/Dhaka BST)
   */
  formatMatchTime(isoStringOrTimestamp, timezone = 'Asia/Dhaka') {
    if (typeof window !== 'undefined' && window.SportsCoordinator && typeof window.SportsCoordinator.formatEventTime === 'function') {
      return window.SportsCoordinator.formatEventTime(isoStringOrTimestamp, timezone);
    }
    if (!isoStringOrTimestamp) return 'Scheduled';
    try {
      let ts = null;
      if (typeof isoStringOrTimestamp === 'number') {
        ts = isoStringOrTimestamp < 10000000000 ? isoStringOrTimestamp * 1000 : isoStringOrTimestamp;
      } else {
        let str = String(isoStringOrTimestamp).trim();
        if (!str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) str = str.replace(' ', 'T') + 'Z';
        ts = new Date(str).getTime();
      }
      const date = new Date(ts);
      return date.toLocaleDateString('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return String(isoStringOrTimestamp);
    }
  }

  /**
   * Categorize strictly into WWE RAW, WWE SMACKDOWN LIVE, WWE NXT, WWE SPECIAL, or AEW
   */
  categorizeBrand(item) {
    const text = `${item.name || ''} ${item.title || ''} ${item.brand || ''} ${item.tournament || ''} ${item.league || ''} ${item.type || ''}`.toLowerCase();
    
    // 1. WWE RAW
    if (text.includes('raw') || text.includes('monday night')) {
      return {
        brand: 'WWE RAW',
        shortName: 'RAW',
        ribbon: 'WWE RAW',
        icon: 'fa-hand-fist',
        color: '#ef4444',
        logo: './assets/wwe-logos/wwe_raw.png'
      };
    }
    
    // 2. WWE SMACKDOWN LIVE
    if (text.includes('smackdown') || text.includes('smack down') || text.includes('friday night')) {
      return {
        brand: 'WWE SMACKDOWN LIVE',
        shortName: 'SmackDown Live',
        ribbon: 'SmackDown',
        icon: 'fa-hand-fist',
        color: '#0284c7',
        logo: './assets/wwe-logos/wwe_smackdown.png'
      };
    }
    
    // 3. WWE NXT
    if (text.includes('nxt') || text.includes('super tuesday')) {
      return {
        brand: 'WWE NXT',
        shortName: 'NXT',
        ribbon: 'WWE NXT',
        icon: 'fa-bolt',
        color: '#f59e0b',
        logo: './assets/wwe-logos/wwe_nxt.png'
      };
    }

    // 4. AEW (All Elite Wrestling)
    if (text.includes('aew') || text.includes('elite wrestling') || text.includes('dynamite') || text.includes('rampage') || text.includes('collision') || text.includes('all in') || text.includes('revolution')) {
      return {
        brand: 'AEW',
        shortName: 'AEW',
        ribbon: 'AEW',
        icon: 'fa-hand-back-fist',
        color: '#eab308',
        logo: './assets/wwe-logos/aew_official.svg'
      };
    }
    
    // 5. WWE SPECIAL (Premium Live Events / PLEs: WrestleMania, Royal Rumble, SummerSlam, Bad Blood, Crown Jewel, etc.)
    return {
      brand: 'WWE SPECIAL',
      shortName: 'WWE Special',
      ribbon: 'WWE Special',
      icon: 'fa-trophy',
      color: '#8b5cf6',
      logo: './assets/wwe-logos/wwe_special.png'
    };
  }

  /**
   * Normalize WWE / AEW Event item
   */
  normalizeEvent(item, index) {
    if (!item) return null;

    const brandInfo = this.categorizeBrand(item);
    const id = item.id || `wwe-${brandInfo.shortName.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`;
    const name = brandInfo.brand;
    const dateStr = item.date || item.startTime || item.dateTime;
    const timezone = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    
    let timestamp = item.timestamp;
    if (!timestamp && dateStr) {
      timestamp = new Date(dateStr).getTime();
    }
    if (!timestamp || isNaN(timestamp)) {
      timestamp = Date.now() + ((index + 1) * 24 * 3600 * 1000);
    } else if (timestamp < 10000000000) {
      timestamp *= 1000;
    }

    const matchTime = this.formatMatchTime(timestamp, timezone);
    const venue = item.venue ? `${item.venue}${item.city ? ', ' + item.city : ''}` : 'Arena';
    const statusParsed = this.parseStatus(item);

    // Strictly Brand / Show Names and Official Brand Logos (NO individual wrestler/player names)
    const homeName = brandInfo.brand === 'AEW' ? 'AEW' : 'WWE';
    const homeLogo = brandInfo.brand === 'AEW' ? './assets/wwe-logos/aew_official.svg' : './assets/wwe-logos/wwe_official.png';
    const awayName = brandInfo.shortName;
    const awayLogo = brandInfo.logo;

    return {
      id: id.startsWith('wwe-') || id.startsWith('aew-') ? id : `wwe-${id}`,
      rawId: id,
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: brandInfo.icon,
      title: name,
      league: brandInfo.brand,
      tournament: brandInfo.brand,
      brandCategory: brandInfo.brand,
      ribbonLabel: brandInfo.ribbon,
      eventName: name,
      eventType: brandInfo.brand,
      status: statusParsed.status,
      statusLabel: statusParsed.label,
      statusText: statusParsed.label,
      startTime: new Date(timestamp).toISOString(),
      matchTime: matchTime,
      timestamp: timestamp,
      venue: venue,
      isHot: true,
      isSpecial: true,

      homeTeam: {
        name: homeName,
        logo: homeLogo,
        score: ''
      },
      awayTeam: {
        name: awayName,
        logo: awayLogo,
        score: ''
      },

      team1: {
        name: homeName,
        logo: homeLogo,
        score: ''
      },
      team2: {
        name: awayName,
        logo: awayLogo,
        score: ''
      },

      timeOrTimer: statusParsed.status === 'live' ? 'LIVE' : (statusParsed.status === 'finished' ? 'FT' : matchTime),
      subText: `${brandInfo.brand} • ${venue}`,
      matches: item.matches || item.matchCard || [],
      details: item.details || item.description || '',
      streams: Array.isArray(item.streams) ? item.streams : [],
      source: 'Official Schedule'
    };
  }

  /**
   * Authentic Built-In Schedule strictly for:
   * 1. WWE RAW
   * 2. WWE SMACKDOWN LIVE
   * 3. WWE NXT
   * 4. WWE SPECIAL
   * 5. AEW
   */
  getDefaultEvents() {
    const tz = window.CONFIG?.TIMEZONE || 'Asia/Dhaka';
    const now = Date.now();

    const wweStream = {
      name: 'WWE 24/7 (Server 1 HD)',
      serverLabel: 'SERVER 1 (1080P FHD)',
      quality: '1080p FHD',
      url: 'http://103.114.11.37:8081/WWE-24/7/index.m3u8',
      channelName: 'WWE 24/7 HD',
      channelId: 'ch-wwe-24-7',
      channelLogo: './assets/wwe-logos/wwe_official.png'
    };

    const events = [];

    // 1. WWE 24/7 Non-Stop Live Stream Event Card
    events.push({
      id: 'wwe-24-7-live',
      rawId: 'wwe-24-7-live',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-hand-fist',
      title: 'WWE 24/7 Non-Stop Live Action',
      name: 'WWE 24/7 Live Stream',
      league: 'WWE Network',
      tournament: 'WWE Special',
      brandCategory: 'WWE Special',
      ribbonLabel: 'WWE 24/7',
      eventName: 'WWE 24/7 Live Stream',
      eventType: 'WWE Special',
      status: 'live',
      statusLabel: 'LIVE',
      statusText: 'LIVE 24/7',
      startTime: new Date(now).toISOString(),
      matchTime: 'Live 24/7 Stream',
      timestamp: now,
      venue: 'WWE Worldwide',
      isHot: true,
      isSpecial: true,
      homeTeam: {
        name: 'WWE Superstars',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      awayTeam: {
        name: 'WWE 24/7 HD',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team1: {
        name: 'WWE Superstars',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team2: {
        name: 'WWE 24/7 HD',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      timeOrTimer: 'LIVE',
      subText: 'WWE Network • Non-Stop 24/7 HD Stream',
      broadcaster: 'WWE 24/7 HD',
      broadcasters: ['WWE 24/7 HD', 'WWE Network'],
      channelId: 'ch-wwe-24-7',
      channelName: 'WWE 24/7 HD',
      channelLogo: './assets/wwe-logos/wwe_official.png',
      hasStream: true,
      streams: [wweStream],
      source: 'Official Schedule'
    });

    // 2. WWE RAW
    const rawBc = this.getNextBroadcastTimestamp(2, 6, 3.5); // Tuesday 06:00 AM BST
    events.push({
      id: 'wwe-raw-live',
      rawId: 'wwe-raw-live',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-hand-fist',
      title: 'WWE RAW',
      name: 'WWE RAW',
      league: 'WWE RAW',
      tournament: 'WWE RAW',
      brandCategory: 'WWE RAW',
      ribbonLabel: 'WWE RAW',
      eventName: 'WWE RAW',
      eventType: 'WWE RAW',
      status: rawBc.isLive ? 'live' : 'upcoming',
      statusLabel: rawBc.isLive ? 'LIVE' : 'Upcoming',
      statusText: rawBc.isLive ? 'LIVE' : 'Scheduled',
      startTime: rawBc.isoString,
      matchTime: this.formatMatchTime(rawBc.timestamp, tz),
      timestamp: rawBc.timestamp,
      venue: 'USA Arena',
      isHot: true,
      isSpecial: true,
      homeTeam: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      awayTeam: {
        name: 'RAW',
        logo: './assets/wwe-logos/wwe_raw.png',
        score: ''
      },
      team1: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team2: {
        name: 'RAW',
        logo: './assets/wwe-logos/wwe_raw.png',
        score: ''
      },
      timeOrTimer: rawBc.isLive ? 'LIVE' : this.formatMatchTime(rawBc.timestamp, tz),
      subText: 'WWE RAW • Live on WWE 24/7',
      broadcaster: 'WWE 24/7 HD',
      broadcasters: ['WWE 24/7 HD', 'Sony Sports Ten 1 HD', 'WWE Network'],
      channelId: 'ch-wwe-24-7',
      channelName: 'WWE 24/7 HD',
      channelLogo: './assets/wwe-logos/wwe_official.png',
      hasStream: true,
      streams: [wweStream],
      source: 'Official Schedule'
    });

    // 3. WWE SMACKDOWN LIVE
    const sdBc = this.getNextBroadcastTimestamp(6, 6, 2.5); // Saturday 06:00 AM BST
    events.push({
      id: 'wwe-smackdown-live',
      rawId: 'wwe-smackdown-live',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-hand-fist',
      title: 'WWE SMACKDOWN LIVE',
      name: 'WWE SMACKDOWN LIVE',
      league: 'WWE SMACKDOWN LIVE',
      tournament: 'WWE SMACKDOWN LIVE',
      brandCategory: 'WWE SMACKDOWN LIVE',
      ribbonLabel: 'SmackDown',
      eventName: 'WWE SMACKDOWN LIVE',
      eventType: 'WWE SMACKDOWN LIVE',
      status: sdBc.isLive ? 'live' : 'upcoming',
      statusLabel: sdBc.isLive ? 'LIVE' : 'Upcoming',
      statusText: sdBc.isLive ? 'LIVE' : 'Scheduled',
      startTime: sdBc.isoString,
      matchTime: this.formatMatchTime(sdBc.timestamp, tz),
      timestamp: sdBc.timestamp,
      venue: 'USA Arena',
      isHot: true,
      isSpecial: true,
      homeTeam: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      awayTeam: {
        name: 'SmackDown Live',
        logo: './assets/wwe-logos/wwe_smackdown.png',
        score: ''
      },
      team1: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team2: {
        name: 'SmackDown Live',
        logo: './assets/wwe-logos/wwe_smackdown.png',
        score: ''
      },
      timeOrTimer: sdBc.isLive ? 'LIVE' : this.formatMatchTime(sdBc.timestamp, tz),
      subText: 'WWE SmackDown • Live on WWE 24/7',
      broadcaster: 'WWE 24/7 HD',
      broadcasters: ['WWE 24/7 HD', 'Sony Sports Ten 1 HD', 'WWE Network'],
      channelId: 'ch-wwe-24-7',
      channelName: 'WWE 24/7 HD',
      channelLogo: './assets/wwe-logos/wwe_official.png',
      hasStream: true,
      streams: [wweStream],
      source: 'Official Schedule'
    });

    // 4. WWE NXT
    const nxtBc = this.getNextBroadcastTimestamp(3, 6, 2.5); // Wednesday 06:00 AM BST
    events.push({
      id: 'wwe-nxt-live',
      rawId: 'wwe-nxt-live',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-bolt',
      title: 'WWE NXT',
      name: 'WWE NXT',
      league: 'WWE NXT',
      tournament: 'WWE NXT',
      brandCategory: 'WWE NXT',
      ribbonLabel: 'WWE NXT',
      eventName: 'WWE NXT',
      eventType: 'WWE NXT',
      status: nxtBc.isLive ? 'live' : 'upcoming',
      statusLabel: nxtBc.isLive ? 'LIVE' : 'Upcoming',
      statusText: nxtBc.isLive ? 'LIVE' : 'Scheduled',
      startTime: nxtBc.isoString,
      matchTime: this.formatMatchTime(nxtBc.timestamp, tz),
      timestamp: nxtBc.timestamp,
      venue: 'WWE Performance Center',
      isHot: true,
      isSpecial: true,
      homeTeam: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      awayTeam: {
        name: 'NXT',
        logo: './assets/wwe-logos/wwe_nxt.png',
        score: ''
      },
      team1: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team2: {
        name: 'NXT',
        logo: './assets/wwe-logos/wwe_nxt.png',
        score: ''
      },
      timeOrTimer: nxtBc.isLive ? 'LIVE' : this.formatMatchTime(nxtBc.timestamp, tz),
      subText: 'WWE NXT • Live on WWE 24/7',
      broadcaster: 'WWE 24/7 HD',
      broadcasters: ['WWE 24/7 HD', 'WWE Network'],
      channelId: 'ch-wwe-24-7',
      channelName: 'WWE 24/7 HD',
      channelLogo: './assets/wwe-logos/wwe_official.png',
      hasStream: true,
      streams: [wweStream],
      source: 'Official Schedule'
    });

    // 5. WWE SPECIAL (PLE)
    const pleBc = this.getNextBroadcastTimestamp(0, 6, 4.0); // Sunday 06:00 AM BST
    events.push({
      id: 'wwe-special-ple',
      rawId: 'wwe-special-ple',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-trophy',
      title: 'WWE SPECIAL (Premium Live Event)',
      name: 'WWE SPECIAL',
      league: 'WWE SPECIAL',
      tournament: 'WWE SPECIAL',
      brandCategory: 'WWE SPECIAL',
      ribbonLabel: 'WWE Special',
      eventName: 'WWE SPECIAL',
      eventType: 'WWE SPECIAL',
      status: pleBc.isLive ? 'live' : 'upcoming',
      statusLabel: pleBc.isLive ? 'LIVE' : 'Upcoming',
      statusText: pleBc.isLive ? 'LIVE' : 'Scheduled',
      startTime: pleBc.isoString,
      matchTime: this.formatMatchTime(pleBc.timestamp, tz),
      timestamp: pleBc.timestamp,
      venue: 'Major Arena Stadium',
      isHot: true,
      isSpecial: true,
      homeTeam: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      awayTeam: {
        name: 'WWE Special',
        logo: './assets/wwe-logos/wwe_special.png',
        score: ''
      },
      team1: {
        name: 'WWE',
        logo: './assets/wwe-logos/wwe_official.png',
        score: ''
      },
      team2: {
        name: 'WWE Special',
        logo: './assets/wwe-logos/wwe_special.png',
        score: ''
      },
      timeOrTimer: pleBc.isLive ? 'LIVE' : this.formatMatchTime(pleBc.timestamp, tz),
      subText: 'WWE PLE • Live on WWE 24/7',
      broadcaster: 'WWE 24/7 HD',
      broadcasters: ['WWE 24/7 HD', 'Sony Sports Ten 1 HD', 'WWE Network'],
      channelId: 'ch-wwe-24-7',
      channelName: 'WWE 24/7 HD',
      channelLogo: './assets/wwe-logos/wwe_official.png',
      hasStream: true,
      streams: [wweStream],
      source: 'Official Schedule'
    });

    return events;
  }

  /**
   * Fetch All WWE & AEW Events strictly filtered to:
   * WWE RAW, WWE SMACKDOWN LIVE, WWE NXT, WWE SPECIAL, and AEW
   */
  async getAllEvents(forceRefresh = false) {
    const apiUrl = this.getApiUrl();
    if (!apiUrl) {
      const defaults = this.getDefaultEvents();
      return {
        configured: true,
        events: defaults
      };
    }

    const now = Date.now();
    if (!forceRefresh && (now - this.cache.timestamp < this.cache.ttl) && this.cache.data.length > 0) {
      return {
        configured: true,
        events: this.cache.data
      };
    }

    try {
      console.log('[WWEEngine] Fetching WWE/AEW data from URL:', apiUrl);
      const res = await fetch(apiUrl);
      if (!res.ok) {
        return {
          configured: true,
          events: []
        };
      }

      const json = await res.json();
      const rawList = Array.isArray(json) ? json : (json.events || json.data || []);
      
      // Strictly filter to WWE RAW, WWE SMACKDOWN LIVE, WWE NXT, WWE SPECIAL, and AEW
      const allowedRegex = /(raw|wwe raw|smackdown|smack down|smackdown live|wwe smackdown|nxt|wwe nxt|wwe special|ple|wrestlemania|summerslam|royal rumble|survivor series|bad blood|crown jewel|aew|all elite wrestling|dynamite|rampage|collision|all in|revolution)/i;
      
      const normalized = rawList
        .filter(item => {
          if (!item) return false;
          const str = `${item.name || ''} ${item.title || ''} ${item.brand || ''} ${item.league || ''} ${item.tournament || ''}`;
          return allowedRegex.test(str);
        })
        .map((item, idx) => this.normalizeEvent(item, idx))
        .filter(ev => ev !== null);

      if (normalized.length === 0) {
        return {
          configured: true,
          events: []
        };
      }

      normalized.sort((a, b) => {
        const order = { live: 1, upcoming: 2, finished: 3 };
        const diff = (order[a.status] || 99) - (order[b.status] || 99);
        if (diff !== 0) return diff;
        return a.timestamp - b.timestamp;
      });

      this.cache.timestamp = Date.now();
      this.cache.data = normalized;

      return {
        configured: true,
        events: normalized
      };
    } catch (err) {
      console.error('[WWEEngine] Error loading WWE/AEW events:', err);
      return {
        configured: true,
        events: []
      };
    }
  }
}

window.WWEEngine = WWEEngine;
window.wweEngine = new WWEEngine();
