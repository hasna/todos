import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface BillingCustomer {
  id: string;
  stripe_customer_id: string | null;
  email: string | null;
  name: string | null;
  plan: "free" | "pro" | "team" | "enterprise";
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageRecord {
  id: string;
  customer_id: string | null;
  metric: string;
  count: number;
  period: string;
  created_at: string;
}

export function getOrCreateCustomer(db?: Database): BillingCustomer {
  const d = db || getDatabase();
  const existing = d.query("SELECT * FROM billing_customers LIMIT 1").get() as BillingCustomer | null;
  if (existing) return existing;

  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO billing_customers (id, plan, created_at, updated_at) VALUES (?, 'free', ?, ?)`,
    [id, timestamp, timestamp],
  );
  return d.query("SELECT * FROM billing_customers WHERE id = ?").get(id) as BillingCustomer;
}

export function updateCustomer(
  id: string,
  input: Partial<Pick<BillingCustomer, "stripe_customer_id" | "email" | "name" | "plan" | "stripe_subscription_id" | "subscription_status" | "current_period_end">>,
  db?: Database,
): BillingCustomer {
  const d = db || getDatabase();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | null)[] = [now()];

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value as string | null);
    }
  }

  params.push(id);
  d.run(`UPDATE billing_customers SET ${sets.join(", ")} WHERE id = ?`, params);
  return d.query("SELECT * FROM billing_customers WHERE id = ?").get(id) as BillingCustomer;
}

export function getCustomerByStripeId(stripeCustomerId: string, db?: Database): BillingCustomer | null {
  const d = db || getDatabase();
  return d.query("SELECT * FROM billing_customers WHERE stripe_customer_id = ?").get(stripeCustomerId) as BillingCustomer | null;
}

export function getUsage(customerId: string, period: string, db?: Database): UsageRecord[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM usage_records WHERE customer_id = ? AND period = ?").all(customerId, period) as UsageRecord[];
}

export function trackUsage(customerId: string, metric: string, count: number = 1, db?: Database): void {
  const d = db || getDatabase();
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const existing = d.query(
    "SELECT * FROM usage_records WHERE customer_id = ? AND metric = ? AND period = ?"
  ).get(customerId, metric, period) as UsageRecord | null;

  if (existing) {
    d.run("UPDATE usage_records SET count = count + ? WHERE id = ?", [count, existing.id]);
  } else {
    d.run(
      "INSERT INTO usage_records (id, customer_id, metric, count, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [uuid(), customerId, metric, count, period, now()],
    );
  }
}

export const PLAN_LIMITS = {
  free: { tasks: 100, projects: 3, plans: 5, api_keys: 1, webhooks: 0 },
  pro: { tasks: 10000, projects: 50, plans: 100, api_keys: 10, webhooks: 10 },
  team: { tasks: 100000, projects: 500, plans: 1000, api_keys: 50, webhooks: 50 },
  enterprise: { tasks: -1, projects: -1, plans: -1, api_keys: -1, webhooks: -1 }, // unlimited
} as const;

export const PLAN_PRICES = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 9, yearly: 84 },
  team: { monthly: 29, yearly: 276 },
  enterprise: { monthly: 99, yearly: 948 },
} as const;
