import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Combobox } from "@/components/ui/combobox";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PlayIcon, CheckCircle2Icon, Trash2Icon, SaveIcon } from "lucide-react";
import type { TaskView, ProjectView, PlanView } from "@/types";

interface Comment {
  id: string;
  content: string;
  agent_id?: string;
  created_at: string;
}

interface RelatedTask {
  id: string;
  title: string;
  status: string;
}

interface FullTaskData extends TaskView {
  subtasks: RelatedTask[];
  dependencies: RelatedTask[];
  blocked_by: RelatedTask[];
  comments: Comment[];
  parent: RelatedTask | null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-0",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0",
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-0",
    failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-0",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border-0",
  };
  return <Badge className={styles[status] || ""}>{status.replace("_", " ")}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm col-span-2">{children}</span>
    </div>
  );
}

interface TaskDetailPageProps {
  taskId: string;
  projects: ProjectView[];
  plans: PlanView[];
  onNavigate: (page: string) => void;
  onUpdate: (taskId: string, input: Record<string, unknown>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onStart: (taskId: string) => Promise<void>;
  onComplete: (taskId: string) => Promise<void>;
  showToast: (message: string, type: "success" | "error") => void;
}

export function TaskDetailPage({
  taskId,
  projects,
  plans,
  onNavigate,
  onUpdate,
  onDelete,
  onStart,
  onComplete,
  showToast,
}: TaskDetailPageProps) {
  const [task, setTask] = React.useState<FullTaskData | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Editable fields
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState("pending");
  const [priority, setPriority] = React.useState("medium");
  const [assignedTo, setAssignedTo] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  const loadTask = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setTask(data);
      setTitle(data.title);
      setDescription(data.description || "");
      setStatus(data.status);
      setPriority(data.priority);
      setAssignedTo(data.assigned_to || "");
      setPlanId(data.plan_id || "");
      setTagsInput((data.tags || []).join(", "));
      setDirty(false);
    } catch {
      showToast("Failed to load task", "error");
    } finally {
      setLoading(false);
    }
  }, [taskId, showToast]);

  React.useEffect(() => { loadTask(); }, [loadTask]);

  function markDirty() { setDirty(true); }

  async function handleSave() {
    if (!task) return;
    await onUpdate(taskId, {
      version: task.version,
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      assigned_to: assignedTo.trim() || undefined,
      plan_id: planId || undefined,
      tags: tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [],
    });
    loadTask();
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  if (!task) return <div className="py-8 text-center text-muted-foreground">Task not found.</div>;

  const filteredPlans = task.project_id
    ? plans.filter(p => p.project_id === task.project_id || !p.project_id)
    : plans;
  const hasRelations = (task.dependencies?.length || 0) > 0 || (task.blocked_by?.length || 0) > 0 || (task.subtasks?.length || 0) > 0 || task.parent;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Todos", onClick: () => onNavigate("todos") },
          { label: task.title },
        ]}
      />

      {/* Header with actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <Badge variant="outline">{task.priority}</Badge>
          <span className="text-xs text-muted-foreground font-mono">{task.id.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          {task.status === "pending" && (
            <Button variant="outline" size="sm" onClick={() => onStart(taskId).then(loadTask)}>
              <PlayIcon className="size-3.5" />
              Start
            </Button>
          )}
          {(task.status === "pending" || task.status === "in_progress") && (
            <Button variant="outline" size="sm" onClick={() => onComplete(taskId).then(loadTask)}>
              <CheckCircle2Icon className="size-3.5" />
              Complete
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => { await onDelete(taskId); onNavigate("todos"); }}
          >
            <Trash2Icon className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          {hasRelations && <TabsTrigger value="relations">Relations</TabsTrigger>}
          <TabsTrigger value="comments">
            Comments{(task.comments?.length || 0) > 0 ? ` (${task.comments.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-4 pt-4">
          <div className="grid gap-4 max-w-xl">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); markDirty(); }}
                rows={4}
                className="placeholder:text-muted-foreground dark:bg-input/30 border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); markDirty(); }}
                  className="dark:bg-input/30 border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => { setPriority(e.target.value); markDirty(); }}
                  className="dark:bg-input/30 border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Assigned To</label>
              <Input value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); markDirty(); }} placeholder="Agent or person" />
            </div>
            {filteredPlans.length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Plan</label>
                <Combobox
                  options={filteredPlans.map(p => ({ value: p.id, label: p.name }))}
                  value={planId}
                  onValueChange={(v) => { setPlanId(v); markDirty(); }}
                  placeholder="No plan"
                  searchPlaceholder="Search plans..."
                  emptyText="No plans found."
                />
              </div>
            )}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Tags</label>
              <Input value={tagsInput} onChange={(e) => { setTagsInput(e.target.value); markDirty(); }} placeholder="Comma-separated tags" />
            </div>
            <div>
              <Button onClick={handleSave} disabled={!dirty || !title.trim()}>
                <SaveIcon className="size-3.5" />
                Save Changes
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="details" className="pt-4">
          <div className="max-w-xl rounded-lg border">
            <Field label="ID"><span className="font-mono text-xs">{task.id}</span></Field>
            <Field label="Version">{task.version}</Field>
            {task.project_name && <Field label="Project">{task.project_name}</Field>}
            {task.plan_name && <Field label="Plan">{task.plan_name}</Field>}
            <Field label="Created">{formatDate(task.created_at)}</Field>
            <Field label="Updated">{formatDate(task.updated_at)}</Field>
            {task.completed_at && <Field label="Completed">{formatDate(task.completed_at)}</Field>}
            {task.agent_id && <Field label="Agent">{task.agent_id}</Field>}
            {task.session_id && <Field label="Session"><span className="font-mono text-xs">{task.session_id}</span></Field>}
            {task.working_dir && <Field label="Working Dir"><span className="font-mono text-xs break-all">{task.working_dir}</span></Field>}
            {task.locked_by && <Field label="Locked by">{task.locked_by}</Field>}
            {task.tags.length > 0 && (
              <Field label="Tags">
                <div className="flex gap-1 flex-wrap">
                  {task.tags.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
                </div>
              </Field>
            )}
            {Object.keys(task.metadata).length > 0 && (
              <Field label="Metadata">
                <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">{JSON.stringify(task.metadata, null, 2)}</pre>
              </Field>
            )}
          </div>
        </TabsContent>

        {hasRelations && (
          <TabsContent value="relations" className="pt-4 space-y-4 max-w-xl">
            {task.parent && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Parent</p>
                <button onClick={() => onNavigate(`todos/${task.parent!.id}`)} className="flex items-center gap-2 text-sm hover:underline">
                  <StatusBadge status={task.parent.status} />
                  <span className="font-mono text-xs text-muted-foreground">{task.parent.id.slice(0, 8)}</span>
                  {task.parent.title}
                </button>
              </div>
            )}
            {(task.dependencies?.length || 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Depends on ({task.dependencies.length})</p>
                {task.dependencies.map(t => (
                  <button key={t.id} onClick={() => onNavigate(`todos/${t.id}`)} className="flex items-center gap-2 text-sm py-1 hover:underline">
                    <StatusBadge status={t.status} />
                    <span className="font-mono text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            {(task.blocked_by?.length || 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Blocking ({task.blocked_by.length})</p>
                {task.blocked_by.map(t => (
                  <button key={t.id} onClick={() => onNavigate(`todos/${t.id}`)} className="flex items-center gap-2 text-sm py-1 hover:underline">
                    <StatusBadge status={t.status} />
                    <span className="font-mono text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            {(task.subtasks?.length || 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Subtasks ({task.subtasks.length})</p>
                {task.subtasks.map(t => (
                  <button key={t.id} onClick={() => onNavigate(`todos/${t.id}`)} className="flex items-center gap-2 text-sm py-1 hover:underline">
                    <StatusBadge status={t.status} />
                    <span className="font-mono text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="comments" className="pt-4 space-y-3 max-w-xl">
          {(task.comments?.length || 0) > 0 ? (
            task.comments.map(c => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  {c.agent_id && <Badge variant="outline" className="text-xs">{c.agent_id}</Badge>}
                  <span>{formatDate(c.created_at)}</span>
                </div>
                <p>{c.content}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No comments yet.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
