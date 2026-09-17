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
| `MAX_USERS_PER_ROOM` | `2` | Maximum users allowed per room |
| `ROOM_TIMEOUT` | `3600000` | Room timeout in milliseconds (1 hour) |
| `MAX_MESSAGE_SIZE` | `10485760` | Maximum message size in bytes (10MB) |

Example `.env` file:
```env
PORT=3868
MAX_USERS_PER_ROOM=2
ROOM_TIMEOUT=3600000
MAX_MESSAGE_SIZE=10485760
```

## API Documentation

### Socket.IO Events

Room methods use the bridge request event, not separate `create-room` or
`join-room` events. A request payload contains `id`, `type: "REQUEST"`, and
`data: { module, method, params }`. Responses preserve correlation fields and
contain `type: "RESPONSE"` with `data` or `error: { name, message, code }`.
Optional string metadata (`origin`, `peerOrigin`, `scope`) is limited to 1024 characters.
`remoteId` accepts null, finite numbers, or strings up to 1024 characters.
Request IDs, when supplied, and response IDs are safe integers.

| Direction | Event | Payload |
| --- | --- | --- |
| Client → server | `e2ee-request` | Bridge request; module `roomManager` |
| Server → client | `e2ee-response` | Bridge response to the server API |
| Client → server | `e2ee-c2c-request` | `{ roomId, payload: <bridge REQUEST> }` |
| Client → server | `e2ee-c2c-response` | `{ roomId, payload: <bridge RESPONSE> }` |
| Server → peer | `e2ee-c2c-request` | The unwrapped bridge REQUEST |
| Server → peer | `e2ee-c2c-response` | The unwrapped bridge RESPONSE, or a relay rejection |
| Server → existing members | `user-joined` | `{ roomId, userId, userCount }`; excludes the joiner |
| Server → remaining members | `user-left` | `{ roomId, userId, userCount }` |
| Server → room members | `room-full` | `{ roomId, userCount }` |
| Server → room members | `start-transfer` | `{ roomId, fromUserId, toUserId, randomNumber }` |

The event and bridge type must match. Both relay directions require membership
in Socket.IO and RoomManager. Authorized, accepted relay traffic renews room
activity; rejected traffic does not. Rooms expire after `ROOM_TIMEOUT` of
inactivity, checked every five minutes. Expiry emits the existing `user-left`
event with `userCount: 0` and removes Socket.IO membership only for that room;
other rooms on the connection remain usable. Leaving an already removed room is idempotent.

### Room RPCs

Use `data.module = "roomManager"`; `params` is an array of method arguments.

| Method | First argument | Result |
| --- | --- | --- |
| `createRoom` | No arguments | `{ roomId, encryptionKey }` |
| `joinRoom`, `joinRoomAfterCreate` | `{ roomId, appPlatform, appPlatformName, appVersion, appBuildNumber, appDeviceName }` | `{ success, userId, roomId, userCount, roomKey, chunkedTransferVersion: 1, maxMessageSize }` |
| `getRoomUsers` | `{ roomId }` | User records ordered by join time, without socket IDs |
| `leaveRoom` | `{ roomId, userId }` | `{ success, userCount, roomDestroyed }` |
| `startTransfer` | `{ roomId, fromUserId, toUserId }` | Transfer direction, or undefined when cleared |

`getRoomUsers` returns `[]` for both nonexistent rooms and non-members. This
preserves legacy missing-room behavior without exposing room existence. It uses
a per-connection token bucket of 10 requests, replenishing 5 requests/second.
Joins reserve capacity while the adapter is pending and publish membership only
after it succeeds; disconnects and failed joins release that reservation.
Supplied join metadata must be strings: platform/version/build fields allow 64
characters, platform display name 256, and device name 512. Missing legacy fields
remain accepted. `maxMessageSize` advertises the deployment limit to new senders.

### Chunk protocol v1 and relay limits

Chunking requires the relay join result and the peer's `getTransferType` result
to advertise `chunkedTransferVersion: 1`. Older clients/relays retain
`sendTransferData` single-message transfers. A new sender must fall back when an
old peer does not implement the capability method.

| Limit | Value |
| --- | --- |
| Chunk data | 64 KiB Base64 ASCII (`params[0].data`) |
| Complete chunk envelope | 72 KiB JSON UTF-8 bytes, including room ID, all extra fields and bridge metadata |
| Transfer total | 64 MiB of encrypted Base64 wire data; not the original wallet data size |
| Chunk indices | 0–1023 inclusive, derived from total bytes / chunk size |
| Chunk requests | At most 512 per connection per one-second window |
| Complete response envelope | 256 KiB JSON UTF-8 bytes |
| Responses | At most 1024 per connection per one-second window |
| Requests + responses | At most 1600 relay messages and 48 MiB per connection per one-second window |
| Legacy single request | Existing `MAX_MESSAGE_SIZE`, 10 MiB by default |

The byte budget covers 512 complete 72 KiB chunk envelopes (36 MiB), plus
12 MiB for normal ACKs/control messages. Aggregate counts reserve control-message
headroom in addition to chunk and response counts. The combined byte budget is at least `MAX_MESSAGE_SIZE` when a deployment
explicitly raises that setting. Rejected relay traffic also consumes the shared
budget. Malformed/binary/overly complex JSON is not forwarded (maximum depth 64,
16384 visited values). Crossing the shared traffic or response-rate budget disconnects the abusive
socket. Within the transport packet limit, a single oversized or overly complex
response with valid metadata and membership becomes a small same-ID error for the original caller; its body is
never relayed, and the responder is not sent another response. Rejected requests
with a valid ID and membership receive `1001`; one-way requests receive no reply. Limits are per connection;
production ingress must also bound connection counts and aggregate traffic.

Chunk RPCs use module `api`: `beginChunkedTransfer({ transferId, totalBytes })`,
`sendTransferChunk({ transferId, index, data })`, and
`finishChunkedTransfer({ transferId })`. A chunk acknowledgement contains
`{ transferId, index, receivedBytes }`. The relay validates chunk shape and packet
size but does not assemble, decrypt, or maintain the transfer manifest. The App
checks total size before starting and the receiver checks it again on begin.
In a valid bridge request, invalid chunk parameters or packet size return `1001`; actual chunk throttling
returns `1100`, on `e2ee-c2c-response`. The relay performs no automatic retries.
Malformed bridge envelopes are discarded; response IDs are required.

New senders check the 64 MiB total before beginning a chunk transfer. Legacy
fallbacks check the complete encoded Socket.IO message before emitting wallet
data, using the advertised `maxMessageSize` or the historical 10 MiB default
when connected to an older relay. These total/message checks are independent
of throughput limits; increasing `MAX_MESSAGE_SIZE` does not raise the chunked-transfer total.

CORS reflects the requesting origin and retains `credentials: true` for browser
clients using credentialed HTTP polling, even though this service does not use
cookie authentication. CORS is not an authorization boundary.

### REST API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | `{ message: "Health check OK: <ISO timestamp>" }` |

There are no `/stats`, `/rooms`, or `/rooms/:roomId` handlers. Room operations
use the RPC interface above.

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

1. **Message and Traffic Limits**: Bounds per-connection relay size and throughput
2. **Room Timeouts**: Automatic cleanup of inactive rooms
3. **User Limits**: Configurable maximum users per room
4. **Room Membership Enforcement**: Client-to-client messages are relayed only
   for a sender that has actually joined the target room
5. **Input Validation**: Bridge type, metadata, membership, and chunk validation

### Best Practices

- Always use HTTPS in production
- Do not treat CORS as access control: it is deliberately permissive and
  `Origin` is not the auth boundary here (see `corsOptions` in `src/server.ts`)
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
# Build and run TCP smoke, crash logging, relay policy, and lifecycle tests
yarn test

# Run the relay compatibility and lifecycle suite
yarn test:compatibility
```

## Error Handling

Server-generated errors omit stack traces on the wire; server logs retain them.
Peer errors are relayed as peer data.

| Code | Meaning |
| --- | --- |
| `1001` | Invalid parameter or chunk packet size; retrying unchanged input does not help |
| `1002` | Operation failed, including a closed connection during join |
| `1100` | Per-method or chunk rate limit |
| `1700` | Missing server-side socket context |
| `1701` | Invalid room ID |
| `1702` | Room not found for room operations other than the privacy-preserving user query |
| `1703` | Connection rejected because the room has no available slot |
| `1704` | User not found |
| `1705` | Socket is not in the room for an operation requiring membership |
| `1706` | Transfer participants are not both room members |

See `src/errors.ts` for the complete code list.

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

### Room Lifecycle

Monitor the structured `room.created`, `room.joined`, `room.left`, and
`room.expiredCleaned` log events. There is no statistics HTTP endpoint.

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
   - CORS is intentionally permissive: every origin is accepted and there is no
     allowlist to configure
   - `Origin` is not the auth boundary here - access control is the out-of-band
     pairing code plus the room membership check on the client-to-client relay.
     See the comment on `corsOptions` in `src/server.ts` for why

3. **Connection Timeouts**
   - Verify firewall settings
   - Check WebSocket support in reverse proxy configuration

4. **Memory Leaks**
   - Monitor the structured `room.expiredCleaned` log events
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
