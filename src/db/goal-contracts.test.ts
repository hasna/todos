import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { listComments } from "./comments.js";
import { createGoalPlan, getGoalPlan, recordGoalProgress, completeGoalPlan } from "./goal-contracts.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local goal execution contracts", () => {
  test("creates a goal plan backed by local plans and tasks", () => {
    const db = getDatabase();
    const goal = createGoalPlan({
      objective: "Ship a production-safe landing page",
      tool: "codex",
      success_criteria: ["landing page explains agent-native workflow"],
      verification_commands: ["bun test"],
      tasks: [
        {
          title: "Update landing copy",
          priority: "high",
          acceptance_criteria: ["package name is @hasna/todos"],
          verification_commands: ["bun test src/json-contracts.test.ts"],
        },
        { title: "Run verification", priority: "medium" },
      ],
    }, db);

    expect(goal.objective).toBe("Ship a production-safe landing page");
    expect(goal.status).toBe("running");
    expect(goal.tool).toBe("codex");
    expect(goal.tasks.map((task) => task.title)).toEqual([
      "Update landing copy",
      "Run verification",
    ]);
    expect(goal.tasks[0]!.plan_id).toBe(goal.plan_id);
    expect(goal.tasks[0]!.metadata._goal_step).toMatchObject({
      goal_plan_id: goal.plan_id,
      index: 0,
      acceptance_criteria: ["package name is @hasna/todos"],
    });

    const fetched = getGoalPlan(goal.plan_id, db);
    expect(fetched.success_criteria).toEqual(["landing page explains agent-native workflow"]);
    expect(fetched.verification_commands).toEqual(["bun test"]);
  });

  test("records progress comments and completion evidence on the goal contract", () => {
    const db = getDatabase();
    const goal = createGoalPlan({
      objective: "Execute a local /goal",
      tasks: [{ title: "Implement" }],
    }, db);

    const progressed = recordGoalProgress(goal.plan_id, {
      step_index: 0,
      message: "Implementation started",
      progress_pct: 40,
      agent_id: "codex",
    }, db);

    expect(progressed.status).toBe("running");
    const comments = listComments(goal.tasks[0]!.id, db);
    expect(comments).toHaveLength(1);
    expect(comments[0]!).toMatchObject({
      content: "Implementation started",
      type: "progress",
      progress_pct: 40,
      agent_id: "codex",
    });

    const completed = completeGoalPlan(goal.plan_id, {
      evidence: {
        commands: ["bun test"],
        test_results: "2 pass, 0 fail",
        files_changed: ["src/db/goal-contracts.ts"],
        commit_hash: "abc1234",
        notes: "Verified locally",
      },
    }, db);

    expect(completed.status).toBe("completed");
    expect(completed.plan.status).toBe("completed");
    expect(completed.completion_semantics.completed_at).toBeTruthy();
    expect(completed.verification_evidence).toMatchObject({
      commands: ["bun test"],
      test_results: "2 pass, 0 fail",
    });
  });
});
