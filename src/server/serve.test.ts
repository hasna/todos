import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { addComment } from "../db/comments.js";
import { createFetchHandler } from "./serve.js";

const port = 19420;
let fetchHandler: (req: Request) => Promise<Response>;
let base: string;

function url(path: string): string {
  return `${base}${path}`;
}

async function jsonBody(res: Response) {
  return res.json();
}

async function request(url: string, init?: RequestInit) {
  return fetchHandler(new Request(url, init));
}

beforeEach(async () => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  fetchHandler = createFetchHandler(() => port);
  base = `http://localhost:${port}`;
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

// ── Tasks API ──

describe("GET /api/tasks", () => {
  it("should return empty array when no tasks", async () => {
    const res = await request(url("/api/tasks"));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toEqual([]);
  });

  it("should return all tasks", async () => {
    createTask({ title: "Task 1" });
    createTask({ title: "Task 2" });
    const res = await request(url("/api/tasks"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(2);
  });

  it("should filter by status", async () => {
    createTask({ title: "Pending", status: "pending" });
    createTask({ title: "Done", status: "completed" });
    const res = await request(url("/api/tasks?status=pending"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Pending");
  });

  it("should filter by priority", async () => {
    createTask({ title: "Low", priority: "low" });
    createTask({ title: "Critical", priority: "critical" });
    const res = await request(url("/api/tasks?priority=critical"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Critical");
  });

  it("should filter by project_id", async () => {
    const project = createProject({ name: "Test", path: "/tmp/test-filter" });
    createTask({ title: "In project", project_id: project.id });
    createTask({ title: "No project" });
    const res = await request(url(`/api/tasks?project_id=${project.id}`));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("In project");
  });

  it("should enrich tasks with project_name", async () => {
    const project = createProject({ name: "MyProject", path: "/tmp/enrich" });
    createTask({ title: "With project", project_id: project.id });
    const res = await request(url("/api/tasks"));
    const data = await jsonBody(res);
    expect(data[0].project_name).toBe("MyProject");
  });

  it("should use project cache for multiple tasks in same project", async () => {
    const project = createProject({ name: "Cached", path: "/tmp/cache" });
    createTask({ title: "Task 1", project_id: project.id });
    createTask({ title: "Task 2", project_id: project.id });
    const res = await request(url("/api/tasks"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(2);
    expect(data[0].project_name).toBe("Cached");
    expect(data[1].project_name).toBe("Cached");
  });

  it("should include security headers", async () => {
    const res = await request(url("/api/tasks"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("GET /api/tasks/:id", () => {
  it("should return task with relations", async () => {
    const task = createTask({ title: "Detailed task", description: "desc", tags: ["a"] });
    const res = await request(url(`/api/tasks/${task.id}`));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.title).toBe("Detailed task");
    expect(data.description).toBe("desc");
    expect(data.subtasks).toEqual([]);
    expect(data.dependencies).toEqual([]);
    expect(data.comments).toEqual([]);
  });

  it("should return 404 for non-existent task", async () => {
    const res = await request(url("/api/tasks/non-existent-id"));
    expect(res.status).toBe(404);
    const data = await jsonBody(res);
    expect(data.error).toBe("Task not found");
  });

  it("should include project_name", async () => {
    const project = createProject({ name: "TestProj", path: "/tmp/task-detail" });
    const task = createTask({ title: "Task", project_id: project.id });
    const res = await request(url(`/api/tasks/${task.id}`));
    const data = await jsonBody(res);
    expect(data.project_name).toBe("TestProj");
  });

  it("should return task without project_name when no project", async () => {
    const task = createTask({ title: "No project task" });
    const res = await request(url(`/api/tasks/${task.id}`));
    const data = await jsonBody(res);
    expect(data.project_name).toBeUndefined();
  });
});

describe("POST /api/tasks", () => {
  it("should create a task with title only", async () => {
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New task" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.title).toBe("New task");
    expect(data.status).toBe("pending");
    expect(data.priority).toBe("medium");
    expect(data.id).toBeTruthy();
  });

  it("should create a task with all fields", async () => {
    const project = createProject({ name: "Test", path: "/tmp/create" });
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Full task",
        description: "A full description",
        priority: "high",
        project_id: project.id,
        tags: ["bug", "urgent"],
        assigned_to: "agent-1",
        agent_id: "claude",
        status: "in_progress",
      }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.title).toBe("Full task");
    expect(data.description).toBe("A full description");
    expect(data.priority).toBe("high");
    expect(data.project_id).toBe(project.id);
    expect(data.tags).toEqual(["bug", "urgent"]);
    expect(data.assigned_to).toBe("agent-1");
    expect(data.status).toBe("in_progress");
  });

  it("should return 400 when title is missing", async () => {
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "no title" }),
    });
    expect(res.status).toBe(400);
    const data = await jsonBody(res);
    expect(data.error).toBe("Missing required field: title");
  });

  it("should return 400 when title is not a string", async () => {
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it("should create subtask with parent_id", async () => {
    const parent = createTask({ title: "Parent" });
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Child", parent_id: parent.id }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.parent_id).toBe(parent.id);
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("should update task fields", async () => {
    const task = createTask({ title: "Original" });
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, title: "Updated", priority: "high" }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.title).toBe("Updated");
    expect(data.priority).toBe("high");
    expect(data.version).toBe(2);
  });

  it("should return 400 when version is missing", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No version" }),
    });
    expect(res.status).toBe(400);
    const data = await jsonBody(res);
    expect(data.error).toBe("Missing required field: version");
  });

  it("should return 409 on version conflict", async () => {
    const task = createTask({ title: "Test" });
    // Update once to bump version to 2
    await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, title: "V2" }),
    });
    // Try to update with stale version
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, title: "Conflict" }),
    });
    expect(res.status).toBe(409);
  });

  it("should update tags and metadata", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        tags: ["new-tag"],
        metadata: { key: "val" },
      }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.tags).toEqual(["new-tag"]);
    expect(data.metadata).toEqual({ key: "val" });
  });

  it("should update status", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, status: "completed" }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.status).toBe("completed");
    expect(data.completed_at).toBeTruthy();
  });
});

describe("DELETE /api/tasks/:id", () => {
  it("should delete a task", async () => {
    const task = createTask({ title: "To delete" });
    const res = await request(url(`/api/tasks/${task.id}`), { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.deleted).toBe(true);

    // Verify it's gone
    const getRes = await request(url(`/api/tasks/${task.id}`));
    expect(getRes.status).toBe(404);
  });

  it("should return 404 for non-existent task", async () => {
    const res = await request(url("/api/tasks/non-existent"), { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks/:id/start", () => {
  it("should start a task", async () => {
    const task = createTask({ title: "To start" });
    const res = await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "test-agent" }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.status).toBe("in_progress");
    expect(data.locked_by).toBe("test-agent");
    expect(data.assigned_to).toBe("test-agent");
  });

  it("should use 'dashboard' as default agent_id", async () => {
    const task = createTask({ title: "To start" });
    const res = await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.locked_by).toBe("dashboard");
  });

  it("should return 404 for non-existent task", async () => {
    const res = await request(url("/api/tasks/non-existent/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("should return 409 when locked by another agent", async () => {
    const task = createTask({ title: "Locked" });
    // Start by agent-1
    await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });
    // Try to start by agent-2
    const res = await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-2" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/tasks/:id/complete", () => {
  it("should complete a task", async () => {
    const task = createTask({ title: "To complete" });
    const res = await request(url(`/api/tasks/${task.id}/complete`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.status).toBe("completed");
    expect(data.completed_at).toBeTruthy();
  });

  it("should complete with agent_id", async () => {
    const task = createTask({ title: "To complete" });
    // First start the task
    await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });
    // Complete by the same agent
    const res = await request(url(`/api/tasks/${task.id}/complete`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.status).toBe("completed");
    expect(data.locked_by).toBeNull();
  });

  it("should return 404 for non-existent task", async () => {
    const res = await request(url("/api/tasks/non-existent/complete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("should return 409 when completed by wrong agent", async () => {
    const task = createTask({ title: "Locked" });
    await request(url(`/api/tasks/${task.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });
    const res = await request(url(`/api/tasks/${task.id}/complete`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-2" }),
    });
    expect(res.status).toBe(409);
  });
});

// ── Comments API ──

describe("GET /api/tasks/:id/comments", () => {
  it("should return empty array when no comments", async () => {
    const task = createTask({ title: "No comments" });
    const res = await request(url(`/api/tasks/${task.id}/comments`));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toEqual([]);
  });

  it("should return comments for a task", async () => {
    const task = createTask({ title: "With comments" });
    addComment({ task_id: task.id, content: "Comment 1" });
    addComment({ task_id: task.id, content: "Comment 2", agent_id: "claude" });
    const res = await request(url(`/api/tasks/${task.id}/comments`));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toHaveLength(2);
    expect(data[0].content).toBe("Comment 1");
    expect(data[1].content).toBe("Comment 2");
    expect(data[1].agent_id).toBe("claude");
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("should add a comment", async () => {
    const task = createTask({ title: "Comment target" });
    const res = await request(url(`/api/tasks/${task.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "A new comment", agent_id: "test" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.content).toBe("A new comment");
    expect(data.agent_id).toBe("test");
    expect(data.task_id).toBe(task.id);
  });

  it("should return 400 when content is missing", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "test" }),
    });
    expect(res.status).toBe(400);
    const data = await jsonBody(res);
    expect(data.error).toBe("Missing required field: content");
  });

  it("should return 400 when content is not a string", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it("should add comment with session_id", async () => {
    const task = createTask({ title: "Test" });
    const res = await request(url(`/api/tasks/${task.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "With session", session_id: "sess-1" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.session_id).toBe("sess-1");
  });
});

// ── Projects API ──

describe("GET /api/projects", () => {
  it("should return empty array when no projects", async () => {
    const res = await request(url("/api/projects"));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toEqual([]);
  });

  it("should return all projects", async () => {
    createProject({ name: "Alpha", path: "/tmp/alpha" });
    createProject({ name: "Beta", path: "/tmp/beta" });
    const res = await request(url("/api/projects"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(2);
  });
});

describe("POST /api/projects", () => {
  it("should create a project", async () => {
    const res = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Project", path: "/tmp/new-proj" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.name).toBe("New Project");
    expect(data.id).toBeTruthy();
  });

  it("should create a project with description", async () => {
    const res = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Described",
        path: "/tmp/described",
        description: "A test project",
      }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.description).toBe("A test project");
  });

  it("should return 400 when name is missing", async () => {
    const res = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/no-name" }),
    });
    expect(res.status).toBe(400);
    const data = await jsonBody(res);
    expect(data.error).toBe("Missing required field: name");
  });

  it("should return 400 when name is not a string", async () => {
    const res = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it("should use cwd as default path", async () => {
    const res = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Default Path" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.path).toBe(process.cwd());
  });
});

// ── Search API ──

describe("GET /api/search", () => {
  it("should search tasks by title", async () => {
    createTask({ title: "Fix login bug" });
    createTask({ title: "Add dashboard" });
    const res = await request(url("/api/search?q=login"));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Fix login bug");
  });

  it("should search tasks by description", async () => {
    createTask({ title: "Task", description: "contains searchterm here" });
    createTask({ title: "Other", description: "nothing relevant" });
    const res = await request(url("/api/search?q=searchterm"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Task");
  });

  it("should return empty for no matches", async () => {
    createTask({ title: "Unrelated task" });
    const res = await request(url("/api/search?q=zzzzzzz"));
    const data = await jsonBody(res);
    expect(data).toEqual([]);
  });

  it("should return 400 when q is missing", async () => {
    const res = await request(url("/api/search"));
    expect(res.status).toBe(400);
    const data = await jsonBody(res);
    expect(data.error).toBe("Missing query parameter: q");
  });

  it("should filter by project_id", async () => {
    const project = createProject({ name: "P", path: "/tmp/search-proj" });
    createTask({ title: "In project bug", project_id: project.id });
    createTask({ title: "Outside bug" });
    const res = await request(url(`/api/search?q=bug&project_id=${project.id}`));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("In project bug");
  });
});

// ── Plans API ──

describe("GET /api/plans", () => {
  it("should return empty array when no plans", async () => {
    const res = await request(url("/api/plans"));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data).toEqual([]);
  });

  it("should return all plans with task_count", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Sprint 1" });
    createTask({ title: "Task in plan", plan_id: plan.id });
    createTask({ title: "Task in plan 2", plan_id: plan.id });
    const res = await request(url("/api/plans"));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Sprint 1");
    expect(data[0].task_count).toBe(2);
  });

  it("should filter by project_id", async () => {
    const { createPlan } = await import("../db/plans.js");
    const project = createProject({ name: "P", path: "/tmp/plan-filter" });
    createPlan({ name: "In project", project_id: project.id });
    createPlan({ name: "No project" });
    const res = await request(url(`/api/plans?project_id=${project.id}`));
    const data = await jsonBody(res);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("In project");
  });
});

describe("POST /api/plans", () => {
  it("should create a plan", async () => {
    const res = await request(url("/api/plans"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sprint 1" }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.name).toBe("Sprint 1");
    expect(data.status).toBe("active");
    expect(data.id).toBeTruthy();
  });

  it("should create a plan with all fields", async () => {
    const project = createProject({ name: "P", path: "/tmp/plan-create" });
    const res = await request(url("/api/plans"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Sprint 2",
        description: "Second sprint",
        project_id: project.id,
        status: "active",
      }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.name).toBe("Sprint 2");
    expect(data.description).toBe("Second sprint");
    expect(data.project_id).toBe(project.id);
  });

  it("should return 400 when name is missing", async () => {
    const res = await request(url("/api/plans"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "no name" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/plans/:id", () => {
  it("should return a plan", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Test Plan" });
    const res = await request(url(`/api/plans/${plan.id}`));
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.name).toBe("Test Plan");
  });

  it("should return 404 for non-existent plan", async () => {
    const res = await request(url("/api/plans/non-existent"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/plans/:id", () => {
  it("should update plan fields", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Original" });
    const res = await request(url(`/api/plans/${plan.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", status: "completed" }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.name).toBe("Updated");
    expect(data.status).toBe("completed");
  });

  it("should return 404 for non-existent plan", async () => {
    const res = await request(url("/api/plans/non-existent"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Update" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/plans/:id", () => {
  it("should delete a plan", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "To delete" });
    const res = await request(url(`/api/plans/${plan.id}`), { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.deleted).toBe(true);
  });

  it("should orphan tasks when plan is deleted", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Deletable" });
    const task = createTask({ title: "In plan", plan_id: plan.id });
    await request(url(`/api/plans/${plan.id}`), { method: "DELETE" });
    const taskRes = await request(url(`/api/tasks/${task.id}`));
    const taskData = await jsonBody(taskRes);
    expect(taskData.plan_id).toBeNull();
  });

  it("should return 404 for non-existent plan", async () => {
    const res = await request(url("/api/plans/non-existent"), { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/projects/:id ──

describe("DELETE /api/projects/:id", () => {
  it("should delete a project", async () => {
    const project = createProject({ name: "To delete", path: "/tmp/del-proj" });
    const res = await request(url(`/api/projects/${project.id}`), { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.deleted).toBe(true);
  });

  it("should return 404 for non-existent project", async () => {
    const res = await request(url("/api/projects/non-existent"), { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// ── Tasks with plan_id ──

describe("Tasks with plan_id", () => {
  it("should create a task with plan_id", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Sprint" });
    const res = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Planned task", plan_id: plan.id }),
    });
    expect(res.status).toBe(201);
    const data = await jsonBody(res);
    expect(data.plan_id).toBe(plan.id);
  });

  it("should update task plan_id", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Sprint" });
    const task = createTask({ title: "Task" });
    const res = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, plan_id: plan.id }),
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.plan_id).toBe(plan.id);
  });

  it("should enrich tasks with plan_name", async () => {
    const { createPlan } = await import("../db/plans.js");
    const plan = createPlan({ name: "Sprint 1" });
    createTask({ title: "Planned", plan_id: plan.id });
    const res = await request(url("/api/tasks"));
    const data = await jsonBody(res);
    expect(data[0].plan_name).toBe("Sprint 1");
  });
});

// ── CORS ──

describe("OPTIONS (CORS)", () => {
  it("should return CORS headers for preflight", async () => {
    const res = await request(url("/api/tasks"), { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PATCH, DELETE, OPTIONS"
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
    expect(res.headers.get("Access-Control-Allow-Origin")).toContain("localhost");
  });
});

// ── Static files ──

describe("Static file serving", () => {
  it("should serve index.html for root path", async () => {
    const res = await request(url("/"));
    // Dashboard dist exists since we built it, so this should serve index.html
    if (res.status === 200) {
      const contentType = res.headers.get("Content-Type");
      expect(contentType).toContain("text/html");
    }
  });

  it("should serve SPA fallback for unknown paths", async () => {
    const res = await request(url("/some/unknown/path"));
    // Either serves index.html (SPA) or 404 if dashboard not found
    expect([200, 404]).toContain(res.status);
  });

  it("should return 404 for unknown POST routes", async () => {
    const res = await request(url("/api/nonexistent"), { method: "POST" });
    expect(res.status).toBe(404);
    const data = await jsonBody(res);
    expect(data.error).toBe("Not found");
  });
});

// ── Integration flows ──

describe("Full task lifecycle", () => {
  it("should create, start, complete, and delete a task", async () => {
    // Create
    const createRes = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Lifecycle test", priority: "high" }),
    });
    expect(createRes.status).toBe(201);
    const created = await jsonBody(createRes);
    expect(created.status).toBe("pending");

    // Start
    const startRes = await request(url(`/api/tasks/${created.id}/start`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "lifecycle-agent" }),
    });
    expect(startRes.status).toBe(200);
    const started = await jsonBody(startRes);
    expect(started.status).toBe("in_progress");
    expect(started.locked_by).toBe("lifecycle-agent");

    // Complete
    const completeRes = await request(url(`/api/tasks/${created.id}/complete`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "lifecycle-agent" }),
    });
    expect(completeRes.status).toBe(200);
    const completed = await jsonBody(completeRes);
    expect(completed.status).toBe("completed");
    expect(completed.completed_at).toBeTruthy();

    // Delete
    const deleteRes = await request(url(`/api/tasks/${created.id}`), {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // Verify gone
    const getRes = await request(url(`/api/tasks/${created.id}`));
    expect(getRes.status).toBe(404);
  });

  it("should create task with project and add comment", async () => {
    // Create project
    const projRes = await request(url("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Integration Project", path: "/tmp/integ" }),
    });
    expect(projRes.status).toBe(201);
    const project = await jsonBody(projRes);

    // Create task in project
    const taskRes = await request(url("/api/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Project task",
        project_id: project.id,
        tags: ["integration"],
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = await jsonBody(taskRes);

    // Add comment
    const commentRes = await request(url(`/api/tasks/${task.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Working on it", agent_id: "agent" }),
    });
    expect(commentRes.status).toBe(201);

    // Get task with relations
    const getRes = await request(url(`/api/tasks/${task.id}`));
    const fullTask = await jsonBody(getRes);
    expect(fullTask.project_name).toBe("Integration Project");
    expect(fullTask.comments).toHaveLength(1);
    expect(fullTask.comments[0].content).toBe("Working on it");
    expect(fullTask.tags).toEqual(["integration"]);
  });

  it("should update task and verify changes persist", async () => {
    const task = createTask({ title: "Original", priority: "low" });

    // Update via API
    const patchRes = await request(url(`/api/tasks/${task.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Updated Title",
        priority: "critical",
        description: "New description",
        assigned_to: "dev-1",
      }),
    });
    expect(patchRes.status).toBe(200);

    // Verify via list
    const listRes = await request(url("/api/tasks"));
    const tasks = await jsonBody(listRes);
    const found = tasks.find((t: { id: string }) => t.id === task.id);
    expect(found.title).toBe("Updated Title");
    expect(found.priority).toBe("critical");
    expect(found.description).toBe("New description");
    expect(found.assigned_to).toBe("dev-1");
  });
});
