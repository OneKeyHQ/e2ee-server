export const TRANSFER_CHUNK_BYTES = 64 * 1024;
export const TRANSFER_MAX_BYTES = 64 * 1024 * 1024;
export const TRANSFER_MAX_CHUNKS = Math.ceil(TRANSFER_MAX_BYTES / TRANSFER_CHUNK_BYTES);
export const CHUNK_PACKET_BYTES = TRANSFER_CHUNK_BYTES + 8 * 1024;
export const RESPONSE_PACKET_BYTES = 256 * 1024;
export const CHUNK_REQUESTS_PER_SECOND = 512;
export const RELAY_RESPONSES_PER_SECOND = CHUNK_REQUESTS_PER_SECOND * 2;
export const RELAY_MESSAGES_PER_SECOND = CHUNK_REQUESTS_PER_SECOND + RELAY_RESPONSES_PER_SECOND + 64;
// Full chunk envelopes need 36 MiB; reserve another 12 MiB for ACKs/control traffic.
export const RELAY_BYTES_PER_SECOND = CHUNK_PACKET_BYTES * CHUNK_REQUESTS_PER_SECOND + 12 * 1024 * 1024;

/** Count the entire JSON envelope without building another full packet string. */
export function measureJsonBytes(value: unknown, limit: number): number | undefined {
  let bytes = 0;
  let nodes = 0;
  const addString = (text: string) => {
    // Count JSON escapes without allocating an escaped copy of legacy payloads.
    bytes += Buffer.byteLength(text) + 2;
    if (bytes > limit) return false;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92) bytes += 1;
      else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) index += 1;
        else bytes += 3;
      } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
      if (bytes > limit) return false;
    }
    return bytes <= limit;
  };
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1;
    if (depth > 64 || nodes > 16_384 || bytes > limit) return false;
    if (item === null) bytes += 4;
    else if (typeof item === 'string') return addString(item);
    else if (typeof item === 'boolean') bytes += item ? 4 : 5;
    else if (typeof item === 'number' && Number.isFinite(item)) bytes += String(item).length;
    else if (Array.isArray(item)) {
      bytes += 2;
      for (let i = 0; i < item.length; i += 1) {
        if (i) bytes += 1;
        if (!visit(item[i] ?? null, depth + 1)) return false;
      }
    } else if (item && typeof item === 'object' &&
      (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      bytes += 2;
      let first = true;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const entry = (item as Record<string, unknown>)[key];
        if (entry === undefined) continue;
        if (!first) bytes += 1;
        first = false;
        if (!addString(key)) return false;
        bytes += 1;
        if (!visit(entry, depth + 1)) return false;
      }
    } else return false;
    return bytes <= limit;
  };
  return visit(value, 0) ? bytes : undefined;
}

export function isValidTransferChunk(params: unknown): boolean {
  if (!Array.isArray(params) || params.length !== 1) return false;
  const chunk = params[0] as { transferId?: unknown; index?: unknown; data?: unknown } | undefined;
  return Boolean(chunk && typeof chunk === 'object' && !Array.isArray(chunk) &&
    Object.keys(chunk).length === 3 &&
    typeof chunk.transferId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(chunk.transferId) &&
    typeof chunk.index === 'number' && Number.isSafeInteger(chunk.index) &&
    chunk.index >= 0 && chunk.index < TRANSFER_MAX_CHUNKS &&
    typeof chunk.data === 'string' && chunk.data.length > 0 &&
    chunk.data.length <= TRANSFER_CHUNK_BYTES && /^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data));
}

/** One bounded budget for both relay directions, including rejected packets. */
export class RelayTrafficBudget {
  private startedAt = 0;
  private messages = 0;
  private responses = 0;
  private bytes = 0;

  consume(bytes: number, response: boolean, byteLimit: number): boolean {
    const now = Date.now();
    if (now - this.startedAt >= 1000) {
      this.startedAt = now;
      this.messages = 0;
      this.responses = 0;
      this.bytes = 0;
    }
    this.messages += 1;
    this.responses += response ? 1 : 0;
    this.bytes += bytes;
    return this.messages <= RELAY_MESSAGES_PER_SECOND &&
      this.responses <= RELAY_RESPONSES_PER_SECOND && this.bytes <= byteLimit;
  }
}
