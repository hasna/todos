-- Authoritative PR-group execution ledger.
--
-- Dedicated relational rows provide transaction/row-lock fencing for one
-- active writer generation. Events and receipts are append-only. This DDL is
-- additive and idempotent; it does not rewrite existing Todos JSONB records.
CREATE TABLE IF NOT EXISTS todos_pr_groups (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  identity_key text NOT NULL UNIQUE,
  root_request_id text NOT NULL,
  repository text NOT NULL,
  state text NOT NULL,
  active_attempt_id text,
  active_generation text,
  terminal_attempt_id text,
  terminal_generation text,
  terminal_outcome text,
  terminal_head_sha text,
  terminal_at timestamptz,
  cleanup_eligible_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS todos_pr_groups_root_repository_idx
  ON todos_pr_groups (root_request_id, repository);
CREATE INDEX IF NOT EXISTS todos_pr_groups_active_generation_idx
  ON todos_pr_groups (active_generation);

CREATE TABLE IF NOT EXISTS todos_pr_group_attempts (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
  leaf_task_id text NOT NULL,
  dispatch_attempt text NOT NULL,
  writer_generation text NOT NULL,
  previous_attempt_id text REFERENCES todos_pr_group_attempts(id) ON DELETE SET NULL,
  worktree text NOT NULL,
  branch text NOT NULL,
  provider text,
  provider_run_id text,
  profile_alias text,
  status text NOT NULL,
  admitted_at timestamptz NOT NULL,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  handed_off_at timestamptz,
  fenced_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (group_id, leaf_task_id, dispatch_attempt),
  UNIQUE (group_id, writer_generation)
);

CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_group_idx
  ON todos_pr_group_attempts (group_id, created_at, id);
CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_generation_idx
  ON todos_pr_group_attempts (group_id, writer_generation);

CREATE TABLE IF NOT EXISTS todos_pr_group_events (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES todos_pr_group_attempts(id) ON DELETE CASCADE,
  writer_generation text NOT NULL,
  sequence integer NOT NULL,
  idempotency_key text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  message text,
  head_sha text,
  receipt_key text,
  outcome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (group_id, sequence),
  UNIQUE (group_id, idempotency_key),
  UNIQUE (group_id, receipt_key)
);

CREATE INDEX IF NOT EXISTS todos_pr_group_events_group_sequence_idx
  ON todos_pr_group_events (group_id, sequence);
CREATE INDEX IF NOT EXISTS todos_pr_group_events_attempt_idx
  ON todos_pr_group_events (attempt_id, sequence);
CREATE INDEX IF NOT EXISTS todos_pr_group_events_receipt_idx
  ON todos_pr_group_events (group_id, receipt_key);
