import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTasks, getTask, createTask, updateTask } from "../db/tasks.js";
import type { Task, TaskStatus } from "../types/index.js";

const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

interface ClaudeTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
  owner: string;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
}

function getTaskListDir(taskListId: string): string {
  return join(HOME, ".claude", "tasks", taskListId);
}

function readHighWaterMark(dir: string): number {
  const path = join(dir, ".highwatermark");
  if (!existsSync(path)) return 1;
  const val = parseInt(readFileSync(path, "utf-8").trim(), 10);
  return isNaN(val) ? 1 : val;
}

function writeHighWaterMark(dir: string, value: number): void {
  writeFileSync(join(dir, ".highwatermark"), String(value));
}

function readClaudeTask(dir: string, filename: string): ClaudeTask | null {
  try {
    const content = readFileSync(join(dir, filename), "utf-8");
    return JSON.parse(content) as ClaudeTask;
  } catch {
    return null;
  }
}

function writeClaudeTask(dir: string, task: ClaudeTask): void {
  writeFileSync(join(dir, `${task.id}.json`), JSON.stringify(task, null, 2) + "\n");
}

function toClaudeStatus(status: TaskStatus): ClaudeTask["status"] {
  if (status === "pending" || status === "in_progress" || status === "completed") {
    return status;
  }
  // failed and cancelled map to completed
  return "completed";
}

function toSqliteStatus(status: ClaudeTask["status"]): TaskStatus {
  return status;
}

function taskToClaudeTask(task: Task, claudeTaskId: string): ClaudeTask {
  return {
    id: claudeTaskId,
    subject: task.title,
    description: task.description || "",
    activeForm: "",
    status: toClaudeStatus(task.status),
    owner: task.assigned_to || task.agent_id || "",
    blocks: [],
    blockedBy: [],
    metadata: {
      todos_id: task.id,
      priority: task.priority,
    },
  };
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

/**
 * Push all SQLite tasks to a Claude Code task list directory.
 */
export function pushToClaudeTaskList(taskListId: string, projectId?: string): SyncResult {
  const dir = getTaskListDir(taskListId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filter: Record<string, unknown> = {};
  if (projectId) filter["project_id"] = projectId;
  const tasks = listTasks(filter as any);

  // Build map of existing Claude tasks by todos_id
  const existingByTodosId = new Map<string, ClaudeTask>();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const ct = readClaudeTask(dir, f);
    if (ct?.metadata?.["todos_id"]) {
      existingByTodosId.set(ct.metadata["todos_id"] as string, ct);
    }
  }

  let hwm = readHighWaterMark(dir);
  let pushed = 0;
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      const existing = existingByTodosId.get(task.id);
      if (existing) {
        // Update existing Claude task
        const updated = taskToClaudeTask(task, existing.id);
        updated.blocks = existing.blocks;
        updated.blockedBy = existing.blockedBy;
        updated.activeForm = existing.activeForm;
        writeClaudeTask(dir, updated);
      } else {
        // Create new Claude task
        const claudeId = String(hwm);
        hwm++;
        const ct = taskToClaudeTask(task, claudeId);
        writeClaudeTask(dir, ct);

        // Store the mapping in SQLite metadata
        const current = getTask(task.id);
        if (current) {
          const newMeta = { ...current.metadata, claude_task_id: claudeId };
          updateTask(task.id, { version: current.version, metadata: newMeta });
        }
      }
      pushed++;
    } catch (e) {
      errors.push(`push ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  writeHighWaterMark(dir, hwm);
  return { pushed, pulled: 0, errors };
}

/**
 * Pull tasks from a Claude Code task list into SQLite.
 */
export function pullFromClaudeTaskList(taskListId: string, projectId?: string): SyncResult {
  const dir = getTaskListDir(taskListId);
  if (!existsSync(dir)) {
    return { pushed: 0, pulled: 0, errors: [`Task list directory not found: ${dir}`] };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let pulled = 0;
  const errors: string[] = [];

  // Build map of existing SQLite tasks by claude_task_id
  const filter: Record<string, unknown> = {};
  if (projectId) filter["project_id"] = projectId;
  const existingTasks = listTasks(filter as any);
  const byClaudeId = new Map<string, Task>();
  for (const t of existingTasks) {
    const cid = t.metadata["claude_task_id"];
    if (cid) byClaudeId.set(String(cid), t);
  }
  // Also build by todos_id for reverse lookup
  const byTodosId = new Map<string, Task>();
  for (const t of existingTasks) {
    byTodosId.set(t.id, t);
  }

  for (const f of files) {
    try {
      const ct = readClaudeTask(dir, f);
      if (!ct) continue;

      // Skip internal tasks
      if (ct.metadata?.["_internal"]) continue;

      const todosId = ct.metadata?.["todos_id"] as string | undefined;
      const existingByMapping = byClaudeId.get(ct.id);
      const existingByTodos = todosId ? byTodosId.get(todosId) : undefined;
      const existing = existingByMapping || existingByTodos;

      if (existing) {
        // Update existing SQLite task
        updateTask(existing.id, {
          version: existing.version,
          title: ct.subject,
          description: ct.description || undefined,
          status: toSqliteStatus(ct.status),
          assigned_to: ct.owner || undefined,
          metadata: { ...existing.metadata, claude_task_id: ct.id },
        });
      } else {
        // Create new SQLite task
        createTask({
          title: ct.subject,
          description: ct.description || undefined,
          status: toSqliteStatus(ct.status),
          assigned_to: ct.owner || undefined,
          project_id: projectId,
          metadata: { claude_task_id: ct.id },
          priority: (ct.metadata?.["priority"] as any) || "medium",
        });
      }
      pulled++;
    } catch (e) {
      errors.push(`pull ${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { pushed: 0, pulled, errors };
}

/**
 * Bidirectional sync: pull first, then push.
 */
export function syncClaudeTaskList(taskListId: string, projectId?: string): SyncResult {
  const pullResult = pullFromClaudeTaskList(taskListId, projectId);
  const pushResult = pushToClaudeTaskList(taskListId, projectId);
  return {
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    errors: [...pullResult.errors, ...pushResult.errors],
  };
}
