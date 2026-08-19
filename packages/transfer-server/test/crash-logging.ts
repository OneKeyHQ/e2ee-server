/**
 * Guarantees that a crash is never silent: every process-level fault must leave
 * a structured fatal line on stdout, so it reaches log collection (OpenSearch)
 * and can be alerted on with `level:fatal`.
 *
 * Spawns the real built server per case, triggers a genuine escaping fault, and
 * asserts a `level:"fatal"` JSON line landed on stdout (fd 1), not just stderr.
 *
 * Run with `yarn test:crash` from packages/transfer-server.
 */
import { spawn } from 'child_process';
import { join } from 'path';

const SERVER_ENTRY = join(__dirname, '..', 'dist', 'server.js');
const NODE_COMPAT = join(__dirname, '..', 'dist', 'utils', 'nodeCompat.js');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

/**
 * Run a snippet in a child that first loads the real server (installing the
 * process guards and the real pino config), and capture fd 1 and fd 2
 * separately so we can prove where the fatal line landed.
 */
function runChild(
  port: number,
  trigger: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const script = `
    require(${JSON.stringify(NODE_COMPAT)});
    process.env.PORT = ${JSON.stringify(String(port))};
    require(${JSON.stringify(SERVER_ENTRY)});
    setTimeout(() => { ${trigger} }, 600);
    setTimeout(() => process.exit(0), 2000);
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function hasFatal(stdout: string, msg: string): boolean {
  return stdout
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      try {
        const entry = JSON.parse(line) as { level?: string; msg?: string };
        return entry.level === 'fatal' && entry.msg === msg;
      } catch {
        return false;
      }
    });
}

async function main(): Promise<void> {
  let port = 45_000;

  // 1. uncaughtException via a setTimeout rethrow - the safeApply landmine shape
  {
    const { stdout, stderr } = await runChild(port, "setTimeout(() => { throw new Error('boom-timer'); }, 0);");
    port += 1;
    check(hasFatal(stdout, 'process.uncaughtException'), 'uncaughtException logs fatal to stdout');
    check(!hasFatal(stderr, 'process.uncaughtException'), 'fatal goes to stdout, not stderr');
  }

  // 2. unhandledRejection with no catch anywhere
  {
    const { stdout } = await runChild(port, "Promise.reject(new Error('boom-reject'));");
    port += 1;
    check(hasFatal(stdout, 'process.unhandledRejection'), 'unhandledRejection logs fatal to stdout');
  }

  // 3. a thrown non-Error value must still be logged, not swallowed
  {
    const { stdout } = await runChild(port, 'setTimeout(() => { throw { weird: 1 }; }, 0);');
    port += 1;
    check(hasFatal(stdout, 'process.uncaughtException'), 'thrown non-Error value still logs fatal');
  }

  // 4. a listen() failure (port already held) must log fatal and exit non-zero
  {
    const holder = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await wait(2500);
    const conflict = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
      const child = spawn(process.execPath, [SERVER_ENTRY], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString();
      });
      child.on('close', (code) => resolve({ stdout, code }));
    });
    holder.kill('SIGKILL');
    check(hasFatal(conflict.stdout, 'server.listenFailed'), 'port conflict logs fatal to stdout');
    check(conflict.code === 1, 'port conflict exits non-zero instead of lingering', `exit code ${String(conflict.code)}`);
  }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'CRASH LOGGING TEST PASSED' : `CRASH LOGGING TEST FAILED (${failures})`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err: Error) => {
    console.log(`\nCRASH LOGGING TEST ERRORED: ${err.message}\n`);
    process.exit(1);
  });
