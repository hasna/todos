import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

let testRoot = "";
let projectDir = "";
let homeDir = "";

async function runMcpRegistration(args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.tsx"), "mcp", ...args], {
    cwd: projectDir,
    env: localRoutingTestEnv({
      HOME: homeDir,
      TODOS_DB_PATH: ":memory:",
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-mcp-registration-"));
  projectDir = join(testRoot, "project");
  homeDir = join(testRoot, "home");
  mkdirSync(join(projectDir, ".cursor"), { recursive: true });
  mkdirSync(homeDir, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("Cursor MCP registration", () => {
  test("registers and unregisters project MCP without replacing other servers", async () => {
    const configPath = join(projectDir, ".cursor", "mcp.json");
    writeFileSync(configPath, JSON.stringify({
      mcpServers: { existing: { command: "existing-mcp" } },
      projectSetting: true,
    }));

    const registered = await runMcpRegistration(["--register", "cursor"]);

    expect(registered.exitCode).toBe(0);
    expect(registered.stderr).toBe("");
    expect(registered.stdout).toContain("Cursor (project): registered");
    const config = readJson(configPath);
    expect(config.projectSetting).toBe(true);
    expect(config.mcpServers.existing).toEqual({ command: "existing-mcp" });
    expect(config.mcpServers.todos.args).toEqual(["--stdio"]);
    expect(config.mcpServers.todos.command).toEqual(expect.any(String));

    const unregistered = await runMcpRegistration(["--unregister", "cursor"]);

    expect(unregistered.exitCode).toBe(0);
    const updated = readJson(configPath);
    expect(updated.mcpServers.todos).toBeUndefined();
    expect(updated.mcpServers.existing).toEqual({ command: "existing-mcp" });
  });

  test("uses the user Cursor catalog for global registration", async () => {
    const projectConfigPath = join(projectDir, ".cursor", "mcp.json");
    const globalConfigPath = join(homeDir, ".cursor", "mcp.json");

    const registered = await runMcpRegistration(["--register", "cursor", "--global"]);

    expect(registered.exitCode).toBe(0);
    expect(registered.stdout).toContain("Cursor (user): registered");
    expect(readJson(globalConfigPath).mcpServers.todos.args).toEqual(["--stdio"]);
    expect(() => readFileSync(projectConfigPath)).toThrow();
  });
});
