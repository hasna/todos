import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import {
  PrGroupLedger,
  deterministicPrGroupId,
  deterministicPrGroupAttemptId,
} from "./ledger.js";
import { SqlitePrGroupLedgerPersistence } from "./sqlite.js";
import type { AdmitPrGroupInput, AppendPrGroupEventInput } from "./types.js";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const T0 = "2026-07-23T10:00:00.000Z";

function admission(overrides: Partial<AdmitPrGroupInput> = {}): AdmitPrGroupInput {
  return {
    root_request_id: "request-root-1",
    repository: "hasna/todos",
    leaf_task_id: "leaf-task-1",
    dispatch_attempt: "dispatch-1",
    writer_generation: "generation-1",
    worktree: "/tmp/pr-group-ledger",
    branch: "feat/pr-group-ledger",
    provider: "codewith",
    provider_run_id: "provider-run-1",
    profile_alias: "account012",
    admitted_at: T0,
    ...overrides,
  };
}

describe("authoritative PR-group ledger", () => {
  let db: Database;
  let ledger: PrGroupLedger;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
    ledger = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(db));
  });

  afterEach(() => db.close());

  test("creates deterministic lineage and idempotently adopts one active writer", async () => {
    expect(deterministicPrGroupId("request-root-1", "HTTPS://github.com/Hasna/Todos.git"))
      .toBe(deterministicPrGroupId("request-root-1", "hasna/todos"));

    const results = await Promise.all(Array.from({ length: 8 }, () => ledger.admit(admission())));
    expect(results.filter((result) => result.appended)).toHaveLength(1);
    expect(results.filter((result) => result.adopted)).toHaveLength(7);

    const first = results[0]!;
    const groupId = deterministicPrGroupId("request-root-1", "hasna/todos");
    const attemptId = deterministicPrGroupAttemptId(groupId, "leaf-task-1", "dispatch-1");
    expect(first.view.group).toMatchObject({
      id: groupId,
      root_request_id: "request-root-1",
      repository: "hasna/todos",
      active_attempt_id: attemptId,
      active_generation: "generation-1",
    });
    expect(first.view.attempts[0]).toMatchObject({
      id: attemptId,
      leaf_task_id: "leaf-task-1",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group-ledger",
      branch: "feat/pr-group-ledger",
      provider_run_id: "provider-run-1",
      profile_alias: "account012",
    });
    expect(first.view.adapters.work_runs[0]).toMatchObject({
      kind: "WorkRun",
      id: attemptId,
      task_id: "leaf-task-1",
    });
    expect(first.view.adapters.decision_envelope.kind).toBe("DecisionEnvelope");

    await expect(ledger.admit(admission({
      dispatch_attempt: "dispatch-2",
      writer_generation: "generation-2",
    }))).rejects.toMatchObject({ code: "PR_GROUP_WRITER_FENCED" });
  });

  test("serializes split-brain admission across persistence instances sharing one SQLite authority", async () => {
    const alternate = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(db));
    const results = await Promise.all([
      ledger.admit(admission()),
      alternate.admit(admission()),
      ledger.admit(admission()),
      alternate.admit(admission()),
    ]);
    expect(results.filter((result) => result.appended)).toHaveLength(1);
    expect(results.filter((result) => result.adopted)).toHaveLength(3);
    expect(db.query("SELECT COUNT(*) AS count FROM pr_group_events").get()).toEqual({ count: 1 });
  });

  test("binds review and conditional merge receipts to an exact head and preserves terminal history", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Omit<AppendPrGroupEventInput, "group_id" | "attempt_id" | "writer_generation">) =>
      ledger.append({
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: "generation-1",
        created_at: T0,
        ...event,
      });

    await append({ idempotency_key: "started-1", event_type: "started" });
    await append({ idempotency_key: "progress-1", event_type: "progress", message: "implemented" });
    await append({ idempotency_key: "handoff-1", event_type: "handoff", head_sha: null });
    await append({ idempotency_key: "review-request-1", event_type: "review_requested", head_sha: HEAD_A });

    await expect(append({
      idempotency_key: "wrong-review-head",
      event_type: "review_receipt",
      head_sha: HEAD_B,
      receipt_key: "review-wrong-head",
      outcome: "approved",
    })).rejects.toMatchObject({ code: "PR_GROUP_EXACT_HEAD_REQUIRED" });

    await append({
      idempotency_key: "review-1",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-receipt-1",
      outcome: "approved",
    });
    const lateHeartbeat = await append({
      idempotency_key: "late-heartbeat-after-review",
      event_type: "heartbeat",
    });
    expect(lateHeartbeat.view.attempts[0]!.status).toBe("reviewing");
    await expect(append({
      idempotency_key: "conditional-wrong-head",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_B,
      receipt_key: "conditional-wrong",
    })).rejects.toMatchObject({ code: "PR_GROUP_REVIEW_REQUIRED" });

    await append({
      idempotency_key: "conditional-1",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-receipt-1",
    });
    await expect(append({
      idempotency_key: "receipt-replay",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-receipt-1",
    })).rejects.toMatchObject({ code: "PR_GROUP_RECEIPT_REPLAY" });

    const merged = await append({
      idempotency_key: "merge-1",
      event_type: "merge_outcome",
      head_sha: HEAD_A,
      outcome: "merged",
    });
    expect(merged.view.group).toMatchObject({
      state: "merged",
      terminal_outcome: "merged",
      terminal_head_sha: HEAD_A,
      active_generation: null,
    });
    await expect(append({
      idempotency_key: "late-progress",
      event_type: "progress",
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });

    const cleanup = await append({
      idempotency_key: "cleanup-1",
      event_type: "cleanup_eligible",
    });
    expect(cleanup.view).toMatchObject({ cleanup_eligible: true });
    expect(cleanup.view.group.terminal_outcome).toBe("merged");
    expect(cleanup.view.review_receipts).toHaveLength(1);
    expect(cleanup.view.conditional_merge_receipts).toHaveLength(1);
    expect(cleanup.view.adapters.proof_bundle).toMatchObject({
      kind: "ProofBundle",
      exact_head: HEAD_A,
      complete: true,
    });
    await expect(append({
      idempotency_key: "cleanup-2",
      event_type: "cleanup_eligible",
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
  });

  test("recovery fences stale generations while preserving all prior attempt evidence", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const firstAttempt = admitted.view.attempts[0]!.id;
    await ledger.append({
      group_id: groupId,
      attempt_id: firstAttempt,
      writer_generation: "generation-1",
      idempotency_key: "first-progress",
      event_type: "progress",
      message: "before recovery",
      created_at: T0,
    });

    const recoveryInput = {
      group_id: groupId,
      leaf_task_id: "leaf-task-1",
      dispatch_attempt: "dispatch-2",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/pr-group-ledger-2",
      branch: "feat/pr-group-ledger-recovery",
      provider: "codewith",
      provider_run_id: "provider-run-2",
      profile_alias: "account012",
      idempotency_key: "recovery-1",
      recovered_at: T0,
    };
    const recovered = await ledger.recover(recoveryInput);
    const secondAttempt = recovered.view.attempts.at(-1)!.id;
    expect(recovered.view.attempts).toEqual([
      expect.objectContaining({ id: firstAttempt, status: "fenced" }),
      expect.objectContaining({
        id: secondAttempt,
        writer_generation: "generation-2",
        previous_attempt_id: firstAttempt,
      }),
    ]);
    expect((await ledger.recover(recoveryInput)).adopted).toBe(true);

    await expect(ledger.append({
      group_id: groupId,
      attempt_id: firstAttempt,
      writer_generation: "generation-1",
      idempotency_key: "stale-completion",
      event_type: "handoff",
    })).rejects.toMatchObject({ code: "PR_GROUP_WRITER_FENCED" });

    await ledger.append({
      group_id: groupId,
      attempt_id: secondAttempt,
      writer_generation: "generation-2",
      idempotency_key: "second-progress",
      event_type: "heartbeat",
      created_at: T0,
    });
    const history = await ledger.events(groupId, { limit: 20 });
    expect(history.events.map((event) => event.event_type)).toEqual([
      "admission",
      "progress",
      "recovery",
      "heartbeat",
    ]);
    expect(history.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  test("redacts provider identity and credentials and rejects unsafe profile references", async () => {
    await expect(ledger.admit(admission({ profile_alias: "person@example.test" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ provider_run_id: "/tmp/auth.json" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ worktree: "/tmp/.ssh/private-worktree" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ branch: "feat/auth.json" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });

    const admitted = await ledger.admit(admission());
    const event = await ledger.append({
      group_id: admitted.view.group.id,
      attempt_id: admitted.view.attempts[0]!.id,
      writer_generation: "generation-1",
      idempotency_key: "redaction-1",
      event_type: "progress",
      metadata: {
        provider_email: "person@example.test",
        token: "not-a-credential",
        nested: { auth_path: "/tmp/auth.json", safe: "kept" },
      },
      message: "credential path /tmp/auth.json must not survive",
      created_at: T0,
    });
    expect(event.event.message).toBe("[REDACTED]");
    expect(event.event.metadata).toEqual({
      provider_email: "[REDACTED]",
      token: "[REDACTED]",
      nested: { auth_path: "[REDACTED]", safe: "kept" },
    });
    expect(JSON.stringify(event.view)).not.toContain("person@example.test");
    expect(JSON.stringify(event.view)).not.toContain("/tmp/auth.json");
  });

  test("rejects events and recovery that would regress authoritative timestamps", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    await ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "future-progress",
      event_type: "progress",
      created_at: "2026-07-23T11:00:00.000Z",
    });
    await expect(ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "backdated-progress",
      event_type: "progress",
      created_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
    await expect(ledger.recover({
      group_id: groupId,
      leaf_task_id: "leaf-task-1",
      dispatch_attempt: "dispatch-backdated",
      expected_generation: "generation-1",
      writer_generation: "generation-backdated",
      worktree: "/tmp/pr-group-ledger-backdated",
      branch: "feat/pr-group-ledger-backdated",
      idempotency_key: "recovery-backdated",
      recovered_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
  });

  test("fails and cancels terminal attempts without allowing history to reopen", async () => {
    for (const [eventType, outcome] of [["failure", "failed"], ["cancellation", "cancelled"]] as const) {
      const isolatedDb = new Database(":memory:");
      isolatedDb.exec("PRAGMA foreign_keys = ON");
      runMigrations(isolatedDb);
      const isolated = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(isolatedDb));
      const admitted = await isolated.admit(admission({
        root_request_id: `root-${eventType}`,
        dispatch_attempt: `dispatch-${eventType}`,
      }));
      const terminal = await isolated.append({
        group_id: admitted.view.group.id,
        attempt_id: admitted.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: `terminal-${eventType}`,
        event_type: eventType,
        created_at: T0,
      });
      expect(terminal.view.group.terminal_outcome).toBe(outcome);
      await expect(isolated.recover({
        group_id: admitted.view.group.id,
        leaf_task_id: "leaf-task-1",
        dispatch_attempt: `recovery-${eventType}`,
        expected_generation: "generation-1",
        writer_generation: "generation-2",
        worktree: "/tmp/recovery",
        branch: "feat/recovery",
        idempotency_key: `recover-${eventType}`,
      })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
      isolatedDb.close();
    }
  });

  test("returns bounded event pages with explicit continuation state", async () => {
    const admitted = await ledger.admit(admission());
    for (let index = 0; index < 4; index++) {
      await ledger.append({
        group_id: admitted.view.group.id,
        attempt_id: admitted.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: `heartbeat-${index}`,
        event_type: "heartbeat",
        created_at: T0,
      });
    }
    const first = await ledger.events(admitted.view.group.id, { limit: 2 });
    expect(first).toMatchObject({ count: 2, has_more: true, next_sequence: 2 });
    const second = await ledger.events(admitted.view.group.id, {
      limit: 2,
      after_sequence: first.next_sequence!,
    });
    expect(second.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(second.has_more).toBe(true);
    await expect(ledger.events(admitted.view.group.id, { after_sequence: -1 }))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.events(admitted.view.group.id, { after_sequence: 1.5 }))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'pr_group_events'").get()).not.toBeNull();
  });
});
