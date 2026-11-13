import { Body, Controller, Get, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  IPrimeUser,
  PrimeSyncCheckRequestDTO,
  PrimeSyncDownloadRequestDTO,
  PrimeSyncFlushRequestDTO,
  PrimeSyncService,
  PrimeSyncUploadRequestDTO,
} from '@onekeyhq/cloud-sync-server';

import {
  HardwareAuthMiddleware,
  IHardwareAuthState,
} from '../middleware/hardwareAuth.middleware';
import { HardwareAuthService } from '../service/hardwareAuth.service';
import { injectedFailure, respond } from './apiResponse';

// Production-shaped sync routes guarded by hardware token auth.
@Controller('/prime/v1/sync', { middleware: [HardwareAuthMiddleware] })
export class PrimeSyncController {
  @Inject()
  ctx!: Context;

  @Inject()
  syncService!: PrimeSyncService;

  @Inject()
  hardwareAuth!: HardwareAuthService;

  private withUser<T>(run: (user: IPrimeUser) => Promise<T>) {
    return respond(this.ctx, async () => {
      const { userId } = this.ctx.state.hardwareAuth as IHardwareAuthState;
      return run(await this.hardwareAuth.loadSyncUser(userId));
    });
  }

  @Post('/download')
  async download(@Body() body: PrimeSyncDownloadRequestDTO) {
    return this.withUser(user => this.syncService.downloadClientInfo(user, body));
  }

  @Post('/upload')
  async upload(@Body() body: PrimeSyncUploadRequestDTO) {
    return this.withUser(user => this.syncService.uploadClientInfo(user, body));
  }

  @Post('/check')
  async check(@Body() body: PrimeSyncCheckRequestDTO) {
    return this.withUser(user => this.syncService.checkClientData(user, body));
  }

  @Get('/lock')
  async lock() {
    return this.withUser(user => this.syncService.getLockItem(user));
  }

  @Post('/flush')
  async flush(@Body() body: PrimeSyncFlushRequestDTO) {
    const fault = this.hardwareAuth.takeFault('flush');
    if (fault === 'beforeWrite') return injectedFailure(this.ctx);
    const result = await this.withUser(user =>
      this.syncService.flushDeviceData(user, body)
    );
    if (fault === 'dropResponse' && result.code === 0) {
      return injectedFailure(this.ctx);
    }
    return result;
  }
}
