export interface TaskView {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  project_id?: string;
  project_name?: string;
  plan_id?: string;
  plan_name?: string;
  parent_id?: string;
  agent_id?: string;
  session_id?: string;
  assigned_to?: string;
  working_dir?: string;
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

export interface PlanView {
  id: string;
  name: string;
  description?: string;
  status: "active" | "completed" | "archived";
  project_id?: string;
  project_name?: string;
  task_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectView {
  id: string;
  name: string;
  path?: string;
  description?: string;
  task_list_id?: string;
  created_at: string;
  updated_at: string;
  task_count?: number;
}

export interface ApiKeyView {
  id: string;
  name: string;
  key_prefix: string;
  key?: string; // full key, only on creation
  created_at: string;
  last_used_at?: string;
  expires_at?: string;
}
