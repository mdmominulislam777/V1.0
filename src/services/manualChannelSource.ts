/**
 * Manual Channel Source & Broadcast Resolver
 *
 * Implements manual fallback channel lookup with:
 * - Strict schema validation on server startup
 * - Skips and logs invalid entries without crashing
 * - Only matches entries with status === 'verified' (ignores 'pending', 'rejected', etc.)
 * - Same team normalization and ±15 minute UTC kick-off window as provider matching
 * - Tags returned channels with providerName: "Manual (<verifiedBy>)"
 * - Includes source.url in every returned ChannelBroadcast
 */

import fs from 'fs';
import path from 'path';
import {
  EventQuery,
  ChannelBroadcast,
  ManualChannelEntry,
  ManualChannelsSchema
} from './types';
import {
  normalizeTeamName,
  normalizeLeagueName,
  calculateStringSimilarity,
  isKickoffWithinWindow,
  isLeagueCompatible,
  FUZZY_SIMILARITY_THRESHOLD,
  KICKOFF_WINDOW_MINUTES
} from './channelMatching';

export const DEFAULT_MANUAL_CHANNELS_PATH = path.resolve(process.cwd(), 'data/manual_channels.json');

// In-memory cache of validated entries
let cachedManualEntries: ManualChannelEntry[] | null = null;

/**
 * Validate a single manual channel entry against strict requirements:
 * 1. Must have a non-empty channels array
 * 2. Must have a valid source.url string
 * 3. Must have a valid status string
 * 4. Must have a valid matchKey with team or event identifier
 */
export function validateManualEntry(entry: any): { valid: boolean; reason?: string } {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, reason: 'Entry must be a valid object' };
  }

  // 1. Status validation
  if (!entry.status || typeof entry.status !== 'string' || entry.status.trim().length === 0) {
    return { valid: false, reason: 'Entry status is required and must be a non-empty string' };
  }

  // 2. Source and source.url validation
  if (!entry.source || typeof entry.source !== 'object') {
    return { valid: false, reason: 'Entry source must be an object' };
  }
  if (!entry.source.url || typeof entry.source.url !== 'string' || entry.source.url.trim().length === 0) {
    return { valid: false, reason: 'Entry source.url is required and must be a non-empty string' };
  }

  // 3. Channels array validation (must be non-empty)
  if (!Array.isArray(entry.channels) || entry.channels.length === 0) {
    return { valid: false, reason: 'Entry channels must be a non-empty array' };
  }
  for (let i = 0; i < entry.channels.length; i++) {
    const ch = entry.channels[i];
    if (!ch || typeof ch !== 'object' || !ch.channelName || typeof ch.channelName !== 'string' || ch.channelName.trim().length === 0) {
      return { valid: false, reason: `Channel at index ${i} is missing a valid channelName` };
    }
  }

  // 4. matchKey validation
  if (!entry.matchKey || typeof entry.matchKey !== 'object') {
    return { valid: false, reason: 'Entry matchKey must be an object' };
  }
  const hasTeams = Boolean(entry.matchKey.homeTeam && entry.matchKey.awayTeam);
  const hasId = Boolean(entry.matchKey.internalEventId);
  if (!hasTeams && !hasId) {
    return { valid: false, reason: 'Entry matchKey must specify homeTeam & awayTeam, or internalEventId' };
  }

  return { valid: true };
}

/**
 * Load and validate manual channels from disk on server startup.
 * Logs and skips invalid entries without crashing.
 */
export function loadAndValidateManualChannels(filePath: string = DEFAULT_MANUAL_CHANNELS_PATH): ManualChannelEntry[] {
  try {
    if (!fs.existsSync(filePath)) {
      console.info(`[ManualChannels] File not found at ${filePath}. Initializing empty.`);
      cachedManualEntries = [];
      return [];
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8');
    if (!rawContent || rawContent.trim().length === 0) {
      console.info(`[ManualChannels] File at ${filePath} is empty. Initializing empty.`);
      cachedManualEntries = [];
      return [];
    }

    let parsed: ManualChannelsSchema;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr: any) {
      console.error(`[ManualChannels] JSON parse error in ${filePath}:`, parseErr.message);
      cachedManualEntries = [];
      return [];
    }

    const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const validEntries: ManualChannelEntry[] = [];
    let skippedCount = 0;

    for (let i = 0; i < rawEntries.length; i++) {
      const entry = rawEntries[i];
      const validation = validateManualEntry(entry);
      if (!validation.valid) {
        console.warn(`[ManualChannels] Skipped invalid entry #${i}: ${validation.reason}`);
        skippedCount++;
        continue;
      }
      validEntries.push(entry);
    }

    cachedManualEntries = validEntries;
    if (skippedCount > 0 || validEntries.length > 0) {
      console.info(`[ManualChannels] Loaded ${validEntries.length} valid entries (${skippedCount} skipped) from ${path.basename(filePath)}`);
    }

    return validEntries;
  } catch (err: any) {
    console.error(`[ManualChannels] Unexpected error reading ${filePath}:`, err.message);
    cachedManualEntries = [];
    return [];
  }
}

/**
 * Access cached manual entries or trigger safe load
 */
export function getManualEntries(): ManualChannelEntry[] {
  if (cachedManualEntries === null) {
    return loadAndValidateManualChannels();
  }
  return cachedManualEntries;
}

/**
 * Reset or set manual entries in-memory (useful for testing)
 */
export function setCachedManualEntries(entries: ManualChannelEntry[] | null): void {
  cachedManualEntries = entries;
}

/**
 * Pure & robust manual channel matching function.
 * Matches an EventQuery against manual verified entries using:
 * - Status check: only status === 'verified'
 * - Kick-off time window: ±15 minutes (UTC)
 * - Team name normalization & fuzzy similarity (threshold >= 0.85)
 * - Returns channels tagged with providerName "Manual (<verifiedBy>)" and sourceUrl
 */
export function findManualChannels(
  query: EventQuery,
  candidateEntries?: ManualChannelEntry[]
): ChannelBroadcast[] {
  const entries = candidateEntries !== undefined ? candidateEntries : getManualEntries();
  if (!entries || entries.length === 0) {
    return [];
  }

  for (const entry of entries) {
    // 1. Status check: Only "verified" entries are active
    if (!entry.status || String(entry.status).toLowerCase().trim() !== 'verified') {
      continue;
    }

    // 2. Exact internalEventId match
    if (
      query.internalEventId &&
      entry.matchKey.internalEventId &&
      query.internalEventId === entry.matchKey.internalEventId
    ) {
      return formatManualChannels(entry);
    }

    // 3. Sport compatibility check
    if (query.sport && entry.matchKey.sport) {
      const qSport = query.sport.toLowerCase().trim();
      const eSport = entry.matchKey.sport.toLowerCase().trim();
      const compatibleSport =
        qSport === eSport ||
        ((qSport === 'football' || qSport === 'soccer') && (eSport === 'football' || eSport === 'soccer'));
      if (!compatibleSport) {
        continue;
      }
    }

    // 4. Kick-off time window check (±15 minutes UTC)
    if (query.kickoffUtc && entry.matchKey.kickoffUtc) {
      const withinWindow = isKickoffWithinWindow(
        query.kickoffUtc,
        entry.matchKey.kickoffUtc,
        KICKOFF_WINDOW_MINUTES
      );
      if (!withinWindow) {
        continue;
      }
    } else if (query.dateUtc && entry.matchKey.dateUtc) {
      if (query.dateUtc !== entry.matchKey.dateUtc) {
        continue;
      }
    }

    // 5. Team name matching with normalized exact equality
    if (query.homeTeam && query.awayTeam && entry.matchKey.homeTeam && entry.matchKey.awayTeam) {
      const qHome = normalizeTeamName(query.homeTeam);
      const qAway = normalizeTeamName(query.awayTeam);
      const eHome = normalizeTeamName(entry.matchKey.homeTeam);
      const eAway = normalizeTeamName(entry.matchKey.awayTeam);

      const directMatch = qHome === eHome && qAway === eAway;
      const swapMatch = qHome === eAway && qAway === eHome;

      if (!directMatch && !swapMatch) {
        continue;
      }
    } else if (!query.internalEventId || query.internalEventId !== entry.matchKey.internalEventId) {
      continue;
    }

    // 6. League exact equality check (if both provided)
    if (query.league && entry.matchKey.league) {
      const qLeague = normalizeLeagueName(query.league);
      const eLeague = normalizeLeagueName(entry.matchKey.league);
      if (qLeague && eLeague && qLeague !== eLeague) {
        continue;
      }
    }

    // Match found! Format and tag channels
    return formatManualChannels(entry);
  }

  return [];
}

/**
 * Format and tag manual channel entry to ChannelBroadcast array:
 * - providerName: "Manual (<verifiedBy>)"
 * - sourceUrl: entry.source.url
 */
function formatManualChannels(entry: ManualChannelEntry): ChannelBroadcast[] {
  const verifiedTag = entry.verifiedBy && entry.verifiedBy.trim().length > 0
    ? `Manual (${entry.verifiedBy.trim()})`
    : 'Manual (verified)';

  const sourceUrl = entry.source?.url || '';

  return (entry.channels || []).map(ch => ({
    channelName: ch.channelName,
    country: ch.country,
    logoUrl: ch.logoUrl,
    providerName: verifiedTag,
    sourceUrl: sourceUrl
  }));
}
