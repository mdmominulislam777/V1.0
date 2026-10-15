/**
 * TheSportsDB TV Channels Adapter
 *
 * Implements ChannelProviderAdapter for Football, Basketball, Rugby, and other multi-sport events.
 * Key features:
 * - Fetches TV listings for the UTC date plus the day before and after (date - 1, date, date + 1)
 * - Timeout 5s with 2 retries and exponential backoff
 * - Explicit error handling for 401, 403 (restricted key tier), 429 (rate limit)
 * - Redacts API keys from all logs
 * - Groups multiple broadcast channels by event ID
 */

import { ChannelProviderAdapter, EventQuery, ProviderFixture, ChannelBroadcast } from '../types';

export class TheSportsDbAdapter implements ChannelProviderAdapter {
  readonly name = 'TheSportsDB';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = (apiKey || process.env.THESPORTSDB_API_KEY || '3').trim();
    // Ensure clean key string without prepended URL if user pasted full URL in env
    this.apiKey = this.apiKey.replace(/^https?:\/\/www\.thesportsdb\.com\/api\/v1\/json\/?/i, '').replace(/\/+$/, '').trim() || '3';
    this.baseUrl = `https://www.thesportsdb.com/api/v1/json/${this.apiKey}`;
  }

  public supportsSport(sport: string): boolean {
    if (!sport) return false;
    const s = sport.trim().toLowerCase();
    // Supported: Football, Basketball, Rugby, American Football, Tennis, etc.
    // Specifically excluded: Cricket (routed to cricket provider)
    if (s.includes('cricket')) return false;
    return (
      s.includes('foot') ||
      s.includes('soccer') ||
      s.includes('basket') ||
      s.includes('rugby') ||
      s.includes('afl') ||
      s.includes('australian') ||
      s.includes('tennis') ||
      s.includes('handball') ||
      s.includes('ice hockey') ||
      s.includes('hockey') ||
      s.includes('baseball') ||
      s.includes('motor') ||
      s.includes('f1')
    );
  }

  /**
   * Helper to execute fetch with timeout and retries
   */
  private async fetchWithRetry(url: string, maxRetries = 2, timeoutMs = 5000): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'HighFyTV/1.0 (SportsChannelResolver)'
          }
        });

        clearTimeout(timer);

        if (response.status === 401) {
          console.warn(`[TheSportsDB] HTTP 401 Unauthorized: Invalid API key configuration.`);
          return null;
        }

        if (response.status === 403) {
          console.warn(`[TheSportsDB] HTTP 403 Forbidden: Restricted key tier (endpoint requires premium Patreon/V2 key).`);
          return null;
        }

        if (response.status === 429) {
          console.warn(`[TheSportsDB] HTTP 429 Too Many Requests: Rate limit exceeded.`);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 600;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return null;
        }

        if (!response.ok) {
          console.warn(`[TheSportsDB] HTTP ${response.status} from TV endpoint.`);
          return null;
        }

        const data = await response.json();
        return data;
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err;
        if (err.name === 'AbortError') {
          console.warn(`[TheSportsDB] Request timeout after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries + 1}).`);
        } else {
          // Never log keys in errors
          const sanitizedMsg = String(err.message || '').replace(new RegExp(this.apiKey, 'g'), '[REDACTED_KEY]');
          console.warn(`[TheSportsDB] Fetch error (attempt ${attempt + 1}/${maxRetries + 1}):`, sanitizedMsg);
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 400;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    return null;
  }

  /**
   * Calculate date string YYYY-MM-DD shifted by offsetDays
   */
  private shiftDate(baseDateStr: string, offsetDays: number): string {
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return date.toISOString().slice(0, 10);
  }

  public async getFixtures(query: EventQuery): Promise<ProviderFixture[]> {
    // Determine base UTC date
    let baseDate = query.dateUtc;
    if (!baseDate && query.kickoffUtc) {
      baseDate = query.kickoffUtc.slice(0, 10);
    }
    if (!baseDate) {
      baseDate = new Date().toISOString().slice(0, 10);
    }

    // Fetch TV listings for UTC date plus day before and after: (date - 1, date, date + 1)
    const datesToFetch = [
      this.shiftDate(baseDate, -1),
      baseDate,
      this.shiftDate(baseDate, 1)
    ];

    const results = await Promise.all(
      datesToFetch.map(d => {
        const url = `${this.baseUrl}/eventstv.php?d=${d}`;
        return this.fetchWithRetry(url);
      })
    );

    // Group TV events into ProviderFixture items
    const fixtureMap = new Map<string, ProviderFixture>();

    for (const json of results) {
      if (!json || !Array.isArray(json.tvevents)) continue;

      for (const item of json.tvevents) {
        if (!item || !item.idEvent) continue;

        const eventId = String(item.idEvent).trim();
        const strEvent = String(item.strEvent || '').trim();
        const strSport = String(item.strSport || '').trim();
        const channelName = String(item.strChannel || '').trim();

        if (!channelName) continue;

        // Extract home and away teams from strEvent (e.g. "Arsenal vs Chelsea" or "Arsenal v Chelsea")
        let homeTeam = '';
        let awayTeam = '';
        const vsParts = strEvent.split(/\s+(?:vs\.?|v|-)\s+/i);
        if (vsParts.length >= 2) {
          homeTeam = vsParts[0].trim();
          awayTeam = vsParts[1].trim();
        } else {
          homeTeam = strEvent;
        }

        // Format kickoff UTC
        let kickoffUtc: string | undefined = undefined;
        if (item.dateEvent && item.strTime) {
          kickoffUtc = `${item.dateEvent}T${item.strTime}Z`;
        } else if (item.strTimeStamp) {
          kickoffUtc = item.strTimeStamp.replace(' ', 'T') + 'Z';
        }

        const channelBroadcast: ChannelBroadcast = {
          channelName,
          country: item.strCountry || undefined,
          logoUrl: item.strLogo || undefined,
          providerName: this.name
        };

        if (!fixtureMap.has(eventId)) {
          fixtureMap.set(eventId, {
            providerFixtureId: eventId,
            sport: strSport,
            league: item.strLeague || undefined,
            kickoffUtc,
            homeTeam,
            awayTeam,
            channels: [channelBroadcast]
          });
        } else {
          const existing = fixtureMap.get(eventId)!;
          // Avoid duplicate channels for the same event
          const isDuplicate = existing.channels.some(
            c => c.channelName.toLowerCase() === channelName.toLowerCase() && c.country === item.strCountry
          );
          if (!isDuplicate) {
            existing.channels.push(channelBroadcast);
          }
        }
      }
    }

    return Array.from(fixtureMap.values());
  }
}
