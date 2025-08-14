import {
  Config,
  Inject,
  Logger,
  Provide,
  Scope,
  ScopeEnum,
} from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { isEmpty, keyBy, pick } from 'lodash';

import {
  PrimeChangeLockRequestDTO,
  PrimeSyncCheckRequestDTO,
  PrimeSyncCheckResponseDTO,
  PrimeSyncDownloadRequestDTO,
  PrimeSyncDownloadResponseDTO,
  PrimeSyncFlushRequestDTO,
  PrimeSyncUploadItem,
  PrimeSyncUploadRequestDTO,
  PrimeSyncUploadResponseDTO,
  ServerPrimeSyncItem,
} from '../dto/sync.dto';
import {
  IPrimeUser,
  ISyncAdapters,
  ISyncDependenciesProvider,
  ISyncErrors,
  ITraceHeaders,
} from '../interface';

const SYNC_ADAPTERS_KEY = 'sync:adapters';
const SYNC_DEPENDENCIES_PROVIDER_KEY = 'sync:dependenciesProvider';

export interface IBasicAuthParams {
  token: string;
  instanceId: string;
}

export enum EPrimeNotificationEvent {
  CONFIG_CHANGE = 'CONFIG_CHANGE',
  CONFIG_FLUSH = 'CONFIG_FLUSH',
  LOCK_CHANGE = 'LOCK_CHANGE',
}

// Keep for backward compatibility
export interface ISyncServiceDependencies {
  updateUser(userId: string, data: any): Promise<void>;
  getTraceHeaders(): ITraceHeaders;
  errors: ISyncErrors;
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class PrimeSyncService {
  @Logger()
  private logger: ILogger;

  @Config('sync')
  cfg: any;

  @Inject(SYNC_ADAPTERS_KEY)
  private adapters: ISyncAdapters;

  // For testing - allow setting adapters directly
  public setAdapters(adapters: ISyncAdapters) {
    this.adapters = adapters;
  }

  @Inject(SYNC_DEPENDENCIES_PROVIDER_KEY)
  private dependenciesProvider: ISyncDependenciesProvider;

  private dependencies: ISyncServiceDependencies;

  // Keep for backward compatibility
  public setDependencies(deps: ISyncServiceDependencies) {
    this.dependencies = deps;
  }

  private getDependencies(): ISyncServiceDependencies {
    // Use provider if available, otherwise fall back to manually set dependencies
    if (this.dependenciesProvider) {
      const errors = this.dependenciesProvider.getErrors();
      return {
        updateUser: (userId: string, data: any) =>
          this.dependenciesProvider.updateUser(userId, data),
        getTraceHeaders: () => this.dependenciesProvider.getTraceHeaders(),
        errors: errors,
      };
    }
    return this.dependencies;
  }

  private async getDeviceModel() {
    return this.adapters.mongodbAdapter.getDeviceModel();
  }

  private async backupUserRecords(
    userId: string,
    nonce: number,
    backupRecords: ServerPrimeSyncItem[]
  ) {
    // Validate inputs
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId');
    }
    if (typeof nonce !== 'number' || nonce < 0) {
      throw new Error('Invalid nonce');
    }
    if (!backupRecords?.length) {
      return;
    }
    return this.adapters.mongodbAdapter
      .bulkWriteSyncHistory(userId, nonce, backupRecords)
      .catch(e => {
        this.logger.error(
          `[PrimeSyncService.syncHistory] save history failed, userId=${userId}, nonce=${nonce}`,
          e
        );
      });
  }

  private async sendChangeNotification(params: {
    user: IPrimeUser;
    changedRecords?: PrimeSyncUploadItem[];
    nonce?: number;
    pwdHash: string;
    instanceId: string;
    lock?: PrimeSyncUploadItem;
    type: EPrimeNotificationEvent;
  }) {
    const { type, user, changedRecords, nonce, instanceId, lock, pwdHash } =
      params;
    
    // Validate required parameters
    if (!user?.userId) {
      throw new Error('Invalid user');
    }
    if (!instanceId || typeof instanceId !== 'string') {
      throw new Error('Invalid instanceId');
    }

    const dbUser = (await this.adapters.mongodbAdapter.findUserById(
      user.userId,
      {
        isPrime: 1,
      }
    )) as any;

    if (!dbUser?.isPrime) {
      return false;
    }

    const deviceModel = await this.getDeviceModel();
    const userDevices = await deviceModel
      .find(
        {
          userId: user.userId,
          instanceId: {
            $ne: instanceId,
          },
        },
        {
          _id: 0,
          instanceId: 1,
        }
      )
      .lean();

    const instanceIds = userDevices.map(u => u.instanceId);

    if (!instanceIds.length) {
      return false;
    }

    await this.adapters.kafkaAdapter.sendPrimeNotification({
      type,
      data: {
        lock,
        nonce,
        pwdHash,
        serverData: changedRecords,
      },
      devices: instanceIds,
    });
    return true;
  }

  private async doUpdateUserSyncRecords({
    body,
    user,
    backupRecords,
    lock,
    isFlush,
  }: {
    user: IPrimeUser;
    body: PrimeSyncUploadRequestDTO;
    backupRecords: ServerPrimeSyncItem[];
    lock?: PrimeSyncUploadItem;
    isFlush: boolean;
  }) {
    const updates: any[] = [];
    const changedRecords: PrimeSyncUploadItem[] = [];

    if (body.nonce > user.nonce) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserNonceInvalidError('', {
        cause: {
          a: body.nonce,
          b: user.nonce,
        },
      });
    }

    const result = {
      updated: 0,
      created: 0,
      nonce: user.nonce,
      pwdHash: user.pwdHash,
    };

    for (const d of body.localData) {
      // Validate each record
      if (!d.key || typeof d.key !== 'string') {
        throw new Error('Invalid key in localData');
      }
      if (!d.dataType || typeof d.dataType !== 'string') {
        throw new Error('Invalid dataType in localData');
      }
      if (typeof d.dataTimestamp !== 'number' || d.dataTimestamp < 0) {
        throw new Error('Invalid dataTimestamp in localData');
      }
      
      const record = {
        key: d.key,
        userId: user.userId,
        dataType: d.dataType,
        data: d.data,
        dataTimestamp: d.dataTimestamp,
        isDeleted: d.isDeleted,
        nonce: user.nonce,
      };
      if (!isFlush) {
        changedRecords.push(record);
      }
      updates.push({
        updateOne: {
          filter: pick(record, 'key', 'userId', 'dataType'),
          $expr: {
            $gte: [d.dataTimestamp, '$dataTimestamp'],
          },
          update: {
            $set: pick(record, 'data', 'dataTimestamp', 'isDeleted', 'nonce'),
          },
          upsert: true,
        },
      });
    }

    if (!isFlush && !updates.length) {
      return result;
    }

    const $set = {};

    if (backupRecords?.length) {
      await this.backupUserRecords(user.userId, body.nonce, backupRecords);
    }

    result.nonce = user.nonce + 1;

    if (isFlush) {
      result.pwdHash = body.pwdHash ? body.pwdHash : '';
      await this.adapters.mongodbAdapter.deleteSyncDataByUserId(user.userId);
    }

    if (updates.length) {
      if (user.nonce !== result.nonce) {
        Object.assign($set, { nonce: result.nonce });
      }
      const res = await this.adapters.mongodbAdapter.bulkWriteSyncData(updates);
      result.created = res.upsertedCount;
      result.updated = res.modifiedCount;
    }

    if (isFlush && user.pwdHash !== result.pwdHash) {
      Object.assign($set, { pwdHash: result.pwdHash });
    }

    if (!isEmpty($set)) {
      await this.getDependencies().updateUser(user.userId, $set);
    }

    if (isFlush || changedRecords?.length) {
      const headers = this.getDependencies().getTraceHeaders();
      await this.sendChangeNotification({
        lock,
        user,
        changedRecords,
        nonce: result.nonce,
        pwdHash: result.pwdHash,
        instanceId: headers['x-onekey-instance-id'],
        type: isFlush
          ? EPrimeNotificationEvent.CONFIG_FLUSH
          : EPrimeNotificationEvent.CONFIG_CHANGE,
      });
    }

    return result;
  }

  async changeUserLock(
    user: IPrimeUser,
    body: PrimeChangeLockRequestDTO
  ): Promise<Pick<PrimeSyncUploadResponseDTO, 'updated'>> {
    const res = await this.adapters.mongodbAdapter.upsertLock(
      user.userId,
      body.lock,
      user.nonce
    );
    await this.getDependencies().updateUser(user.userId, {
      pwdHash: body.pwdHash,
    });

    const headers = this.getDependencies().getTraceHeaders();
    await this.sendChangeNotification({
      user,
      lock: body.lock,
      pwdHash: body.pwdHash,
      instanceId: headers['x-onekey-instance-id'],
      type: EPrimeNotificationEvent.LOCK_CHANGE,
    });

    return {
      updated: res.modifiedCount,
    };
  }

  async flushDeviceData(
    user: IPrimeUser,
    body: PrimeSyncFlushRequestDTO
  ): Promise<PrimeSyncUploadResponseDTO> {
    const isPwdHashExist = body.pwdHash && body.lock;
    if (!isPwdHashExist && body.localData?.length) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserPwdHashInvalidError('', {
        cause: {
          pwdHash: body.pwdHash,
          data: body.localData?.length,
        },
      });
    }

    if (body.lock) {
      await this.adapters.mongodbAdapter.upsertLock(
        user.userId,
        body.lock,
        user.nonce
      );
    }

    if (!body.localData.length && !body.pwdHash && !body.lock) {
      await this.adapters.mongodbAdapter.deleteLockByUserId(user.userId);
    }

    const serverData = (await this.adapters.mongodbAdapter.findSyncDataByUserId(
      user.userId
    )) as unknown as ServerPrimeSyncItem[];

    const backupRecords = serverData;
    return await this.doUpdateUserSyncRecords({
      body,
      user: user,
      backupRecords,
      lock: body.lock,
      isFlush: true,
    });
  }

  async uploadClientInfo(
    user: IPrimeUser,
    body: PrimeSyncUploadRequestDTO
  ): Promise<PrimeSyncUploadResponseDTO> {
    if (!user.pwdHash || user.pwdHash !== body.pwdHash) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserPwdHashInvalidError('', {
        cause: {
          a: user.pwdHash,
          b: body.pwdHash,
          localData: body.localData?.length,
        },
      });
    }

    const serverData = await this.adapters.mongodbAdapter.findSyncDataByUserId(
      user.userId
    );

    if (!serverData?.length) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserPwdHashInvalidError('', {
        cause: {
          a: user.pwdHash,
          b: body.pwdHash,
          serverData: serverData?.length,
        },
      });
    }
    const serverDataMap = keyBy(serverData, d => d.key);

    const backupRecords = body.localData
      .map(d => {
        const sdata = serverDataMap[d.key];
        if (sdata) {
          if (d.dataTimestamp > (sdata as any).dataTimestamp) {
            return sdata;
          }
        }
        return null;
      })
      .filter(Boolean) as unknown as ServerPrimeSyncItem[];

    return this.doUpdateUserSyncRecords({
      body,
      user: user,
      backupRecords,
      isFlush: false,
    });
  }

  async downloadClientInfo(
    user: IPrimeUser,
    body: PrimeSyncDownloadRequestDTO
  ): Promise<PrimeSyncDownloadResponseDTO> {
    if (user.pwdHash && user.pwdHash !== body.pwdHash) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserPwdHashInvalidError('', {
        cause: {
          a: user.pwdHash,
          b: body.pwdHash,
        },
      });
    }

    const condition: any = {
      isDeleted: false,
    };

    if (body.includeDeleted) {
      delete condition['isDeleted'];
    }

    const res = (await this.adapters.mongodbAdapter.findSyncDataWithPagination(
      user.userId,
      condition,
      {
        key: 1,
        data: 1,
        dataTimestamp: 1,
        dataType: 1,
        isDeleted: 1,
      },
      body.skip,
      body.limit
    )) as unknown as ServerPrimeSyncItem[];

    return {
      serverData: res,
    };
  }

  async checkClientData(
    user: IPrimeUser,
    body: PrimeSyncCheckRequestDTO
  ): Promise<PrimeSyncCheckResponseDTO> {
    if (user.pwdHash && user.pwdHash !== body.pwdHash) {
      const deps = this.getDependencies();
      throw new deps.errors.PrimeUserPwdHashInvalidError('', {
        cause: {
          a: user.pwdHash,
          b: body.pwdHash,
        },
      });
    }

    const serverData = (await this.adapters.mongodbAdapter.findSyncDataByUserId(
      user.userId,
      {},
      {
        key: 1,
        dataTimestamp: 1,
        isDeleted: 1,
        data: 1,
        dataType: 1,
      }
    )) as unknown as ServerPrimeSyncItem[];

    const serverDataMap = keyBy(serverData, d => d.key);
    const clientDataMap = keyBy(body.localData, c => c.key);

    const onlyCheckLocalDataTypeSet = new Set(
      body.onlyCheckLocalDataType ?? []
    );

    const res: PrimeSyncCheckResponseDTO = {
      deleted: [],
      obsoleted: [],
      diff: [],
      updated: [],
      nonce: user.nonce,
    };

    if (body.nonce <= user.nonce) {
      for (const { key } of body.localData) {
        const sdata = serverDataMap[key];
        if (!sdata) {
          res.obsoleted.push(key);
          continue;
        }
      }
    }

    for (const item of serverData) {
      const { key, dataTimestamp, isDeleted, dataType } = item;
      const c = clientDataMap[key];

      if (!c) {
        if (onlyCheckLocalDataTypeSet.has(dataType)) {
          continue;
        }
        if (item.isDeleted) {
          continue;
        }
        res.updated.push(item);
        continue;
      }

      if (typeof c.dataTimestamp !== 'number') {
        res.diff.push(item);
        continue;
      }

      if (c.dataTimestamp > dataTimestamp) {
        res.obsoleted.push(key);
        continue;
      }

      if (c.dataTimestamp < dataTimestamp) {
        if (isDeleted) {
          if (!clientDataMap[c.key]) {
            continue;
          }
          res.deleted.push(c.key);
          continue;
        }
        res.updated.push(item);
        continue;
      }
    }

    return res;
  }

  async getLockItem(user: IPrimeUser): Promise<{
    lock: ServerPrimeSyncItem | null;
  }> {
    const data = (await this.adapters.mongodbAdapter.findLockByUserId(
      user.userId,
      {
        key: 1,
        userId: 1,
        data: 1,
        dataTimestamp: 1,
        dataType: 1,
        pwdHash: 1,
      }
    )) as unknown as ServerPrimeSyncItem | null;

    return {
      lock: data,
    };
  }
}
