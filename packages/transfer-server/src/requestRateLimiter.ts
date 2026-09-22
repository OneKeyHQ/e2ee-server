import { CHUNK_REQUESTS_PER_SECOND } from './relayPolicy';

const METHOD_INTERVAL_MS = 3000;
const MAX_TRACKED_METHODS = 64;
const ROOM_QUERY_CAPACITY = 10;
const ROOM_QUERY_REFILL_PER_MS = 5 / 1000;
const UNTHROTTLED_METHODS = new Set(['changeTransferDirection', 'leaveRoom', 'cancelTransfer']);

/** Request policies are separate from the shared request/response traffic budget. */
export class RequestRateLimiter {
  private methods = new Map<string, number>();
  private roomQueries?: { tokens: number; updatedAt: number };
  private chunks = { startedAt: 0, count: 0 };

  clear(): void {
    this.methods.clear();
    this.roomQueries = undefined;
    this.chunks = { startedAt: 0, count: 0 };
  }

  isLimited(eventName: string, method: string): boolean {
    const now = Date.now();
    if (eventName === 'e2ee-request' && method === 'getRoomUsers') {
      const tokens = this.roomQueries
        ? Math.min(ROOM_QUERY_CAPACITY, this.roomQueries.tokens + Math.max(0, now - this.roomQueries.updatedAt) * ROOM_QUERY_REFILL_PER_MS)
        : ROOM_QUERY_CAPACITY;
      this.roomQueries = { tokens, updatedAt: now };
      if (tokens < 1) return true;
      this.roomQueries.tokens -= 1;
      return false;
    }
    if (eventName === 'e2ee-c2c-request' && method === 'sendTransferChunk') {
      if (now - this.chunks.startedAt >= 1000) this.chunks = { startedAt: now, count: 0 };
      this.chunks.count += 1;
      return this.chunks.count > CHUNK_REQUESTS_PER_SECOND;
    }
    if (UNTHROTTLED_METHODS.has(method)) return false;
    const key = `${eventName}:${method}`;
    const previous = this.methods.get(key);
    if (previous !== undefined && now - previous < METHOD_INTERVAL_MS) return true;
    if (previous === undefined && this.methods.size >= MAX_TRACKED_METHODS) {
      // Only expired entries can be evicted; method-name floods cannot reset live limits.
      for (const [tracked, timestamp] of this.methods) {
        if (now - timestamp >= METHOD_INTERVAL_MS) this.methods.delete(tracked);
      }
      if (this.methods.size >= MAX_TRACKED_METHODS) return true;
    }
    this.methods.set(key, now);
    return false;
  }
}
