# The HTTP API

Base URL in development: `http://localhost:5678`. The editor proxies `/rest`,
`/webhook` and `/healthz` through Vite, so the browser only ever talks to
`http://localhost:5173`.

## Health

| Method | Path | Answer |
| --- | --- | --- |
| GET | `/healthz` | `{ ok, uptime, runner: { inFlight, queued, maxConcurrent } }` |

`/healthz` runs `SELECT 1`, so a 200 means the database is reachable too. It is
what the container HEALTHCHECK and Caddy's `depends_on` both use.

## Workflows

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/rest/workflows` | `?limit=50&offset=0`, newest first |
| GET | `/rest/workflows/:id` | adds `webhookUrl` when the workflow is active |
| POST | `/rest/workflows` | `{ name, nodes, connections }` → **201** |
| PATCH | `/rest/workflows/:id` | partial; send `version` for optimistic locking |
| DELETE | `/rest/workflows/:id` | **204**; past runs cascade |
| POST | `/rest/workflows/:id/run` | optional `{ triggerItems }` |
| POST | `/rest/workflows/:id/activate` | `{ active: true \| false }` |
| GET | `/rest/workflows/:id/validate` | problems, without running anything |
| GET | `/rest/workflows/:id/events` | Server-Sent Events: live run progress |

### The status codes are the deliverable

| Code | When | Message |
| --- | --- | --- |
| 400 | no name, or the id is not a UUID | `name is required` |
| 404 | no workflow with that id | `No workflow with that id` |
| 409 | somebody else saved first | `Somebody else saved this workflow - reload before saving` |
| 409 | two workflows claim one webhook address | `Another workflow already listens on POST /webhook/x` |
| 422 | the engine refused the workflow | `{ error: { code: 'INVALID_WORKFLOW', node, message } }` |

Anyone can write a route that works. What happens when it does not is the part
worth screenshotting for the report.

### Live progress

```
GET /rest/workflows/:id/events        (text/event-stream)

data: {"type":"execution-started","executionId":"…","mode":"manual"}
data: {"type":"node-started","node":"Weather"}
data: {"type":"node-finished","node":"Weather","ms":412,"items":1,"preview":[[…]]}
data: {"type":"node-skipped","node":"No"}
data: {"type":"execution-finished","executionId":"…","status":"success","ms":420}
```

The canvas colours each box from this stream, which is why a node lights up
*while* it is working rather than after everything has finished.

## Executions

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/rest/executions` | `?workflowId=…&limit=25` |
| GET | `/rest/executions/:id` | the whole run: `data`, `log`, `error` |

## Node types

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/rest/node-types` | every node's `description`, cached 60 s |

This is the only thing the editor needs in order to draw a palette entry and a
complete settings panel for a node. Add a node to `packages/nodes/index.js`,
restart, refresh — the form exists, and nobody touched the editor.

## Credentials and OAuth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/rest/credentials` | never returns token data — only `connected` and `expires_at` |
| POST | `/rest/credentials` | `{ name, type }` → **201** |
| DELETE | `/rest/credentials/:id` | **204** |
| GET | `/rest/oauth2-credential/auth` | `?type=…&credentialId=…` → redirects to Google |
| GET | `/rest/oauth2-credential/callback` | Google returns here; tokens are encrypted and stored |

The redirect URI registered in Google Cloud must match
`$BASE_URL/rest/oauth2-credential/callback` character for character.

## Webhooks

```
ANY /webhook/:path          the live address
ANY /webhook/:path?test=1   the test address - experiments fire no real emails
```

- 120 requests per minute per IP.
- `X-Signature`: optional HMAC-SHA256 over the raw body, compared in constant time.
- `Idempotency-Key` (or GitHub's `X-Github-Delivery`): a repeat delivery answers
  `Already handled` and does **not** run the workflow again.
- `responseMode: immediately` answers 202 in about five milliseconds and runs the
  workflow in the background; `lastNode` waits and returns the last node's output.

## Schedules

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/rest/schedules` | the timers currently registered, and their next run |

Timers exist only while a workflow is active, and `restoreAll()` rebuilds them
on boot — otherwise schedules stop silently after every deploy.
