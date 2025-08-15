# @onekeyhq/mock-app

Mock application for testing and demonstrating the OneKey Cloud Sync Server component integration.

## Overview

This is a sample Midway.js application that demonstrates how to integrate and use the `@onekeyhq/cloud-sync-server` component. It provides a complete working example with MongoDB and Kafka adapters, along with REST API endpoints for testing synchronization functionality.

## Features

- **Complete Integration Example**: Shows how to properly integrate the sync component
- **MongoDB Adapter Implementation**: Working example of MongoDB adapter
- **Kafka Adapter Implementation**: Example Kafka integration for event streaming
- **REST API Endpoints**: Ready-to-use endpoints for testing sync operations
- **Dependency Provider**: Example implementation of required dependencies
- **Development Ready**: Hot reload and debugging support

## Prerequisites

- Node.js >= 24
- MongoDB instance (local or remote)
- Kafka broker (optional, for event streaming)
- Yarn package manager

## Installation

```bash
# From the monorepo root
yarn install

# Or from this directory
cd examples/mock-app
yarn install
```

## Configuration

### Environment Variables

Create a `.env` file in the mock-app directory:

```env
# Server Configuration
PORT=7001
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/onekey-sync
MONGODB_USER=
MONGODB_PASSWORD=

# Kafka Configuration (Optional)
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=mock-app
KAFKA_GROUP_ID=sync-group

# Sync Component Configuration
SYNC_ENABLE_CACHE=true
SYNC_CACHE_PREFIX=sync:
SYNC_CACHE_TTL=300
```

### Configuration Files

The application configuration is located in `src/config/`:

```typescript
// src/config/config.default.ts
export default {
  port: 7001,
  koa: {
    port: 7001,
  },
  sync: {
    enableCache: true,
    cachePrefix: 'sync:',
    cacheTTL: 300,
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/onekey-sync',
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
    clientId: process.env.KAFKA_CLIENT_ID || 'mock-app',
  },
};
```

## Usage

### Starting the Application

```bash
# Development mode with hot reload
yarn dev

# Production mode
yarn build
yarn start

# Run tests
yarn test

# Generate test coverage
yarn cov
```

### Available Endpoints

Once the application is running, the following endpoints are available:

#### 1. Download Sync Data
```bash
POST http://localhost:7001/sync/download?userId={userId}

Request Body:
{
  "since": 1234567890,
  "limit": 100,
  "deviceId": "device-123"
}

Response:
{
  "items": [...],
  "hasMore": false,
  "lastSync": 1234567890
}
```

#### 2. Upload Sync Data
```bash
POST http://localhost:7001/sync/upload?userId={userId}

Request Body:
{
  "items": [
    {
      "id": "item-1",
      "data": {...},
      "version": 1,
      "timestamp": 1234567890
    }
  ],
  "deviceId": "device-123"
}

Response:
{
  "success": true,
  "processed": 1,
  "conflicts": []
}
```

#### 3. Check Sync Status
```bash
POST http://localhost:7001/sync/check?userId={userId}

Request Body:
{
  "items": ["item-1", "item-2"],
  "deviceId": "device-123"
}

Response:
{
  "status": "synced",
  "pendingItems": [],
  "lastSync": 1234567890
}
```

#### 4. Manage Locks
```bash
POST http://localhost:7001/sync/lock?userId={userId}

Request Body:
{
  "action": "lock", // or "unlock"
  "itemId": "item-1",
  "deviceId": "device-123"
}

Response:
{
  "success": true,
  "lockId": "lock-123"
}
```

#### 5. Flush Changes
```bash
POST http://localhost:7001/sync/flush?userId={userId}

Request Body:
{
  "force": true,
  "deviceId": "device-123"
}

Response:
{
  "success": true,
  "flushed": 10
}
```

## Project Structure

```
mock-app/
├── src/
│   ├── adapter/                 # Adapter implementations
│   │   ├── mongodb.adapter.ts   # MongoDB adapter
│   │   └── kafka.adapter.ts     # Kafka adapter
│   ├── config/                  # Application configuration
│   │   └── config.default.ts    # Default configuration
│   ├── controller/              # REST API controllers
│   │   └── sync.controller.ts   # Sync endpoints
│   ├── service/                 # Service layer
│   │   └── dependencies.provider.ts # Dependencies provider
│   └── configuration.ts         # Midway.js configuration
├── test/                        # Test files
│   └── sync.test.ts            # Sync controller tests
├── logs/                        # Application logs
├── bootstrap.js                 # Application bootstrap
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Implementation Details

### MongoDB Adapter

The MongoDB adapter (`src/adapter/mongodb.adapter.ts`) implements the `IMongodbAdapter` interface:

```typescript
export class MongodbAdapterImpl implements IMongodbAdapter {
  async findUserById(userId: string): Promise<any> {
    // Implementation using mongoose models
  }

  async findSyncDataByUserId(userId: string): Promise<any[]> {
    // Query sync data for user
  }

  async bulkWriteSyncData(operations: any[]): Promise<void> {
    // Bulk write operations
  }

  // ... other methods
}
```

### Kafka Adapter

The Kafka adapter (`src/adapter/kafka.adapter.ts`) handles event streaming:

```typescript
export class KafkaAdapterImpl implements IKafkaAdapter {
  async sendPrimeNotification(data: ISyncNotificationData): Promise<void> {
    // Send notification to Kafka topic
  }
}
```

### Dependencies Provider

The dependencies provider (`src/service/dependencies.provider.ts`) supplies required dependencies:

```typescript
export class SyncDependenciesProvider implements ISyncDependenciesProvider {
  async updateUser(userId: string, data: any): Promise<void> {
    // Update user implementation
  }

  getTraceHeaders(): ITraceHeaders {
    // Return trace headers for logging
  }

  get errors(): ISyncErrors {
    // Return custom error classes
  }
}
```

## Testing

### Unit Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test -- --watch

# Generate coverage report
yarn cov
```

### Integration Testing

Use the provided test file (`test/sync.test.ts`) as a template:

```typescript
import { createApp, close, createHttpRequest } from '@midwayjs/mock';

describe('test/sync.test.ts', () => {
  it('should POST /sync/upload', async () => {
    const app = await createApp();
    const result = await createHttpRequest(app)
      .post('/sync/upload?userId=test-user')
      .send({
        items: [{
          id: 'test-item',
          data: { test: true },
        }],
      });
    
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    
    await close(app);
  });
});
```

### Manual Testing

1. Start MongoDB:
```bash
docker run -d -p 27017:27017 mongo:latest
```

2. Start Kafka (optional):
```bash
docker run -d -p 9092:9092 confluentinc/cp-kafka:latest
```

3. Start the application:
```bash
yarn dev
```

4. Test with curl or Postman:
```bash
# Upload data
curl -X POST http://localhost:7001/sync/upload?userId=test-user \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"item-1","data":{"test":true}}]}'

# Download data
curl -X POST http://localhost:7001/sync/download?userId=test-user \
  -H "Content-Type: application/json" \
  -d '{"since":0,"limit":10}'
```

## Development

### Debugging

1. Use VS Code's built-in debugger with the provided launch configuration
2. Set breakpoints in TypeScript files
3. Run the debugger with F5

### Logging

The application uses Midway.js logger:

```typescript
import { ILogger } from '@midwayjs/logger';
import { Logger } from '@midwayjs/core';

export class SyncController {
  @Logger()
  logger: ILogger;

  async upload() {
    this.logger.info('Processing upload request');
    // ...
  }
}
```

Logs are stored in the `logs/` directory:
- `midway-app.log` - Application logs
- `midway-core.log` - Framework logs
- `common-error.log` - Error logs

### Hot Reload

Development mode includes hot reload:

```bash
yarn dev
# Make changes to source files
# Application automatically restarts
```

## Deployment

### Building for Production

```bash
# Build TypeScript to JavaScript
yarn build

# Start production server
NODE_ENV=production yarn start
```

### Docker Deployment

```dockerfile
FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --production

# Copy source code
COPY . .

# Build application
RUN yarn build

# Expose port
EXPOSE 7001

# Start application
CMD ["yarn", "start"]
```

### PM2 Deployment

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'mock-app',
    script: './bootstrap.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 7001,
    },
  }],
};
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   ```
   Error: MongooseServerSelectionError
   ```
   Solution: Ensure MongoDB is running and accessible

2. **Kafka Connection Issues**
   ```
   Error: KafkaJSConnectionError
   ```
   Solution: Check Kafka broker configuration

3. **Port Already in Use**
   ```
   Error: EADDRINUSE: address already in use :::7001
   ```
   Solution: Change port in configuration or kill existing process

4. **TypeScript Compilation Errors**
   ```
   Error: Cannot find module '@onekeyhq/cloud-sync-server'
   ```
   Solution: Run `yarn install` from monorepo root

### Debug Mode

Enable debug logging:

```bash
DEBUG=midway* yarn dev
```

## Best Practices

1. **Error Handling**: Always implement proper error handling in adapters
2. **Validation**: Use DTOs for input validation
3. **Logging**: Log important operations for debugging
4. **Testing**: Write tests for custom implementations
5. **Configuration**: Use environment variables for sensitive data
6. **Monitoring**: Implement health checks and metrics

## Contributing

1. Fork the repository
2. Create your feature branch
3. Make changes and add tests
4. Ensure all tests pass
5. Submit a pull request

## License

This project is part of the OneKey ecosystem.

## Support

For issues and questions, please open an issue on GitHub or contact the OneKey development team.