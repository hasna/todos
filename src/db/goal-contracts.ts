import type { Database } from "bun:sqlite";
import {
  type CompleteGoalPlanInput,
  type CreateGoalPlanInput,
  type GoalExecutionStatus,
  type GoalPlanContract,
  type GoalProgressInput,
  type GoalVerificationEvidence,
  PlanNotFoundError,
  TaskNotFoundError,
} from "../types/index.js";
import { addComment } from "./comments.js";
import { getDatabase, now } from "./database.js";
import { createPlan, getPlan, updatePlan } from "./plans.js";
import { createTask, getTask, listTasks } from "./tasks.js";

const GOAL_METADATA_KEY = "_goal";
const GOAL_STEP_METADATA_KEY = "_goal_step";

type GoalStepMetadata = {
  index: number;
  task_id: string | null;
  title: string;
  acceptance_criteria: string[];
  verification_commands: string[];
};

type StoredGoalMetadata = {
  objective: string;
  status: GoalExecutionStatus;
  tool: string | null;
  success_criteria: string[];
  verification_commands: string[];
  verification_evidence: GoalVerificationEvidence | null;
  completion_semantics: GoalPlanContract["completion_semantics"];
  steps: GoalStepMetadata[];
  created_at: string;
  updated_at: string;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function storedGoal(plan: { description: string | null; metadata: Record<string, unknown>; created_at: string; updated_at: string }): StoredGoalMetadata {
  const raw = plan.metadata[GOAL_METADATA_KEY] as Partial<StoredGoalMetadata> | undefined;
  return {
    objective: typeof raw?.objective === "string" ? raw.objective : plan.description ?? "",
    status: raw?.status ?? "planning",
    tool: typeof raw?.tool === "string" ? raw.tool : null,
    success_criteria: strings(raw?.success_criteria),
    verification_commands: strings(raw?.verification_commands),
    verification_evidence: raw?.verification_evidence ?? null,
    completion_semantics: {
      requires_all_tasks_completed: raw?.completion_semantics?.requires_all_tasks_completed ?? true,
      requires_verification_evidence: raw?.completion_semantics?.requires_verification_evidence ?? true,
      completed_at: raw?.completion_semantics?.completed_at ?? null,
    },
    steps: Array.isArray(raw?.steps) ? raw.steps.map((step, index) => ({
      index: typeof step.index === "number" ? step.index : index,
      task_id: typeof step.task_id === "string" ? step.task_id : null,
      title: typeof step.title === "string" ? step.title : `Step ${index + 1}`,
      acceptance_criteria: strings(step.acceptance_criteria),
      verification_commands: strings(step.verification_commands),
    })) : [],
    created_at: typeof raw?.created_at === "string" ? raw.created_at : plan.created_at,
    updated_at: typeof raw?.updated_at === "string" ? raw.updated_at : plan.updated_at,
  };
}

function goalMetadata(goal: StoredGoalMetadata): Record<string, unknown> {
  return { [GOAL_METADATA_KEY]: goal };
}

function tasksForPlan(planId: string, db: Database) {
  return listTasks({ plan_id: planId, limit: 500 }, db).sort((a, b) => {
    const aStep = (a.metadata[GOAL_STEP_METADATA_KEY] as { index?: number } | undefined)?.index ?? Number.MAX_SAFE_INTEGER;
    const bStep = (b.metadata[GOAL_STEP_METADATA_KEY] as { index?: number } | undefined)?.index ?? Number.MAX_SAFE_INTEGER;
    return aStep - bStep || a.created_at.localeCompare(b.created_at);
  });
}

export function getGoalPlan(planId: string, db?: Database): GoalPlanContract {
  const d = db || getDatabase();
  const plan = getPlan(planId, d);
  if (!plan) throw new PlanNotFoundError(planId);
  const goal = storedGoal(plan);
  const tasks = tasksForPlan(plan.id, d);

  return {
    id: plan.id,
    plan_id: plan.id,
    objective: goal.objective,
    status: goal.status,
    tool: goal.tool,
    project_id: plan.project_id,
    task_list_id: plan.task_list_id,
    agent_id: plan.agent_id,
    plan,
    tasks,
    success_criteria: goal.success_criteria,
    verification_commands: goal.verification_commands,
    verification_evidence: goal.verification_evidence,
    completion_semantics: goal.completion_semantics,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };
}

export function createGoalPlan(input: CreateGoalPlanInput, db?: Database): GoalPlanContract {
  const d = db || getDatabase();
  const timestamp = now();
  const initialGoal: StoredGoalMetadata = {
    objective: input.objective,
    status: "planning",
    tool: input.tool ?? null,
    success_criteria: input.success_criteria ?? [],
    verification_commands: input.verification_commands ?? [],
    verification_evidence: null,
    completion_semantics: {
      requires_all_tasks_completed: true,
      requires_verification_evidence: true,
      completed_at: null,
    },
    steps: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  const plan = createPlan({
    name: input.name ?? input.objective,
    description: input.objective,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    metadata: goalMetadata(initialGoal),
  }, d);

  const steps: GoalStepMetadata[] = [];
  for (const [index, step] of (input.tasks ?? []).entries()) {
    const task = createTask({
      title: step.title,
      description: step.description,
      priority: step.priority ?? "medium",
      project_id: input.project_id,
      task_list_id: input.task_list_id,
      plan_id: plan.id,
      agent_id: input.agent_id,
      assigned_to: input.agent_id,
      tags: Array.from(new Set([...(step.tags ?? []), "goal"])),
      metadata: {
        [GOAL_STEP_METADATA_KEY]: {
          goal_plan_id: plan.id,
          index,
          acceptance_criteria: step.acceptance_criteria ?? [],
          verification_commands: step.verification_commands ?? [],
        },
      },
    }, d);
    steps.push({
      index,
      task_id: task.id,
      title: task.title,
      acceptance_criteria: step.acceptance_criteria ?? [],
      verification_commands: step.verification_commands ?? [],
    });
  }

  updatePlan(plan.id, {
    metadata: goalMetadata({
      ...initialGoal,
      steps,
      status: steps.length > 0 ? "running" : "planning",
      updated_at: now(),
    }),
  }, d);

  return getGoalPlan(plan.id, d);
}

export function recordGoalProgress(planId: string, input: GoalProgressInput, db?: Database): GoalPlanContract {
  const d = db || getDatabase();
  const contract = getGoalPlan(planId, d);
  let taskId = input.task_id;
  if (!taskId && input.step_index !== undefined) {
    taskId = contract.tasks.find((task) => {
      const step = task.metadata[GOAL_STEP_METADATA_KEY] as { index?: number } | undefined;
      return step?.index === input.step_index;
    })?.id;
  }
  if (!taskId && contract.tasks.length > 0) taskId = contract.tasks[0]!.id;
  if (!taskId) throw new TaskNotFoundError(`goal plan ${planId} has no task for progress`);
  if (!getTask(taskId, d)) throw new TaskNotFoundError(taskId);

  addComment({
    task_id: taskId,
    content: input.message,
    agent_id: input.agent_id,
    session_id: input.session_id,
    type: "progress",
    progress_pct: input.progress_pct,
  }, d);

  const plan = getPlan(planId, d)!;
  const goal = storedGoal(plan);
  updatePlan(planId, {
    metadata: goalMetadata({
      ...goal,
      status: input.status ?? "running",
      updated_at: now(),
    }),
  }, d);
  return getGoalPlan(planId, d);
}

export function completeGoalPlan(planId: string, input: CompleteGoalPlanInput = {}, db?: Database): GoalPlanContract {
  const d = db || getDatabase();
  const plan = getPlan(planId, d);
  if (!plan) throw new PlanNotFoundError(planId);
  const goal = storedGoal(plan);
  const status = input.status ?? "completed";
  const timestamp = now();
  const evidence = input.evidence ?? null;

  updatePlan(planId, {
    status: status === "completed" ? "completed" : "active",
    metadata: goalMetadata({
      ...goal,
      status,
      verification_evidence: evidence,
      completion_semantics: {
        ...goal.completion_semantics,
        completed_at: status === "completed" ? timestamp : null,
      },
      updated_at: timestamp,
    }),
  }, d);

  return getGoalPlan(planId, d);
}
