import { IMiddleware, Inject, Middleware } from '@midwayjs/core';
import { Context, NextFunction } from '@midwayjs/koa';

import { HardwareAuthError } from '../hardwareAuth/hardwareAuthCore';
import { HardwareAuthService } from '../service/hardwareAuth.service';

export type IHardwareAuthState = { userId: string; sessionId: string };

// Runs before parameter validation, so unauthenticated calls always get 401.
@Middleware()
export class HardwareAuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Inject()
  hardwareAuth!: HardwareAuthService;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      try {
        ctx.state.hardwareAuth = (await this.hardwareAuth.authenticate(
          ctx
        )) as IHardwareAuthState;
      } catch (error) {
        if (!(error instanceof HardwareAuthError)) throw error;
        ctx.status = error.status;
        ctx.body = { code: error.code, message: error.message, data: null };
        return;
      }
      await next();
    };
  }

  static getName() {
    return 'hardwareAuth';
  }
}
