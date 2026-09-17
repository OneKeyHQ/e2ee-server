import { JsBridgeBase } from '@onekeyfe/cross-inpage-provider-core';
import { IJsBridgeMessageTypes } from '@onekeyfe/cross-inpage-provider-types';

import { E2eeError, E2eeErrorCode } from './errors';
import { CHUNK_PACKET_BYTES, RESPONSE_PACKET_BYTES, RELAY_BYTES_PER_SECOND, RelayTrafficBudget, isValidTransferChunk, measureJsonBytes } from './relayPolicy';
import { capForLog, createModuleLogger } from './utils/logger';

import type {
  IJsBridgeConfig,
  IJsBridgeMessagePayload,
  IJsonRpcRequest,
} from '@onekeyfe/cross-inpage-provider-types';
import type { RoomManager } from './roomManager';
import type { Socket } from 'socket.io';

const logger = createModuleLogger('jsBridge');

const RATE_LIMIT_INTERVAL_MS = 3000;

// Upper bound on distinct methods tracked per connection. `method` comes from
// the client, so without a cap a single socket could grow this map forever.
// Well above the number of methods a real client calls.
const RATE_LIMIT_MAX_TRACKED_METHODS = 64;

// Rejecting a payload happens before rate limiting can apply (a malformed
// packet may carry no method to limit on), so the log itself has to be capped
// per connection or it can be triggered at socket speed.
const INVALID_PAYLOAD_LOG_INTERVAL_MS = 1000;
const INVALID_PAYLOAD_LOG_BURST = 5;

// Rate limiting whitelist - methods that are exempt from rate limiting
const RATE_LIMIT_WHITELIST = new Set([
  'changeTransferDirection',
  'leaveRoom',
  'cancelTransfer',
]);

// Shipped clients query during key derivation, immediately after pairing, and
// independently from a one-second CLI poll. Allow those overlapping calls while
// bounding sustained traffic; a minimum interval breaks otherwise valid pairing.
const ROOM_USERS_RATE_LIMIT_CAPACITY = 10;
const ROOM_USERS_RATE_LIMIT_REFILL_PER_MS = 5 / 1000;

type IResponseEvent = 'e2ee-response' | 'e2ee-c2c-response';
type IRequestEvent = 'e2ee-request' | 'e2ee-c2c-request';

type IPayloadCheckResult =
  | { valid: true; payload: IJsBridgeMessagePayload }
  | { valid: false; reason: string };

/**
 * Validate an inbound socket payload before it reaches JsBridgeBase.receive().
 *
 * receive() throws synchronously on malformed input - an unknown `type` alone is
 * enough. Everything arriving on this socket is attacker-controlled, so the
 * payload has to be checked here rather than relied upon downstream.
 */
function checkBridgePayload(
  raw: unknown,
  { requireMethod }: { requireMethod: boolean },
): IPayloadCheckResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'payload is not an object' };
  }

  const payload = raw as IJsBridgeMessagePayload;

  const expectedType = requireMethod ? IJsBridgeMessageTypes.REQUEST : IJsBridgeMessageTypes.RESPONSE;
  if (payload.type !== expectedType) {
    return { valid: false, reason: 'payload.type does not match its event' };
  }
  if ((!requireMethod && payload.id === undefined) || (payload.id !== undefined &&
    !(typeof payload.id === 'number' && Number.isSafeInteger(payload.id)))) {
    return { valid: false, reason: 'payload.id is invalid' };
  }
  for (const key of ['scope', 'remoteId', 'peerOrigin', 'origin'] as const) {
    const value = payload[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 1024)) {
      return { valid: false, reason: 'bridge metadata is invalid or too large' };
    }
  }

  if (requireMethod) {
    const req = payload.data as IJsonRpcRequest | undefined;
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
      return { valid: false, reason: 'payload.data.method is missing' };
    }
  }

  return { valid: true, payload };
}

export class JsBridgeE2EEServer extends JsBridgeBase {
  constructor(
    config: IJsBridgeConfig,
    {
      socketClient,
      roomManager,
    }: { socketClient: Socket; roomManager: RoomManager },
  ) {
    super(config);
    this.socketClient = socketClient;
    this.roomManager = roomManager;
    this.setup();
  }

  private socketClient: Socket;

  private roomManager: RoomManager;

  /**
   * Rate limit state, scoped to this connection rather than kept in a
   * module-level map that lived for the lifetime of the process.
   *
   * Cleared explicitly on disconnect rather than left to GC: JsBridgeBase
   * instances are currently retained for the lifetime of the process, so
   * anything hanging off them has to be released by hand. For the same reason
   * this is a plain Map - a structure that preallocates would turn into a
   * fixed cost per connection.
   */
  private rateLimitState = new Map<string, number>();

  private roomUsersRateLimitState?: { tokens: number; updatedAt: number };

  private readonly relayTraffic = new RelayTrafficBudget();

  private chunkWindowStartedAt = 0;

  private chunkRequestsInWindow = 0;

  private invalidPayloadLogWindowStart = 0;

  private invalidPayloadLogCount = 0;

  private invalidPayloadSuppressed = 0;

  override sendAsString = false;

  sendPayload(payload: IJsBridgeMessagePayload | string): void {
    this.emitResponse('e2ee-response', payload);
  }

  private emitResponse(
    eventName: IResponseEvent,
    payload: IJsBridgeMessagePayload | string,
  ): void {
    const p = payload as IJsBridgeMessagePayload;
    // The bridge copies errors into plain objects before reaching this exit,
    // so E2eeError.toJSON() alone cannot keep server stacks off the socket.
    if (p?.error && typeof p.error === 'object') {
      delete (p.error as { stack?: string }).stack;
    }
    this.socketClient.emit(eventName, payload);
  }

  private sendRequestError(
    eventName: IRequestEvent,
    payload: IJsBridgeMessagePayload,
    error: E2eeError,
  ): void {
    // C2S and C2C bridges allocate IDs independently. Carry the response channel
    // alongside this request instead of inferring it from an ID or error code.
    // Match JsBridgeBase.responseError's wire envelope without its C2S egress.
    this.emitResponse(
      eventName === 'e2ee-c2c-request' ? 'e2ee-c2c-response' : 'e2ee-response',
      {
        id: payload.id,
        type: IJsBridgeMessageTypes.RESPONSE,
        origin: '',
        scope: payload.scope,
        remoteId: payload.remoteId,
        peerOrigin: payload.peerOrigin,
        error: error.toJSON(),
      },
    );
  }

  /**
   * Wrap a socket listener so one malformed message can never take down the process.
   *
   * Socket.IO dispatches through a plain EventEmitter with no rejection capture:
   * a throwing listener escapes as an uncaught exception, and an async listener
   * that rejects escapes as an unhandled rejection. Node treats both as fatal,
   * so a single bad packet on one connection would kill every other session too.
   */
  private safeHandler<T>(
    eventName: string,
    handler: (arg: T) => void | Promise<void>,
  ): (arg: T) => void {
    return (arg: T) => {
      try {
        const result = handler(arg);
        // guard against the handler being turned into an async function later
        if (result && typeof result.then === 'function') {
          void result.catch((error: unknown) => {
            this.logHandlerError(eventName, error);
          });
        }
      } catch (error) {
        this.logHandlerError(eventName, error);
      }
    };
  }

  private logHandlerError(eventName: string, error: unknown): void {
    logger.error(
      { err: error, eventName, socketId: this.socketClient.id },
      'jsBridge.handlerError',
    );
  }

  /**
   * Log a rejected payload. Only metadata is recorded - the payload body carries
   * end-to-end encrypted user data and must never be written to logs.
   */
  /**
   * Rate limit this log itself. A rejected payload is logged before any method
   * based limiting can apply, so without this an attacker can drive log volume
   * at socket speed.
   */
  private shouldLogInvalidPayload(): boolean {
    const now = Date.now();

    if (now - this.invalidPayloadLogWindowStart >= INVALID_PAYLOAD_LOG_INTERVAL_MS) {
      if (this.invalidPayloadSuppressed > 0) {
        logger.warn(
          {
            socketId: this.socketClient.id,
            suppressed: this.invalidPayloadSuppressed,
          },
          'jsBridge.invalidPayloadSuppressed',
        );
        this.invalidPayloadSuppressed = 0;
      }
      this.invalidPayloadLogWindowStart = now;
      this.invalidPayloadLogCount = 0;
    }

    if (this.invalidPayloadLogCount < INVALID_PAYLOAD_LOG_BURST) {
      this.invalidPayloadLogCount += 1;
      return true;
    }

    this.invalidPayloadSuppressed += 1;
    return false;
  }

  /**
   * Log a rejected payload. Only capped metadata is recorded - the payload body
   * carries end-to-end encrypted user data and must never be written to logs,
   * and `type`/`method` are attacker-controlled strings that have to be
   * truncated before they reach a synchronous log write.
   */
  private logInvalidPayload(
    eventName: string,
    raw: unknown,
    reason: string,
  ): void {
    if (!this.shouldLogInvalidPayload()) {
      return;
    }

    const payload = (
      raw && typeof raw === 'object' ? raw : {}
    ) as IJsBridgeMessagePayload;
    const req = payload.data as IJsonRpcRequest | undefined;
    logger.warn(
      {
        eventName,
        reason,
        socketId: this.socketClient.id,
        payloadType: capForLog(payload.type),
        payloadMethod: capForLog(req?.method),
      },
      'jsBridge.invalidPayload',
    );
  }

  checkIsRateLimited({
    payload,
    eventName,
    sendErrorResponse,
  }: {
    payload: IJsBridgeMessagePayload;
    eventName: string;
    sendErrorResponse: () => void;
  }) {
    // Rate limiting check
    const req = payload?.data as IJsonRpcRequest | undefined;
    const method = typeof req?.method === 'string' ? req.method : '';

    if (eventName === 'e2ee-request' && method === 'getRoomUsers') {
      const now = Date.now();
      const state = this.roomUsersRateLimitState;
      const tokens = state
        ? Math.min(
            ROOM_USERS_RATE_LIMIT_CAPACITY,
            state.tokens +
              Math.max(0, now - state.updatedAt) *
                ROOM_USERS_RATE_LIMIT_REFILL_PER_MS,
          )
        : ROOM_USERS_RATE_LIMIT_CAPACITY;
      this.roomUsersRateLimitState = { tokens, updatedAt: now };
      if (tokens < 1) {
        sendErrorResponse();
        return true;
      }
      this.roomUsersRateLimitState.tokens -= 1;
      return false;
    }

    // Chunk RPCs are bounded by both message size and connection throughput.
    // Keep the existing per-method limit for all other operations.
    if (eventName === 'e2ee-c2c-request' && method === 'sendTransferChunk') {
      const now = Date.now();
      if (now - this.chunkWindowStartedAt >= 1000) {
        this.chunkWindowStartedAt = now;
        this.chunkRequestsInWindow = 0;
      }
      this.chunkRequestsInWindow += 1;
      if (this.chunkRequestsInWindow > 512) {
        sendErrorResponse();
        return true;
      }
      return false;
    }

    // Check if method is in whitelist
    if (RATE_LIMIT_WHITELIST.has(method)) {
      return false;
    }

    // no socket id in the key: the map already belongs to this connection
    const rateLimitKey = `${eventName}:${method}`;

    const now = Date.now();
    const lastTime = this.rateLimitState.get(rateLimitKey);
    if (lastTime !== undefined && now - lastTime < RATE_LIMIT_INTERVAL_MS) {
      sendErrorResponse();
      return true;
    }

    if (
      lastTime === undefined &&
      this.rateLimitState.size >= RATE_LIMIT_MAX_TRACKED_METHODS
    ) {
      this.pruneRateLimitState(now);

      if (this.rateLimitState.size >= RATE_LIMIT_MAX_TRACKED_METHODS) {
        // Every tracked window is still live, so this connection is flooding
        // distinct method names. Refuse to track a new one and treat it as
        // limited: the flood throttles itself and the existing windows - the
        // expensive calls it is trying to reset - stay intact.
        logger.debug(
          { socketId: this.socketClient.id },
          'jsBridge.rateLimitCapacityReached',
        );
        sendErrorResponse();
        return true;
      }
    }

    this.rateLimitState.set(rateLimitKey, now);
    return false;
  }

  /**
   * Reclaim entries whose window has already passed - they cannot rate limit
   * anything any more.
   *
   * This only ever drops expired entries. Live windows are never touched: since
   * `method` is client-controlled, wiping the map on a flood would let the
   * flooder reset the windows of the calls it was just blocked on, turning the
   * bound into a rate-limit bypass.
   */
  private pruneRateLimitState(now: number): void {
    for (const [key, time] of this.rateLimitState) {
      if (now - time >= RATE_LIMIT_INTERVAL_MS) {
        this.rateLimitState.delete(key);
      }
    }
  }

  private buildRateLimitResponder(
    eventName: IRequestEvent,
    payload: IJsBridgeMessagePayload,
  ) {
    return () => {
      logger.debug(
        { socketId: this.socketClient.id },
        'jsBridge.rateLimitExceeded',
      );
      this.sendRequestError(
        eventName,
        payload,
        new E2eeError(
          E2eeErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit, please try again later',
        ),
      );
    };
  }

  setup() {
    // JsBridgeBase instances outlive their socket, so per-connection state is
    // released explicitly rather than left for GC to reclaim
    this.socketClient.on('disconnect', () => {
      this.rateLimitState.clear();
      this.roomUsersRateLimitState = undefined;
    });

    this.socketClient.on(
      'e2ee-request',
      this.safeHandler<unknown>('e2ee-request', (raw) => {
        const checked = checkBridgePayload(raw, { requireMethod: true });
        if (!checked.valid) {
          this.logInvalidPayload('e2ee-request', raw, checked.reason);
          return;
        }
        const p = checked.payload;

        const isRateLimited = this.checkIsRateLimited({
          payload: p,
          eventName: 'e2ee-request',
          sendErrorResponse: this.buildRateLimitResponder('e2ee-request', p),
        });

        if (isRateLimited) {
          return;
        }

        this.receive(p, {
          origin: 'e2ee-server',
          internal: true,
        });
      }),
    );

    this.socketClient.on(
      'e2ee-c2c-request',
      this.safeHandler<unknown>('e2ee-c2c-request', (raw) => {
        const bytes = this.checkRelayTraffic(raw, false);
        if (bytes === undefined) return;
        const envelope = this.checkC2cEnvelope('e2ee-c2c-request', raw, {
          requireMethod: true,
        });
        if (!envelope) {
          return;
        }
        const { payload: p, roomId } = envelope;
        const request = p.data as IJsonRpcRequest;
        if (request.method === 'sendTransferChunk' &&
          (bytes > CHUNK_PACKET_BYTES || !isValidTransferChunk(request.params))) {
          this.sendRequestError('e2ee-c2c-request', p, new E2eeError(
            E2eeErrorCode.INVALID_PARAMETER, 'Invalid transfer chunk or packet size',
          ));
          return;
        }

        const isRateLimited = this.checkIsRateLimited({
          payload: p,
          eventName: 'e2ee-c2c-request',
          sendErrorResponse: this.buildRateLimitResponder('e2ee-c2c-request', p),
        });

        if (isRateLimited) {
          return;
        }

        this.roomManager.updateRoomActivity(roomId);
        this.socketClient.to(roomId).emit('e2ee-c2c-request', p);
      }),
    );

    this.socketClient.on(
      'e2ee-c2c-response',
      this.safeHandler<unknown>('e2ee-c2c-response', (raw) => {
        const bytes = this.checkRelayTraffic(raw, true);
        if (bytes === undefined) return;
        if (bytes > RESPONSE_PACKET_BYTES) {
          // A response cannot be answered with another response. Disconnecting
          // gives peers a terminal transport signal without an error loop.
          this.socketClient.disconnect(true);
          return;
        }
        // A response carries a result rather than a method.
        const envelope = this.checkC2cEnvelope('e2ee-c2c-response', raw, {
          requireMethod: false,
        });
        if (!envelope) {
          return;
        }
        const { payload: p, roomId } = envelope;

        this.roomManager.updateRoomActivity(roomId);
        this.socketClient.to(roomId).emit('e2ee-c2c-response', p);
      }),
    );
  }

  private checkRelayTraffic(raw: unknown, response: boolean): number | undefined {
    const packetLimit = this.roomManager.maxMessageSize;
    const bytes = raw === undefined ? 0 : measureJsonBytes(raw, packetLimit);
    if (!this.relayTraffic.consume(
      bytes ?? packetLimit, response, Math.max(RELAY_BYTES_PER_SECOND, packetLimit),
    )) {
      // Stop parsing and responding to a sustained flood on this connection.
      this.socketClient.disconnect(true);
      return undefined;
    }
    if (bytes === undefined) this.logInvalidPayload('relay', raw, 'packet exceeds JSON limits');
    return bytes;
  }

  /**
   * Client-to-client events are wrapped in a `{ payload, roomId }` envelope.
   * Destructuring it blindly throws when the client emits the event with no
   * argument at all, so the envelope is validated before it is unpacked.
   */
  private checkC2cEnvelope(
    eventName: string,
    raw: unknown,
    { requireMethod }: { requireMethod: boolean },
  ): { payload: IJsBridgeMessagePayload; roomId: string } | undefined {
    if (!raw || typeof raw !== 'object') {
      this.logInvalidPayload(eventName, raw, 'envelope is not an object');
      return undefined;
    }

    const { payload, roomId } = raw as {
      payload?: unknown;
      roomId?: unknown;
    };

    if (typeof roomId !== 'string' || !roomId) {
      this.logInvalidPayload(eventName, payload, 'roomId is missing');
      return undefined;
    }

    const checked = checkBridgePayload(payload, { requireMethod });
    if (!checked.valid) {
      this.logInvalidPayload(eventName, payload, checked.reason);
      return undefined;
    }

    // `socket.to(roomId)` is a delivery operator: it reads the membership of the
    // recipients and never checks the sender's. Without this, any connected
    // socket that knows a roomId can inject client-to-client calls into a room
    // it never joined - bypassing the room-slot invariant the pairing flow
    // relies on. Membership is authoritative in RoomManager, so ask it.
    if (
      !this.socketClient.rooms.has(roomId) ||
      !this.roomManager.isUserInRoom(roomId, this.socketClient.id).isInRoom
    ) {
      this.logInvalidPayload(eventName, payload, 'sender is not a room member');
      return undefined;
    }

    return { payload: checked.payload, roomId };
  }
}
