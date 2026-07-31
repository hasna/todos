/**
 * Bun test preload: make this package's own suite physically unable to reach a
 * store shared with other people.
 *
 * ## Why this file exists
 *
 * `src/testing.ts` already solves this problem — it owns the list of variables
 * that route this client at a shared store, next to the resolver that reads
 * them, with a coverage test that fails if the resolver grows a variable the
 * scrub list does not know about. Its own doc comment names the intended entry
 * point: "call before the SDK is imported — e.g. a bun test preload".
 *
 * That preload was never written. So the package shipped the fix to its
 * consumers (`iapp-takumi`, `open-loops`) and did not apply it to itself:
 * measured on station01 2026-07-31, `bun test` in this repo ran with
 * `HASNA_TODOS_STORAGE_MODE=remote` and `HASNA_TODOS_API_URL` pointing at the
 * live fleet coordination store, with 0 of 237 test files clearing them. A
 * reviewer's `TODOS_DB_PATH` was silently overridden by that ambient mode and
 * briefly completed production task `b9cdd17c` (#incidents 615551).
 *
 * A wrongly-completed task is invisible by construction: the search that would
 * find it is the search that filters it out. So the guarantee has to be
 * structural rather than a rule reviewers remember.
 *
 * ## What it does, and what it deliberately does not do
 *
 * It runs ONCE at preload, before any test module is imported — not in a
 * `beforeEach`. A per-test reset would clobber the `beforeAll` setup that
 * existing test files already do across 237 files, trading one silent failure
 * for another. Running once establishes a hermetic floor that any test may
 * still override explicitly: overrides are applied after the scrub, so a test
 * that deliberately exercises the hosted transport against a throwaway server
 * opts back in exactly as it does today.
 *
 * The database path is pinned to a per-process temporary file rather than left
 * blank. Blank resolves to the developer's real local todos database, which is
 * a live store too — smaller blast radius than the hosted one, still not this
 * process's to write to.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocalTodosTestEnv } from "../src/testing.js";

const workerRoot = mkdtempSync(join(tmpdir(), "todos-test-store-"));
const databasePath = join(workerRoot, "todos.db");

applyLocalTodosTestEnv({
  HASNA_TODOS_DB_PATH: databasePath,
  TODOS_DB_PATH: databasePath,
});

// The restore function is intentionally discarded: this process is a test
// runner and there is no later phase that should see the ambient routing back.
