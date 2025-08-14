# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Yarn workspace monorepo containing two main packages:
1. **@onekeyhq/transfer-server** - End-to-End Encryption server for real-time communication using Socket.IO
2. **@onekeyhq/cloud-sync-server** - OneKey Prime Sync Component using Midway.js framework

## Common Development Commands

### Monorepo-level commands (run from root)
- `yarn install` - Install all dependencies for all packages
- `yarn build` - Build all packages
- `yarn build:sync` - Build only cloud-sync-server
- `yarn dev:sync` - Start cloud-sync-server in watch mode
- `yarn dev` - Start transfer-server in development mode
- `yarn dev:mock` - Start mock application in development mode
- `yarn test` - Run tests for all packages
- `yarn test:sync` - Run tests for cloud-sync-server
- `yarn lint` - Run ESLint for all packages
- `yarn lint:sync` - Run ESLint for cloud-sync-server
- `yarn clean` - Clean build artifacts for all packages

### transfer-server specific (packages/transfer-server/)
- `yarn dev` - Start development server with hot reload (uses nodemon)
- `yarn build` - Build TypeScript to JavaScript
- `yarn start` - Start production server
- `yarn clean` - Remove dist folder

### cloud-sync-server specific (packages/cloud-sync-server/)
- `yarn build` - Build TypeScript
- `yarn dev` - Watch mode for development
- `yarn test` - Run Jest tests
- `yarn test:watch` - Run tests in watch mode
- `yarn test:cov` - Run tests with coverage
- `yarn lint` - Run ESLint
- `yarn lint:fix` - Auto-fix ESLint issues

## Architecture Overview

### Transfer Server (E2EE Server)
The transfer server is a Socket.IO-based real-time communication server with end-to-end encryption support.

**Key Components:**
- `server.ts` - Main server entry with Express and Socket.IO setup
- `roomManager.ts` - Manages room creation, joining, and user management
- `e2eeServerApi.ts` & `e2eeServerApiProxy.ts` - API interface and proxy for E2EE operations
- `JsBridgeE2EEServer.ts` & `JsBridgeE2EEClient.ts` - Bridge implementation for client-server communication
- `decorators/e2eeApiMethod.ts` - Method decorator for API endpoints
- `utils/` - Utility functions for crypto, buffers, caching, etc.

**Socket.IO Events:**
- Client→Server: `create-room`, `join-room`, `send-encrypted-data`, `leave-room`, `get-room-status`, `get-room-list`
- Server→Client: `room-created`, `room-joined`, `user-joined`, `user-left`, `encrypted-data`, `room-error`, `room-status`

**Configuration (via environment variables):**
- `PORT` (default: 3868)
- `CORS_ORIGINS` (comma-separated list)
- `MAX_USERS_PER_ROOM` (default: 2)
- `ROOM_TIMEOUT` (default: 3600000ms)
- `MAX_MESSAGE_SIZE` (default: 10485760 bytes)

### Cloud Sync Server
A Midway.js-based component for OneKey Prime synchronization functionality.

**Key Components:**
- `configuration.ts` - Midway.js component configuration
- `service/sync.service.ts` - Main sync service implementation (PrimeSyncService)
- `dto/sync.dto.ts` - Data Transfer Objects for sync operations
- `interface/` - TypeScript interfaces for adapters and config
- `adapter/` - Example adapter implementations for MongoDB and Kafka

**Service Architecture:**
- Uses dependency injection with Midway.js decorators (@Provide, @Inject, @Config)
- Singleton scope for the main service
- Adapter pattern for MongoDB and Kafka integrations
- Support for custom dependencies provider

## Testing Approach

- Both packages use Jest for testing
- Test files are located in `test/` directories
- Mock application available in `examples/mock-app/` for integration testing
- Run individual package tests with `yarn workspace @onekeyhq/<package-name> test`

## Code Style and Linting

- TypeScript is used throughout the project
- ESLint configuration with TypeScript plugin
- Prettier integration for code formatting
- Each package has its own `tsconfig.json` and `.eslintrc.js`
- Node.js version requirement: >= 24 (transfer-server: >= 20)

## Important Implementation Notes

1. **Monorepo Structure**: Use Yarn workspaces for dependency management. Always install dependencies from the root directory.

2. **Error Handling**: The transfer-server includes custom error codes (see `errors.ts`). The cloud-sync-server uses Midway.js error handling patterns.

3. **Security**: 
   - CORS is configured but currently allows all origins in development
   - Message size limits are enforced
   - Room timeouts prevent resource exhaustion

4. **State Management**: 
   - Transfer server uses in-memory room management
   - Cloud sync server expects external MongoDB and Kafka adapters

5. **Deployment**: 
   - Docker support available (see Dockerfile)
   - PM2 recommended for production process management
   - Health check endpoint available at `/health`

6. **Dependency Injection**: The cloud-sync-server heavily uses Midway.js DI patterns. When adding new services, follow the existing pattern with decorators.

7. **Real-time Communication**: Socket.IO is configured with specific ping/pong intervals and buffer sizes. Be mindful of these settings when debugging connection issues.