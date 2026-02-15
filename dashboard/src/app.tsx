import * as React from "react";
import { RefreshCwIcon, PlusIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { TasksTable } from "@/components/tasks-table";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { CreateTaskDialog } from "@/components/create-task-dialog";
import { Button } from "@/components/ui/button";
import type { TaskView, ProjectView } from "@/types";

export function App() {
  const [tasks, setTasks] = React.useState<TaskView[]>([]);
  const [projects, setProjects] = React.useState<ProjectView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [viewingTask, setViewingTask] = React.useState<TaskView | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

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

  React.useEffect(() => {
    loadTasks();
    loadProjects();
  }, [loadTasks, loadProjects]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleView(task: TaskView) {
    setViewingTask(task);
    setDetailOpen(true);
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

  async function handleCreate(input: {
    title: string;
    description?: string;
    priority: string;
    project_id?: string;
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

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold">
              Hasna{" "}
              <span className="font-normal text-muted-foreground">
                Todos
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon className="size-3.5" />
              New Task
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLoading(true);
                loadTasks();
              }}
              disabled={loading}
            >
              <RefreshCwIcon
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <StatsCards tasks={tasks} />
        <TasksTable
          data={tasks}
          onStart={handleStart}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onView={handleView}
        />
      </main>

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        task={viewingTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onStart={handleStart}
        onComplete={handleComplete}
      />

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        onSave={handleCreate}
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
