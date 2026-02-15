/**
 * HTTP server for the Todos dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * API endpoints call directly into src/db/ functions.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
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
} from "../db/projects.js";
import { addComment, listComments } from "../db/comments.js";
import { searchTasks } from "../lib/search.js";
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

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
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

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── API Routes ──

      // GET /api/tasks
      if (path === "/api/tasks" && method === "GET") {
        try {
          const filter: TaskFilter = {};
          const status = url.searchParams.get("status");
          const priority = url.searchParams.get("priority");
          const projectId = url.searchParams.get("project_id");

          if (status) filter.status = status as TaskStatus;
          if (priority) filter.priority = priority as TaskPriority;
          if (projectId) filter.project_id = projectId;

          const tasks = listTasks(filter);

          // Enrich with project names
          const projectCache = new Map<string, string>();
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
            return { ...t, project_name: projectName };
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

          const body = await req.json() as Record<string, unknown>;
          if (!body.title || typeof body.title !== "string") {
            return json({ error: "Missing required field: title" }, 400, port);
          }

          const task = createTask({
            title: body.title,
            description: body.description as string | undefined,
            priority: body.priority as TaskPriority | undefined,
            project_id: body.project_id as string | undefined,
            parent_id: body.parent_id as string | undefined,
            tags: body.tags as string[] | undefined,
            assigned_to: body.assigned_to as string | undefined,
            agent_id: body.agent_id as string | undefined,
            status: body.status as TaskStatus | undefined,
          });

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

          const body = await req.json() as Record<string, unknown>;
          if (typeof body.version !== "number") {
            return json({ error: "Missing required field: version" }, 400, port);
          }

          const task = updateTask(id, {
            version: body.version,
            title: body.title as string | undefined,
            description: body.description as string | undefined,
            status: body.status as TaskStatus | undefined,
            priority: body.priority as TaskPriority | undefined,
            assigned_to: body.assigned_to as string | undefined,
            tags: body.tags as string[] | undefined,
            metadata: body.metadata as Record<string, unknown> | undefined,
          });

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
          const body = await req.json() as Record<string, unknown>;
          const agentId = (body.agent_id as string) || "dashboard";
          const task = startTask(id, agentId);
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
          const body = await req.json() as Record<string, unknown>;
          const agentId = body.agent_id as string | undefined;
          const task = completeTask(id, agentId);
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

          const body = await req.json() as Record<string, unknown>;
          if (!body.content || typeof body.content !== "string") {
            return json({ error: "Missing required field: content" }, 400, port);
          }

          const comment = addComment({
            task_id: taskId,
            content: body.content,
            agent_id: body.agent_id as string | undefined,
            session_id: body.session_id as string | undefined,
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

          const body = await req.json() as Record<string, unknown>;
          if (!body.name || typeof body.name !== "string") {
            return json({ error: "Missing required field: name" }, 400, port);
          }

          const project = createProject({
            name: body.name,
            path: (body.path as string) || process.cwd(),
            description: body.description as string | undefined,
          });

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

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          const filePath = join(dashboardDir, path);
          const res = serveStaticFile(filePath);
          if (res) return res;
        }

        // SPA fallback: serve index.html for all other GET routes
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404, port);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${port}`;
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
