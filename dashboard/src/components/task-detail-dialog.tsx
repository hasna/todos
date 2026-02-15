import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface Comment {
  id: string;
  content: string;
  agent_id?: string;
  created_at: string;
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
  const [comments, setComments] = React.useState<Comment[]>([]);

  React.useEffect(() => {
    if (task && open) {
      fetch(`/api/tasks/${task.id}/comments`)
        .then((r) => r.json())
        .then((data) => setComments(data))
        .catch(() => setComments([]));
    }
  }, [task, open]);

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          {task.description && (
            <DialogDescription>{task.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status:</span>{" "}
              <Badge
                variant="outline"
                className={
                  task.status === "completed"
                    ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                    : task.status === "in_progress"
                      ? "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400"
                      : ""
                }
              >
                {task.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Priority:</span>{" "}
              <Badge
                variant="outline"
                className={
                  task.priority === "critical"
                    ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                    : task.priority === "high"
                      ? "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400"
                      : ""
                }
              >
                {task.priority}
              </Badge>
            </div>
            {task.project_name && (
              <div>
                <span className="text-muted-foreground">Project:</span>{" "}
                {task.project_name}
              </div>
            )}
            {task.agent_id && (
              <div>
                <span className="text-muted-foreground">Agent:</span>{" "}
                {task.agent_id}
              </div>
            )}
            {task.session_id && (
              <div>
                <span className="text-muted-foreground">Session:</span>{" "}
                <span className="font-mono text-xs">{task.session_id}</span>
              </div>
            )}
            {task.assigned_to && (
              <div>
                <span className="text-muted-foreground">Assigned to:</span>{" "}
                {task.assigned_to}
              </div>
            )}
            {task.working_dir && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Working Dir:</span>{" "}
                <span className="font-mono text-xs">{task.working_dir}</span>
              </div>
            )}
            {task.locked_by && (
              <div>
                <span className="text-muted-foreground">Locked by:</span>{" "}
                {task.locked_by}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Version:</span>{" "}
              {task.version}
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>{" "}
              {timeAgo(task.created_at)}
            </div>
            <div>
              <span className="text-muted-foreground">Updated:</span>{" "}
              {timeAgo(task.updated_at)}
            </div>
            {task.completed_at && (
              <div>
                <span className="text-muted-foreground">Completed:</span>{" "}
                {timeAgo(task.completed_at)}
              </div>
            )}
          </div>

          {task.tags.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Tags:</span>{" "}
              <div className="flex gap-1 mt-1 flex-wrap">
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {Object.keys(task.metadata).length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Metadata:</span>
              <pre className="mt-1 rounded border bg-muted p-2 text-xs overflow-x-auto">
                {JSON.stringify(task.metadata, null, 2)}
              </pre>
            </div>
          )}

          {comments.length > 0 && (
            <div>
              <span className="text-sm font-medium">
                Comments ({comments.length})
              </span>
              <div className="mt-2 space-y-2">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded border bg-muted/50 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      {c.agent_id && (
                        <Badge variant="outline" className="text-xs">
                          {c.agent_id}
                        </Badge>
                      )}
                      <span>{timeAgo(c.created_at)}</span>
                    </div>
                    <p>{c.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {task.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onStart(task);
                  onOpenChange(false);
                }}
              >
                <PlayIcon className="size-3.5" />
                Start
              </Button>
            )}
            {(task.status === "pending" || task.status === "in_progress") && (
              <Button
                size="sm"
                onClick={() => {
                  onComplete(task);
                  onOpenChange(false);
                }}
              >
                <CheckCircle2Icon className="size-3.5" />
                Complete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
