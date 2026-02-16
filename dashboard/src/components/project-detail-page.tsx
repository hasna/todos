import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Trash2Icon, SaveIcon } from "lucide-react";
import type { ProjectView } from "@/types";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm col-span-2">{children}</span>
    </div>
  );
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
}

interface ProjectDetailPageProps {
  projectId: string;
  onNavigate: (page: string) => void;
  onDelete: (projectId: string) => Promise<void>;
  showToast: (message: string, type: "success" | "error") => void;
}

export function ProjectDetailPage({
  projectId,
  onNavigate,
  onDelete,
  showToast,
}: ProjectDetailPageProps) {
  const [project, setProject] = React.useState<ProjectView | null>(null);
  const [tasks, setTasks] = React.useState<TaskItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [taskListId, setTaskListId] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  const loadProject = React.useCallback(async () => {
    try {
      const [projRes, tasksRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/tasks?project_id=${projectId}`),
      ]);
      if (!projRes.ok) { setLoading(false); return; }
      const projData = await projRes.json();
      setProject(projData);
      setName(projData.name);
      setDescription(projData.description || "");
      setTaskListId(projData.task_list_id || "");
      setDirty(false);
      if (tasksRes.ok) setTasks(await tasksRes.json());
    } catch {
      showToast("Failed to load project", "error");
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  React.useEffect(() => { loadProject(); }, [loadProject]);

  function markDirty() { setDirty(true); }

  async function handleSave() {
    if (!project) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          task_list_id: taskListId.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Failed to update project", "error");
        return;
      }
      showToast("Project updated", "success");
      loadProject();
    } catch {
      showToast("Failed to update project", "error");
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  if (!project) return <div className="py-8 text-center text-muted-foreground">Project not found.</div>;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Projects", onClick: () => onNavigate("projects") },
          { label: project.name },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-mono">{project.id.slice(0, 8)}</span>
          <Badge variant="secondary">{tasks.length} tasks</Badge>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => { await onDelete(projectId); onNavigate("projects"); }}
        >
          <Trash2Icon className="size-3.5" />
          Delete
        </Button>
      </div>

      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-4 pt-4">
          <div className="grid gap-4 max-w-xl">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Task List ID</label>
              <Input value={taskListId} onChange={(e) => { setTaskListId(e.target.value); markDirty(); }} placeholder="Custom task list ID" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); markDirty(); }}
                rows={4}
                className="dark:bg-input/30 border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
              />
            </div>
            <div>
              <Button onClick={handleSave} disabled={!dirty || !name.trim()}>
                <SaveIcon className="size-3.5" />
                Save Changes
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="details" className="pt-4">
          <div className="max-w-xl rounded-lg border">
            <Field label="ID"><span className="font-mono text-xs">{project.id}</span></Field>
            {project.path && <Field label="Path"><span className="font-mono text-xs break-all">{project.path}</span></Field>}
            {project.task_list_id && <Field label="Task List ID"><span className="font-mono text-xs">{project.task_list_id}</span></Field>}
            <Field label="Created">{formatDate(project.created_at)}</Field>
            <Field label="Updated">{formatDate(project.updated_at)}</Field>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="pt-4 space-y-2 max-w-xl">
          {tasks.length > 0 ? (
            tasks.map(t => (
              <button
                key={t.id}
                onClick={() => onNavigate(`todos/${t.id}`)}
                className="flex items-center gap-3 w-full rounded-lg border p-3 text-sm hover:bg-accent/50 transition-colors text-left"
              >
                <Badge className={
                  t.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-0"
                  : t.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-0"
                }>{t.status.replace("_", " ")}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                <span className="truncate">{t.title}</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No tasks in this project.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
