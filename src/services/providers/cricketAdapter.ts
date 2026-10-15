/**
 * Cricket Channels Provider Adapter
 *
 * UNVERIFIED ASSUMPTIONS (TODO):
 * - cricketapi.org / CricketData.org / Cricbuzz per-match TV broadcast channels endpoints
 *   are currently NOT publicly confirmed in standard documentation (only livescores, fixtures, squads).
 * - Per instructions: "Treat any per-match channels endpoint only as a hypothesis. Verify with docs or
 *   a live response before relying on any endpoint. Do not invent endpoint paths or response fields."
 * - When an unconfirmed endpoint or sample response is provided, this adapter can be wired to that exact contract.
 * - In the absence of a confirmed endpoint, this adapter safely returns an empty array [] and logs
 *   the unverified status without throwing errors.
 */

import { ChannelProviderAdapter, EventQuery, ProviderFixture } from '../types';

export class CricketAdapter implements ChannelProviderAdapter {
  readonly name = 'CricketAPI';
  private apiKey: string;
  private endpointUrl?: string;

  constructor(apiKey?: string, endpointUrl?: string) {
    this.apiKey = (apiKey || process.env.CRICKETDATA_API_KEY || process.env.CRICAPI_KEY || '').trim();
    this.endpointUrl = (endpointUrl || process.env.CRICKET_CHANNELS_API_URL || '').trim();
  }

  public supportsSport(sport: string): boolean {
    if (!sport) return false;
    return sport.toLowerCase().includes('cricket');
  }

  public async getFixtures(_query: EventQuery): Promise<ProviderFixture[]> {
    // Check if an explicit verified channels endpoint is configured
    if (!this.endpointUrl) {
      console.info(
        '[CricketAdapter] [TODO Unverified Assumption] Per-match broadcast channel endpoint for Cricket API is not confirmed. Returning empty array without guessing.'
      );
      return [];
    }

    // When an endpoint is explicitly configured in secrets/environment:
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.endpointUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HighFyTV/1.0 (CricketChannelResolver)'
        }
      });
      clearTimeout(timer);

      if (response.status === 401 || response.status === 403) {
        console.warn(`[CricketAdapter] HTTP ${response.status}: Access restricted for configured endpoint.`);
        return [];
      }
      if (response.status === 429) {
        console.warn('[CricketAdapter] HTTP 429: Rate limit exceeded for cricket endpoint.');
        return [];
      }

      if (!response.ok) {
        console.warn(`[CricketAdapter] HTTP ${response.status} from cricket endpoint.`);
        return [];
      }

      const data: any = await response.json();
      if (Array.isArray(data?.fixtures)) {
        return data.fixtures;
      }
    } catch (err: any) {
      console.warn('[CricketAdapter] Fetch error from configured endpoint:', err.message);
    }

    return [];
  }
}
