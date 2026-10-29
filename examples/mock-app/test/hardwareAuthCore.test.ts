import { randomBytes } from 'crypto';

import { MemoryRedisAdapterImpl } from '../src/adapter/redis.adapter';
import {
  HardwareAuthCore,
  ITokenResponse,
} from '../src/hardwareAuth/hardwareAuthCore';
import { htuOf, TestDevice, TestDeviceKey } from './helpers/hardwareClient';

const VERIFY = '/prime/v1/hw-sync/auth/verify';
const REFRESH = '/prime/v1/hw-sync/auth/refresh';
const LOCK = '/prime/v1/sync/lock';
const DAY_MS = 24 * 3600 * 1000;

function setup() {
  let now = Date.now();
  const store = new MemoryRedisAdapterImpl();
  store.now = () => now;
  const users = new Set<string>();
  const core = new HardwareAuthCore({
    store,
    users: {
      ensureUser: async id => {
        const created = !users.has(id);
        users.add(id);
        return created;
      },
    },
    tokenSecret: randomBytes(32),
    now: () => now,
  });
  return {
    core,
    advance: (ms: number) => {
      now += ms;
    },
    nowSeconds: () => Math.floor(now / 1000),
  };
}

async function login(
  ctx: ReturnType<typeof setup>,
  device: TestDevice,
  dk: TestDeviceKey
) {
  const c = await ctx.core.createChallenge({
    identityPublicKey: device.publicKey,
    deviceKeyJwk: dk.jwk,
  });
  return ctx.core.verifyChallenge(
    { challengeId: c.challengeId, signature: device.signMessage(c.message) },
    {
      dpop: dk.dpop({ htm: 'POST', path: VERIFY, iat: ctx.nowSeconds() }),
      htm: 'POST',
      htu: htuOf(VERIFY),
    }
  );
}

function refresh(
  ctx: ReturnType<typeof setup>,
  dk: TestDeviceKey,
  refreshToken: string
) {
  return ctx.core.refresh(
    { refreshToken },
    {
      dpop: dk.dpop({ htm: 'POST', path: REFRESH, iat: ctx.nowSeconds() }),
      htm: 'POST',
      htu: htuOf(REFRESH),
    }
  );
}

function authenticate(
  ctx: ReturnType<typeof setup>,
  dk: TestDeviceKey,
  accessToken: string
) {
  return ctx.core.authenticate(`DPoP ${accessToken}`, {
    dpop: dk.dpop({
      htm: 'GET',
      path: LOCK,
      accessToken,
      iat: ctx.nowSeconds(),
    }),
    htm: 'GET',
    htu: htuOf(LOCK),
  });
}

describe('HardwareAuthCore', () => {
  it('signing out other sessions reaches one that refreshed past the session list lifetime', async () => {
    const ctx = setup();
    const device = new TestDevice();
    const oldKey = new TestDeviceKey();
    let tokens: ITokenResponse = await login(ctx, device, oldKey);
    // Active for 40 days: the list entry from sign-in expires after 30.
    for (let i = 0; i < 4; i += 1) {
      ctx.advance(10 * DAY_MS);
      tokens = await refresh(ctx, oldKey, tokens.refreshToken);
    }
    const newKey = new TestDeviceKey();
    const current = await login(ctx, device, newKey);
    const auth = await authenticate(ctx, newKey, current.accessToken);
    await ctx.core.revoke(auth, 'allExceptCurrent');

    await expect(
      authenticate(ctx, oldKey, tokens.accessToken)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      refresh(ctx, oldKey, tokens.refreshToken)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticate(ctx, newKey, current.accessToken)
    ).resolves.toMatchObject({ sessionId: current.sessionId });
  });

  it('a refresh racing a revoke cannot bring the session back', async () => {
    const ctx = setup();
    const dk = new TestDeviceKey();
    const tokens = await login(ctx, new TestDevice(), dk);
    const auth = await authenticate(ctx, dk, tokens.accessToken);
    // The revoke lands after the refresh read the session as live and before
    // it writes that copy back.
    const core = ctx.core as unknown as {
      retireRefreshToken: (...args: unknown[]) => Promise<void>;
    };
    const retire = core.retireRefreshToken.bind(ctx.core);
    core.retireRefreshToken = async (...args) => {
      await ctx.core.revoke(auth, 'current');
      return retire(...args);
    };
    const next = await refresh(ctx, dk, tokens.refreshToken);

    await expect(
      authenticate(ctx, dk, next.accessToken)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      refresh(ctx, dk, next.refreshToken)
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired challenge', async () => {
    const ctx = setup();
    const device = new TestDevice();
    const dk = new TestDeviceKey();
    const c = await ctx.core.createChallenge({
      identityPublicKey: device.publicKey,
      deviceKeyJwk: dk.jwk,
    });
    ctx.advance(121_000);
    await expect(
      ctx.core.verifyChallenge(
        { challengeId: c.challengeId, signature: device.signMessage(c.message) },
        {
          dpop: dk.dpop({ htm: 'POST', path: VERIFY, iat: ctx.nowSeconds() }),
          htm: 'POST',
          htu: htuOf(VERIFY),
        }
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rate-limits challenges per identity', async () => {
    const ctx = setup();
    const device = new TestDevice();
    const dk = new TestDeviceKey();
    const request = () =>
      ctx.core.createChallenge({
        identityPublicKey: device.publicKey,
        deviceKeyJwk: dk.jwk,
      });
    for (let i = 0; i < 5; i += 1) await request();
    await expect(request()).rejects.toMatchObject({ status: 429 });
  });

  it('rejects an expired access token', async () => {
    const ctx = setup();
    const dk = new TestDeviceKey();
    const tokens = await login(ctx, new TestDevice(), dk);
    ctx.advance(901_000);
    await expect(
      ctx.core.authenticate(`DPoP ${tokens.accessToken}`, {
        dpop: dk.dpop({
          htm: 'GET',
          path: LOCK,
          accessToken: tokens.accessToken,
          iat: ctx.nowSeconds(),
        }),
        htm: 'GET',
        htu: htuOf(LOCK),
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a stale DPoP proof', async () => {
    const ctx = setup();
    const dk = new TestDeviceKey();
    const tokens = await login(ctx, new TestDevice(), dk);
    await expect(
      ctx.core.authenticate(`DPoP ${tokens.accessToken}`, {
        dpop: dk.dpop({
          htm: 'GET',
          path: LOCK,
          accessToken: tokens.accessToken,
          iat: ctx.nowSeconds() - 120,
        }),
        htm: 'GET',
        htu: htuOf(LOCK),
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed by another server secret', async () => {
    const issuer = setup();
    const verifier = setup();
    const dk = new TestDeviceKey();
    const tokens = await login(issuer, new TestDevice(), dk);
    await expect(
      verifier.core.authenticate(`DPoP ${tokens.accessToken}`, {
        dpop: dk.dpop({
          htm: 'GET',
          path: LOCK,
          accessToken: tokens.accessToken,
          iat: verifier.nowSeconds(),
        }),
        htm: 'GET',
        htu: htuOf(LOCK),
      })
    ).rejects.toMatchObject({ status: 401 });
  });
});
