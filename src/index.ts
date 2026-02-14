// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId } from "./db/database.js";

// Tasks
export {
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
  getTaskDependencies,
  getTaskDependents,
} from "./db/tasks.js";

// Projects
export {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
} from "./db/projects.js";

// Comments
export {
  addComment,
  getComment,
  listComments,
  deleteComment,
} from "./db/comments.js";

// Sessions
export {
  createSession,
  getSession,
  listSessions,
  updateSessionActivity,
  deleteSession,
} from "./db/sessions.js";

// Search
export { searchTasks } from "./lib/search.js";

// Types
export type {
  Task,
  TaskWithRelations,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
  TaskPriority,
  TaskDependency,
  TaskComment,
  CreateCommentInput,
  Project,
  CreateProjectInput,
  Session,
  CreateSessionInput,
  LockResult,
  TaskRow,
  SessionRow,
} from "./types/index.js";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  LockError,
  DependencyCycleError,
} from "./types/index.js";
