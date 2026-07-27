/**
 * Port resolution shared by every entry point that can start the dashboard
 * server: the standalone `todos-serve` entry (src/server/index.ts) and the
 * `todos serve` CLI command (src/cli/commands/config-serve-commands.ts).
 *
 * These had independent copies of the same two primitives, and only one of them
 * was ever hardened — so `todos-serve --port=abc` fell back to the default while
 * `todos serve --port abc` passed NaN through to Bun.serve and silently bound a
 * random ephemeral port. One parser, one scan, one default.
 */

/** Documented default port for the dashboard/API server. */
export const DEFAULT_PORT = 19427;

/**
 * Parses a port, returning undefined for anything that is not a valid one.
 *
 * `0` is MEANINGFUL: it asks the kernel for a free ephemeral port. Coercing with
 * `parseInt(...) || DEFAULT_PORT` silently rewrote `--port=0` to the default,
 * which made "let the OS pick a port" impossible to request — the reason
 * subprocess tests used to guess ports out of hardcoded ranges and race each
 * other for them. Only reject values that are not a port at all.
 */
export function coercePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return undefined;
  return parsed;
}

/**
 * Finds the first free port at or after `start`, scanning a bounded window.
 *
 * Only for the IMPLICIT default. A port the caller asked for explicitly must be
 * bound exactly, or a container health check would target the wrong one.
 */
export async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("") });
      server.stop(true);
      return port;
    } catch {
      // Port in use, try next
    }
  }
  return start; // fallback
}
