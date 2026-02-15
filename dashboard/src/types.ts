export interface TaskView {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  project_id?: string;
  project_name?: string;
  parent_id?: string;
  agent_id?: string;
  assigned_to?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  version: number;
  locked_by?: string;
  locked_at?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  subtask_count?: number;
  comment_count?: number;
}

export interface ProjectView {
  id: string;
  name: string;
  path?: string;
  description?: string;
  created_at: string;
  updated_at: string;
  task_count?: number;
}
