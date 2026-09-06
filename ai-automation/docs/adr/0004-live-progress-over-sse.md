# ADR 0004 — Live run progress over Server-Sent Events

**Status:** accepted, week 6 · **Deciders:** B2, A1

## Context

`POST /rest/workflows/:id/run` answers when the whole run is finished. For a
workflow that takes eight seconds, the canvas sits still for eight seconds and
then everything turns green at once. Nobody can tell which node was slow, and a
demo of a long workflow looks broken.

n8n lights each node up as it starts. We wanted the same, without adding a
websocket library or a polling loop.

## Decision

The engine takes an optional `onEvent` callback and calls it for every node it
starts, finishes, skips or fails. The runner republishes those on a Node
`EventEmitter`, and `GET /rest/workflows/:id/events` streams them to the browser
as Server-Sent Events. The editor's `useLiveRun` hook turns the stream into the
state each box is coloured from.

## Why SSE and not a websocket

- It is one-way, which is exactly what this is.
- It is plain HTTP: the Vite proxy, Caddy and any corporate firewall all pass it.
- The browser reconnects on its own.
- No dependency, and about forty lines on the server.

## Consequences

- A node shows `running…` while it works, then its item count and milliseconds.
- A listener that throws cannot break a run — `onEvent` is called inside a
  `try/catch` that swallows, and there is a test for exactly that.
- The engine still has no idea a browser exists; it calls a function.
- The stream is best-effort. The authoritative record is still the `executions`
  row, and the editor fills in from the run's response when it arrives.
