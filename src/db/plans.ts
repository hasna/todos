import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreatePlanInput, Plan, UpdatePlanInput } from "../types/index.js";
import { PlanNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { recordLocalEvent } from "./events.js";

export function createPlan(input: CreatePlanInput, db?: Database): Plan {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO plans (id, project_id, task_list_id, agent_id, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id || null,
      input.task_list_id || null,
      input.agent_id || null,
      input.name,
      input.description || null,
      input.status || "active",
      timestamp,
      timestamp,
    ],
  );

  const plan = getPlan(id, d)!;
  recordLocalEvent({
    event_type: "plan.created",
    entity_type: "plan",
    entity_id: plan.id,
    project_id: plan.project_id,
    plan_id: plan.id,
    agent_id: plan.agent_id,
    data: { name: plan.name, status: plan.status, task_list_id: plan.task_list_id },
    created_at: timestamp,
  }, d);
  return plan;
}

export function getPlan(id: string, db?: Database): Plan | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
  return row;
}

export function listPlans(projectId?: string, db?: Database): Plan[] {
  const d = db || getDatabase();
  if (projectId) {
    return d
      .query("SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Plan[];
  }
  return d
    .query("SELECT * FROM plans ORDER BY created_at DESC")
    .all() as Plan[];
}

export function updatePlan(
  id: string,
  input: UpdatePlanInput,
  db?: Database,
): Plan {
  const d = db || getDatabase();
  const plan = getPlan(id, d);
  if (!plan) throw new PlanNotFoundError(id);

  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(input.task_list_id);
  }
  if (input.agent_id !== undefined) {
    sets.push("agent_id = ?");
    params.push(input.agent_id);
  }

  params.push(id);
  d.run(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, params);

  const updated = getPlan(id, d)!;
  recordLocalEvent({
    event_type: "plan.updated",
    entity_type: "plan",
    entity_id: id,
    project_id: updated.project_id,
    plan_id: id,
    agent_id: updated.agent_id,
    data: { changed_fields: Object.keys(input), status: updated.status },
  }, d);
  return updated;
}

export function deletePlan(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const plan = getPlan(id, d);
  const result = d.run("DELETE FROM plans WHERE id = ?", [id]);
  if (result.changes > 0) {
    recordLocalEvent({
      event_type: "plan.deleted",
      entity_type: "plan",
      entity_id: id,
      project_id: plan?.project_id ?? null,
      plan_id: id,
      agent_id: plan?.agent_id ?? null,
      data: { name: plan?.name ?? null },
    }, d);
  }
  return result.changes > 0;
}
