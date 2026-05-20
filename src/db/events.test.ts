import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { registerAgent, updateAgentActivity } from "./agents.js";
import { addComment } from "./comments.js";
import { emitHeartbeat, upsertCheckpoint } from "./checkpoints.js";
import { listLocalEvents, localEventsToJsonl, recordLocalEvent } from "./events.js";
import { createPlan } from "./plans.js";
import { createProject } from "./projects.js";
import { addDependency, createTask, startTask } from "./tasks.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-events-"));
  process.env["TODOS_DB_PATH"] = join(tempDir, "todos.db");
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_EVENT_LOG_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("local event stream", () => {
  test("records events in SQLite and appends JSONL locally", () => {
    const task = createTask({ title: "Streamed task", agent_id: "codex" });
    const events = listLocalEvents({ entity_type: "task" });

    expect(events).toHaveLength(1);
    expect(events[0]!).toMatchObject({
      event_type: "task.created",
      entity_type: "task",
      entity_id: task.id,
      task_id: task.id,
      agent_id: "codex",
    });

    const lines = readFileSync(join(tempDir, "events.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({
      schema_version: 1,
      sequence: 1,
      type: "task.created",
      entity: { type: "task", id: task.id },
    });
  });

  test("filters by sequence, event type, and task references", () => {
    const first = createTask({ title: "First" });
    const second = createTask({ title: "Second" });
    startTask(second.id, "agent-1");

    expect(listLocalEvents({ since_sequence: 1 }).map((event) => event.event_type)).toEqual(["task.created", "task.start"]);
    expect(listLocalEvents({ event_type: "task.created" })).toHaveLength(2);
    expect(listLocalEvents({ task_id: first.id })).toHaveLength(1);
    expect(listLocalEvents({ task_id: second.id })).toHaveLength(2);
  });

  test("covers comments, plans, dependencies, agents, and run events", () => {
    const agent = registerAgent({ name: "Eventus" });
    expect("conflict" in agent).toBe(false);
    const project = createProject({ name: "Events Project", path: join(tempDir, "project") });
    const task = createTask({ title: "Run task" });
    const plan = createPlan({ name: "Plan", agent_id: (agent as any).id });
    addComment({ task_id: task.id, content: "Progress", type: "progress", agent_id: (agent as any).id });
    const blocker = createTask({ title: "Blocker" });
    addDependency(task.id, blocker.id);
    upsertCheckpoint(task.id, "test", { status: "running", agent_id: (agent as any).id });
    emitHeartbeat(task.id, { agent_id: (agent as any).id, step: "test", progress: 0.5 });
    updateAgentActivity((agent as any).id);

    const types = listLocalEvents({ limit: 20 }).map((event) => event.event_type);
    expect(types).toContain("agent.registered");
    expect(types).toContain("project.created");
    expect(types).toContain("plan.created");
    expect(types).toContain("comment.progress.created");
    expect(types).toContain("dependency.created");
    expect(types).toContain("run.checkpoint.created");
    expect(types).toContain("run.heartbeat");
    expect(types).toContain("agent.heartbeat");
    expect(listLocalEvents({ project_id: project.id }).some((event) => event.event_type === "project.created")).toBe(true);
    expect(listLocalEvents({ plan_id: plan.id }).some((event) => event.event_type === "plan.created")).toBe(true);
  });

  test("serializes queried events as JSONL", () => {
    recordLocalEvent({ event_type: "custom.test", entity_type: "test", entity_id: "abc", data: { ok: true } });
    const jsonl = localEventsToJsonl(listLocalEvents());
    const parsed = JSON.parse(jsonl);

    expect(parsed.type).toBe("custom.test");
    expect(parsed.data).toEqual({ ok: true });
  });
});
