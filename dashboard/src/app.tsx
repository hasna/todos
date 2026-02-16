import * as React from "react";
import {
  ArrowUpCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { TasksTable } from "@/components/tasks-table";
import { CreateTaskDialog } from "@/components/create-task-dialog";
import { ProjectsPage } from "@/components/projects-page";
import { PlansPage } from "@/components/plans-page";
import { CreatePlanDialog } from "@/components/create-plan-dialog";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { TaskDetailPage } from "@/components/task-detail-page";
import { PlanDetailPage } from "@/components/plan-detail-page";
import { ProjectDetailPage } from "@/components/project-detail-page";
import { BillingPage } from "@/components/billing-page";
import { DocsPage } from "@/components/docs-page";
import { AboutPage } from "@/components/about-page";
import { ContactPage } from "@/components/contact-page";
import { LegalPage } from "@/components/legal-page";
import { Button } from "@/components/ui/button";
import { ApiKeysCard } from "@/components/api-keys-card";
import type { TaskView, ProjectView, PlanView, ApiKeyView } from "@/types";

interface Route {
  page: string;
  id?: string;
}

function parseRoute(pathname: string): Route {
  const todoMatch = pathname.match(/^\/todos\/(.+)$/);
  if (todoMatch) return { page: "todos", id: todoMatch[1] };
  const planMatch = pathname.match(/^\/plans\/(.+)$/);
  if (planMatch) return { page: "plans", id: planMatch[1] };
  const projectMatch = pathname.match(/^\/projects\/(.+)$/);
  if (projectMatch) return { page: "projects", id: projectMatch[1] };
  if (pathname === "/todos") return { page: "todos" };
  if (pathname === "/projects") return { page: "projects" };
  if (pathname === "/plans") return { page: "plans" };
  if (pathname === "/billing") return { page: "billing" };
  if (pathname === "/docs") return { page: "docs" };
  if (pathname === "/about") return { page: "about" };
  if (pathname === "/contact") return { page: "contact" };
  if (pathname === "/legal") return { page: "legal" };
  return { page: "dashboard" };
}

function getRoute(): Route {
  return parseRoute(window.location.pathname);
}

export function App() {
  const [route, setRoute] = React.useState<Route>(getRoute);
  const [tasks, setTasks] = React.useState<TaskView[]>([]);
  const [projects, setProjects] = React.useState<ProjectView[]>([]);
  const [plans, setPlans] = React.useState<PlanView[]>([]);
  const [apiKeys, setApiKeys] = React.useState<ApiKeyView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createPlanOpen, setCreatePlanOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [updateAvailable, setUpdateAvailable] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);

  function navigate(target: string) {
    const path = target === "dashboard" ? "/" : `/${target}`;
    window.history.pushState({}, "", path);
    setRoute(parseRoute(path));
  }

  React.useEffect(() => {
    const handler = () => setRoute(getRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const loadTasks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data);
    } catch {
      showToast("Failed to load tasks", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = React.useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data);
    } catch {
      // Projects are optional
    }
  }, []);

  const loadPlans = React.useCallback(async () => {
    try {
      const res = await fetch("/api/plans");
      const data = await res.json();
      setPlans(data);
    } catch {
      // Plans are optional
    }
  }, []);

  const loadApiKeys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      setApiKeys(data);
    } catch {
      // API keys are optional
    }
  }, []);

  React.useEffect(() => {
    loadTasks();
    loadProjects();
    loadPlans();
    loadApiKeys();
  }, [loadTasks, loadProjects, loadPlans, loadApiKeys]);

  React.useEffect(() => {
    fetch("/api/system/version")
      .then((res) => res.json())
      .then((data: { updateAvailable?: boolean }) => {
        if (data.updateAvailable) setUpdateAvailable(true);
      })
      .catch(() => {});
  }, []);

  async function handleUpdate() {
    setUpdating(true);
    try {
      const res = await fetch("/api/system/update", { method: "POST" });
      const data = (await res.json()) as { success: boolean; message: string };
      showToast(data.message, data.success ? "success" : "error");
      if (data.success) setUpdateAvailable(false);
    } catch {
      showToast("Update failed", "error");
    } finally {
      setUpdating(false);
    }
  }

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleView(task: TaskView) {
    navigate(`todos/${task.id}`);
  }

  async function handleStart(task: TaskView) {
    try {
      const res = await fetch(`/api/tasks/${task.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: "dashboard" }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to start task", "error");
        return;
      }
      showToast(`Started: ${task.title}`, "success");
      loadTasks();
    } catch {
      showToast("Failed to start task", "error");
    }
  }

  async function handleComplete(task: TaskView) {
    try {
      const res = await fetch(`/api/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: "dashboard" }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to complete task", "error");
        return;
      }
      showToast(`Completed: ${task.title}`, "success");
      loadTasks();
    } catch {
      showToast("Failed to complete task", "error");
    }
  }

  async function handleDelete(task: TaskView) {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to delete task", "error");
        return;
      }
      showToast(`Deleted: ${task.title}`, "success");
      loadTasks();
    } catch {
      showToast("Failed to delete task", "error");
    }
  }

  async function handleBulkStart(selectedTasks: TaskView[]) {
    let count = 0;
    for (const task of selectedTasks) {
      try {
        const res = await fetch(`/api/tasks/${task.id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "dashboard" }),
        });
        if (res.ok) count++;
      } catch {
        /* skip */
      }
    }
    showToast(`Started ${count} task(s)`, "success");
    loadTasks();
  }

  async function handleBulkComplete(selectedTasks: TaskView[]) {
    let count = 0;
    for (const task of selectedTasks) {
      try {
        const res = await fetch(`/api/tasks/${task.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "dashboard" }),
        });
        if (res.ok) count++;
      } catch {
        /* skip */
      }
    }
    showToast(`Completed ${count} task(s)`, "success");
    loadTasks();
  }

  async function handleBulkDelete(selectedTasks: TaskView[]) {
    let count = 0;
    for (const task of selectedTasks) {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: "DELETE",
        });
        if (res.ok) count++;
      } catch {
        /* skip */
      }
    }
    showToast(`Deleted ${count} task(s)`, "success");
    loadTasks();
  }

  async function handleCreate(input: {
    title: string;
    description?: string;
    priority: string;
    project_id?: string;
    plan_id?: string;
    tags?: string[];
  }) {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to create task", "error");
        return;
      }
      showToast(`Created: ${input.title}`, "success");
      loadTasks();
    } catch {
      showToast("Failed to create task", "error");
    }
  }

  async function handleCreatePlan(input: {
    name: string;
    description?: string;
    project_id?: string;
  }) {
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to create plan", "error");
        return;
      }
      showToast(`Created plan: ${input.name}`, "success");
      loadPlans();
    } catch {
      showToast("Failed to create plan", "error");
    }
  }

  async function handleDeletePlan(plan: PlanView) {
    try {
      const res = await fetch(`/api/plans/${plan.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to delete plan", "error");
        return;
      }
      showToast(`Deleted: ${plan.name}`, "success");
      loadPlans();
    } catch {
      showToast("Failed to delete plan", "error");
    }
  }

  async function handleUpdatePlanStatus(plan: PlanView, status: "active" | "completed" | "archived") {
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to update plan", "error");
        return;
      }
      showToast(`Updated: ${plan.name}`, "success");
      loadPlans();
    } catch {
      showToast("Failed to update plan", "error");
    }
  }

  async function handleBulkDeletePlans(selectedPlans: PlanView[]) {
    let count = 0;
    for (const plan of selectedPlans) {
      try {
        const res = await fetch(`/api/plans/${plan.id}`, { method: "DELETE" });
        if (res.ok) count++;
      } catch { /* skip */ }
    }
    showToast(`Deleted ${count} plan(s)`, "success");
    loadPlans();
  }

  async function handleBulkCompletePlans(selectedPlans: PlanView[]) {
    let count = 0;
    for (const plan of selectedPlans) {
      try {
        const res = await fetch(`/api/plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        });
        if (res.ok) count++;
      } catch { /* skip */ }
    }
    showToast(`Completed ${count} plan(s)`, "success");
    loadPlans();
  }

  async function handleBulkArchivePlans(selectedPlans: PlanView[]) {
    let count = 0;
    for (const plan of selectedPlans) {
      try {
        const res = await fetch(`/api/plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        if (res.ok) count++;
      } catch { /* skip */ }
    }
    showToast(`Archived ${count} plan(s)`, "success");
    loadPlans();
  }

  async function handleDeleteProject(project: ProjectView) {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to delete project", "error");
        return;
      }
      showToast(`Deleted: ${project.name}`, "success");
      loadProjects();
    } catch {
      showToast("Failed to delete project", "error");
    }
  }

  async function handleCreateProject(input: {
    name: string;
    description?: string;
    path?: string;
    task_list_id?: string;
  }) {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to create project", "error");
        return;
      }
      showToast(`Created project: ${input.name}`, "success");
      loadProjects();
    } catch {
      showToast("Failed to create project", "error");
    }
  }

  async function handleCreateApiKey(name: string): Promise<ApiKeyView | null> {
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to create API key", "error");
        return null;
      }
      const data = await res.json();
      showToast("API key created", "success");
      return data;
    } catch {
      showToast("Failed to create API key", "error");
      return null;
    }
  }

  async function handleDeleteApiKey(id: string) {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to delete API key", "error");
        return;
      }
      showToast("API key deleted", "success");
      loadApiKeys();
    } catch {
      showToast("Failed to delete API key", "error");
    }
  }

  function handleEditTask(task: TaskView) {
    navigate(`todos/${task.id}`);
  }

  function handleEditPlan(plan: PlanView) {
    navigate(`plans/${plan.id}`);
  }

  async function handleBulkDeleteProjects(selectedProjects: ProjectView[]) {
    let count = 0;
    for (const project of selectedProjects) {
      try {
        const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
        if (res.ok) count++;
      } catch { /* skip */ }
    }
    showToast(`Deleted ${count} project(s)`, "success");
    loadProjects();
  }

  const navItems: { key: string; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "projects", label: "Projects" },
    { key: "plans", label: "Plans" },
    { key: "billing", label: "Billing" },
    { key: "docs", label: "Docs" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
          <div className="flex items-center gap-6">
            <button
              onClick={() => navigate("dashboard")}
              className="hover:opacity-80 transition-opacity"
            >
              <span className="text-base font-bold">todos.md</span>
            </button>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    route.page === item.key
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {updateAvailable && (
              <Button
                variant="ghost"
                className="size-9 p-0 text-blue-500"
                onClick={handleUpdate}
                disabled={updating}
                title="Update available"
              >
                <ArrowUpCircleIcon
                  className={`size-4 ${updating ? "animate-spin" : ""}`}
                />
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl px-6 py-6 flex-1">
        {route.page === "dashboard" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Dashboard</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium text-muted-foreground">Total Tasks</div>
                <div className="mt-1 text-2xl font-bold">{tasks.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium text-muted-foreground">In Progress</div>
                <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">{tasks.filter(t => t.status === "in_progress").length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium text-muted-foreground">Projects</div>
                <div className="mt-1 text-2xl font-bold">{projects.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium text-muted-foreground">Active Plans</div>
                <div className="mt-1 text-2xl font-bold text-purple-600 dark:text-purple-400">{plans.filter(p => p.status === "active").length}</div>
              </div>
            </div>
            <ApiKeysCard
              keys={apiKeys}
              onCreateKey={handleCreateApiKey}
              onDeleteKey={handleDeleteApiKey}
              onReload={loadApiKeys}
            />
          </div>
        )}
        {route.page === "todos" && !route.id && (
          <TasksTable
            data={tasks}
            onStart={handleStart}
            onComplete={handleComplete}
            onDelete={handleDelete}
            onView={handleView}
            onEdit={handleEditTask}
            onCreate={() => setCreateOpen(true)}
            onBulkStart={handleBulkStart}
            onBulkComplete={handleBulkComplete}
            onBulkDelete={handleBulkDelete}
            onReload={() => {
              setLoading(true);
              loadTasks();
            }}
            loading={loading}
          />
        )}
        {route.page === "todos" && route.id && (
          <TaskDetailPage
            taskId={route.id}
            projects={projects}
            plans={plans}
            onNavigate={navigate}
            onUpdate={async (id, input) => {
              const res = await fetch(`/api/tasks/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!res.ok) {
                const data = await res.json();
                showToast(data.error || "Failed to update task", "error");
                return;
              }
              showToast("Task updated", "success");
              loadTasks();
            }}
            onDelete={async (id) => {
              await fetch(`/api/tasks/${id}`, { method: "DELETE" });
              showToast("Task deleted", "success");
              loadTasks();
            }}
            onStart={async (id) => {
              await fetch(`/api/tasks/${id}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_id: "dashboard" }),
              });
              showToast("Task started", "success");
              loadTasks();
            }}
            onComplete={async (id) => {
              await fetch(`/api/tasks/${id}/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_id: "dashboard" }),
              });
              showToast("Task completed", "success");
              loadTasks();
            }}
            showToast={showToast}
          />
        )}
        {route.page === "projects" && !route.id && (
          <ProjectsPage
            projects={projects}
            onDelete={handleDeleteProject}
            onCreate={() => setCreateProjectOpen(true)}
            onBulkDelete={handleBulkDeleteProjects}
            onReload={() => loadProjects()}
            onView={(project) => navigate(`projects/${project.id}`)}
            loading={loading}
          />
        )}
        {route.page === "projects" && route.id && (
          <ProjectDetailPage
            projectId={route.id}
            onNavigate={navigate}
            onDelete={async (id) => {
              await fetch(`/api/projects/${id}`, { method: "DELETE" });
              showToast("Project deleted", "success");
              loadProjects();
            }}
            showToast={showToast}
          />
        )}
        {route.page === "plans" && !route.id && (
          <PlansPage
            plans={plans}
            projects={projects}
            onDelete={handleDeletePlan}
            onComplete={(plan) => handleUpdatePlanStatus(plan, "completed")}
            onArchive={(plan) => handleUpdatePlanStatus(plan, "archived")}
            onEdit={handleEditPlan}
            onCreate={() => setCreatePlanOpen(true)}
            onBulkDelete={handleBulkDeletePlans}
            onBulkComplete={handleBulkCompletePlans}
            onBulkArchive={handleBulkArchivePlans}
            onReload={() => loadPlans()}
            loading={loading}
          />
        )}
        {route.page === "plans" && route.id && (
          <PlanDetailPage
            planId={route.id}
            projects={projects}
            onNavigate={navigate}
            onUpdate={async (id, input) => {
              const res = await fetch(`/api/plans/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!res.ok) {
                const data = await res.json();
                showToast(data.error || "Failed to update plan", "error");
                return;
              }
              showToast("Plan updated", "success");
              loadPlans();
            }}
            onDelete={async (id) => {
              await fetch(`/api/plans/${id}`, { method: "DELETE" });
              showToast("Plan deleted", "success");
              loadPlans();
            }}
            showToast={showToast}
          />
        )}
        {route.page === "billing" && <BillingPage showToast={showToast} />}
        {route.page === "docs" && <DocsPage />}
        {route.page === "about" && <AboutPage />}
        {route.page === "contact" && <ContactPage />}
        {route.page === "legal" && <LegalPage />}
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} todos.md
          </p>
          <nav className="flex items-center gap-4">
            {[
              { key: "about", label: "About" },
              { key: "contact", label: "Contact" },
              { key: "legal", label: "Legal" },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.label}
              </button>
            ))}
            <a
              href="https://github.com/hasna/open-todos"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        plans={plans}
        onSave={handleCreate}
      />

      {/* Create Plan Dialog */}
      <CreatePlanDialog
        open={createPlanOpen}
        onOpenChange={setCreatePlanOpen}
        projects={projects}
        onSave={handleCreatePlan}
      />

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onSave={handleCreateProject}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
