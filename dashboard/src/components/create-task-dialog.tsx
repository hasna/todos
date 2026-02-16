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
import type { ProjectView, PlanView } from "@/types";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectView[];
  plans: PlanView[];
  onSave: (task: {
    title: string;
    description?: string;
    priority: string;
    project_id?: string;
    plan_id?: string;
    tags?: string[];
  }) => void;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  projects,
  plans,
  onSave,
}: CreateTaskDialogProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("medium");
  const [projectId, setProjectId] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");

  function handleSave() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      project_id: projectId || undefined,
      plan_id: planId || undefined,
      tags: tagsInput
        ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
    setTitle("");
    setDescription("");
    setPriority("medium");
    setProjectId("");
    setPlanId("");
    setTagsInput("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="title" className="text-sm font-medium">
              Title *
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="placeholder:text-muted-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="priority" className="text-sm font-medium">
              Priority
            </label>
            <select
              id="priority"
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

          {projects.length > 0 && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Project</label>
              <Combobox
                options={[
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={projectId}
                onValueChange={setProjectId}
                placeholder="No project"
                searchPlaceholder="Search projects..."
                emptyText="No projects found."
              />
            </div>
          )}

          {plans.length > 0 && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Plan</label>
              <Combobox
                options={(projectId ? plans.filter(p => p.project_id === projectId || !p.project_id) : plans).map((p) => ({ value: p.id, label: p.name }))}
                value={planId}
                onValueChange={setPlanId}
                placeholder="No plan"
                searchPlaceholder="Search plans..."
                emptyText="No plans found."
              />
            </div>
          )}

          <div className="grid gap-2">
            <label htmlFor="tags" className="text-sm font-medium">
              Tags
            </label>
            <Input
              id="tags"
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
