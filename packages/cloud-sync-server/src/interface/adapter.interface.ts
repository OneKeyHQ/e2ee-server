export interface ISyncNotificationData {
  type: string;
  data: {
    lock?: any;
    nonce?: number;
    pwdHash?: string;
    serverData?: any[];
  };
  devices: string[];
}

export interface ISyncAdapters {
  mongodbAdapter: IMongodbAdapter;
  kafkaAdapter: IKafkaAdapter;
  redisAdapter?: IRedisAdapter;
}

export interface IMongodbAdapter {
  // User operations
  findUserById(userId: string, fields?: Record<string, number>): Promise<any>;

  // Device operations
  getDeviceModel(): any;

  // Sync data operations
  findSyncDataByUserId(
    userId: string,
    condition?: any,
    fields?: any
  ): Promise<any[]>;

  findSyncDataWithPagination(
    userId: string,
    condition?: any,
    fields?: any,
    skip?: number,
    limit?: number
  ): Promise<any[]>;

  bulkWriteSyncData(operations: any[]): Promise<{
    upsertedCount: number;
    modifiedCount: number;
  }>;

  deleteSyncDataByUserId(userId: string): Promise<any>;

  // Sync history operations
  bulkWriteSyncHistory(
    userId: string,
    nonce: number,
    records: any[]
  ): Promise<any>;

  // Lock operations
  findLockByUserId(userId: string, fields?: any): Promise<any>;

  upsertLock(userId: string, lock: any, nonce: number): Promise<any>;

  deleteLockByUserId(userId: string): Promise<any>;
}

export interface IKafkaAdapter {
  sendPrimeNotification(data: ISyncNotificationData): Promise<void>;
}

export interface IRedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
}
