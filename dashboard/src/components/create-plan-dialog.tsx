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
import type { ProjectView } from "@/types";

interface CreatePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectView[];
  onSave: (plan: {
    name: string;
    description?: string;
    project_id?: string;
  }) => void;
}

export function CreatePlanDialog({
  open,
  onOpenChange,
  projects,
  onSave,
}: CreatePlanDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [projectId, setProjectId] = React.useState("");

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      project_id: projectId || undefined,
    });
    setName("");
    setDescription("");
    setProjectId("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Plan</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="plan-name" className="text-sm font-medium">
              Name *
            </label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan name"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
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

          <div className="grid gap-2">
            <label htmlFor="plan-description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="plan-description"
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
