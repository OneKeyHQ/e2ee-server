import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Server } from 'socket.io';
import { io } from 'socket.io-client';

import { E2eeErrorCode } from '../src/errors';
import { RoomManager } from '../src/roomManager';

import type { Socket } from 'socket.io-client';

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
  const users = () => manager.getRoomUsers({ roomId }, owner.context);

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
});
