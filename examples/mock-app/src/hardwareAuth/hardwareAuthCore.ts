import { createHash, randomBytes, randomUUID, JsonWebKey } from 'crypto';
import type { IRedisAdapter } from '@onekeyhq/cloud-sync-server';

import { recoverBip137PublicKey } from './bip137';
import {
  decodeJwt,
  ecJwkThumbprint,
  sha256Base64url,
  signHs256,
  verifyEs256,
  verifyHs256,
} from './jwt';

// Storage-agnostic hardware Cloud Sync auth. Hosts supply an IRedisAdapter
// (memory in mock-app, Redis in production) and a user store.

export const HW_CHALLENGE_PREFIX = 'OneKey Cloud Sync sign-in';

// The app's error type needs integer codes. Placeholder values: align them
// with the Prime production codes before shipping.
export enum EHardwareAuthErrorCode {
  BadRequest = 90400,
  Unauthorized = 90401,
  RateLimited = 90429,
}

export class HardwareAuthError extends Error {
  constructor(
    readonly code: EHardwareAuthErrorCode,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HardwareAuthError';
  }
}

const unauthorized = () =>
  new HardwareAuthError(
    EHardwareAuthErrorCode.Unauthorized,
    401,
    'Unauthorized'
  );
const badRequest = (message: string) =>
  new HardwareAuthError(EHardwareAuthErrorCode.BadRequest, 400, message);

export interface IHardwareAuthUserStore {
  // Returns true when the user was created by this call.
  ensureUser(userId: string): Promise<boolean>;
}

export type IHardwareAuthOptions = {
  store: IRedisAdapter;
  users: IHardwareAuthUserStore;
  tokenSecret: Buffer;
  now?: () => number;
  challengeTtlSeconds?: number;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  dpopSkewSeconds?: number;
  challengeLimitPerMinute?: number;
};

export type IDpopRequest = {
  dpop: string | undefined;
  htm: string;
  htu: string;
};

export type ITokenResponse = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  sessionId: string;
};

type IChallengeRecord = {
  nonce: string;
  // Optional: when omitted, the identity is the key recovered at verify.
  identityPublicKey?: string;
  jkt: string;
  message: string;
  expiresAt: number;
};

type ISessionRecord = {
  sessionId: string;
  userId: string;
  jkt: string;
  refreshHash: string;
  // The token refreshHash replaced; see refresh().
  previousRefreshHash?: string;
  revoked: boolean;
  createdAt: number;
  lastActiveAt: number;
};

const key = {
  challenge: (id: string) => `hw:challenge:${id}`,
  challengeRate: (ik: string, minute: number) => `hw:rate:${ik}:${minute}`,
  session: (sid: string) => `hw:session:${sid}`,
  userSessions: (userId: string) => `hw:user-sessions:${userId}`,
  refresh: (hash: string) => `hw:refresh:${hash}`,
  refreshUsed: (hash: string) => `hw:refresh-used:${hash}`,
  jti: (jkt: string, jti: string) => `hw:jti:${jkt}:${jti}`,
};

const sha256Hex = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const hardwareUserId = (identityPublicKey: string) =>
  `Hardware:${identityPublicKey}`;

export class HardwareAuthCore {
  private readonly opts: Required<IHardwareAuthOptions>;

  constructor(options: IHardwareAuthOptions) {
    this.opts = {
      now: () => Date.now(),
      challengeTtlSeconds: 120,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 30 * 24 * 3600,
      dpopSkewSeconds: 60,
      challengeLimitPerMinute: 5,
      ...options,
    };
  }

  private nowSeconds() {
    return Math.floor(this.opts.now() / 1000);
  }

  private async getJson<T>(k: string): Promise<T | undefined> {
    const raw = await this.opts.store.get(k);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  private async setJson(k: string, value: unknown, ttlSeconds: number) {
    await this.opts.store.set(k, JSON.stringify(value), ttlSeconds);
  }

  // Not atomic on a shared store; production should use GETDEL.
  private async takeJson<T>(k: string): Promise<T | undefined> {
    const value = await this.getJson<T>(k);
    if (value) await this.opts.store.del(k);
    return value;
  }

  async createChallenge(params: {
    identityPublicKey?: string;
    deviceKeyJwk: JsonWebKey;
  }): Promise<{ challengeId: string; message: string; expiresAt: number }> {
    const { identityPublicKey, deviceKeyJwk } = params;
    if (
      identityPublicKey !== undefined &&
      !/^(02|03)[0-9a-f]{64}$/.test(identityPublicKey)
    ) {
      throw badRequest('Invalid identityPublicKey');
    }
    const jkt = ecJwkThumbprint(deviceKeyJwk);
    if (!jkt) throw badRequest('Invalid deviceKeyJwk');

    // Rate-limit by identity when given, otherwise by device key.
    const minute = Math.floor(this.nowSeconds() / 60);
    const rateKey = key.challengeRate(identityPublicKey ?? jkt, minute);
    const count = Number((await this.opts.store.get(rateKey)) ?? '0') + 1;
    if (count > this.opts.challengeLimitPerMinute) {
      throw new HardwareAuthError(
        EHardwareAuthErrorCode.RateLimited,
        429,
        'Too many requests'
      );
    }
    await this.opts.store.set(rateKey, String(count), 60);

    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = this.opts.now() + this.opts.challengeTtlSeconds * 1000;
    const message = [
      HW_CHALLENGE_PREFIX,
      'Only confirm this inside the OneKey App.',
      `Nonce: ${nonce}`,
      `Device: ${jkt.slice(0, 8)}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');
    const record: IChallengeRecord = {
      nonce,
      identityPublicKey,
      jkt,
      message,
      expiresAt,
    };
    await this.setJson(
      key.challenge(challengeId),
      record,
      this.opts.challengeTtlSeconds
    );
    return { challengeId, message, expiresAt };
  }

  /** Verifies a DPoP proof and returns its key thumbprint. */
  private async verifyDpop(
    req: IDpopRequest,
    accessToken?: string
  ): Promise<string> {
    const jwt = req.dpop ? decodeJwt(req.dpop) : undefined;
    if (!jwt) throw unauthorized();
    const { header, payload } = jwt;
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') {
      throw unauthorized();
    }
    const jkt = ecJwkThumbprint(header.jwk);
    if (!jkt || !verifyEs256(jwt, header.jwk)) throw unauthorized();
    if (
      payload.htm !== req.htm ||
      payload.htu !== req.htu ||
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      typeof payload.iat !== 'number' ||
      Math.abs(this.nowSeconds() - payload.iat) > this.opts.dpopSkewSeconds
    ) {
      throw unauthorized();
    }
    if (accessToken && payload.ath !== sha256Base64url(accessToken)) {
      throw unauthorized();
    }
    const jtiKey = key.jti(jkt, payload.jti);
    if (await this.opts.store.get(jtiKey)) throw unauthorized();
    await this.opts.store.set(jtiKey, '1', this.opts.dpopSkewSeconds * 2);
    return jkt;
  }

  private async issueTokens(
    session: ISessionRecord,
    previousRefreshHash?: string
  ): Promise<ITokenResponse> {
    const now = this.nowSeconds();
    const accessToken = signHs256(
      {
        sub: session.userId,
        sid: session.sessionId,
        cnf: { jkt: session.jkt },
        iat: now,
        exp: now + this.opts.accessTtlSeconds,
      },
      this.opts.tokenSecret
    );
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshHash = sha256Hex(refreshToken);
    const next: ISessionRecord = {
      ...session,
      refreshHash,
      previousRefreshHash,
      lastActiveAt: this.opts.now(),
    };
    await this.setJson(
      key.session(session.sessionId),
      next,
      this.opts.refreshTtlSeconds
    );
    await this.opts.store.set(
      key.refresh(refreshHash),
      session.sessionId,
      this.opts.refreshTtlSeconds
    );
    return {
      accessToken,
      accessTokenExpiresIn: this.opts.accessTtlSeconds,
      refreshToken,
      refreshTokenExpiresIn: this.opts.refreshTtlSeconds,
      sessionId: session.sessionId,
    };
  }

  async verifyChallenge(
    params: { challengeId: string; signature: string },
    req: IDpopRequest
  ): Promise<ITokenResponse & { isNewUser: boolean }> {
    // Check everything before using up the challenge: a request that fails
    // here (a skewed clock, say) leaves it for a retry instead of making the
    // user confirm on the device again.
    const challengeKey = key.challenge(params.challengeId ?? '');
    const challenge = await this.getJson<IChallengeRecord>(challengeKey);
    if (!challenge || challenge.expiresAt < this.opts.now()) {
      throw unauthorized();
    }
    const jkt = await this.verifyDpop(req);
    if (jkt !== challenge.jkt) throw unauthorized();
    const signer = recoverBip137PublicKey(
      challenge.message,
      params.signature ?? ''
    );
    if (
      !signer ||
      (challenge.identityPublicKey && signer !== challenge.identityPublicKey)
    ) {
      throw unauthorized();
    }
    // One use only: a concurrent request may have taken it meanwhile.
    if (!(await this.takeJson<IChallengeRecord>(challengeKey))) {
      throw unauthorized();
    }

    const userId = hardwareUserId(signer);
    const isNewUser = await this.opts.users.ensureUser(userId);
    const now = this.opts.now();
    const session: ISessionRecord = {
      sessionId: randomUUID(),
      userId,
      jkt,
      refreshHash: '',
      revoked: false,
      createdAt: now,
      lastActiveAt: now,
    };
    const sessions =
      (await this.getJson<string[]>(key.userSessions(userId))) ?? [];
    await this.setJson(
      key.userSessions(userId),
      [...sessions, session.sessionId],
      this.opts.refreshTtlSeconds
    );
    return { ...(await this.issueTokens(session)), isNewUser };
  }

  private async revokeSession(sessionId: string) {
    const session = await this.getJson<ISessionRecord>(key.session(sessionId));
    if (!session || session.revoked) return;
    await this.opts.store.del(key.refresh(session.refreshHash));
    await this.setJson(
      key.session(sessionId),
      { ...session, revoked: true },
      this.opts.refreshTtlSeconds
    );
  }

  async refresh(
    params: { refreshToken: string },
    req: IDpopRequest
  ): Promise<ITokenResponse> {
    const hash = sha256Hex(params.refreshToken ?? '');
    const reusedSid = await this.opts.store.get(key.refreshUsed(hash));
    if (reusedSid) {
      const session = await this.getJson<ISessionRecord>(
        key.session(reusedSid)
      );
      if (!session || session.revoked) throw unauthorized();
      // An invalid proof (bad clock, malformed, replayed) shows nothing about
      // who holds the token, so it must not revoke the session.
      const jkt = await this.verifyDpop(req);
      // The reply carrying the current token can be lost (app killed, network
      // dropped). While that token is unused, its predecessor from the same
      // device key rotates again and the unused token dies. Not atomic on a
      // shared store; production must check and rotate in one step.
      if (jkt === session.jkt && session.previousRefreshHash === hash) {
        await this.retireRefreshToken(session, session.refreshHash);
        return this.issueTokens(session, hash);
      }
      // Another device key, or an older rotated-out token: treat the whole
      // session as stolen.
      await this.revokeSession(reusedSid);
      throw unauthorized();
    }
    const sid = await this.opts.store.get(key.refresh(hash));
    const session = sid
      ? await this.getJson<ISessionRecord>(key.session(sid))
      : undefined;
    if (!session || session.revoked || session.refreshHash !== hash) {
      throw unauthorized();
    }
    const jkt = await this.verifyDpop(req);
    if (jkt !== session.jkt) throw unauthorized();

    await this.retireRefreshToken(session, hash);
    return this.issueTokens(session, hash);
  }

  // Retired tokens stay known so a later use can be judged in refresh().
  private async retireRefreshToken(session: ISessionRecord, hash: string) {
    await this.opts.store.del(key.refresh(hash));
    await this.opts.store.set(
      key.refreshUsed(hash),
      session.sessionId,
      this.opts.refreshTtlSeconds
    );
  }

  /** Authenticates a resource request; returns the hardware user and session. */
  async authenticate(
    authorization: string | undefined,
    req: IDpopRequest
  ): Promise<{ userId: string; sessionId: string }> {
    const match = /^DPoP (.+)$/.exec(authorization ?? '');
    if (!match) throw unauthorized();
    const accessToken = match[1];
    const claims = verifyHs256(accessToken, this.opts.tokenSecret);
    if (
      !claims ||
      typeof claims.exp !== 'number' ||
      claims.exp <= this.nowSeconds()
    ) {
      throw unauthorized();
    }
    const session = await this.getJson<ISessionRecord>(
      key.session(claims.sid)
    );
    if (!session || session.revoked || session.userId !== claims.sub) {
      throw unauthorized();
    }
    const jkt = await this.verifyDpop(req, accessToken);
    if (jkt !== claims.cnf?.jkt || jkt !== session.jkt) throw unauthorized();
    return { userId: session.userId, sessionId: session.sessionId };
  }

  async listSessions(
    userId: string
  ): Promise<{ sessionId: string; revoked: boolean; createdAt: number }[]> {
    const ids = (await this.getJson<string[]>(key.userSessions(userId))) ?? [];
    const sessions = await Promise.all(
      ids.map(sid => this.getJson<ISessionRecord>(key.session(sid)))
    );
    return sessions
      .filter((s): s is ISessionRecord => !!s)
      .map(({ sessionId, revoked, createdAt }) => ({
        sessionId,
        revoked,
        createdAt,
      }));
  }

  async revoke(
    auth: { userId: string; sessionId: string },
    scope: 'current' | 'allExceptCurrent'
  ): Promise<{ revoked: number }> {
    if (scope === 'current') {
      await this.revokeSession(auth.sessionId);
      return { revoked: 1 };
    }
    if (scope !== 'allExceptCurrent') throw badRequest('Invalid scope');
    const sessions =
      (await this.getJson<string[]>(key.userSessions(auth.userId))) ?? [];
    const others = sessions.filter(sid => sid !== auth.sessionId);
    for (const sid of others) {
      await this.revokeSession(sid);
    }
    await this.setJson(
      key.userSessions(auth.userId),
      [auth.sessionId],
      this.opts.refreshTtlSeconds
    );
    return { revoked: others.length };
  }
}
