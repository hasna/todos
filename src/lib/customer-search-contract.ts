import {
  TODOS_REQUEST_SCHEMA_IDS,
  TODOS_REQUEST_SCHEMAS,
  TodosSavedViewSchema,
  TodosSearchRequestSchema,
  TodosTaskSchema,
  type TodosSavedView,
  type TodosSearchRequest,
  type TodosTask,
} from "@hasna/contracts/todos";
import { createHash, randomUUID } from "node:crypto";
import { redactEvidenceText } from "./redaction.js";
import type { Task } from "../types/index.js";

export type CustomerSearchRequest = TodosSearchRequest;
export type CustomerSavedView = TodosSavedView;
export type CustomerTask = TodosTask;

export interface CustomerTaskPage {
  items: CustomerTask[];
  count: number;
  nextCursor: string | null;
}

export interface CustomerSavedViewPage {
  items: CustomerSavedView[];
  count: number;
  nextCursor: string | null;
}

export interface CustomerSavedViewCreateInput {
  name: string;
  description: string | null;
  query: CustomerSearchRequest;
  audience: "private" | "organization";
}

export interface CustomerSavedViewUpdateInput {
  ref: string;
  expectedVersion: number;
  name?: string;
  description?: string | null;
  query?: CustomerSearchRequest;
  audience?: "private" | "organization";
}

export interface CustomerSavedViewExecuteInput {
  ref: string;
  cursor: string | null;
  limit: number;
}

export interface CustomerSavedViewListInput {
  cursor: string | null;
  limit: number;
  projectId: string | null;
  taskListId: string | null;
  planId: string | null;
  agentId: string | null;
  status: string | null;
  changedAfter: string | null;
}

export interface CustomerSearchDataset {
  tasks: Task[];
  documents: ReadonlyMap<string, readonly unknown[]>;
}

const EMPTY_FILTERS: CustomerSearchRequest["filters"] = {
  projectIds: [],
  taskListIds: [],
  planIds: [],
  agentIds: [],
  statuses: [],
  priorities: [],
  tags: [],
  changedAfter: null,
  dueBefore: null,
};

export function buildCustomerSearchRequest(
  query: string,
  input: Partial<Omit<CustomerSearchRequest, "query" | "filters">> & {
    filters?: Partial<CustomerSearchRequest["filters"]>;
  } = {},
): CustomerSearchRequest {
  return parseCustomerSearchRequest({
    query,
    filters: { ...EMPTY_FILTERS, ...(input.filters ?? {}) },
    cursor: input.cursor ?? null,
    limit: input.limit ?? 100,
  });
}

export function parseCustomerSearchRequest(value: unknown): CustomerSearchRequest {
  return TodosSearchRequestSchema.parse(value);
}

export function parseCustomerSavedViewCreate(value: unknown): CustomerSavedViewCreateInput {
  return TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.savedViewCreate].parse(value) as CustomerSavedViewCreateInput;
}

export function parseCustomerSavedViewUpdate(value: unknown): CustomerSavedViewUpdateInput {
  return TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.savedViewUpdate].parse(value) as CustomerSavedViewUpdateInput;
}

export function parseCustomerSavedViewExecute(value: unknown): CustomerSavedViewExecuteInput {
  return TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.savedViewExecute].parse(value) as CustomerSavedViewExecuteInput;
}

export function parseCustomerSavedViewList(value: unknown): CustomerSavedViewListInput {
  return TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.list].parse(value) as CustomerSavedViewListInput;
}

export function parseCustomerSavedView(value: unknown): CustomerSavedView {
  return TodosSavedViewSchema.parse(value);
}

export function parseCustomerTask(value: unknown): CustomerTask {
  return TodosTaskSchema.parse(value);
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.valueOf())) throw new Error(`Invalid persisted date: ${value}`);
  return date.toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function externalOwnerRefs(value: unknown): CustomerTask["externalOwnerRefs"] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CustomerTask["externalOwnerRefs"][number] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const ref = item as Record<string, unknown>;
    return typeof ref.owner === "string" && /^[a-z][a-z0-9.-]*$/.test(ref.owner) &&
      typeof ref.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref.id) &&
      typeof ref.digest === "string" && /^[a-f0-9]{64}$/.test(ref.digest);
  });
}

export function toCustomerTask(task: Task): CustomerTask {
  const acceptanceCriteria = stringArray(
    task.metadata?.acceptanceCriteria ?? task.metadata?.acceptance_criteria,
  );
  const fingerprint = typeof task.metadata?.fingerprint === "string" && task.metadata.fingerprint
    ? task.metadata.fingerprint
    : null;
  return parseCustomerTask({
    id: task.id,
    owner: "todos",
    version: Math.max(1, task.version || 1),
    createdAt: isoDate(task.created_at)!,
    updatedAt: isoDate(task.updated_at)!,
    shortId: task.short_id,
    title: task.title,
    description: task.description === null ? null : redactEvidenceText(task.description),
    status: task.status,
    priority: task.priority,
    projectId: task.project_id,
    taskListId: task.task_list_id,
    planId: task.plan_id,
    parentTaskId: task.parent_id,
    assignedAgentId: task.assigned_to ?? task.agent_id,
    fingerprint,
    tags: task.tags,
    acceptanceCriteria,
    dueAt: isoDate(task.due_at),
    completedAt: isoDate(task.completed_at),
    externalOwnerRefs: externalOwnerRefs(task.metadata?.externalOwnerRefs ?? task.metadata?.external_owner_refs),
  });
}

function cursorOffset(cursor: string | null, namespace: string): number {
  if (cursor === null) return 0;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid cursor");
  }
  const match = decoded.match(new RegExp(`^${namespace}:(\\d+)$`));
  if (!match) throw new Error("Invalid cursor");
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid cursor");
  return offset;
}

export function encodeCustomerCursor(offset: number, namespace: "search" | "saved-views"): string {
  return Buffer.from(`${namespace}:${offset}`, "utf8").toString("base64url");
}

function searchableText(value: unknown): string {
  try {
    return JSON.stringify(value).toLocaleLowerCase();
  } catch {
    return String(value).toLocaleLowerCase();
  }
}

function matchesQuery(query: string, values: readonly unknown[]): boolean {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  const text = values.map(searchableText).join("\n");
  return terms.every((term) => text.includes(term));
}

function matchesFilters(task: Task, request: CustomerSearchRequest): boolean {
  const filters = request.filters;
  if (filters.statuses.some((status) => status === "ready" || status === "blocked")) {
    throw new Error("Unsupported search predicate: statuses ready and blocked are derived states not persisted by this Todos store");
  }
  if (filters.projectIds.length > 0 && (!task.project_id || !filters.projectIds.includes(task.project_id))) return false;
  if (filters.taskListIds.length > 0 && (!task.task_list_id || !filters.taskListIds.includes(task.task_list_id))) return false;
  if (filters.planIds.length > 0 && (!task.plan_id || !filters.planIds.includes(task.plan_id))) return false;
  if (filters.agentIds.length > 0 && !filters.agentIds.some((id) => id === task.agent_id || id === task.assigned_to)) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
  if (filters.tags.length > 0 && !filters.tags.every((tag) => task.tags.includes(tag))) return false;
  if (filters.changedAfter && Date.parse(task.updated_at) <= Date.parse(filters.changedAfter)) return false;
  if (filters.dueBefore && (!task.due_at || Date.parse(task.due_at) >= Date.parse(filters.dueBefore))) return false;
  return true;
}

export function executeCustomerSearchDataset(
  rawRequest: unknown,
  dataset: CustomerSearchDataset,
): CustomerTaskPage {
  const request = parseCustomerSearchRequest(rawRequest);
  const matches = dataset.tasks
    .filter((task) => matchesFilters(task, request))
    .filter((task) => matchesQuery(request.query, [task, ...(dataset.documents.get(task.id) ?? [])]))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id));
  const offset = cursorOffset(request.cursor, "search");
  const page = matches.slice(offset, offset + request.limit);
  const nextOffset = offset + page.length;
  return {
    items: page.map(toCustomerTask),
    count: page.length,
    nextCursor: nextOffset < matches.length ? encodeCustomerCursor(nextOffset, "search") : null,
  };
}

export function paginateCustomerSavedViews(
  views: CustomerSavedView[],
  input: CustomerSavedViewListInput,
): CustomerSavedViewPage {
  let filtered = views;
  if (input.projectId) filtered = filtered.filter((view) => view.query.filters.projectIds.includes(input.projectId!));
  if (input.taskListId) filtered = filtered.filter((view) => view.query.filters.taskListIds.includes(input.taskListId!));
  if (input.planId) filtered = filtered.filter((view) => view.query.filters.planIds.includes(input.planId!));
  if (input.agentId) filtered = filtered.filter((view) => view.query.filters.agentIds.includes(input.agentId!));
  if (input.status) filtered = filtered.filter((view) => view.query.filters.statuses.includes(input.status as never));
  if (input.changedAfter) filtered = filtered.filter((view) => Date.parse(view.updatedAt) > Date.parse(input.changedAfter!));
  filtered = [...filtered].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const offset = cursorOffset(input.cursor, "saved-views");
  const items = filtered.slice(offset, offset + input.limit);
  const nextOffset = offset + items.length;
  return {
    items,
    count: items.length,
    nextCursor: nextOffset < filtered.length ? encodeCustomerCursor(nextOffset, "saved-views") : null,
  };
}

export function customerSavedViewOwner(tenantId?: string): string {
  if (!tenantId) return "local";
  return `tenant-${createHash("sha256").update(tenantId).digest("hex").slice(0, 32)}`;
}

export function newCustomerSavedView(
  input: CustomerSavedViewCreateInput,
  owner = "local",
  now = new Date().toISOString(),
): CustomerSavedView {
  return parseCustomerSavedView({
    id: randomUUID(),
    owner,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...input,
  });
}

export function customerRequestId(): string {
  return `req-${randomUUID()}`;
}
