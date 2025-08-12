import {
  PrimeSyncCheckRequestDTO,
  PrimeSyncDownloadRequestDTO,
  PrimeSyncFlushRequestDTO,
  PrimeSyncService,
  PrimeSyncUploadRequestDTO,
  ServerPrimeSyncItem,
} from '../src';

describe('PrimeSyncService Unit Tests', () => {
  let syncService: PrimeSyncService;
  let mongodbAdapter: any;
  let kafkaAdapter: any;
  let dependenciesProvider: any;

  // Mock error classes
  class PrimeUserNonceInvalidError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'PrimeUserNonceInvalidError';
    }
  }

  class PrimeUserPwdHashInvalidError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'PrimeUserPwdHashInvalidError';
    }
  }

  beforeEach(() => {
    mongodbAdapter = {
      findUserById: jest.fn(),
      findSyncDataByUserId: jest.fn(),
      findSyncDataWithPagination: jest.fn(),
      bulkWriteSyncData: jest.fn(),
      deleteSyncDataByUserId: jest.fn(),
      bulkWriteSyncHistory: jest.fn(),
      findLockByUserId: jest.fn(),
      upsertLock: jest.fn(),
      deleteLockByUserId: jest.fn(),
      getDeviceModel: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
    };

    kafkaAdapter = {
      sendPrimeNotification: jest.fn(),
    };

    dependenciesProvider = {
      updateUser: jest.fn(),
      getTraceHeaders: jest.fn().mockReturnValue({
        'x-onekey-instance-id': 'test-instance',
      }),
      getErrors: jest.fn().mockReturnValue({
        PrimeUserNonceInvalidError,
        PrimeUserPwdHashInvalidError,
      }),
    };

    syncService = new PrimeSyncService();
    syncService.setAdapters({
      kafkaAdapter,
      mongodbAdapter,
    } as any);
    syncService.setDependencies({
      updateUser: dependenciesProvider.updateUser,
      getTraceHeaders: dependenciesProvider.getTraceHeaders,
      errors: dependenciesProvider.getErrors(),
    });
    syncService['logger'] = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    } as any;
  });

  describe('checkClientData', () => {
    it('should throw error when pwdHash does not match', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncCheckRequestDTO = {
        pwdHash: 'hash2',
        localData: [],
        nonce: 0,
      };

      await expect(syncService.checkClientData(user, body)).rejects.toThrow(
        PrimeUserPwdHashInvalidError
      );
    });

    it('should return correct diff when server data is newer', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 1,
      };

      const serverData: ServerPrimeSyncItem[] = [
        {
          key: 'key1',
          userId: 'user1',
          dataType: 'Account',
          data: 'data1',
          dataTimestamp: 2000,
          isDeleted: false,
        } as any,
      ];

      const body: PrimeSyncCheckRequestDTO = {
        pwdHash: 'hash1',
        localData: [
          {
            key: 'key1',
            dataTimestamp: 1000,
            dataType: 'Account',
          },
        ],
        nonce: 1,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue(
        serverData
      );

      const result = await syncService.checkClientData(user, body);

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].key).toBe('key1');
      expect(result.obsoleted).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    });

    it('should handle deleted items correctly', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 1,
      };

      const serverData: ServerPrimeSyncItem[] = [
        {
          key: 'key1',
          userId: 'user1',
          dataType: 'Account',
          data: 'data1',
          dataTimestamp: 2000,
          isDeleted: true,
        } as any,
      ];

      const body: PrimeSyncCheckRequestDTO = {
        pwdHash: 'hash1',
        localData: [
          {
            key: 'key1',
            dataTimestamp: 1000,
            dataType: 'Account',
          },
        ],
        nonce: 1,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue(
        serverData
      );

      const result = await syncService.checkClientData(user, body);

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]).toBe('key1');
    });

    it('should skip onlyCheckLocalDataType when specified', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 1,
      };

      const serverData: ServerPrimeSyncItem[] = [
        {
          key: 'key1',
          userId: 'user1',
          dataType: 'Wallet',
          data: 'data1',
          dataTimestamp: 2000,
          isDeleted: false,
        } as any,
      ];

      const body: PrimeSyncCheckRequestDTO = {
        pwdHash: 'hash1',
        localData: [],
        nonce: 1,
        onlyCheckLocalDataType: ['Wallet'],
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue(
        serverData
      );

      const result = await syncService.checkClientData(user, body);

      expect(result.updated).toHaveLength(0);
    });
  });

  describe('uploadClientInfo', () => {
    it('should throw error when pwdHash is empty', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncUploadRequestDTO = {
        pwdHash: '',
        localData: [],
        nonce: 0,
      };

      await expect(syncService.uploadClientInfo(user, body)).rejects.toThrow(
        PrimeUserPwdHashInvalidError
      );
    });

    it('should throw error when server has no data', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncUploadRequestDTO = {
        pwdHash: 'hash1',
        localData: [],
        nonce: 0,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue([]);

      await expect(syncService.uploadClientInfo(user, body)).rejects.toThrow(
        PrimeUserPwdHashInvalidError
      );
    });

    it('should update data successfully when conditions are met', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const serverData: ServerPrimeSyncItem[] = [
        {
          key: 'key1',
          userId: 'user1',
          dataType: 'Account',
          data: 'oldData',
          dataTimestamp: 1000,
          isDeleted: false,
        } as any,
      ];

      const body: PrimeSyncUploadRequestDTO = {
        pwdHash: 'hash1',
        localData: [
          {
            key: 'key1',
            dataType: 'Account',
            data: 'newData',
            dataTimestamp: 2000,
            isDeleted: false,
          },
        ],
        nonce: 0,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue(
        serverData
      );
      (mongodbAdapter.bulkWriteSyncData as jest.Mock).mockResolvedValue({
        upsertedCount: 0,
        modifiedCount: 1,
      });
      (mongodbAdapter.bulkWriteSyncHistory as jest.Mock).mockResolvedValue(
        undefined
      );
      (mongodbAdapter.findUserById as jest.Mock).mockResolvedValue({
        isPrime: true,
      });

      const result = await syncService.uploadClientInfo(user, body);

      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.nonce).toBe(1);
      expect(mongodbAdapter.bulkWriteSyncHistory).toHaveBeenCalled();
      expect(dependenciesProvider.updateUser).toHaveBeenCalledWith('user1', {
        nonce: 1,
      });
    });
  });

  describe('flushDeviceData', () => {
    it('should throw error when localData exists but pwdHash is empty', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncFlushRequestDTO = {
        pwdHash: '',
        localData: [
          {
            key: 'key1',
            dataType: 'Account',
            data: 'data1',
            dataTimestamp: 1000,
            isDeleted: false,
          },
        ],
        nonce: 0,
      };

      await expect(syncService.flushDeviceData(user, body)).rejects.toThrow(
        PrimeUserPwdHashInvalidError
      );
    });

    it('should clear all data when pwdHash and localData are empty', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncFlushRequestDTO = {
        pwdHash: '',
        localData: [],
        nonce: 0,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue([]);
      (mongodbAdapter.deleteSyncDataByUserId as jest.Mock).mockResolvedValue(
        undefined
      );
      (mongodbAdapter.deleteLockByUserId as jest.Mock).mockResolvedValue(
        undefined
      );
      (mongodbAdapter.findUserById as jest.Mock).mockResolvedValue({
        isPrime: true,
      });

      const result = await syncService.flushDeviceData(user, body);

      expect(result.nonce).toBe(1);
      expect(result.pwdHash).toBe('');
      expect(mongodbAdapter.deleteLockByUserId).toHaveBeenCalledWith('user1');
    });

    it('should flush data with new pwdHash and lock', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'oldHash',
        nonce: 0,
      };

      const lock = {
        key: 'lockKey',
        dataType: 'Lock',
        data: 'lockData',
        dataTimestamp: 1000,
        isDeleted: false,
      };

      const body: PrimeSyncFlushRequestDTO = {
        pwdHash: 'newHash',
        localData: [
          {
            key: 'key1',
            dataType: 'Account',
            data: 'data1',
            dataTimestamp: 1000,
            isDeleted: false,
          },
        ],
        lock,
        nonce: 0,
      };

      (mongodbAdapter.findSyncDataByUserId as jest.Mock).mockResolvedValue([]);
      (mongodbAdapter.upsertLock as jest.Mock).mockResolvedValue(undefined);
      (mongodbAdapter.deleteSyncDataByUserId as jest.Mock).mockResolvedValue(
        undefined
      );
      (mongodbAdapter.bulkWriteSyncData as jest.Mock).mockResolvedValue({
        upsertedCount: 1,
        modifiedCount: 0,
      });
      (mongodbAdapter.findUserById as jest.Mock).mockResolvedValue({
        isPrime: true,
      });

      const result = await syncService.flushDeviceData(user, body);

      expect(result.created).toBe(1);
      expect(result.nonce).toBe(1);
      expect(result.pwdHash).toBe('newHash');
      expect(mongodbAdapter.upsertLock).toHaveBeenCalledWith('user1', lock, 0);
      expect(dependenciesProvider.updateUser).toHaveBeenCalledWith('user1', {
        nonce: 1,
        pwdHash: 'newHash',
      });
    });
  });

  describe('downloadClientInfo', () => {
    it('should download data with pagination', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncDownloadRequestDTO = {
        pwdHash: 'hash1',
        skip: 10,
        limit: 20,
      };

      const serverData = [
        {
          key: 'key1',
          data: 'data1',
          dataTimestamp: 1000,
          dataType: 'Account',
          isDeleted: false,
        },
      ];

      (
        mongodbAdapter.findSyncDataWithPagination as jest.Mock
      ).mockResolvedValue(serverData);

      const result = await syncService.downloadClientInfo(user, body);

      expect(result.serverData).toEqual(serverData);
      expect(mongodbAdapter.findSyncDataWithPagination).toHaveBeenCalledWith(
        'user1',
        { isDeleted: false },
        {
          key: 1,
          data: 1,
          dataTimestamp: 1,
          dataType: 1,
          isDeleted: 1,
        },
        10,
        20
      );
    });

    it('should include deleted items when specified', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'hash1',
        nonce: 0,
      };

      const body: PrimeSyncDownloadRequestDTO = {
        pwdHash: 'hash1',
        includeDeleted: true,
      };

      const serverData = [
        {
          key: 'key1',
          data: 'data1',
          dataTimestamp: 1000,
          dataType: 'Account',
          isDeleted: true,
        },
      ];

      (
        mongodbAdapter.findSyncDataWithPagination as jest.Mock
      ).mockResolvedValue(serverData);

      const result = await syncService.downloadClientInfo(user, body);

      expect(result.serverData).toEqual(serverData);
      expect(mongodbAdapter.findSyncDataWithPagination).toHaveBeenCalledWith(
        'user1',
        {},
        {
          key: 1,
          data: 1,
          dataTimestamp: 1,
          dataType: 1,
          isDeleted: 1,
        },
        undefined,
        undefined
      );
    });
  });

  describe('changeUserLock', () => {
    it('should update lock and pwdHash', async () => {
      const user = {
        userId: 'user1',
        pwdHash: 'oldHash',
        nonce: 0,
      };

      const body = {
        lock: {
          key: 'lockKey',
          dataType: 'Lock',
          data: 'lockData',
          dataTimestamp: 1000,
          isDeleted: false,
        },
        pwdHash: 'newHash',
      };

      (mongodbAdapter.upsertLock as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });
      (mongodbAdapter.findUserById as jest.Mock).mockResolvedValue({
        isPrime: true,
      });

      const result = await syncService.changeUserLock(user, body);

      expect(result.updated).toBe(1);
      expect(mongodbAdapter.upsertLock).toHaveBeenCalledWith(
        'user1',
        body.lock,
        0
      );
      expect(dependenciesProvider.updateUser).toHaveBeenCalledWith('user1', {
        pwdHash: 'newHash',
      });
    });
  });

  describe('getLockItem', () => {
    it('should return lock item for user', async () => {
      const user = {
        userId: 'user1',
        nonce: 0,
        pwdHash: 'hash1',
      };

      const lockData = {
        key: 'lockKey',
        userId: 'user1',
        data: 'lockData',
        dataTimestamp: 1000,
        dataType: 'Lock',
        pwdHash: 'hash1',
      };

      (mongodbAdapter.findLockByUserId as jest.Mock).mockResolvedValue(
        lockData
      );

      const result = await syncService.getLockItem(user);

      expect(result.lock).toEqual(lockData);
      expect(mongodbAdapter.findLockByUserId).toHaveBeenCalledWith('user1', {
        key: 1,
        userId: 1,
        data: 1,
        dataTimestamp: 1,
        dataType: 1,
        pwdHash: 1,
      });
    });

    it('should return null when no lock exists', async () => {
      const user = {
        userId: 'user1',
        nonce: 0,
        pwdHash: 'hash1',
      };

      (mongodbAdapter.findLockByUserId as jest.Mock).mockResolvedValue(null);

      const result = await syncService.getLockItem(user);

      expect(result.lock).toBeNull();
    });
  });
});
