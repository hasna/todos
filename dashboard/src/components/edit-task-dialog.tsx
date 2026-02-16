import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import type { TaskView, ProjectView, PlanView } from "@/types";

interface EditTaskDialogProps {
  task: TaskView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectView[];
  plans: PlanView[];
  onSave: (taskId: string, input: {
    version: number;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigned_to?: string;
    plan_id?: string;
    tags?: string[];
  }) => void;
}

export function EditTaskDialog({
  task,
  open,
  onOpenChange,
  projects,
  plans,
  onSave,
}: EditTaskDialogProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("medium");
  const [status, setStatus] = React.useState("pending");
  const [assignedTo, setAssignedTo] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");

  React.useEffect(() => {
    if (task && open) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(task.priority);
      setStatus(task.status);
      setAssignedTo(task.assigned_to || "");
      setPlanId(task.plan_id || "");
      setTagsInput(task.tags.join(", "));
    }
  }, [task, open]);

  function handleSave() {
    if (!task || !title.trim()) return;
    onSave(task.id, {
      version: task.version,
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      assigned_to: assignedTo.trim() || undefined,
      plan_id: planId || undefined,
      tags: tagsInput
        ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
    });
    onOpenChange(false);
  }

  if (!task) return null;

  const filteredPlans = task.project_id
    ? plans.filter(p => p.project_id === task.project_id || !p.project_id)
    : plans;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="edit-title" className="text-sm font-medium">
              Title *
            </label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="edit-description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="placeholder:text-muted-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label htmlFor="edit-status" className="text-sm font-medium">
                Status
              </label>
              <select
                id="edit-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="grid gap-2">
              <label htmlFor="edit-priority" className="text-sm font-medium">
                Priority
              </label>
              <select
                id="edit-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <label htmlFor="edit-assigned" className="text-sm font-medium">
              Assigned To
            </label>
            <Input
              id="edit-assigned"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Agent or person"
            />
          </div>

          {filteredPlans.length > 0 && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Plan</label>
              <Combobox
                options={filteredPlans.map((p) => ({ value: p.id, label: p.name }))}
                value={planId}
                onValueChange={setPlanId}
                placeholder="No plan"
                searchPlaceholder="Search plans..."
                emptyText="No plans found."
              />
            </div>
          )}

          <div className="grid gap-2">
            <label htmlFor="edit-tags" className="text-sm font-medium">
              Tags
            </label>
            <Input
              id="edit-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Comma-separated tags"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!title.trim()}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
