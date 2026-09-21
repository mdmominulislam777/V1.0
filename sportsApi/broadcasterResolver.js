/**
 * HIGHFY TV - BROADCASTER RESOLVER
 * Recursively inspects API response fields for legitimate broadcaster / TV station info.
 * Strictly adheres to ZERO-GUESSING rules.
 */

(function(root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.HighFyBroadcasterResolver = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function() {
  'use strict';

  // Recognized fields to inspect for broadcasting signals
  const BROADCASTER_FIELD_KEYS = [
    'broadcaster',
    'broadcasters',
    'broadcast',
    'broadcasts',
    'channel',
    'channels',
    'channelid',
    'channelname',
    'network',
    'networks',
    'tv',
    'tvstation',
    'strtvstation',
    'strbroadcaster',
    'strbroadcast',
    'strchannel',
    'streams'
  ];

  // Generic OTT / placeholder keywords that do not represent a valid TV broadcast channel
  const BANNED_GENERIC_TOKENS = new Set([
    'null', 'undefined', 'n/a', 'none', 'tbd', 'tba', 'various', 'local',
    'stream', 'live stream', 'online', 'web', 'internet', 'official website',
    'app', 'mobile app', 'youtube', 'facebook', 'twitter', 'tiktok',
    'live', 'livestream', 'channel'
  ]);

  /**
   * Cleans a raw broadcaster text string
   */
  function sanitizeToken(token) {
    if (!token || typeof token !== 'string') return null;
    const clean = token.trim();
    if (!clean || clean.length < 2) return null;
    const lower = clean.toLowerCase();
    if (BANNED_GENERIC_TOKENS.has(lower)) return null;
    return clean;
  }

  /**
   * Recursively extracts broadcaster strings from nested objects / arrays
   */
  function extractBroadcastersRecursive(obj, depth = 0, collected = [], seen = new Set()) {
    if (!obj || depth > 5) return collected;

    // String value
    if (typeof obj === 'string') {
      const sanitized = sanitizeToken(obj);
      if (sanitized && !seen.has(sanitized.toLowerCase())) {
        seen.add(sanitized.toLowerCase());
        collected.push(sanitized);
      }
      return collected;
    }

    // Array value
    if (Array.isArray(obj)) {
      for (const item of obj) {
        extractBroadcastersRecursive(item, depth + 1, collected, seen);
      }
      return collected;
    }

    // Object value
    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (!value) continue;
        const keyLower = key.toLowerCase();

        // Check if key matches our target broadcast fields
        const isTargetField = BROADCASTER_FIELD_KEYS.some(f => keyLower.includes(f));

        if (isTargetField) {
          if (typeof value === 'string') {
            // Might be comma or slash separated e.g. "Sky Sports Main Event, TNT Sports 1"
            const parts = value.split(/[,/;|]/);
            for (const p of parts) {
              const sanitized = sanitizeToken(p);
              if (sanitized && !seen.has(sanitized.toLowerCase())) {
                seen.add(sanitized.toLowerCase());
                collected.push(sanitized);
              }
            }
          } else if (typeof value === 'object') {
            // Nested object: e.g. broadcaster: { name: 'Sony Ten 1', id: '123' }
            if (value.name && typeof value.name === 'string') {
              const sanitized = sanitizeToken(value.name);
              if (sanitized && !seen.has(sanitized.toLowerCase())) {
                seen.add(sanitized.toLowerCase());
                collected.push(sanitized);
              }
            }
            if (value.channelName && typeof value.channelName === 'string') {
              const sanitized = sanitizeToken(value.channelName);
              if (sanitized && !seen.has(sanitized.toLowerCase())) {
                seen.add(sanitized.toLowerCase());
                collected.push(sanitized);
              }
            }
            extractBroadcastersRecursive(value, depth + 1, collected, seen);
          }
        } else if (typeof value === 'object') {
          // Continue traversing sub-structures for relevant keys
          extractBroadcastersRecursive(value, depth + 1, collected, seen);
        }
      }
    }

    return collected;
  }

  /**
   * Main Broadcaster Resolver Function
   * Returns: { broadcaster: string|null, broadcasters: string[], verified: boolean }
   */
  function resolveBroadcasters(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return {
        broadcaster: null,
        broadcasters: [],
        verified: false,
        displayLabel: 'Channel information unavailable'
      };
    }

    const collected = extractBroadcastersRecursive(rawEvent);

    if (collected.length === 0) {
      return {
        broadcaster: null,
        broadcasters: [],
        verified: false,
        displayLabel: 'Channel information unavailable'
      };
    }

    const primaryBroadcaster = collected[0];

    return {
      broadcaster: primaryBroadcaster,
      broadcasters: collected,
      verified: true,
      displayLabel: primaryBroadcaster
    };
  }

  return {
    resolveBroadcasters,
    extractBroadcastersRecursive,
    sanitizeToken,
    BANNED_GENERIC_TOKENS
  };
});
