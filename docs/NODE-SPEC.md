# Node SDK and Node Catalogue

This is the contract between the engine (stream A), the editor (stream B) and the integrations
(stream D). **It is frozen at the end of Week 6.** Changes after that need an ADR.

---

## 1. Why this document matters more than any single node

The highest-leverage design decision in the project: **a node declares its parameters as data, and
the editor renders the form from that declaration.** Adding a node then requires zero editor work,
which means four people can add nodes in parallel in Weeks 8–10 without touching each other's code —
and it gives the n8n comparison a measurable extensibility metric (lines of code and wall-clock
minutes to add an identical new node on each platform).

Build the generator in Week 6, before any Google node exists. If it slips, Weeks 8–10 collapse into
a queue behind whoever owns the editor.

---

## 2. The interface

```ts
// packages/nodes-sdk/src/types.ts

export interface INodeExecutionData {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryData>;
}

export interface BinaryData {
  data: string;          // base64, or an S3 key when > 1 MB
  mimeType: string;
  fileName?: string;
  fileSize?: number;
}

export interface NodeTypeDescription {
  name: string;                       // 'googleSheets'  — stable id, never change it
  displayName: string;                // 'Google Sheets'
  group: ('trigger' | 'action' | 'transform' | 'output')[];
  version: number;
  description: string;
  icon?: string;
  defaults: { name: string; color: string };
  inputs: 'main'[];                   // [] for triggers
  outputs: 'main'[];                  // ['main','main'] for IF
  outputNames?: string[];             // ['true','false']
  credentials?: { name: string; required: boolean }[];
  properties: NodeProperty[];
}

export interface NodeProperty {
  displayName: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'options' | 'multiOptions'
      | 'json' | 'dateTime' | 'collection' | 'resourceLocator' | 'code';
  default: unknown;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: { name: string; value: string | number; description?: string }[];
  typeOptions?: { rows?: number; password?: boolean; editor?: 'js' | 'json' };
  /** Conditional visibility — the editor evaluates this against current parameter values. */
  displayOptions?: {
    show?: Record<string, (string | number | boolean)[]>;
    hide?: Record<string, (string | number | boolean)[]>;
  };
  /** false disables {{ }} resolution for this field (e.g. the Code node body). */
  supportsExpressions?: boolean;
}

export interface INode {
  description: NodeTypeDescription;
  execute?(ctx: IExecuteContext): Promise<INodeExecutionData[][]>;
  webhook?(ctx: IWebhookContext): Promise<IWebhookResponse>;   // Webhook node
  poll?(ctx: IPollContext): Promise<INodeExecutionData[][]>;   // Schedule-style triggers
}

export interface IExecuteContext {
  getInputData(): INodeExecutionData[];
  /** Returns the value with {{ }} already resolved for this item. */
  getNodeParameter<T>(name: string, itemIndex: number, fallback?: T): T;
  getCredentials<T = Record<string, unknown>>(type: string): Promise<T>;
  getNode(): { name: string; type: string };
  continueOnFail(): boolean;
  helpers: {
    httpRequest(options: HttpRequestOptions): Promise<unknown>;
    /** Injects auth and transparently refreshes an expired OAuth2 token once. */
    httpRequestWithAuth(credentialType: string, options: HttpRequestOptions): Promise<unknown>;
    getBinary(item: INodeExecutionData, key: string): Promise<Buffer>;
    prepareBinary(buffer: Buffer, fileName: string, mimeType: string): Promise<BinaryData>;
  };
  logger: { debug(m: string): void; info(m: string): void; error(m: string, e?: unknown): void };
}
```

**Rules for node authors**

1. Never call `axios`/`fetch` directly — always `helpers.httpRequest*`, so retries, timeouts, SSRF
   protection and logging apply uniformly and the benchmark measures the same code path everywhere.
2. Never read `process.env`. Configuration arrives through parameters or credentials.
3. Honour `continueOnFail()`: on error, push `{ json: { error: message } }` for the failing item and
   carry on rather than throwing.
4. `description.name` is a persisted identifier. Renaming one breaks every saved workflow.

### A complete minimal node

```ts
export const setNode: INode = {
  description: {
    name: 'set', displayName: 'Edit Fields', group: ['transform'], version: 1,
    description: 'Add or overwrite fields on each item',
    defaults: { name: 'Edit Fields', color: '#0aa' },
    inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Keep Only Set', name: 'keepOnlySet', type: 'boolean', default: false },
      { displayName: 'Fields', name: 'fields', type: 'collection', default: {},
        description: 'Values may use expressions, e.g. {{ $json.firstName }}' },
    ],
  },
  async execute(ctx) {
    const out = ctx.getInputData().map((item, i) => {
      const fields = ctx.getNodeParameter<Record<string, unknown>>('fields', i, {});
      const keepOnly = ctx.getNodeParameter<boolean>('keepOnlySet', i, false);
      return { json: keepOnly ? { ...fields } : { ...item.json, ...fields }, binary: item.binary };
    });
    return [out];
  },
};
```

That is the entire surface area of adding a node. If a new node needs more than this, the missing
capability belongs in the SDK, not in the node.

---

## 3. Node catalogue

Legend: **T1** = graded core, must ship · **T2** = stretch.

### T1-01 Manual Trigger
No parameters. Emits `[{ json: {} }]`. Exists so the team can run workflows during development
without waiting for a cron or firing a webhook.

### T1-02 Schedule Trigger *(named in the brief)*
| Parameter | Type | Notes |
|---|---|---|
| `mode` | options | `interval` \| `cron` |
| `intervalValue` / `intervalUnit` | number / options | seconds, minutes, hours, days |
| `cronExpression` | string | shown only when `mode = cron` |
| `timezone` | options | IANA names, defaults to the workflow's timezone |

Emits `{ timestamp, readableDate, timezone }`. Registration and the Redis at-most-once lock are in
`docs/ARCHITECTURE.md` §4.2. **Demo:** fires every minute, visible in the execution list.

### T1-03 Webhook *(named in the brief)*
| Parameter | Type | Notes |
|---|---|---|
| `httpMethod` | options | GET, POST, PUT, PATCH, DELETE, HEAD |
| `path` | string | defaults to a generated UUID |
| `authentication` | options | none \| basic \| header |
| `responseMode` | options | `immediately` \| `lastNode` \| `responseNode` |
| `responseCode` | number | shown when `responseMode = immediately` |
| `rawBody` | boolean | keep the body unparsed as binary |

Emits `{ headers, params, query, body, webhookUrl }`. **Demo:** production URL hit from a phone.

### T1-04 HTTP Request *(named in the brief)*
The workhorse — budget more time for it than for any Google node.

| Parameter | Type | Notes |
|---|---|---|
| `method` | options | GET/POST/PUT/PATCH/DELETE/HEAD |
| `url` | string | expression-enabled |
| `authentication` | options | none \| predefined credential \| generic (basic/header/query) |
| `sendQuery` / `queryParameters` | boolean / collection | |
| `sendHeaders` / `headerParameters` | boolean / collection | |
| `sendBody` / `bodyContentType` / `body` | boolean / options / json | json \| form-urlencoded \| multipart \| raw |
| `responseFormat` | options | autodetect \| json \| text \| file (→ binary) |
| `timeout` | number | default 30000 ms |
| `ignoreSSLIssues` | boolean | default false |
| `pagination` | collection | **T2** |

Security: reject requests to link-local and private ranges unless explicitly allowed — in particular
`169.254.169.254`, the cloud metadata endpoint.

### T1-05 Code *(named in the brief)*
| Parameter | Type | Notes |
|---|---|---|
| `mode` | options | `runOnceForAllItems` \| `runOnceForEachItem` |
| `jsCode` | code | Monaco editor, `supportsExpressions: false` |

In-isolate globals: `items` (all-items mode), `item` and `itemIndex` (per-item mode), `$json`,
`$node`, a frozen `console` that forwards to the execution log. Sandbox details and the `vm`-escape
demonstration are in `docs/ARCHITECTURE.md` §3.4.

### T1-06 Google Sheets *(named in the brief)*
Credential `googleSheetsOAuth2Api`. Operations: `append`, `read`, `update`, `clear`,
`appendOrUpdate` (T2).

| Parameter | Type | Notes |
|---|---|---|
| `operation` | options | |
| `documentId` | resourceLocator | accepts a full URL or a bare ID — parse both |
| `sheetName` | options | loaded dynamically from the API where possible, free text otherwise |
| `range` | string | e.g. `A:D`; shown for read/clear |
| `columns` | collection | field → column mapping for append/update |

**Demo:** webhook payload appended as a row while the spreadsheet is on screen.

### T1-07 Google Drive *(named in the brief)*
Credential `googleDriveOAuth2Api`. Operations: `upload`, `download`, `list`/`search`, `createFolder`,
`share`, `delete`. Upload consumes binary from the previous node; download emits binary. Prefer the
`drive.file` scope over full `drive`.

### T1-08 Google Docs *(named in the brief)*
Credential `googleDocsOAuth2Api`. Operations: `create`, `get`, `update`.

`update` uses `documents.batchUpdate` with `insertText` and `replaceAllText` actions.
`replaceAllText` is the one to demo: a template document with `{{customer_name}}` placeholders, each
filled from a Sheets row — mail-merge in four nodes.

### T1-09 Gmail *(named in the brief)*
Credential `gmailOAuth2Api`. Operations: `send`, `reply`, `getMany`, `addLabel`, `markAsRead`.

`send` takes `to`, `cc`, `subject`, `emailType` (text/html), `message`, and attachments pulled from
binary fields. Building a MIME message and base64url-encoding it for `users.messages.send` is the
fiddly part — allow a full day.

### T1-10 IF
| Parameter | Type | Notes |
|---|---|---|
| `conditions` | collection | `{ leftValue, operator, rightValue }` |
| `combinator` | options | AND \| OR |

Operators: string equals/contains/startsWith/regex, number =/≠/</≤/>/≥, boolean is true/false, exists
/ is empty. Two outputs, named `true` and `false`. The engine's branch pruning depends on this node
returning `[[], items]` correctly — cover it with unit tests first.

### T1-11 Set / Edit Fields
See the worked example in §2.

### T1-12 Respond to Webhook
`respondWith` (text | json | binary | noData), `responseCode`, `responseHeaders`. Valid only in a
workflow whose Webhook node has `responseMode = responseNode`; validate that at save time and show
the error on the canvas.

### T1-13 AI / LLM node
Credential `anthropicApi` (API key). **This node is why the project is an *AI* automation platform;
do not let it slide into Tier 2.**

| Parameter | Type | Notes |
|---|---|---|
| `model` | options | pick a current Claude model id; use a cheap fast one for benchmark runs |
| `systemPrompt` | string | expression-enabled |
| `userPrompt` | string | expression-enabled — this is where `{{ $json.body.message }}` earns its keep |
| `temperature` / `maxTokens` | number | |
| `outputFormat` | options | text \| json (ask for JSON and parse, failing the item on invalid JSON) |

**Demo:** classify an inbound webhook payload, then route it with the IF node.

### T2 — stretch, in priority order
1. **AI Agent node with tool calling** — the agent picks from a set of workflow nodes exposed as
   tools. The single most impressive thing you could add, and the clearest "we are not just an
   integration platform" argument in the comparison chapter.
2. **Merge** — combine two branches (append / merge by key / wait for both).
3. **Retry with backoff per node** — `retryOnFail`, `maxTries`, `waitBetweenTries`.
4. **Error Trigger + error workflows.**
5. **Wait** — pause for a duration or until a timestamp.
6. **Execute Workflow** — sub-workflows.
7. **Pinned test data** — pin a node's output so downstream development stops re-calling live APIs.

---

## 4. Node checklist (definition of done)

- [ ] Descriptor complete: `displayOptions` hide irrelevant fields as the operation changes
- [ ] All user-facing strings are expression-enabled unless there is a reason not to
- [ ] Uses `helpers.httpRequest*` exclusively
- [ ] Honours `continueOnFail()`
- [ ] Unit test: parameters → the request that would be sent
- [ ] Integration test against a mock server, including the 401 → refresh → retry path
- [ ] An entry in this catalogue, with the operations actually implemented
- [ ] A screenshot of its parameter panel saved to `docs/images/` for the report
