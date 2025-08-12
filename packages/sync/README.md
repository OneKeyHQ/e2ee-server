# @onekey/sync-component

A reusable sync component for OneKey Prime subscription service.

## Installation

```bash
npm install @onekey/sync-component
```

## Usage

> **Note**: Example implementations are provided in the `src/adapter/` directory:
> - `mongodb.adapter.example.ts` - MongoDB adapter example
> - `kafka.adapter.example.ts` - Kafka adapter example  
> - `dependencies.provider.example.ts` - Dependencies provider example
>
> These are for reference only. You should implement your own adapters in your main application.

### 1. Configure the Sync Component

In your main application's configuration:

```typescript
// src/config/config.default.ts
import { MidwayConfig } from '@midwayjs/core';
import { MongodbAdapterImpl } from './adapters/mongodb.adapter';
import { KafkaAdapterImpl } from './adapters/kafka.adapter';

export default {
  sync: {
    enableCache: true,
    cachePrefix: 'sync:',
    cacheTTL: 300,
    adapters: {
      // Inject your MongoDB adapter implementation
      mongodbAdapter: new MongodbAdapterImpl(
        userModel,
        deviceModel,
        syncModel,
        syncHistoryModel,
        syncLockModel
      ),
      // Inject your Kafka adapter implementation
      kafkaAdapter: new KafkaAdapterImpl(kafkaClient),
    },
    dependenciesProvider: {
      updateUser: async (userId: string, data: any) => {
        // Your user update logic
      },
      getTraceHeaders: () => {
        // Return trace headers
        return {};
      },
      getErrors: () => {
        // Return custom error classes
        return {
          PrimeUserNonceInvalidError: CustomNonceError,
          PrimeUserPwdHashInvalidError: CustomPwdHashError,
        };
      },
    },
  },
} as MidwayConfig;
```

### 2. Implement the Adapters

Create adapter implementations in your main application:

```typescript
// src/adapters/mongodb.adapter.ts
import { Model } from 'mongoose';
import { IMongodbAdapter } from '@onekey/sync-component';

export class MongodbAdapterImpl implements IMongodbAdapter {
  constructor(
    private userModel: Model<any>,
    private deviceModel: Model<any>,
    private syncModel: Model<any>,
    private syncHistoryModel: Model<any>,
    private syncLockModel: Model<any>
  ) {}

  async findUserById(userId: string, fields?: Record<string, number>): Promise<any> {
    // Implementation using your models
    return this.userModel.findOne({ userId, deleted: false }, fields).lean();
  }

  // ... implement other methods as defined in IMongodbAdapter
}
```

```typescript
// src/adapters/kafka.adapter.ts
import { IKafkaAdapter, ISyncNotificationData } from '@onekey/sync-component';

export class KafkaAdapterImpl implements IKafkaAdapter {
  constructor(private kafkaClient: any) {}

  async sendPrimeNotification(data: ISyncNotificationData): Promise<void> {
    // Your Kafka implementation
    await this.kafkaClient.send({
      topic: 'prime-notifications',
      messages: [{ value: JSON.stringify(data) }],
    });
  }
}
```

### 3. Use the Sync Service

```typescript
import { Inject, Controller, Get } from '@midwayjs/core';
import { PrimeSyncService } from '@onekey/sync-component';

@Controller('/sync')
export class SyncController {
  @Inject()
  primeSyncService: PrimeSyncService;

  @Get('/data')
  async syncData(@Query() query: any) {
    return await this.primeSyncService.syncData(query);
  }
}
```

## Adapter Interfaces

### IMongodbAdapter

The MongoDB adapter must implement the following methods:

- `findUserById(userId, fields?)` - Find user by ID
- `findSyncDataByUserId(userId, condition?, fields?)` - Find sync data
- `findSyncDataWithPagination(userId, condition?, fields?, skip?, limit?)` - Find sync data with pagination
- `bulkWriteSyncData(operations)` - Bulk write sync data operations
- `deleteSyncDataByUserId(userId)` - Delete all sync data for a user
- `bulkWriteSyncHistory(userId, nonce, records)` - Bulk write sync history
- `findLockByUserId(userId, fields?)` - Find lock by user ID
- `upsertLock(userId, lock, nonce)` - Create or update lock
- `deleteLockByUserId(userId)` - Delete lock by user ID

### IKafkaAdapter

The Kafka adapter must implement:

- `sendPrimeNotification(data)` - Send prime notification to Kafka

## Benefits

This approach provides:

1. **Separation of Concerns**: The sync component doesn't depend on specific database implementations
2. **Testability**: Easy to mock adapters for testing
3. **Flexibility**: Main application can use any database or messaging system
4. **Type Safety**: Full TypeScript support with interfaces
5. **Reusability**: Can be used in different projects with different implementations