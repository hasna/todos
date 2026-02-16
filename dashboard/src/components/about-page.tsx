export function AboutPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <h2 className="text-lg font-semibold">About</h2>

      <section className="space-y-4">
        <h3 className="text-2xl font-bold">What is todos.md?</h3>
        <p className="text-muted-foreground leading-relaxed">
          todos.md is a universal task management system built for AI coding agents and developers.
          It provides a unified interface across CLI, MCP server, and web dashboard, all backed
          by a local SQLite database.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Whether you&apos;re using Claude Code, Codex CLI, Gemini CLI, or any MCP-compatible tool,
          todos.md keeps all your tasks synchronized and accessible from every surface.
        </p>
      </section>

      <div className="border-t" />

      <section className="space-y-4">
        <h3 className="text-base font-semibold">Key Features</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Local-first", "SQLite database stored on your machine. No cloud dependency."],
            ["Multi-surface", "CLI, web dashboard, and MCP server share the same data."],
            ["Agent-native", "Built for AI coding agents with locking, versioning, and sync."],
            ["Plans & Projects", "Organize tasks into plans and projects for structured workflows."],
            ["Bidirectional Sync", "Sync tasks with Claude Code, Codex, and Gemini task lists."],
            ["Zero Config", "Works out of the box. Just install and start managing tasks."],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border p-4 space-y-1">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          todos.md is open source and built by{" "}
          <a
            href="https://github.com/hasna"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Hasna
          </a>
          . Contributions are welcome.
        </p>
        <p className="text-sm text-muted-foreground">
          <a
            href="https://github.com/hasna/open-todos"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            View on GitHub
          </a>
        </p>
      </section>
    </div>
  );
}
