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
} from '@onekeyhq/cloud-sync-server';

@Controller('/sync')
export class SyncController {
  @Inject()
  syncService!: PrimeSyncService;

  @Post('/download')
  async downloadClientInfo(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncDownloadRequestDTO
  ) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, isPrime: true, nonce: 0 };
      return await this.syncService.downloadClientInfo(user, body);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Download failed',
      };
    }
  }

  @Post('/upload')
  async uploadClientInfo(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncUploadRequestDTO
  ) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, isPrime: true, nonce: 0 };
      return await this.syncService.uploadClientInfo(user, body);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  @Post('/check')
  async checkClientData(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncCheckRequestDTO
  ) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, nonce: 0 };
      return await this.syncService.checkClientData(user, body);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Check failed',
      };
    }
  }

  @Get('/lock')
  async getLockItem(@Query('userId') userId: string) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, nonce: 0 };
      return await this.syncService.getLockItem(user);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Get lock failed',
      };
    }
  }

  @Post('/lock')
  async changeLock(
    @Query('userId') userId: string,
    @Body() body: PrimeChangeLockRequestDTO
  ) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, nonce: 0 };
      return await this.syncService.changeUserLock(user, body);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Change lock failed',
      };
    }
  }

  @Post('/flush')
  async flushDeviceData(
    @Query('userId') userId: string,
    @Body() body: PrimeSyncFlushRequestDTO
  ) {
    try {
      if (!userId) {
        throw new Error('userId is required');
      }
      const user: IPrimeUser = { userId, nonce: 0 };
      return await this.syncService.flushDeviceData(user, body);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Flush failed',
      };
    }
  }
}