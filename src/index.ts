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
  slugify,
} from "./db/projects.js";

// Plans
export {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "./db/plans.js";

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

// API Keys
export {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  validateApiKey,
  hasAnyApiKeys,
} from "./db/api-keys.js";

// Search
export { searchTasks } from "./lib/search.js";

// Sync
export { defaultSyncAgents, syncWithAgent, syncWithAgents } from "./lib/sync.js";
export type { SyncResult } from "./lib/sync-types.js";

// Config
export { loadConfig } from "./lib/config.js";
export type { TodosConfig, AgentConfig } from "./lib/config.js";

// Audit
export { logAudit, getAuditLog } from "./db/audit.js";
export type { AuditEntry } from "./db/audit.js";

// Webhooks
export {
  createWebhook,
  getWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchWebhooks,
} from "./db/webhooks.js";
export type { Webhook, CreateWebhookInput } from "./db/webhooks.js";

// Billing
export {
  getOrCreateCustomer,
  updateCustomer,
  getCustomerByStripeId,
  getUsage,
  trackUsage,
  PLAN_LIMITS,
  PLAN_PRICES,
} from "./db/billing.js";
export type { BillingCustomer, UsageRecord } from "./db/billing.js";

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
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  PlanStatus,
  Session,
  CreateSessionInput,
  ApiKey,
  ApiKeyWithSecret,
  CreateApiKeyInput,
  LockResult,
  TaskRow,
  SessionRow,
} from "./types/index.js";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  PLAN_STATUSES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  DependencyCycleError,
} from "./types/index.js";
