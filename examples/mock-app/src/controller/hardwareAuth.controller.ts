import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';

import { HardwareAuthService } from '../service/hardwareAuth.service';
import { respond } from './apiResponse';

@Controller('/prime/v1/hw-sync/auth')
export class HardwareAuthController {
  @Inject()
  ctx!: Context;

  @Inject()
  hardwareAuth!: HardwareAuthService;

  @Post('/challenge')
  async challenge(@Body() body: { identityPublicKey: string; deviceKeyJwk: any }) {
    return respond(this.ctx, () =>
      this.hardwareAuth.core.createChallenge({
        identityPublicKey: body?.identityPublicKey,
        deviceKeyJwk: body?.deviceKeyJwk,
      })
    );
  }

  @Post('/verify')
  async verify(@Body() body: { challengeId: string; signature: string }) {
    return respond(this.ctx, () =>
      this.hardwareAuth.core.verifyChallenge(
        { challengeId: body?.challengeId, signature: body?.signature },
        this.hardwareAuth.dpopRequest(this.ctx)
      )
    );
  }

  @Post('/refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return respond(this.ctx, () =>
      this.hardwareAuth.core.refresh(
        { refreshToken: body?.refreshToken },
        this.hardwareAuth.dpopRequest(this.ctx)
      )
    );
  }

  @Post('/revoke')
  async revoke(@Body() body: { scope: 'current' | 'allExceptCurrent' }) {
    return respond(this.ctx, async () => {
      const auth = await this.hardwareAuth.authenticate(this.ctx);
      return this.hardwareAuth.core.revoke(auth, body?.scope);
    });
  }
}
