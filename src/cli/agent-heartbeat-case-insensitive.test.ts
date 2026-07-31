import { afterEach, describe, expect, test } from "bun:test";
import { cloudHeartbeatAgent, cloudReleaseAgent, getTodosCloudClient, resetTodosCloudClient } from "./cloud-router.js";

/**
 * Regression coverage for todos task c543377c.
 *
 * 0.13.4 (task 0bf5d979) made agent-name lookup case-INSENSITIVE on the READ
 * path — `todos agent <name>` resolves every casing to one record. It left the
 * WRITE path alone: `cloudHeartbeatAgent` / `cloudReleaseAgent` interpolated the
 * RAW user input straight into `POST /agents/<raw>/heartbeat`, so the authority
 * matched it exactly.
 *
 * That is the surface the original bug was actually about. `heartbeat` IS the
 * write path for `last_seen_at`, so while it stayed case-split the divergence
 * 0bf5d979 was filed against kept being actively produced: two rows spelled
 * `fabricius` and `Fabricius` each received their own heartbeats, and anyone who
 * typed the capital could keep a STALE TWIN looking alive. A coordinator reading
 * the twin sees silence and kills a live agent.
 *
 * The roster below is the measured production shape (2026-07-31):
 *   fabricius  01d4cc12  live   <- freshest
 *   Fabricius  4d77b218  stale  (last seen a day earlier)
 *   hermes     b44a8dbc  OLDEST <- the control described below
 *
 * `hermes` is deliberately the oldest row in the roster. A fix that resolves by
 * "return the freshest agent" rather than "the freshest agent WHOSE NAME
 * matches" would send hermes's heartbeat to 01d4cc12, and that is exactly the
 * silent cross-agent write this test exists to catch.
 */

const CLOUD_ENV = {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.example.com",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
} as never;

const LIVE_FABRICIUS = { id: "01d4cc12", name: "fabricius", last_seen_at: "2026-07-31T11:00:00.000Z" };
const STALE_FABRICIUS = { id: "4d77b218", name: "Fabricius", last_seen_at: "2026-07-30T09:00:00.000Z" };
const HERMES = { id: "b44a8dbc", name: "hermes", last_seen_at: "2026-07-29T08:00:00.000Z" };

type Call = { url: string; method: string };

let previousFetch: typeof globalThis.fetch | undefined;

/**
 * Serve a roster on `GET /v1/agents` and answer a heartbeat/release POST only
 * when the path segment is an EXACT id or name in that roster — which is what
 * the authority does, and the reason a raw case-variant 404s today.
 */
function installRoster(roster: ReadonlyArray<{ id: string; name: string; last_seen_at: string }>): Call[] {
  previousFetch ??= globalThis.fetch;
  const calls: Call[] = [];
  (globalThis as never as { fetch: unknown }).fetch = async (input: unknown, init: { method?: string } = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url, method });

    if (method === "GET" && /\/v1\/agents(\?|$)/.test(url)) {
      return new Response(JSON.stringify({ agents: roster }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const match = /\/v1\/agents\/([^/]+)\/(heartbeat|release)$/.exec(url);
    if (match && method === "POST") {
      const ref = decodeURIComponent(match[1]!);
      const hit = roster.find((a) => a.id === ref || a.name === ref);
      if (!hit) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const agent = { ...hit, last_seen_at: "2026-07-31T12:00:00.000Z" };
      return new Response(JSON.stringify(match[2] === "release" ? { agent, released: true } : { agent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

/** The id the heartbeat/release POST actually targeted. */
function postedRef(calls: readonly Call[]): string | null {
  const post = calls.find((c) => c.method === "POST");
  if (!post) return null;
  const m = /\/v1\/agents\/([^/]+)\/(?:heartbeat|release)$/.exec(post.url);
  return m ? decodeURIComponent(m[1]!) : null;
}

afterEach(() => {
  if (previousFetch) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }
  resetTodosCloudClient();
});

describe("c543377c — heartbeat resolves agent names case-insensitively (write path)", () => {
  test("a capitalised variant beats the LIVE row, not the stale twin", async () => {
    const calls = installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const agent = await cloudHeartbeatAgent(client, "Fabricius");

    // The whole point: the capital must NOT keep 4d77b218 looking alive.
    expect(postedRef(calls)).toBe("01d4cc12");
    expect(agent?.id).toBe("01d4cc12");
  });

  test("every casing of one name reaches the SAME record", async () => {
    const seen: string[] = [];
    for (const spelling of ["fabricius", "Fabricius", "FABRICIUS", "  FaBrIcIuS  "]) {
      const calls = installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await cloudHeartbeatAgent(client, spelling);
      seen.push(postedRef(calls)!);
      resetTodosCloudClient();
    }
    expect(seen).toEqual(["01d4cc12", "01d4cc12", "01d4cc12", "01d4cc12"]);
  });

  test("an all-caps name whose row exists in ONE spelling still resolves (was a 404)", async () => {
    const calls = installRoster([LIVE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const agent = await cloudHeartbeatAgent(client, "FABRICIUS");

    expect(postedRef(calls)).toBe("01d4cc12");
    expect(agent?.id).toBe("01d4cc12");
  });

  test("CONTROL — a distinct agent still beats its OWN record, not the freshest one", async () => {
    // hermes is the OLDEST row here. "resolve to the newest agent" passes every
    // test above and fails this one.
    const calls = installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const agent = await cloudHeartbeatAgent(client, "Hermes");

    expect(postedRef(calls)).toBe("b44a8dbc");
    expect(agent?.id).toBe("b44a8dbc");
  });

  test("CONTROL — a genuinely nonexistent name STILL fails", async () => {
    installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    // Must not be "fixed" by making every name succeed.
    expect(cloudHeartbeatAgent(client, "nosuchagent")).rejects.toThrow();
  });

  test("an exact agent id is still honoured verbatim", async () => {
    const calls = installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const agent = await cloudHeartbeatAgent(client, "4d77b218");

    // Addressing a row by id is explicit and must keep working — including for
    // the stale twin, which is how anyone would ever repair it.
    expect(postedRef(calls)).toBe("4d77b218");
    expect(agent?.id).toBe("4d77b218");
  });

  test("release shares the write path and the same defect", async () => {
    const calls = installRoster([LIVE_FABRICIUS, STALE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const result = await cloudReleaseAgent(client, "Fabricius");

    expect(postedRef(calls)).toBe("01d4cc12");
    expect(result.agent?.id).toBe("01d4cc12");
  });

  test("CONTROL — release of a nonexistent name STILL fails", async () => {
    installRoster([LIVE_FABRICIUS, HERMES]);
    const client = getTodosCloudClient(CLOUD_ENV)!;

    expect(cloudReleaseAgent(client, "nosuchagent")).rejects.toThrow();
  });
});
