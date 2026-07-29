import type { Database } from "bun:sqlite";
import { listTasks } from "../db/tasks.js";
import {
  customerSavedViewOwner,
  executeCustomerSearchDataset,
  newCustomerSavedView,
  paginateCustomerSavedViews,
  parseCustomerSavedView,
  parseCustomerSavedViewCreate,
  parseCustomerSavedViewExecute,
  parseCustomerSavedViewList,
  parseCustomerSavedViewUpdate,
  type CustomerSavedView,
  type CustomerSavedViewCreateInput,
  type CustomerSavedViewExecuteInput,
  type CustomerSavedViewListInput,
  type CustomerSavedViewPage,
  type CustomerSavedViewUpdateInput,
  type CustomerTaskPage,
} from "./customer-search-contract.js";

type Row = Record<string, unknown>;

interface SavedViewRow {
  id: string;
  owner: string;
  name: string;
  description: string | null;
  query_json: string;
  audience: "private" | "organization";
  version: number;
  created_at: string;
  updated_at: string;
}

function tableExists(db: Database, name: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
}

function rows(db: Database, table: string): Row[] {
  if (!tableExists(db, table)) return [];
  return db.query(`SELECT * FROM ${table}`).all() as Row[];
}

function addDocument(documents: Map<string, unknown[]>, taskId: unknown, value: unknown): void {
  if (typeof taskId !== "string" || !documents.has(taskId)) return;
  documents.get(taskId)!.push(value);
}

/**
 * Build the local task-search corpus from every persisted customer-facing
 * surface. Search returns tasks, while associated project/plan/run/comment/
 * evidence/git/projection records make their owning task discoverable.
 */
function buildLocalSearchDocuments(db: Database): Map<string, unknown[]> {
  const tasks = listTasks({ include_subtasks: true }, db);
  const documents = new Map(tasks.map((task) => [task.id, [] as unknown[]]));

  const tasksByProject = new Map<string, string[]>();
  const tasksByPlan = new Map<string, string[]>();
  const tasksByList = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.project_id) tasksByProject.set(task.project_id, [...(tasksByProject.get(task.project_id) ?? []), task.id]);
    if (task.plan_id) tasksByPlan.set(task.plan_id, [...(tasksByPlan.get(task.plan_id) ?? []), task.id]);
    if (task.task_list_id) tasksByList.set(task.task_list_id, [...(tasksByList.get(task.task_list_id) ?? []), task.id]);
  }
  for (const project of rows(db, "projects")) {
    for (const taskId of tasksByProject.get(String(project.id)) ?? []) addDocument(documents, taskId, project);
  }
  for (const plan of rows(db, "plans")) {
    for (const taskId of tasksByPlan.get(String(plan.id)) ?? []) addDocument(documents, taskId, plan);
  }
  for (const taskList of rows(db, "task_lists")) {
    for (const taskId of tasksByList.get(String(taskList.id)) ?? []) addDocument(documents, taskId, taskList);
  }

  for (const table of [
    "task_comments",
    "task_history",
    "task_verifications",
    "verification_records",
    "task_commits",
    "task_git_refs",
    "task_relationships",
  ]) {
    for (const row of rows(db, table)) {
      addDocument(documents, row.task_id ?? row.source_task_id, row);
      addDocument(documents, row.target_task_id, row);
    }
  }

  for (const dependency of rows(db, "task_dependencies")) {
    addDocument(documents, dependency.task_id, dependency);
    addDocument(documents, dependency.depends_on, dependency);
  }

  const runToTask = new Map<string, string>();
  for (const run of rows(db, "task_runs")) {
    if (typeof run.id === "string" && typeof run.task_id === "string") runToTask.set(run.id, run.task_id);
    addDocument(documents, run.task_id, run);
  }
  for (const table of ["task_run_events", "task_run_commands", "task_run_files", "task_run_artifacts", "task_run_checkpoints"]) {
    for (const row of rows(db, table)) {
      addDocument(documents, row.task_id ?? runToTask.get(String(row.run_id)), row);
    }
  }

  for (const artifact of rows(db, "artifacts")) {
    if (artifact.entity_type === "task") addDocument(documents, artifact.entity_id, artifact);
    if (artifact.entity_type === "task_run") addDocument(documents, runToTask.get(String(artifact.entity_id)), artifact);
  }

  if (tableExists(db, "task_custom_field_values") && tableExists(db, "custom_field_definitions")) {
    const fieldRows = db.query(`
      SELECT values_table.task_id, values_table.value, definitions.*
      FROM task_custom_field_values AS values_table
      JOIN custom_field_definitions AS definitions ON definitions.id = values_table.field_id
    `).all() as Row[];
    for (const field of fieldRows) addDocument(documents, field.task_id, field);
  }

  const groups = rows(db, "pr_groups");
  const groupToTask = new Map<string, string>();
  for (const group of groups) {
    if (typeof group.id === "string" && typeof group.leaf_task_id === "string") groupToTask.set(group.id, group.leaf_task_id);
    addDocument(documents, group.leaf_task_id, group);
    addDocument(documents, group.root_request_id, group);
  }
  for (const attempt of rows(db, "pr_group_attempts")) {
    addDocument(documents, attempt.leaf_task_id ?? groupToTask.get(String(attempt.group_id)), attempt);
  }
  for (const event of rows(db, "pr_group_events")) {
    addDocument(documents, groupToTask.get(String(event.group_id)), event);
  }

  return documents;
}

export function executeLocalCustomerSearch(rawRequest: unknown, db: Database): CustomerTaskPage {
  const tasks = listTasks({ include_subtasks: true }, db);
  return executeCustomerSearchDataset(rawRequest, { tasks, documents: buildLocalSearchDocuments(db) });
}

function ensureSavedViewTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_saved_views (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      query_json TEXT NOT NULL,
      audience TEXT NOT NULL CHECK(audience IN ('private', 'organization')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner, name)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_saved_views_owner_updated
      ON customer_saved_views(owner, updated_at DESC, id);
  `);
}

function rowToView(row: SavedViewRow): CustomerSavedView {
  return parseCustomerSavedView({
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    query: JSON.parse(row.query_json),
    audience: row.audience,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function getRow(ref: string, db: Database, owner = customerSavedViewOwner()): SavedViewRow | null {
  ensureSavedViewTable(db);
  return db.query(
    "SELECT * FROM customer_saved_views WHERE owner = ? AND (id = ? OR name = ?) LIMIT 1",
  ).get(owner, ref, ref) as SavedViewRow | null;
}

export function getLocalCustomerSavedView(ref: string, db: Database): CustomerSavedView | null {
  const row = getRow(ref, db);
  return row ? rowToView(row) : null;
}

export function createLocalCustomerSavedView(rawInput: unknown, db: Database): CustomerSavedView {
  ensureSavedViewTable(db);
  const input = parseCustomerSavedViewCreate(rawInput);
  const owner = customerSavedViewOwner();
  const existing = getRow(input.name, db, owner);
  if (existing) {
    const view = rowToView(existing);
    if (JSON.stringify({ name: view.name, description: view.description, query: view.query, audience: view.audience }) === JSON.stringify(input)) {
      return view;
    }
    throw new Error(`Saved view already exists: ${input.name}`);
  }
  const view = newCustomerSavedView(input, owner);
  db.run(
    `INSERT INTO customer_saved_views
      (id, owner, name, description, query_json, audience, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [view.id, view.owner, view.name, view.description, JSON.stringify(view.query), view.audience, view.version, view.createdAt, view.updatedAt],
  );
  return view;
}

export function listLocalCustomerSavedViews(rawInput: unknown, db: Database): CustomerSavedViewPage {
  ensureSavedViewTable(db);
  const input = parseCustomerSavedViewList(rawInput) as CustomerSavedViewListInput;
  const stored = db.query("SELECT * FROM customer_saved_views WHERE owner = ?").all(customerSavedViewOwner()) as SavedViewRow[];
  return paginateCustomerSavedViews(stored.map(rowToView), input);
}

export function updateLocalCustomerSavedView(rawInput: unknown, db: Database): CustomerSavedView {
  const input = parseCustomerSavedViewUpdate(rawInput) as CustomerSavedViewUpdateInput;
  const row = getRow(input.ref, db);
  if (!row) throw new Error(`Saved view not found: ${input.ref}`);
  if (row.version !== input.expectedVersion) {
    throw new Error(`Saved view version conflict: expected ${input.expectedVersion}, current ${row.version}`);
  }
  const current = rowToView(row);
  const updated = parseCustomerSavedView({
    ...current,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  });
  db.run(
    `UPDATE customer_saved_views
     SET name = ?, description = ?, query_json = ?, audience = ?, version = ?, updated_at = ?
     WHERE id = ? AND owner = ?`,
    [updated.name, updated.description, JSON.stringify(updated.query), updated.audience, updated.version, updated.updatedAt, updated.id, updated.owner],
  );
  return updated;
}

export function executeLocalCustomerSavedView(rawInput: unknown, db: Database): CustomerTaskPage {
  const input = parseCustomerSavedViewExecute(rawInput) as CustomerSavedViewExecuteInput;
  const view = getLocalCustomerSavedView(input.ref, db);
  if (!view) throw new Error(`Saved view not found: ${input.ref}`);
  return executeLocalCustomerSearch({ ...view.query, cursor: input.cursor, limit: input.limit }, db);
}

export function deleteLocalCustomerSavedView(ref: string, expectedVersion: number, db: Database): CustomerSavedView {
  const row = getRow(ref, db);
  if (!row) throw new Error(`Saved view not found: ${ref}`);
  if (row.version !== expectedVersion) {
    throw new Error(`Saved view version conflict: expected ${expectedVersion}, current ${row.version}`);
  }
  db.run("DELETE FROM customer_saved_views WHERE id = ? AND owner = ?", [row.id, row.owner]);
  return rowToView(row);
}

export type {
  CustomerSavedViewCreateInput,
  CustomerSavedViewExecuteInput,
  CustomerSavedViewListInput,
  CustomerSavedViewUpdateInput,
};
