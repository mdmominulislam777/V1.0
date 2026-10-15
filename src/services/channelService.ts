/**
 * Channel Service Layer (Server)
 *
 * Coordinates provider adapters, caching, matching logic, and mapping storage.
 * Features:
 * - Routing: Cricket -> cricket adapter; Football, Basketball, Rugby -> TheSportsDB adapter
 * - Two-tier in-memory response cache:
 *   - Non-empty results: 5-10 minutes (default 5m = 300s)
 *   - Empty results: ~60 seconds
 * - Pure matching execution with strict priority order
 * - Persistent mapping store for provider_fixture_id <-> internal_event_id
 * - In-flight promise coalescing to eliminate duplicate parallel requests
 */

import { EventQuery, ChannelBroadcast, ChannelProviderAdapter } from './types';
import { matchProviderFixture } from './channelMatching';
import { MappingStore, defaultMappingStore } from './mappingStore';
import { TheSportsDbAdapter } from './providers/theSportsDbAdapter';
import { CricketAdapter } from './providers/cricketAdapter';
import { findManualChannels } from './manualChannelSource';
import { isAllowedSport } from '../config/sports';

interface CacheEntry {
  data: ChannelBroadcast[];
  cachedAt: number;
  ttlMs: number;
}

export class ChannelService {
  private adapters: ChannelProviderAdapter[];
  private mappingStore: MappingStore;
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<ChannelBroadcast[]>>();

  // Configurable cache TTLs
  public readonly NON_EMPTY_CACHE_TTL_MS: number;
  public readonly EMPTY_CACHE_TTL_MS: number;

  constructor(options?: {
    mappingStore?: MappingStore;
    nonEmptyTtlMs?: number;
    emptyTtlMs?: number;
  }) {
    this.mappingStore = options?.mappingStore || defaultMappingStore;
    this.NON_EMPTY_CACHE_TTL_MS = options?.nonEmptyTtlMs ?? 5 * 60 * 1000; // 5 minutes
    this.EMPTY_CACHE_TTL_MS = options?.emptyTtlMs ?? 60 * 1000;           // 60 seconds

    this.adapters = [
      new TheSportsDbAdapter(),
      new CricketAdapter()
    ];
  }

  /**
   * Generate cache key for an event query
   */
  private getCacheKey(query: EventQuery): string {
    const normSport = (query.sport || '').toLowerCase().trim();
    const id = query.internalEventId || '';
    const date = query.dateUtc || (query.kickoffUtc ? query.kickoffUtc.slice(0, 10) : '');
    const teams = `${query.homeTeam || ''}::${query.awayTeam || ''}`.toLowerCase();
    return `chan::${normSport}::${id}::${date}::${teams}`;
  }

  /**
   * Select appropriate provider adapter based on sport
   * Routing: Cricket -> CricketAdapter; Football, Basketball, Rugby -> TheSportsDB
   */
  public selectAdapter(sport: string): ChannelProviderAdapter | null {
    if (!sport) return null;
    const s = sport.toLowerCase().trim();
    for (const adapter of this.adapters) {
      if (adapter.supportsSport(s)) {
        return adapter;
      }
    }
    // Default fallback for any ball/team sports
    return this.adapters.find(a => a.name === 'TheSportsDB') || null;
  }

  /**
   * Main service method to resolve broadcast channels for a match event
   */
  public async getChannelsForEvent(query: EventQuery): Promise<ChannelBroadcast[]> {
    // Non-allowed sports return empty array without calling any provider
    if (!isAllowedSport(query.sport)) {
      return [];
    }

    const cacheKey = this.getCacheKey(query);
    const now = Date.now();

    // 1. Check in-memory cache
    const cached = this.cache.get(cacheKey);
    if (cached && (now - cached.cachedAt < cached.ttlMs)) {
      return cached.data;
    }

    // 2. Coalesce in-flight requests (prevent upstream rate-limit burn)
    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey)!;
    }

    const fetchPromise = this.resolveChannels(query)
      .then(result => {
        // Cache according to non-empty (5 min) vs empty (60s) rule
        const ttl = result.length > 0 ? this.NON_EMPTY_CACHE_TTL_MS : this.EMPTY_CACHE_TTL_MS;
        this.cache.set(cacheKey, {
          data: result,
          cachedAt: Date.now(),
          ttlMs: ttl
        });
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal resolution flow:
   * - Select adapter
   * - Check stored mapping
   * - Fetch candidates
   * - Run pure matching function
   * - Persist match
   */
  private async resolveChannels(query: EventQuery): Promise<ChannelBroadcast[]> {
    const adapter = this.selectAdapter(query.sport);
    // Try provider adapter first
    if (adapter) {
      // Check stored mappings
      const existingMapping = this.mappingStore.getMapping(query.internalEventId);
      if (existingMapping) {
        // Append to query stored fixture IDs for Priority A exact matching
        if (!query.storedProviderFixtureIds) {
          query.storedProviderFixtureIds = [];
        }
        if (!query.storedProviderFixtureIds.includes(existingMapping.providerFixtureId)) {
          query.storedProviderFixtureIds.push(existingMapping.providerFixtureId);
        }
      }

      try {
        // Fetch candidate fixtures from upstream provider
        const candidates = await adapter.getFixtures(query);

        // Run pure matching function
        const matchResult = matchProviderFixture(query, candidates);

        // a. Provider adapter first - do not let manual override a non-empty provider result
        if (matchResult.matched && matchResult.channels.length > 0) {
          // Save matched pair in mapping store
          if (matchResult.providerFixtureId && query.internalEventId) {
            this.mappingStore.saveMapping(
              query.internalEventId,
              matchResult.providerFixtureId,
              adapter.name,
              matchResult.matchMethod as 'exact_id' | 'normalized_fuzzy',
              matchResult.confidence,
              {
                homeTeam: query.homeTeam,
                awayTeam: query.awayTeam,
                league: query.league,
                kickoffUtc: query.kickoffUtc
              }
            );
          }
          return matchResult.channels;
        }

        // Provider returned no match
        if (!matchResult.matched && matchResult.reason) {
          console.info(`[ChannelService] [${adapter.name}] No provider match for event "${query.internalEventId} (${query.homeTeam} vs ${query.awayTeam})": ${matchResult.reason}`);
        }
      } catch (err: any) {
        console.error(`[ChannelService] Provider error for ${query.internalEventId}:`, err.message);
      }
    } else {
      console.info(`[ChannelService] No adapter registered for sport "${query.sport}". Checking manual fallback.`);
    }

    // b & c. LAST fallback: manual channel lookup
    // Tagged with providerName "Manual (<verifiedBy>)" and sourceUrl included
    try {
      const manualChannels = findManualChannels(query);
      if (manualChannels && manualChannels.length > 0) {
        return manualChannels;
      }
    } catch (manualErr: any) {
      console.error(`[ChannelService] Error during manual channel lookup for ${query.internalEventId}:`, manualErr.message);
    }

    return [];
  }

  /**
   * Clear cache (useful for testing)
   */
  public clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export const defaultChannelService = new ChannelService();
