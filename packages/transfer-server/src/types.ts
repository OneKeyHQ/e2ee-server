import type { RoomManager } from './roomManager';
import type { IJsBridgeMessagePayload } from '@onekeyfe/cross-inpage-provider-types';

// Export error classes
export { E2eeError, E2eeErrorCode } from './errors';

// Client relay input wraps the bridge payload; peer output is unwrapped.
export interface IRelayEnvelope {
  roomId: string;
  payload: IJsBridgeMessagePayload;
}

export interface IServerToClientEvents {
  'e2ee-response': (payload: IJsBridgeMessagePayload) => void;
  'e2ee-c2c-request': (payload: IJsBridgeMessagePayload) => void;
  'e2ee-c2c-response': (payload: IJsBridgeMessagePayload) => void;
  'user-joined': (data: { roomId: string; userId: string; userCount: number }) => void;
  'user-left': (data: { roomId: string; userId: string; userCount: number }) => void;
  'room-full': (data: { roomId: string; userCount: number }) => void;
  'start-transfer': (data: {
    roomId: string;
    fromUserId: string;
    toUserId: string;
    randomNumber: string;
  }) => void;
}

export interface IClientToServerEvents {
  'e2ee-request': (payload: IJsBridgeMessagePayload) => void;
  'e2ee-c2c-request': (envelope: IRelayEnvelope) => void;
  'e2ee-c2c-response': (envelope: IRelayEnvelope) => void;
}

export interface IInterServerEvents {
  ping: () => void;
}

export interface ISocketData {
  userId?: string;
  roomId?: string;
  instanceId?: string; // Client instance ID
}

// Room data structure
export interface IRoom {
  id: string;
  // Server-generated key handed to clients on create/join. The OneKey client
  // does not consume it, and this server never encrypts with it - payloads are
  // relayed as-is. Real end-to-end protection comes from a key the clients
  // derive themselves (pairing code + ECDHE shared secret + room user list).
  // The server knows the user list but not the secret key material.
  // See RoomManager.createRoom().
  encryptionKey: string;
  users: Map<string, IE2EESocketUserInfo>;
  transferDirection?:
    | {
        fromUserId: string | undefined;
        toUserId: string | undefined;
      }
    | undefined;
  createdAt: Date;
  lastActivity: Date;
  maxUsers: number;
}

// User information
export interface IE2EESocketUserInfo {
  id: string;
  socketId: string | undefined;
  joinedAt: Date;
  appPlatform: string;
  appPlatformName: string;
  appVersion: string;
  appBuildNumber: string;
  appDeviceName: string;
}

// Room configuration
export interface IRoomConfig {
  maxUsers: number;
  roomTimeout: number; // Room timeout (milliseconds)
  maxMessageSize: number; // Maximum message size (bytes)
}

// Server configuration
export interface IServerConfig {
  port: number;
  roomConfig: IRoomConfig;
}

export interface IE2EEServerApi {
  roomManager: RoomManager;
}
export type IE2EEServerApiKeys = keyof IE2EEServerApi;
