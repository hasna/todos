import {
  PrGroupLedgerError,
  type AdmitPrGroupInput,
  type AppendPrGroupEventInput,
  type PrGroupEventListOptions,
  type PrGroupEventPage,
  type PrGroupLedgerErrorCode,
  type PrGroupMutationResult,
  type PrGroupStateView,
  type RecoverPrGroupInput,
} from "./types.js";

export interface PrGroupHttpClientOptions {
  baseUrl: string;
  apiPrefix?: "/api/pr-groups" | "/v1/pr-groups";
  apiKey?: string;
  expectedAuthority?: "local" | "remote";
  fetchImpl?: typeof fetch;
}

const LEDGER_CODES = new Set<PrGroupLedgerErrorCode>([
  "PR_GROUP_INVALID_INPUT",
  "PR_GROUP_NOT_FOUND",
  "PR_GROUP_IDENTITY_CONFLICT",
  "PR_GROUP_WRITER_FENCED",
  "PR_GROUP_TERMINAL",
  "PR_GROUP_INVALID_TRANSITION",
  "PR_GROUP_RECEIPT_REPLAY",
  "PR_GROUP_EXACT_HEAD_REQUIRED",
  "PR_GROUP_REVIEW_REQUIRED",
  "PR_GROUP_MERGE_RECEIPT_REQUIRED",
  "PR_GROUP_CLEANUP_BLOCKED",
  "PR_GROUP_ATOMICITY_UNAVAILABLE",
  "PR_GROUP_REMOTE_INVALID_RESPONSE",
  "PR_GROUP_REMOTE_UNAVAILABLE",
]);

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "PR-group API baseUrl must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "PR-group API baseUrl must not contain credentials, query, or fragment");
  }
  return url.origin;
}

function assertAuthoritative<T extends { authoritative: true; authority: "local" | "remote" }>(
  value: unknown,
  expectedAuthority: "local" | "remote" | undefined,
  route: string,
): T {
  if (!value || typeof value !== "object" ||
      (value as { authoritative?: unknown }).authoritative !== true ||
      !["local", "remote"].includes(String((value as { authority?: unknown }).authority))) {
    throw new PrGroupLedgerError(
      "PR_GROUP_REMOTE_INVALID_RESPONSE",
      "authoritative PR-group response envelope is missing",
      { route },
    );
  }
  const result = value as T;
  if (expectedAuthority && result.authority !== expectedAuthority) {
    throw new PrGroupLedgerError(
      "PR_GROUP_REMOTE_INVALID_RESPONSE",
      `PR-group authority mismatch: expected ${expectedAuthority}, received ${result.authority}`,
      { route },
    );
  }
  return result;
}

function assertMutationIdentity(
  value: PrGroupMutationResult,
  expectedGroupId: string | undefined,
  expectedAttemptId: string | undefined,
  expectedAuthority: "local" | "remote" | undefined,
  route: string,
): PrGroupMutationResult {
  const view = assertAuthoritative<PrGroupStateView>(value?.view, expectedAuthority, route);
  const event = value?.event;
  const groupId = view.group?.id;
  if (typeof groupId !== "string" ||
      !event || typeof event !== "object" ||
      event.group_id !== groupId ||
      (expectedGroupId !== undefined && groupId !== expectedGroupId) ||
      (expectedAttemptId !== undefined && event.attempt_id !== expectedAttemptId) ||
      !view.attempts.some((attempt) => attempt.id === event.attempt_id)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_REMOTE_INVALID_RESPONSE",
      "authoritative PR-group mutation response has inconsistent lineage identity",
      { route, requested_group_id: expectedGroupId ?? null },
    );
  }
  return value;
}

export class PrGroupHttpClient {
  private readonly baseUrl: string;
  private readonly prefix: "/api/pr-groups" | "/v1/pr-groups";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PrGroupHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.prefix = options.apiPrefix ?? "/api/pr-groups";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const route = `${this.prefix}${path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.apiKey) headers["x-api-key"] = this.options.apiKey;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method,
        headers,
        redirect: "manual",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_UNAVAILABLE",
        "authoritative PR-group API could not be reached; local fallback is disabled",
        { route, cause: cause instanceof Error ? cause.name : "unknown" },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_INVALID_RESPONSE",
        "authoritative PR-group API returned non-JSON data; local fallback is disabled",
        { route, status: response.status },
      );
    }
    if (!response.ok) {
      const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const code = typeof envelope["code"] === "string" && LEDGER_CODES.has(envelope["code"] as PrGroupLedgerErrorCode)
        ? envelope["code"] as PrGroupLedgerErrorCode
        : "PR_GROUP_REMOTE_UNAVAILABLE";
      throw new PrGroupLedgerError(
        code,
        typeof envelope["error"] === "string" ? envelope["error"] : `authoritative PR-group API returned HTTP ${response.status}`,
        { route, status: response.status, partial: envelope["details"] ?? null },
      );
    }
    return payload as T;
  }

  async admit(input: AdmitPrGroupInput): Promise<PrGroupMutationResult> {
    const result = await this.request<PrGroupMutationResult>("POST", "/admit", input);
    return assertMutationIdentity(
      result,
      undefined,
      undefined,
      this.options.expectedAuthority,
      "/admit",
    );
  }

  async recover(input: RecoverPrGroupInput): Promise<PrGroupMutationResult> {
    const result = await this.request<PrGroupMutationResult>(
      "POST",
      `/${encodeURIComponent(input.group_id)}/recover`,
      input,
    );
    return assertMutationIdentity(
      result,
      input.group_id,
      undefined,
      this.options.expectedAuthority,
      "/recover",
    );
  }

  async append(input: AppendPrGroupEventInput): Promise<PrGroupMutationResult> {
    const result = await this.request<PrGroupMutationResult>(
      "POST",
      `/${encodeURIComponent(input.group_id)}/events`,
      input,
    );
    return assertMutationIdentity(
      result,
      input.group_id,
      input.attempt_id,
      this.options.expectedAuthority,
      "/events",
    );
  }

  async get(groupId: string): Promise<PrGroupStateView> {
    const payload = await this.request<{ view: PrGroupStateView }>(
      "GET",
      `/${encodeURIComponent(groupId)}`,
    );
    const view = assertAuthoritative<PrGroupStateView>(
      payload?.view,
      this.options.expectedAuthority,
      `/${groupId}`,
    );
    if (view.group?.id !== groupId) {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_INVALID_RESPONSE",
        "authoritative PR-group response identity does not match the requested group",
        { requested_group_id: groupId },
      );
    }
    return view;
  }

  async events(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventPage> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.after_sequence !== undefined) query.set("after_sequence", String(options.after_sequence));
    const suffix = query.size ? `?${query}` : "";
    const payload = await this.request<{ history: PrGroupEventPage }>(
      "GET",
      `/${encodeURIComponent(groupId)}/events${suffix}`,
    );
    const history = assertAuthoritative<PrGroupEventPage>(
      payload?.history,
      this.options.expectedAuthority,
      `/${groupId}/events`,
    );
    if (!Array.isArray(history.events) || typeof history.count !== "number" || history.count !== history.events.length) {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_INVALID_RESPONSE",
        "authoritative PR-group history is incomplete",
        { group_id: groupId },
      );
    }
    if (history.group_id !== groupId) {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_INVALID_RESPONSE",
        "authoritative PR-group history identity does not match the requested group",
        { requested_group_id: groupId },
      );
    }
    return history;
  }
}
