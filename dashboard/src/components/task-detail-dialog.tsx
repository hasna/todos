import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlayIcon, CheckCircle2Icon } from "lucide-react";
import type { TaskView } from "@/types";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff);
  if (abs < 60000) return Math.round(abs / 1000) + "s ago";
  if (abs < 3600000) return Math.round(abs / 60000) + "m ago";
  if (abs < 86400000) return Math.round(abs / 3600000) + "h ago";
  return Math.round(abs / 86400000) + "d ago";
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

interface FullTaskData {
  subtasks: RelatedTask[];
  dependencies: RelatedTask[];
  blocked_by: RelatedTask[];
  comments: Comment[];
  parent: RelatedTask | null;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400",
    in_progress: "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400",
    pending: "",
    failed: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
    cancelled: "border-gray-300 text-gray-500",
  };
  return <Badge variant="outline" className={styles[status] || ""}>{status.replace("_", " ")}</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    critical: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
    high: "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400",
    medium: "",
    low: "border-gray-300 text-gray-500",
  };
  return <Badge variant="outline" className={styles[priority] || ""}>{priority}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{children}</span>
    </div>
  );
}

function RelatedTaskItem({ task }: { task: RelatedTask }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <StatusBadge status={task.status} />
      <span className="font-mono text-xs text-muted-foreground">{task.id.slice(0, 8)}</span>
      <span className="truncate">{task.title}</span>
    </div>
  );
}

interface TaskDetailDialogProps {
  task: TaskView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (task: TaskView) => void;
  onComplete: (task: TaskView) => void;
}

export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onStart,
  onComplete,
}: TaskDetailDialogProps) {
  const [fullData, setFullData] = React.useState<FullTaskData | null>(null);

  React.useEffect(() => {
    if (task && open) {
      fetch(`/api/tasks/${task.id}`)
        .then((r) => r.json())
        .then((data) => setFullData({
          subtasks: data.subtasks || [],
          dependencies: data.dependencies || [],
          blocked_by: data.blocked_by || [],
          comments: data.comments || [],
          parent: data.parent || null,
        }))
        .catch(() => setFullData(null));
    }
  }, [task, open]);

  if (!task) return null;

  const comments = fullData?.comments || [];
  const dependencies = fullData?.dependencies || [];
  const blockedBy = fullData?.blocked_by || [];
  const subtasks = fullData?.subtasks || [];
  const hasRelations = dependencies.length > 0 || blockedBy.length > 0 || subtasks.length > 0 || fullData?.parent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{task.title}</DialogTitle>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
          )}
        </DialogHeader>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <div className="ml-auto flex gap-2">
            {task.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onStart(task); onOpenChange(false); }}
              >
                <PlayIcon className="size-3.5" />
                Start
              </Button>
            )}
            {(task.status === "pending" || task.status === "in_progress") && (
              <Button
                size="sm"
                onClick={() => { onComplete(task); onOpenChange(false); }}
              >
                <CheckCircle2Icon className="size-3.5" />
                Complete
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
            {hasRelations && <TabsTrigger value="relations" className="flex-1">Relations</TabsTrigger>}
            <TabsTrigger value="comments" className="flex-1">
              Comments{comments.length > 0 ? ` (${comments.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-1 divide-y">
            {task.project_name && <Field label="Project">{task.project_name}</Field>}
            {task.plan_name && <Field label="Plan">{task.plan_name}</Field>}
            <Field label="Created">{formatDate(task.created_at)}</Field>
            <Field label="Updated">{formatDate(task.updated_at)}</Field>
            {task.completed_at && <Field label="Completed">{formatDate(task.completed_at)}</Field>}
            {task.assigned_to && <Field label="Assigned to">{task.assigned_to}</Field>}
            {task.tags.length > 0 && (
              <div className="py-1.5">
                <span className="text-sm text-muted-foreground">Tags</span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {task.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="details" className="space-y-1 divide-y">
            <Field label="ID">
              <span className="font-mono text-xs">{task.id}</span>
            </Field>
            <Field label="Version">{task.version}</Field>
            {task.agent_id && <Field label="Agent">{task.agent_id}</Field>}
            {task.session_id && (
              <Field label="Session">
                <span className="font-mono text-xs">{task.session_id}</span>
              </Field>
            )}
            {task.working_dir && (
              <Field label="Working Dir">
                <span className="font-mono text-xs truncate max-w-[250px] block">{task.working_dir}</span>
              </Field>
            )}
            {task.locked_by && (
              <Field label="Locked by">{task.locked_by} ({timeAgo(task.locked_at!)})</Field>
            )}
            {Object.keys(task.metadata).length > 0 && (
              <div className="py-1.5">
                <span className="text-sm text-muted-foreground">Metadata</span>
                <pre className="mt-1 rounded border bg-muted p-2 text-xs overflow-x-auto">
                  {JSON.stringify(task.metadata, null, 2)}
                </pre>
              </div>
            )}
          </TabsContent>

          {hasRelations && (
            <TabsContent value="relations" className="space-y-4">
              {fullData?.parent && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Parent</p>
                  <RelatedTaskItem task={fullData.parent} />
                </div>
              )}
              {dependencies.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Depends on ({dependencies.length})</p>
                  {dependencies.map((t) => <RelatedTaskItem key={t.id} task={t} />)}
                </div>
              )}
              {blockedBy.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Blocking ({blockedBy.length})</p>
                  {blockedBy.map((t) => <RelatedTaskItem key={t.id} task={t} />)}
                </div>
              )}
              {subtasks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Subtasks ({subtasks.length})</p>
                  {subtasks.map((t) => <RelatedTaskItem key={t.id} task={t} />)}
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="comments" className="space-y-2">
            {comments.length > 0 ? (
              comments.map((c) => (
                <div key={c.id} className="rounded border bg-muted/50 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    {c.agent_id && <Badge variant="outline" className="text-xs">{c.agent_id}</Badge>}
                    <span>{timeAgo(c.created_at)}</span>
                  </div>
                  <p>{c.content}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No comments yet.</p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
