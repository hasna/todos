import type { Command } from "commander";
import chalk from "chalk";
import { resolvePartialId } from "../../db/database.js";
import { createGoalPlan, getGoalPlan, recordGoalProgress, completeGoalPlan } from "../../db/goal-contracts.js";
import { getDatabase } from "../../db/database.js";
import { autoProject, handleError, output } from "../helpers.js";
import type { GoalPlanStepInput, GoalVerificationEvidence } from "../../types/index.js";

function values(value?: string | string[]): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((item) => item.split("\n")).map((item) => item.trim()).filter(Boolean);
}

function parseEvidence(opts: { command?: string[]; testResults?: string; filesChanged?: string; commitHash?: string; notes?: string }): GoalVerificationEvidence {
  return {
    commands: values(opts.command),
    test_results: opts.testResults,
    files_changed: opts.filesChanged ? opts.filesChanged.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    commit_hash: opts.commitHash,
    notes: opts.notes,
  };
}

function resolvePlanId(id: string): string {
  const resolved = resolvePartialId(getDatabase(), "plans", id);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve goal plan ID: ${id}`));
    process.exit(1);
  }
  return resolved;
}

export function registerGoalCommands(program: Command) {
  program
    .command("goal")
    .description("/goal-style objective, plan, progress, and verification contracts")
    .option("--create <objective>", "Create a local goal plan from an objective")
    .option("--name <name>", "Plan display name when creating a goal")
    .option("--tool <name>", "Agent tool name: codex, claude-code, takumi, or another local agent")
    .option("--task <title...>", "Generated task title(s) for the goal plan")
    .option("--success <criteria...>", "Success criteria for the goal")
    .option("--verify <command...>", "Verification command(s) expected before completion")
    .option("--show <id>", "Show a goal plan contract")
    .option("--progress <id>", "Record progress against a goal plan")
    .option("--message <text>", "Progress message")
    .option("--step <index>", "Progress step index")
    .option("--pct <0-100>", "Progress percentage")
    .option("--complete <id>", "Complete a goal plan with verification evidence")
    .option("--fail <id>", "Mark a goal plan failed with verification evidence")
    .option("--command <command...>", "Verification command(s) actually run")
    .option("--test-results <summary>", "Verification test result summary")
    .option("--files-changed <files>", "Comma-separated changed files")
    .option("--commit-hash <hash>", "Commit hash containing the goal implementation")
    .option("--notes <notes>", "Verification or completion notes")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        if (opts.create) {
          const taskTitles = values(opts.task);
          const tasks: GoalPlanStepInput[] = taskTitles.map((title) => ({ title }));
          const contract = createGoalPlan({
            objective: opts.create,
            name: opts.name,
            tool: opts.tool,
            agent_id: globalOpts.agent,
            project_id: autoProject(globalOpts),
            success_criteria: values(opts.success),
            verification_commands: values(opts.verify),
            tasks,
          });
          if (globalOpts.json) {
            output(contract, true);
            return;
          }
          console.log(chalk.green("Goal plan created:"));
          console.log(`${chalk.dim(contract.id.slice(0, 8))} ${chalk.bold(contract.objective)} ${chalk.cyan(`[${contract.status}]`)}`);
          console.log(chalk.dim(`Tasks: ${contract.tasks.length}`));
          return;
        }

        if (opts.show) {
          const contract = getGoalPlan(resolvePlanId(opts.show));
          if (globalOpts.json) {
            output(contract, true);
            return;
          }
          console.log(chalk.bold("Goal Plan:\n"));
          console.log(`  ${chalk.dim("ID:")}       ${contract.id}`);
          console.log(`  ${chalk.dim("Status:")}   ${chalk.cyan(contract.status)}`);
          console.log(`  ${chalk.dim("Objective:")} ${contract.objective}`);
          if (contract.tool) console.log(`  ${chalk.dim("Tool:")}     ${contract.tool}`);
          if (contract.success_criteria.length > 0) console.log(`  ${chalk.dim("Success:")}  ${contract.success_criteria.join("; ")}`);
          if (contract.verification_commands.length > 0) console.log(`  ${chalk.dim("Verify:")}   ${contract.verification_commands.join(" && ")}`);
          if (contract.tasks.length > 0) {
            console.log(chalk.bold("\n  Tasks:"));
            for (const task of contract.tasks) {
              console.log(`    ${chalk.dim(task.id.slice(0, 8))} ${task.status.padEnd(11)} ${task.title}`);
            }
          }
          return;
        }

        if (opts.progress) {
          if (!opts.message) {
            console.error(chalk.red("--message is required with --progress"));
            process.exit(1);
          }
          const contract = recordGoalProgress(resolvePlanId(opts.progress), {
            message: opts.message,
            agent_id: globalOpts.agent,
            session_id: globalOpts.session,
            step_index: opts.step !== undefined ? Number.parseInt(opts.step, 10) : undefined,
            progress_pct: opts.pct !== undefined ? Number.parseInt(opts.pct, 10) : undefined,
          });
          if (globalOpts.json) {
            output(contract, true);
            return;
          }
          console.log(chalk.green("Goal progress recorded."));
          return;
        }

        const terminalId = opts.complete ?? opts.fail;
        if (terminalId) {
          const contract = completeGoalPlan(resolvePlanId(terminalId), {
            status: opts.fail ? "failed" : "completed",
            agent_id: globalOpts.agent,
            evidence: parseEvidence(opts),
          });
          if (globalOpts.json) {
            output(contract, true);
            return;
          }
          console.log(opts.fail ? chalk.yellow("Goal marked failed.") : chalk.green("Goal completed."));
          return;
        }

        program.help();
      } catch (e) {
        handleError(e);
      }
    });
}
