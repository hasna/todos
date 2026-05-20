import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import { listLocalEvents, localEventsToJsonl, type LocalEventFilter } from "../../db/events.js";

function buildFilter(opts: any): LocalEventFilter {
  return {
    since_sequence: opts.sinceSequence ? Number(opts.sinceSequence) : undefined,
    after: opts.after,
    event_type: opts.type,
    entity_type: opts.entity,
    entity_id: opts.entityId,
    task_id: opts.task,
    project_id: opts.project,
    plan_id: opts.plan,
    agent_id: opts.agent,
    limit: opts.limit ? Number(opts.limit) : undefined,
  };
}

function printHuman(events: ReturnType<typeof listLocalEvents>): void {
  if (events.length === 0) {
    console.log(chalk.dim("No local events."));
    return;
  }
  for (const event of events) {
    const entity = event.entity_id ? `${event.entity_type}:${event.entity_id.slice(0, 8)}` : event.entity_type;
    console.log(`${chalk.dim(String(event.sequence).padStart(5))} ${chalk.cyan(event.event_type.padEnd(24))} ${entity} ${chalk.dim(event.created_at)}`);
  }
}

export function registerEventCommands(program: Command) {
  program
    .command("events")
    .description("List or tail the append-only local JSONL event stream")
    .option("--since-sequence <n>", "Only include events after this sequence number")
    .option("--after <iso>", "Only include events after this ISO timestamp")
    .option("--type <event>", "Filter by event type, e.g. task.created")
    .option("--entity <type>", "Filter by entity type, e.g. task, plan, run")
    .option("--entity-id <id>", "Filter by entity ID")
    .option("--task <id>", "Filter by task ID")
    .option("--project <id>", "Filter by project ID")
    .option("--plan <id>", "Filter by plan ID")
    .option("--agent <id>", "Filter by agent ID")
    .option("--limit <n>", "Maximum events to return (default: 50, max: 1000)")
    .option("--jsonl", "Output newline-delimited JSON events")
    .option("-j, --json", "Output JSON array")
    .option("--follow", "Poll and print new events until interrupted")
    .option("--interval-ms <n>", "Follow polling interval in ms (default: 1000)", "1000")
    .action(async (opts) => {
      getDatabase();
      let filter = buildFilter(opts);
      let events = listLocalEvents(filter);

      if (opts.jsonl) {
        const text = localEventsToJsonl(events);
        if (text) console.log(text);
      } else if (opts.json) {
        console.log(JSON.stringify(events, null, 2));
      } else {
        printHuman(events);
      }

      if (!opts.follow) return;

      let lastSequence = events.at(-1)?.sequence ?? filter.since_sequence ?? 0;
      const interval = Math.max(Number(opts.intervalMs) || 1000, 100);
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        filter = { ...filter, since_sequence: lastSequence, limit: opts.limit ? Number(opts.limit) : 100 };
        events = listLocalEvents(filter);
        if (events.length === 0) continue;
        lastSequence = events.at(-1)!.sequence;
        if (opts.json || opts.jsonl) {
          const text = localEventsToJsonl(events);
          if (text) console.log(text);
        } else {
          printHuman(events);
        }
      }
    });
}
