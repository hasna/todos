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
import type { PlanView, ProjectView } from "@/types";

interface EditPlanDialogProps {
  plan: PlanView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectView[];
  onSave: (planId: string, input: {
    name?: string;
    description?: string;
    status?: string;
  }) => void;
}

export function EditPlanDialog({
  plan,
  open,
  onOpenChange,
  projects,
  onSave,
}: EditPlanDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState("active");

  React.useEffect(() => {
    if (plan && open) {
      setName(plan.name);
      setDescription(plan.description || "");
      setStatus(plan.status);
    }
  }, [plan, open]);

  function handleSave() {
    if (!plan || !name.trim()) return;
    onSave(plan.id, {
      name: name.trim(),
      description: description.trim() || undefined,
      status,
    });
    onOpenChange(false);
  }

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Plan</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="edit-plan-name" className="text-sm font-medium">
              Name *
            </label>
            <Input
              id="edit-plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan name"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="edit-plan-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="edit-plan-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="edit-plan-desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="edit-plan-desc"
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
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
