import { createApp, close } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';
import { PrimeSyncService } from '@onekeyhq/sync';

describe('Sync Mock App Tests', () => {
  let app: any;
  let syncService: PrimeSyncService;

  beforeAll(async () => {
    app = await createApp<Framework>();
    syncService = await app.getApplicationContext().getAsync(PrimeSyncService);
  });

  afterAll(async () => {
    await close(app);
  });

  it('should get lock item for user', async () => {
    const user = { userId: 'test-user-1' };
    const lockItem = await syncService.getLockItem(user);
    expect(lockItem).toBeDefined();
  });

  it('should change user lock', async () => {
    const user = { userId: 'test-user-1' };
    const lockData = {
      pwdHash: 'test-hash-123',
      lock: {
        encryptedPassword: 'encrypted-pwd',
        salt: 'salt-123',
      },
    };
    
    const result = await syncService.changeUserLock(user, lockData);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it('should check client data', async () => {
    const user = { userId: 'test-user-1' };
    const checkData = {
      pwdHash: 'test-hash-123',
      localData: [],
      onlyCheckLocalDataType: [],
    };
    
    const result = await syncService.checkClientData(user, checkData);
    expect(result).toBeDefined();
    expect(result.serverDataTimestamp).toBeDefined();
  });

  it('should download client info', async () => {
    const user = { userId: 'test-user-1', isPrime: true };
    const downloadData = {
      pwdHash: 'test-hash-123',
      skip: 0,
      limit: 10,
    };
    
    const result = await syncService.downloadClientInfo(user, downloadData);
    expect(result).toBeDefined();
    expect(result.dataList).toBeDefined();
    expect(Array.isArray(result.dataList)).toBe(true);
  });

  it('should upload client info', async () => {
    const user = { userId: 'test-user-1', isPrime: true };
    const uploadData = {
      pwdHash: 'test-hash-123',
      localData: [
        {
          key: 'test-key-1',
          dataType: 'settings',
          data: { test: 'data' },
          dataTimestamp: Date.now(),
          isDeleted: false,
        },
      ],
    };
    
    const result = await syncService.uploadClientInfo(user, uploadData);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it('should flush device data', async () => {
    const user = { userId: 'test-user-1' };
    const flushData = {
      pwdHash: 'new-hash-456',
      localData: [],
      lock: {
        encryptedPassword: 'new-encrypted-pwd',
        salt: 'new-salt-456',
      },
    };
    
    const result = await syncService.flushDeviceData(user, flushData);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});