/* eslint-disable prettier/prettier */
/* eslint-disable no-restricted-syntax */
/* eslint-disable new-cap */

import { JsBridgeE2EEServer } from './JsBridgeE2EEServer';
import { E2eeError, E2eeErrorCode } from './errors';
import { memoizee } from './utils/cacheUtils';
import { buildCallRemoteApiMethod } from './utils/RemoteApiProxyBase';

import type { IRoomManagerContext, RoomManager } from './roomManager';
import type { IE2EEServerApiKeys } from './types';
import type {
  IJsBridgeConfig,
  IJsonRpcRequest,
} from '@onekeyfe/cross-inpage-provider-types';
import type { Socket } from 'socket.io';

/**
 * The bundled debug logger registers a `once('debugReady')` listener on a
 * process-global emitter for every bridge message. Server side that event never
 * fires, so the listeners pile up for the lifetime of the process - enough to
 * trip MaxListenersExceededWarning at 10k messages.
 *
 * Nothing consumes that output here; structured logs go through utils/logger.
 * Handing the bridge a no-op keeps the listener list empty.
 */
const noopDebugLogger = {
  jsBridge: () => undefined,
} as unknown as IJsBridgeConfig['debugLogger'];

function createBridgeE2EEServer({
  socketClient,
  roomManager,
}: {
  socketClient: Socket;
  roomManager: RoomManager;
}) {
  const createE2EEServerApiModule = memoizee(
    async (name: IE2EEServerApiKeys) => {
      if (name === 'roomManager') {
        return roomManager;
      }
      throw new E2eeError(E2eeErrorCode.UNKNOWN_API_MODULE, `Unknown E2EE Server API module: ${name as string}`);
    },
    {
      promise: true,
    },
  );

  const context: IRoomManagerContext = { socketClient };

  const callE2EEServerApiMethod = buildCallRemoteApiMethod(
    createE2EEServerApiModule,
    'e2eeServerApi',
    context,
  );

  return new JsBridgeE2EEServer(
    {
      debugLogger: noopDebugLogger,
      receiveHandler: async (payload) => {
        const req: IJsonRpcRequest = payload.data as IJsonRpcRequest;

        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const result = await callE2EEServerApiMethod(req);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return result;
      },
    },
    {
      socketClient,
    },
  );
}

export function e2eeServerApiSetup({
  socketClient,
  roomManager,
}: {
  socketClient: Socket;
  roomManager: RoomManager;
}) {
  const bridge = createBridgeE2EEServer({
    socketClient,
    roomManager,
  });
  return bridge;
}
