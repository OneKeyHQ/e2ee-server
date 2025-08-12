import { createApp, close } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';
import { PrimeSyncService } from '@onekeyhq/cloud-sync-server';
import { MongodbAdapterImpl } from '../src/adapter/mongodb.adapter';

describe('Sync Mock App Tests', () => {
  let app: any;
  let syncService: PrimeSyncService;
  let mongodbAdapter: MongodbAdapterImpl;

  beforeAll(async () => {
    app = await createApp<Framework>();
    syncService = await app.getApplicationContext().getAsync(PrimeSyncService);
    mongodbAdapter = await app.getApplicationContext().getAsync(MongodbAdapterImpl);
  });

  afterAll(async () => {
    await close(app);
  });

  it('should get lock item for user', async () => {
    const user = { userId: 'test-user-1', nonce: 1 };
    const lockItem = await syncService.getLockItem(user);
    expect(lockItem).toBeDefined();
  });

  it('should change user lock', async () => {
    const user = { userId: 'test-user-1', nonce: 1, pwdHash: 'old-hash' };
    const lockData = {
      pwdHash: 'test-hash-123',
      lock: {
        key: 'lock',
        dataType: 'lock',
        data: JSON.stringify({
          encryptedPassword: 'encrypted-pwd',
          salt: 'salt-123',
        }),
        dataTimestamp: Date.now(),
      },
    };
    
    const result = await syncService.changeUserLock(user, lockData);
    expect(result).toBeDefined();
    expect(result.updated).toBeDefined();
  });

  it('should check client data', async () => {
    const user = { userId: 'test-user-1', nonce: 1 };
    const checkData = {
      nonce: 1,
      pwdHash: 'test-hash-123',
      localData: [],
      onlyCheckLocalDataType: [],
    };
    
    const result = await syncService.checkClientData(user, checkData);
    expect(result).toBeDefined();
    expect(result.diff).toBeDefined();
  });

  it('should download client info', async () => {
    const user = { userId: 'test-user-1', nonce: 1, isPrime: true };
    const downloadData = {
      pwdHash: 'test-hash-123',
      skip: 0,
      limit: 10,
    };
    
    const result = await syncService.downloadClientInfo(user, downloadData);
    expect(result).toBeDefined();
    expect(result.serverData).toBeDefined();
    expect(Array.isArray(result.serverData)).toBe(true);
  });

  it('should upload client info', async () => {
    // First, add some initial data to make sure server has data
    await mongodbAdapter.bulkWriteSyncData([
      {
        updateOne: {
          filter: { userId: 'test-user-1', key: 'initial-key', dataType: 'settings' },
          update: {
            $set: {
              data: JSON.stringify({ initial: 'data' }),
              dataTimestamp: Date.now() - 1000,
              nonce: 0,
              pwdHash: 'test-hash-123',
            },
          },
        },
      },
    ]);

    const user = { userId: 'test-user-1', nonce: 1, isPrime: true, pwdHash: 'test-hash-123' };
    const uploadData = {
      nonce: 1,
      pwdHash: 'test-hash-123',
      localData: [
        {
          key: 'test-key-1',
          dataType: 'settings',
          data: JSON.stringify({ test: 'data' }),
          dataTimestamp: Date.now(),
          isDeleted: false,
        },
      ],
    };
    
    const result = await syncService.uploadClientInfo(user, uploadData);
    expect(result).toBeDefined();
    expect(result.updated).toBeDefined();
  });

  it('should flush device data', async () => {
    const user = { userId: 'test-user-1', nonce: 1 };
    const flushData = {
      nonce: 1,
      pwdHash: 'new-hash-456',
      localData: [],
      lock: {
        key: 'lock',
        dataType: 'lock',
        data: JSON.stringify({
          encryptedPassword: 'new-encrypted-pwd',
          salt: 'new-salt-456',
        }),
        dataTimestamp: Date.now(),
      },
    };
    
    const result = await syncService.flushDeviceData(user, flushData);
    expect(result).toBeDefined();
    expect(result.updated).toBeDefined();
  });
});