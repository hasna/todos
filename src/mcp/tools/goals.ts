import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGoalPlan, getGoalPlan, recordGoalProgress, completeGoalPlan } from "../../db/goal-contracts.js";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (id: string, table?: string) => string;
  formatError: (e: unknown) => string;
};

const goalTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  tags: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  verification_commands: z.array(z.string()).optional(),
});

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerGoalTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("create_goal_plan")) {
    server.tool(
      "create_goal_plan",
      "Create a local /goal-style plan contract from an objective, generated task list, success criteria, and verification commands. Uses only local SQLite plans, tasks, and metadata.",
      {
        objective: z.string(),
        name: z.string().optional(),
        tool: z.string().optional().describe("Agent tool name such as codex or claude-code"),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        agent_id: z.string().optional(),
        success_criteria: z.array(z.string()).optional(),
        verification_commands: z.array(z.string()).optional(),
        tasks: z.array(goalTaskSchema).optional(),
      },
      async (params) => {
        try {
          const contract = createGoalPlan({
            ...params,
            project_id: params.project_id ? resolveId(params.project_id, "projects") : undefined,
            task_list_id: params.task_list_id ? resolveId(params.task_list_id, "task_lists") : undefined,
          });
          return jsonText(contract);
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_goal_plan")) {
    server.tool(
      "get_goal_plan",
      "Return the complete local goal plan contract including objective, tasks, progress status, verification commands, and completion evidence.",
      { plan_id: z.string() },
      async ({ plan_id }) => {
        try {
          return jsonText(getGoalPlan(resolveId(plan_id, "plans")));
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("record_goal_progress")) {
    server.tool(
      "record_goal_progress",
      "Record a progress comment for a goal plan step and move the goal contract to a running, blocked, or other active status.",
      {
        plan_id: z.string(),
        message: z.string(),
        agent_id: z.string().optional(),
        session_id: z.string().optional(),
        task_id: z.string().optional(),
        step_index: z.number().int().optional(),
        progress_pct: z.number().min(0).max(100).optional(),
        status: z.enum(["planning", "running", "blocked", "completed", "failed", "cancelled"]).optional(),
      },
      async ({ plan_id, task_id, ...params }) => {
        try {
          const contract = recordGoalProgress(resolveId(plan_id, "plans"), {
            ...params,
            task_id: task_id ? resolveId(task_id, "tasks") : undefined,
          });
          return jsonText(contract);
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("complete_goal_plan")) {
    server.tool(
      "complete_goal_plan",
      "Complete, fail, or cancel a local goal plan with verification evidence and stable completion semantics.",
      {
        plan_id: z.string(),
        status: z.enum(["completed", "failed", "cancelled"]).optional(),
        agent_id: z.string().optional(),
        evidence: z.object({
          commands: z.array(z.string()).optional(),
          test_results: z.string().optional(),
          files_changed: z.array(z.string()).optional(),
          commit_hash: z.string().optional(),
          notes: z.string().optional(),
        }).optional(),
      },
      async ({ plan_id, ...params }) => {
        try {
          return jsonText(completeGoalPlan(resolveId(plan_id, "plans"), params));
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
