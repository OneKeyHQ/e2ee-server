import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHUNK_PACKET_BYTES, RELAY_BYTES_PER_SECOND, RELAY_MESSAGES_PER_SECOND, RelayTrafficBudget,
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
  assert.equal(budget.consume(RELAY_BYTES_PER_SECOND / 3, false, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(RELAY_BYTES_PER_SECOND / 3, true, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(RELAY_BYTES_PER_SECOND / 3, false, RELAY_BYTES_PER_SECOND), true);
  assert.equal(budget.consume(RELAY_BYTES_PER_SECOND / 3, true, RELAY_BYTES_PER_SECOND), false);
  t.mock.timers.tick(1000);
  assert.equal(budget.consume(RELAY_BYTES_PER_SECOND / 3, false, RELAY_BYTES_PER_SECOND), true);
});

test('mixed request/response traffic cannot bypass the aggregate message budget', () => {
  const budget = new RelayTrafficBudget();
  for (let index = 0; index < RELAY_MESSAGES_PER_SECOND; index += 1) {
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


test('JSON string accounting matches escaping and Unicode without copying the payload', () => {
  const strings = ['"\\\n', String.fromCharCode(0, 1, 8, 9, 10, 12, 13, 31), '中文😀',
    String.fromCharCode(0xd800), String.fromCharCode(0xdc00), String.fromCharCode(0xd800, 0xd800, 0xdc00),
    'A'.repeat(9 * 1024 * 1024)];
  let seed = 3431;
  for (let sample = 0; sample < 1000; sample += 1) {
    let value = '';
    for (let index = 0; index < 32; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value += String.fromCharCode(seed & 0xffff);
    }
    strings.push(value);
  }
  for (const value of strings) {
    const packet = { value };
    const bytes = Buffer.byteLength(JSON.stringify(packet));
    assert.equal(measureJsonBytes(packet, bytes), bytes);
    assert.equal(measureJsonBytes(packet, bytes - 1), undefined);
  }
});
