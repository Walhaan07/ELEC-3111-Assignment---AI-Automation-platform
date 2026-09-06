# ADR 0003 — `packages/` never imports `apps/`

**Status:** accepted, week 9 · **Deciders:** D1, A1, C1

## Context

Every Google node needs a fresh access token. The obvious way to get one is for
`packages/nodes/google/request.js` to import `apps/api/db.js` and
`apps/api/crypto.js` and read the `credentials` table itself.

## The problem with the obvious way

- `apps/api` imports `packages/nodes` (to get `nodeTypes`), so the import graph
  becomes a cycle.
- Every node test then needs a live Postgres, a real `ENCRYPTION_KEY`, and rows
  in a table. `apps/api/crypto.js` calls `process.exit(1)` when the key is
  missing, which would kill the test runner.

## Decision

`request.js` owns a small store interface and starts with a stub that throws a
clear sentence:

```js
useCredentialStore({
  async load(credentialId) { /* → the decrypted token bundle */ },
  async save(credentialId, tokens, expiresAt) { },
});
```

`apps/api/credentials.js` installs the real, database-backed store at boot.
Tests install a two-line fake.

## Consequences

- `packages/` depends on nothing in `apps/`. The dependency arrow points one way.
- `sheets.test.js` runs against a fake HTTP server with no database, no
  credentials and no network, in about a second.
- Refresh, retry, rate limiting and single-flight all still live in exactly one
  place, which was the point of the shared helper.
- One extra call at boot. If somebody forgets it, the error says so in words.
