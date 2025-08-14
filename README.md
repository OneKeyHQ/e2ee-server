# OneKey E2EE Server

End-to-End Encryption server for OneKey applications. Built with Socket.IO to provide secure real-time communication services including room management, user authentication, and encrypted data transmission.

## Features

- 🔐 **End-to-End Encryption**: Secure encrypted data transmission
- 🏠 **Room Management**: Create and manage chat rooms with multi-user support
- 🔄 **Real-time Communication**: Bidirectional real-time communication based on Socket.IO
- ⚙️ **Flexible Configuration**: Environment variable configuration for ports, CORS, etc.
- 🛡️ **Security Controls**: Built-in CORS protection, message size limits, and other security mechanisms
- 📊 **Health Monitoring**: Provides `/health` endpoint for service monitoring

## Tech Stack

- **Node.js** (>= 24)
- **TypeScript**
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **@noble/hashes** - Cryptographic algorithms
- **Docker** - Containerized deployment

## Project Structure

```
src/
├── server.ts                    # Main server entry point
├── types.ts                     # TypeScript type definitions
├── roomManager.ts               # Room manager
├── e2eeServerApi.ts            # E2EE API interface
├── e2eeServerApiProxy.ts       # API proxy
├── JsBridgeE2EEServer.ts       # JS Bridge server side
├── JsBridgeE2EEClient.ts       # JS Bridge client side
├── decorators/
│   └── e2eeApiMethod.ts        # API method decorator
└── utils/
    ├── cryptoUtils.ts          # Crypto utilities
    ├── bufferUtils.ts          # Buffer utilities
    ├── stringUtils.ts          # String utilities
    ├── hexUtils.ts             # Hex utilities
    ├── timerUtils.ts           # Timer utilities
    ├── cacheUtils.ts           # Cache utilities
    └── RemoteApiProxyBase.ts   # Remote API proxy base class
```

## Local Development

### Prerequisites

- Node.js >= 24
- Yarn (recommended) or npm

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/OneKeyHQ/e2ee-server
   cd e2ee-server
   ```

2. **Install dependencies**
   ```bash
   yarn install
   # or
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp env.example .env
   ```
   
   Modify the `.env` file as needed:
   ```env
   # Server port (default: 3868)
   PORT=3868
   
   # CORS allowed origins, comma-separated
   CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3868
   
   # Maximum users per room (default: 2)
   MAX_USERS_PER_ROOM=2
   
   # Room timeout in milliseconds (default: 1 hour)
   ROOM_TIMEOUT=3600000
   
   # Maximum message size in bytes (default: 1MB)
   MAX_MESSAGE_SIZE=1048576
   ```

4. **Start development server**
   ```bash
   yarn dev
   # or
   npm run dev
   ```

   The server will start at `http://localhost:3868` with hot reload enabled.

5. **Health check**
   ```bash
   curl http://localhost:3868/health
   ```

### Local Network Access

To access the server from other devices on your local network:

1. **Find your local IP address**
   ```bash
   # On macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Or use a simpler command
   hostname -I
   
   # On Windows
   ipconfig | findstr "IPv4"
   ```

2. **Update CORS configuration**
   
   Add your local IP to the `.env` file:
   ```env
   CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3868,http://192.168.1.100:3868
   ```
   Replace `192.168.1.100` with your actual local IP address.

3. **Access from other devices**
   
   Once the server is running, you can access it from other devices using:
   - Health check: `http://192.168.1.100:3868/health`
   - Socket.IO connection: `ws://192.168.1.100:3868`

4. **Firewall considerations**
   
   Make sure your local firewall allows incoming connections on port 3868:
   ```bash
   # On macOS (if using pfctl)
   sudo pfctl -f /etc/pf.conf
   
   # On Ubuntu/Debian
   sudo ufw allow 3868
   
   # On CentOS/RHEL
   sudo firewall-cmd --permanent --add-port=3868/tcp
   sudo firewall-cmd --reload
   ```

### Development Commands

- `yarn dev` - Start development server (with hot reload)
- `yarn build` - Build production version
- `yarn start` - Start production server
- `yarn clean` - Clean build files

### API Endpoints

- `GET /health` - Health check endpoint
- Socket.IO connection: `ws://localhost:3868`

### Socket.IO Events

#### Client to Server

- `create-room` - Create new room
- `join-room` - Join room
- `send-encrypted-data` - Send encrypted data
- `leave-room` - Leave room
- `get-room-status` - Get room status
- `get-room-list` - Get room list

#### Server to Client

- `room-created` - Room created
- `room-joined` - Joined room
- `user-joined` - User joined
- `user-left` - User left
- `encrypted-data` - Receive encrypted data
- `room-error` - Room error
- `room-status` - Room status update

## Production Deployment

### Docker Deployment (Recommended)

1. **Build Docker image**
   ```bash
   docker build -t onekey-e2ee-server .
   ```

2. **Run container**
   ```bash
   docker run -d \
     --name e2ee-server \
     -p 3868:3868 \
     -e PORT=3868 \
     -e CORS_ORIGINS="https://your-domain.com,https://app.onekey.so" \
     -e MAX_USERS_PER_ROOM=2 \
     -e ROOM_TIMEOUT=3600000 \
     -e MAX_MESSAGE_SIZE=1048576 \
     onekey-e2ee-server
   ```

3. **Using Docker Compose**
   
   Create `docker-compose.yml`:
   ```yaml
   version: '3.8'
   services:
     e2ee-server:
       build: .
       ports:
         - "3868:3868"
       environment:
         - PORT=3868
         - CORS_ORIGINS=https://your-domain.com,https://app.onekey.so
         - MAX_USERS_PER_ROOM=2
         - ROOM_TIMEOUT=3600000
         - MAX_MESSAGE_SIZE=1048576
         - TZ=Asia/Shanghai
       restart: unless-stopped
   ```
   
   Start the service:
   ```bash
   docker-compose up -d
   ```

### Traditional Deployment

1. **Clone code on server**
   ```bash
   git clone https://github.com/OneKeyHQ/e2ee-server
   cd e2ee-server
   ```

2. **Install dependencies**
   ```bash
   yarn install --production
   ```

3. **Configure environment variables**
   ```bash
   cp env.example .env
   # Edit .env file with production environment parameters
   ```

4. **Build project**
   ```bash
   yarn build
   ```

5. **Start service**
   ```bash
   yarn start
   ```

6. **Use PM2 for process management (recommended)**
   ```bash
   # Install PM2
   npm install -g pm2
   
   # Start application
   pm2 start dist/server.js --name "e2ee-server"
   
   # Set auto-start on boot
   pm2 startup
   pm2 save
   ```

### Cloud Server Deployment Notes

1. **Firewall Configuration**
   - Ensure port 3868 (or custom port) is open
   - Configure security group rules to allow inbound connections

2. **Reverse Proxy Configuration (Nginx)**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3868;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

3. **HTTPS Configuration**
   ```bash
   # Get free SSL certificate with Let's Encrypt
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

4. **Monitoring and Logging**
   ```bash
   # View application logs
   pm2 logs e2ee-server
   
   # Monitor application status
   pm2 monit
   
   # Restart application
   pm2 restart e2ee-server
   ```

### Health Check and Monitoring

- **Health check endpoint**: `GET /health`
- **Response example**:
  ```json
  {
    "message": "Health check OK: 2024-01-01T00:00:00.000Z"
  }
  ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3868 | Server listening port |
| `CORS_ORIGINS` | localhost:3000,3001,3868 | CORS allowed origins |
| `MAX_USERS_PER_ROOM` | 2 | Maximum users per room |
| `ROOM_TIMEOUT` | 3600000 | Room timeout in milliseconds |
| `MAX_MESSAGE_SIZE` | 1048576 | Maximum message size in bytes |

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Check port usage
   lsof -i :3868
   # Or modify PORT in .env configuration
   ```

2. **CORS errors**
   - Check `CORS_ORIGINS` environment variable configuration
   - Ensure client domain is added to the allowed list

3. **Socket.IO connection failure**
   - Check firewall settings
   - Confirm WebSocket protocol support
   - Verify reverse proxy configuration

4. **Out of memory**
   - Adjust `MAX_MESSAGE_SIZE` and `MAX_USERS_PER_ROOM`
   - Monitor server resource usage

## Development Contributing

1. Fork the project
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Create Pull Request

## License

Private project, Copyright © OneKey