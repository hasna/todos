import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string | null;
  changes: string | null;
  created_at: string;
}

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    ...row,
    changes: row.changes ? (JSON.parse(row.changes) as Record<string, unknown>) : null,
  };
}

export function logAudit(
  entityType: string,
  entityId: string,
  action: string,
  actor?: string,
  changes?: Record<string, unknown>,
  db?: Database,
): void {
  const d = db || getDatabase();
  d.run(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, actor, changes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), entityType, entityId, action, actor || null, changes ? JSON.stringify(changes) : null, now()],
  );
}

export function getAuditLog(
  entityType?: string,
  entityId?: string,
  limit = 50,
  offset = 0,
  db?: Database,
): AuditEntry[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (entityType) {
    conditions.push("entity_type = ?");
    params.push(entityType);
  }
  if (entityId) {
    conditions.push("entity_id = ?");
    params.push(entityId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const rows = d
    .query(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params) as AuditRow[];

  return rows.map(rowToEntry);
}
