import type { Database, SQLQueryBindings } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDatabase, getDatabasePath, now, uuid } from "./database.js";

export interface LocalEvent {
  sequence: number;
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  task_id: string | null;
  project_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CreateLocalEventInput {
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  task_id?: string | null;
  project_id?: string | null;
  plan_id?: string | null;
  agent_id?: string | null;
  data?: Record<string, unknown>;
  created_at?: string;
}

export interface LocalEventFilter {
  since_sequence?: number;
  after?: string;
  event_type?: string;
  entity_type?: string;
  entity_id?: string;
  task_id?: string;
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  limit?: number;
}

export interface LocalEventJsonLine {
  schema_version: 1;
  sequence: number;
  id: string;
  type: string;
  entity: {
    type: string;
    id: string | null;
  };
  refs: {
    task_id: string | null;
    project_id: string | null;
    plan_id: string | null;
    agent_id: string | null;
  };
  data: Record<string, unknown>;
  created_at: string;
}

function parseEventRow(row: any): LocalEvent {
  return {
    ...row,
    sequence: Number(row.sequence),
    entity_id: row.entity_id || null,
    task_id: row.task_id || null,
    project_id: row.project_id || null,
    plan_id: row.plan_id || null,
    agent_id: row.agent_id || null,
    data: JSON.parse(row.data || "{}") as Record<string, unknown>,
  };
}

function canWriteEventFile(path: string): boolean {
  return path !== ":memory:" && !path.startsWith("file::memory:");
}

export function getLocalEventLogPath(): string | null {
  const override = process.env["HASNA_TODOS_EVENT_LOG_PATH"] || process.env["TODOS_EVENT_LOG_PATH"];
  if (override) return override;

  const dbPath = getDatabasePath();
  if (!canWriteEventFile(dbPath)) return null;
  return join(dirname(dbPath), "events.jsonl");
}

export function toLocalEventJsonLine(event: LocalEvent): LocalEventJsonLine {
  return {
    schema_version: 1,
    sequence: event.sequence,
    id: event.id,
    type: event.event_type,
    entity: {
      type: event.entity_type,
      id: event.entity_id,
    },
    refs: {
      task_id: event.task_id,
      project_id: event.project_id,
      plan_id: event.plan_id,
      agent_id: event.agent_id,
    },
    data: event.data,
    created_at: event.created_at,
  };
}

export function serializeLocalEvent(event: LocalEvent): string {
  return JSON.stringify(toLocalEventJsonLine(event));
}

function appendLocalEventJsonl(event: LocalEvent): void {
  const path = getLocalEventLogPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${serializeLocalEvent(event)}\n`, "utf8");
}

export function recordLocalEvent(input: CreateLocalEventInput, db?: Database): LocalEvent {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = input.created_at || now();
  d.run(
    `INSERT INTO local_events (id, event_type, entity_type, entity_id, task_id, project_id, plan_id, agent_id, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.event_type,
      input.entity_type,
      input.entity_id || null,
      input.task_id || null,
      input.project_id || null,
      input.plan_id || null,
      input.agent_id || null,
      JSON.stringify(input.data || {}),
      timestamp,
    ],
  );
  const event = parseEventRow(d.query("SELECT * FROM local_events WHERE id = ?").get(id));
  appendLocalEventJsonl(event);
  return event;
}

export function listLocalEvents(filter: LocalEventFilter = {}, db?: Database): LocalEvent[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.since_sequence !== undefined) {
    conditions.push("sequence > ?");
    params.push(filter.since_sequence);
  }
  if (filter.after) {
    conditions.push("created_at > ?");
    params.push(filter.after);
  }
  for (const key of ["event_type", "entity_type", "entity_id", "task_id", "project_id", "plan_id", "agent_id"] as const) {
    const value = filter[key];
    if (value) {
      conditions.push(`${key} = ?`);
      params.push(value);
    }
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 1000);
  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return d
    .query(`SELECT * FROM local_events ${where} ORDER BY sequence ASC LIMIT ?`)
    .all(...params)
    .map(parseEventRow);
}

export function localEventsToJsonl(events: LocalEvent[]): string {
  return events.map(serializeLocalEvent).join("\n");
}
