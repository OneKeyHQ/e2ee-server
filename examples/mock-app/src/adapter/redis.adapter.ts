import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { IRedisAdapter } from '@onekeyhq/cloud-sync-server';

// In-memory stand-in for Redis with per-key TTL.
@Provide()
@Scope(ScopeEnum.Singleton)
export class MemoryRedisAdapterImpl implements IRedisAdapter {
  private data = new Map<string, { value: string; expiresAt?: number }>();

  now: () => number = () => Date.now();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttl ? this.now() + ttl * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}
