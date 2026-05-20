import { z } from "zod";
import { listLocalEvents, localEventsToJsonl } from "../../db/events.js";

export function registerEventTools(server: any, ctx: { shouldRegisterTool: (name: string) => boolean }) {
  const { shouldRegisterTool } = ctx;

  const filterSchema = {
    since_sequence: z.number().optional().describe("Only include events after this sequence number"),
    after: z.string().optional().describe("Only include events after this ISO timestamp"),
    event_type: z.string().optional().describe("Filter by event type, e.g. task.created"),
    entity_type: z.string().optional().describe("Filter by entity type, e.g. task, plan, run"),
    entity_id: z.string().optional().describe("Filter by entity ID"),
    task_id: z.string().optional().describe("Filter by task ID"),
    project_id: z.string().optional().describe("Filter by project ID"),
    plan_id: z.string().optional().describe("Filter by plan ID"),
    agent_id: z.string().optional().describe("Filter by agent ID"),
    limit: z.number().optional().describe("Maximum events to return (default 50, max 1000)"),
  };

  if (shouldRegisterTool("list_events")) {
    server.tool(
      "list_events",
      "List local append-only events as structured JSON. Events are stored locally and never require hosted infrastructure.",
      filterSchema,
      async (params: any) => {
        const events = listLocalEvents(params);
        return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
      },
    );
  }

  if (shouldRegisterTool("tail_events")) {
    server.tool(
      "tail_events",
      "Return local append-only events as newline-delimited JSON for agent tailing. Pass since_sequence repeatedly to avoid polling full state.",
      filterSchema,
      async (params: any) => {
        const events = listLocalEvents(params);
        const text = localEventsToJsonl(events);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }
}
