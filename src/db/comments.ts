import type { Database } from "bun:sqlite";
import type { CreateCommentInput, TaskComment } from "../types/index.js";
import { TaskNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { recordLocalEvent } from "./events.js";
import { getTask } from "./tasks.js";

export function addComment(
  input: CreateCommentInput,
  db?: Database,
): TaskComment {
  const d = db || getDatabase();

  // Verify task exists
  const task = getTask(input.task_id, d);
  if (!task) {
    throw new TaskNotFoundError(input.task_id);
  }

  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO task_comments (id, task_id, agent_id, session_id, content, type, progress_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id,
      input.agent_id || null,
      input.session_id || null,
      input.content,
      input.type || 'comment',
      input.progress_pct ?? null,
      timestamp,
    ],
  );

  const comment = getComment(id, d)!;
  recordLocalEvent({
    event_type: `comment.${comment.type}.created`,
    entity_type: "comment",
    entity_id: comment.id,
    task_id: comment.task_id,
    project_id: task.project_id,
    plan_id: task.plan_id,
    agent_id: comment.agent_id,
    data: { type: comment.type, progress_pct: comment.progress_pct },
    created_at: timestamp,
  }, d);
  return comment;
}

export function logProgress(
  taskId: string,
  message: string,
  pct?: number,
  agentId?: string,
  db?: Database,
): TaskComment {
  return addComment({ task_id: taskId, content: message, type: 'progress', progress_pct: pct, agent_id: agentId }, db);
}

export function getComment(id: string, db?: Database): TaskComment | null {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_comments WHERE id = ?")
    .get(id) as TaskComment | null;
}

export function listComments(taskId: string, db?: Database): TaskComment[] {
  const d = db || getDatabase();
  return d
    .query(
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at",
    )
    .all(taskId) as TaskComment[];
}

export function updateComment(
  id: string,
  input: { content: string },
  db?: Database,
): TaskComment {
  const d = db || getDatabase();
  d.run("UPDATE task_comments SET content = ? WHERE id = ?", [input.content, id]);
  const comment = getComment(id, d);
  if (!comment) {
    throw new Error(`Comment not found: ${id}`);
  }
  const task = getTask(comment.task_id, d);
  recordLocalEvent({
    event_type: "comment.updated",
    entity_type: "comment",
    entity_id: comment.id,
    task_id: comment.task_id,
    project_id: task?.project_id ?? null,
    plan_id: task?.plan_id ?? null,
    agent_id: comment.agent_id,
    data: { type: comment.type },
  }, d);
  return comment;
}

export function deleteComment(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const comment = getComment(id, d);
  const result = d.run("DELETE FROM task_comments WHERE id = ?", [id]);
  if (result.changes > 0 && comment) {
    const task = getTask(comment.task_id, d);
    recordLocalEvent({
      event_type: "comment.deleted",
      entity_type: "comment",
      entity_id: id,
      task_id: comment.task_id,
      project_id: task?.project_id ?? null,
      plan_id: task?.plan_id ?? null,
      agent_id: comment.agent_id,
      data: { type: comment.type },
    }, d);
  }
  return result.changes > 0;
}
