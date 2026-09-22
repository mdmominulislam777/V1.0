/**
 * HIGHFY TV - MASTER EVENT ENGINE (sportsApi/eventEngine.js)
 * Production-Ready Multi-Sport Event Engine with Verified Broadcaster & Channel Resolution.
 * Strictly respects HighFy TV specifications:
 * - Real API Only (DEV_MOCK_MODE = false)
 * - Strict Sport Isolation
 * - Deterministic Deduplication
 * - Broadcaster & Multi-Server Channel Resolution
 * - Seamless Backwards Compatibility with HighFy TV UI & SportsCoordinator
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    const eventModel = require('./eventModel.js');
    const broadcasterResolver = require('./broadcasterResolver.js');
    const channelResolver = require('./channelResolver.js');
    const theSportsDbAdapter = require('./adapters/theSportsDbAdapter.js');
    const cricketAdapter = require('./adapters/cricketAdapter.js');
    const sofaScoreAdapter = require('./adapters/sofaScoreAdapter.js');
    const wweAdapter = require('./adapters/wweAdapter.js');
    const footballAdapter = require('./adapters/footballAdapter.js');
    module.exports = factory(
      eventModel,
      broadcasterResolver,
      channelResolver,
      theSportsDbAdapter,
      cricketAdapter,
      sofaScoreAdapter,
      wweAdapter,
      footballAdapter
    );
  } else {
    root.HighFyEventEngine = factory(
      root.HighFyEventModel,
      root.HighFyBroadcasterResolver,
      root.HighFyChannelResolver,
      root.HighFyTheSportsDbAdapter,
      root.HighFyCricketAdapter,
      root.HighFySofaScoreAdapter,
      root.HighFyWweAdapter,
      root.HighFyFootballAdapter
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function(
  EventModel,
  BroadcasterResolver,
  ChannelResolver,
  TheSportsDbAdapter,
  CricketAdapter,
  SofaScoreAdapter,
  WweAdapter,
  FootballAdapter
) {
  'use strict';

  class HighFyEventEngine {
    constructor(options = {}) {
      this.channels = options.channels || [];
      this.events = [];
      this.cachedEvents = [];
      this.lastFetchTime = 0;
      this.refreshIntervalMs = 60 * 1000; // 60s auto-refresh
      this.timerId = null;
      this.listeners = new Set();
      this.isFetching = false;
      this.DEV_MOCK_MODE = false; // Strictly real API only
    }

    /**
     * Update HighFy channel registry
     */
    setChannels(channels) {
      if (Array.isArray(channels)) {
        this.channels = channels;
        // Re-resolve channels on existing events if present
        if (this.events.length > 0) {
          this.rebindChannelsToEvents();
        }
      }
    }

    /**
     * Set active curated events directly (e.g. from coordinator curated feed)
     */
    setEvents(events) {
      if (!Array.isArray(events)) return;
      this.events = events;
      this.cachedEvents = events;
      this.lastFetchTime = Date.now();
      if (this.channels && this.channels.length > 0) {
        this.rebindChannelsToEvents();
      }
      this.notifyListeners();
    }

    /**
     * Re-binds channel streams to all loaded events
     */
    rebindChannelsToEvents() {
      if (this.channels.length === 0) return;
      this.events.forEach(ev => {
        const resolved = ChannelResolver.resolveEventChannels(ev, this.channels);
        if (resolved.status === 'MATCHED') {
          ev.channelId = resolved.channelId;
          ev.channelName = resolved.channelName;
          ev.channelLogo = resolved.channelLogo;
          ev.streams = resolved.streams;
          ev.hasStream = resolved.streams.some(s => s.active);
          ev.verified = true;
          ev.broadcastChannels = [resolved.channelName];
          ev.broadcastingChannelDetails = [{
            id: resolved.channelId,
            channelId: resolved.channelId,
            name: resolved.channelName,
            logo: resolved.channelLogo,
            active: ev.hasStream,
            verified: true
          }];
        } else {
          ev.channelId = null;
          ev.channelName = null;
          ev.channelLogo = null;
          ev.streams = [];
          ev.hasStream = false;
          ev.broadcastChannels = [];
          ev.broadcastingChannelDetails = [];
        }
      });
    }

    /**
     * Deduplicates raw events using deterministic key
     */
    deduplicateEvents(eventList) {
      const seenKeys = new Set();
      const unique = [];

      for (const ev of eventList) {
        if (!ev) continue;
        const key = EventModel.generateDeduplicationKey(ev);
        if (key && !seenKeys.has(key)) {
          seenKeys.add(key);
          unique.push(ev);
        }
      }

      return unique;
    }

    /**
     * Sorts events according to HighFy TV specifications:
     * LIVE -> TODAY -> UPCOMING -> ENDED
     */
    sortEvents(eventList) {
      const statusWeight = {
        'LIVE': 0,
        'TODAY': 1,
        'UPCOMING': 2,
        'ENDED': 3
      };

      return eventList.slice().sort((a, b) => {
        const wA = statusWeight[a.status] ?? 2;
        const wB = statusWeight[b.status] ?? 2;
        if (wA !== wB) return wA - wB;

        // Same status: order by timestamp ascending for upcoming, descending for ended
        if (wA === 3) {
          return (b.timestamp || 0) - (a.timestamp || 0);
        }
        return (a.timestamp || 0) - (b.timestamp || 0);
      });
    }

    /**
     * Process raw incoming events from any API:
     * 1. Normalize
     * 2. Sport Isolation
     * 3. Channel & Stream Resolution
     * 4. Deduplicate
     * 5. Sort
     */
    processIncomingEvents(rawEvents) {
      if (!Array.isArray(rawEvents)) return [];

      const normalized = [];
      for (const raw of rawEvents) {
        if (!raw) continue;
        // Already unified?
        let unified = raw.sport && raw.homeTeam && raw.awayTeam && raw.title ? raw : null;

        if (!unified) {
          // Detect source and adapt
          if (raw.idEvent || raw.strEvent) {
            unified = TheSportsDbAdapter.normalizeTheSportsDbEvent(raw);
          } else if (raw.matchId || raw.seriesName || raw.matchInfo) {
            unified = CricketAdapter.normalizeCricketEvent(raw);
          } else if (raw.startTimestamp || raw.tournament) {
            unified = SofaScoreAdapter.normalizeSofaScoreEvent(raw);
          } else if (raw.event_key || raw.match_id) {
            unified = FootballAdapter.normalizeFootballEvent(raw);
          } else if (raw.show || (raw.title && raw.title.toLowerCase().includes('wwe'))) {
            unified = WweAdapter.normalizeWweEvent(raw);
          }
        }

        if (unified) {
          // Broadcaster check
          if (!unified.broadcaster && unified.broadcasters && unified.broadcasters.length > 0) {
            unified.broadcaster = unified.broadcasters[0];
          }

          // Channel resolver
          if (this.channels.length > 0) {
            const chMatch = ChannelResolver.resolveEventChannels(unified, this.channels);
            if (chMatch.status === 'MATCHED') {
              unified.channelId = chMatch.channelId;
              unified.channelName = chMatch.channelName;
              unified.channelLogo = chMatch.channelLogo;
              unified.streams = chMatch.streams;
              unified.hasStream = chMatch.streams.some(s => s.active);
              unified.verified = true;
              unified.broadcastChannels = [chMatch.channelName];
              unified.broadcastingChannelDetails = [{
                id: chMatch.channelId,
                channelId: chMatch.channelId,
                name: chMatch.channelName,
                logo: chMatch.channelLogo,
                active: unified.hasStream,
                verified: true
              }];
            } else {
              unified.channelId = null;
              unified.channelName = null;
              unified.channelLogo = null;
              unified.streams = [];
              unified.hasStream = false;
              unified.broadcastChannels = [];
              unified.broadcastingChannelDetails = [];
            }
          }

          normalized.push(unified);
        }
      }

      const deduplicated = this.deduplicateEvents(normalized);
      const sorted = this.sortEvents(deduplicated);

      this.events = sorted;
      this.lastFetchTime = Date.now();
      if (sorted.length > 0) {
        this.cachedEvents = sorted;
      }

      this.notifyListeners();
      return sorted;
    }

    /**
     * Start background auto-refresh every 60s
     */
    startAutoRefresh(fetchCallback) {
      this.stopAutoRefresh();
      if (typeof fetchCallback === 'function') {
        this.timerId = setInterval(() => {
          if (!this.isFetching) {
            fetchCallback();
          }
        }, this.refreshIntervalMs);
      }
    }

    /**
     * Stop background auto-refresh
     */
    stopAutoRefresh() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }

    /**
     * Subscribe to event updates
     */
    subscribe(listener) {
      if (typeof listener === 'function') {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      return () => {};
    }

    notifyListeners() {
      for (const listener of this.listeners) {
        try {
          listener(this.events);
        } catch (e) {
          console.warn('[HighFyEventEngine] Listener notification error:', e);
        }
      }
    }

    /**
     * Get filtered events by sport & status
     */
    getFilteredEvents({ sport = 'all', status = 'all', searchQuery = '' } = {}) {
      let list = this.events;

      // 1. Sport isolation filter
      if (sport && sport.toLowerCase() !== 'all') {
        const sp = sport.toLowerCase().trim();
        list = list.filter(e => (e.sport || '').toLowerCase() === sp);
      }

      // 2. Status filter
      if (status && status.toUpperCase() !== 'ALL') {
        const st = status.toUpperCase().trim();
        if (st === 'LIVE') {
          list = list.filter(e => e.status === 'LIVE');
        } else if (st === 'TODAY') {
          list = list.filter(e => e.status === 'TODAY' || e.status === 'LIVE');
        } else if (st === 'UPCOMING') {
          list = list.filter(e => e.status === 'UPCOMING' || e.status === 'TODAY');
        } else if (st === 'ENDED' || st === 'FINISHED') {
          list = list.filter(e => e.status === 'ENDED');
        }
      }

      // 3. Search Query
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(e => {
          const title = (e.title || '').toLowerCase();
          const t1 = (e.homeTeam?.name || e.team1?.name || '').toLowerCase();
          const t2 = (e.awayTeam?.name || e.team2?.name || '').toLowerCase();
          const league = (e.league || '').toLowerCase();
          const bcast = (e.broadcaster || '').toLowerCase();
          return title.includes(q) || t1.includes(q) || t2.includes(q) || league.includes(q) || bcast.includes(q);
        });
      }

      return list;
    }
  }

  return {
    HighFyEventEngine,
    EventModel,
    BroadcasterResolver,
    ChannelResolver,
    TheSportsDbAdapter,
    CricketAdapter,
    SofaScoreAdapter,
    WweAdapter,
    FootballAdapter
  };
});
