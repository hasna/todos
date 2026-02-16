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

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (project: {
    name: string;
    description?: string;
    path?: string;
    task_list_id?: string;
  }) => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSave,
}: CreateProjectDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [path, setPath] = React.useState("");
  const [taskListId, setTaskListId] = React.useState("");

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      path: path.trim() || undefined,
      task_list_id: taskListId.trim() || undefined,
    });
    setName("");
    setDescription("");
    setPath("");
    setTaskListId("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="project-name" className="text-sm font-medium">
              Name *
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="project-path" className="text-sm font-medium">
              Path
            </label>
            <Input
              id="project-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/project (optional)"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="project-task-list" className="text-sm font-medium">
              Task List ID
            </label>
            <Input
              id="project-task-list"
              value={taskListId}
              onChange={(e) => setTaskListId(e.target.value)}
              placeholder="Custom task list ID (optional)"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="project-desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="placeholder:text-muted-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
