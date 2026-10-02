/**
 * HIGHFY TV - DYNAMIC BROADCASTER & CHANNEL DISCOVERY SYSTEM
 * 
 * Objectives & Behavior:
 * 1. Recursive discovery across the ENTIRE event JSON / object (no single-field assumption).
 * 2. Strict no-invention policy (never guess broadcasters from league, team, country or catalog).
 * 3. Event isolation (keyed by eventId, no cross-event pollution).
 * 4. Separate Broadcaster Discovery from Playback Authorization (Discovered != Playable).
 * 5. Extraction of metadata: name, logo, country, territory, type, source, sourcePath, officialUrl, streamUrl.
 * 6. Normalization and deduplication.
 * 7. Development-only debug logging with sourcePath auditing (zero secrets exposed).
 */

(function(root, factory) {
  const resolved = factory();
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = resolved;
  }
  if (typeof root !== 'undefined') {
    root.HighFyBroadcasterResolver = resolved;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.HighFyBroadcasterResolver = resolved;
  }
  if (typeof window !== 'undefined') {
    window.HighFyBroadcasterResolver = resolved;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function() {
  'use strict';

  // Substring keywords to detect broadcaster/channel/network fields across any schema
  const BROADCASTER_FIELD_KEYWORDS = [
    'broadcaster',
    'broadcasters',
    'broadcast',
    'broadcasts',
    'network',
    'networks',
    'tv',
    'tvstation',
    'strtvstation',
    'strbroadcaster',
    'strbroadcast',
    'strchannel',
    'television',
    'channel',
    'channels',
    'channelid',
    'channelname',
    'media',
    'streaming',
    'streams',
    'live_stream',
    'live_streams',
    'livestream',
    'coverage',
    'where_to_watch',
    'wheretowatch',
    'watch',
    'watch_on',
    'watchon',
    'rights_holder',
    'rightsholder',
    'rights_holders',
    'rightsholders',
    'rights',
    'broadcast_rights',
    'station'
  ];

  // Generic non-channel tokens to reject
  const BANNED_GENERIC_TOKENS = new Set([
    'null', 'undefined', 'n/a', 'na', 'none', 'tbd', 'tba', 'various', 'local',
    'unknown', 'stream', 'live stream', 'online', 'web', 'internet', 'official website',
    'app', 'mobile app', 'youtube', 'facebook', 'twitter', 'tiktok',
    'live', 'livestream', 'channel', 'channels', 'broadcast', 'broadcaster',
    'match', 'game', 'event', 'sports', 'stadium', 'venue', 'true', 'false'
  ]);

  /**
   * Country flags / territory emoji helper (optional UI flair if country is provided)
   */
  const COUNTRY_FLAGS = {
    'bangladesh': '🇧🇩',
    'india': '🇮🇳',
    'pakistan': '🇵🇰',
    'united states': '🇺🇸',
    'usa': '🇺🇸',
    'united kingdom': '🇬🇧',
    'uk': '🇬🇧',
    'england': '🇬🇧',
    'australia': '🇦🇺',
    'new zealand': '🇳🇿',
    'south africa': '🇿🇦',
    'canada': '🇨🇦',
    'international': '🌍',
    'global': '🌍',
    'worldwide': '🌍'
  };

  /**
   * Cleans a raw text token
   */
  function sanitizeNameToken(token) {
    if (!token || typeof token !== 'string') return null;
    let clean = token.trim();
    // Remove unwanted surrounding quotes or brackets
    clean = clean.replace(/^["'\[\(]+|["'\]\)]+$/g, '').trim();
    if (!clean || clean.length < 2) return null;
    const lower = clean.toLowerCase();
    if (BANNED_GENERIC_TOKENS.has(lower)) return null;
    // Reject numbers only
    if (/^\d+$/.test(clean)) return null;
    // Reject boolean strings
    if (lower === 'true' || lower === 'false') return null;
    return clean;
  }

  /**
   * Validates if a string is a valid URL
   */
  function isValidHttpUrl(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim().toLowerCase();
    return s.startsWith('http://') || s.startsWith('https://');
  }

  /**
   * Deep recursive search across any object or array
   */
  function findBroadcastCandidates(eventData, currentPath = '', depth = 0, candidates = []) {
    if (!eventData || depth > 8) return candidates;

    // 1. Primitive string inside recognized key path
    if (typeof eventData === 'string') {
      const sanitized = sanitizeNameToken(eventData);
      if (sanitized) {
        candidates.push({
          name: sanitized,
          logo: null,
          country: null,
          territory: null,
          type: 'TV',
          sourcePath: currentPath || 'root',
          officialUrl: null,
          streamUrl: null
        });
      }
      return candidates;
    }

    // 2. Array traversal
    if (Array.isArray(eventData)) {
      eventData.forEach((item, idx) => {
        const itemPath = currentPath ? `${currentPath}[${idx}]` : `[${idx}]`;
        if (typeof item === 'string') {
          const sanitized = sanitizeNameToken(item);
          if (sanitized) {
            candidates.push({
              name: sanitized,
              logo: null,
              country: null,
              territory: null,
              type: 'TV',
              sourcePath: itemPath,
              officialUrl: null,
              streamUrl: null
            });
          }
        } else if (typeof item === 'object' && item !== null) {
          inspectAndExtractObject(item, itemPath, depth + 1, candidates);
        }
      });
      return candidates;
    }

    // 3. Object traversal
    if (typeof eventData === 'object' && eventData !== null) {
      inspectAndExtractObject(eventData, currentPath, depth, candidates);
    }

    return candidates;
  }

  /**
   * Inspects an individual object for broadcaster fields
   */
  function inspectAndExtractObject(obj, currentPath, depth, candidates) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;

    // Check if this object itself represents a broadcaster / channel record
    const hasNameProp = obj.name || obj.channelName || obj.broadcasterName || obj.networkName || obj.title || obj.strTVStation || obj.strBroadcaster;
    const isDirectBroadcasterObject = Boolean(
      hasNameProp &&
      (currentPath.toLowerCase().includes('broadcas') ||
       currentPath.toLowerCase().includes('channel') ||
       currentPath.toLowerCase().includes('network') ||
       currentPath.toLowerCase().includes('tv') ||
       currentPath.toLowerCase().includes('watch') ||
       currentPath.toLowerCase().includes('right') ||
       currentPath.toLowerCase().includes('coverage') ||
       currentPath.toLowerCase().includes('stream'))
    );

    if (isDirectBroadcasterObject && typeof hasNameProp === 'string') {
      const sanitized = sanitizeNameToken(hasNameProp);
      if (sanitized) {
        const logo = (obj.logo || obj.logoUrl || obj.icon || obj.image || obj.badge || obj.strLogo || null);
        const country = (obj.country || obj.countryName || obj.location || obj.nation || null);
        const territory = (obj.territory || obj.region || obj.market || null);
        const type = (obj.type || obj.mediaType || 'TV');
        const officialUrl = (obj.officialUrl || obj.watchUrl || obj.website || (isValidHttpUrl(obj.url) && !obj.url.includes('.m3u8') ? obj.url : null));
        const streamUrl = (obj.streamUrl || obj.stream_url || (isValidHttpUrl(obj.url) && obj.url.includes('.m3u8') ? obj.url : null));

        candidates.push({
          name: sanitized,
          logo: isValidHttpUrl(logo) ? logo.trim() : null,
          country: typeof country === 'string' ? country.trim() : null,
          territory: typeof territory === 'string' ? territory.trim() : null,
          type: typeof type === 'string' ? type.trim() : 'TV',
          sourcePath: currentPath ? `${currentPath}.name` : 'name',
          officialUrl: isValidHttpUrl(officialUrl) ? officialUrl.trim() : null,
          streamUrl: isValidHttpUrl(streamUrl) ? streamUrl.trim() : null
        });
      }
    }

    // Traverse every key in the object
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;

      const keyLower = key.toLowerCase();
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      const isTargetKey = BROADCASTER_FIELD_KEYWORDS.some(k => keyLower.includes(k));

      if (isTargetKey) {
        if (typeof value === 'string') {
          // May contain delimited broadcasters e.g. "Sky Sports Main Event, TNT Sports 1 / ESPN"
          const parts = value.split(/[,/|;\n]/);
          parts.forEach(p => {
            const sanitized = sanitizeNameToken(p);
            if (sanitized) {
              candidates.push({
                name: sanitized,
                logo: null,
                country: null,
                territory: null,
                type: 'TV',
                sourcePath: nextPath,
                officialUrl: null,
                streamUrl: null
              });
            }
          });
        } else if (Array.isArray(value)) {
          findBroadcastCandidates(value, nextPath, depth + 1, candidates);
        } else if (typeof value === 'object') {
          findBroadcastCandidates(value, nextPath, depth + 1, candidates);
        }
      } else if (typeof value === 'object') {
        // Continue recursive walk down arbitrary schemas
        findBroadcastCandidates(value, nextPath, depth + 1, candidates);
      }
    }
  }

  /**
   * Normalization & Deduplication:
   * Merges duplicate candidate records, preserves richer metadata (e.g. logo/country/officialUrl),
   * and retains the most descriptive authentic display name.
   */
  function normalizeAndDeduplicate(candidates, eventId, eventSource = 'sports_api') {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    const map = new Map();

    candidates.forEach(cand => {
      if (!cand || !cand.name) return;
      const cleanName = sanitizeNameToken(cand.name);
      if (!cleanName) return;

      // Deduplication key: normalized lower letters/digits without punctuation
      const normKey = cleanName
        .toLowerCase()
        .replace(/[\s\-_.]+/g, ' ')
        .replace(/[^a-z0-9]/g, '')
        .trim();

      if (!normKey) return;

      if (!map.has(normKey)) {
        map.set(normKey, {
          eventId: eventId || 'event-generic',
          name: cleanName,
          logo: cand.logo || null,
          country: cand.country || null,
          territory: cand.territory || null,
          type: cand.type || 'TV',
          source: eventSource || 'sports_api',
          sourcePath: cand.sourcePath || 'unknown',
          discovered: true,
          authorizationStatus: 'unknown',
          playbackStatus: 'unavailable',
          officialUrl: cand.officialUrl || null,
          streamUrl: cand.streamUrl || null,
          servers: []
        });
      } else {
        // Merge richer metadata if available in duplicate path
        const existing = map.get(normKey);
        if (!existing.logo && cand.logo) existing.logo = cand.logo;
        if (!existing.country && cand.country) existing.country = cand.country;
        if (!existing.territory && cand.territory) existing.territory = cand.territory;
        if (!existing.officialUrl && cand.officialUrl) existing.officialUrl = cand.officialUrl;
        if (!existing.streamUrl && cand.streamUrl) existing.streamUrl = cand.streamUrl;
        // Keep the more descriptive display name (e.g. "T Sports HD" over "T Sports")
        if (cleanName.length > existing.name.length && cleanName.toLowerCase().includes(existing.name.toLowerCase())) {
          existing.name = cleanName;
        }
      }
    });

    return Array.from(map.values());
  }

  /**
   * Main Broadcaster Discovery Function
   * Recursively inspects the event object, isolates by eventId, extracts and deduplicates.
   */
  function discoverBroadcasters(eventData) {
    if (!eventData || typeof eventData !== 'object') {
      return {
        eventId: null,
        discovered: false,
        broadcasters: [],
        count: 0,
        displayLabel: 'Broadcast information unavailable'
      };
    }

    const eventId = eventData.id || eventData.rawId || eventData.matchId || eventData.idEvent || 'event-single';
    const eventSource = eventData.source || 'sports_api';

    // 1. Recursive candidate extraction
    const rawCandidates = findBroadcastCandidates(eventData, 'event');

    // 2. Normalization & Deduplication
    const finalBroadcasters = normalizeAndDeduplicate(rawCandidates, eventId, eventSource);

    // 3. Development-only Audit Logging (zero secrets)
    try {
      if (typeof window !== 'undefined' && (window.location?.hostname === 'localhost' || window.location?.hostname?.includes('dev'))) {
        console.groupCollapsed(`[HighFy Broadcaster Discovery] EVENT: ${eventId}`);
        console.log('Candidates found:', rawCandidates.length);
        rawCandidates.forEach(c => console.log(`  ${c.sourcePath} -> ${c.name}`));
        console.log('Final Broadcasters:', finalBroadcasters.map(b => b.name));
        console.groupEnd();
      }
    } catch (_) {}

    return {
      eventId: eventId,
      discovered: finalBroadcasters.length > 0,
      broadcasters: finalBroadcasters,
      count: finalBroadcasters.length,
      displayLabel: finalBroadcasters.length > 0 ? finalBroadcasters.map(b => b.name).join(', ') : 'Broadcast information unavailable'
    };
  }

  /**
   * Identifies reliable TheSportsDB Event ID from event object
   */
  function matchTheSportsDbEventId(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.idEvent && String(event.idEvent).trim()) {
      return String(event.idEvent).trim();
    }
    if (event.tsdbEventId && String(event.tsdbEventId).trim()) {
      return String(event.tsdbEventId).trim();
    }
    if (event.tsdbId && String(event.tsdbId).trim()) {
      return String(event.tsdbId).trim();
    }
    const rawId = String(event.rawId || event.id || '');
    if (rawId.startsWith('tsdb-')) {
      const clean = rawId.replace(/^tsdb-/, '').trim();
      if (/^\d+$/.test(clean)) return clean;
    }
    if (event.externalId && /^\d+$/.test(String(event.externalId).trim())) {
      return String(event.externalId).trim();
    }
    return null;
  }

  /**
   * Fetches official TV-broadcast discovery records from TheSportsDB dedicated endpoint
   * Whenever a reliable TheSportsDB event ID is matched.
   */
  async function fetchTheSportsDbBroadcasters(event, apiBaseUrl = '') {
    const tsdbId = matchTheSportsDbEventId(event);
    if (!tsdbId) return [];

    try {
      const apiBase = apiBaseUrl || (typeof window !== 'undefined' ? (window.CONFIG?.API_BASE_URL || '') : '');
      const res = await fetch(`${apiBase}/api/thesportsdb/event/${encodeURIComponent(tsdbId)}`);
      if (res.ok) {
        const data = await res.json();
        const rawEvent = (data && data.event) ? data.event : (data && data.events && data.events[0] ? data.events[0] : data);
        if (rawEvent) {
          const candidates = findBroadcastCandidates(rawEvent, 'thesportsdb');
          const normalized = normalizeAndDeduplicate(candidates, event.id || `tsdb-${tsdbId}`, 'TheSportsDB');
          return normalized;
        }
      }
    } catch (err) {
      // Non-fatal network handling
    }
    return [];
  }

  /**
   * Asynchronous discovery wrapper that also queries TheSportsDB when a reliable ID is present
   */
  async function discoverBroadcastersAsync(eventData, apiBaseUrl = '') {
    const syncResult = discoverBroadcasters(eventData);
    const tsdbId = matchTheSportsDbEventId(eventData);

    if (tsdbId) {
      const tsdbBroadcasters = await fetchTheSportsDbBroadcasters(eventData, apiBaseUrl);
      if (tsdbBroadcasters.length > 0) {
        // Merge sync candidates with TheSportsDB discovered records
        const combined = normalizeAndDeduplicate(
          [...syncResult.broadcasters, ...tsdbBroadcasters],
          syncResult.eventId,
          eventData.source || 'TheSportsDB'
        );
        return {
          eventId: syncResult.eventId,
          discovered: combined.length > 0,
          broadcasters: combined,
          count: combined.length,
          displayLabel: combined.length > 0 ? combined.map(b => b.name).join(', ') : 'Broadcast information unavailable'
        };
      }
    }

    return syncResult;
  }

  /**
   * Compatibility wrapper for resolveBroadcasters
   */
  function resolveBroadcasters(rawEvent) {
    const res = discoverBroadcasters(rawEvent);
    return {
      broadcaster: res.broadcasters[0]?.name || null,
      broadcasters: res.broadcasters.map(b => b.name),
      broadcasterRecords: res.broadcasters,
      verified: res.discovered,
      displayLabel: res.displayLabel
    };
  }

  return {
    discoverBroadcasters,
    discoverBroadcastersAsync,
    matchTheSportsDbEventId,
    fetchTheSportsDbBroadcasters,
    resolveBroadcasters,
    findBroadcastCandidates,
    normalizeAndDeduplicate,
    sanitizeNameToken,
    BANNED_GENERIC_TOKENS,
    COUNTRY_FLAGS
  };
});
