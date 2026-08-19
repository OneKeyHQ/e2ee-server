/**
 * End-to-end smoke test.
 *
 * Boots the built server as a real process, drives it with two real Socket.IO
 * clients, and asserts that malformed traffic cannot take it down.
 *
 * The regression it guards: `JsBridgeBase.receive()` throws synchronously on a
 * payload it does not recognise. When that ran inside an `async` Socket.IO
 * listener the throw escaped as an unhandled rejection, which Node treats as
 * fatal - one bad packet from one client killed every other session on the
 * process. Anything that reintroduces that shape (an `async` listener, a
 * missing validation, a handler that throws) fails here.
 *
 * Run with `yarn test` from packages/transfer-server.
 */
import { spawn } from 'child_process';
import { get } from 'http';
import { join } from 'path';

import { io } from 'socket.io-client';

import type { ChildProcess } from 'child_process';
import type { Socket } from 'socket.io-client';

const PORT = Number(process.env.SMOKE_PORT || 38_680);
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_ENTRY = join(__dirname, '..', 'dist', 'server.js');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;

function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

function health(): Promise<number | string> {
  return new Promise((resolve) => {
    const req = get(`${BASE_URL}/health`, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', (err: NodeJS.ErrnoException) => resolve(`ERR ${err.code ?? 'unknown'}`));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve('TIMEOUT');
    });
  });
}

async function startServer(): Promise<ChildProcess> {
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output: string[] = [];
  server.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited during startup:\n${output.join('')}`);
    }
    // eslint-disable-next-line no-await-in-loop
    if ((await health()) === 200) {
      return server;
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(250);
  }

  server.kill('SIGKILL');
  throw new Error(`server did not become healthy on ${BASE_URL}:\n${output.join('')}`);
}

type IClient = {
  name: string;
  socket: Socket;
  call: (module: string, method: string, params: unknown[]) => Promise<any>;
  callRaw: (module: string, method: string, params: unknown[]) => Promise<any>;
  c2cRequests: any[];
  c2cResponses: any[];
  ready: Promise<void>;
};

function makeClient(name: string): IClient {
  const socket = io(BASE_URL, {
    transports: ['websocket'],
    auth: { instanceId: name },
    reconnection: false,
  });

  let seq = 0;
  const pending = new Map<number, (payload: any) => void>();
  const c2cRequests: any[] = [];
  const c2cResponses: any[] = [];

  socket.on('e2ee-response', (payload: any) => {
    const resolver = pending.get(payload?.id as number);
    if (resolver) {
      pending.delete(payload.id as number);
      resolver(payload);
    }
  });
  socket.on('e2ee-c2c-request', (payload: any) => c2cRequests.push(payload));
  socket.on('e2ee-c2c-response', (payload: any) => c2cResponses.push(payload));

  const callRaw = (module: string, method: string, params: unknown[]) => {
    seq += 1;
    const id = seq;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 9000);
      pending.set(id, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('e2ee-request', {
        id,
        type: 'REQUEST',
        data: { module, method, params },
      });
    });
  };

  const call = async (module: string, method: string, params: unknown[]) => {
    const payload = await callRaw(module, method, params);
    if (payload.error) {
      throw new Error(`${method} -> ${payload.error.message as string}`);
    }
    return payload.data;
  };

  return {
    name,
    socket,
    call,
    callRaw,
    c2cRequests,
    c2cResponses,
    ready: new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (err) => reject(new Error(`${name}: ${err.message}`)));
    }),
  };
}

/**
 * Send one message across a client-to-client channel and confirm the peer
 * received that exact payload. Each message carries a unique token so a stale
 * or duplicated delivery cannot be mistaken for a fresh one.
 *
 * Every call uses a distinct method name: `e2ee-c2c-request` is rate limited
 * per method, so reusing one would trip the limiter instead of testing delivery.
 */
async function deliver(
  from: IClient,
  to: IClient,
  channel: 'request' | 'response',
  roomId: string,
  token: string,
): Promise<boolean> {
  const inbox = channel === 'request' ? to.c2cRequests : to.c2cResponses;
  const before = inbox.length;

  if (channel === 'request') {
    from.socket.emit('e2ee-c2c-request', {
      payload: {
        id: Date.now(),
        type: 'REQUEST',
        data: { module: 'peer', method: `peerMessage_${token}`, params: [token] },
      },
      roomId,
    });
  } else {
    from.socket.emit('e2ee-c2c-response', {
      payload: { id: Date.now(), type: 'RESPONSE', data: { result: token } },
      roomId,
    });
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (inbox.length > before) {
      const received = inbox[inbox.length - 1];
      const carried =
        channel === 'request'
          ? (received?.data?.params as string[])?.[0]
          : (received?.data?.result as string);
      return carried === token;
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(100);
  }
  return false;
}

/** Both directions, both channels - a full round trip between the two peers. */
async function checkBidirectional(
  clientA: IClient,
  clientB: IClient,
  roomId: string,
  stage: string,
): Promise<void> {
  const results = [
    ['A -> B request', await deliver(clientA, clientB, 'request', roomId, `${stage}-ab-req`)],
    ['B -> A request', await deliver(clientB, clientA, 'request', roomId, `${stage}-ba-req`)],
    ['A -> B response', await deliver(clientA, clientB, 'response', roomId, `${stage}-ab-res`)],
    ['B -> A response', await deliver(clientB, clientA, 'response', roomId, `${stage}-ba-res`)],
  ] as Array<[string, boolean]>;

  for (const [direction, ok] of results) {
    check(ok, `${stage}: ${direction}`, ok ? 'payload intact' : 'not delivered');
  }
}

const appInfo = (device: string) => ({
  appPlatform: 'smoke-test',
  appPlatformName: 'smoke-test',
  appVersion: '1.0.0',
  appBuildNumber: '1',
  appDeviceName: device,
});

/**
 * Every malformed shape, aimed at all four listeners. The first entry is the
 * exact packet that took production down.
 */
const MALFORMED_PACKETS: Array<[string, unknown]> = [
  ['e2ee-request', { data: { module: 'roomManager', method: 'createRoom' } }],
  ['e2ee-request', undefined],
  ['e2ee-request', null],
  ['e2ee-request', 'a string'],
  ['e2ee-request', [1, 2, 3]],
  ['e2ee-request', { type: 'NOT_A_TYPE', data: { method: 'x' } }],
  ['e2ee-request', { type: 'REQUEST', data: {} }],
  ['e2ee-request', { type: 'REQUEST', data: { method: 42 } }],
  ['e2ee-request', { type: 'REQUEST', data: null }],
  ['e2ee-request', { type: 'RESPONSE' }],
  ['e2ee-c2c-request', undefined],
  ['e2ee-c2c-request', null],
  ['e2ee-c2c-request', {}],
  ['e2ee-c2c-request', { payload: { type: 'REQUEST', data: { method: 'x' } } }],
  ['e2ee-c2c-request', { payload: { type: 'REQUEST', data: { method: 'x' } }, roomId: 42 }],
  ['e2ee-c2c-request', { payload: null, roomId: 'ABCDE-12345' }],
  ['e2ee-c2c-response', undefined],
  ['e2ee-c2c-response', null],
  ['e2ee-c2c-response', {}],
  ['e2ee-c2c-response', { payload: { type: 'BOGUS' }, roomId: 'ABCDE-12345' }],
  ['e2ee-c2c-response', { payload: 'nope', roomId: null }],
];

async function main(): Promise<void> {
  console.log(`\nstarting server on port ${PORT}`);
  const server = await startServer();

  const clientA = makeClient('smoke-client-A');
  const clientB = makeClient('smoke-client-B');

  try {
    await Promise.all([clientA.ready, clientB.ready]);
    console.log(`clients connected: A=${clientA.socket.id ?? ''} B=${clientB.socket.id ?? ''}\n`);

    // --- a real session, so the assertions afterwards mean something ---
    const room = await clientA.call('roomManager', 'createRoom', []);
    await clientA.call('roomManager', 'joinRoomAfterCreate', [
      { roomId: room.roomId, ...appInfo('A') },
    ]);
    await clientB.call('roomManager', 'joinRoom', [{ roomId: room.roomId, ...appInfo('B') }]);

    const usersBefore = await clientA.call('roomManager', 'getRoomUsers', [
      { roomId: room.roomId },
    ]);
    check(usersBefore.length === 2, 'session established', `${usersBefore.length} users in room`);

    // --- baseline: peers can talk both ways before anything goes wrong ---
    await checkBidirectional(clientA, clientB, room.roomId, 'before');

    // --- both clients attack every listener ---
    console.log(
      `\nfiring ${MALFORMED_PACKETS.length} malformed packets from each client (${
        MALFORMED_PACKETS.length * 2
      } total)\n`,
    );
    for (const [event, payload] of MALFORMED_PACKETS) {
      clientA.socket.emit(event, payload);
      clientB.socket.emit(event, payload);
    }
    await wait(2000);

    // --- the process has to be alive for anything else to be checkable ---
    const status = await health();
    check(status === 200, 'server process alive', `/health = ${String(status)}`);
    if (status !== 200) {
      return;
    }

    check(clientA.socket.connected, 'client A still connected');
    check(clientB.socket.connected, 'client B still connected');

    // --- and the session has to have survived, not just the process ---
    const usersAfter = await clientA.call('roomManager', 'getRoomUsers', [
      { roomId: room.roomId },
    ]);
    check(usersAfter.length === 2, 'room state intact', `${usersAfter.length} users still in room`);

    // --- the point of the whole test: the two peers can still talk, both
    //     ways, on both channels, with payloads arriving intact ---
    await checkBidirectional(clientA, clientB, room.roomId, 'after');

    // --- and it holds under a second round of abuse, so surviving once was
    //     not luck ---
    for (const [event, payload] of MALFORMED_PACKETS) {
      clientB.socket.emit(event, payload);
      clientA.socket.emit(event, payload);
    }
    await wait(1500);
    check((await health()) === 200, 'server alive after a second attack round');
    await checkBidirectional(clientA, clientB, room.roomId, 'after 2nd round');

    const clientC = makeClient('smoke-client-C');
    await clientC.ready;
    check(clientC.socket.connected, 'new client can still connect');

    // --- rate limiting still does its job: two identical calls at once, the
    //     second one lands inside the window and has to be rejected ---
    const [firstCall, secondCall] = await Promise.all([
      clientC.callRaw('roomManager', 'createRoom', []),
      clientC.callRaw('roomManager', 'createRoom', []),
    ]);
    const rejected = [firstCall, secondCall].filter((p) => p.error?.code === 1100);
    check(
      rejected.length === 1,
      'rate limiting still enforced',
      `${rejected.length} of 2 concurrent calls rejected with 1100`,
    );
    clientC.socket.disconnect();
  } finally {
    clientA.socket.disconnect();
    clientB.socket.disconnect();
    server.kill('SIGKILL');
  }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures})`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err: Error) => {
    console.log(`\nSMOKE TEST ERRORED: ${err.message}\n`);
    process.exit(1);
  });
