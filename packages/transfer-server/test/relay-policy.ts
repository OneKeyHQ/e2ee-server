import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHUNK_PACKET_BYTES, RELAY_BYTES_PER_SECOND, RelayTrafficBudget,
  TRANSFER_MAX_BYTES, TRANSFER_CHUNK_BYTES, TRANSFER_MAX_CHUNKS, measureJsonBytes,
} from '../src/relayPolicy';
import { capForLog } from '../src/utils/logger';

test('packet accounting includes JSON escaping, UTF-8, keys, arrays, and outer metadata', () => {
  const packet = { roomId: 'room', payload: { origin: 'https://example.test', data: ['中文', '\u0000"\\\n', 123, true, null, { field: 'value' }], omitted: undefined } };
  const bytes = Buffer.byteLength(JSON.stringify(packet));
  assert.equal(measureJsonBytes(packet, bytes), bytes);
  assert.equal(measureJsonBytes(packet, bytes - 1), undefined);
  assert.equal(measureJsonBytes({ padding: 'A'.repeat(9 * 1024 * 1024) }, CHUNK_PACKET_BYTES), undefined);
  assert.equal(measureJsonBytes({ binary: Buffer.alloc(10) }, 1000), undefined);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(measureJsonBytes(circular, 1000), undefined);
});

test('request and response bytes share one budget, with a fresh window after idle', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  const budget = new RelayTrafficBudget();
  assert.equal(budget.consume(9 * 1024 * 1024, false, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(9 * 1024 * 1024, true, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(9 * 1024 * 1024, false, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(9 * 1024 * 1024, true, RELAY_BYTES_PER_SECOND), false);
  t.mock.timers.tick(1000);
  assert.equal(budget.consume(9 * 1024 * 1024, false, RELAY_BYTES_PER_SECOND), true);
});

test('mixed request/response traffic cannot bypass the aggregate message budget', () => {
  const budget = new RelayTrafficBudget();
  for (let index = 0; index < 1024; index += 1) {
    assert.equal(budget.consume(1, index % 2 === 0, RELAY_BYTES_PER_SECOND), true);
  }
  assert.equal(budget.consume(1, false, RELAY_BYTES_PER_SECOND), false);
});

test('v1 count derives from the wire-size limits and log fields stay bounded', () => {
  assert.equal(TRANSFER_MAX_CHUNKS, 1024);
  assert.equal(TRANSFER_MAX_CHUNKS * TRANSFER_CHUNK_BYTES, TRANSFER_MAX_BYTES);
  assert.equal(capForLog('A'.repeat(10000)), `${'A'.repeat(64)}...(10000)`);
  assert.equal(capForLog({ padding: 'unsafe' }), null);
});
