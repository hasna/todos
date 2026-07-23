import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrGroupHttpClient } from "./http-client.js";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env["HASNA_TODOS_DB_PATH"];
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("PR-group fail-closed HTTP client", () => {
  test("accepts complete authoritative remote state and event envelopes", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/events")) {
        return Response.json({
          history: {
            schema_version: 1,
            authoritative: true,
            authority: "remote",
            group_id: "prg_test",
            events: [],
            count: 0,
            has_more: false,
            next_sequence: null,
          },
        });
      }
      return Response.json({
        view: {
          schema_version: 1,
          authoritative: true,
          authority: "remote",
          group: { id: "prg_test" },
          attempts: [],
          latest_event: null,
          review_receipts: [],
          conditional_merge_receipts: [],
          cleanup_eligible: false,
          adapters: {},
          diagnostics: {},
        },
      });
    }) as typeof fetch;
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl,
    });
    expect((await client.get("prg_test")).authority).toBe("remote");
    expect((await client.events("prg_test")).events).toEqual([]);
  });

  test("remote failure and malformed empty responses never become authoritative success or shadow SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-group-http-"));
    tempDirs.push(dir);
    const shadowPath = join(dir, "shadow.db");
    process.env["HASNA_TODOS_DB_PATH"] = shadowPath;

    const unavailable = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => { throw new Error("network down"); }) as typeof fetch,
    });
    await expect(unavailable.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_UNAVAILABLE",
    });
    expect(existsSync(shadowPath)).toBe(false);

    const malformed = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json([])) as typeof fetch,
    });
    await expect(malformed.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    await expect(malformed.events("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    expect(existsSync(shadowPath)).toBe(false);
  });

  test("rejects authoritative envelopes bound to a different PR-group identity", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/events")) {
          return Response.json({
            history: {
              schema_version: 1,
              authoritative: true,
              authority: "remote",
              group_id: "prg_other",
              events: [],
              count: 0,
              has_more: false,
              next_sequence: null,
            },
          });
        }
        return Response.json({
          view: {
            schema_version: 1,
            authoritative: true,
            authority: "remote",
            group: { id: "prg_other" },
            attempts: [],
            latest_event: null,
            review_receipts: [],
            conditional_merge_receipts: [],
            cleanup_eligible: false,
            adapters: {},
            diagnostics: {},
          },
        });
      }) as typeof fetch,
    });
    await expect(client.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    await expect(client.events("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
  });

  test("preserves stable authoritative error codes without returning partial data", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        error: "writer fenced",
        code: "PR_GROUP_WRITER_FENCED",
        details: { group_id: "prg_test" },
      }, { status: 409 })) as typeof fetch,
    });
    await expect(client.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_WRITER_FENCED",
      details: { status: 409 },
    });
  });

  test("rejects mutation envelopes with inconsistent event lineage", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        created: true,
        adopted: false,
        appended: true,
        event: { group_id: "prg_other", attempt_id: "pra_other" },
        view: {
          schema_version: 1,
          authoritative: true,
          authority: "remote",
          group: { id: "prg_test" },
          attempts: [{ id: "pra_test" }],
          latest_event: null,
          review_receipts: [],
          conditional_merge_receipts: [],
          cleanup_eligible: false,
          adapters: {},
          diagnostics: {},
        },
      })) as typeof fetch,
    });
    await expect(client.append({
      group_id: "prg_test",
      attempt_id: "pra_test",
      writer_generation: "generation-1",
      idempotency_key: "event-1",
      event_type: "progress",
    })).rejects.toMatchObject({ code: "PR_GROUP_REMOTE_INVALID_RESPONSE" });
  });
});
