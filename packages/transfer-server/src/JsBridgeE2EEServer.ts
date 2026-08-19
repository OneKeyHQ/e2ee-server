/* eslint-disable no-restricted-syntax */
import { JsBridgeBase } from '@onekeyfe/cross-inpage-provider-core';
import { IJsBridgeMessageTypes } from '@onekeyfe/cross-inpage-provider-types';

import { E2eeError, E2eeErrorCode } from './errors';
import { createModuleLogger } from './utils/logger';

import type {
  IJsBridgeConfig,
  IJsBridgeMessagePayload,
  IJsonRpcRequest,
} from '@onekeyfe/cross-inpage-provider-types';
import type { Socket } from 'socket.io';

const logger = createModuleLogger('jsBridge');

const RATE_LIMIT_INTERVAL_MS = 3000;
const lastRequestTime: Map<string, number> = new Map();

const CLIENT_TO_CLIENT_RATE_LIMIT_ERROR_CODE = -387_155_488;

// Rate limiting whitelist - methods that are exempt from rate limiting
const RATE_LIMIT_WHITELIST = new Set([
  'changeTransferDirection',
  'getRoomUsers',
  'leaveRoom',
  'cancelTransfer',
]);

const SUPPORTED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  IJsBridgeMessageTypes.REQUEST,
  IJsBridgeMessageTypes.RESPONSE,
]);

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

  if (!payload.type || !SUPPORTED_MESSAGE_TYPES.has(payload.type)) {
    return { valid: false, reason: 'payload.type is missing or unsupported' };
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
    { socketClient }: { socketClient: Socket },
  ) {
    super(config);
    this.socketClient = socketClient;
    this.setup();
  }

  private socketClient: Socket;

  override sendAsString = false;

  sendPayload(payload: IJsBridgeMessagePayload | string): void {
    const p = payload as IJsBridgeMessagePayload;
    const e = p?.error as { message: string; code: number } | undefined;
    if (e && e?.code && e?.code === CLIENT_TO_CLIENT_RATE_LIMIT_ERROR_CODE) {
      this.socketClient.emit('e2ee-c2c-response', payload);
      return;
    }
    this.socketClient.emit('e2ee-response', payload);
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
  private logInvalidPayload(
    eventName: string,
    raw: unknown,
    reason: string,
  ): void {
    const payload = (
      raw && typeof raw === 'object' ? raw : {}
    ) as IJsBridgeMessagePayload;
    const req = payload.data as IJsonRpcRequest | undefined;
    logger.warn(
      {
        eventName,
        reason,
        socketId: this.socketClient.id,
        payloadType: typeof payload.type === 'string' ? payload.type : null,
        payloadMethod: typeof req?.method === 'string' ? req.method : null,
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

    // Check if method is in whitelist
    if (RATE_LIMIT_WHITELIST.has(method)) {
      return false;
    }

    const rateLimitKey = `${this.socketClient.id}:${eventName}:${method}`;

    const now = Date.now();
    const lastTime = lastRequestTime.get(rateLimitKey) || 0;

    if (now - lastTime < RATE_LIMIT_INTERVAL_MS) {
      sendErrorResponse();
      return true;
    }

    lastRequestTime.set(rateLimitKey, now);
    return false;
  }

  private buildRateLimitResponder(payload: IJsBridgeMessagePayload) {
    return () => {
      logger.debug(
        { socketId: this.socketClient.id },
        'jsBridge.rateLimitExceeded',
      );
      this.responseError({
        id: payload.id || -9999,
        error: new E2eeError(
          E2eeErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit, please try again later',
        ),
        scope: payload.scope,
        remoteId: payload.remoteId,
        peerOrigin: payload.peerOrigin,
      });
    };
  }

  setup() {
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
          sendErrorResponse: this.buildRateLimitResponder(p),
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
        const envelope = this.checkC2cEnvelope('e2ee-c2c-request', raw, {
          requireMethod: true,
        });
        if (!envelope) {
          return;
        }
        const { payload: p, roomId } = envelope;

        const isRateLimited = this.checkIsRateLimited({
          payload: p,
          eventName: 'e2ee-c2c-request',
          sendErrorResponse: this.buildRateLimitResponder(p),
        });

        if (isRateLimited) {
          return;
        }

        this.socketClient.to(roomId).emit('e2ee-c2c-request', p);
      }),
    );

    this.socketClient.on(
      'e2ee-c2c-response',
      this.safeHandler<unknown>('e2ee-c2c-response', (raw) => {
        // a response carries a result rather than a method, so `method` is not required
        const envelope = this.checkC2cEnvelope('e2ee-c2c-response', raw, {
          requireMethod: false,
        });
        if (!envelope) {
          return;
        }
        const { payload: p, roomId } = envelope;

        this.socketClient.to(roomId).emit('e2ee-c2c-response', p);
      }),
    );
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

    return { payload: checked.payload, roomId };
  }
}
