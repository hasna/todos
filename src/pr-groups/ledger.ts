import { createHash } from "node:crypto";
import {
  PR_GROUP_LEDGER_SCHEMA_VERSION,
  PrGroupLedgerError,
  type AdmitPrGroupInput,
  type AppendPrGroupEventInput,
  type PrGroupAttemptRecord,
  type PrGroupAttemptStatus,
  type PrGroupEventListOptions,
  type PrGroupEventOutcome,
  type PrGroupEventPage,
  type PrGroupEventRecord,
  type PrGroupEventType,
  type PrGroupLedgerPersistence,
  type PrGroupLedgerTransaction,
  type PrGroupMutationResult,
  type PrGroupRecord,
  type PrGroupState,
  type PrGroupStateView,
  type PrGroupTerminalOutcome,
  type RecoverPrGroupInput,
} from "./types.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SAFE_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FORBIDDEN_METADATA_KEY = /(?:^|[_-])(email|account(?:_?id)?|auth(?:entication|orization)?|token|secret|password|credential|cookie)(?:$|[_-])/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CREDENTIAL_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}/i;
const AUTH_PATH_PATTERN = /(?:^|[/\\])(?:\.ssh|\.aws|credentials|auth(?:\.json)?)(?=[/\\\s]|$)/i;
const STATE_VIEW_ATTEMPT_LIMIT = 100;
const STATE_VIEW_EVENT_LIMIT = 500;
const APPENDABLE_EVENT_TYPES = new Set<AppendPrGroupEventInput["event_type"]>([
  "started",
  "progress",
  "heartbeat",
  "handoff",
  "review_requested",
  "review_receipt",
  "repair_accepted",
  "repair_rejected",
  "conditional_merge_receipt",
  "merge_outcome",
  "cancellation",
  "failure",
  "cleanup_eligible",
  "terminal_outcome",
]);
const EVENT_OUTCOMES = new Set<PrGroupEventOutcome>([
  "approved",
  "changes_requested",
  "accepted",
  "rejected",
  "merged",
  "not_merged",
  "cancelled",
  "failed",
]);

const STATE_RANK: Record<PrGroupState, number> = {
  admitted: 0,
  started: 10,
  in_progress: 20,
  handed_off: 30,
  review_requested: 40,
  reviewed: 50,
  repair: 55,
  merge_ready: 60,
  merge_not_merged: 65,
  merged: 70,
  cancelled: 70,
  failed: 70,
  cleanup_eligible: 80,
};

const ATTEMPT_STATUS_RANK: Record<PrGroupAttemptStatus, number> = {
  admitted: 0,
  started: 10,
  in_progress: 20,
  handed_off: 30,
  reviewing: 40,
  repair: 50,
  merge_ready: 60,
  fenced: 70,
  merged: 80,
  cancelled: 80,
  failed: 80,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function requiredReference(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be a bounded non-empty string`);
  }
  return value.trim();
}

function safeReference(value: unknown, field: string): string {
  const ref = requiredReference(value, field, 256);
  if (!SAFE_REFERENCE_PATTERN.test(ref) || EMAIL_PATTERN.test(ref) ||
      CREDENTIAL_PATTERN.test(ref) || AUTH_PATH_PATTERN.test(ref)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be an opaque non-credential reference`);
  }
  return ref;
}

function safeWorktree(value: unknown): string {
  const worktree = requiredReference(value, "worktree", 1_024);
  if (!worktree.startsWith("/") || EMAIL_PATTERN.test(worktree) ||
      CREDENTIAL_PATTERN.test(worktree) || AUTH_PATH_PATTERN.test(worktree)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_INVALID_INPUT",
      "worktree must be an absolute non-credential path",
    );
  }
  return worktree;
}

function safeOptionalReference(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === "" ? null : safeReference(value, field);
}

function safeProfileAlias(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const alias = requiredReference(value, "profile_alias", 64);
  if (!SAFE_PROFILE_PATTERN.test(alias) || EMAIL_PATTERN.test(alias)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_INVALID_INPUT",
      "profile_alias must be an opaque alias and must not contain provider identity",
    );
  }
  return alias;
}

function safeMessage(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const message = requiredReference(value, field, 2_048);
  if (EMAIL_PATTERN.test(message) || CREDENTIAL_PATTERN.test(message) || AUTH_PATH_PATTERN.test(message)) {
    return "[REDACTED]";
  }
  return message;
}

function isoTimestamp(value: string | undefined, field: string): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be an ISO timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeRepository(value: string): string {
  const repository = requiredReference(value, "repository", 256)
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^git@[^:]+:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(repository)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repository must be a canonical owner/name reference");
  }
  return repository;
}

function normalizeHead(value: string | null | undefined, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PrGroupLedgerError("PR_GROUP_EXACT_HEAD_REQUIRED", "this event requires an exact 40-character head SHA");
    }
    return null;
  }
  const head = value.toLowerCase();
  if (!SHA_PATTERN.test(head)) {
    throw new PrGroupLedgerError("PR_GROUP_EXACT_HEAD_REQUIRED", "head_sha must be an exact 40-character lowercase SHA");
  }
  return head;
}

function sanitizeMetadataValue(value: unknown, key = ""): unknown {
  if (FORBIDDEN_METADATA_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (EMAIL_PATTERN.test(value) || CREDENTIAL_PATTERN.test(value) || AUTH_PATH_PATTERN.test(value)) return "[REDACTED]";
    return value.length > 2_048 ? `${value.slice(0, 2_045)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeMetadataValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, child]) => [childKey, sanitizeMetadataValue(child, childKey)]),
    );
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function sanitizePrGroupMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeMetadataValue(metadata ?? {}) as Record<string, unknown>) ?? {};
}

export function deterministicPrGroupId(rootRequestId: string, repository: string): string {
  const root = requiredReference(rootRequestId, "root_request_id", 256);
  const repo = normalizeRepository(repository);
  return `prg_${sha256(`pr-group:v1\0${root}\0${repo}`).slice(0, 32)}`;
}

export function deterministicPrGroupAttemptId(
  groupId: string,
  leafTaskId: string,
  dispatchAttempt: string,
): string {
  const group = requiredReference(groupId, "group_id", 96);
  const leaf = requiredReference(leafTaskId, "leaf_task_id", 256);
  const dispatch = safeReference(dispatchAttempt, "dispatch_attempt");
  return `pra_${sha256(`pr-attempt:v1\0${group}\0${leaf}\0${dispatch}`).slice(0, 32)}`;
}

function deterministicEventId(groupId: string, key: string): string {
  return `pre_${sha256(`pr-event:v1\0${groupId}\0${key}`).slice(0, 32)}`;
}

function stateForEvent(type: PrGroupEventType, outcome: PrGroupEventOutcome | null): PrGroupState {
  switch (type) {
    case "admission": return "admitted";
    case "started": return "started";
    case "progress":
    case "heartbeat": return "in_progress";
    case "handoff": return "handed_off";
    case "review_requested": return "review_requested";
    case "review_receipt": return "reviewed";
    case "repair_accepted":
    case "repair_rejected": return "repair";
    case "conditional_merge_receipt": return "merge_ready";
    case "merge_outcome": return outcome === "merged" ? "merged" : "merge_not_merged";
    case "recovery": return "admitted";
    case "cancellation": return "cancelled";
    case "failure": return "failed";
    case "cleanup_eligible": return "cleanup_eligible";
    case "terminal_outcome":
      if (outcome === "merged" || outcome === "cancelled" || outcome === "failed") return outcome;
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "terminal_outcome requires merged, cancelled, or failed");
  }
}

function terminalOutcomeFor(
  type: PrGroupEventType,
  outcome: PrGroupEventOutcome | null,
): PrGroupTerminalOutcome | null {
  if (type === "cancellation") return "cancelled";
  if (type === "failure") return "failed";
  if (type === "merge_outcome" && outcome === "merged") return "merged";
  if (type === "terminal_outcome" && (outcome === "merged" || outcome === "cancelled" || outcome === "failed")) {
    return outcome;
  }
  return null;
}

function attemptStatusFor(
  type: PrGroupEventType,
  outcome: PrGroupEventOutcome | null,
  current: PrGroupAttemptStatus,
): PrGroupAttemptStatus {
  switch (type) {
    case "started": return "started";
    case "progress":
    case "heartbeat": return "in_progress";
    case "handoff": return "handed_off";
    case "review_requested":
    case "review_receipt": return "reviewing";
    case "repair_accepted":
    case "repair_rejected": return "repair";
    case "conditional_merge_receipt": return "merge_ready";
    case "merge_outcome": return outcome === "merged" ? "merged" : "handed_off";
    case "cancellation": return "cancelled";
    case "failure": return "failed";
    case "terminal_outcome":
      if (outcome === "merged" || outcome === "cancelled" || outcome === "failed") return outcome;
      return current;
    default: return current;
  }
}

function advanceAttemptStatus(
  current: PrGroupAttemptStatus,
  candidate: PrGroupAttemptStatus,
): PrGroupAttemptStatus {
  return ATTEMPT_STATUS_RANK[candidate] >= ATTEMPT_STATUS_RANK[current] ? candidate : current;
}

function payloadForHash(input: {
  attempt_id: string;
  writer_generation: string;
  event_type: PrGroupEventType;
  message: string | null;
  head_sha: string | null;
  receipt_key: string | null;
  outcome: PrGroupEventOutcome | null;
  metadata: Record<string, unknown>;
}): string {
  return sha256(stableJson(input));
}

async function existingEventOrThrow(
  tx: PrGroupLedgerTransaction,
  groupId: string,
  key: string,
  payloadHash: string,
): Promise<PrGroupEventRecord | null> {
  const existing = await tx.getEventByIdempotency(groupId, key);
  if (!existing) return null;
  if (existing.payload_hash !== payloadHash) {
    throw new PrGroupLedgerError(
      "PR_GROUP_RECEIPT_REPLAY",
      "idempotency key was already used with a different payload",
      { group_id: groupId, idempotency_key: key, existing_event_id: existing.id },
    );
  }
  return existing;
}

function assertAttemptIdentity(
  attempt: PrGroupAttemptRecord,
  input: {
    leaf_task_id: string;
    dispatch_attempt: string;
    writer_generation: string;
    worktree: string;
    branch: string;
    provider: string | null;
    provider_run_id: string | null;
    profile_alias: string | null;
  },
): void {
  const immutable = {
    leaf_task_id: input.leaf_task_id,
    dispatch_attempt: input.dispatch_attempt,
    writer_generation: input.writer_generation,
    worktree: input.worktree,
    branch: input.branch,
    provider: input.provider,
    provider_run_id: input.provider_run_id,
    profile_alias: input.profile_alias,
  };
  for (const [key, value] of Object.entries(immutable)) {
    if (attempt[key as keyof PrGroupAttemptRecord] !== value) {
      throw new PrGroupLedgerError(
        "PR_GROUP_IDENTITY_CONFLICT",
        `deterministic attempt identity conflicts on ${key}`,
        { attempt_id: attempt.id, field: key },
      );
    }
  }
}

export class PrGroupLedger {
  constructor(private readonly persistence: PrGroupLedgerPersistence) {}

  async get(groupId: string): Promise<PrGroupStateView> {
    const id = requiredReference(groupId, "group_id", 96);
    const group = await this.persistence.getGroup(id);
    if (!group) {
      throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${id}`, { group_id: id });
    }
    const [allAttempts, eventWindow, receiptWindow, eventCount, latestEvent] = await Promise.all([
      this.persistence.listAttempts(id),
      this.persistence.listEvents(id, { limit: STATE_VIEW_EVENT_LIMIT + 1 }),
      this.persistence.listReceiptEvents(id, STATE_VIEW_EVENT_LIMIT + 1),
      this.persistence.countEvents(id),
      this.persistence.getLatestEvent(id),
    ]);
    const attemptsOmitted = allAttempts.length > STATE_VIEW_ATTEMPT_LIMIT;
    const attempts = allAttempts.slice(-STATE_VIEW_ATTEMPT_LIMIT);
    const events = eventWindow.slice(0, STATE_VIEW_EVENT_LIMIT);
    const receipts = receiptWindow.slice(0, STATE_VIEW_EVENT_LIMIT);
    const receiptHistoryComplete = receiptWindow.length <= STATE_VIEW_EVENT_LIMIT;
    const evidenceRefs = events.map((event) => ({
      kind: "EvidenceRef" as const,
      id: event.id,
      group_id: event.group_id,
      work_run_id: event.attempt_id,
      sequence: event.sequence,
      evidence_type: event.event_type,
      head_sha: event.head_sha,
      receipt_key: event.receipt_key,
      outcome: event.outcome,
      payload_hash: event.payload_hash,
      created_at: event.created_at,
    }));
    return {
      schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
      authoritative: true,
      authority: this.persistence.authority,
      group,
      attempts,
      latest_event: latestEvent,
      review_receipts: receipts.filter((event) => event.event_type === "review_receipt"),
      conditional_merge_receipts: receipts.filter((event) => event.event_type === "conditional_merge_receipt"),
      cleanup_eligible: group.cleanup_eligible_at !== null,
      adapters: {
        work_runs: attempts.map((attempt) => ({
          kind: "WorkRun",
          id: attempt.id,
          group_id: attempt.group_id,
          task_id: attempt.leaf_task_id,
          dispatch_attempt: attempt.dispatch_attempt,
          writer_generation: attempt.writer_generation,
          previous_run_id: attempt.previous_attempt_id,
          worktree: attempt.worktree,
          branch: attempt.branch,
          provider: attempt.provider,
          provider_run_id: attempt.provider_run_id,
          profile_alias: attempt.profile_alias,
          status: attempt.status,
          admitted_at: attempt.admitted_at,
          terminal_at: attempt.terminal_at,
        })),
        evidence_refs: evidenceRefs,
        proof_bundle: {
          kind: "ProofBundle",
          id: `proof_${group.id}`,
          group_id: group.id,
          revision: group.revision,
          evidence_ref_ids: evidenceRefs.map((ref) => ref.id),
          exact_head: group.terminal_head_sha ?? latestEvent?.head_sha ?? null,
          complete: eventCount <= STATE_VIEW_EVENT_LIMIT && receiptHistoryComplete && !attemptsOmitted,
        },
        decision_envelope: {
          kind: "DecisionEnvelope",
          id: `decision_${group.id}_${group.revision}`,
          group_id: group.id,
          state: group.state,
          active_work_run_id: group.active_attempt_id,
          active_writer_generation: group.active_generation,
          terminal_outcome: group.terminal_outcome,
          terminal_head_sha: group.terminal_head_sha,
          cleanup_eligible: group.cleanup_eligible_at !== null,
          revision: group.revision,
        },
      },
      diagnostics: {
        event_count: eventCount,
        attempts_omitted: attemptsOmitted,
        receipt_history_complete: receiptHistoryComplete,
        projection_limits: {
          attempts: STATE_VIEW_ATTEMPT_LIMIT,
          receipts: STATE_VIEW_EVENT_LIMIT,
        },
      },
    };
  }

  async events(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventPage> {
    const id = requiredReference(groupId, "group_id", 96);
    const group = await this.persistence.getGroup(id);
    if (!group) {
      throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${id}`, { group_id: id });
    }
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "event limit must be an integer between 1 and 500");
    }
    const afterSequence = options.after_sequence ?? 0;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "after_sequence must be a non-negative integer");
    }
    const rows = await this.persistence.listEvents(id, {
      after_sequence: afterSequence,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return {
      schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
      authoritative: true,
      authority: this.persistence.authority,
      group_id: id,
      events,
      count: events.length,
      has_more: hasMore,
      next_sequence: hasMore ? events.at(-1)?.sequence ?? null : null,
    };
  }

  async admit(raw: AdmitPrGroupInput): Promise<PrGroupMutationResult> {
    const admittedAt = isoTimestamp(raw.admitted_at, "admitted_at");
    const rootRequestId = safeReference(raw.root_request_id, "root_request_id");
    const repository = normalizeRepository(raw.repository);
    const groupId = deterministicPrGroupId(rootRequestId, repository);
    const leafTaskId = safeReference(raw.leaf_task_id, "leaf_task_id");
    const dispatchAttempt = safeReference(raw.dispatch_attempt, "dispatch_attempt");
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    const worktree = safeWorktree(raw.worktree);
    const branch = safeReference(raw.branch, "branch");
    const provider = safeOptionalReference(raw.provider, "provider");
    const providerRunId = safeOptionalReference(raw.provider_run_id, "provider_run_id");
    const profileAlias = safeProfileAlias(raw.profile_alias);
    const attemptId = deterministicPrGroupAttemptId(groupId, leafTaskId, dispatchAttempt);
    const identityKey = sha256(`pr-group:v1\0${rootRequestId}\0${repository}`);
    const idempotencyKey = `admission:${attemptId}`;
    const metadata = {};
    const eventPayloadHash = payloadForHash({
      attempt_id: attemptId,
      writer_generation: writerGeneration,
      event_type: "admission",
      message: null,
      head_sha: null,
      receipt_key: null,
      outcome: null,
      metadata,
    });

    const event = await this.persistence.transaction(async (tx) => {
      let group = await tx.getGroup(groupId, true);
      let created = false;
      if (!group) {
        const candidate: PrGroupRecord = {
          schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
          id: groupId,
          identity_key: identityKey,
          root_request_id: rootRequestId,
          repository,
          state: "admitted",
          active_attempt_id: attemptId,
          active_generation: writerGeneration,
          terminal_attempt_id: null,
          terminal_generation: null,
          terminal_outcome: null,
          terminal_head_sha: null,
          terminal_at: null,
          cleanup_eligible_at: null,
          revision: 1,
          created_at: admittedAt,
          updated_at: admittedAt,
        };
        created = await tx.insertGroup(candidate);
        group = created ? candidate : await tx.getGroup(groupId, true);
      }
      if (!group) {
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "group create-or-adopt lost its authoritative row");
      }
      if (group.identity_key !== identityKey || group.root_request_id !== rootRequestId || group.repository !== repository) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "deterministic PR group identity conflicts with an existing group",
          { group_id: groupId },
        );
      }
      if (group.terminal_outcome) {
        throw new PrGroupLedgerError(
          "PR_GROUP_TERMINAL",
          "terminal PR group history cannot be reopened",
          { group_id: groupId, terminal_outcome: group.terminal_outcome },
        );
      }

      const identity = {
        leaf_task_id: leafTaskId,
        dispatch_attempt: dispatchAttempt,
        writer_generation: writerGeneration,
        worktree,
        branch,
        provider,
        provider_run_id: providerRunId,
        profile_alias: profileAlias,
      };
      let attempt = await tx.getAttempt(attemptId);
      if (attempt) assertAttemptIdentity(attempt, identity);
      if (group.active_attempt_id !== attemptId || group.active_generation !== writerGeneration) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "another active writer generation owns this PR group",
          {
            group_id: groupId,
            attempted_generation: writerGeneration,
            active_generation: group.active_generation,
            active_attempt_id: group.active_attempt_id,
          },
        );
      }
      if (!attempt) {
        attempt = {
          schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
          id: attemptId,
          group_id: groupId,
          leaf_task_id: leafTaskId,
          dispatch_attempt: dispatchAttempt,
          writer_generation: writerGeneration,
          previous_attempt_id: null,
          worktree,
          branch,
          provider,
          provider_run_id: providerRunId,
          profile_alias: profileAlias,
          status: "admitted",
          admitted_at: admittedAt,
          started_at: null,
          last_heartbeat_at: null,
          handed_off_at: null,
          fenced_at: null,
          terminal_at: null,
          created_at: admittedAt,
          updated_at: admittedAt,
        };
        if (!await tx.insertAttempt(attempt)) {
          const raced = await tx.getAttempt(attemptId);
          if (!raced) throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "attempt create lost its authoritative row");
          assertAttemptIdentity(raced, identity);
          attempt = raced;
        }
      }

      const existing = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
      if (existing) return { event: existing, created: false, adopted: true, appended: false };
      const admissionEvent: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: "admission",
        state: "admitted",
        message: null,
        head_sha: null,
        receipt_key: null,
        outcome: null,
        metadata,
        payload_hash: eventPayloadHash,
        created_at: admittedAt,
      };
      if (!await tx.insertEvent(admissionEvent)) {
        const raced = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
        if (raced) return { event: raced, created: false, adopted: true, appended: false };
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "admission event insert was not durable");
      }
      return { event: admissionEvent, created, adopted: false, appended: true };
    });

    return { ...event, view: await this.get(groupId) };
  }

  async recover(raw: RecoverPrGroupInput): Promise<PrGroupMutationResult> {
    const groupId = requiredReference(raw.group_id, "group_id", 96);
    const leafTaskId = safeReference(raw.leaf_task_id, "leaf_task_id");
    const dispatchAttempt = safeReference(raw.dispatch_attempt, "dispatch_attempt");
    const expectedGeneration = safeReference(raw.expected_generation, "expected_generation");
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    if (expectedGeneration === writerGeneration) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "recovery must create a new writer generation");
    }
    const worktree = safeWorktree(raw.worktree);
    const branch = safeReference(raw.branch, "branch");
    const provider = safeOptionalReference(raw.provider, "provider");
    const providerRunId = safeOptionalReference(raw.provider_run_id, "provider_run_id");
    const profileAlias = safeProfileAlias(raw.profile_alias);
    const idempotencyKey = safeReference(raw.idempotency_key, "idempotency_key");
    const recoveredAt = isoTimestamp(raw.recovered_at, "recovered_at");
    const attemptId = deterministicPrGroupAttemptId(groupId, leafTaskId, dispatchAttempt);
    const message = safeMessage(raw.message, "message");
    const metadata = sanitizePrGroupMetadata(raw.metadata);
    const eventPayloadHash = payloadForHash({
      attempt_id: attemptId,
      writer_generation: writerGeneration,
      event_type: "recovery",
      message,
      head_sha: null,
      receipt_key: null,
      outcome: null,
      metadata,
    });

    const result = await this.persistence.transaction(async (tx) => {
      const group = await tx.getGroup(groupId, true);
      if (!group) throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${groupId}`);
      if (group.terminal_outcome) {
        throw new PrGroupLedgerError("PR_GROUP_TERMINAL", "terminal PR group history cannot be recovered", {
          group_id: groupId,
          terminal_outcome: group.terminal_outcome,
        });
      }

      const existingEvent = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
      if (existingEvent) return { event: existingEvent, created: false, adopted: true, appended: false };
      if (recoveredAt < group.updated_at) {
        throw new PrGroupLedgerError(
          "PR_GROUP_INVALID_TRANSITION",
          "recovery timestamp cannot precede the current authoritative group state",
          { group_id: groupId, recovered_at: recoveredAt, updated_at: group.updated_at },
        );
      }
      const existingAttempt = await tx.getAttempt(attemptId);
      if (existingAttempt) {
        assertAttemptIdentity(existingAttempt, {
          leaf_task_id: leafTaskId,
          dispatch_attempt: dispatchAttempt,
          writer_generation: writerGeneration,
          worktree,
          branch,
          provider,
          provider_run_id: providerRunId,
          profile_alias: profileAlias,
        });
        if (group.active_attempt_id === attemptId && group.active_generation === writerGeneration) {
          throw new PrGroupLedgerError(
            "PR_GROUP_RECEIPT_REPLAY",
            "recovery attempt already exists but the supplied idempotency key is new",
            { group_id: groupId, attempt_id: attemptId },
          );
        }
      }
      if (group.active_generation !== expectedGeneration || !group.active_attempt_id) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "recovery expected generation does not own the active writer lease",
          {
            group_id: groupId,
            expected_generation: expectedGeneration,
            active_generation: group.active_generation,
          },
        );
      }
      const previous = await tx.getAttempt(group.active_attempt_id);
      if (!previous) {
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "active attempt record is missing");
      }
      previous.status = "fenced";
      previous.fenced_at = recoveredAt;
      previous.updated_at = recoveredAt;
      await tx.updateAttempt(previous);

      const attempt: PrGroupAttemptRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: attemptId,
        group_id: groupId,
        leaf_task_id: leafTaskId,
        dispatch_attempt: dispatchAttempt,
        writer_generation: writerGeneration,
        previous_attempt_id: previous.id,
        worktree,
        branch,
        provider,
        provider_run_id: providerRunId,
        profile_alias: profileAlias,
        status: "admitted",
        admitted_at: recoveredAt,
        started_at: null,
        last_heartbeat_at: null,
        handed_off_at: null,
        fenced_at: null,
        terminal_at: null,
        created_at: recoveredAt,
        updated_at: recoveredAt,
      };
      if (!await tx.insertAttempt(attempt)) {
        throw new PrGroupLedgerError("PR_GROUP_IDENTITY_CONFLICT", "recovery attempt identity already exists");
      }
      group.active_attempt_id = attemptId;
      group.active_generation = writerGeneration;
      group.state = "admitted";
      group.revision += 1;
      group.updated_at = recoveredAt;
      await tx.updateGroup(group);

      const event: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: "recovery",
        state: "admitted",
        message,
        head_sha: null,
        receipt_key: null,
        outcome: null,
        metadata: { ...metadata, previous_attempt_id: previous.id },
        payload_hash: eventPayloadHash,
        created_at: recoveredAt,
      };
      if (!await tx.insertEvent(event)) {
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "recovery event insert was not durable");
      }
      return { event, created: true, adopted: false, appended: true };
    });

    return { ...result, view: await this.get(groupId) };
  }

  async append(raw: AppendPrGroupEventInput): Promise<PrGroupMutationResult> {
    const groupId = requiredReference(raw.group_id, "group_id", 96);
    const attemptId = requiredReference(raw.attempt_id, "attempt_id", 96);
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    const idempotencyKey = safeReference(raw.idempotency_key, "idempotency_key");
    const createdAt = isoTimestamp(raw.created_at, "created_at");
    const eventType = raw.event_type;
    if (!APPENDABLE_EVENT_TYPES.has(eventType)) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "event_type is not a supported append-only lifecycle event");
    }
    const exactHeadRequired = [
      "review_requested",
      "review_receipt",
      "conditional_merge_receipt",
      "merge_outcome",
    ].includes(eventType);
    const headSha = normalizeHead(raw.head_sha, exactHeadRequired);
    const receiptKey = safeOptionalReference(raw.receipt_key, "receipt_key");
    const outcome = raw.outcome ?? null;
    if (outcome !== null && !EVENT_OUTCOMES.has(outcome)) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "outcome is not supported for PR-group events");
    }
    const message = safeMessage(raw.message, "message");
    const metadata = sanitizePrGroupMetadata(raw.metadata);
    if ((eventType === "review_receipt" || eventType === "conditional_merge_receipt") && !receiptKey) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${eventType} requires receipt_key`);
    }
    if (receiptKey && eventType !== "review_receipt" && eventType !== "conditional_merge_receipt") {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "receipt_key is reserved for review and conditional merge receipts",
      );
    }
    if (eventType === "review_receipt" && outcome !== "approved" && outcome !== "changes_requested") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "review_receipt outcome must be approved or changes_requested");
    }
    if (eventType === "merge_outcome" && outcome !== "merged" && outcome !== "not_merged") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "merge_outcome outcome must be merged or not_merged");
    }
    if (eventType === "repair_accepted" && outcome !== null && outcome !== "accepted") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repair_accepted outcome must be accepted");
    }
    if (eventType === "repair_rejected" && outcome !== null && outcome !== "rejected") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repair_rejected outcome must be rejected");
    }
    const payloadHash = payloadForHash({
      attempt_id: attemptId,
      writer_generation: writerGeneration,
      event_type: eventType,
      message,
      head_sha: headSha,
      receipt_key: receiptKey,
      outcome,
      metadata,
    });

    const result = await this.persistence.transaction(async (tx) => {
      const group = await tx.getGroup(groupId, true);
      if (!group) throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${groupId}`);
      const existing = await existingEventOrThrow(tx, groupId, idempotencyKey, payloadHash);
      if (existing) return { event: existing, created: false, adopted: true, appended: false };
      if (createdAt < group.updated_at) {
        throw new PrGroupLedgerError(
          "PR_GROUP_INVALID_TRANSITION",
          "event timestamp cannot precede the current authoritative group state",
          { group_id: groupId, created_at: createdAt, updated_at: group.updated_at },
        );
      }
      const attempt = await tx.getAttempt(attemptId);
      if (!attempt || attempt.group_id !== groupId) {
        throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group attempt not found: ${attemptId}`);
      }
      if (attempt.writer_generation !== writerGeneration) {
        throw new PrGroupLedgerError("PR_GROUP_WRITER_FENCED", "attempt writer generation does not match", {
          attempt_id: attemptId,
          attempted_generation: writerGeneration,
        });
      }

      const terminalFollowup = eventType === "cleanup_eligible" || eventType === "terminal_outcome";
      if (group.terminal_outcome) {
        if (!terminalFollowup ||
            group.terminal_attempt_id !== attemptId ||
            group.terminal_generation !== writerGeneration) {
          throw new PrGroupLedgerError(
            "PR_GROUP_TERMINAL",
            "terminal PR group history cannot be reopened or mutated by another generation",
            { group_id: groupId, terminal_outcome: group.terminal_outcome },
          );
        }
      } else if (group.active_attempt_id !== attemptId || group.active_generation !== writerGeneration) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "stale writer generation cannot append PR group evidence",
          {
            group_id: groupId,
            attempted_generation: writerGeneration,
            active_generation: group.active_generation,
            active_attempt_id: group.active_attempt_id,
          },
        );
      }

      if (receiptKey) {
        const receiptReplay =
          await tx.findEvent(groupId, { event_type: "review_receipt", receipt_key: receiptKey }) ??
          await tx.findEvent(groupId, { event_type: "conditional_merge_receipt", receipt_key: receiptKey });
        if (receiptReplay) {
          throw new PrGroupLedgerError(
            "PR_GROUP_RECEIPT_REPLAY",
            "receipt_key is already bound to another event",
            { receipt_key: receiptKey, existing_event_id: receiptReplay.id },
          );
        }
      }
      if (eventType === "review_receipt") {
        const request = await tx.findEvent(groupId, {
          event_type: "review_requested",
          attempt_id: attemptId,
          head_sha: headSha,
        });
        if (!request) {
          throw new PrGroupLedgerError(
            "PR_GROUP_EXACT_HEAD_REQUIRED",
            "review receipt requires a review request bound to the same attempt and exact head",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
      }
      if (eventType === "conditional_merge_receipt") {
        const review = await tx.findEvent(groupId, {
          event_type: "review_receipt",
          attempt_id: attemptId,
          head_sha: headSha,
          outcome: "approved",
        });
        if (!review) {
          throw new PrGroupLedgerError(
            "PR_GROUP_REVIEW_REQUIRED",
            "conditional merge receipt requires an approved exact-head review receipt",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
      }
      if (eventType === "merge_outcome") {
        const mergeReceipt = await tx.findEvent(groupId, {
          event_type: "conditional_merge_receipt",
          attempt_id: attemptId,
          head_sha: headSha,
        });
        if (!mergeReceipt) {
          throw new PrGroupLedgerError(
            "PR_GROUP_MERGE_RECEIPT_REQUIRED",
            "merge outcome requires a conditional merge receipt for the same exact head",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
      }
      if (eventType === "terminal_outcome") {
        if (outcome !== group.terminal_outcome) {
          throw new PrGroupLedgerError(
            "PR_GROUP_TERMINAL",
            "terminal outcome evidence cannot change the recorded outcome",
            { recorded: group.terminal_outcome, attempted: outcome },
          );
        }
      }
      if (eventType === "cleanup_eligible") {
        if (group.cleanup_eligible_at) {
          throw new PrGroupLedgerError(
            "PR_GROUP_TERMINAL",
            "cleanup eligibility is already recorded; replay the original idempotency key",
            { group_id: groupId, cleanup_eligible_at: group.cleanup_eligible_at },
          );
        }
        if (!group.terminal_outcome || group.active_generation !== null || group.active_attempt_id !== null) {
          throw new PrGroupLedgerError("PR_GROUP_CLEANUP_BLOCKED", "cleanup requires a terminal group with no active writer");
        }
        if (group.terminal_outcome === "merged") {
          const head = group.terminal_head_sha;
          const review = await tx.findEvent(groupId, {
            event_type: "review_receipt",
            head_sha: head,
            outcome: "approved",
          });
          const conditional = await tx.findEvent(groupId, {
            event_type: "conditional_merge_receipt",
            head_sha: head,
          });
          const merged = await tx.findEvent(groupId, {
            event_type: "merge_outcome",
            head_sha: head,
            outcome: "merged",
          });
          if (!review || !conditional || !merged) {
            throw new PrGroupLedgerError(
              "PR_GROUP_CLEANUP_BLOCKED",
              "merged cleanup requires approved review, conditional merge, and merge outcome receipts at the terminal head",
            );
          }
        }
      }

      const state = stateForEvent(eventType, outcome);
      const event: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: eventType,
        state,
        message,
        head_sha: headSha,
        receipt_key: receiptKey,
        outcome,
        metadata,
        payload_hash: payloadHash,
        created_at: createdAt,
      };
      if (!await tx.insertEvent(event)) {
        const raced = await existingEventOrThrow(tx, groupId, idempotencyKey, payloadHash);
        if (raced) return { event: raced, created: false, adopted: true, appended: false };
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "event append was not durable");
      }

      if (STATE_RANK[state] >= STATE_RANK[group.state]) group.state = state;
      const terminalOutcome = terminalOutcomeFor(eventType, outcome);
      if (terminalOutcome) {
        if (group.terminal_outcome && group.terminal_outcome !== terminalOutcome) {
          throw new PrGroupLedgerError("PR_GROUP_TERMINAL", "terminal outcome cannot regress or change");
        }
        group.terminal_outcome = terminalOutcome;
        group.terminal_attempt_id = attemptId;
        group.terminal_generation = writerGeneration;
        group.terminal_head_sha = terminalOutcome === "merged" ? headSha : null;
        group.terminal_at = createdAt;
        group.active_attempt_id = null;
        group.active_generation = null;
      }
      if (eventType === "cleanup_eligible") group.cleanup_eligible_at = createdAt;
      group.revision += 1;
      group.updated_at = createdAt;
      await tx.updateGroup(group);

      attempt.status = advanceAttemptStatus(
        attempt.status,
        attemptStatusFor(eventType, outcome, attempt.status),
      );
      if (eventType === "started" && !attempt.started_at) attempt.started_at = createdAt;
      if (eventType === "heartbeat" || eventType === "progress") attempt.last_heartbeat_at = createdAt;
      if (eventType === "handoff") attempt.handed_off_at = createdAt;
      if (terminalOutcome) attempt.terminal_at = createdAt;
      attempt.updated_at = createdAt;
      await tx.updateAttempt(attempt);
      return { event, created: true, adopted: false, appended: true };
    });

    return { ...result, view: await this.get(groupId) };
  }
}
