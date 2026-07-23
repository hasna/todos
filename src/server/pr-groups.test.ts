import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { PrGroupLedger } from "../pr-groups/ledger.js";
import { SqlitePrGroupLedgerPersistence } from "../pr-groups/sqlite.js";
import type { PrGroupLedgerPersistence } from "../pr-groups/types.js";
import { handlePrGroupHttpRequest } from "./pr-groups.js";

function remoteLedger(db: Database): PrGroupLedger {
  const local = new SqlitePrGroupLedgerPersistence(db);
  const persistence: PrGroupLedgerPersistence = {
    authority: "remote",
    transaction: (fn) => local.transaction(fn),
    getGroup: (id) => local.getGroup(id),
    listAttempts: (id) => local.listAttempts(id),
    listEvents: (id, options) => local.listEvents(id, options),
    listReceiptEvents: (id, limit) => local.listReceiptEvents(id, limit),
    countEvents: (id) => local.countEvents(id),
    getLatestEvent: (id) => local.getLatestEvent(id),
  };
  return new PrGroupLedger(persistence);
}

async function call(
  ledger: PrGroupLedger,
  prefix: "/api/pr-groups" | "/v1/pr-groups",
  suffix: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const url = new URL(`https://todos.example.test${prefix}${suffix}`);
  return (await handlePrGroupHttpRequest(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, ledger, prefix))!;
}

describe("shared local and cloud PR-group HTTP contract", () => {
  let localDb: Database;
  let remoteDb: Database;
  let local: PrGroupLedger;
  let remote: PrGroupLedger;

  beforeEach(() => {
    localDb = new Database(":memory:");
    remoteDb = new Database(":memory:");
    for (const db of [localDb, remoteDb]) {
      db.exec("PRAGMA foreign_keys = ON");
      runMigrations(db);
    }
    local = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(localDb));
    remote = remoteLedger(remoteDb);
  });

  afterEach(() => {
    localDb.close();
    remoteDb.close();
  });

  test("uses equivalent authoritative behavior and envelopes for /api and /v1", async () => {
    const input = {
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      provider: "codewith",
      provider_run_id: "run-1",
      profile_alias: "account012",
      admitted_at: "2026-07-23T10:00:00.000Z",
    };
    const [localAdmission, remoteAdmission] = await Promise.all([
      call(local, "/api/pr-groups", "/admit", "POST", input),
      call(remote, "/v1/pr-groups", "/admit", "POST", input),
    ]);
    expect(localAdmission.status).toBe(201);
    expect(remoteAdmission.status).toBe(201);
    const localBody = await localAdmission.json() as Record<string, any>;
    const remoteBody = await remoteAdmission.json() as Record<string, any>;
    expect(remoteBody.view.authority).toBe("remote");
    expect(localBody.view.authority).toBe("local");
    expect(remoteBody.view.group).toEqual(localBody.view.group);
    expect(remoteBody.view.attempts).toEqual(localBody.view.attempts);
    expect(remoteBody.event).toEqual(localBody.event);

    const groupId = localBody.view.group.id as string;
    const attemptId = localBody.view.attempts[0].id as string;
    for (const [ledger, prefix] of [
      [local, "/api/pr-groups"],
      [remote, "/v1/pr-groups"],
    ] as const) {
      expect((await call(ledger, prefix, `/${groupId}/events`, "POST", {
        attempt_id: attemptId,
        writer_generation: "generation-1",
        idempotency_key: "progress-1",
        event_type: "progress",
        created_at: "2026-07-23T10:01:00.000Z",
      })).status).toBe(201);
      const state = await call(ledger, prefix, `/${groupId}`);
      expect(await state.json()).toMatchObject({
        view: { authoritative: true, group: { state: "in_progress" } },
      });
      const history = await call(ledger, prefix, `/${groupId}/events?limit=1`);
      expect(await history.json()).toMatchObject({
        history: { authoritative: true, count: 1, has_more: true },
      });
    }
  });

  test("returns the same stable fenced error instead of partial success", async () => {
    const admit = await call(remote, "/v1/pr-groups", "/admit", "POST", {
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
    });
    const body = await admit.json() as Record<string, any>;
    const response = await call(remote, "/v1/pr-groups", `/${body.view.group.id}/events`, "POST", {
      attempt_id: body.view.attempts[0].id,
      writer_generation: "stale-generation",
      idempotency_key: "stale-1",
      event_type: "progress",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "PR_GROUP_WRITER_FENCED",
      authoritative: true,
    });
  });
});
