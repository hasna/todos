/**
 * Deterministic harness for tests that need a real todos server subprocess.
 *
 * Replaces the copy-pasted block that every server test used to carry:
 *
 *   port = 19600 + Math.floor(Math.random() * 100);   // guess a port
 *   proc = Bun.spawn([... `--port=${port}`]);          // hope it is free
 *   for (let i = 0; i < 50; i++) { fetch(...); sleep(200); }  // poll for 10s
 *
 * Three separate failure modes lived in those three lines:
 *
 *  1. A port picked out of a hardcoded 100-wide range collides — with a parallel
 *     run of the same file, with a sibling test file that happens to share the
 *     base (ratelimit and auth-fail-closed both used 19700), or with anything
 *     else on the box. Reserving the port first (bind, stop, hand the number to a
 *     child) only narrows the race, it does not close it: the port is unowned
 *     between the stop and the child's bind. Here the CHILD asks the kernel for
 *     an ephemeral port (`--port=0`) and reports what it got, so the port is
 *     never unowned and never guessed.
 *  2. Polling for readiness encodes a guess about how slow a cold `bun run` is.
 *     The server already announces itself on stdout once the socket is accepting
 *     ("Todos Dashboard running at http://localhost:<port>"), which is both the
 *     port discovery channel and an exact readiness edge — so there is nothing
 *     to poll and no sleep to tune.
 *  3. A server that dies during startup (bad env, migration failure, auth posture
 *     refusal) used to burn the whole budget and then fail with "did not start on
 *     port N" while the actual reason sat unread in the child's stderr. Startup
 *     races the child's exit, so a crash fails immediately WITH its stderr.
 */
import { join } from "node:path";
import { localRoutingTestEnv } from "./local-routing-env.fixture.test.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Emitted by `startServer` in src/server/serve.ts once the socket is bound. */
const READY_LINE = /Todos Dashboard running at http:\/\/localhost:(\d+)/;

/**
 * Time allowed for a cold `bun run src/server/index.ts` to reach its ready line.
 *
 * Not a round number for its own sake: measured on a contended workstation
 * (load average 60-66) a cold start took 5.4s-7.3s, because the child pays a
 * full TS transpile of the server import graph plus schema migration on a fresh
 * SQLite file. That already exceeds bun's 5s default per-test timeout, so the
 * budget has to be explicit. Sized at ~8x the worst observed start to stay green
 * on a runner several times more loaded than the one measured, which costs
 * nothing when the server is healthy: readiness resolves on the ready line and a
 * dead child rejects on exit, so this ceiling is only reached if the process
 * hangs without either succeeding or exiting.
 */
export const SERVER_START_BUDGET_MS = 60_000;

/** Shutdown is a signal plus process reap — bounded by the same reasoning. */
export const SERVER_STOP_BUDGET_MS = 30_000;

export interface TestServerOptions {
  /** Extra argv for the server entry point (e.g. `--allow-anonymous`). */
  args?: string[];
  /**
   * Env overrides layered on the local-routing baseline. Callers normally set
   * TODOS_DB_PATH to a per-test temp file.
   */
  env?: Record<string, string | undefined>;
}

export interface TestServer {
  /** The port the kernel actually assigned to the child. */
  readonly port: number;
  /** Absolute URL for a path on this server. */
  url(path: string): string;
  /** Everything the child wrote to stdout so far (diagnostics). */
  stdout(): string;
  /** Everything the child wrote to stderr so far (diagnostics). */
  stderr(): string;
  /** Signal the child and wait for it to be reaped. */
  stop(): Promise<void>;
}

function pump(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): void {
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }));
    } catch {
      // Stream torn down with the child on stop() — nothing left to report.
    }
  })();
}

/**
 * Spawns the server on a kernel-assigned port and resolves once it is accepting
 * connections. Rejects — with the child's stderr attached — if it exits first or
 * never announces itself.
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "src/server/index.ts",
      // 0 = ask the kernel for a free ephemeral port. The child reports the real
      // one on stdout; nothing here guesses or reserves.
      "--port=0",
      "--no-open",
      ...(options.args ?? []),
    ],
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({ TODOS_NO_OPEN: "true", ...options.env }),
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdoutText = "";
  let stderrText = "";
  let announcePort: ((port: number) => void) | undefined;
  const announced = new Promise<number>((resolve) => {
    announcePort = resolve;
  });

  pump(proc.stdout as ReadableStream<Uint8Array>, (text) => {
    stdoutText += text;
    const match = READY_LINE.exec(stdoutText);
    if (match) announcePort?.(Number(match[1]));
  });
  // Drained purely so a chatty child can never block on a full stderr pipe.
  pump(proc.stderr as ReadableStream<Uint8Array>, (text) => {
    stderrText += text;
  });

  const diagnostics = (): string =>
    `\n--- server stdout ---\n${stdoutText.trim() || "(empty)"}` +
    `\n--- server stderr ---\n${stderrText.trim() || "(empty)"}\n`;

  const crashed = proc.exited.then((code) => {
    throw new Error(`Test server exited with code ${code} before it was ready.${diagnostics()}`);
  });

  let expire: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    expire = setTimeout(
      () =>
        reject(
          new Error(
            `Test server produced no ready line within ${SERVER_START_BUDGET_MS}ms.${diagnostics()}`,
          ),
        ),
      SERVER_START_BUDGET_MS,
    );
  });

  let port: number;
  try {
    port = await Promise.race([announced, crashed, expired]);
  } catch (error) {
    proc.kill();
    await proc.exited;
    throw error;
  } finally {
    if (expire) clearTimeout(expire);
    // The crash promise rejects if the child exits later (e.g. at stop()); that
    // rejection is expected and must not surface as an unhandled rejection.
    void crashed.catch(() => {});
  }

  return {
    port,
    url: (path: string) => `http://localhost:${port}${path}`,
    stdout: () => stdoutText,
    stderr: () => stderrText,
    stop: async () => {
      proc.kill();
      await proc.exited;
    },
  };
}
