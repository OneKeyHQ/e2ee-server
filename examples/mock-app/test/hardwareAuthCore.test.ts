import { randomBytes } from 'crypto';

import { MemoryRedisAdapterImpl } from '../src/adapter/redis.adapter';
import { HardwareAuthCore } from '../src/hardwareAuth/hardwareAuthCore';
import { htuOf, TestDevice, TestDeviceKey } from './helpers/hardwareClient';

const VERIFY = '/prime/v1/hw-sync/auth/verify';
const LOCK = '/prime/v1/sync/lock';

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

describe('HardwareAuthCore', () => {
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
