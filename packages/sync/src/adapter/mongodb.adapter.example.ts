import { Model } from 'mongoose';

import { IMongodbAdapter } from '../interface';

/**
 * Example implementation of IMongodbAdapter for the main application.
 * This should be implemented in the main application, not in the sync-component package.
 */
export class MongodbAdapterImpl implements IMongodbAdapter {
  constructor(
    private userModel: Model<any>,
    private deviceModel: Model<any>,
    private syncModel: Model<any>,
    private syncHistoryModel: Model<any>,
    private syncLockModel: Model<any>
  ) {}

  async findUserById(
    userId: string,
    fields?: Record<string, number>
  ): Promise<any> {
    return this.userModel
      .findOne(
        {
          userId,
          deleted: false,
        },
        fields
      )
      .lean();
  }

  getDeviceModel(): Model<any> {
    return this.deviceModel;
  }

  async findSyncDataByUserId(
    userId: string,
    condition: any = {},
    fields?: any
  ): Promise<any[]> {
    const query: any = {
      userId,
      ...condition,
    };

    if (fields) {
      return this.syncModel.find(query, fields).lean();
    }
    return this.syncModel.find(query).lean();
  }

  async findSyncDataWithPagination(
    userId: string,
    condition: any = {},
    fields?: any,
    skip?: number,
    limit?: number
  ): Promise<any[]> {
    const query: any = {
      userId,
      ...condition,
    };

    let dbQuery = this.syncModel.find(query, fields);

    if (typeof skip === 'number') {
      dbQuery = dbQuery.skip(skip);
    }

    if (typeof limit === 'number') {
      dbQuery = dbQuery.limit(limit);
    }

    return dbQuery.lean();
  }

  async bulkWriteSyncData(operations: any[]): Promise<{
    upsertedCount: number;
    modifiedCount: number;
  }> {
    if (!operations?.length) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }
    return this.syncModel.bulkWrite(operations);
  }

  async deleteSyncDataByUserId(userId: string): Promise<any> {
    return this.syncModel.deleteMany({ userId });
  }

  async bulkWriteSyncHistory(
    userId: string,
    nonce: number,
    records: any[]
  ): Promise<any> {
    const operations = records.map(b => ({
      updateOne: {
        filter: {
          key: b.key,
          userId,
          dataType: b.dataType,
          nonce,
        },
        update: {
          $set: {
            pwdHash: b.pwdHash,
            data: b.data,
            dataTimestamp: b.dataTimestamp,
            isDeleted: b.isDeleted,
          },
        },
        upsert: true,
      },
    }));

    if (!operations?.length) {
      return;
    }

    return this.syncHistoryModel.bulkWrite(operations);
  }

  async findLockByUserId(userId: string, fields?: any): Promise<any> {
    return this.syncLockModel.findOne({ userId }, fields).lean();
  }

  async upsertLock(userId: string, lock: any, nonce: number): Promise<any> {
    return this.syncLockModel.updateOne(
      { userId },
      {
        $set: {
          ...lock,
          userId,
          nonce,
        },
      },
      { upsert: true }
    );
  }

  async deleteLockByUserId(userId: string): Promise<any> {
    return this.syncLockModel.deleteMany({ userId });
  }
}
