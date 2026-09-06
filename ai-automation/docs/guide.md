# The developer's guide

Everything in this file is about *our* code. The design rationale is in
[`architecture.md`](architecture.md) and the four ADRs; the HTTP surface is in
[`api.md`](api.md).

---

## 1 · What a workflow really is

A workflow feels like a picture. It is actually a piece of text.

```json
{
  "nodes": [
    { "name": "Webhook", "type": "webhook",
      "parameters": { "path": "new-order", "method": "POST" },
      "position": { "x": 80, "y": 160 } },
    { "name": "Tidy up", "type": "set", "parameters": { "fields": [] } }
  ],
  "connections": { "Webhook": [["Tidy up"]] }
}
```

Every box you drag becomes one entry in `nodes`; every line you draw becomes one
entry in `connections`. That is the whole file format, and it is all the engine
ever receives. Because it is just text, the canvas and the engine can be built
by different people at the same time.

## 2 · What a node really is

One object with two halves, and two audiences:

```js
export const setNode = {
  description: {                    // the screen reads this
    name: 'set', displayName: 'Set', group: 'transform',
    icon: 'pencil', colour: '#0ea5e9',
    inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Keep only set fields', name: 'keepOnlySet',
        type: 'boolean', default: false },
    ],
  },
  async execute(ctx) {              // the engine calls this
    const items = ctx.getInputData();
    return [items];                 // one array per output branch
  },
};
```

The screen never runs a node; the engine never draws anything. Neither half
needs to know the other exists. Because the shape never varies, the engine can
run a node written five minutes ago and the editor can draw a settings panel
for it with no UI work at all.

## 3 · What an item really is

One thing: one row, one email, one order.

```js
{ json: { customer: 'Alice', total: 42 } }
```

Nodes never pass a single item — they pass a **list**, even when the list is one
item long, and they return a list of **branches**, each a list of items:

```js
return [matched, unmatched];   // the IF node: branch 0 is true, branch 1 is false
return [items];                // everything else: one branch
```

An empty branch goes quiet. That one rule is how the false side of an IF stops
everything after it, with no special case anywhere in the engine.

## 4 · What the engine really is

`packages/engine/engine.js`, and about two hundred lines:

1. **Validate.** Unknown types, duplicate names, connections to missing nodes,
   the wrong number of triggers, and loops — all refused *before* anything runs.
   A misspelled node name is a clear sentence, not a crash halfway through a run
   that has already sent three emails.
2. **Order.** Find the trigger, find what it can reach, sort topologically.
3. **Run.** For each node, gather the items from every line that feeds it, hand
   over a `ctx`, race `execute()` against a timeout, and check what came back is
   the right shape.
4. **Record.** `{ results, log, steps }`. `results` is stored in
   `executions.data`, `log` in `executions.log`, with no translation step.

The guards, and what each one stops:

| Guard | Stops |
| --- | --- |
| `validateWorkflow` | a broken workflow half-executing |
| cycle detection | a workflow that can never have a running order |
| `nodeTimeoutMs` (60 s) | one hung node hanging the whole server |
| `maxItems` (10 000) | a runaway node eating memory |
| `maxSteps` (1 000) | a second belt against runaway execution |
| `normalise()` | sloppy node output reaching the rest of the engine |
| `continueOnFail` | a failure that the workflow author wants to handle downstream |

## 5 · What a node's `ctx` gives it

Frozen in week 3. Every node ever written depends on these names:

| Name | What it is |
| --- | --- |
| `getInputData()` | the items that arrived |
| `getNodeParameter(name, i, fallback)` | one setting, **with expressions resolved** for item `i` |
| `getRawNodeParameter(name, fallback)` | the setting exactly as typed — the Code node needs this |
| `helpers.httpRequest(url, opts)` | the shared HTTP helper: timeout, retries, jitter |
| `logger.info(msg)` / `.warn(msg)` | one line in the run's receipt |
| `credentialId` | which credential the sidebar picked, or `null` |
| `credentials` | decrypted non-OAuth secrets, e.g. the AI node's API key |

## 6 · Expressions

Any setting may contain `{{ … }}`, and the engine fills it in **for every item
separately**, just before the node runs:

```
https://wttr.in/{{ $json.city }}
```

Two items in, two different requests out. Node authors never see braces —
`getNodeParameter` resolves them, which is why adding expressions in phase 3
changed the engine by exactly one line.

| Inside the braces | What it is |
| --- | --- |
| `$json` | the current item's json |
| `$node.Weather.json` | the first output item of an earlier node |
| `$node.Weather.all` | every item that node produced |
| `$now` | a `Date` |
| `$itemIndex` | which item is being resolved |
| `$items` | the whole input, for `{{ $items.length }}` |

If the field is *one* expression the real typed value comes back, so
`{{ $json.n + 1 }}` stays a number. Otherwise the results are interpolated into
the surrounding text.

`process`, `require`, `fetch`, `Function` and friends are shadowed, and `eval`
is refused outright. **That is a speed bump, not a sandbox** — anybody who can
edit a workflow can already reach the network through the HTTP node. The real
isolation story is the Code node.

## 7 · Adding a node — the whole procedure

1. Write the file in `packages/nodes/<area>/<name>.js`: a `description` and an
   `execute`.
2. Add two lines to `packages/nodes/index.js` — the import, and the entry.
3. Write its test beside it, against a fake HTTP server. Whoever writes the
   file writes the test; there is no "testing person".
4. Restart the API, refresh the editor.

The palette entry and the whole settings panel are already there. **Nobody
touches `apps/editor`.** That is the entire payoff of the schema-driven design,
and it is what made six people adding six nodes at once possible.

The property types the panel knows:

| `type` | Renders as |
| --- | --- |
| `string` | a text box |
| `text` | a multi-line box |
| `number` | a number box, with `validate.min` / `.max` |
| `boolean` | a switch |
| `options` | a dropdown, from `options: [{ name, value }]` |
| `json` | a JSON textarea, validated as you type |
| `code` | a tall monospaced editor |
| `fields` | the Set node's repeating name/type/value rows |
| `conditions` | the IF node's repeating condition rows |
| `notice` | a plain explanatory box |

A node author who invents a fourteenth type gets a blank field, so add it to
`ParameterPanel.tsx` first.

`displayOptions` hides a field until it applies:

```js
{ displayName: 'Body', name: 'body', type: 'json', default: '{}',
  displayOptions: { show: { method: ['POST', 'PUT', 'PATCH'] } } }
```

## 8 · The canvas

`apps/editor/src/convert.ts` holds the only translation between our format and
React Flow's, in both directions, and `isLossless()` proves a workflow survives
a round trip. The frozen promise: **branch index === `sourceHandle`, and branch
0 is the IF node's true output.**

What the editor does for you:

- **Autosave** 1.2 s after you stop moving things, plus <kbd>Ctrl</kbd>+<kbd>S</kbd>
  and a warning if you try to close the tab with unsaved work.
- **Optimistic locking** — it sends the `version` it loaded, and a 409 becomes
  "Someone else saved this workflow" instead of silently destroying their work.
- **Live run state** — every box shows `running…`, then its item count and
  milliseconds, straight from the engine over SSE.
- **Expression previews** — using the same resolver the engine uses, so the
  preview cannot disagree with what will actually happen.
- **Escape** closes the settings panel; **Delete** removes what is selected.

## 9 · Triggers

| Trigger | Starts when | Notes |
| --- | --- | --- |
| Manual | you press Run | one empty item |
| Webhook | an HTTP request arrives | needs the workflow to be **active** |
| Schedule | a cron tick | needs the workflow to be **active** |

Activating is the moment a drawing becomes a running thing: the webhook address
is claimed and the timer registered, both in one transaction, so a workflow can
never end up half on. Deactivating releases both.

The trigger item every workflow reads:

```js
{ headers, query, body, method, receivedAt }   // → {{ $json.body.customer }}
```

## 10 · Running the tests

```bash
npm test          # levels 1 and 2: engine, nodes, API. Needs Postgres.
npm run e2e       # level 3: the browser test, which starts the app itself
npm run coverage  # the same, with a coverage report
```

`npm test` needs no internet and no Google credentials — if it ever does, the
fake server is not being used.

A useful exercise: delete one guard from `engine.js`, say the step limit, and
confirm a test goes red. A suite that stays green when you break the code is
worse than no suite.
