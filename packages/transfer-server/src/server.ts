// Must come first: installs browser-global shims that
// @onekeyfe/cross-inpage-provider-core reads while its module is evaluated.
// eslint-disable-next-line import/order, import/first
import './utils/nodeCompat';

import { createServer } from 'http';
import { networkInterfaces } from 'os';

import cors from 'cors';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

import { e2eeServerApiSetup } from './e2eeServerApi';
import { RoomManager } from './roomManager';
import { logger } from './utils/logger';

import type {
  IClientToServerEvents,
  IInterServerEvents,
  IServerConfig,
  IServerToClientEvents,
  ISocketData,
} from './types';
import type { Socket } from 'socket.io';

class E2EEServer {
  private app: express.Application;

  private httpServer: ReturnType<typeof createServer>;

  private socketServer: SocketIOServer<
    IClientToServerEvents,
    IServerToClientEvents,
    IInterServerEvents,
    ISocketData
  >;

  private roomManager: RoomManager;

  private config: IServerConfig;

  private corsOptions: cors.CorsOptions;

  constructor() {
    this.setupProcessGuards();

    this.config = {
      port: parseInt(process.env.PORT || '3868', 10),
      corsOrigins: process.env.CORS_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3868',
        'null',
        'chrome-extension://*',
        'moz-extension://*',
        'ws://*',
        'wss://*',
        'http://*',
        'https://*',
        '*',
      ],
      roomConfig: {
        maxUsers: parseInt(process.env.MAX_USERS_PER_ROOM || '2', 10),
        roomTimeout: parseInt(process.env.ROOM_TIMEOUT || '3600000', 10), // 1 hour
        maxMessageSize: parseInt(
          process.env.MAX_MESSAGE_SIZE || '10485760',
          10,
        ), // 10MB
      },
    };

    this.app = express();
    this.httpServer = createServer(this.app);

    this.setupMiddleware();
    this.setupRoutes();

    this.corsOptions = {
      origin: (origin, callback) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        if (!origin || this.config.corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, true);
          // callback(new Error('Invalid CORS request'));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    };

    this.socketServer = new SocketIOServer<
      IClientToServerEvents,
      IServerToClientEvents,
      IInterServerEvents,
      ISocketData
    >(this.httpServer, {
      cors: this.corsOptions,
      pingTimeout: 60_000,
      pingInterval: 25_000,
      maxHttpBufferSize: this.config.roomConfig.maxMessageSize,
    });

    this.setupSocketEvents();

    this.roomManager = new RoomManager({
      config: this.config.roomConfig,
      socketServer: this.socketServer,
    });
  }

  private setupMiddleware(): void {
    // Error during WebSocket handshake: Unexpected response code: 400
    // {"code":3,"message":"Bad request"}
    // has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
    this.app.use(cors(this.corsOptions));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // /health
    this.app.get('/health', (req, res) => {
      res
        .status(200)
        .json({ message: `Health check OK: ${new Date().toISOString()}` });
    });

    // debug level on purpose: the k8s health probe polls /health continuously
    this.app.use((req, _res, next) => {
      logger.debug({ method: req.method, path: req.path }, 'http.request');
      next();
    });
  }

  private setupRoutes(): void {
    this.app.use((_req, res) => {
      res.status(404).json({ error: 'Not Found' });
    });
  }

  /**
   * Last line of defence against a single bad request killing the whole server.
   *
   * Node's default `--unhandled-rejections=throw` turns any unhandled rejection
   * into a fatal error, and an uncaught exception exits the process outright.
   * This server keeps all room state in memory and runs as a single replica, so
   * one malformed packet on one connection would otherwise drop every active
   * transfer and return 503 until the pod restarts.
   *
   * Handling both events deliberately keeps the process alive: the individual
   * request is already lost, but the other sessions are not. Anything logged
   * here is a real defect - the handler that let the error escape should be
   * fixed rather than left to this net.
   */
  private setupProcessGuards(): void {
    process.on('unhandledRejection', (reason) => {
      try {
        logger.fatal({ err: reason }, 'process.unhandledRejection');
      } catch {
        // never let the guard itself throw
      }
    });

    process.on('uncaughtException', (error, origin) => {
      try {
        logger.fatal({ err: error, origin }, 'process.uncaughtException');
      } catch {
        // never let the guard itself throw
      }
    });
  }

  private setupSocketEvents(): void {
    // handshake/transport failures never reach a connection handler; without
    // this they are invisible and show up only as gateway 5xx
    this.socketServer.engine.on('connection_error', (error) => {
      logger.warn(
        {
          code: error.code,
          message: error.message,
          context: error.context,
        },
        'socket.connectionError',
      );
    });

    this.socketServer.on('connection', (socketClient) => {
      e2eeServerApiSetup({
        socketClient,
        roomManager: this.roomManager,
      });

      const instanceId =
        (socketClient.handshake.auth.instanceId as string) || '';

      logger.info(
        { socketId: socketClient.id, instanceId },
        'socket.connected',
      );

      // TODO remove room when user disconnect
      // TODO remove room before create room

      // Handle disconnection
      socketClient.on('disconnect', async (reason) => {
        logger.info(
          {
            socketId: socketClient.id,
            instanceId: socketClient.data.instanceId || '',
            reason,
          },
          'socket.disconnected',
        );
        await this.handleUserDisconnect(socketClient);
      });

      // Error handling
      socketClient.on('error', (error) => {
        logger.error({ err: error, socketId: socketClient.id }, 'socket.error');
      });
    });
  }

  private async handleUserLeaveRoom(
    socket: Socket,
    roomId?: string,
  ): Promise<void> {
    try {
      const socketData = socket.data as ISocketData | undefined;
      const targetRoomId = roomId || socketData?.roomId;
      const userId = socketData?.userId;

      if (!targetRoomId || !userId) {
        return;
      }

      const result = await this.roomManager.leaveRoom(
        { roomId: targetRoomId, userId },
        { socketClient: socket },
      );

      if (result.success) {
        socket.data = {
          roomId: undefined,
          userId: undefined,
        };

        logger.info({ userId, roomId: targetRoomId }, 'room.userLeft');
      }
    } catch (error) {
      logger.error({ err: error }, 'room.leaveFailed');
    }
  }

  private async handleUserDisconnect(socket: Socket): Promise<void> {
    try {
      const result = await this.roomManager.leaveRoomBySocket(socket);
      await this.handleUserLeaveRoom(socket);
      if (result.roomId && result.userId) {
        logger.info(
          { userId: result.userId, roomId: result.roomId },
          'room.userRemovedOnDisconnect',
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'socket.disconnectHandlingFailed');
    }
    // remove all event listeners
    socket.removeAllListeners();
  }

  private getNetworkIPs(): string[] {
    const interfaces = networkInterfaces();
    const ips: string[] = [];
    
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (netInterface) {
        for (const net of netInterface) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          if (net.family === 'IPv4' && !net.internal) {
            ips.push(net.address);
          }
        }
      }
    }
    
    return ips;
  }

  public startServer(): void {
    // A listen() failure (port in use, EACCES) surfaces as an async 'error'
    // event rather than a throw, so the uncaughtException guard never sees it.
    // Without this the process stays up with nothing bound - health checks fail
    // and k8s only restarts it after the probe times out. Log it and exit so the
    // orchestrator recycles a clean pod immediately.
    this.httpServer.on('error', (error) => {
      logger.fatal({ err: error, port: this.config.port }, 'server.listenFailed');
      process.exit(1);
    });

    this.httpServer.listen(this.config.port, () => {
      const networkIPs = this.getNetworkIPs();
      
      // Calculate padding for proper alignment (box width is 58 chars inside)
      const boxWidth = 58;
      
      const portText = `🚀 Server started successfully`;
      const portLine = `║  ${portText}${' '.repeat(boxWidth - portText.length - 2)} ║`;
      
      const portInfoText = `📡 Port: ${this.config.port}`;
      const portInfoLine = `║  ${portInfoText}${' '.repeat(boxWidth - portInfoText.length - 2)} ║`;
      
      const usersText = `👥 Max room users: ${this.config.roomConfig.maxUsers}`;
      const usersLine = `║  ${usersText}${' '.repeat(boxWidth - usersText.length - 2)} ║`;
      
      const timeoutMinutes = Math.floor(this.config.roomConfig.roomTimeout / 60_000);
      const timeoutText = `⏰ Room timeout: ${timeoutMinutes} minutes`;
      const timeoutLine = `║  ${timeoutText}${' '.repeat(boxWidth - timeoutText.length - 2)} ║`;
      
      const localhostTitleText = `🏠 Localhost`;
      const localhostTitleLine = `║  ${localhostTitleText}${' '.repeat(boxWidth - localhostTitleText.length - 2)} ║`;
      
      const localhostEndpointText = `  - endpoint: http://localhost:${this.config.port}`;
      const localhostEndpointLine = `║  ${localhostEndpointText}${' '.repeat(boxWidth - localhostEndpointText.length - 2)} ║`;
      
      const localhostHealthText = `  - health: http://localhost:${this.config.port}/health`;
      const localhostHealthLine = `║  ${localhostHealthText}${' '.repeat(boxWidth - localhostHealthText.length - 2)} ║`;
      
      const networkLines = networkIPs.map(ip => {
        const lanTitleText = `🔗 LAN (${ip})`;
        const lanTitleLine = `║  ${lanTitleText}${' '.repeat(boxWidth - lanTitleText.length - 2)} ║`;
        
        const lanEndpointText = `  - endpoint: http://${ip}:${this.config.port}`;
        const lanEndpointLine = `║  ${lanEndpointText}${' '.repeat(boxWidth - lanEndpointText.length - 2)} ║`;
        
        const lanHealthText = `  - health: http://${ip}:${this.config.port}/health`;
        const lanHealthLine = `║  ${lanHealthText}${' '.repeat(boxWidth - lanHealthText.length - 2)} ║`;
        
        return `${lanTitleLine}\n${lanEndpointLine}\n${lanHealthLine}`;
      }).join('\n');
      
      // human-readable banner; the structured startup event is logged below
      console.log(`
╔══════════════════════════════════════════════════════════╗
║                    E2EE Server                           ║
║                                                          ║
${portLine}
${portInfoLine}
${usersLine}
${timeoutLine}
║                                                          ║
${localhostTitleLine}
${localhostEndpointLine}
${localhostHealthLine}${networkLines ? '\n' + networkLines : ''}
╚══════════════════════════════════════════════════════════╝
      `);

      logger.info(
        {
          port: this.config.port,
          maxUsers: this.config.roomConfig.maxUsers,
          roomTimeout: this.config.roomConfig.roomTimeout,
          maxMessageSize: this.config.roomConfig.maxMessageSize,
        },
        'server.started',
      );
    });

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  private gracefulShutdown(signal: string): void {
    logger.info({ signal }, 'server.shutdownStarted');

    // Close room manager
    if (this.roomManager) {
      this.roomManager.destroy();
    }

    // Close Socket.IO server
    if (this.socketServer) {
      void this.socketServer.close(() => {
        logger.info('server.socketIoClosed');
      });
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close(() => {
        logger.info('server.httpClosed');
        process.exit(0);
      });
    }

    // Force exit timeout
    setTimeout(() => {
      logger.warn('server.forceExit');
      process.exit(1);
    }, 10_000);
  }
}

// Start server. A failure here is a startup fault - there are no live sessions
// to preserve, so log it structured (this is the line that reaches OpenSearch)
// and exit rather than lingering as a half-initialised process.
try {
  const server = new E2EEServer();
  server.startServer();
} catch (error) {
  logger.fatal({ err: error }, 'server.startupFailed');
  process.exit(1);
}

export default E2EEServer;
