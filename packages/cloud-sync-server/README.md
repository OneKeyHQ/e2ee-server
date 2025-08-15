# @onekeyhq/cloud-sync-server

OneKey Prime Sync Component - A Midway.js-based component for data synchronization with MongoDB and Kafka support.

## Features

- **Midway.js Component Architecture**: Built as a reusable Midway.js component
- **Data Synchronization**: Efficient sync protocol for client-server data synchronization
- **MongoDB Integration**: Built-in MongoDB adapter for data persistence
- **Kafka Support**: Message queue integration for event-driven architecture
- **Dependency Injection**: Clean IoC container with dependency injection
- **Type Safety**: Full TypeScript implementation with DTOs
- **Extensible Design**: Adapter pattern for easy integration with different backends

## Installation

```bash
# Install dependencies
yarn install

# Build the component
yarn build
```

## Usage

### As a Midway.js Component

Import the component in your Midway.js application:

```typescript
// src/configuration.ts
import * as sync from '@onekeyhq/cloud-sync-server';

@Configuration({
  imports: [
    sync,
    // ... other components
  ],
})
export class MainConfiguration {
  // ...
}
```

### Configuration

Configure the component in your application's config file:

```typescript
// src/config/config.default.ts
export default {
  sync: {
    enableCache: true,
    cachePrefix: 'sync:',
    cacheTTL: 300,
    adapters: {
      mongodb: mongodbAdapter,
      kafka: kafkaAdapter,
    },
    dependenciesProvider: {
      updateUser: async (userId: string, data: any) => {
        // Your implementation
      },
      getTraceHeaders: () => ({
        // Your trace headers
      }),
      errors: {
        // Your error definitions
      },
    },
  },
};
```

## Architecture

### Component Structure

```
cloud-sync-server/
├── src/
│   ├── configuration.ts       # Component configuration
│   ├── service/
│   │   └── sync.service.ts   # Main sync service (PrimeSyncService)
│   ├── dto/
│   │   └── sync.dto.ts       # Data Transfer Objects
│   ├── interface/
│   │   ├── index.ts          # Main interfaces
│   │   ├── adapter.ts        # Adapter interfaces
│   │   └── config.ts         # Configuration interfaces
│   └── adapter/
│       ├── mongodb.adapter.ts # MongoDB adapter example
│       └── kafka.adapter.ts   # Kafka adapter example
├── test/
│   └── sync.test.ts          # Unit tests
├── package.json
└── tsconfig.json
```

### Core Components

#### PrimeSyncService

The main synchronization service that handles:
- Upload operations for client data
- Download operations for syncing to clients
- Conflict resolution
- Change locking mechanisms
- Flush operations

#### Data Transfer Objects (DTOs)

- `PrimeSyncUploadRequestDTO`: Client upload request structure
- `PrimeSyncDownloadRequestDTO`: Client download request structure
- `PrimeSyncCheckRequestDTO`: Sync status check request
- `PrimeChangeLockRequestDTO`: Lock management for concurrent updates
- `PrimeSyncFlushRequestDTO`: Flush operation request

#### Adapters

##### MongoDB Adapter
Handles data persistence with MongoDB:
- Document storage and retrieval
- Query optimization
- Index management
- Transaction support

##### Kafka Adapter
Manages event streaming:
- Event publishing
- Topic management
- Consumer group coordination
- Event replay capabilities

## API Reference

### Service Methods

#### `upload(params: PrimeSyncUploadRequestDTO): Promise<PrimeSyncUploadResponseDTO>`
Upload sync items from client to server.

```typescript
const result = await syncService.upload({
  items: [
    {
      id: 'item-1',
      data: { /* your data */ },
      version: 1,
      timestamp: Date.now(),
    },
  ],
  clientId: 'client-123',
});
```

#### `download(params: PrimeSyncDownloadRequestDTO): Promise<PrimeSyncDownloadResponseDTO>`
Download sync items from server to client.

```typescript
const result = await syncService.download({
  since: lastSyncTimestamp,
  clientId: 'client-123',
  limit: 100,
});
```

#### `check(params: PrimeSyncCheckRequestDTO): Promise<PrimeSyncCheckResponseDTO>`
Check synchronization status.

```typescript
const status = await syncService.check({
  clientId: 'client-123',
  items: ['item-1', 'item-2'],
});
```

#### `changeLock(params: PrimeChangeLockRequestDTO): Promise<void>`
Manage locks for concurrent updates.

```typescript
await syncService.changeLock({
  itemId: 'item-1',
  action: 'lock', // or 'unlock'
  clientId: 'client-123',
});
```

#### `flush(params: PrimeSyncFlushRequestDTO): Promise<void>`
Flush pending changes.

```typescript
await syncService.flush({
  clientId: 'client-123',
  force: true,
});
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

## Development

### Scripts

```bash
# Build TypeScript
yarn build

# Watch mode for development
yarn dev
yarn watch

# Run tests
yarn test
yarn test:watch
yarn test:cov

# Linting
yarn lint
yarn lint:fix
```

### Testing

The component includes comprehensive unit tests using Jest:

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Generate coverage report
yarn test:cov
```

Test files are located in the `test/` directory.

### Code Quality

ESLint is configured with TypeScript support:

```bash
# Check code style
yarn lint

# Auto-fix issues
yarn lint:fix
```

## Integration Examples

### With Midway.js Application

```typescript
import { Controller, Inject, Post, Body } from '@midwayjs/core';
import { PrimeSyncService } from '@onekeyhq/cloud-sync-server';

@Controller('/api/sync')
export class SyncController {
  @Inject()
  primeSyncService: PrimeSyncService;

  @Post('/upload')
  async upload(@Body() body: PrimeSyncUploadRequestDTO) {
    return await this.primeSyncService.upload(body);
  }

  @Post('/download')
  async download(@Body() body: PrimeSyncDownloadRequestDTO) {
    return await this.primeSyncService.download(body);
  }
}
```

### Custom Adapter Implementation

```typescript
import { IMongodbAdapter } from '@onekeyhq/cloud-sync-server';
import { Model } from 'mongoose';

export class MongodbAdapterImpl implements IMongodbAdapter {
  constructor(
    private userModel: Model<any>,
    private deviceModel: Model<any>,
    private syncModel: Model<any>,
    private syncHistoryModel: Model<any>,
    private syncLockModel: Model<any>
  ) {}

  async findUserById(userId: string, fields?: Record<string, number>): Promise<any> {
    return this.userModel.findOne({ userId, deleted: false }, fields).lean();
  }

  async findSyncDataByUserId(userId: string, condition?: any, fields?: Record<string, number>): Promise<any[]> {
    const query = { userId, deleted: false, ...condition };
    return this.syncModel.find(query, fields).lean();
  }

  // Implement other methods...
}
```

### Dependency Provider

```typescript
const dependenciesProvider: ISyncDependenciesProvider = {
  updateUser: async (userId: string, data: any) => {
    // Update user logic
  },
  getTraceHeaders: () => ({
    'x-request-id': generateRequestId(),
    'x-trace-id': generateTraceId(),
  }),
  errors: {
    NotFound: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NotFound';
      }
    },
    // Other error classes
  },
};
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableCache` | `boolean` | `false` | Enable caching mechanism |
| `cachePrefix` | `string` | `'sync:'` | Cache key prefix |
| `cacheTTL` | `number` | `300` | Cache TTL in seconds |
| `adapters` | `ISyncAdapters` | `undefined` | MongoDB and Kafka adapters |
| `dependenciesProvider` | `ISyncDependenciesProvider` | `undefined` | External dependencies |

## Error Handling

The component uses custom error classes for different scenarios:

- `NotFound`: Resource not found
- `Conflict`: Sync conflict detected
- `ValidationError`: Invalid input data
- `LockError`: Lock acquisition failed
- `TimeoutError`: Operation timeout

## Performance Considerations

1. **Caching**: Enable caching for frequently accessed data
2. **Batch Operations**: Use batch upload/download for better performance
3. **Indexing**: Ensure proper MongoDB indexes for query optimization
4. **Connection Pooling**: Configure appropriate connection pool sizes
5. **Pagination**: Use limit parameter in download operations

## Security

- Input validation using DTOs
- Authentication through dependency provider
- Rate limiting should be implemented at application level
- Sanitize all user inputs
- Use HTTPS in production

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check MongoDB connection string
   - Verify network connectivity
   - Ensure MongoDB is running

2. **Kafka Connection Issues**
   - Verify Kafka broker addresses
   - Check topic existence
   - Review consumer group configuration

3. **Sync Conflicts**
   - Implement proper conflict resolution strategy
   - Use versioning for items
   - Consider using locks for critical updates

4. **Performance Issues**
   - Enable caching
   - Optimize MongoDB queries
   - Use batch operations
   - Monitor memory usage

## Migration Guide

### From Version 0.x to 1.x

1. Update import statements
2. Migrate configuration format
3. Update adapter implementations
4. Review breaking changes in CHANGELOG

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`yarn test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

This project is part of the OneKey ecosystem.

## Support

For issues and questions, please open an issue on GitHub or contact the OneKey development team.