import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';

import {
  TEST_HOST,
  TestDevice,
  TestDeviceKey,
} from './helpers/hardwareClient';

const AUTH = '/prime/v1/hw-sync/auth';
const SYNC = '/prime/v1/sync';

type ITokens = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  isNewUser?: boolean;
};

describe('hardware Cloud Sync protocol contract', () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp<Framework>();
  });

  afterAll(async () => {
    await close(app);
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    createHttpRequest(app).post(path).set('Host', TEST_HOST).set(headers).send(body as object);

  const authed = (
    dk: TestDeviceKey,
    tokens: ITokens,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ) => {
    const headers = {
      authorization: `DPoP ${tokens.accessToken}`,
      dpop: dk.dpop({ htm: method, path, accessToken: tokens.accessToken }),
    };
    const req = createHttpRequest(app);
    const r = method === 'GET' ? req.get(path) : req.post(path);
    return r.set('Host', TEST_HOST).set(headers).send(body as object);
  };

  async function challenge(device: TestDevice, dk: TestDeviceKey) {
    const res = await post(`${AUTH}/challenge`, {
      identityPublicKey: device.publicKey,
      deviceKeyJwk: dk.jwk,
      clientInfo: { platform: 'test', appVersion: '0.0.0' },
    });
    expect(res.body.code).toBe(0);
    return res.body.data as { challengeId: string; message: string };
  }

  async function login(device: TestDevice, dk: TestDeviceKey): Promise<ITokens> {
    const { challengeId, message } = await challenge(device, dk);
    const res = await post(
      `${AUTH}/verify`,
      { challengeId, signature: device.signMessage(message) },
      { dpop: dk.dpop({ htm: 'POST', path: `${AUTH}/verify` }) }
    );
    expect(res.body.code).toBe(0);
    return res.body.data;
  }

  const refresh = (dk: TestDeviceKey, refreshToken: string) =>
    post(
      `${AUTH}/refresh`,
      { refreshToken },
      { dpop: dk.dpop({ htm: 'POST', path: `${AUTH}/refresh` }) }
    );

  const lockItem = (pwdHash: string) => ({
    key: 'lock',
    dataType: 'Lock',
    data: `wrapped-dek-for-${pwdHash}`,
    dataTimestamp: Date.now(),
  });

  describe('challenge and verify', () => {
    it('issues tokens and registers the identity once', async () => {
      const device = new TestDevice();
      const dk = new TestDeviceKey();
      const first = await login(device, dk);
      expect(first.isNewUser).toBe(true);
      expect(first.accessToken).toBeTruthy();
      expect(first.refreshToken).toBeTruthy();

      const second = await login(device, new TestDeviceKey());
      expect(second.isNewUser).toBe(false);
      expect(second.sessionId).not.toBe(first.sessionId);
    });

    it('challenge message carries the fixed prefix and device fingerprint', async () => {
      const { message } = await challenge(new TestDevice(), new TestDeviceKey());
      const lines = message.split('\n');
      expect(lines[0]).toBe('OneKey Cloud Sync sign-in');
      expect(lines.some(l => /^Nonce: [0-9a-f]{64}$/.test(l))).toBe(true);
      expect(lines.some(l => l.startsWith('Device: '))).toBe(true);
    });

    it('a challenge can be used only once', async () => {
      const device = new TestDevice();
      const dk = new TestDeviceKey();
      const { challengeId, message } = await challenge(device, dk);
      const signature = device.signMessage(message);
      const verify = () =>
        post(
          `${AUTH}/verify`,
          { challengeId, signature },
          { dpop: dk.dpop({ htm: 'POST', path: `${AUTH}/verify` }) }
        );
      expect((await verify()).body.code).toBe(0);
      const replay = await verify();
      expect(replay.status).toBe(401);
    });

    it('rejects a signature from another key', async () => {
      const dk = new TestDeviceKey();
      const { challengeId, message } = await challenge(new TestDevice(), dk);
      const res = await post(
        `${AUTH}/verify`,
        { challengeId, signature: new TestDevice().signMessage(message) },
        { dpop: dk.dpop({ htm: 'POST', path: `${AUTH}/verify` }) }
      );
      expect(res.status).toBe(401);
    });

    it('rejects a signature over a different message', async () => {
      const device = new TestDevice();
      const dk = new TestDeviceKey();
      const { challengeId } = await challenge(device, dk);
      const res = await post(
        `${AUTH}/verify`,
        { challengeId, signature: device.signMessage('some other message') },
        { dpop: dk.dpop({ htm: 'POST', path: `${AUTH}/verify` }) }
      );
      expect(res.status).toBe(401);
    });

    it('binds the challenge to the device key that requested it', async () => {
      const device = new TestDevice();
      const { challengeId, message } = await challenge(device, new TestDeviceKey());
      const res = await post(
        `${AUTH}/verify`,
        { challengeId, signature: device.signMessage(message) },
        { dpop: new TestDeviceKey().dpop({ htm: 'POST', path: `${AUTH}/verify` }) }
      );
      expect(res.status).toBe(401);
    });

    it('rejects a malformed identity key', async () => {
      const res = await post(`${AUTH}/challenge`, {
        identityPublicKey: 'not-a-key',
        deviceKeyJwk: new TestDeviceKey().jwk,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('sync routes', () => {
    it('require a token', async () => {
      const res = await post(`${SYNC}/check`, {
        nonce: 0,
        pwdHash: '',
        localData: [],
      });
      expect(res.status).toBe(401);
    });

    it('reject a token used without its device key', async () => {
      const tokens = await login(new TestDevice(), new TestDeviceKey());
      const res = await authed(new TestDeviceKey(), tokens, 'GET', `${SYNC}/lock`);
      expect(res.status).toBe(401);
    });

    it('reject a token with no DPoP proof', async () => {
      const tokens = await login(new TestDevice(), new TestDeviceKey());
      const res = await createHttpRequest(app)
        .get(`${SYNC}/lock`)
        .set('Host', TEST_HOST)
        .set('authorization', `DPoP ${tokens.accessToken}`);
      expect(res.status).toBe(401);
    });

    it('reject a replayed DPoP proof', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      const proof = dk.dpop({
        htm: 'GET',
        path: `${SYNC}/lock`,
        accessToken: tokens.accessToken,
      });
      const send = () =>
        createHttpRequest(app)
          .get(`${SYNC}/lock`)
          .set('Host', TEST_HOST)
          .set({ authorization: `DPoP ${tokens.accessToken}`, dpop: proof });
      expect((await send()).body.code).toBe(0);
      expect((await send()).status).toBe(401);
    });

    it('reject a DPoP proof made for another route', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      const res = await createHttpRequest(app)
        .get(`${SYNC}/lock`)
        .set('Host', TEST_HOST)
        .set({
          authorization: `DPoP ${tokens.accessToken}`,
          dpop: dk.dpop({
            htm: 'POST',
            path: `${SYNC}/check`,
            accessToken: tokens.accessToken,
          }),
        });
      expect(res.status).toBe(401);
    });

    it('first enable flushes data and lock, then data syncs under that pwdHash', async () => {
      const device = new TestDevice();
      const dk = new TestDeviceKey();
      const tokens = await login(device, dk);
      const pwdHash = 'hw-dek-v1';

      const lockBefore = await authed(dk, tokens, 'GET', `${SYNC}/lock`);
      expect(lockBefore.body.data.lock).toBeNull();

      const flush = await authed(dk, tokens, 'POST', `${SYNC}/flush`, {
        nonce: 0,
        pwdHash,
        lock: lockItem(pwdHash),
        localData: [
          { key: 'wallet-1', dataType: 'Wallet', data: 'cipher-1', dataTimestamp: 1, isDeleted: false },
          { key: 'dek:1', dataType: 'HardwareKeyEnvelope', data: 'env-1', dataTimestamp: 1, isDeleted: false },
        ],
      });
      expect(flush.body.code).toBe(0);

      const lock = await authed(dk, tokens, 'GET', `${SYNC}/lock`);
      expect(lock.body.data.lock.data).toBe(`wrapped-dek-for-${pwdHash}`);

      const upload = await authed(dk, tokens, 'POST', `${SYNC}/upload`, {
        nonce: flush.body.data.nonce,
        pwdHash,
        localData: [
          { key: 'wallet-2', dataType: 'Wallet', data: 'cipher-2', dataTimestamp: 2, isDeleted: false },
        ],
      });
      expect(upload.body.code).toBe(0);

      // A second device of the same wallet sees the same data.
      const otherDk = new TestDeviceKey();
      const other = await login(device, otherDk);
      const download = await authed(otherDk, other, 'POST', `${SYNC}/download`, {
        pwdHash,
      });
      expect(download.body.code).toBe(0);
      const keys = download.body.data.serverData.map((i: any) => i.key).sort();
      expect(keys).toEqual(['dek:1', 'wallet-1', 'wallet-2']);
    });

    it('a stale pwdHash is rejected after a reset flush', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      const v1 = 'hw-dek-v1';
      const v2 = 'hw-dek-v2';
      const item = { key: 'wallet-1', dataType: 'Wallet', data: 'c', dataTimestamp: 1 };
      await authed(dk, tokens, 'POST', `${SYNC}/flush`, {
        nonce: 0, pwdHash: v1, lock: lockItem(v1), localData: [item],
      });
      const reset = await authed(dk, tokens, 'POST', `${SYNC}/flush`, {
        nonce: 1, pwdHash: v2, lock: lockItem(v2), localData: [item],
      });
      expect(reset.body.code).toBe(0);

      const stale = await authed(dk, tokens, 'POST', `${SYNC}/check`, {
        nonce: 2, pwdHash: v1, localData: [],
      });
      expect(stale.body.code).toBe('PRIME_USER_PWD_HASH_INVALID');

      const fresh = await authed(dk, tokens, 'POST', `${SYNC}/check`, {
        nonce: 2, pwdHash: v2, localData: [],
      });
      expect(fresh.body.code).toBe(0);
    });

    it('different hardware identities do not share data', async () => {
      const dkA = new TestDeviceKey();
      const a = await login(new TestDevice(), dkA);
      await authed(dkA, a, 'POST', `${SYNC}/flush`, {
        nonce: 0,
        pwdHash: 'a',
        lock: lockItem('a'),
        localData: [{ key: 'only-a', dataType: 'Wallet', data: 'x', dataTimestamp: 1 }],
      });
      const dkB = new TestDeviceKey();
      const b = await login(new TestDevice(), dkB);
      const lock = await authed(dkB, b, 'GET', `${SYNC}/lock`);
      expect(lock.body.data.lock).toBeNull();
      const download = await authed(dkB, b, 'POST', `${SYNC}/download`, { pwdHash: 'none' });
      expect(download.body.data.serverData).toEqual([]);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      const res = await refresh(dk, tokens.refreshToken);
      expect(res.body.code).toBe(0);
      expect(res.body.data.refreshToken).not.toBe(tokens.refreshToken);
      expect(res.body.data.sessionId).toBe(tokens.sessionId);
      const lock = await authed(dk, res.body.data, 'GET', `${SYNC}/lock`);
      expect(lock.body.code).toBe(0);
    });

    it('reusing a rotated-out token revokes the whole session', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      const rotated = (await refresh(dk, tokens.refreshToken)).body.data;

      const reuse = await refresh(dk, tokens.refreshToken);
      expect(reuse.status).toBe(401);

      expect((await refresh(dk, rotated.refreshToken)).status).toBe(401);
      const lock = await authed(dk, rotated, 'GET', `${SYNC}/lock`);
      expect(lock.status).toBe(401);
    });

    it('requires the device key bound to the session', async () => {
      const tokens = await login(new TestDevice(), new TestDeviceKey());
      const res = await refresh(new TestDeviceKey(), tokens.refreshToken);
      expect(res.status).toBe(401);
    });

    it('rejects an unknown refresh token', async () => {
      const res = await refresh(new TestDeviceKey(), 'unknown');
      expect(res.status).toBe(401);
    });
  });

  describe('revoke', () => {
    it('allExceptCurrent signs out other sessions only', async () => {
      const device = new TestDevice();
      const dkA = new TestDeviceKey();
      const dkB = new TestDeviceKey();
      const a = await login(device, dkA);
      const b = await login(device, dkB);

      const res = await authed(dkA, a, 'POST', `${AUTH}/revoke`, {
        scope: 'allExceptCurrent',
      });
      expect(res.body.code).toBe(0);
      expect(res.body.data.revoked).toBe(1);

      expect((await authed(dkB, b, 'GET', `${SYNC}/lock`)).status).toBe(401);
      expect((await refresh(dkB, b.refreshToken)).status).toBe(401);
      expect((await authed(dkA, a, 'GET', `${SYNC}/lock`)).body.code).toBe(0);
    });

    it('current signs out this session', async () => {
      const dk = new TestDeviceKey();
      const tokens = await login(new TestDevice(), dk);
      await authed(dk, tokens, 'POST', `${AUTH}/revoke`, { scope: 'current' });
      expect((await authed(dk, tokens, 'GET', `${SYNC}/lock`)).status).toBe(401);
      expect((await refresh(dk, tokens.refreshToken)).status).toBe(401);
    });
  });
});
