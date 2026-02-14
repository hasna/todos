# @hasna/todos - Development Guide

## Quick Start

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun run typecheck    # TypeScript type checking
bun run dev:cli      # Run CLI in dev mode
bun run dev:mcp      # Run MCP server in dev mode
```

## Architecture

- `src/types/` - TypeScript types and error classes
- `src/db/` - SQLite data layer (database.ts, tasks.ts, projects.ts, comments.ts, sessions.ts)
- `src/lib/` - Business logic (search.ts)
- `src/cli/` - Commander CLI + Ink TUI components
- `src/mcp/` - MCP server (stdio transport)
- `src/index.ts` - Library exports for external consumers

## Key Patterns

- **Database**: bun:sqlite with WAL mode, optimistic locking via version column
- **Partial IDs**: CLI accepts first 8+ chars of UUID
- **Lock expiry**: 30 minutes, auto-expired on next access
- **JSON fields**: tags (array) and metadata (object) stored as JSON strings in SQLite
- **Error handling**: Custom error classes (VersionConflictError, TaskNotFoundError, LockError, etc.)

## Testing

Tests use in-memory SQLite databases (`TODOS_DB_PATH=:memory:`) for isolation.
CLI integration tests spawn subprocesses with temp DB files.

```bash
bun test                          # All tests
bun test src/db/tasks.test.ts     # Task CRUD + locking tests
bun test src/db/projects.test.ts  # Project tests
bun test src/mcp/mcp.test.ts      # MCP operation tests
bun test src/cli/cli.test.ts      # CLI integration tests
```

## DB Location

1. `TODOS_DB_PATH` env var (override)
2. `.todos/todos.db` in cwd (per-project)
3. `~/.todos/todos.db` (global default)
