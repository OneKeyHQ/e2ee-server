import { randomBytes } from 'crypto';
import { Config, Init, Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { IPrimeUser } from '@onekeyhq/cloud-sync-server';

import { MongodbAdapterImpl } from '../adapter/mongodb.adapter';
import { MemoryRedisAdapterImpl } from '../adapter/redis.adapter';
import {
  EHardwareAuthErrorCode,
  HardwareAuthCore,
  HardwareAuthError,
  IDpopRequest,
} from '../hardwareAuth/hardwareAuthCore';

export type IHardwareSyncConfig = {
  // Leave empty to generate a random secret per process.
  tokenSecret?: string;
  enableDebugRoutes?: boolean;
};

export type IHardwareSyncFaults = {
  // 'beforeWrite': fail without touching data. 'dropResponse': apply the flush,
  // then fail as if the response was lost.
  flush?: 'beforeWrite' | 'dropResponse';
  // 'fail': fail without rotating. 'dropResponse': rotate, then fail.
  refresh?: 'fail' | 'dropResponse';
};

@Provide()
@Scope(ScopeEnum.Singleton)
export class HardwareAuthService {
  @Inject()
  redisAdapter!: MemoryRedisAdapterImpl;

  @Inject()
  mongodbAdapter!: MongodbAdapterImpl;

  @Config('hardwareSync')
  config?: IHardwareSyncConfig;

  core!: HardwareAuthCore;

  // One-shot faults for local recovery tests; each is cleared once used.
  faults: IHardwareSyncFaults = {};

  takeFault<K extends keyof IHardwareSyncFaults>(
    name: K
  ): IHardwareSyncFaults[K] {
    const fault = this.faults[name];
    delete this.faults[name];
    return fault;
  }

  @Init()
  async init() {
    const secret = this.config?.tokenSecret
      ? Buffer.from(this.config.tokenSecret, 'utf8')
      : randomBytes(32);
    this.core = new HardwareAuthCore({
      store: this.redisAdapter,
      users: {
        ensureUser: userId => this.mongodbAdapter.createUserIfMissing(userId),
      },
      tokenSecret: secret,
      now: () => this.redisAdapter.now(),
    });
  }

  dpopRequest(ctx: Context): IDpopRequest {
    return {
      dpop: ctx.get('dpop') || undefined,
      htm: ctx.method,
      htu: `${ctx.protocol}://${ctx.host}${ctx.path}`,
    };
  }

  async authenticate(ctx: Context) {
    return this.core.authenticate(
      ctx.get('authorization') || undefined,
      this.dpopRequest(ctx)
    );
  }

  async loadSyncUser(userId: string): Promise<IPrimeUser> {
    const user = await this.mongodbAdapter.findUserById(userId);
    if (!user) {
      throw new HardwareAuthError(
        EHardwareAuthErrorCode.Unauthorized,
        401,
        'Unauthorized'
      );
    }
    return { userId, nonce: user.nonce ?? 0, pwdHash: user.pwdHash ?? '' };
  }
}
