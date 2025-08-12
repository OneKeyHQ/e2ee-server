import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { IMongodbAdapter } from '@onekeyhq/sync';

@Provide()
@Scope(ScopeEnum.Singleton)
export class MongodbAdapterImpl implements IMongodbAdapter {
  private syncData: Map<string, any[]> = new Map();
  private lockData: Map<string, any> = new Map();
  private historyData: Map<string, any[]> = new Map();
  private userData: Map<string, any> = new Map();

  constructor() {
    this.userData.set('test-user-1', {
      userId: 'test-user-1',
      email: 'user1@example.com',
      isPrime: true,
      deleted: false,
    });
    this.userData.set('test-user-2', {
      userId: 'test-user-2',
      email: 'user2@example.com',
      isPrime: true,
      deleted: false,
    });
  }

  async findUserById(userId: string, fields?: Record<string, number>): Promise<any> {
    const user = this.userData.get(userId);
    if (!user || user.deleted) return null;
    
    if (fields) {
      const result: any = {};
      Object.keys(fields).forEach(key => {
        if (fields[key] === 1 && user[key] !== undefined) {
          result[key] = user[key];
        }
      });
      return result;
    }
    return user;
  }

  getDeviceModel(): any {
    return {
      find: () => ({
        lean: () => Promise.resolve([]),
      }),
    };
  }

  async findSyncDataByUserId(
    userId: string,
    condition: any = {},
    fields?: any
  ): Promise<any[]> {
    const userSyncData = this.syncData.get(userId) || [];
    
    return userSyncData.filter(item => {
      for (const key in condition) {
        if (condition[key] !== item[key]) {
          return false;
        }
      }
      return true;
    });
  }

  async findSyncDataWithPagination(
    userId: string,
    condition: any = {},
    fields?: any,
    skip?: number,
    limit?: number
  ): Promise<any[]> {
    const allData = await this.findSyncDataByUserId(userId, condition, fields);
    
    let result = allData;
    if (typeof skip === 'number') {
      result = result.slice(skip);
    }
    if (typeof limit === 'number') {
      result = result.slice(0, limit);
    }
    
    return result;
  }

  async bulkWriteSyncData(operations: any[]): Promise<{
    upsertedCount: number;
    modifiedCount: number;
  }> {
    if (!operations?.length) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    let upsertedCount = 0;
    let modifiedCount = 0;

    operations.forEach(op => {
      if (op.updateOne) {
        const { filter, update } = op.updateOne;
        const userId = filter.userId;
        
        if (!this.syncData.has(userId)) {
          this.syncData.set(userId, []);
        }
        
        const userSyncData = this.syncData.get(userId)!;
        const existingIndex = userSyncData.findIndex(item => 
          item.key === filter.key && item.dataType === filter.dataType
        );
        
        if (existingIndex >= 0) {
          userSyncData[existingIndex] = { ...userSyncData[existingIndex], ...update.$set };
          modifiedCount++;
        } else {
          userSyncData.push({ ...filter, ...update.$set });
          upsertedCount++;
        }
      }
    });

    return { upsertedCount, modifiedCount };
  }

  async deleteSyncDataByUserId(userId: string): Promise<any> {
    const deletedCount = this.syncData.get(userId)?.length || 0;
    this.syncData.delete(userId);
    return { deletedCount };
  }

  async bulkWriteSyncHistory(
    userId: string,
    nonce: number,
    records: any[]
  ): Promise<any> {
    if (!records?.length) return;
    
    const key = `${userId}-${nonce}`;
    if (!this.historyData.has(key)) {
      this.historyData.set(key, []);
    }
    
    const history = this.historyData.get(key)!;
    records.forEach(record => {
      const existingIndex = history.findIndex(h => 
        h.key === record.key && h.dataType === record.dataType
      );
      
      if (existingIndex >= 0) {
        history[existingIndex] = { ...record, userId, nonce };
      } else {
        history.push({ ...record, userId, nonce });
      }
    });
  }

  async findLockByUserId(userId: string, fields?: any): Promise<any> {
    return this.lockData.get(userId) || null;
  }

  async upsertLock(userId: string, lock: any, nonce: number): Promise<any> {
    this.lockData.set(userId, { ...lock, userId, nonce });
    return { acknowledged: true };
  }

  async deleteLockByUserId(userId: string): Promise<any> {
    const existed = this.lockData.has(userId);
    this.lockData.delete(userId);
    return { deletedCount: existed ? 1 : 0 };
  }
}