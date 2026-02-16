import type { Database } from "bun:sqlite";
import type { ApiKey, ApiKeyWithSecret, CreateApiKeyInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "td_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(input: CreateApiKeyInput, db?: Database): Promise<ApiKeyWithSecret> {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const key = generateApiKey();
  const keyHash = await hashKey(key);
  const keyPrefix = key.slice(0, 10) + "...";

  d.run(
    `INSERT INTO api_keys (id, name, key_hash, key_prefix, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, keyHash, keyPrefix, timestamp, input.expires_at || null],
  );

  const row = d.query("SELECT id, name, key_prefix, created_at, last_used_at, expires_at FROM api_keys WHERE id = ?").get(id) as ApiKey;
  return { ...row, key };
}

export function listApiKeys(db?: Database): ApiKey[] {
  const d = db || getDatabase();
  return d
    .query("SELECT id, name, key_prefix, created_at, last_used_at, expires_at FROM api_keys ORDER BY created_at DESC")
    .all() as ApiKey[];
}

export function deleteApiKey(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM api_keys WHERE id = ?", [id]);
  return result.changes > 0;
}

export async function validateApiKey(key: string, db?: Database): Promise<ApiKey | null> {
  const d = db || getDatabase();
  const keyHash = await hashKey(key);
  const row = d.query(
    "SELECT id, name, key_prefix, created_at, last_used_at, expires_at FROM api_keys WHERE key_hash = ?"
  ).get(keyHash) as ApiKey | null;

  if (!row) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at
  d.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now(), row.id]);

  return row;
}

export function hasAnyApiKeys(db?: Database): boolean {
  const d = db || getDatabase();
  const row = d.query("SELECT COUNT(*) as count FROM api_keys").get() as { count: number } | null;
  return (row?.count ?? 0) > 0;
}
