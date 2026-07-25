# Hosted auth runbook — `/api/*` and `/mcp` fail closed

Applies from `@hasna/todos` **0.13.0**. Read this before redeploying the hosted
service or upgrading a machine that runs `todos serve` / `todos-mcp --http`.

## What changed

`checkAuth` used to fail **open**: with no `TODOS_API_KEY` and no stored API key it
returned "authorized" for every request. On a deployment that binds a non-loopback
host (`HOST=0.0.0.0` behind a load balancer) that published, to any anonymous caller:

- `POST /mcp` — the full MCP tool catalog and `tools/call` (create/start/complete/fail
  task, register agent, findings, run transactions),
- every `/api/*` REST route — task/project/agent/plan/org/template/webhook CRUD,
  `/api/doctor` (internal DB path), `/api/headless` (boundary manifest), and the
  unbounded SSE streams `/api/events` and `/api/tasks/stream`.

The unconfigured case now **denies**. The posture is resolved once at startup
(`src/server/auth-posture.ts`):

| Configuration | Posture | `/api/*` + `/mcp` | `/v1` | `/health` `/ready` `/version` `/openapi.json` |
| --- | --- | --- | --- | --- |
| `TODOS_API_KEY` set, or ≥1 stored key | `enforce` | credential required | authenticated | public |
| cloud `DATABASE_URL` set, no local key | `local-plane-disabled` | `404 LOCAL_PLANE_DISABLED` | authenticated | public |
| loopback bind + explicit `--allow-anonymous` | `anonymous-loopback` | anonymous, loopback peers only | authenticated | public |
| anything else | **refuses to start** (exit 1) | — | — | — |

`--allow-anonymous` / `TODOS_ALLOW_ANONYMOUS=1` is **refused** for any non-loopback
bind host, and even when active a request is only served anonymously if its raw
transport peer address is loopback (the check deliberately ignores
`x-forwarded-for`, so `TODOS_TRUST_PROXY=1` cannot be used to spoof a loopback peer).

## Hosted deployment (ECS `todos-prod`) — deploy steps

The deployed task definition sets **no `TODOS_API_KEY`** (env is `AWS_REGION`,
`HASNA_APP_NAME`, `HASNA_APP_MODE`, `PORT`, `LOG_LEVEL`, `TODOS_RATE_LIMIT_MAX`;
secrets are the database URL and the API-key signing secret, by vault name). It does
set a cloud `DATABASE_URL`, so after this change the service resolves
`local-plane-disabled`:

- `/v1` keeps working unchanged — it authenticates itself against the cloud API-key
  store and never used `TODOS_API_KEY`.
- `/health` and `/ready` keep working — both are handled **before** the auth check,
  so the ALB target-group health check and the Dockerfile `HEALTHCHECK` are unaffected.
- `/mcp` and `/api/*` return `404 {"code":"LOCAL_PLANE_DISABLED"}`.

**No new secret is required to close the hole.** Provision one only if you decide the
hosted deployment must keep serving `/api/*` or `/mcp`:

1. Mint a key and store it in the vault (item name only, never the value):
   `hasna/oss/todos/server-api-key-<env>`.
2. Add it to the task definition as a `secrets` entry mapped to `TODOS_API_KEY`
   (do **not** put it in `environment`).
3. Register a new task-definition revision and update the service.
4. Give every legitimate caller the key as `x-api-key` / `Authorization: Bearer`.

Also apply while you are in the task definition (pre-existing findings, not fixed by
this PR):

- Set `TODOS_TRUST_PROXY=1` (or key the limiter on a trusted XFF). Today the limiter
  buckets on the ALB node IP, so all internet clients share one
  `TODOS_RATE_LIMIT_MAX` bucket and a flood can `429` authenticated `/v1` traffic.
- Remove `HASNA_TODOS_STORAGE_MODE=remote` from the image or supply the matching
  `HASNA_TODOS_API_URL`/`HASNA_TODOS_API_KEY` deliberately. It currently puts the
  in-container MCP tools on the CLI cloud-routing path with no target, which is why
  most `tools/call` invocations return `UNKNOWN_ERROR` / log `REMOTE_API_URL_MISSING`.
  **Do not "fix" that by adding those two vars while `/api/*` + `/mcp` are anonymous**
  — that would wire an anonymous plane into real Postgres.
- Enable ALB access logs on the shared ALB. They are currently disabled, so
  "was this endpoint ever called?" is unanswerable for every app behind it.

The deployed image (0.11.95) trails the published package and is digest-pinned, so
landing this needs a fresh image build plus a new task-definition revision. That
redeploy is owner-gated.

## Migration for existing callers

| Caller | Before | After |
| --- | --- | --- |
| CLI / SDK (`HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY`) | `/v1` with a key | unchanged — `/v1` was never affected |
| `todos-mcp` (stdio, the default for MCP clients) | local SQLite, no HTTP | unchanged |
| `todos-mcp --http` (loopback `127.0.0.1:8881`) | anonymous | unchanged — the transport is loopback-pinned and opts in implicitly; set `TODOS_API_KEY` and send it from the client to enforce auth |
| `todos serve` / `todos-serve` with no key, loopback | anonymous | **breaking** — add `--allow-anonymous` (or `TODOS_ALLOW_ANONYMOUS=1`), or mint a key with `todos api-keys create "<name>"` |
| `todos serve --host 0.0.0.0` with no key | anonymous, off-box | **refuses to start** — set `TODOS_API_KEY` |
| Local dashboard (`dashboard/dist`) | anonymous `/api/*` | the dashboard sends no key, so it needs `--allow-anonymous` (loopback) until it learns to send one |
| ALB / Docker health checks (`/ready`) | public | unchanged (pre-auth) |
| Hosted `/mcp`, hosted `/api/*` | anonymous | `404 LOCAL_PLANE_DISABLED` unless `TODOS_API_KEY` is provisioned |

An audit of the fleet found **no** configured caller of hosted `/api/*` or `/mcp`:
every MCP client entry and fleet script drives either the local stdio binary or the
loopback HTTP transport, and every remote consumer uses `/v1`. The published
`openapi.json` declares `/v1` paths only.

## Verify after deploying

```bash
# must be 404 (LOCAL_PLANE_DISABLED) or 401 — never 200 with a tool catalog
curl -si https://<host>/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -1
curl -si https://<host>/api/tasks | head -1
curl -si https://<host>/api/stats | head -1

# must still work
curl -si https://<host>/ready | head -1              # 200
curl -si https://<host>/v1/tasks | head -1           # 401 without a key
curl -si https://<host>/v1/tasks -H "x-api-key: $KEY" | head -1   # 200 with one
```
