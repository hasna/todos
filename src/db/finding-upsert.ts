import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { sanitizePreWriteText } from "../lib/prewrite-secrets.js";
import type { Task, TaskPriority, TaskStatus } from "../types/index.js";
import { addComment } from "./comments.js";
import { getDatabase } from "./database.js";
import { getTaskList } from "./task-lists.js";
import { getTaskByFingerprint, upsertTaskByFingerprint } from "./tasks.js";

export const FINDING_UPSERT_SCHEMA_VERSION = "todos.finding_upsert.v1";

export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "resolved" | "ignored";
export type FindingUpsertAction = "created" | "updated";
export type FindingEvidenceAction = "appended" | "matched" | "none";

export interface UpsertFindingInput {
  fingerprint: string;
  title: string;
  body?: string;
  evidence?: string;
  evidence_fingerprint?: string;
  severity?: FindingSeverity | string;
  priority?: TaskPriority | string;
  status?: FindingStatus | string;
  tags?: string[];
  project_id?: string;
  task_list_id?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  assigned_to?: string;
  agent_id?: string;
  session_id?: string;
  working_dir?: string;
}

export interface CompactFindingTask {
  id: string;
  short_id: string | null;
  fingerprint: string;
  title: string;
  status: TaskStatus;
  finding_status: FindingStatus;
  severity: FindingSeverity;
  priority: TaskPriority;
  project_id: string | null;
  task_list_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface UpsertFindingResult {
  schema_version: typeof FINDING_UPSERT_SCHEMA_VERSION;
  action: FindingUpsertAction;
  evidence_action: FindingEvidenceAction;
  finding: CompactFindingTask;
}

const SEVERITIES = new Set<FindingSeverity>(["low", "medium", "high", "critical"]);
const STATUSES = new Set<FindingStatus>(["open", "resolved", "ignored"]);

export function normalizeFindingFingerprint(value: string): string {
  const fingerprint = value.trim();
  if (!fingerprint) throw new Error("finding fingerprint is required");
  if (fingerprint.length > 512) throw new Error("finding fingerprint must be at most 512 characters");
  return fingerprint;
}

export function normalizeFindingSeverity(value: string | undefined, fallback: FindingSeverity = "medium"): FindingSeverity {
  if (value === undefined) return fallback;
  const severity = value.trim().toLowerCase();
  if (!SEVERITIES.has(severity as FindingSeverity)) {
    throw new Error("finding severity must be one of: low, medium, high, critical");
  }
  return severity as FindingSeverity;
}

export function normalizeFindingStatus(value: string | undefined): FindingStatus {
  const status = (value ?? "open").trim().toLowerCase();
  if (!STATUSES.has(status as FindingStatus)) {
    throw new Error("finding status must be one of: open, resolved, ignored");
  }
  return status as FindingStatus;
}

export function findingTaskDedupeFingerprint(fingerprint: string, projectId?: string | null): string {
  const normalized = normalizeFindingFingerprint(fingerprint);
  return `finding:${encodeURIComponent(projectId || "global")}:${encodeURIComponent(normalized)}`;
}

export function findingTaskStatus(status: FindingStatus, existing?: TaskStatus): TaskStatus {
  if (status === "resolved") return "completed";
  if (status === "ignored") return "cancelled";
  if (existing === "pending" || existing === "in_progress") return existing;
  return "pending";
}

export function findingEvidenceFingerprint(evidence: string, supplied?: string): string {
  if (supplied !== undefined) {
    const fingerprint = supplied.trim();
    if (!fingerprint) throw new Error("evidence fingerprint cannot be empty");
    if (fingerprint.length > 512) throw new Error("evidence fingerprint must be at most 512 characters");
    return fingerprint;
  }
  return `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
}

function existingSeverity(task: Task | null): FindingSeverity {
  const value = task?.metadata["finding_severity"];
  if (typeof value === "string" && SEVERITIES.has(value as FindingSeverity)) return value as FindingSeverity;
  return task?.priority ?? "medium";
}

function evidenceFingerprints(task: Task | null): string[] {
  const value = task?.metadata["finding_evidence_fingerprints"];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function compactFinding(task: Task, fingerprint: string, findingStatus: FindingStatus, severity: FindingSeverity): CompactFindingTask {
  return {
    id: task.id,
    short_id: task.short_id,
    fingerprint,
    title: task.title,
    status: task.status,
    finding_status: findingStatus,
    severity,
    priority: task.priority,
    project_id: task.project_id,
    task_list_id: task.task_list_id,
    tags: task.tags,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

/**
 * Create or refresh the issue task for a deterministic finding and append new
 * evidence once. The task fingerprint is project-scoped; the caller-facing
 * fingerprint remains unchanged in metadata and in the compact result.
 */
export function upsertFinding(input: UpsertFindingInput, db?: Database): UpsertFindingResult {
  const d = db || getDatabase();
  const fingerprint = normalizeFindingFingerprint(input.fingerprint);
  const title = sanitizePreWriteText(input.title, "finding.title").trim();
  if (!title) throw new Error("finding title is required");

  return d.transaction(() => {
    const taskList = input.task_list_id ? getTaskList(input.task_list_id, d) : null;
    if (input.task_list_id && !taskList) throw new Error(`Task list not found: ${input.task_list_id}`);
    if (input.project_id && taskList?.project_id && input.project_id !== taskList.project_id) {
      throw new Error(`Task list ${taskList.id} belongs to project ${taskList.project_id}, not ${input.project_id}`);
    }
    const projectId = input.project_id ?? taskList?.project_id ?? undefined;
    const dedupeFingerprint = findingTaskDedupeFingerprint(fingerprint, projectId);
    const existing = getTaskByFingerprint(dedupeFingerprint, d);
    const findingStatus = normalizeFindingStatus(input.status);
    const severity = normalizeFindingSeverity(input.severity ?? input.priority, existingSeverity(existing));
    const priority = normalizeFindingSeverity(input.priority, severity);
    const sanitizedEvidence = input.evidence === undefined
      ? undefined
      : sanitizePreWriteText(input.evidence, "finding.evidence").trim();
    const evidenceFingerprint = sanitizedEvidence
      ? findingEvidenceFingerprint(sanitizedEvidence, input.evidence_fingerprint)
      : undefined;
    const knownEvidence = evidenceFingerprints(existing);
    const evidenceMatched = evidenceFingerprint !== undefined && knownEvidence.includes(evidenceFingerprint);
    const nextEvidence = evidenceFingerprint && !evidenceMatched
      ? [...knownEvidence, evidenceFingerprint]
      : knownEvidence;
    const metadata = {
      ...(input.metadata ?? {}),
      finding_fingerprint: fingerprint,
      finding_status: findingStatus,
      finding_severity: severity,
      ...(input.source !== undefined ? { finding_source: input.source } : {}),
      ...(nextEvidence.length > 0 ? { finding_evidence_fingerprints: nextEvidence } : {}),
    };

    const result = upsertTaskByFingerprint({
      fingerprint: dedupeFingerprint,
      title,
      description: input.body === undefined
        ? undefined
        : sanitizePreWriteText(input.body, "finding.body"),
      status: findingTaskStatus(findingStatus, existing?.status),
      priority,
      project_id: projectId,
      task_list_id: input.task_list_id,
      tags: input.tags,
      metadata,
      assigned_to: input.assigned_to,
      agent_id: input.agent_id,
      session_id: input.session_id,
      working_dir: input.working_dir,
      task_type: "finding",
    }, d);

    let evidenceAction: FindingEvidenceAction = "none";
    if (sanitizedEvidence) {
      if (evidenceMatched) {
        evidenceAction = "matched";
      } else {
        addComment({
          task_id: result.task.id,
          content: sanitizedEvidence,
          type: "note",
          agent_id: input.agent_id,
          session_id: input.session_id,
        }, d);
        evidenceAction = "appended";
      }
    }

    return {
      schema_version: FINDING_UPSERT_SCHEMA_VERSION,
      action: result.created ? "created" : "updated",
      evidence_action: evidenceAction,
      finding: compactFinding(result.task, fingerprint, findingStatus, severity),
    };
  })();
}
