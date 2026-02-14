#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
} from "../db/tasks.js";
import {
  listProjects,
  ensureProject,
  getProjectByPath,
} from "../db/projects.js";
import { addComment } from "../db/comments.js";
import { searchTasks } from "../lib/search.js";
import type { Task, TaskStatus, TaskPriority } from "../types/index.js";

const program = new Command();

// Helpers

function handleError(e: unknown): never {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

function resolveTaskId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "tasks", partialId);
  if (!id) {
    console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
    process.exit(1);
  }
  return id;
}

function detectGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function autoProject(opts: { project?: string }): string | undefined {
  if (opts.project) {
    const p = getProjectByPath(resolve(opts.project));
    return p?.id;
  }
  if (process.env["TODOS_AUTO_PROJECT"] === "false") return undefined;
  const gitRoot = detectGitRoot();
  if (gitRoot) {
    const p = ensureProject(basename(gitRoot), gitRoot);
    return p.id;
  }
  return undefined;
}

function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
}

const statusColors: Record<string, (s: string) => string> = {
  pending: chalk.yellow,
  in_progress: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

const priorityColors: Record<string, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

function formatTaskLine(t: Task): string {
  const statusFn = statusColors[t.status] || chalk.white;
  const priorityFn = priorityColors[t.priority] || chalk.white;
  const lock = t.locked_by ? chalk.magenta(` [locked:${t.locked_by}]`) : "";
  const assigned = t.assigned_to ? chalk.cyan(` -> ${t.assigned_to}`) : "";
  const tags = t.tags.length > 0 ? chalk.dim(` [${t.tags.join(",")}]`) : "";
  return `${chalk.dim(t.id.slice(0, 8))} ${statusFn(t.status.padEnd(11))} ${priorityFn(t.priority.padEnd(8))} ${t.title}${assigned}${lock}${tags}`;
}

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version("0.1.0")
  .option("--project <path>", "Project path")
  .option("--json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

// === COMMANDS ===

// add
program
  .command("add <title>")
  .description("Create a new task")
  .option("-d, --description <text>", "Task description")
  .option("-p, --priority <level>", "Priority: low, medium, high, critical")
  .option("--parent <id>", "Parent task ID")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--assign <agent>", "Assign to agent")
  .option("--status <status>", "Initial status")
  .action((title: string, opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const task = createTask({
      title,
      description: opts.description,
      priority: opts.priority as TaskPriority | undefined,
      parent_id: opts.parent ? resolveTaskId(opts.parent) : undefined,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      assigned_to: opts.assign,
      status: opts.status as TaskStatus | undefined,
      agent_id: globalOpts.agent,
      session_id: globalOpts.session,
      project_id: projectId,
      working_dir: process.cwd(),
    });

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task created:"));
      console.log(formatTaskLine(task));
    }
  });

// list
program
  .command("list")
  .description("List tasks")
  .option("-s, --status <status>", "Filter by status")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("--assigned <agent>", "Filter by assigned agent")
  .option("--tags <tags>", "Filter by tags (comma-separated)")
  .option("-a, --all", "Show all tasks (including completed/cancelled)")
  .action((opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);

    const filter: Record<string, unknown> = {};
    if (projectId) filter["project_id"] = projectId;
    if (opts.status) {
      filter["status"] = opts.status.includes(",")
        ? opts.status.split(",").map((s: string) => s.trim())
        : opts.status;
    } else if (!opts.all) {
      filter["status"] = ["pending", "in_progress"];
    }
    if (opts.priority) filter["priority"] = opts.priority;
    if (opts.assigned) filter["assigned_to"] = opts.assigned;
    if (opts.tags) filter["tags"] = opts.tags.split(",").map((t: string) => t.trim());

    const tasks = listTasks(filter as any);

    if (globalOpts.json) {
      output(tasks, true);
      return;
    }

    if (tasks.length === 0) {
      console.log(chalk.dim("No tasks found."));
      return;
    }

    console.log(chalk.bold(`${tasks.length} task(s):\n`));
    for (const t of tasks) {
      console.log(formatTaskLine(t));
    }
  });

// show
program
  .command("show <id>")
  .description("Show full task details")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const task = getTaskWithRelations(resolvedId);

    if (!task) {
      console.error(chalk.red(`Task not found: ${id}`));
      process.exit(1);
    }

    if (globalOpts.json) {
      output(task, true);
      return;
    }

    console.log(chalk.bold("Task Details:\n"));
    console.log(`  ${chalk.dim("ID:")}       ${task.id}`);
    console.log(`  ${chalk.dim("Title:")}    ${task.title}`);
    console.log(`  ${chalk.dim("Status:")}   ${(statusColors[task.status] || chalk.white)(task.status)}`);
    console.log(`  ${chalk.dim("Priority:")} ${(priorityColors[task.priority] || chalk.white)(task.priority)}`);
    if (task.description) console.log(`  ${chalk.dim("Desc:")}     ${task.description}`);
    if (task.assigned_to) console.log(`  ${chalk.dim("Assigned:")} ${task.assigned_to}`);
    if (task.agent_id) console.log(`  ${chalk.dim("Agent:")}    ${task.agent_id}`);
    if (task.locked_by) console.log(`  ${chalk.dim("Locked:")}   ${task.locked_by} (at ${task.locked_at})`);
    if (task.project_id) console.log(`  ${chalk.dim("Project:")}  ${task.project_id}`);
    if (task.parent) console.log(`  ${chalk.dim("Parent:")}   ${task.parent.id.slice(0, 8)} | ${task.parent.title}`);
    if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}     ${task.tags.join(", ")}`);
    console.log(`  ${chalk.dim("Version:")}  ${task.version}`);
    console.log(`  ${chalk.dim("Created:")}  ${task.created_at}`);
    if (task.completed_at) console.log(`  ${chalk.dim("Done:")}     ${task.completed_at}`);

    if (task.subtasks.length > 0) {
      console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
      for (const st of task.subtasks) {
        console.log(`    ${formatTaskLine(st)}`);
      }
    }

    if (task.dependencies.length > 0) {
      console.log(chalk.bold(`\n  Depends on (${task.dependencies.length}):`));
      for (const dep of task.dependencies) {
        console.log(`    ${formatTaskLine(dep)}`);
      }
    }

    if (task.blocked_by.length > 0) {
      console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
      for (const b of task.blocked_by) {
        console.log(`    ${formatTaskLine(b)}`);
      }
    }

    if (task.comments.length > 0) {
      console.log(chalk.bold(`\n  Comments (${task.comments.length}):`));
      for (const c of task.comments) {
        const agent = c.agent_id ? chalk.cyan(`[${c.agent_id}] `) : "";
        console.log(`    ${agent}${chalk.dim(c.created_at)}: ${c.content}`);
      }
    }
  });

// update
program
  .command("update <id>")
  .description("Update a task")
  .option("--title <text>", "New title")
  .option("-d, --description <text>", "New description")
  .option("-s, --status <status>", "New status")
  .option("-p, --priority <priority>", "New priority")
  .option("--assign <agent>", "Assign to agent")
  .option("--tags <tags>", "New tags (comma-separated)")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const current = getTask(resolvedId);
    if (!current) {
      console.error(chalk.red(`Task not found: ${id}`));
      process.exit(1);
    }

    let task;
    try {
      task = updateTask(resolvedId, {
        version: current.version,
        title: opts.title,
        description: opts.description,
        status: opts.status as TaskStatus | undefined,
        priority: opts.priority as TaskPriority | undefined,
        assigned_to: opts.assign,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      });
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task updated:"));
      console.log(formatTaskLine(task));
    }
  });

// done
program
  .command("done <id>")
  .description("Mark a task as completed")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    let task;
    try {
      task = completeTask(resolvedId, globalOpts.agent);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task completed:"));
      console.log(formatTaskLine(task));
    }
  });

// start
program
  .command("start <id>")
  .description("Claim, lock, and start a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const agentId = globalOpts.agent || "cli";
    const resolvedId = resolveTaskId(id);
    let task;
    try {
      task = startTask(resolvedId, agentId);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green(`Task started by ${agentId}:`));
      console.log(formatTaskLine(task));
    }
  });

// lock
program
  .command("lock <id>")
  .description("Acquire exclusive lock on a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const agentId = globalOpts.agent || "cli";
    const resolvedId = resolveTaskId(id);
    let result;
    try {
      result = lockTask(resolvedId, agentId);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(result, true);
    } else if (result.success) {
      console.log(chalk.green(`Lock acquired by ${agentId}`));
    } else {
      console.error(chalk.red(`Lock failed: ${result.error}`));
      process.exit(1);
    }
  });

// unlock
program
  .command("unlock <id>")
  .description("Release lock on a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    try {
      unlockTask(resolvedId, globalOpts.agent);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output({ success: true }, true);
    } else {
      console.log(chalk.green("Lock released."));
    }
  });

// delete
program
  .command("delete <id>")
  .description("Delete a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const deleted = deleteTask(resolvedId);

    if (globalOpts.json) {
      output({ deleted }, true);
    } else if (deleted) {
      console.log(chalk.green("Task deleted."));
    } else {
      console.error(chalk.red("Task not found."));
      process.exit(1);
    }
  });

// plan
program
  .command("plan <title>")
  .description("Create a plan with subtasks")
  .option("-d, --description <text>", "Plan description")
  .option("--tasks <tasks>", "Comma-separated subtask titles")
  .option("-p, --priority <priority>", "Priority")
  .action((title: string, opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);

    const parent = createTask({
      title,
      description: opts.description,
      priority: opts.priority as TaskPriority | undefined,
      agent_id: globalOpts.agent,
      session_id: globalOpts.session,
      project_id: projectId,
      working_dir: process.cwd(),
    });

    const subtasks: Task[] = [];
    if (opts.tasks) {
      const taskTitles = opts.tasks.split(",").map((t: string) => t.trim());
      for (const st of taskTitles) {
        subtasks.push(
          createTask({
            title: st,
            parent_id: parent.id,
            priority: opts.priority as TaskPriority | undefined,
            agent_id: globalOpts.agent,
            session_id: globalOpts.session,
            project_id: projectId,
            working_dir: process.cwd(),
          }),
        );
      }
    }

    if (globalOpts.json) {
      output({ parent, subtasks }, true);
    } else {
      console.log(chalk.green("Plan created:"));
      console.log(formatTaskLine(parent));
      if (subtasks.length > 0) {
        console.log(chalk.bold(`\n  Subtasks:`));
        for (const st of subtasks) {
          console.log(`  ${formatTaskLine(st)}`);
        }
      }
    }
  });

// comment
program
  .command("comment <id> <text>")
  .description("Add a comment to a task")
  .action((id: string, text: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const comment = addComment({
      task_id: resolvedId,
      content: text,
      agent_id: globalOpts.agent,
      session_id: globalOpts.session,
    });

    if (globalOpts.json) {
      output(comment, true);
    } else {
      console.log(chalk.green("Comment added."));
    }
  });

// search
program
  .command("search <query>")
  .description("Search tasks")
  .action((query: string) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const tasks = searchTasks(query, projectId);

    if (globalOpts.json) {
      output(tasks, true);
      return;
    }

    if (tasks.length === 0) {
      console.log(chalk.dim(`No tasks matching "${query}".`));
      return;
    }

    console.log(chalk.bold(`${tasks.length} result(s) for "${query}":\n`));
    for (const t of tasks) {
      console.log(formatTaskLine(t));
    }
  });

// deps
program
  .command("deps <id>")
  .description("Manage task dependencies")
  .option("--needs <dep-id>", "Add dependency (this task needs dep-id)")
  .option("--remove <dep-id>", "Remove dependency")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);

    if (opts.needs) {
      const depId = resolveTaskId(opts.needs);
      try {
        addDependency(resolvedId, depId);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
      if (globalOpts.json) {
        output({ task_id: resolvedId, depends_on: depId }, true);
      } else {
        console.log(chalk.green("Dependency added."));
      }
    } else if (opts.remove) {
      const depId = resolveTaskId(opts.remove);
      const removed = removeDependency(resolvedId, depId);
      if (globalOpts.json) {
        output({ removed }, true);
      } else {
        console.log(removed ? chalk.green("Dependency removed.") : chalk.red("Dependency not found."));
      }
    } else {
      // Show dependencies
      const task = getTaskWithRelations(resolvedId);
      if (!task) {
        console.error(chalk.red("Task not found."));
        process.exit(1);
      }

      if (globalOpts.json) {
        output({ dependencies: task.dependencies, blocked_by: task.blocked_by }, true);
        return;
      }

      if (task.dependencies.length > 0) {
        console.log(chalk.bold("Depends on:"));
        for (const dep of task.dependencies) {
          console.log(`  ${formatTaskLine(dep)}`);
        }
      }
      if (task.blocked_by.length > 0) {
        console.log(chalk.bold("Blocks:"));
        for (const b of task.blocked_by) {
          console.log(`  ${formatTaskLine(b)}`);
        }
      }
      if (task.dependencies.length === 0 && task.blocked_by.length === 0) {
        console.log(chalk.dim("No dependencies."));
      }
    }
  });

// projects
program
  .command("projects")
  .description("List and manage projects")
  .option("--add <path>", "Register a project by path")
  .option("--name <name>", "Project name (with --add)")
  .action((opts) => {
    const globalOpts = program.opts();

    if (opts.add) {
      const projectPath = resolve(opts.add);
      const name = opts.name || basename(projectPath);
      const project = ensureProject(name, projectPath);

      if (globalOpts.json) {
        output(project, true);
      } else {
        console.log(chalk.green(`Project registered: ${project.name} (${project.path})`));
      }
      return;
    }

    const projects = listProjects();
    if (globalOpts.json) {
      output(projects, true);
      return;
    }

    if (projects.length === 0) {
      console.log(chalk.dim("No projects registered."));
      return;
    }

    console.log(chalk.bold(`${projects.length} project(s):\n`));
    for (const p of projects) {
      console.log(`${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.dim(p.path)}${p.description ? ` - ${p.description}` : ""}`);
    }
  });

// export
program
  .command("export")
  .description("Export tasks")
  .option("-f, --format <format>", "Format: json or md", "json")
  .action((opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const tasks = listTasks(projectId ? { project_id: projectId } : {});

    if (opts.format === "md") {
      console.log("# Tasks\n");
      for (const t of tasks) {
        const check = t.status === "completed" ? "x" : " ";
        console.log(`- [${check}] **${t.title}** (${t.priority}) ${t.status}`);
        if (t.description) console.log(`  ${t.description}`);
      }
    } else {
      console.log(JSON.stringify(tasks, null, 2));
    }
  });

// mcp
program
  .command("mcp")
  .description("Start MCP server (stdio)")
  .option("--register <agent>", "Register MCP server with an agent (claude, codex, gemini, all)")
  .option("--unregister <agent>", "Unregister MCP server from an agent (claude, codex, gemini, all)")
  .action(async (opts) => {
    if (opts.register) {
      registerMcp(opts.register);
      return;
    }
    if (opts.unregister) {
      unregisterMcp(opts.unregister);
      return;
    }

    // Start MCP server by importing and running
    await import("../mcp/index.js");
  });

// --- MCP Registration Helpers ---

const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

function getMcpBinaryPath(): string {
  // Resolve the actual todos-mcp binary location
  try {
    const p = execSync("which todos-mcp", { encoding: "utf-8" }).trim();
    if (p) return p;
  } catch { /* fall through */ }

  // Fallback: check common bun global bin
  const bunBin = join(HOME, ".bun", "bin", "todos-mcp");
  if (existsSync(bunBin)) return bunBin;

  // Last resort: assume it's on PATH
  return "todos-mcp";
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function readTomlFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function writeTomlFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
}

// --- Claude Code: .mcp.json at project root (flat object, no wrapper) ---

function registerClaude(binPath: string): void {
  const cwd = process.cwd();
  const configPath = join(cwd, ".mcp.json");
  const config = readJsonFile(configPath);

  config["todos"] = {
    command: binPath,
    args: [] as string[],
  };

  writeJsonFile(configPath, config);
  console.log(chalk.green(`Claude Code: registered in ${configPath}`));
}

function unregisterClaude(): void {
  const cwd = process.cwd();
  const configPath = join(cwd, ".mcp.json");
  const config = readJsonFile(configPath);

  if (!("todos" in config)) {
    console.log(chalk.dim(`Claude Code: todos not found in ${configPath}`));
    return;
  }

  delete config["todos"];
  writeJsonFile(configPath, config);
  console.log(chalk.green(`Claude Code: unregistered from ${configPath}`));
}

// --- Codex CLI: ~/.codex/config.toml (TOML, [mcp_servers.todos]) ---

function registerCodex(binPath: string): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);

  // Remove existing [mcp_servers.todos] block if present
  content = removeTomlBlock(content, "mcp_servers.todos");

  // Append new block
  const block = `\n[mcp_servers.todos]\ncommand = "${binPath}"\nargs = []\n`;
  content = content.trimEnd() + "\n" + block;

  writeTomlFile(configPath, content);
  console.log(chalk.green(`Codex CLI: registered in ${configPath}`));
}

function unregisterCodex(): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);

  if (!content.includes("[mcp_servers.todos]")) {
    console.log(chalk.dim(`Codex CLI: todos not found in ${configPath}`));
    return;
  }

  content = removeTomlBlock(content, "mcp_servers.todos");
  writeTomlFile(configPath, content.trimEnd() + "\n");
  console.log(chalk.green(`Codex CLI: unregistered from ${configPath}`));
}

function removeTomlBlock(content: string, blockName: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;
  const header = `[${blockName}]`;

  for (const line of lines) {
    if (line.trim() === header) {
      skipping = true;
      continue;
    }
    // Stop skipping when we hit the next section header
    if (skipping && line.trim().startsWith("[")) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

// --- Gemini CLI: ~/.gemini/settings.json (JSON, mcpServers wrapper) ---

function registerGemini(binPath: string): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);

  if (!config["mcpServers"]) {
    config["mcpServers"] = {};
  }
  const servers = config["mcpServers"] as Record<string, unknown>;
  servers["todos"] = {
    command: binPath,
    args: [] as string[],
  };

  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: registered in ${configPath}`));
}

function unregisterGemini(): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);
  const servers = config["mcpServers"] as Record<string, unknown> | undefined;

  if (!servers || !("todos" in servers)) {
    console.log(chalk.dim(`Gemini CLI: todos not found in ${configPath}`));
    return;
  }

  delete servers["todos"];
  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: unregistered from ${configPath}`));
}

// --- Main register/unregister ---

function registerMcp(agent: string): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];
  const binPath = getMcpBinaryPath();

  for (const a of agents) {
    switch (a) {
      case "claude":
        registerClaude(binPath);
        break;
      case "codex":
        registerCodex(binPath);
        break;
      case "gemini":
        registerGemini(binPath);
        break;
      default:
        console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

function unregisterMcp(agent: string): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];

  for (const a of agents) {
    switch (a) {
      case "claude":
        unregisterClaude();
        break;
      case "codex":
        unregisterCodex();
        break;
      case "gemini":
        unregisterGemini();
        break;
      default:
        console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

// interactive (TUI)
program
  .command("interactive")
  .description("Launch interactive TUI")
  .action(async () => {
    const { renderApp } = await import("./components/App.js");
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    renderApp(projectId);
  });

// Default action: help or TUI
program.action(async () => {
  if (process.stdout.isTTY) {
    // Interactive terminal -> launch TUI
    try {
      const { renderApp } = await import("./components/App.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      renderApp(projectId);
    } catch {
      program.help();
    }
  } else {
    program.help();
  }
});

program.parse();
