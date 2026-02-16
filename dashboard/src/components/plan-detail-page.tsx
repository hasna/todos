import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Combobox } from "@/components/ui/combobox";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Trash2Icon, SaveIcon, CheckCircle2Icon, ArchiveIcon } from "lucide-react";
import type { PlanView, ProjectView } from "@/types";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PlanStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0",
    completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-0",
    archived: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border-0",
  };
  return <Badge className={styles[status] || ""}>{status}</Badge>;
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
  priority: string;
}

interface PlanDetailPageProps {
  planId: string;
  projects: ProjectView[];
  onNavigate: (page: string) => void;
  onUpdate: (planId: string, input: Record<string, unknown>) => Promise<void>;
  onDelete: (planId: string) => Promise<void>;
  showToast: (message: string, type: "success" | "error") => void;
}

export function PlanDetailPage({
  planId,
  projects,
  onNavigate,
  onUpdate,
  onDelete,
  showToast,
}: PlanDetailPageProps) {
  const [plan, setPlan] = React.useState<PlanView | null>(null);
  const [tasks, setTasks] = React.useState<TaskItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState("active");
  const [projectId, setProjectId] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  const loadPlan = React.useCallback(async () => {
    try {
      const [planRes, tasksRes] = await Promise.all([
        fetch(`/api/plans/${planId}`),
        fetch(`/api/tasks?plan_id=${planId}`),
      ]);
      if (!planRes.ok) { setLoading(false); return; }
      const planData = await planRes.json();
      setPlan(planData);
      setName(planData.name);
      setDescription(planData.description || "");
      setStatus(planData.status);
      setProjectId(planData.project_id || "");
      setDirty(false);
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData);
      }
    } catch {
      showToast("Failed to load plan", "error");
    } finally {
      setLoading(false);
    }
  }, [planId, showToast]);

  React.useEffect(() => { loadPlan(); }, [loadPlan]);

  function markDirty() { setDirty(true); }

  async function handleSave() {
    if (!plan) return;
    await onUpdate(planId, {
      name: name.trim(),
      description: description.trim() || null,
      status,
    });
    loadPlan();
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  if (!plan) return <div className="py-8 text-center text-muted-foreground">Plan not found.</div>;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Plans", onClick: () => onNavigate("plans") },
          { label: plan.name },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <PlanStatusBadge status={plan.status} />
          <span className="text-xs text-muted-foreground font-mono">{plan.id.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          {plan.status !== "completed" && (
            <Button variant="outline" size="sm" onClick={() => onUpdate(planId, { status: "completed" }).then(loadPlan)}>
              <CheckCircle2Icon className="size-3.5" />
              Complete
            </Button>
          )}
          {plan.status !== "archived" && (
            <Button variant="outline" size="sm" onClick={() => onUpdate(planId, { status: "archived" }).then(loadPlan)}>
              <ArchiveIcon className="size-3.5" />
              Archive
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => { await onDelete(planId); onNavigate("plans"); }}
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
          <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-4 pt-4">
          <div className="grid gap-4 max-w-xl">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); markDirty(); }}
                className="dark:bg-input/30 border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            {projects.length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Project</label>
                <Combobox
                  options={projects.map(p => ({ value: p.id, label: p.name }))}
                  value={projectId}
                  onValueChange={(v) => { setProjectId(v); markDirty(); }}
                  placeholder="No project"
                  searchPlaceholder="Search projects..."
                  emptyText="No projects found."
                />
              </div>
            )}
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
            <Field label="ID"><span className="font-mono text-xs">{plan.id}</span></Field>
            {plan.project_name && <Field label="Project">{plan.project_name}</Field>}
            <Field label="Created">{formatDate(plan.created_at)}</Field>
            <Field label="Updated">{formatDate(plan.updated_at)}</Field>
            {plan.description && <Field label="Description">{plan.description}</Field>}
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
            <p className="text-sm text-muted-foreground text-center py-8">No tasks in this plan.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
