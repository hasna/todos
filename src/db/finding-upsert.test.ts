import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listComments } from "./comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { upsertFinding } from "./finding-upsert.js";
import { createProject } from "./projects.js";
import { getTask } from "./tasks.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("finding issue-task upsert", () => {
  test("creates one task, updates it, and appends each evidence item once", () => {
    const db = getDatabase();
    const first = upsertFinding({
      fingerprint: "health:database:latency",
      title: "Database latency is high",
      body: "p95 exceeded the threshold",
      evidence: "p95=850ms",
      severity: "high",
      tags: ["health", "database"],
      source: "health-scan",
    }, db);

    expect(first).toMatchObject({
      schema_version: "todos.finding_upsert.v1",
      action: "created",
      evidence_action: "appended",
      finding: {
        fingerprint: "health:database:latency",
        status: "pending",
        finding_status: "open",
        severity: "high",
        priority: "high",
        tags: ["health", "database"],
      },
    });
    expect(listComments(first.finding.id, db).map((comment) => comment.content)).toEqual(["p95=850ms"]);

    const matchedEvidence = upsertFinding({
      fingerprint: "health:database:latency",
      title: "Database latency remains high",
      evidence: "p95=850ms",
      status: "open",
    }, db);
    expect(matchedEvidence.action).toBe("updated");
    expect(matchedEvidence.evidence_action).toBe("matched");
    expect(matchedEvidence.finding.id).toBe(first.finding.id);
    expect(listComments(first.finding.id, db)).toHaveLength(1);

    const newEvidence = upsertFinding({
      fingerprint: "health:database:latency",
      title: "Database latency remains high",
      evidence: "p95=910ms",
      evidence_fingerprint: "run-2",
    }, db);
    expect(newEvidence.evidence_action).toBe("appended");
    expect(listComments(first.finding.id, db).map((comment) => comment.content)).toEqual(["p95=850ms", "p95=910ms"]);
    expect(getTask(first.finding.id, db)?.metadata).toMatchObject({
      finding_fingerprint: "health:database:latency",
      finding_source: "health-scan",
      finding_evidence_fingerprints: expect.any(Array),
    });
  });

  test("scopes the same caller fingerprint by project", () => {
    const db = getDatabase();
    const firstProject = createProject({ name: "First", path: "/tmp/first" }, db);
    const secondProject = createProject({ name: "Second", path: "/tmp/second" }, db);

    const first = upsertFinding({ fingerprint: "secret:token", title: "Token found", project_id: firstProject.id }, db);
    const second = upsertFinding({ fingerprint: "secret:token", title: "Token found", project_id: secondProject.id }, db);
    const firstAgain = upsertFinding({ fingerprint: "secret:token", title: "Token still found", project_id: firstProject.id }, db);

    expect(first.finding.id).not.toBe(second.finding.id);
    expect(firstAgain.finding.id).toBe(first.finding.id);
    expect(first.finding.project_id).toBe(firstProject.id);
    expect(second.finding.project_id).toBe(secondProject.id);
  });

  test("preserves active open work and maps terminal finding statuses", () => {
    const db = getDatabase();
    const created = upsertFinding({ fingerprint: "pr:routing", title: "PR needs routing" }, db);
    db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ?", [created.finding.id]);

    const observedAgain = upsertFinding({ fingerprint: "pr:routing", title: "PR still needs routing", status: "open" }, db);
    expect(observedAgain.finding.status).toBe("in_progress");

    const ignored = upsertFinding({ fingerprint: "pr:routing", title: "PR routing exception", status: "ignored" }, db);
    expect(ignored.finding.status).toBe("cancelled");

    const reopened = upsertFinding({ fingerprint: "pr:routing", title: "PR needs routing again", status: "open" }, db);
    expect(reopened.finding.status).toBe("pending");
  });
});
