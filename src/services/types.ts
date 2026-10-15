/**
 * Shared Type Definitions for Multi-Sport Channel Resolution
 */

export interface EventQuery {
  internalEventId: string;
  sport: string;
  league?: string;
  kickoffUtc?: string; // ISO 8601 or YYYY-MM-DD HH:mm:ss (UTC)
  homeTeam?: string;
  awayTeam?: string;
  storedProviderFixtureIds?: string[];
  dateUtc?: string; // YYYY-MM-DD (UTC)
}

export interface ChannelBroadcast {
  channelName: string;
  country?: string;
  logoUrl?: string;
  providerName: string;
  sourceUrl?: string;
}

export interface ManualChannelSourceInfo {
  url: string;
  name?: string;
  notes?: string;
}

export interface ManualChannelItem {
  channelName: string;
  country?: string;
  logoUrl?: string;
}

export interface ManualMatchKey {
  sport?: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc?: string; // ISO 8601 or YYYY-MM-DD HH:mm:ss (UTC)
  dateUtc?: string;
  internalEventId?: string;
}

export type ManualEntryStatus = 'verified' | 'pending' | 'rejected' | string;

export interface ManualChannelEntry {
  matchKey: ManualMatchKey;
  channels: ManualChannelItem[];
  source: ManualChannelSourceInfo;
  verifiedBy: string;
  status: ManualEntryStatus;
}

export interface ManualChannelsSchema {
  version: string;
  updatedAt: string;
  entries: ManualChannelEntry[];
}

export interface ProviderFixture {
  providerFixtureId: string;
  sport: string;
  league?: string;
  kickoffUtc?: string; // ISO 8601 or YYYY-MM-DD HH:mm:ss (UTC)
  homeTeam: string;
  awayTeam: string;
  channels: ChannelBroadcast[];
}

export interface MatchResult {
  matched: boolean;
  matchMethod: 'exact_id' | 'normalized_fuzzy' | 'none';
  confidence: number;
  providerFixtureId?: string;
  channels: ChannelBroadcast[];
  reason?: string;
}

export interface StoredMapping {
  internalEventId: string;
  providerFixtureId: string;
  provider: string;
  matchedAt: string;
  matchMethod: 'exact_id' | 'normalized_fuzzy';
  confidence: number;
  metadata?: {
    homeTeam?: string;
    awayTeam?: string;
    league?: string;
    kickoffUtc?: string;
  };
}

export interface ChannelProviderAdapter {
  readonly name: string;
  supportsSport(sport: string): boolean;
  getFixtures(query: EventQuery): Promise<ProviderFixture[]>;
}
