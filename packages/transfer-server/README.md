# @onekeyhq/transfer-server

OneKey End-to-End Encryption (E2EE) Server - A high-performance, secure real-time communication server built with Socket.IO and TypeScript.

## Features

- **End-to-End Encryption**: Secure message transmission between clients
- **Real-time Communication**: WebSocket-based bidirectional communication using Socket.IO
- **Room Management**: Dynamic room creation and user management
- **Type Safety**: Full TypeScript implementation with strict typing
- **Scalable Architecture**: Modular design with clean separation of concerns
- **Cross-Platform Support**: Works with web, mobile, and desktop clients

## Installation

```bash
# Install dependencies
yarn install

# Build the project
yarn build
```

## Usage

### Development Mode

```bash
# Start the server with hot reload
yarn dev
```

The server will start on port 3868 by default (configurable via `PORT` environment variable).

### Production Mode

```bash
# Build the project
yarn build

# Start the production server
yarn start
```

## Configuration

The server can be configured using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3868` | Server listening port |
| `CORS_ORIGINS` | `*` | Comma-separated list of allowed CORS origins |
| `MAX_USERS_PER_ROOM` | `2` | Maximum users allowed per room |
| `ROOM_TIMEOUT` | `3600000` | Room timeout in milliseconds (1 hour) |
| `MAX_MESSAGE_SIZE` | `10485760` | Maximum message size in bytes (10MB) |

Example `.env` file:
```env
PORT=3868
CORS_ORIGINS=http://localhost:3000,https://app.onekey.so
MAX_USERS_PER_ROOM=2
ROOM_TIMEOUT=3600000
MAX_MESSAGE_SIZE=10485760
```

## API Documentation

### Socket.IO Events

#### Client → Server Events

| Event | Description | Payload |
|-------|-------------|---------|
| `create-room` | Create a new room | `{ roomId?: string, metadata?: object }` |
| `join-room` | Join an existing room | `{ roomId: string, userId?: string }` |
| `send-encrypted-data` | Send encrypted data to room members | `{ data: any, targetUserId?: string }` |
| `leave-room` | Leave the current room | `{ roomId: string }` |
| `get-room-status` | Get room information | `{ roomId: string }` |
| `get-room-list` | Get list of available rooms | `{}` |

#### Server → Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `room-created` | Room successfully created | `{ roomId: string, creatorId: string }` |
| `room-joined` | Successfully joined room | `{ roomId: string, userId: string, users: string[] }` |
| `user-joined` | Another user joined the room | `{ userId: string, users: string[] }` |
| `user-left` | User left the room | `{ userId: string, users: string[] }` |
| `encrypted-data` | Received encrypted data | `{ data: any, senderId: string }` |
| `room-error` | Error occurred | `{ code: string, message: string }` |
| `room-status` | Room status information | `{ roomId: string, users: User[], createdAt: number }` |

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check endpoint |
| `/stats` | GET | Server statistics |
| `/rooms` | GET | List all active rooms |
| `/rooms/:roomId` | GET | Get room details |

## Architecture

### Core Components

- **`server.ts`**: Main server entry point with Express and Socket.IO setup
- **`roomManager.ts`**: Handles room lifecycle and user management
- **`e2eeServerApi.ts`**: API interface definitions
- **`e2eeServerApiProxy.ts`**: API proxy implementation for remote calls
- **`JsBridgeE2EEServer.ts`**: Server-side bridge implementation
- **`JsBridgeE2EEClient.ts`**: Client-side bridge implementation

### Decorators

- **`@e2eeApiMethod`**: Marks methods as E2EE API endpoints with automatic validation and error handling

### Utilities

- **`cryptoUtils.ts`**: Cryptographic operations and key management
- **`bufferUtils.ts`**: Buffer manipulation and conversion utilities
- **`hexUtils.ts`**: Hexadecimal encoding/decoding
- **`cacheUtils.ts`**: LRU cache implementation for performance
- **`timerUtils.ts`**: Timer and timeout management
- **`stringUtils.ts`**: String manipulation helpers

## Security

### Built-in Security Features

1. **Message Size Limits**: Prevents DoS attacks by limiting message sizes
2. **Room Timeouts**: Automatic cleanup of inactive rooms
3. **User Limits**: Configurable maximum users per room
4. **CORS Protection**: Configurable CORS origins
5. **Input Validation**: Automatic validation of all API inputs

### Best Practices

- Always use HTTPS in production
- Configure CORS origins appropriately
- Implement rate limiting with a reverse proxy
- Monitor room creation patterns for abuse
- Use environment variables for sensitive configuration

## Development

### Project Structure

```
packages/transfer-server/
├── src/
│   ├── server.ts              # Main server entry
│   ├── roomManager.ts          # Room management logic
│   ├── e2eeServerApi.ts        # API interfaces
│   ├── e2eeServerApiProxy.ts   # API proxy
│   ├── JsBridgeE2EEServer.ts   # Server bridge
│   ├── JsBridgeE2EEClient.ts   # Client bridge
│   ├── errors.ts               # Error definitions
│   ├── types.ts                # TypeScript types
│   ├── decorators/
│   │   └── e2eeApiMethod.ts    # API decorators
│   └── utils/
│       ├── RemoteApiProxyBase.ts
│       ├── bufferUtils.ts
│       ├── cacheUtils.ts
│       ├── cryptoUtils.ts
│       ├── hexUtils.ts
│       ├── stringUtils.ts
│       └── timerUtils.ts
├── dist/                       # Compiled JavaScript
├── package.json
├── tsconfig.json
└── nodemon.json
```

### Scripts

```bash
# Development
yarn dev          # Start dev server with hot reload

# Building
yarn build        # Compile TypeScript to JavaScript
yarn clean        # Remove build artifacts

# Production
yarn start        # Start production server
```

### Testing

```bash
# Run tests (when implemented)
yarn test

# Run tests with coverage
yarn test:coverage
```

## Error Handling

The server implements a comprehensive error handling system with specific error codes:

| Error Code | Description |
|------------|-------------|
| `ROOM_NOT_FOUND` | Requested room does not exist |
| `ROOM_FULL` | Room has reached maximum capacity |
| `UNAUTHORIZED` | User not authorized for this operation |
| `INVALID_DATA` | Invalid data format or content |
| `TIMEOUT` | Operation timed out |
| `INTERNAL_ERROR` | Internal server error |

## Performance Optimization

- **LRU Cache**: Frequently accessed data is cached using LRU strategy
- **Memoization**: Expensive computations are memoized
- **Buffer Pooling**: Efficient buffer management for large messages
- **Connection Pooling**: Optimized Socket.IO connection handling

## Deployment

### Docker

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn install --production
COPY . .
RUN yarn build
EXPOSE 3868
CMD ["yarn", "start"]
```

### PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'e2ee-server',
    script: './dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3868
    }
  }]
}
```

## Monitoring

### Health Check

```bash
curl http://localhost:3868/health
```

### Server Statistics

```bash
curl http://localhost:3868/stats
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Find process using port 3868
   lsof -i :3868
   # Kill the process
   kill -9 <PID>
   ```

2. **CORS Issues**
   - Ensure `CORS_ORIGINS` environment variable is properly configured
   - Check that client origin matches allowed origins

3. **Connection Timeouts**
   - Verify firewall settings
   - Check WebSocket support in reverse proxy configuration

4. **Memory Leaks**
   - Monitor room cleanup with `/stats` endpoint
   - Ensure `ROOM_TIMEOUT` is configured appropriately

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is part of the OneKey ecosystem.

## Support

For issues and questions, please open an issue on GitHub or contact the OneKey development team.