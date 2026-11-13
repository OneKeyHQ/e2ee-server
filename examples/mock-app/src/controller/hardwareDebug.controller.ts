import { Body, Controller, Get, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';

import { MongodbAdapterImpl } from '../adapter/mongodb.adapter';
import {
  HardwareAuthService,
  IHardwareSyncFaults,
} from '../service/hardwareAuth.service';

// Local-only: inspect hardware sync state and arm one-shot faults.
@Controller('/prime/v1/debug/hw-sync')
export class HardwareDebugController {
  @Inject()
  ctx!: Context;

  @Inject()
  hardwareAuth!: HardwareAuthService;

  @Inject()
  mongodbAdapter!: MongodbAdapterImpl;

  private enabled() {
    if (this.hardwareAuth.config?.enableDebugRoutes) return true;
    this.ctx.status = 404;
    return false;
  }

  @Get('/state')
  async state() {
    if (!this.enabled()) return null;
    const users = this.mongodbAdapter.debugUsers('Hardware:');
    const withSessions = await Promise.all(
      users.map(async user => ({
        ...user,
        sessions: await this.hardwareAuth.core.listSessions(user.userId),
      }))
    );
    return {
      code: 0,
      message: 'ok',
      data: { users: withSessions, faults: this.hardwareAuth.faults },
    };
  }

  @Post('/faults')
  async setFaults(@Body() body: IHardwareSyncFaults) {
    if (!this.enabled()) return null;
    this.hardwareAuth.faults = {
      flush: body?.flush,
      refresh: body?.refresh,
    };
    return { code: 0, message: 'ok', data: this.hardwareAuth.faults };
  }
}
