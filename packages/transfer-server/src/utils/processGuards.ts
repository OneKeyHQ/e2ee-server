/**
 * Process-level crash guards. Imported for its side effect, as early as
 * possible, so the handlers are registered before any other module is
 * evaluated. That ordering matters: a dependency that throws while its module
 * is being loaded (the shape of the Node 25 localStorage crash) would otherwise
 * die with only Node's native multi-line stderr trace, which log collection
 * splits into disconnected lines with no level to alert on. With the guard
 * already in place even an import-time throw is logged as one structured
 * `fatal` line on stdout.
 *
 * The only crash this cannot structure is the logger itself failing to load,
 * which falls back to native stderr - unavoidable, and stderr is still
 * collected.
 */
import { logger } from './logger';

let serverStarted = false;

/**
 * Called once the server is listening. It flips the guards from "exit on fault"
 * to "keep the process alive".
 *
 * Before this point a fault means startup never completed - there are no live
 * sessions to protect and the process is likely half-initialised, so exiting
 * for a clean restart by the orchestrator is the right move. After it, the
 * faulting request is already lost but the other in-memory sessions are not, so
 * the single-replica process stays up rather than dropping everyone.
 */
export function markServerStarted(): void {
  serverStarted = true;
}

function handleFatal(event: string, err: unknown, extra: Record<string, unknown> = {}): void {
  try {
    logger.fatal({ err, serverStarted, ...extra }, event);
  } catch {
    // never let the guard itself throw
  }
  if (!serverStarted) {
    process.exit(1);
  }
}

process.on('uncaughtException', (error, origin) => {
  handleFatal('process.uncaughtException', error, { origin });
});

process.on('unhandledRejection', (reason) => {
  handleFatal('process.unhandledRejection', reason);
});
