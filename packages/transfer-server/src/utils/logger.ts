import { hostname } from 'os';

import pino from 'pino';

import type { DestinationStream, Logger } from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Pretty output is opt-in and only meant for local development:
// `pino-pretty` is a devDependency and must never be a hard requirement at runtime.
const LOG_PRETTY =
  process.env.LOG_PRETTY === '1' || process.env.NODE_ENV === 'development';

function createPrettyStream(): DestinationStream | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, @typescript-eslint/no-unsafe-assignment
    const pretty = require('pino-pretty') as (
      options: Record<string, unknown>,
    ) => DestinationStream;
    return pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,host,svc',
      sync: true,
    });
  } catch {
    // pino-pretty is not installed (production image) - fall back to JSON output
    return undefined;
  }
}

function createLogStream(): DestinationStream {
  if (LOG_PRETTY) {
    const prettyStream = createPrettyStream();
    if (prettyStream) {
      return prettyStream;
    }
  }

  // `sync: true` writes straight to fd 1 instead of buffering.
  //
  // In a container stdout is a pipe, and Node writes to pipes asynchronously.
  // Anything still sitting in that buffer is lost when the process dies, which
  // is exactly the log line we care about most (uncaughtException / SIGTERM).
  // Traffic here is low enough that the synchronous write costs us nothing.
  return pino.destination({ dest: 1, sync: true });
}

export const logger: Logger = pino(
  {
    level: LOG_LEVEL,
    base: {
      svc: 'transfer-server',
      pid: process.pid,
      host: hostname(),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // emit `"level":"error"` instead of `"level":50` so log platforms can
      // filter and alert on the level without a numeric lookup table
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  },
  createLogStream(),
);

/**
 * Create a namespaced logger, e.g. `createModuleLogger('roomManager')`.
 * Every line it emits carries `mod` so a single module can be isolated in search.
 */
export function createModuleLogger(mod: string): Logger {
  return logger.child({ mod });
}

export default {
  logger,
  createModuleLogger,
};
