# OneKey Server Infrastructure

A monorepo containing OneKey's server infrastructure components, including end-to-end encryption server and cloud synchronization services.

## 🏗 Architecture

This monorepo uses Yarn workspaces to manage multiple packages:

```
e2ee-server/
├── packages/
│   ├── transfer-server/      # E2EE real-time communication server
│   └── cloud-sync-server/    # Cloud synchronization component
└── examples/
    └── mock-app/             # Mock application for testing
```

## 📦 Packages

### [@onekeyhq/transfer-server](./packages/transfer-server/)
**End-to-End Encryption Server** - A high-performance, secure real-time communication server built with Socket.IO and TypeScript.

- Real-time bidirectional communication
- Room-based message routing
- End-to-end encryption support
- WebSocket with Socket.IO
- Production-ready with health checks

### [@onekeyhq/cloud-sync-server](./packages/cloud-sync-server/)
**Cloud Sync Component** - A Midway.js-based component for OneKey Prime synchronization functionality.

- Midway.js component architecture
- MongoDB and Kafka adapter support
- Dependency injection patterns
- Extensible sync service implementation

### [@onekeyhq/mock-app](./examples/mock-app/)
**Mock Application** - Testing and development application for integration testing.

- Midway.js application framework
- Integration test examples
- API endpoint testing
- Development environment setup

## 🚀 Quick Start

### Prerequisites

- Node.js >= 24
- Yarn package manager
- MongoDB (for cloud-sync-server)
- Kafka (optional, for cloud-sync-server)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd e2ee-server

# Install all dependencies
yarn install

# Build all packages
yarn build
```

### Development

```bash
# Start transfer-server in development mode
yarn dev

# Start cloud-sync-server in watch mode
yarn dev:sync

# Start mock application
yarn dev:mock
```

### Production

```bash
# Build all packages
yarn build

# Start transfer-server
yarn start

# Start mock application
yarn start:mock
```

## 📋 Available Scripts

### Root Level Commands

| Command | Description |
|---------|-------------|
| `yarn install` | Install all dependencies for all packages |
| `yarn build` | Build all packages |
| `yarn build:sync` | Build cloud-sync-server only |
| `yarn build:mock` | Build mock-app only |
| `yarn dev` | Start transfer-server in development mode |
| `yarn dev:sync` | Start cloud-sync-server in watch mode |
| `yarn dev:mock` | Start mock-app in development mode |
| `yarn start` | Start transfer-server in production |
| `yarn start:mock` | Start mock-app in production |
| `yarn test` | Run tests for all packages |
| `yarn test:sync` | Run tests for cloud-sync-server |
| `yarn test:mock` | Run tests for mock-app |
| `yarn lint` | Run ESLint for all packages |
| `yarn lint:sync` | Run ESLint for cloud-sync-server |
| `yarn clean` | Clean build artifacts for all packages |

### Package-Specific Commands

Each package has its own set of scripts. Navigate to the package directory or use yarn workspace commands:

```bash
# Run command for specific package
yarn workspace @onekeyhq/transfer-server <command>
yarn workspace @onekeyhq/cloud-sync-server <command>
yarn workspace @onekeyhq/mock-app <command>
```

## 🔧 Configuration

### Environment Variables

Each package can be configured using environment variables. Create `.env` files in package directories:

#### transfer-server
```env
PORT=3868
MAX_USERS_PER_ROOM=2
ROOM_TIMEOUT=3600000
MAX_MESSAGE_SIZE=10485760
```

#### cloud-sync-server
Configure through Midway.js configuration files in `src/config/`.

## 🏛 Project Structure

```
e2ee-server/
├── packages/
│   ├── transfer-server/           # E2EE Server
│   │   ├── src/
│   │   │   ├── server.ts         # Main server entry
│   │   │   ├── roomManager.ts    # Room management
│   │   │   ├── e2eeServerApi.ts  # API interfaces
│   │   │   └── utils/            # Utility functions
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cloud-sync-server/         # Sync Component
│       ├── src/
│       │   ├── configuration.ts   # Midway configuration
│       │   ├── service/          # Service implementations
│       │   ├── dto/              # Data transfer objects
│       │   └── adapter/          # External adapters
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   └── mock-app/                  # Mock Application
│       ├── src/
│       │   ├── configuration.ts
│       │   ├── controller/
│       │   └── service/
│       └── package.json
│
├── package.json                   # Root package.json
├── yarn.lock                      # Yarn lock file
├── CLAUDE.md                      # AI assistant instructions
└── README.md                      # This file
```

## 🧪 Testing

```bash
# Run all tests
yarn test

# Run tests for specific package
yarn test:sync        # Cloud sync server tests
yarn test:mock        # Mock app tests

# Run tests with coverage
yarn workspace @onekeyhq/cloud-sync-server test:cov

# Run tests in watch mode
yarn workspace @onekeyhq/cloud-sync-server test:watch
```

## 🔍 Code Quality

```bash
# Run linting for all packages
yarn lint

# Run linting for specific package
yarn lint:sync

# Auto-fix linting issues
yarn workspace @onekeyhq/cloud-sync-server lint:fix
```

## 🐳 Docker Support

### Building Docker Images

```bash
# Build transfer-server image
docker build -f packages/transfer-server/Dockerfile -t onekey/transfer-server .

# Build cloud-sync-server image
docker build -f packages/cloud-sync-server/Dockerfile -t onekey/cloud-sync-server .
```

### Docker Compose

```yaml
version: '3.8'
services:
  transfer-server:
    image: onekey/transfer-server
    ports:
      - "3868:3868"
    environment:
      - NODE_ENV=production
      - PORT=3868

  cloud-sync-server:
    image: onekey/cloud-sync-server
    ports:
      - "7001:7001"
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
      - kafka

  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"

  kafka:
    image: confluentinc/cp-kafka:latest
    ports:
      - "9092:9092"
```

## 📊 Monitoring

### Health Checks

- Transfer Server: `http://localhost:3868/health`
- Mock App: `http://localhost:7001/health`

### Server Statistics

- Transfer Server: `http://localhost:3868/stats`

## 🛠 Development Guidelines

### Git Workflow

1. Create feature branch from `main`
2. Make changes and commit with conventional commits
3. Run tests and linting
4. Create pull request
5. Merge after review

### Commit Convention

```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Format code
refactor: Refactor code
test: Add tests
chore: Update dependencies
```

### Adding New Packages

1. Create new directory under `packages/`
2. Initialize package with `package.json`
3. Add to workspaces in root `package.json`
4. Run `yarn install` from root

## 🔒 Security

- All sensitive configuration should use environment variables
- Never commit `.env` files
- Use HTTPS in production
- Configure CORS appropriately
- Implement rate limiting
- Regular dependency updates

## 📝 License

This project is part of the OneKey ecosystem.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Contact the OneKey development team

## 🔗 Related Links

- [OneKey Website](https://onekey.so)
- [Documentation](./docs/)
- [API Reference](./docs/api/)
- [Migration Guide](./docs/migration.md)