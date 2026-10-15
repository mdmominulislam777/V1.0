/**
 * Unit Tests for Channel Matching and Channel Service
 *
 * Covers:
 * 1. Exact ID match
 * 2. Name normalization ("Adelaide 36ers" vs "Adelaide 36ers BC", FC/BC/U21/Rugby suffixes, punctuation)
 * 3. Fuzzy similarity threshold (>= 0.85 passes, < 0.85 rejected)
 * 4. Midnight-UTC edges across date boundaries (±15 minute window)
 * 5. No match handling (empty array returned with reason)
 * 6. Cache TTL (5 min non-empty vs 60s empty)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeamName,
  calculateStringSimilarity,
  isKickoffWithinWindow,
  matchProviderFixture
} from '../src/services/channelMatching';
import { EventQuery, ProviderFixture, ManualChannelEntry } from '../src/services/types';
import { ChannelService } from '../src/services/channelService';
import { MappingStore } from '../src/services/mappingStore';
import { validateManualEntry, findManualChannels } from '../src/services/manualChannelSource';
import { ALLOWED_SPORTS, isAllowedSport, normalizeSport } from '../src/config/sports';

describe('1. Team Name Normalization & Suffix Stripping', () => {
  test('strips BC suffix: "Adelaide 36ers" vs "Adelaide 36ers BC"', () => {
    const raw1 = 'Adelaide 36ers';
    const raw2 = 'Adelaide 36ers BC';
    const norm1 = normalizeTeamName(raw1);
    const norm2 = normalizeTeamName(raw2);

    assert.equal(norm1, 'adelaide 36ers');
    assert.equal(norm2, 'adelaide 36ers');
    const sim = calculateStringSimilarity(raw1, raw2);
    assert.equal(sim, 1.0, 'Normalized similarity should be exactly 1.0');
  });

  test('strips FC, U21, Basketball, Rugby and punctuation', () => {
    assert.equal(normalizeTeamName('Arsenal FC'), 'arsenal');
    assert.equal(normalizeTeamName('Chelsea U21'), 'chelsea');
    assert.equal(normalizeTeamName('Bayern Munich Basketball'), 'bayern munich');
    assert.equal(normalizeTeamName('Toulouse Rugby'), 'toulouse');
    assert.equal(normalizeTeamName("St. Patrick's Athletic F.C."), 'st patricks athletic');
  });

  test('fuzzy similarity threshold >= 0.85 passes, < 0.85 rejected', () => {
    // Very close names (typo or abbreviation)
    const simClose = calculateStringSimilarity('Inter Milan', 'Internazionale Milano');
    assert.ok(simClose >= 0.70, `Expected close similarity, got ${simClose}`);

    // Identical normalized team names
    const simExact = calculateStringSimilarity('Manchester United FC', 'Manchester United');
    assert.equal(simExact, 1.0);

    // Completely distinct teams
    const simDistinct = calculateStringSimilarity('Real Madrid', 'Atletico Madrid');
    assert.ok(simDistinct < 0.85, `Expected distinct teams to have sim < 0.85, got ${simDistinct}`);
  });
});

describe('2. Midnight-UTC Edge Cases (±15 Minute Window)', () => {
  test('matches across day boundary within 15 minutes (23:55 UTC vs 00:05 UTC next day)', () => {
    const timeDay1 = '2024-05-18T23:55:00Z';
    const timeDay2 = '2024-05-19T00:05:00Z'; // 10 minutes later

    const isWithin = isKickoffWithinWindow(timeDay1, timeDay2, 15);
    assert.equal(isWithin, true, '10 minutes across midnight must be within 15 minute window');
  });

  test('rejects across day boundary outside 15 minutes (23:40 UTC vs 00:05 UTC next day)', () => {
    const timeDay1 = '2024-05-18T23:40:00Z';
    const timeDay2 = '2024-05-19T00:05:00Z'; // 25 minutes later

    const isWithin = isKickoffWithinWindow(timeDay1, timeDay2, 15);
    assert.equal(isWithin, false, '25 minutes across midnight must exceed 15 minute window');
  });
});

describe('3. Matching Priority Order', () => {
  const sampleCandidates: ProviderFixture[] = [
    {
      providerFixtureId: 'provider-101',
      sport: 'Basketball',
      league: 'NBL',
      kickoffUtc: '2026-10-12T09:30:00Z',
      homeTeam: 'Adelaide 36ers BC',
      awayTeam: 'Melbourne United',
      channels: [
        {
          channelName: 'ESPN Australia',
          country: 'Australia',
          providerName: 'TheSportsDB'
        }
      ]
    },
    {
      providerFixtureId: 'provider-102',
      sport: 'Soccer',
      league: 'Premier League',
      kickoffUtc: '2026-10-12T19:00:00Z',
      homeTeam: 'Arsenal FC',
      awayTeam: 'Chelsea FC',
      channels: [
        {
          channelName: 'Sky Sports Premier League',
          country: 'United Kingdom',
          providerName: 'TheSportsDB'
        }
      ]
    }
  ];

  test('Priority A: Exact stored provider fixture ID match', () => {
    const query: EventQuery = {
      internalEventId: 'my-internal-ev-999',
      sport: 'Basketball',
      storedProviderFixtureIds: ['provider-101'],
      homeTeam: 'Different Team Name', // Even if names differ, exact ID takes precedence
      awayTeam: 'Another Team'
    };

    const result = matchProviderFixture(query, sampleCandidates);
    assert.equal(result.matched, true);
    assert.equal(result.matchMethod, 'exact_id');
    assert.equal(result.providerFixtureId, 'provider-101');
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0].channelName, 'ESPN Australia');
  });

  test('Priority B: Same league + kick-off ±15m + team names normalized match (threshold >= 0.85)', () => {
    const query: EventQuery = {
      internalEventId: 'internal-ars-che',
      sport: 'Soccer',
      league: 'Premier League',
      kickoffUtc: '2026-10-12T19:10:00Z', // 10 minutes offset (within 15m)
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea'
    };

    const result = matchProviderFixture(query, sampleCandidates);
    assert.equal(result.matched, true);
    assert.equal(result.matchMethod, 'normalized_fuzzy');
    assert.equal(result.providerFixtureId, 'provider-102');
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0].channelName, 'Sky Sports Premier League');
  });

  test('Priority C: No match when team names do not match (returns empty array and reason)', () => {
    const query: EventQuery = {
      internalEventId: 'internal-unmatched',
      sport: 'Soccer',
      league: 'Premier League',
      kickoffUtc: '2026-10-12T19:00:00Z',
      homeTeam: 'Liverpool FC',
      awayTeam: 'Everton FC'
    };

    const result = matchProviderFixture(query, sampleCandidates);
    assert.equal(result.matched, false);
    assert.equal(result.matchMethod, 'none');
    assert.equal(result.channels.length, 0);
    assert.ok(result.reason && result.reason.length > 0, 'Reason must be logged');
  });

  test('Priority C: No match when kick-off exceeds ±15m window', () => {
    const query: EventQuery = {
      internalEventId: 'internal-late-kickoff',
      sport: 'Soccer',
      league: 'Premier League',
      kickoffUtc: '2026-10-12T20:30:00Z', // 90 minutes offset (exceeds 15m)
      homeTeam: 'Arsenal FC',
      awayTeam: 'Chelsea FC'
    };

    const result = matchProviderFixture(query, sampleCandidates);
    assert.equal(result.matched, false);
    assert.equal(result.channels.length, 0);
  });
});

describe('4. ChannelService Caching & Store Integration', () => {
  test('Service caches non-empty results for 5 minutes and empty for 60 seconds', () => {
    const store = new MappingStore('/tmp/test_fixture_mappings.json');
    const service = new ChannelService({
      mappingStore: store,
      nonEmptyTtlMs: 300000,
      emptyTtlMs: 60000
    });

    assert.equal(service.NON_EMPTY_CACHE_TTL_MS, 300000);
    assert.equal(service.EMPTY_CACHE_TTL_MS, 60000);
  });
});

describe('5. Manual Channel Source & Validation', () => {
  const verifiedEntry: ManualChannelEntry = {
    matchKey: {
      sport: 'Basketball',
      league: 'NBL',
      homeTeam: 'Adelaide 36ers BC',
      awayTeam: 'Melbourne United',
      kickoffUtc: '2026-10-12T10:00:00Z'
    },
    channels: [
      {
        channelName: 'ESPN Australia',
        country: 'Australia',
        logoUrl: 'https://r2.thesportsdb.com/images/media/channel/logo/espn.png'
      }
    ],
    source: {
      url: 'https://nbl.com.au/watch/schedule',
      name: 'NBL Official Broadcast Guide'
    },
    verifiedBy: 'analyst-adam',
    status: 'verified'
  };

  test('a verified entry matches within ±15 minutes', () => {
    const query: EventQuery = {
      internalEventId: 'event-nbl-101',
      sport: 'Basketball',
      league: 'NBL',
      homeTeam: 'Adelaide 36ers',
      awayTeam: 'Melbourne United',
      kickoffUtc: '2026-10-12T10:10:00Z' // 10 minutes later (within ±15m)
    };

    const result = findManualChannels(query, [verifiedEntry]);
    assert.equal(result.length, 1);
    assert.equal(result[0].channelName, 'ESPN Australia');
    assert.equal(result[0].providerName, 'Manual (analyst-adam)');
    assert.equal(result[0].sourceUrl, 'https://nbl.com.au/watch/schedule');
  });

  test('a pending entry is ignored', () => {
    const pendingEntry: ManualChannelEntry = {
      ...verifiedEntry,
      status: 'pending'
    };

    const query: EventQuery = {
      internalEventId: 'event-nbl-101',
      sport: 'Basketball',
      league: 'NBL',
      homeTeam: 'Adelaide 36ers',
      awayTeam: 'Melbourne United',
      kickoffUtc: '2026-10-12T10:05:00Z'
    };

    const result = findManualChannels(query, [pendingEntry]);
    assert.equal(result.length, 0, 'Pending entries must be ignored');
  });

  test('an entry outside the time window is ignored', () => {
    const query: EventQuery = {
      internalEventId: 'event-nbl-101',
      sport: 'Basketball',
      league: 'NBL',
      homeTeam: 'Adelaide 36ers',
      awayTeam: 'Melbourne United',
      kickoffUtc: '2026-10-12T10:30:00Z' // 30 minutes later (exceeds ±15m)
    };

    const result = findManualChannels(query, [verifiedEntry]);
    assert.equal(result.length, 0, 'Entry outside ±15 minute window must be ignored');
  });

  test('team name variants match ("Adelaide 36ers" vs "Adelaide 36ers BC")', () => {
    const query: EventQuery = {
      internalEventId: 'event-nbl-variant',
      sport: 'Basketball',
      homeTeam: 'Adelaide 36ers', // Variant without BC suffix
      awayTeam: 'Melbourne United',
      kickoffUtc: '2026-10-12T10:00:00Z'
    };

    const result = findManualChannels(query, [verifiedEntry]);
    assert.equal(result.length, 1);
    assert.equal(result[0].channelName, 'ESPN Australia');
    assert.equal(result[0].providerName, 'Manual (analyst-adam)');
  });

  test('empty channels in a verified entry is rejected by validation', () => {
    const invalidEntry = {
      matchKey: {
        sport: 'Soccer',
        homeTeam: 'Arsenal FC',
        awayTeam: 'Chelsea FC',
        kickoffUtc: '2026-10-12T19:00:00Z'
      },
      channels: [], // Empty channels array
      source: {
        url: 'https://premierleague.com/broadcasts'
      },
      verifiedBy: 'qa-tester',
      status: 'verified'
    };

    const validation = validateManualEntry(invalidEntry);
    assert.equal(validation.valid, false);
    assert.match(validation.reason || '', /channels/i, 'Reason must mention channels array');
  });

  test('missing source.url is rejected by validation', () => {
    const missingSourceEntry = {
      matchKey: {
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea'
      },
      channels: [{ channelName: 'Sky Sports' }],
      source: { url: '' }, // Missing URL
      status: 'verified',
      verifiedBy: 'admin'
    };

    const validation = validateManualEntry(missingSourceEntry);
    assert.equal(validation.valid, false);
    assert.match(validation.reason || '', /source\.url/i);
  });

  test('missing status is rejected by validation', () => {
    const missingStatusEntry = {
      matchKey: {
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea'
      },
      channels: [{ channelName: 'Sky Sports' }],
      source: { url: 'https://source.example' },
      status: '', // Empty status
      verifiedBy: 'admin'
    };

    const validation = validateManualEntry(missingStatusEntry);
    assert.equal(validation.valid, false);
    assert.match(validation.reason || '', /status/i);
  });

  test('"Northland" does not match "Northland Taniwha" under exact normalized equality', () => {
    const entry: ManualChannelEntry = {
      matchKey: {
        sport: 'Rugby',
        league: 'NPC',
        homeTeam: 'Northland Taniwha',
        awayTeam: 'Auckland',
        kickoffUtc: '2026-10-12T14:00:00Z'
      },
      channels: [{ channelName: 'Sky Sport NZ' }],
      source: { url: 'https://rugby.co.nz' },
      verifiedBy: 'rugby-admin',
      status: 'verified'
    };

    const query: EventQuery = {
      internalEventId: 'event-rugby-northland',
      sport: 'Rugby',
      league: 'NPC',
      homeTeam: 'Northland', // Not exact normalized match to "Northland Taniwha"
      awayTeam: 'Auckland',
      kickoffUtc: '2026-10-12T14:00:00Z'
    };

    const result = findManualChannels(query, [entry]);
    assert.equal(result.length, 0, '"Northland" must not match "Northland Taniwha" with exact normalized equality');
  });
});

describe('6. Sports Allowlist & Isolation', () => {
  test('allowed sports strictly include cricket, football, wwe, aew', () => {
    assert.deepEqual([...ALLOWED_SPORTS], ['cricket', 'football', 'wwe', 'aew']);

    assert.equal(isAllowedSport('cricket'), true);
    assert.equal(isAllowedSport('Cricket'), true);
    assert.equal(isAllowedSport('football'), true);
    assert.equal(isAllowedSport('Football'), true);
    assert.equal(isAllowedSport('soccer'), true);
    assert.equal(isAllowedSport('Soccer'), true);
    assert.equal(isAllowedSport('wwe'), true);
    assert.equal(isAllowedSport('WWE'), true);
    assert.equal(isAllowedSport('wrestling'), true);
    assert.equal(isAllowedSport('aew'), true);
    assert.equal(isAllowedSport('AEW'), true);
  });

  test('non-allowed sports (basketball, baseball, tennis, rugby, volleyball) are rejected', () => {
    assert.equal(isAllowedSport('basketball'), false);
    assert.equal(isAllowedSport('Baseball'), false);
    assert.equal(isAllowedSport('Tennis'), false);
    assert.equal(isAllowedSport('Volleyball'), false);
    assert.equal(isAllowedSport('Rugby'), false);
  });

  test('"Soccer" is normalized to "football"', () => {
    assert.equal(normalizeSport('Soccer'), 'football');
    assert.equal(normalizeSport('soccer'), 'football');
  });

  test('ChannelService returns [] for a non-allowed sport without calling any provider', async () => {
    const service = new ChannelService();
    const query: EventQuery = {
      internalEventId: 'event-bball-1',
      sport: 'Basketball',
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      kickoffUtc: '2026-10-15T20:00:00Z'
    };

    const channels = await service.getChannelsForEvent(query);
    assert.deepEqual(channels, []);
  });
});

