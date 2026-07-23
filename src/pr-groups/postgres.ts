import type { TodosPostgresQueryClient } from "../storage/postgres-sync.js";
import {
  PrGroupLedgerError,
  type PrGroupAttemptRecord,
  type PrGroupEventListOptions,
  type PrGroupEventRecord,
  type PrGroupLedgerPersistence,
  type PrGroupLedgerTransaction,
  type PrGroupRecord,
} from "./types.js";

export interface PrGroupPostgresQueryClient extends TodosPostgresQueryClient {
  transaction<T>(fn: (client: TodosPostgresQueryClient) => Promise<T>): Promise<T>;
}

export function postgresPrGroupSchemaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS todos_pr_groups (
      schema_version integer NOT NULL DEFAULT 1, id text PRIMARY KEY,
      identity_key text NOT NULL UNIQUE, root_request_id text NOT NULL,
      repository text NOT NULL, state text NOT NULL, active_attempt_id text,
      active_generation text, terminal_attempt_id text, terminal_generation text,
      terminal_outcome text, terminal_head_sha text, terminal_at timestamptz,
      cleanup_eligible_at timestamptz, revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS todos_pr_groups_root_repository_idx
       ON todos_pr_groups (root_request_id, repository)`,
    `CREATE INDEX IF NOT EXISTS todos_pr_groups_active_generation_idx
       ON todos_pr_groups (active_generation)`,
    `CREATE TABLE IF NOT EXISTS todos_pr_group_attempts (
      schema_version integer NOT NULL DEFAULT 1, id text PRIMARY KEY,
      group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
      leaf_task_id text NOT NULL, dispatch_attempt text NOT NULL,
      writer_generation text NOT NULL,
      previous_attempt_id text REFERENCES todos_pr_group_attempts(id) ON DELETE SET NULL,
      worktree text NOT NULL, branch text NOT NULL, provider text,
      provider_run_id text, profile_alias text, status text NOT NULL,
      admitted_at timestamptz NOT NULL, started_at timestamptz,
      last_heartbeat_at timestamptz, handed_off_at timestamptz,
      fenced_at timestamptz, terminal_at timestamptz,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      UNIQUE (group_id, leaf_task_id, dispatch_attempt),
      UNIQUE (group_id, writer_generation)
    )`,
    `CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_group_idx
       ON todos_pr_group_attempts (group_id, created_at, id)`,
    `CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_generation_idx
       ON todos_pr_group_attempts (group_id, writer_generation)`,
    `CREATE TABLE IF NOT EXISTS todos_pr_group_events (
      schema_version integer NOT NULL DEFAULT 1, id text PRIMARY KEY,
      group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
      attempt_id text NOT NULL REFERENCES todos_pr_group_attempts(id) ON DELETE CASCADE,
      writer_generation text NOT NULL, sequence integer NOT NULL,
      idempotency_key text NOT NULL, event_type text NOT NULL, state text NOT NULL,
      message text, head_sha text, receipt_key text, outcome text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, payload_hash text NOT NULL,
      created_at timestamptz NOT NULL,
      UNIQUE (group_id, sequence), UNIQUE (group_id, idempotency_key),
      UNIQUE (group_id, receipt_key)
    )`,
    `CREATE INDEX IF NOT EXISTS todos_pr_group_events_group_sequence_idx
       ON todos_pr_group_events (group_id, sequence)`,
    `CREATE INDEX IF NOT EXISTS todos_pr_group_events_attempt_idx
       ON todos_pr_group_events (attempt_id, sequence)`,
    `CREATE INDEX IF NOT EXISTS todos_pr_group_events_receipt_idx
       ON todos_pr_group_events (group_id, receipt_key)`,
  ];
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function groupFromRow(row: Record<string, unknown>): PrGroupRecord {
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    revision: Number(row["revision"]),
    terminal_at: normalizeTimestamp(row["terminal_at"]),
    cleanup_eligible_at: normalizeTimestamp(row["cleanup_eligible_at"]),
    created_at: normalizeTimestamp(row["created_at"])!,
    updated_at: normalizeTimestamp(row["updated_at"])!,
  } as unknown as PrGroupRecord;
}

function attemptFromRow(row: Record<string, unknown>): PrGroupAttemptRecord {
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    admitted_at: normalizeTimestamp(row["admitted_at"])!,
    started_at: normalizeTimestamp(row["started_at"]),
    last_heartbeat_at: normalizeTimestamp(row["last_heartbeat_at"]),
    handed_off_at: normalizeTimestamp(row["handed_off_at"]),
    fenced_at: normalizeTimestamp(row["fenced_at"]),
    terminal_at: normalizeTimestamp(row["terminal_at"]),
    created_at: normalizeTimestamp(row["created_at"])!,
    updated_at: normalizeTimestamp(row["updated_at"])!,
  } as unknown as PrGroupAttemptRecord;
}

function eventFromRow(row: Record<string, unknown>): PrGroupEventRecord {
  let metadata = row["metadata"] ?? {};
  if (typeof metadata === "string") metadata = JSON.parse(metadata);
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    sequence: Number(row["sequence"]),
    metadata,
    created_at: normalizeTimestamp(row["created_at"])!,
  } as unknown as PrGroupEventRecord;
}

class PostgresPrGroupTransaction implements PrGroupLedgerTransaction {
  constructor(private readonly client: TodosPostgresQueryClient) {}

  async getGroup(id: string, forUpdate = false): Promise<PrGroupRecord | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT * FROM todos_pr_groups WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [id],
    );
    return result.rows[0] ? groupFromRow(result.rows[0]) : null;
  }

  async insertGroup(group: PrGroupRecord): Promise<boolean> {
    const result = await this.client.query<{ id: string }>(`
      INSERT INTO todos_pr_groups (
        schema_version, id, identity_key, root_request_id, repository, state,
        active_attempt_id, active_generation, terminal_attempt_id, terminal_generation,
        terminal_outcome, terminal_head_sha, terminal_at, cleanup_eligible_at,
        revision, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO NOTHING RETURNING id
    `, [
      group.schema_version, group.id, group.identity_key, group.root_request_id, group.repository, group.state,
      group.active_attempt_id, group.active_generation, group.terminal_attempt_id, group.terminal_generation,
      group.terminal_outcome, group.terminal_head_sha, group.terminal_at, group.cleanup_eligible_at,
      group.revision, group.created_at, group.updated_at,
    ]);
    return result.rows.length === 1;
  }

  async updateGroup(group: PrGroupRecord): Promise<void> {
    await this.client.query(`
      UPDATE todos_pr_groups SET state=$1, active_attempt_id=$2, active_generation=$3,
        terminal_attempt_id=$4, terminal_generation=$5, terminal_outcome=$6,
        terminal_head_sha=$7, terminal_at=$8, cleanup_eligible_at=$9,
        revision=$10, updated_at=$11 WHERE id=$12
    `, [
      group.state, group.active_attempt_id, group.active_generation,
      group.terminal_attempt_id, group.terminal_generation, group.terminal_outcome,
      group.terminal_head_sha, group.terminal_at, group.cleanup_eligible_at,
      group.revision, group.updated_at, group.id,
    ]);
  }

  async getAttempt(id: string): Promise<PrGroupAttemptRecord | null> {
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM todos_pr_group_attempts WHERE id = $1",
      [id],
    );
    return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
  }

  async listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]> {
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM todos_pr_group_attempts WHERE group_id = $1 ORDER BY created_at ASC, id ASC",
      [groupId],
    );
    return result.rows.map(attemptFromRow);
  }

  async insertAttempt(attempt: PrGroupAttemptRecord): Promise<boolean> {
    const result = await this.client.query<{ id: string }>(`
      INSERT INTO todos_pr_group_attempts (
        schema_version,id,group_id,leaf_task_id,dispatch_attempt,writer_generation,
        previous_attempt_id,worktree,branch,provider,provider_run_id,profile_alias,
        status,admitted_at,started_at,last_heartbeat_at,handed_off_at,fenced_at,
        terminal_at,created_at,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO NOTHING RETURNING id
    `, [
      attempt.schema_version, attempt.id, attempt.group_id, attempt.leaf_task_id,
      attempt.dispatch_attempt, attempt.writer_generation, attempt.previous_attempt_id,
      attempt.worktree, attempt.branch, attempt.provider, attempt.provider_run_id,
      attempt.profile_alias, attempt.status, attempt.admitted_at, attempt.started_at,
      attempt.last_heartbeat_at, attempt.handed_off_at, attempt.fenced_at,
      attempt.terminal_at, attempt.created_at, attempt.updated_at,
    ]);
    return result.rows.length === 1;
  }

  async updateAttempt(attempt: PrGroupAttemptRecord): Promise<void> {
    await this.client.query(`
      UPDATE todos_pr_group_attempts SET status=$1,started_at=$2,last_heartbeat_at=$3,
        handed_off_at=$4,fenced_at=$5,terminal_at=$6,updated_at=$7 WHERE id=$8
    `, [
      attempt.status, attempt.started_at, attempt.last_heartbeat_at, attempt.handed_off_at,
      attempt.fenced_at, attempt.terminal_at, attempt.updated_at, attempt.id,
    ]);
  }

  async getEventByIdempotency(groupId: string, key: string): Promise<PrGroupEventRecord | null> {
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM todos_pr_group_events WHERE group_id = $1 AND idempotency_key = $2",
      [groupId, key],
    );
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async findEvent(groupId: string, filters: {
    event_type: PrGroupEventRecord["event_type"];
    attempt_id?: string;
    head_sha?: string | null;
    outcome?: PrGroupEventRecord["outcome"];
    receipt_key?: string;
  }): Promise<PrGroupEventRecord | null> {
    const clauses = ["group_id = $1", "event_type = $2"];
    const values: unknown[] = [groupId, filters.event_type];
    for (const key of ["attempt_id", "head_sha", "outcome", "receipt_key"] as const) {
      if (!(key in filters)) continue;
      if (filters[key] === null) clauses.push(`${key} IS NULL`);
      else {
        values.push(filters[key]);
        clauses.push(`${key} = $${values.length}`);
      }
    }
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT * FROM todos_pr_group_events WHERE ${clauses.join(" AND ")} ORDER BY sequence DESC LIMIT 1`,
      values,
    );
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async listEvents(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventRecord[]> {
    const result = await this.client.query<Record<string, unknown>>(`
      SELECT * FROM todos_pr_group_events
      WHERE group_id = $1 AND sequence > $2
      ORDER BY sequence ASC LIMIT $3
    `, [groupId, options.after_sequence ?? 0, options.limit ?? 500]);
    return result.rows.map(eventFromRow);
  }

  async nextSequence(groupId: string): Promise<number> {
    const result = await this.client.query<{ sequence: number | string }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM todos_pr_group_events WHERE group_id = $1",
      [groupId],
    );
    return Number(result.rows[0]?.sequence ?? 1);
  }

  async insertEvent(event: PrGroupEventRecord): Promise<boolean> {
    const result = await this.client.query<{ id: string }>(`
      INSERT INTO todos_pr_group_events (
        schema_version,id,group_id,attempt_id,writer_generation,sequence,
        idempotency_key,event_type,state,message,head_sha,receipt_key,outcome,
        metadata,payload_hash,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
      ON CONFLICT (id) DO NOTHING RETURNING id
    `, [
      event.schema_version, event.id, event.group_id, event.attempt_id,
      event.writer_generation, event.sequence, event.idempotency_key, event.event_type,
      event.state, event.message, event.head_sha, event.receipt_key, event.outcome,
      JSON.stringify(event.metadata), event.payload_hash, event.created_at,
    ]);
    return result.rows.length === 1;
  }
}

export class PostgresPrGroupLedgerPersistence implements PrGroupLedgerPersistence {
  readonly authority = "remote" as const;
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly client: PrGroupPostgresQueryClient) {}

  async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const statement of postgresPrGroupSchemaSql()) await this.client.query(statement);
    })();
    return this.schemaReady;
  }

  async transaction<T>(fn: (tx: PrGroupLedgerTransaction) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    if (typeof this.client.transaction !== "function") {
      throw new PrGroupLedgerError(
        "PR_GROUP_ATOMICITY_UNAVAILABLE",
        "remote PR-group mutations require an authoritative database transaction",
      );
    }
    return this.client.transaction((transaction) => fn(new PostgresPrGroupTransaction(transaction)));
  }

  async getGroup(id: string): Promise<PrGroupRecord | null> {
    await this.ensureSchema();
    return new PostgresPrGroupTransaction(this.client).getGroup(id);
  }

  async listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]> {
    await this.ensureSchema();
    return new PostgresPrGroupTransaction(this.client).listAttempts(groupId);
  }

  async listEvents(groupId: string, options?: PrGroupEventListOptions): Promise<PrGroupEventRecord[]> {
    await this.ensureSchema();
    return new PostgresPrGroupTransaction(this.client).listEvents(groupId, options);
  }

  async listReceiptEvents(groupId: string, limit: number): Promise<PrGroupEventRecord[]> {
    await this.ensureSchema();
    const result = await this.client.query<Record<string, unknown>>(`
      SELECT * FROM todos_pr_group_events
      WHERE group_id = $1 AND event_type IN ('review_receipt', 'conditional_merge_receipt')
      ORDER BY sequence ASC LIMIT $2
    `, [groupId, limit]);
    return result.rows.map(eventFromRow);
  }

  async countEvents(groupId: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.client.query<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM todos_pr_group_events WHERE group_id = $1",
      [groupId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getLatestEvent(groupId: string): Promise<PrGroupEventRecord | null> {
    await this.ensureSchema();
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM todos_pr_group_events WHERE group_id = $1 ORDER BY sequence DESC LIMIT 1",
      [groupId],
    );
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }
}
