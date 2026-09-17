// Load the same browser-global shims as the production server before the bridge.
import '../src/utils/nodeCompat';

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server } from 'socket.io';
import { io } from 'socket.io-client';

import { e2eeServerApiSetup } from '../src/e2eeServerApi';
import { E2eeErrorCode } from '../src/errors';
import { RoomManager } from '../src/roomManager';
import { CHUNK_PACKET_BYTES, CHUNK_REQUESTS_PER_SECOND, RELAY_RESPONSES_PER_SECOND } from '../src/relayPolicy';

import type { Socket } from 'socket.io-client';

type IPacket = {
  id: number;
  type: string;
  scope?: string;
  remoteId?: string | number | null;
  peerOrigin?: string;
  error?: { code: number; message: string; stack?: string };
  data?: unknown;
};

const ROOM_TIMEOUT = 60_000;
const appInfo = {
  appPlatform: 'compatibility-test', appPlatformName: 'compatibility-test',
  appVersion: '1.0.0', appBuildNumber: '1', appDeviceName: 'synthetic-peer',
};

function receive(socket: Socket, event: string, id: number): Promise<IPacket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}, id ${id}`));
    }, 5000);
    const listener = (packet: IPacket) => {
      if (packet.id === id) {
        clearTimeout(timer);
        socket.off(event, listener);
        resolve(packet);
      }
    };
    socket.on(event, listener);
  });
}

test('relay compatibility over real Socket.IO with a controlled activity clock', async (t) => {
  // Only Date is mocked: HTTP, Socket.IO, RPC delays, and timeout guards use
  // real timers. Advancing this clock never waits for a one-hour session.
  let now = 1_700_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const advance = (ms: number) => {
    now += ms;
    t.mock.timers.setTime(now);
  };

  const httpServer = createServer();
  // Keep transport heartbeats beyond the simulated timeline so these tests
  // isolate RoomManager's idle TTL rather than the client's ping deadline.
  const socketServer = new Server(httpServer, { pingInterval: 3_600_000, pingTimeout: 3_600_000, maxHttpBufferSize: 10 * 1024 * 1024 });
  const roomConfig = { maxUsers: 2, roomTimeout: ROOM_TIMEOUT, maxMessageSize: 10 * 1024 * 1024 };
  const manager = new RoomManager({ config: roomConfig, socketServer });
  socketServer.on('connection', (socketClient) => {
    e2eeServerApiSetup({ socketClient, roomManager: manager });
    socketClient.on("disconnect", () => { void manager.leaveRoomBySocket(socketClient); });
    // A test-only barrier confirms all preceding synchronous relay handlers
    // ran, including intentionally silent drops. It changes no production API.
    socketClient.on('test-barrier', (ack: () => void) => ack());
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];

  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    manager.destroy();
    await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  });

  const connect = async () => {
    const socket = io(url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const [a, b, outsider] = await Promise.all([connect(), connect(), connect()]);
  let sequence = 100;
  const request = (method: string, params: unknown[] = [], module = 'roomManager'): IPacket => ({
    id: sequence++, type: 'REQUEST', data: { module, method, params },
  });
  const call = async (socket: Socket, method: string, params: unknown[] = []) => {
    const packet = request(method, params);
    const reply = receive(socket, 'e2ee-response', packet.id);
    socket.emit('e2ee-request', packet);
    return reply;
  };
  const createSession = async () => {
    const created = await call(a, 'createRoom');
    assert.equal(created.error, undefined);
    const { roomId } = created.data as { roomId: string };
    const joined = await Promise.all([
      call(a, 'joinRoomAfterCreate', [{ roomId, ...appInfo }]),
      call(b, 'joinRoom', [{ roomId, ...appInfo }]),
    ]);
    joined.forEach((reply) => assert.equal(reply.error, undefined));
    return roomId;
  };
  const barrier = (socket: Socket) => socket.timeout(5000).emitWithAck('test-barrier');
  const relay = async (sender: Socket, recipient: Socket, roomId: string, event: string, packet: IPacket) => {
    const delivered = receive(recipient, event, packet.id);
    sender.emit(event, { roomId, payload: packet });
    assert.deepEqual(await delivered, packet);
  };
  // Invoke the actual scheduled cleanup body deterministically. No mocked
  // membership map or fake cleanup implementation can mask expiry regressions.
  const cleanup = () => {
    const cleanupExpiredRooms = Reflect.get(manager, 'cleanupExpiredRooms') as () => void;
    cleanupExpiredRooms.call(manager);
  };
  let roomId = await createSession();

  await t.test('pairing queries may overlap with CLI polling, while floods remain bounded', async () => {
    for (let poll = 0; poll < 3; poll += 1) {
      const replies = await Promise.all([
        call(a, 'getRoomUsers', [{ roomId }]),
        call(a, 'getRoomUsers', [{ roomId }]),
        call(a, 'getRoomUsers', [{ roomId }]),
      ]);
      replies.forEach((reply) => {
        assert.equal(reply.error, undefined, 'poll, key derivation, and UI queries can coincide');
        assert.equal((reply.data as unknown[]).length, 2);
      });
      advance(1000);
    }
    advance(2000);
    const burst = await Promise.all(Array.from({ length: 11 }, () => call(a, 'getRoomUsers', [{ roomId }])));
    assert.equal(burst.filter((reply) => !reply.error).length, 10);
    assert.equal(burst.filter((reply) => reply.error?.code === E2eeErrorCode.RATE_LIMIT_EXCEEDED).length, 1);
    advance(199);
    assert.equal((await call(a, 'getRoomUsers', [{ roomId }])).error?.code, E2eeErrorCode.RATE_LIMIT_EXCEEDED);
    advance(1);
    assert.equal((await call(a, 'getRoomUsers', [{ roomId }])).error, undefined, 'one token refills every 200ms');
    const privateRoom = await call(outsider, 'getRoomUsers', [{ roomId }]);
    const missingRoom = await call(outsider, 'getRoomUsers', [{ roomId: 'missing-room' }]);
    assert.equal(privateRoom.error, undefined);
    assert.equal(missingRoom.error, undefined);
    assert.deepEqual(privateRoom.data, []);
    assert.deepEqual(privateRoom.data, missingRoom.data);
  });

  await t.test('concurrent C2S and rejected C2C requests with the same id keep separate error channels', async () => {
    advance(5000);
    const sharedId = sequence++;
    const c2s: IPacket = {
      ...request('joinRoom', [{ roomId: 'invalid-room-id', ...appInfo }]),
      id: sharedId, scope: 'c2s-scope', remoteId: 'c2s-remote', peerOrigin: 'c2s-origin',
    };
    const c2c: IPacket = {
      ...request('sendTransferChunk', [{ transferId: 'invalid-chunk', index: 0, data: '' }], 'api'),
      id: sharedId, scope: 'c2c-scope', remoteId: 'c2c-remote', peerOrigin: 'c2c-origin',
    };
    const c2sReplies: IPacket[] = [];
    const c2cReplies: IPacket[] = [];
    const collectC2s = (packet: IPacket) => c2sReplies.push(packet);
    const collectC2c = (packet: IPacket) => c2cReplies.push(packet);
    a.on('e2ee-response', collectC2s);
    a.on('e2ee-c2c-response', collectC2c);
    try {
      const serverReply = receive(a, 'e2ee-response', sharedId);
      const peerReply = receive(a, 'e2ee-c2c-response', sharedId);
      a.emit('e2ee-request', c2s);
      a.emit('e2ee-c2c-request', { roomId, payload: c2c });
      const replies = await Promise.all([serverReply, peerReply]);
      for (const [index, response] of replies.entries()) {
        const original = index === 0 ? c2s : c2c;
        assert.equal(response.id, sharedId);
        assert.equal(response.type, 'RESPONSE');
        assert.equal(response.scope, original.scope);
        assert.equal(response.remoteId, original.remoteId);
        assert.equal(response.peerOrigin, index === 0 ? 'e2ee-server' : original.peerOrigin);
        assert.equal(response.error?.stack, undefined);
      }
      assert.equal(replies[0].error?.code, E2eeErrorCode.INVALID_ROOM_ID);
      assert.equal(replies[1].error?.code, E2eeErrorCode.INVALID_PARAMETER);
      await barrier(a);
      assert.equal(c2sReplies.length, 1);
      assert.equal(c2cReplies.length, 1);
    } finally {
      a.off('e2ee-response', collectC2s);
      a.off('e2ee-c2c-response', collectC2c);
    }
    const zeroReply = receive(a, 'e2ee-c2c-response', 0);
    a.emit('e2ee-c2c-request', { roomId, payload: { ...c2c, id: 0 } });
    assert.equal((await zeroReply).id, 0, 'a rejected C2C request preserves even a zero id');
  });

  await t.test('ordinary C2C method throttling also responds on the C2C channel', async () => {
    const accepted = request('legacyTransferMethod', ['synthetic-data'], 'api');
    await relay(a, b, roomId, 'e2ee-c2c-request', accepted);
    const blocked = { ...accepted, id: sequence++ };
    const response = receive(a, 'e2ee-c2c-response', blocked.id);
    a.emit('e2ee-c2c-request', { roomId, payload: blocked });
    const rejected = await response;
    assert.equal(rejected.id, blocked.id);
    assert.equal(rejected.error?.code, E2eeErrorCode.RATE_LIMIT_EXCEEDED);
    assert.equal(rejected.error?.stack, undefined);
  });

  await t.test('all chunk envelope levels are bounded while valid maximum chunks and legacy payloads pass', async () => {
    const padding = 'A'.repeat(9 * 1024 * 1024);
    const seen: IPacket[] = [];
    const collect = (packet: IPacket) => seen.push(packet);
    b.on('e2ee-c2c-request', collect);
    try {
      for (const level of ['envelope', 'payload', 'rpc'] as const) {
        advance(2000);
        const packet = request('sendTransferChunk', [{ transferId: 'size-check', index: 0, data: 'AAAA' }], 'api');
        const envelope = { roomId, payload: packet };
        const target = level === 'envelope' ? envelope : level === 'payload' ? packet : packet.data;
        Object.assign(target as object, { padding });
        const response = receive(a, 'e2ee-c2c-response', packet.id);
        a.emit('e2ee-c2c-request', envelope);
        const rejected = await response;
        assert.equal(rejected.error?.code, E2eeErrorCode.INVALID_PARAMETER);
        assert.equal(rejected.error?.stack, undefined);
      }
      await barrier(b);
      assert.equal(seen.length, 0, 'padding never reaches the peer');
      advance(2000);
      const maximum = request('sendTransferChunk', [{ transferId: 'size-check', index: 1023, data: 'A'.repeat(64 * 1024) }], 'api');
      await relay(a, b, roomId, 'e2ee-c2c-request', maximum);
      const outOfRange = request('sendTransferChunk', [{ transferId: 'size-check', index: 1024, data: 'AAAA' }], 'api');
      const rangeReply = receive(a, 'e2ee-c2c-response', outOfRange.id);
      a.emit('e2ee-c2c-request', { roomId, payload: outOfRange });
      assert.equal((await rangeReply).error?.code, E2eeErrorCode.INVALID_PARAMETER);
      advance(2000);
      await relay(a, b, roomId, 'e2ee-c2c-request', request('sendTransferData', [{ rawData: padding }], 'api'));
    } finally { b.off('e2ee-c2c-request', collect); }
  });

  await t.test('request and response events cannot exchange payload types', async () => {
    advance(2000);
    const seen: IPacket[] = [];
    const collect = (packet: IPacket) => seen.push(packet);
    b.on('e2ee-c2c-request', collect);
    b.on('e2ee-c2c-response', collect);
    a.emit('e2ee-c2c-response', { roomId, payload: request('sendTransferChunk', [{ index: 1024, data: 'AAAA', transferId: 'bypass' }], 'api') });
    a.emit('e2ee-c2c-response', { roomId, payload: { type: 'RESPONSE', data: 'missing-id' } });
    a.emit('e2ee-c2c-request', { roomId, payload: { ...request('cancelTransfer', [], 'api'), type: 'RESPONSE' } });
    await barrier(a);
    await barrier(b);
    assert.equal(seen.length, 0);
    b.off('e2ee-c2c-request', collect);
    b.off('e2ee-c2c-response', collect);
  });

  await t.test('512 full chunk envelopes plus manifest, finish and ACKs fit one traffic window', async () => {
    advance(5000);
    const replies: IPacket[] = [];
    const chunks: number[] = [];
    const collect = (packet: IPacket) => replies.push(packet);
    const acknowledge = (packet: IPacket) => {
      const rpc = packet.data as { method: string; params: Array<{ index: number }> };
      if (rpc.method === 'sendTransferChunk') chunks.push(rpc.params[0].index);
      b.emit('e2ee-c2c-response', { roomId, payload: { id: packet.id, type: 'RESPONSE', data: { accepted: true } } });
    };
    a.on('e2ee-c2c-response', collect);
    b.on('e2ee-c2c-request', acknowledge);
    try {
      a.emit('e2ee-c2c-request', { roomId, payload: request('beginChunkedTransfer', [{ transferId: 'burst', totalBytes: 512 * 65536 }], 'api') });
      for (let index = 0; index < CHUNK_REQUESTS_PER_SECOND; index += 1) {
        const envelope = { roomId, payload: request('sendTransferChunk', [{ transferId: 'burst', index, data: 'A'.repeat(65536) }], 'api'), padding: '' };
        envelope.padding = 'A'.repeat(CHUNK_PACKET_BYTES - Buffer.byteLength(JSON.stringify(envelope)));
        a.emit('e2ee-c2c-request', envelope);
      }
      const finish = request('finishChunkedTransfer', [{ transferId: 'burst' }], 'api');
      const done = receive(a, 'e2ee-c2c-response', finish.id);
      a.emit('e2ee-c2c-request', { roomId, payload: finish });
      await done;
      assert.equal(chunks.length, CHUNK_REQUESTS_PER_SECOND);
      assert.equal(replies.length, CHUNK_REQUESTS_PER_SECOND + 2);
      assert.equal(replies.some((packet) => packet.error), false);
      assert.equal(a.connected, true);
      assert.equal(b.connected, true);
    } finally {
      a.off('e2ee-c2c-response', collect);
      b.off('e2ee-c2c-request', acknowledge);
    }
  });

  await t.test('string, numeric and null remote IDs preserve both RPC and relay envelopes', async () => {
    advance(5000);
    for (const remoteId of ['remote', 42, 1.5, null]) {
      const packet = { ...request('getRoomUsers', [{ roomId }]), remoteId };
      const response = receive(a, 'e2ee-response', packet.id);
      a.emit('e2ee-request', packet);
      assert.equal((await response).remoteId, remoteId);
      await relay(a, b, roomId, 'e2ee-c2c-request', { ...request('cancelTransfer', [], 'api'), remoteId });
      await relay(b, a, roomId, 'e2ee-c2c-response', { id: sequence++, type: 'RESPONSE', remoteId, data: true });
    }
  });

  await t.test('one-way rejection never emits an uncorrelated response', async () => {
    advance(5000);
    const replies: IPacket[] = [];
    const collect = (packet: IPacket) => replies.push(packet);
    a.on('e2ee-response', collect);
    a.on('e2ee-c2c-response', collect);
    try {
      a.emit('e2ee-c2c-request', { roomId, payload: { type: 'REQUEST', data: { module: 'api', method: 'sendTransferChunk', params: [] } } });
      for (let index = 0; index < 11; index += 1) {
        a.emit('e2ee-request', { type: 'REQUEST', data: { module: 'roomManager', method: 'getRoomUsers', params: [{ roomId }] } });
      }
      await barrier(a);
      assert.equal(replies.length, 0);
    } finally { a.off('e2ee-response', collect); a.off('e2ee-c2c-response', collect); }
  });

  await t.test('complex but correlatable packets return small errors only to the authorized caller', async () => {
    advance(5000);
    let extra: unknown = 'small';
    for (let index = 0; index < 70; index += 1) extra = { nested: extra };
    const packet = request('cancelTransfer', [], 'api');
    const reply = receive(a, 'e2ee-c2c-response', packet.id);
    a.emit('e2ee-c2c-request', { roomId, payload: packet, extra });
    assert.equal((await reply).error?.code, E2eeErrorCode.INVALID_PARAMETER);
    const responseId = sequence++;
    const rejectedResponse = receive(a, 'e2ee-c2c-response', responseId);
    b.emit('e2ee-c2c-response', { roomId, payload: { id: responseId, type: 'RESPONSE', data: extra } });
    assert.equal((await rejectedResponse).error?.code, E2eeErrorCode.INVALID_PARAMETER);
    const unauthorized: IPacket[] = [];
    const collect = (value: IPacket) => unauthorized.push(value);
    outsider.on('e2ee-c2c-response', collect);
    outsider.emit('e2ee-c2c-request', { roomId, payload: request('cancelTransfer', [], 'api'), extra });
    await barrier(outsider);
    assert.equal(unauthorized.length, 0);
    outsider.off('e2ee-c2c-response', collect);
    assert.equal(a.connected, true);
    assert.equal(b.connected, true);
  });

  await t.test('legacy requests, transfer chunks, and peer responses each extend idle TTL', async () => {
    let lastAcceptedAt = now;
    const events: Array<[string, IPacket]> = [
      ['e2ee-c2c-request', request('sendTransferData', ['synthetic-data'], 'api')],
      ['e2ee-c2c-request', request('sendTransferChunk', [{ transferId: 'active-chunk', index: 0, data: 'AAAA' }], 'api')],
      ['e2ee-c2c-response', { id: sequence++, type: 'RESPONSE', data: 'synthetic-ack' }],
    ];
    for (const [event, packet] of events) {
      advance(lastAcceptedAt + ROOM_TIMEOUT * 0.75 - now);
      await relay(a, b, roomId, event, packet);
      lastAcceptedAt = now;
      advance(ROOM_TIMEOUT * 0.5);
      cleanup();
      assert(manager.isUserInRoom(roomId, a.id!).isInRoom, `${event} keeps an active session alive across its old expiry`);
    }
    advance(lastAcceptedAt + ROOM_TIMEOUT + 1 - now);
    cleanup();
    assert.equal(manager.isUserInRoom(roomId, a.id!).isInRoom, false, 'genuinely idle rooms still expire');
  });

  for (const kind of ['non-member', 'malformed-envelope', 'invalid-chunk', 'throttled-request'] as const) {
    await t.test(`${kind} traffic cannot keep a room alive`, async () => {
      advance(5000);
      roomId = await createSession();
      const limited = request('same-method', [], 'api');
      if (kind === 'throttled-request') {
        // A supported idle timeout shorter than the method throttle makes a
        // rejection occur near expiry without mutating private room state.
        roomConfig.roomTimeout = 1000;
        await relay(a, b, roomId, 'e2ee-c2c-request', limited);
      }
      const idleTimeout = kind === 'throttled-request' ? 1000 : ROOM_TIMEOUT;
      const before = now;
      const peerMessages: IPacket[] = [];
      const collect = (packet: IPacket) => peerMessages.push(packet);
      b.on('e2ee-c2c-request', collect);
      b.on('e2ee-c2c-response', collect);
      try {
        advance(idleTimeout - 1);
        let sender = a;
        if (kind === 'non-member') {
          sender = outsider;
          // Socket.IO membership alone is insufficient; RoomManager must also
          // authorize the sender, even if an adapter still lists this socket.
          await socketServer.sockets.sockets.get(outsider.id!)!.join(roomId);
          sender.emit('e2ee-c2c-request', { roomId, payload: request('outsider', [], 'api') });
          sender.emit('e2ee-c2c-response', { roomId, payload: { id: sequence++, type: 'RESPONSE', data: 'forged' } });
        } else if (kind === 'malformed-envelope') {
          sender.emit('e2ee-c2c-request', { roomId, payload: { id: sequence++, type: 'REQUEST', data: {} } });
          sender.emit('e2ee-c2c-response', { roomId, payload: { id: sequence++, type: 'BOGUS' } });
        } else {
          const packet = kind === 'invalid-chunk'
            ? request('sendTransferChunk', [{ transferId: 'invalid-chunk', index: -1, data: 'AAAA' }], 'api')
            : { ...limited, id: sequence++ };
          const response = receive(sender, 'e2ee-c2c-response', packet.id);
          sender.emit('e2ee-c2c-request', { roomId, payload: packet });
          assert.equal((await response).error?.code, kind === 'invalid-chunk'
            ? E2eeErrorCode.INVALID_PARAMETER : E2eeErrorCode.RATE_LIMIT_EXCEEDED);
        }
        await barrier(sender);
        await barrier(b);
        assert.equal(peerMessages.length, 0);
        advance(before + idleTimeout + 1 - now);
        cleanup();
        assert.equal(manager.isUserInRoom(roomId, a.id!).isInRoom, false, `${kind} must not renew idle TTL`);
      } finally {
        b.off('e2ee-c2c-request', collect);
        b.off('e2ee-c2c-response', collect);
        roomConfig.roomTimeout = ROOM_TIMEOUT;
      }
    });
  }
  for (const mode of ['oversized', 'flood'] as const) {
    await t.test(`response ${mode} is bounded without losing a recoverable RPC`, async () => {
      advance(5000);
      const [sender, recipient] = await Promise.all([connect(), connect()]);
      const created = await call(sender, 'createRoom');
      const isolatedRoom = (created.data as { roomId: string }).roomId;
      await call(sender, 'joinRoomAfterCreate', [{ roomId: isolatedRoom, ...appInfo }]);
      await call(recipient, 'joinRoom', [{ roomId: isolatedRoom, ...appInfo }]);
      const received: IPacket[] = [];
      recipient.on('e2ee-c2c-response', (packet: IPacket) => received.push(packet));
      const disconnected = new Promise<void>((resolve) => sender.once('disconnect', () => resolve()));
      const count = mode === 'flood' ? RELAY_RESPONSES_PER_SECOND + 8 : 1;
      for (let index = 0; index < count; index += 1) {
        sender.emit('e2ee-c2c-response', { roomId: isolatedRoom, payload: {
          id: sequence++, type: 'RESPONSE', data: mode === 'oversized' ? 'A'.repeat(300 * 1024) : 'synthetic-ack',
        } });
      }
      if (mode === 'flood') await disconnected;
      else await barrier(sender);
      await barrier(recipient);
      assert.equal(received.length, mode === 'flood' ? RELAY_RESPONSES_PER_SECOND : 1);
      if (mode === 'oversized') {
        assert.equal(sender.connected, true);
        assert.equal(received[0].error?.code, E2eeErrorCode.INVALID_PARAMETER);
        assert.ok(Buffer.byteLength(JSON.stringify(received[0])) < 1024);
      }
      assert.equal(recipient.connected, true);
      assert.equal((await call(recipient, 'getRoomUsers', [{ roomId: isolatedRoom }])).error, undefined);
    });
  }

});
