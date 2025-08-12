import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
} from '@midwayjs/core';
import {
  PrimeChangeLockRequestDTO,
  PrimeSyncCheckRequestDTO,
  PrimeSyncDownloadRequestDTO,
  PrimeSyncFlushRequestDTO,
  PrimeSyncService,
  PrimeSyncUploadRequestDTO,
  IPrimeUser,
} from '@onekeyhq/sync';

@Controller('/sync')
export class SyncController {
  @Inject()
  syncService!: PrimeSyncService;

  @Post('/download')
  async downloadClientInfo(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncDownloadRequestDTO
  ) {
    const user: IPrimeUser = { userId, isPrime: true, nonce: 0 };
    return this.syncService.downloadClientInfo(user, body);
  }

  @Post('/upload')
  async uploadClientInfo(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncUploadRequestDTO
  ) {
    const user: IPrimeUser = { userId, isPrime: true, nonce: 0 };
    return this.syncService.uploadClientInfo(user, body);
  }

  @Post('/check')
  async checkClientData(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncCheckRequestDTO
  ) {
    const user: IPrimeUser = { userId, nonce: 0 };
    return this.syncService.checkClientData(user, body);
  }

  @Get('/lock')
  async getLockItem(@Query('userId') userId: string) {
    const user: IPrimeUser = { userId, nonce: 0 };
    return this.syncService.getLockItem(user);
  }

  @Post('/lock')
  async changeLock(
    @Query('userId') userId: string,
    @Body() body: PrimeChangeLockRequestDTO
  ) {
    const user: IPrimeUser = { userId, nonce: 0 };
    return this.syncService.changeUserLock(user, body);
  }

  @Post('/flush')
  async flushDeviceData(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncFlushRequestDTO
  ) {
    const user: IPrimeUser = { userId, nonce: 0 };
    return this.syncService.flushDeviceData(user, body);
  }
}