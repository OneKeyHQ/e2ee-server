import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server } from 'socket.io';
import { io } from 'socket.io-client';

import { E2eeErrorCode } from '../src/errors';
import { RoomManager } from '../src/roomManager';

import type { Socket } from 'socket.io-client';
import type { IRoom } from '../src/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('room admission stays consistent across disconnects and asynchronous adapters', { timeout: 40_000 }, async (t) => {
  const http = createServer();
  const server = new Server(http);
  const config = { maxUsers: 2, roomTimeout: 60_000, maxMessageSize: 10 * 1024 * 1024 };
  const manager = new RoomManager({ config, socketServer: server });
  server.on('connection', (socket) => {
    socket.on('disconnect', () => { void manager.leaveRoomBySocket(socket); });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert(address && typeof address !== 'string');
  const clients: Socket[] = [];
  const connect = async () => {
    const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const socket = server.sockets.sockets.get(client.id!);
    assert(socket);
    return { client, socket, context: { socketClient: socket } };
  };
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    manager.destroy();
  });
  const params = (roomId: string) => ({ roomId, appPlatform: 'test', appPlatformName: 'test', appVersion: '1', appBuildNumber: '1', appDeviceName: 'synthetic' });
  const owner = await connect();
  const { roomId } = await manager.createRoom();
  const ownerJoin = await manager.joinRoom(params(roomId), owner.context);
  assert.equal(ownerJoin.maxMessageSize, config.maxMessageSize);
  const users = () => manager.getRoomUsers({ roomId }, owner.context);

  await t.test('join metadata is bounded before admission without rejecting absent legacy fields', async () => {
    const peer = await connect();
    for (const invalid of [
      { appPlatform: 'A'.repeat(65) },
      { appPlatformName: 'A'.repeat(257) },
      { appVersion: 'A'.repeat(65) },
      { appBuildNumber: 'A'.repeat(65) },
      { appDeviceName: 'A'.repeat(513) },
      { appDeviceName: 42 },
    ]) {
      await assert.rejects(manager.joinRoom(Object.assign(params(roomId), invalid), peer.context), { code: E2eeErrorCode.INVALID_PARAMETER });
    }
    assert.equal(peer.socket.rooms.has(roomId), false);
    const legacyParams = params(roomId);
    Reflect.deleteProperty(legacyParams, 'appDeviceName');
    const joined = await manager.joinRoom(legacyParams, peer.context);
    assert.equal(joined.success, true);
    await manager.leaveRoom({ roomId, userId: joined.userId! }, peer.context);
  });

  await t.test('disconnect during the pre-join delay never adds a member or emits joined', async () => {
    const peer = await connect();
    let notifications = 0;
    const onJoined = () => { notifications += 1; };
    owner.client.on('user-joined', onJoined);
    const joining = manager.joinRoom(params(roomId), peer.context);
    const rejection = assert.rejects(joining, { code: E2eeErrorCode.OPERATION_FAILED });
    const disconnected = new Promise<void>((resolve) => peer.socket.once('disconnect', () => resolve()));
    peer.client.disconnect();
    await disconnected;
    await rejection;
    assert.equal((await users()).length, 1);
    assert.equal(peer.socket.rooms.has(roomId), false);
    assert.equal(notifications, 0);
    owner.client.off('user-joined', onJoined);
  });

  await t.test('disconnect releases pending capacity before an adapter resolves', async () => {
    const peer = await connect();
    const entered = deferred();
    const release = deferred();
    const originalJoin = peer.socket.join.bind(peer.socket);
    peer.socket.join = async (room) => { entered.resolve(); await release.promise; await originalJoin(room); };
    const joining = manager.joinRoom(params(roomId), peer.context);
    const rejection = assert.rejects(joining, { code: E2eeErrorCode.OPERATION_FAILED });
    await entered.promise;
    const disconnected = new Promise<void>((resolve) => peer.socket.once('disconnect', () => resolve()));
    peer.client.disconnect();
    await disconnected;
    const replacement = await connect();
    const admitted = await manager.joinRoom(params(roomId), replacement.context);
    assert.equal(admitted.success, true, 'the unresolved adapter no longer reserves a slot');
    release.resolve();
    await rejection;
    assert.equal(peer.socket.rooms.has(roomId), false);
    assert.equal((await users()).length, 2);
    await manager.leaveRoom({ roomId, userId: admitted.userId! }, replacement.context);
  });

  await t.test('an adapter rejection rolls back delivery membership and leaves no ghost', async () => {
    const peer = await connect();
    const originalJoin = peer.socket.join.bind(peer.socket);
    peer.socket.join = async (room) => { await originalJoin(room); throw new Error('Synthetic adapter failure'); };
    await assert.rejects(manager.joinRoom(params(roomId), peer.context), /Synthetic adapter failure/);
    assert.equal(peer.socket.rooms.has(roomId), false);
    assert.equal((await users()).length, 1);
  });

  await t.test('pending admissions reserve capacity; committed rejoin is idempotent in a full room', async () => {
    const [peer, competitor] = await Promise.all([connect(), connect()]);
    const entered = deferred();
    const release = deferred();
    const originalJoin = peer.socket.join.bind(peer.socket);
    peer.socket.join = async (room) => { entered.resolve(); await release.promise; await originalJoin(room); };
    const joining = manager.joinRoom(params(roomId), peer.context);
    await entered.promise;
    assert.equal((await users()).length, 1, 'pending entries are not visible to clients');
    await assert.rejects(manager.joinRoom(params(roomId), competitor.context), { code: E2eeErrorCode.CONNECTION_REJECTED });
    release.resolve();
    const admitted = await joining;
    const rejoined = await manager.joinRoom(params(roomId), owner.context);
    assert.equal(rejoined.userId, ownerJoin.userId);
    assert.equal(rejoined.userCount, 2);
    await manager.leaveRoom({ roomId, userId: admitted.userId! }, peer.context);
  });

  await t.test('a room removed while the adapter is pending cannot be resurrected', async () => {
    const peer = await connect();
    const entered = deferred();
    const release = deferred();
    const originalJoin = peer.socket.join.bind(peer.socket);
    peer.socket.join = async (room) => { entered.resolve(); await release.promise; await originalJoin(room); };
    const joining = manager.joinRoom(params(roomId), peer.context);
    const rejection = assert.rejects(joining, { code: E2eeErrorCode.OPERATION_FAILED });
    await entered.promise;
    await manager.leaveRoom({ roomId, userId: ownerJoin.userId! }, owner.context);
    release.resolve();
    await rejection;
    assert.deepEqual(await users(), []);
    assert.equal(peer.socket.rooms.has(roomId), false);
  });

  await t.test('expiry notifies legacy clients and removes only expired room membership', async () => {
    const peer = await connect();
    const expired = await manager.createRoom();
    const [a, b] = await Promise.all([
      manager.joinRoom(params(expired.roomId), owner.context),
      manager.joinRoom(params(expired.roomId), peer.context),
    ]);
    const active = await manager.createRoom();
    await manager.joinRoom(params(active.roomId), owner.context);
    const rooms = Reflect.get(manager, 'rooms') as Map<string, IRoom>;
    rooms.get(expired.roomId)!.lastActivity = new Date(0);
    const left = (client: Socket) => new Promise<{ roomId: string; userCount: number }>((resolve) => client.once('user-left', resolve));
    const notices = Promise.all([left(owner.client), left(peer.client)]);
    const cleanup = Reflect.get(manager, 'cleanupExpiredRooms') as () => void;
    cleanup.call(manager);
    (await notices).forEach((notice) => assert.deepEqual(
      { roomId: notice.roomId, userCount: notice.userCount }, { roomId: expired.roomId, userCount: 0 },
    ));
    assert.equal(owner.client.connected, true);
    assert.equal(peer.client.connected, true);
    assert.equal(owner.socket.rooms.has(expired.roomId), false);
    assert.equal(peer.socket.rooms.has(expired.roomId), false);
    assert.equal(owner.socket.rooms.has(active.roomId), true);
    assert.equal(manager.isUserInRoom(active.roomId, owner.socket.id).isInRoom, true);
    assert.deepEqual(await manager.leaveRoom({ roomId: expired.roomId, userId: a.userId! }, owner.context), { success: true, userCount: 0, roomDestroyed: true });
    assert.equal((await manager.leaveRoom({ roomId: expired.roomId, userId: b.userId! }, peer.context)).success, true);
  });
});
