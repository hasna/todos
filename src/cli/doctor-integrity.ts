/**
 * `todos doctor` referential-integrity plumbing: how a REMOTE authority's counts
 * are obtained, the exit-code contract, and the shared renderer.
 *
 * Background — the defect this file exists to close: the remote doctor path
 * validated auth and route availability, printed three green check marks, and
 * returned a HARDCODED `ok: true`. Against the live authority that meant a dataset
 * with five figures of orphaned rows reported healthy and exited 0, so every other
 * defect in the same dataset stayed invisible. Two rules follow from that:
 *
 *  - the verdict is computed from the SAME condition rows that get printed;
 *  - a condition that could not be measured is UNVERIFIED, never clean.
 */
import chalk from "chalk";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Project, TaskList } from "../types/index.js";
import {
  adoptRemoteIntegrityReport,
  buildIntegrityReport,
  INTEGRITY_CONDITIONS,
  measureIntegrityRows,
  measuredCondition,
  unverifiedCondition,
  type IntegrityCondition,
  type IntegrityReport,
  type IntegrityRowSets,
  type IntegritySummary,
} from "../lib/integrity.js";
import { cloudGetIntegrityReport, cloudScanTaskRows, type CloudTaskScan } from "./cloud-router.js";

/**
 * `todos doctor` exit-code contract (documented in README and CHANGELOG):
 *
 *   0 — CLEAN: every condition was measured and every count is zero.
 *   1 — FINDINGS: at least one orphan / dangling reference, or an error-severity
 *       schema check. Advisory warnings (stale in_progress tasks, project paths
 *       missing on this machine, duplicate indexes) do NOT trip this.
 *   2 — INCOMPLETE: no findings, but at least one condition could not be measured,
 *       so health was not established. Never reported as clean.
 *
 * Findings dominate: a run with both findings and unverified conditions exits 1
 * and says how many conditions were not checked.
 */
export const DOCTOR_EXIT_CODES = { clean: 0, findings: 1, incomplete: 2 } as const;

export function doctorExitCode(input: { errors: number; findings: number; incomplete: boolean }): 0 | 1 | 2 {
  if (input.findings > 0 || input.errors > 0) return DOCTOR_EXIT_CODES.findings;
  if (input.incomplete) return DOCTOR_EXIT_CODES.incomplete;
  return DOCTOR_EXIT_CODES.clean;
}

export interface RemoteIntegrityOptions {
  /** Projects already fetched for the route check — the registered-id denominator. */
  projects: Project[];
  /** Task lists already fetched for the route check. */
  taskLists: TaskList[];
  /** Opt in to the paged `/v1/tasks` walk when the authority has no aggregate route. */
  scanTasks: boolean;
}

export interface RemoteIntegrityResult {
  integrity: IntegrityReport;
  scan: CloudTaskScan | null;
}

const NO_AGGREGATE_ROUTE =
  "authority exposes no GET /v1/integrity aggregate; re-run with --scan-tasks to derive this count from /v1/tasks";

/**
 * Referential-integrity report for a remote authority, preferring the server-side
 * aggregate and degrading HONESTLY when it is absent.
 *
 *  1. `GET /v1/integrity` — one SQL COUNT per condition, computed by the backing
 *     engine. When present it is the SOLE source for every condition, so the
 *     verdict cannot mix numbers from two different reads of a moving dataset.
 *  2. Otherwise the two task-LIST conditions are derived from the task-list and
 *     project collections doctor already fetches (cheap, exact, and available on
 *     every authority — these are the rows the old code fetched and threw away).
 *  3. The task-level conditions need every task row, which `/v1/tasks` can only
 *     provide by paging (its filters cannot express `IS NULL`). With `--scan-tasks`
 *     they come from a complete read-only walk; without it — or if the walk could
 *     not complete — they are reported as NOT CHECKED.
 */
export async function buildRemoteIntegrityReport(
  client: HasnaStorageClient,
  options: RemoteIntegrityOptions,
): Promise<RemoteIntegrityResult> {
  const authority = await cloudGetIntegrityReport(client);
  // The authority's counts are adopted; its VERDICT is not. The summary is
  // recomputed from the rows it sent, and any condition this build knows about but
  // the authority did not report becomes UNVERIFIED rather than vanishing.
  if (authority) {
    return { integrity: adoptRemoteIntegrityReport(authority, new Date().toISOString()), scan: null };
  }

  const scan = options.scanTasks ? await cloudScanTaskRows(client) : null;
  const sets: IntegrityRowSets = {
    taskLists: options.taskLists,
    projectIds: new Set(options.projects.map((project) => project.id)),
    taskListIds: new Set(options.taskLists.map((list) => list.id)),
    // A partial walk is not a dataset: only a complete scan may feed the counts.
    ...(scan?.complete ? { tasks: scan.rows } : {}),
  };
  const conditions: IntegrityCondition[] = INTEGRITY_CONDITIONS.map((spec) => {
    const measurement = measureIntegrityRows(spec, sets);
    if (measurement === null) {
      const reason = spec.entity === "task"
        ? (scan ? `task scan incomplete: ${scan.reason ?? "unknown reason"}` : NO_AGGREGATE_ROUTE)
        : NO_AGGREGATE_ROUTE;
      return unverifiedCondition(spec, reason);
    }
    return measuredCondition(spec, measurement, spec.entity === "task" ? "remote-scan" : "remote-rows");
  });
  return { integrity: buildIntegrityReport(conditions, new Date().toISOString()), scan };
}

/**
 * Per-condition breakdown. EVERY condition is printed — including the zeroes —
 * because "we looked and it was clean" and "we never looked" must be visually
 * distinct, which is precisely what three unlabelled green check marks destroyed.
 */
export function printIntegrityReport(report: IntegrityReport): void {
  console.log(chalk.bold("\nReferential integrity"));
  console.log(chalk.dim(`  source: ${report.source} · report-only (never repaired by --apply)`));
  for (const condition of report.conditions) {
    if (!condition.verified) {
      console.log(`  ${chalk.yellow("?")} ${chalk.bold(condition.id)} ${chalk.yellow("NOT CHECKED")} — ${condition.unverified_reason}`);
      continue;
    }
    const count = condition.count ?? 0;
    if (count === 0) {
      console.log(`  ${chalk.green("✓")} ${chalk.bold(condition.id)} 0`);
      continue;
    }
    const icon = condition.severity === "error" ? chalk.red("x") : chalk.yellow("!");
    console.log(`  ${icon} ${chalk.bold(condition.id)} ${count}${condition.open_count ? ` (${condition.open_count} open)` : ""} — ${condition.impact}`);
  }
}

/** Verdict line + exit-code meaning, derived from the printed summary. */
export function printDoctorVerdict(
  exitCode: 0 | 1 | 2,
  summary: IntegritySummary,
  options: { hint?: string } = {},
): void {
  if (exitCode === DOCTOR_EXIT_CODES.clean) {
    console.log(chalk.green(`\n  Integrity clean: ${summary.findings} finding(s), all ${INTEGRITY_CONDITIONS.length} conditions checked. (exit 0)`));
  } else if (exitCode === DOCTOR_EXIT_CODES.findings) {
    console.log(chalk.red(
      `\n  ${summary.findings} integrity condition(s) FAILED — ${summary.rows} row(s) affected ` +
      `(${summary.errors} error, ${summary.warnings} warning). (exit 1)`,
    ));
    if (summary.unverified > 0) console.log(chalk.yellow(`  ${summary.unverified} further condition(s) were NOT checked.`));
  } else {
    console.log(chalk.yellow(
      `\n  INCOMPLETE: no findings, but ${summary.unverified} of ${INTEGRITY_CONDITIONS.length} conditions were NOT checked, ` +
      "so this dataset has NOT been shown to be clean. (exit 2)",
    ));
  }
  if (options.hint) console.log(chalk.dim(`  ${options.hint}`));
}
