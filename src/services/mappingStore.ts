/**
 * Storage Schema and Store for ID Mapping: provider_fixture_id ↔ internal_event_id
 */

import fs from 'fs';
import path from 'path';
import { StoredMapping } from './types';

export interface MappingStoreSchema {
  version: string;
  updatedAt: string;
  mappings: Record<string, StoredMapping>; // Key: internalEventId
  reverseMappings: Record<string, string>; // Key: `${provider}:${providerFixtureId}` -> internalEventId
}

export class MappingStore {
  private filePath: string;
  private cache: MappingStoreSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    this.filePath = customPath || path.resolve(process.cwd(), 'data', 'fixture_mappings.json');
    this.cache = this.loadFromDisk();
  }

  private loadFromDisk(): MappingStoreSchema {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.mappings === 'object') {
          return {
            version: parsed.version || '1.0.0',
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            mappings: parsed.mappings || {},
            reverseMappings: parsed.reverseMappings || {}
          };
        }
      }
    } catch (err: any) {
      console.warn(`[MappingStore] Failed to load mappings from disk (${this.filePath}):`, err.message);
    }

    return {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      mappings: {},
      reverseMappings: {}
    };
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.persistToDisk();
    }, 1000);
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.cache.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[MappingStore] Failed to write mappings to disk (${this.filePath}):`, err.message);
    }
  }

  public getMapping(internalEventId: string): StoredMapping | undefined {
    return this.cache.mappings[internalEventId];
  }

  public getInternalEventId(provider: string, providerFixtureId: string): string | undefined {
    const key = `${provider}:${providerFixtureId}`;
    return this.cache.reverseMappings[key];
  }

  public saveMapping(
    internalEventId: string,
    providerFixtureId: string,
    provider: string,
    matchMethod: 'exact_id' | 'normalized_fuzzy',
    confidence: number,
    metadata?: StoredMapping['metadata']
  ): StoredMapping {
    const record: StoredMapping = {
      internalEventId,
      providerFixtureId,
      provider,
      matchedAt: new Date().toISOString(),
      matchMethod,
      confidence,
      metadata
    };

    this.cache.mappings[internalEventId] = record;
    this.cache.reverseMappings[`${provider}:${providerFixtureId}`] = internalEventId;
    this.scheduleSave();

    return record;
  }

  public getAllMappings(): Record<string, StoredMapping> {
    return { ...this.cache.mappings };
  }
}

export const defaultMappingStore = new MappingStore();
