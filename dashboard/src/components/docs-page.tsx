import * as React from "react";
import {
  TerminalIcon,
  RocketIcon,
  LayoutListIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ServerIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";

const sections = [
  { id: "getting-started", label: "Getting Started", icon: RocketIcon },
  { id: "cli", label: "CLI Commands", icon: TerminalIcon },
  { id: "plans", label: "Plans", icon: LayoutListIcon },
  { id: "mcp", label: "MCP Integration", icon: PuzzleIcon },
  { id: "sync", label: "Sync", icon: RefreshCwIcon },
  { id: "api", label: "REST API", icon: ServerIcon },
] as const;

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 px-4 py-3 text-sm font-mono">
        <code>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md border bg-background p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        title="Copy to clipboard"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-green-500" />
        ) : (
          <CopyIcon className="size-3.5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

function CommandTable({
  rows,
  headers,
}: {
  rows: [string, string][];
  headers: [string, string];
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {headers[0]}
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {headers[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([col1, col2]) => (
            <tr
              key={col1}
              className="border-b last:border-0 transition-colors hover:bg-muted/30"
            >
              <td className="px-4 py-2.5">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                  {col1}
                </code>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{col2}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DOCS_MARKDOWN = `# Hasna Todos Documentation

## Getting Started

Install globally with Bun or npm, then launch the dashboard or use the CLI directly.

\`\`\`bash
bun add -g @hasna/todos

# Launch the web dashboard
todos serve

# Or use the CLI
todos add "My first task"
todos list
\`\`\`

## CLI Commands

### Task Management
| Command | Description |
|---------|-------------|
| \`todos add <title>\` | Create a new task |
| \`todos list\` | List tasks with optional filters |
| \`todos show <id>\` | Show full task details |
| \`todos update <id>\` | Update task fields |
| \`todos start <id>\` | Start a task (set to in_progress) |
| \`todos done <id>\` | Mark a task as completed |
| \`todos delete <id>\` | Delete a task |

### Organization
| Command | Description |
|---------|-------------|
| \`todos projects\` | List and manage projects |
| \`todos plans\` | List and manage plans |
| \`todos search <query>\` | Full-text search across tasks |
| \`todos deps <id>\` | Manage task dependencies |

### Infrastructure
| Command | Description |
|---------|-------------|
| \`todos serve\` | Launch the web dashboard |
| \`todos mcp\` | Start the MCP server |
| \`todos sync\` | Sync with agent task lists |
| \`todos hooks install\` | Install Claude Code hooks |
| \`todos export\` | Export tasks as JSON or Markdown |
| \`todos upgrade\` | Self-update to latest version |

## Plans

Plans are a first-class entity for organizing related tasks. A project can have many plans, and each task can optionally belong to one plan.

\`\`\`bash
todos plans
todos plans --add "Sprint 1" --description "First sprint"
todos plans --show <id>
todos plans --complete <id>
todos add "Implement feature" --plan <plan-id>
\`\`\`

Statuses: \`active\`, \`completed\`, \`archived\`. Deleting a plan orphans its tasks.

## MCP Integration

Register the MCP server with Claude Code or other MCP-compatible clients.

\`\`\`bash
todos mcp --register claude
todos mcp --register all
\`\`\`

Available tools: create_task, list_tasks, get_task, update_task, delete_task, start_task, complete_task, search_tasks, create_plan, list_plans, get_plan, update_plan, delete_plan, list_projects, create_project, sync

## Sync

Sync bridges Hasna Todos with Claude Code's built-in task list. Tasks are bidirectionally synchronized.

\`\`\`bash
todos sync          # Bidirectional (default)
todos sync --push   # SQLite -> agent
todos sync --pull   # agent -> SQLite
todos sync --all    # Sync all agents
\`\`\`

## REST API

### Tasks
| Endpoint | Description |
|----------|-------------|
| \`GET /api/tasks\` | List all tasks |
| \`POST /api/tasks\` | Create a task |
| \`GET /api/tasks/:id\` | Get task details with relations |
| \`PATCH /api/tasks/:id\` | Update a task (requires version) |
| \`DELETE /api/tasks/:id\` | Delete a task |
| \`POST /api/tasks/:id/start\` | Start a task |
| \`POST /api/tasks/:id/complete\` | Complete a task |

### Plans
| Endpoint | Description |
|----------|-------------|
| \`GET /api/plans\` | List plans (optional ?project_id=) |
| \`POST /api/plans\` | Create a plan |
| \`GET /api/plans/:id\` | Get plan details |
| \`PATCH /api/plans/:id\` | Update a plan |
| \`DELETE /api/plans/:id\` | Delete a plan |

### Projects & Search
| Endpoint | Description |
|----------|-------------|
| \`GET /api/projects\` | List projects |
| \`POST /api/projects\` | Create a project |
| \`DELETE /api/projects/:id\` | Delete a project |
| \`GET /api/search?q=...\` | Full-text search |
`;

export function DocsPage() {
  const [activeSection, setActiveSection] = React.useState<string>("getting-started");
  const [pageCopied, setPageCopied] = React.useState(false);

  function handleCopyPage() {
    navigator.clipboard.writeText(DOCS_MARKDOWN).then(() => {
      setPageCopied(true);
      setTimeout(() => setPageCopied(false), 2000);
    });
  }

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="flex gap-10">
      {/* Sticky sidebar nav */}
      <nav className="hidden lg:block w-48 shrink-0">
        <div className="sticky top-20 space-y-1">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            On this page
          </p>
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => scrollTo(section.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  activeSection === section.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <div className="min-w-0 flex-1 max-w-3xl space-y-12 pb-20">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Docs</h2>
          <button
            onClick={handleCopyPage}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {pageCopied ? (
              <>
                <CheckIcon className="size-3.5 text-green-500" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="size-3.5" />
                Copy page
              </>
            )}
          </button>
        </div>

        {/* Getting Started */}
        <section id="getting-started" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950">
              <RocketIcon className="size-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold">Getting Started</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Install globally with Bun or npm, then launch the dashboard or use
            the CLI directly.
          </p>
          <CodeBlock>{`bun add -g @hasna/todos

# Launch the web dashboard
todos serve

# Or use the CLI
todos add "My first task"
todos list`}</CodeBlock>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4 space-y-1">
              <p className="text-sm font-medium">CLI</p>
              <p className="text-xs text-muted-foreground">
                Full-featured command line interface for task management.
              </p>
            </div>
            <div className="rounded-lg border p-4 space-y-1">
              <p className="text-sm font-medium">MCP Server</p>
              <p className="text-xs text-muted-foreground">
                Let AI agents manage tasks through natural language.
              </p>
            </div>
            <div className="rounded-lg border p-4 space-y-1">
              <p className="text-sm font-medium">Web Dashboard</p>
              <p className="text-xs text-muted-foreground">
                Visual interface with tables, filters, and bulk actions.
              </p>
            </div>
          </div>
        </section>

        {/* CLI Commands */}
        <section id="cli" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950">
              <TerminalIcon className="size-4 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">CLI Commands</h3>
          </div>

          <div className="space-y-6">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Task Management
              </p>
              <CommandTable
                headers={["Command", "Description"]}
                rows={[
                  ["todos add <title>", "Create a new task"],
                  ["todos list", "List tasks with optional filters"],
                  ["todos show <id>", "Show full task details"],
                  ["todos update <id>", "Update task fields"],
                  ["todos start <id>", "Start a task (set to in_progress)"],
                  ["todos done <id>", "Mark a task as completed"],
                  ["todos delete <id>", "Delete a task"],
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Organization
              </p>
              <CommandTable
                headers={["Command", "Description"]}
                rows={[
                  ["todos projects", "List and manage projects"],
                  ["todos plans", "List and manage plans"],
                  ["todos search <query>", "Full-text search across tasks"],
                  ["todos deps <id>", "Manage task dependencies"],
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Infrastructure
              </p>
              <CommandTable
                headers={["Command", "Description"]}
                rows={[
                  ["todos serve", "Launch the web dashboard"],
                  ["todos mcp", "Start the MCP server"],
                  ["todos sync", "Sync with agent task lists"],
                  ["todos hooks install", "Install Claude Code hooks"],
                  ["todos export", "Export tasks as JSON or Markdown"],
                  ["todos upgrade", "Self-update to latest version"],
                ]}
              />
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="plans" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-950">
              <LayoutListIcon className="size-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold">Plans</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Plans are a first-class entity for organizing related tasks. A
            project can have many plans, and each task can optionally belong to
            one plan.
          </p>
          <CodeBlock>{`# List plans
todos plans

# Create a plan
todos plans --add "Sprint 1" --description "First sprint"

# Show plan details with its tasks
todos plans --show <id>

# Complete a plan
todos plans --complete <id>

# Create a task in a plan
todos add "Implement feature" --plan <plan-id>`}</CodeBlock>
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-medium">Plan Statuses</p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                active
              </span>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                completed
              </span>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                archived
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Deleting a plan orphans its tasks &mdash; they remain but lose the
              plan association.
            </p>
          </div>
        </section>

        {/* MCP Integration */}
        <section id="mcp" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950">
              <PuzzleIcon className="size-4 text-orange-600 dark:text-orange-400" />
            </div>
            <h3 className="text-lg font-semibold">MCP Integration</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Register the MCP server with Claude Code or other MCP-compatible
            clients to manage tasks through natural language.
          </p>
          <CodeBlock>{`# Register with Claude Code
todos mcp --register claude

# Register with all supported agents
todos mcp --register all

# Or add manually to your MCP config
{
  "mcpServers": {
    "todos": {
      "command": "todos-mcp",
      "args": []
    }
  }
}`}</CodeBlock>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Available MCP Tools
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "create_task",
                "list_tasks",
                "get_task",
                "update_task",
                "delete_task",
                "start_task",
                "complete_task",
                "search_tasks",
                "create_plan",
                "list_plans",
                "get_plan",
                "update_plan",
                "delete_plan",
                "list_projects",
                "create_project",
                "sync",
              ].map((tool) => (
                <code
                  key={tool}
                  className="rounded bg-muted px-2 py-0.5 text-xs font-medium"
                >
                  {tool}
                </code>
              ))}
            </div>
          </div>
        </section>

        {/* Sync */}
        <section id="sync" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-950">
              <RefreshCwIcon className="size-4 text-teal-600 dark:text-teal-400" />
            </div>
            <h3 className="text-lg font-semibold">Sync</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sync bridges Hasna Todos with Claude Code&apos;s built-in task list.
            Tasks are bidirectionally synchronized between the two systems.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium">How it works</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  Tasks matched by title between local DB and Claude Code
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  New tasks in either system are created in the other
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  Status changes propagated bidirectionally
                </li>
              </ul>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium">Configuration</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  Link projects to task lists via{" "}
                  <code className="rounded bg-muted px-1 text-[10px]">task_list_id</code>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  Auto-detects Claude Code session ID
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  Install hooks for automatic sync on tool use
                </li>
              </ul>
            </div>
          </div>
          <CodeBlock>{`# Bidirectional sync (default)
todos sync

# One-way sync
todos sync --push    # SQLite -> agent
todos sync --pull    # agent -> SQLite

# Sync all agents
todos sync --all`}</CodeBlock>
        </section>

        {/* API */}
        <section id="api" className="scroll-mt-20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-950">
              <ServerIcon className="size-4 text-rose-600 dark:text-rose-400" />
            </div>
            <h3 className="text-lg font-semibold">REST API</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              todos serve
            </code>{" "}
            command starts an HTTP server with a REST API that powers the
            dashboard. You can also call it directly.
          </p>

          <div className="space-y-6">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Tasks
              </p>
              <CommandTable
                headers={["Endpoint", "Description"]}
                rows={[
                  ["GET /api/tasks", "List all tasks"],
                  ["POST /api/tasks", "Create a task"],
                  ["GET /api/tasks/:id", "Get task details with relations"],
                  ["PATCH /api/tasks/:id", "Update a task (requires version)"],
                  ["DELETE /api/tasks/:id", "Delete a task"],
                  ["POST /api/tasks/:id/start", "Start a task"],
                  ["POST /api/tasks/:id/complete", "Complete a task"],
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Plans
              </p>
              <CommandTable
                headers={["Endpoint", "Description"]}
                rows={[
                  ["GET /api/plans", "List plans (optional ?project_id=)"],
                  ["POST /api/plans", "Create a plan"],
                  ["GET /api/plans/:id", "Get plan details"],
                  ["PATCH /api/plans/:id", "Update a plan"],
                  ["DELETE /api/plans/:id", "Delete a plan"],
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Projects & Search
              </p>
              <CommandTable
                headers={["Endpoint", "Description"]}
                rows={[
                  ["GET /api/projects", "List projects"],
                  ["POST /api/projects", "Create a project"],
                  ["DELETE /api/projects/:id", "Delete a project"],
                  ["GET /api/search?q=...", "Full-text search"],
                ]}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
