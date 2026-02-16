import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: number;
  created_at: string;
}

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    ...row,
    events: JSON.parse(row.events) as string[],
    active: row.active === 1,
  };
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
}

export function createWebhook(input: CreateWebhookInput, db?: Database): Webhook {
  const d = db || getDatabase();
  const id = uuid();
  d.run(
    `INSERT INTO webhooks (id, url, events, secret, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.url, JSON.stringify(input.events || []), input.secret || null, now()],
  );
  return getWebhook(id, d)!;
}

export function getWebhook(id: string, db?: Database): Webhook | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM webhooks WHERE id = ?").get(id) as WebhookRow | null;
  return row ? rowToWebhook(row) : null;
}

export function listWebhooks(db?: Database): Webhook[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM webhooks ORDER BY created_at DESC").all() as WebhookRow[]).map(rowToWebhook);
}

export function deleteWebhook(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM webhooks WHERE id = ?", [id]).changes > 0;
}

export async function dispatchWebhooks(event: string, payload: unknown, db?: Database): Promise<void> {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM webhooks WHERE active = 1")
    .all() as WebhookRow[];

  const webhooks = rows.map(rowToWebhook).filter(
    (w) => w.events.length === 0 || w.events.includes(event),
  );

  for (const webhook of webhooks) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (webhook.secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(webhook.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const body = JSON.stringify({ event, data: payload, timestamp: now() });
        const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
        headers["X-Webhook-Signature"] = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        fetch(webhook.url, {
          method: "POST",
          headers,
          body,
        }).catch(() => {});
      } else {
        fetch(webhook.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, data: payload, timestamp: now() }),
        }).catch(() => {});
      }
    } catch {
      // Best-effort delivery
    }
  }
}
