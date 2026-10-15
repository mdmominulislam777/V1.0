/**
 * Pure Matching Functions for Multi-Sport Channel Resolution
 *
 * Implements strict priority matching:
 * 1. Exact stored provider fixture/event ID
 * 2. Same league + kick-off within ±15 minutes (UTC) + both team names match
 *    after normalization (lowercase, strip punctuation, remove FC/BC/U21/Basketball/Rugby suffixes;
 *    fuzzy similarity with constant threshold starting at 0.85)
 * 3. No match: return empty array and log reason.
 */

import { EventQuery, ProviderFixture, MatchResult } from './types';

export const FUZZY_SIMILARITY_THRESHOLD = 0.85;
export const KICKOFF_WINDOW_MINUTES = 15;

/**
 * Common club/sport suffixes to strip during team name normalization
 */
const STRIP_SUFFIXES_REGEX = /\b(fc|cf|bc|sc|ac|u21|u23|u19|u17|basketball|rugby|club|team)\b/gi;

/**
 * Normalize team name:
 * - lowercase
 * - remove apostrophes without adding spaces (e.g. Patrick's -> Patricks)
 * - strip punctuation and collapse initials (e.g. F.C. -> FC)
 * - remove FC/BC/U21/Basketball/Rugby suffixes
 * - collapse whitespace
 */
export function normalizeTeamName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  
  let normalized = name.toLowerCase();

  // Strip apostrophes directly so "Patrick's" becomes "patricks"
  normalized = normalized.replace(/['’]/g, '');

  // Strip periods directly first so "f.c." becomes "fc", "b.c." becomes "bc", "st." becomes "st"
  normalized = normalized.replace(/\./g, '');

  // Strip remaining punctuation and special characters
  normalized = normalized.replace(/[,\-_"`/\\()[\]{}:;!?*&@#%^+=]/g, ' ');

  // Remove common suffixes as whole words
  normalized = normalized.replace(STRIP_SUFFIXES_REGEX, ' ');

  // Collapse consecutive whitespaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Normalize league name:
 * - lowercase, strip punctuation, collapse whitespace
 */
export function normalizeLeagueName(league: string): string {
  if (!league || typeof league !== 'string') return '';
  return league
    .toLowerCase()
    .replace(/[.,\-_'"`/\\()[\]{}:;!?*&@#%^+=]/g, ' ')
    .replace(/\b(league|division|cup|tournament|series)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard Levenshtein distance algorithm
 */
export function levenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix = Array.from({ length: bn + 1 }, (_, i) => [i]);
  for (let j = 0; j <= an; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[bn][an];
}

/**
 * Calculate fuzzy string similarity [0.0 - 1.0]
 */
export function calculateStringSimilarity(strA: string, strB: string): number {
  const s1 = normalizeTeamName(strA);
  const s2 = normalizeTeamName(strB);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Exact substring containment for long names
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    if (minLen / maxLen >= 0.70) {
      return Math.max(0.88, minLen / maxLen);
    }
  }

  // Token-level matching
  const tokens1 = s1.split(' ').filter(Boolean);
  const tokens2 = s2.split(' ').filter(Boolean);

  let tokenScoreSum = 0;
  for (const t1 of tokens1) {
    let bestT2Score = 0;
    for (const t2 of tokens2) {
      if (t1 === t2) {
        bestT2Score = 1.0;
        break;
      }
      if (t1.startsWith(t2) || t2.startsWith(t1)) {
        const pLen = Math.min(t1.length, t2.length);
        if (pLen >= 3) {
          bestT2Score = Math.max(bestT2Score, 0.85);
          continue;
        }
      }
      const tDist = levenshteinDistance(t1, t2);
      const tMax = Math.max(t1.length, t2.length);
      const tSim = 1 - tDist / tMax;
      if (tSim > bestT2Score) bestT2Score = tSim;
    }
    tokenScoreSum += bestT2Score;
  }
  const tokenSim = tokens1.length > 0 ? tokenScoreSum / Math.max(tokens1.length, tokens2.length) : 0;

  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const levSim = Math.max(0, 1 - dist / maxLen);

  return Math.max(levSim, tokenSim);
}

/**
 * Parse an arbitrary kick-off string into UTC epoch milliseconds
 */
export function parseUtcTimestamp(dateOrTimeStr?: string): number | null {
  if (!dateOrTimeStr) return null;
  const str = String(dateOrTimeStr).trim();
  if (!str) return null;

  // Check if already an epoch number
  if (/^\d{10,13}$/.test(str)) {
    const num = parseInt(str, 10);
    return num < 10000000000 ? num * 1000 : num;
  }

  // Handle ISO-8601 or standard formats
  let parsed = Date.parse(str);
  if (!isNaN(parsed)) return parsed;

  // Handle "YYYY-MM-DD HH:mm:ss" assumed UTC
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(str)) {
    const isoLike = str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z');
    parsed = Date.parse(isoLike);
    if (!isNaN(parsed)) return parsed;
  }

  return null;
}

/**
 * Check if two kick-off times are within ±windowMinutes in UTC
 * Accurately handles midnight-UTC edge cases across day/month boundaries
 */
export function isKickoffWithinWindow(
  timeA?: string,
  timeB?: string,
  windowMinutes: number = KICKOFF_WINDOW_MINUTES
): boolean {
  if (!timeA || !timeB) return true; // If one is not specified, cannot rule out on time alone

  const msA = parseUtcTimestamp(timeA);
  const msB = parseUtcTimestamp(timeB);

  if (msA === null || msB === null) return true;

  const diffMs = Math.abs(msA - msB);
  const allowedMs = windowMinutes * 60 * 1000;
  return diffMs <= allowedMs;
}

/**
 * Check if leagues match or are compatible
 */
export function isLeagueCompatible(leagueA?: string, leagueB?: string): boolean {
  if (!leagueA || !leagueB) return true; // Optional constraint if missing in either source
  const normA = normalizeLeagueName(leagueA);
  const normB = normalizeLeagueName(leagueB);
  if (!normA || !normB) return true;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;

  const sim = 1 - levenshteinDistance(normA, normB) / Math.max(normA.length, normB.length);
  return sim >= 0.70;
}

/**
 * Pure Matching Function
 * Priority order:
 * A. Exact stored provider fixture/event ID
 * B. Same league + kick-off within ±15 minutes (UTC) + both team names match (threshold >= 0.85)
 * C. No match: return empty array and log reason
 */
export function matchProviderFixture(
  query: EventQuery,
  candidates: ProviderFixture[],
  threshold: number = FUZZY_SIMILARITY_THRESHOLD
): MatchResult {
  if (!candidates || candidates.length === 0) {
    return {
      matched: false,
      matchMethod: 'none',
      confidence: 0,
      channels: [],
      reason: 'No candidate fixtures returned by provider'
    };
  }

  // PRIORITY A: Exact stored provider fixture/event ID
  if (query.storedProviderFixtureIds && query.storedProviderFixtureIds.length > 0) {
    for (const storedId of query.storedProviderFixtureIds) {
      const exactMatch = candidates.find(c => c.providerFixtureId === storedId);
      if (exactMatch) {
        return {
          matched: true,
          matchMethod: 'exact_id',
          confidence: 1.0,
          providerFixtureId: exactMatch.providerFixtureId,
          channels: exactMatch.channels
        };
      }
    }
  }

  // Check if query internalEventId itself directly matches a candidate provider ID
  const directIdMatch = candidates.find(c => c.providerFixtureId === query.internalEventId);
  if (directIdMatch) {
    return {
      matched: true,
      matchMethod: 'exact_id',
      confidence: 1.0,
      providerFixtureId: directIdMatch.providerFixtureId,
      channels: directIdMatch.channels
    };
  }

  // PRIORITY B: Normalized Fuzzy Match (League + Kickoff within ±15m + Home & Away >= 0.85)
  if (!query.homeTeam || !query.awayTeam) {
    return {
      matched: false,
      matchMethod: 'none',
      confidence: 0,
      channels: [],
      reason: 'Query missing home or away team names for fuzzy matching'
    };
  }

  let bestMatch: ProviderFixture | null = null;
  let highestConfidence = 0;
  let rejectionReason = 'No candidate met league, kick-off window, and team name threshold (>= ' + threshold + ')';

  for (const cand of candidates) {
    // 1. Kick-off check (±15 min in UTC)
    if (query.kickoffUtc && cand.kickoffUtc) {
      if (!isKickoffWithinWindow(query.kickoffUtc, cand.kickoffUtc, KICKOFF_WINDOW_MINUTES)) {
        continue;
      }
    }

    // 2. League compatibility check
    if (query.league && cand.league) {
      if (!isLeagueCompatible(query.league, cand.league)) {
        continue;
      }
    }

    // 3. Team name matching (Home vs Home, Away vs Away OR reversed in neutral ground)
    const homeSimDirect = calculateStringSimilarity(query.homeTeam, cand.homeTeam);
    const awaySimDirect = calculateStringSimilarity(query.awayTeam, cand.awayTeam);
    const avgDirect = (homeSimDirect + awaySimDirect) / 2;

    const homeSimCross = calculateStringSimilarity(query.homeTeam, cand.awayTeam);
    const awaySimCross = calculateStringSimilarity(query.awayTeam, cand.homeTeam);
    const avgCross = (homeSimCross + awaySimCross) / 2;

    const isDirectMatch = homeSimDirect >= threshold && awaySimDirect >= threshold;
    const isCrossMatch = homeSimCross >= threshold && awaySimCross >= threshold;

    if (isDirectMatch || isCrossMatch) {
      const matchScore = isDirectMatch ? avgDirect : avgCross;
      if (matchScore > highestConfidence) {
        highestConfidence = matchScore;
        bestMatch = cand;
      }
    } else {
      rejectionReason = `Team similarities below threshold (${threshold}): direct [${homeSimDirect.toFixed(2)}, ${awaySimDirect.toFixed(2)}], cross [${homeSimCross.toFixed(2)}, ${awaySimCross.toFixed(2)}] for "${cand.homeTeam} vs ${cand.awayTeam}"`;
    }
  }

  if (bestMatch && highestConfidence >= threshold) {
    return {
      matched: true,
      matchMethod: 'normalized_fuzzy',
      confidence: highestConfidence,
      providerFixtureId: bestMatch.providerFixtureId,
      channels: bestMatch.channels
    };
  }

  // PRIORITY C: No match
  return {
    matched: false,
    matchMethod: 'none',
    confidence: highestConfidence,
    channels: [],
    reason: rejectionReason
  };
}
