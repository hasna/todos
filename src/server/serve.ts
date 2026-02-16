/**
 * HTTP server for the Todos dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * API endpoints call directly into src/db/ functions.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import {
  createTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
} from "../db/tasks.js";
import {
  listProjects,
  createProject,
  getProject,
  deleteProject,
  updateProject,
} from "../db/projects.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import { getDatabase } from "../db/database.js";
import { addComment, listComments } from "../db/comments.js";
import { createApiKey, listApiKeys, deleteApiKey, validateApiKey, hasAnyApiKeys } from "../db/api-keys.js";
import { searchTasks } from "../lib/search.js";
import { logAudit, getAuditLog } from "../db/audit.js";
import { createWebhook, listWebhooks, deleteWebhook, dispatchWebhooks } from "../db/webhooks.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { loadEnv } from "../lib/env.js";
import { getOrCreateCustomer, getUsage, PLAN_LIMITS, PLAN_PRICES } from "../db/billing.js";
import { isStripeConfigured, createCheckoutSession, createPortalSession, handleWebhook } from "../lib/stripe.js";
import type { TaskFilter, TaskStatus, TaskPriority } from "../types/index.js";

// Resolve the dashboard dist directory — check multiple locations
function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Max request body size (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

const createTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  project_id: z.string().optional(),
  parent_id: z.string().optional(),
  plan_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  assigned_to: z.string().optional(),
  agent_id: z.string().optional(),
});

const updateTaskSchema = z.object({
  version: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  assigned_to: z.string().optional(),
  plan_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const createProjectSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  description: z.string().optional(),
  task_list_id: z.string().optional(),
});

const createCommentSchema = z.object({
  content: z.string(),
  agent_id: z.string().optional(),
  session_id: z.string().optional(),
});

const createPlanSchema = z.object({
  name: z.string(),
  project_id: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

const updatePlanSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

const createApiKeySchema = z.object({
  name: z.string(),
  expires_at: z.string().optional(),
});

const agentSchema = z.object({
  agent_id: z.string().optional(),
});

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

export function createFetchHandler(
  getPort: () => number,
  dashboardDir?: string,
  dashboardExists?: boolean,
): (req: Request) => Promise<Response> {
  loadEnv();
  const dir = dashboardDir || resolveDashboardDir();
  const hasDashboard = dashboardExists ?? existsSync(dir);

  return async (req: Request) => {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path.startsWith("/api/v1/")) {
      path = path.replace("/api/v1", "/api");
    }
    const method = req.method;
    const port = getPort();

    // API key auth check (skip for same-origin dashboard, system endpoints, and key management)
    if (path.startsWith("/api/") && !path.startsWith("/api/system/") && !path.startsWith("/api/keys") && path !== "/api/billing/webhook") {
      const hasKeys = hasAnyApiKeys();
      if (hasKeys) {
        // Skip auth for same-origin dashboard requests
        const origin = req.headers.get("origin") || "";
        const referer = req.headers.get("referer") || "";
        const isSameOrigin = origin.includes(`localhost:${port}`) || referer.includes(`localhost:${port}`);
        if (!isSameOrigin) {
          const authHeader = req.headers.get("authorization");
          const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
          if (!apiKey) {
            return json({ error: "API key required. Pass via Authorization: Bearer <key>" }, 401, port);
          }
          const valid = await validateApiKey(apiKey);
          if (!valid) {
            return json({ error: "Invalid or expired API key" }, 403, port);
          }
        }
      }
    }

    // Rate limiting (100 requests per minute per IP/key)
    if (path.startsWith("/api/")) {
      const rateLimitKey = req.headers.get("authorization") || req.headers.get("x-forwarded-for") || "anonymous";
      const rateResult = checkRateLimit(rateLimitKey, 100, 60_000);
      if (!rateResult.allowed) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Remaining": "0",
            ...SECURITY_HEADERS,
          },
        });
      }
    }

    // ── API Routes ──

    // GET /api/tasks
    if (path === "/api/tasks" && method === "GET") {
      try {
        const filter: TaskFilter = {};
        const status = url.searchParams.get("status");
        const priority = url.searchParams.get("priority");
        const projectId = url.searchParams.get("project_id");
        const planId = url.searchParams.get("plan_id");

        if (status) filter.status = status as TaskStatus;
        if (priority) filter.priority = priority as TaskPriority;
        if (projectId) filter.project_id = projectId;
        if (planId) filter.plan_id = planId;

        const limit = parseInt(url.searchParams.get("limit") || "100", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        if (limit) filter.limit = Math.min(limit, 500);
        if (offset) filter.offset = offset;

        const tasks = listTasks(filter);

        // Enrich with project names and plan names
        const projectCache = new Map<string, string>();
        const planCache = new Map<string, string>();
        const enriched = tasks.map((t) => {
          let projectName: string | undefined;
          if (t.project_id) {
            if (projectCache.has(t.project_id)) {
              projectName = projectCache.get(t.project_id);
            } else {
              const p = getProject(t.project_id);
              projectName = p?.name;
              if (projectName) projectCache.set(t.project_id, projectName);
            }
          }
          let planName: string | undefined;
          if (t.plan_id) {
            if (planCache.has(t.plan_id)) {
              planName = planCache.get(t.plan_id);
            } else {
              const pl = getPlan(t.plan_id);
              planName = pl?.name;
              if (planName) planCache.set(t.plan_id, planName);
            }
          }
          return { ...t, project_name: projectName, plan_name: planName };
        });

        return json(enriched, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list tasks" }, 500, port);
      }
    }

    // GET /api/tasks/:id
    const taskGetMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskGetMatch && method === "GET") {
      try {
        const id = taskGetMatch[1]!;
        const task = getTaskWithRelations(id);
        if (!task) return json({ error: "Task not found" }, 404, port);

        let projectName: string | undefined;
        if (task.project_id) {
          const p = getProject(task.project_id);
          projectName = p?.name;
        }

        return json({ ...task, project_name: projectName }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to get task" }, 500, port);
      }
    }

    // POST /api/tasks
    if (path === "/api/tasks" && method === "POST") {
      try {
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.title || typeof body.title !== "string") {
          return json({ error: "Missing required field: title" }, 400, port);
        }
        const parsed = createTaskSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }

        const task = createTask({
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority as TaskPriority | undefined,
          project_id: parsed.data.project_id,
          parent_id: parsed.data.parent_id,
          plan_id: parsed.data.plan_id,
          tags: parsed.data.tags,
          assigned_to: parsed.data.assigned_to,
          agent_id: parsed.data.agent_id,
          status: parsed.data.status as TaskStatus | undefined,
        });

        logAudit("task", task.id, "create", parsed.data.agent_id);
        dispatchWebhooks("task.created", task);

        return json(task, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create task" }, 500, port);
      }
    }

    // PATCH /api/tasks/:id
    const taskPatchMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskPatchMatch && method === "PATCH") {
      try {
        const id = taskPatchMatch[1]!;
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (typeof body.version !== "number") {
          return json({ error: "Missing required field: version" }, 400, port);
        }
        const parsed = updateTaskSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }

        const task = updateTask(id, {
          version: parsed.data.version,
          title: parsed.data.title,
          description: parsed.data.description,
          status: parsed.data.status as TaskStatus | undefined,
          priority: parsed.data.priority as TaskPriority | undefined,
          assigned_to: parsed.data.assigned_to,
          plan_id: parsed.data.plan_id,
          tags: parsed.data.tags,
          metadata: parsed.data.metadata,
        });

        logAudit("task", id, "update", undefined, parsed.data);
        dispatchWebhooks("task.updated", task);

        return json(task, 200, port);
      } catch (e) {
        const status = e instanceof Error && e.name === "VersionConflictError" ? 409 : 500;
        return json({ error: e instanceof Error ? e.message : "Failed to update task" }, status, port);
      }
    }

    // DELETE /api/tasks/:id
    const taskDeleteMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskDeleteMatch && method === "DELETE") {
      try {
        const id = taskDeleteMatch[1]!;
        const deleted = deleteTask(id);
        if (!deleted) return json({ error: "Task not found" }, 404, port);
        logAudit("task", id, "delete");
        dispatchWebhooks("task.deleted", { id });
        return json({ deleted: true }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to delete task" }, 500, port);
      }
    }

    // POST /api/tasks/:id/start
    const taskStartMatch = path.match(/^\/api\/tasks\/([^/]+)\/start$/);
    if (taskStartMatch && method === "POST") {
      try {
        const id = taskStartMatch[1]!;
        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        const parsed = agentSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Invalid request body" }, 400, port);
        const agentId = parsed.data.agent_id || "dashboard";
        const task = startTask(id, agentId);
        logAudit("task", id, "start", agentId);
        return json(task, 200, port);
      } catch (e) {
        const status = e instanceof Error && e.name === "TaskNotFoundError" ? 404
          : e instanceof Error && e.name === "LockError" ? 409
          : 500;
        return json({ error: e instanceof Error ? e.message : "Failed to start task" }, status, port);
      }
    }

    // POST /api/tasks/:id/complete
    const taskCompleteMatch = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    if (taskCompleteMatch && method === "POST") {
      try {
        const id = taskCompleteMatch[1]!;
        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        const parsed = agentSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Invalid request body" }, 400, port);
        const agentId = parsed.data.agent_id;
        const task = completeTask(id, agentId);
        logAudit("task", id, "complete", agentId);
        return json(task, 200, port);
      } catch (e) {
        const status = e instanceof Error && e.name === "TaskNotFoundError" ? 404
          : e instanceof Error && e.name === "LockError" ? 409
          : 500;
        return json({ error: e instanceof Error ? e.message : "Failed to complete task" }, status, port);
      }
    }

    // GET /api/tasks/:id/comments
    const commentsGetMatch = path.match(/^\/api\/tasks\/([^/]+)\/comments$/);
    if (commentsGetMatch && method === "GET") {
      try {
        const taskId = commentsGetMatch[1]!;
        const comments = listComments(taskId);
        return json(comments, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list comments" }, 500, port);
      }
    }

    // POST /api/tasks/:id/comments
    const commentsPostMatch = path.match(/^\/api\/tasks\/([^/]+)\/comments$/);
    if (commentsPostMatch && method === "POST") {
      try {
        const taskId = commentsPostMatch[1]!;
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.content || typeof body.content !== "string") {
          return json({ error: "Missing required field: content" }, 400, port);
        }
        const parsed = createCommentSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }

        const comment = addComment({
          task_id: taskId,
          content: parsed.data.content,
          agent_id: parsed.data.agent_id,
          session_id: parsed.data.session_id,
        });

        return json(comment, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to add comment" }, 500, port);
      }
    }

    // GET /api/projects
    if (path === "/api/projects" && method === "GET") {
      try {
        const projects = listProjects();
        return json(projects, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list projects" }, 500, port);
      }
    }

    // POST /api/projects
    if (path === "/api/projects" && method === "POST") {
      try {
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.name || typeof body.name !== "string") {
          return json({ error: "Missing required field: name" }, 400, port);
        }
        const parsed = createProjectSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }

        const project = createProject({
          name: parsed.data.name,
          path: parsed.data.path || process.cwd(),
          description: parsed.data.description,
          task_list_id: parsed.data.task_list_id,
        });

        logAudit("project", project.id, "create");

        return json(project, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create project" }, 500, port);
      }
    }

    // GET /api/search
    if (path === "/api/search" && method === "GET") {
      try {
        const q = url.searchParams.get("q");
        if (!q) return json({ error: "Missing query parameter: q" }, 400, port);
        const projectId = url.searchParams.get("project_id") || undefined;
        const results = searchTasks(q, projectId);
        return json(results, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Search failed" }, 500, port);
      }
    }

    // GET /api/system/version
    if (path === "/api/system/version" && method === "GET") {
      try {
        const current = getPackageVersion();
        const npmRes = await fetch("https://registry.npmjs.org/@hasna/todos/latest");
        if (!npmRes.ok) {
          return json({ current, latest: current, updateAvailable: false }, 200, port);
        }
        const data = (await npmRes.json()) as { version: string };
        const latest = data.version;
        return json({ current, latest, updateAvailable: current !== latest }, 200, port);
      } catch {
        const current = getPackageVersion();
        return json({ current, latest: current, updateAvailable: false }, 200, port);
      }
    }

    // POST /api/system/update
    if (path === "/api/system/update" && method === "POST") {
      try {
        let useBun = false;
        try {
          execSync("which bun", { stdio: "ignore" });
          useBun = true;
        } catch {
          // bun not available
        }

        const cmd = useBun
          ? "bun add -g @hasna/todos@latest"
          : "npm install -g @hasna/todos@latest";

        execSync(cmd, { stdio: "ignore", timeout: 60000 });
        return json({ success: true, message: "Updated! Restart the server to use the new version." }, 200, port);
      } catch (e) {
        return json({ success: false, message: e instanceof Error ? e.message : "Update failed" }, 500, port);
      }
    }

    // GET /api/plans
    if (path === "/api/plans" && method === "GET") {
      try {
        const projectId = url.searchParams.get("project_id") || undefined;
        const plans = listPlans(projectId);
        const enriched = plans.map((p) => {
          const db = getDatabase();
          const row = db.query("SELECT COUNT(*) as count FROM tasks WHERE plan_id = ?").get(p.id) as { count: number } | null;
          let projectName: string | undefined;
          if (p.project_id) {
            const proj = getProject(p.project_id);
            projectName = proj?.name;
          }
          return { ...p, task_count: row?.count ?? 0, project_name: projectName };
        });
        return json(enriched, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list plans" }, 500, port);
      }
    }

    // POST /api/plans
    if (path === "/api/plans" && method === "POST") {
      try {
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.name || typeof body.name !== "string") {
          return json({ error: "Missing required field: name" }, 400, port);
        }
        const parsed = createPlanSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }
        const plan = createPlan(parsed.data);
        logAudit("plan", plan.id, "create");
        dispatchWebhooks("plan.created", plan);
        return json(plan, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create plan" }, 500, port);
      }
    }

    // GET /api/plans/:id
    const planGetMatch = path.match(/^\/api\/plans\/([^/]+)$/);
    if (planGetMatch && method === "GET") {
      try {
        const id = planGetMatch[1]!;
        const plan = getPlan(id);
        if (!plan) return json({ error: "Plan not found" }, 404, port);
        return json(plan, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to get plan" }, 500, port);
      }
    }

    // PATCH /api/plans/:id
    const planPatchMatch = path.match(/^\/api\/plans\/([^/]+)$/);
    if (planPatchMatch && method === "PATCH") {
      try {
        const id = planPatchMatch[1]!;
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        const parsed = updatePlanSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }
        const plan = updatePlan(id, parsed.data);
        logAudit("plan", id, "update", undefined, parsed.data);
        return json(plan, 200, port);
      } catch (e) {
        const status = e instanceof Error && e.name === "PlanNotFoundError" ? 404 : 500;
        return json({ error: e instanceof Error ? e.message : "Failed to update plan" }, status, port);
      }
    }

    // DELETE /api/plans/:id
    const planDeleteMatch = path.match(/^\/api\/plans\/([^/]+)$/);
    if (planDeleteMatch && method === "DELETE") {
      try {
        const id = planDeleteMatch[1]!;
        const deleted = deletePlan(id);
        if (!deleted) return json({ error: "Plan not found" }, 404, port);
        logAudit("plan", id, "delete");
        return json({ deleted: true }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to delete plan" }, 500, port);
      }
    }

    // GET /api/projects/:id
    const projectGetMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectGetMatch && method === "GET") {
      try {
        const id = projectGetMatch[1]!;
        const project = getProject(id);
        if (!project) return json({ error: "Project not found" }, 404, port);
        return json(project, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to get project" }, 500, port);
      }
    }

    // PATCH /api/projects/:id
    const projectPatchMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectPatchMatch && method === "PATCH") {
      try {
        const id = projectPatchMatch[1]!;
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        const project = updateProject(id, {
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : (body.description === null ? "" : undefined),
          task_list_id: typeof body.task_list_id === "string" ? body.task_list_id : (body.task_list_id === null ? "" : undefined),
        });
        return json(project, 200, port);
      } catch (e) {
        const status = e instanceof Error && e.name === "ProjectNotFoundError" ? 404 : 500;
        return json({ error: e instanceof Error ? e.message : "Failed to update project" }, status, port);
      }
    }

    // DELETE /api/projects/:id
    const projectDeleteMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectDeleteMatch && method === "DELETE") {
      try {
        const id = projectDeleteMatch[1]!;
        const deleted = deleteProject(id);
        if (!deleted) return json({ error: "Project not found" }, 404, port);
        return json({ deleted: true }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to delete project" }, 500, port);
      }
    }

    // GET /api/keys
    if (path === "/api/keys" && method === "GET") {
      try {
        const keys = listApiKeys();
        return json(keys, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list API keys" }, 500, port);
      }
    }

    // POST /api/keys
    if (path === "/api/keys" && method === "POST") {
      try {
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.name || typeof body.name !== "string") {
          return json({ error: "Missing required field: name" }, 400, port);
        }
        const parsed = createApiKeySchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid request body" }, 400, port);
        }
        const apiKey = await createApiKey(parsed.data);
        logAudit("api_key", apiKey.id, "create");
        return json(apiKey, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create API key" }, 500, port);
      }
    }

    // DELETE /api/keys/:id
    const keyDeleteMatch = path.match(/^\/api\/keys\/([^/]+)$/);
    if (keyDeleteMatch && method === "DELETE") {
      try {
        const id = keyDeleteMatch[1]!;
        const deleted = deleteApiKey(id);
        if (!deleted) return json({ error: "API key not found" }, 404, port);
        return json({ deleted: true }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to delete API key" }, 500, port);
      }
    }

    // GET /api/keys/status
    if (path === "/api/keys/status" && method === "GET") {
      try {
        const enabled = hasAnyApiKeys();
        return json({ auth_enabled: enabled }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to check auth status" }, 500, port);
      }
    }

    // GET /api/audit
    if (path === "/api/audit" && method === "GET") {
      try {
        const entityType = url.searchParams.get("entity_type") || undefined;
        const entityId = url.searchParams.get("entity_id") || undefined;
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const entries = getAuditLog(entityType, entityId, Math.min(limit, 200), offset);
        return json(entries, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to get audit log" }, 500, port);
      }
    }

    // GET /api/webhooks
    if (path === "/api/webhooks" && method === "GET") {
      try {
        const webhooks = listWebhooks();
        return json(webhooks, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to list webhooks" }, 500, port);
      }
    }

    // POST /api/webhooks
    if (path === "/api/webhooks" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        if (!body.url || typeof body.url !== "string") {
          return json({ error: "Missing required field: url" }, 400, port);
        }
        const webhook = createWebhook({
          url: body.url as string,
          events: Array.isArray(body.events) ? body.events as string[] : undefined,
          secret: typeof body.secret === "string" ? body.secret : undefined,
        });
        return json(webhook, 201, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create webhook" }, 500, port);
      }
    }

    // DELETE /api/webhooks/:id
    const webhookDeleteMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
    if (webhookDeleteMatch && method === "DELETE") {
      try {
        const id = webhookDeleteMatch[1]!;
        const deleted = deleteWebhook(id);
        if (!deleted) return json({ error: "Webhook not found" }, 404, port);
        return json({ deleted: true }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to delete webhook" }, 500, port);
      }
    }

    // GET /api/billing
    if (path === "/api/billing" && method === "GET") {
      try {
        const customer = getOrCreateCustomer();
        const period = new Date().toISOString().slice(0, 7);
        const usage = getUsage(customer.id, period);
        const limits = PLAN_LIMITS[customer.plan as keyof typeof PLAN_LIMITS];
        return json({
          customer,
          usage,
          limits,
          plans: PLAN_PRICES,
          stripe_configured: isStripeConfigured(),
        }, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to get billing info" }, 500, port);
      }
    }

    // POST /api/billing/checkout
    if (path === "/api/billing/checkout" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!body) return json({ error: "Invalid JSON" }, 400, port);
        const plan = body.plan as string;
        const interval = (body.interval as string) || "month";
        if (!["pro", "team", "enterprise"].includes(plan)) {
          return json({ error: "Invalid plan" }, 400, port);
        }
        const baseUrl = `http://localhost:${port}`;
        const session = await createCheckoutSession(
          plan as "pro" | "team" | "enterprise",
          interval as "month" | "year",
          `${baseUrl}/billing?success=true`,
          `${baseUrl}/billing?canceled=true`,
        );
        if (!session) {
          return json({ error: "Stripe not configured. Set STRIPE_SECRET_KEY and price env vars." }, 400, port);
        }
        return json(session, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create checkout" }, 500, port);
      }
    }

    // POST /api/billing/portal
    if (path === "/api/billing/portal" && method === "POST") {
      try {
        const session = await createPortalSession(`http://localhost:${port}/billing`);
        if (!session) {
          return json({ error: "Stripe not configured or no customer" }, 400, port);
        }
        return json(session, 200, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Failed to create portal session" }, 500, port);
      }
    }

    // POST /api/billing/webhook (Stripe webhook - skip auth)
    if (path === "/api/billing/webhook" && method === "POST") {
      try {
        const body = await req.text();
        const signature = req.headers.get("stripe-signature") || "";
        const ok = await handleWebhook(body, signature);
        return json({ received: ok }, ok ? 200 : 400, port);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Webhook failed" }, 500, port);
      }
    }

    // ── CORS ──
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": `http://localhost:${port}`,
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ── Static Files (Vite dashboard) ──
    if (hasDashboard && (method === "GET" || method === "HEAD")) {
      if (path !== "/") {
        const filePath = join(dir, path);
        const res = serveStaticFile(filePath);
        if (res) return res;
      }

      // SPA fallback: serve index.html for all other GET routes
      const indexPath = join(dir, "index.html");
      const res = serveStaticFile(indexPath);
      if (res) return res;
    }

    return json({ error: "Not found" }, 404, port);
  };
}

export async function startServer(port: number, options?: { open?: boolean }): Promise<ReturnType<typeof Bun.serve>> {
  const shouldOpen = options?.open ?? true;

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
    console.error(`Or from the project root:\n`);
    console.error(`  bun run build:dashboard\n`);
  }

  let actualPort = port;
  const fetchHandler = createFetchHandler(() => actualPort, dashboardDir, dashboardExists);

  const attempts = port === 0 ? 20 : 1;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    const candidate = port === 0 ? randomPort() : port;
    try {
      server = Bun.serve({
        port: candidate,
        fetch: fetchHandler,
      });
      actualPort = server.port;
      break;
    } catch (e) {
      lastError = e;
      if (port !== 0) {
        throw e;
      }
    }
  }

  if (!server) {
    throw lastError;
  }

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${actualPort}`;
  console.log(`Todos Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${serverUrl}`);
    } catch {
      // Silently ignore if we can't open browser
    }
  }

  return server;
}
