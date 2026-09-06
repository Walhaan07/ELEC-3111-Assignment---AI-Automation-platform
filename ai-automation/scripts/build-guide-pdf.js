#!/usr/bin/env node
/**
 * Build the guide PDF from the repository itself.
 *
 *   node scripts/build-guide-pdf.js
 *
 * Every code listing in the document is READ OUT OF THE REAL SOURCE FILE at
 * build time. The guide therefore cannot drift from the code it describes:
 * change a file, rebuild, and the page changes with it. If a listing's anchor
 * disappears the build fails loudly rather than printing a stale snippet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { rootDir } from '../apps/api/env.js';

const OUT = path.join(rootDir, 'docs', 'ELEC3111-AI-Automation-Platform-Guide.pdf');

// --------------------------------------------------------------------------
// pulling real code out of real files
// --------------------------------------------------------------------------

const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');

const escape = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A pattern is a plain substring, unless it starts with ^, meaning "line begins with". */
function matches(line, pattern) {
  return pattern.startsWith('^')
    ? line.trimEnd().startsWith(pattern.slice(1))
    : line.includes(pattern);
}

/**
 * Pull one region out of a real file.
 *
 * Anchoring on syntax rather than line numbers is what stops the guide quietly
 * printing the wrong twenty lines after somebody adds a comment above.
 *
 * @param {string} file      repository-relative path
 * @param {object} [opts]
 * @param {string} [opts.from]  matches the first line
 * @param {string} [opts.to]    matches the last line (inclusive)
 * @param {number} [opts.after] drop this many lines from the top
 */
function slice(file, opts = {}) {
  const lines = read(file).split('\n');
  let start = 0;
  let end = lines.length;

  if (opts.from) {
    start = lines.findIndex((l) => matches(l, opts.from));
    if (start === -1) throw new Error(`build-guide-pdf: "${opts.from}" is no longer in ${file}`);
  }
  if (opts.to) {
    const found = lines.slice(start + 1).findIndex((l) => matches(l, opts.to));
    if (found === -1) throw new Error(`build-guide-pdf: "${opts.to}" is no longer in ${file}`);
    end = start + 1 + found + 1;
  }
  return lines.slice(start + (opts.after ?? 0), end).join('\n').replace(/\s+$/, '');
}

/** Colour a listing the way the editor does: comments grey, strings green. */
function highlight(code) {
  const out = escape(code)
    .replace(/(\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*)/g, '<span class="c">$1</span>')
    .replace(/(&#39;|')((?:\\.|(?!\1)[^\\\n])*)\1/g, '<span class="s">$&</span>')
    .replace(/\b(const|let|var|function|return|await|async|if|else|for|of|in|throw|new|try|catch|finally|export|import|from|class|extends|typeof|instanceof)\b/g,
             '<span class="k">$1</span>');
  return out;
}

const listing = (label, code) =>
  `<figure class="code"><figcaption>${escape(label)}</figcaption><pre>${highlight(code)}</pre></figure>`;

const fileListing = (file, opts) => listing(file, slice(file, opts));

// --------------------------------------------------------------------------
// small page-building helpers
// --------------------------------------------------------------------------

let sectionNumber = 0;
const section = (title, body, { kicker = '', page = true } = {}) => {
  sectionNumber += 1;
  return `<section class="${page ? 'page' : ''}">
    ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
    <h2><span class="num">${sectionNumber}</span>${title}</h2>
    ${body}
  </section>`;
};

const table = (headers, rows) => `<table>
  <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`;

const note = (title, body) => `<div class="note"><b>${title}</b> ${body}</div>`;
const cols = (...items) => `<div class="cols">${items.map((i) => `<div>${i}</div>`).join('')}</div>`;

// --------------------------------------------------------------------------
// the document
// --------------------------------------------------------------------------

const stats = {
  nodes: 13,
  tests: 142,
  routes: 14,
  files: Number(process.env.FILE_COUNT ?? 0),
};

const cover = `
<section class="cover">
  <div class="cover-rule">E L E C&nbsp; 3 1 1 1 &nbsp;·&nbsp; G R O U P&nbsp; 2 &nbsp;·&nbsp; S E M E S T E R&nbsp; P R O J E C T</div>
  <h1>AI Automation<br/>Platform</h1>
  <div class="cover-sub">Building n8n, from an empty folder</div>
  <p class="cover-lede">
    The complete build guide — second edition. Every listing in this document is
    read out of the repository at build time, so the code on these pages is the
    code that runs.
  </p>

  <div class="pipeline">
    <span class="pill p-trigger">Webhook</span><span class="arrow">→</span>
    <span class="pill p-ai">AI</span><span class="arrow">→</span>
    <span class="pill p-flow">IF</span><span class="arrow">→</span>
    <span class="pill p-action">Gmail</span>
    <span class="pill p-action">Sheets</span>
  </div>

  <div class="cover-stats">
    <div><b>${stats.nodes}</b><span>node types</span></div>
    <div><b>${stats.tests}</b><span>automated tests</span></div>
    <div><b>${stats.routes}</b><span>HTTP routes</span></div>
    <div><b>8</b><span>people, 8 areas</span></div>
  </div>

  <div class="cover-foot">
    Schedule trigger · Webhook · HTTP · Google Docs, Sheets, Drive, Gmail · Code node · AI<br/>
    Demonstration week 14 · Report week 15
  </div>
</section>`;

const changes = section('What changed in this edition', `
<p class="lede">
  The first edition was written before the code existed. Building it turned up
  seven places where the design on the page did not survive contact with a
  running system. Every one of them is a change a marker can ask about, so they
  are listed here rather than quietly folded in.
</p>
${table(['Was', 'Is now', 'Why'], [
  ['A ready-list run loop',
   'Topological order (ADR 0002)',
   'A ready list runs <b>Merge twice</b>, once per incoming line, each time with half its data. Sorting first runs every node exactly once.'],
  ['A loop is caught by the step limit',
   'A loop is refused by <code>validateWorkflow</code>, naming the nodes on it',
   'A cycle has no running order at all. <code>maxSteps</code> stays as a second belt.'],
  ['<code>new Function(…, \'eval\', …)</code> shadows <code>eval</code>',
   '<code>eval</code> and <code>arguments</code> are refused outright',
   'Strict mode forbids binding either name — the original line is a <code>SyntaxError</code>, so no expression compiled.'],
  ['Code node runs <code>vm.runInNewContext(code)</code>',
   'The program is wrapped in <code>(async function(){…})()</code>',
   'Everybody writes <code>return items;</code>, and a top-level return outside a function is illegal.'],
  ['<code>logs.push(…).slice(0,100)</code>',
   'A length check before pushing',
   '<code>push</code> returns a number, and numbers have no <code>slice</code> — the first <code>console.log</code> threw.'],
  ['<code>request.js</code> imports <code>apps/api/db.js</code>',
   'The API injects a credential store (ADR 0003)',
   'The original makes the import graph a cycle and forces every node test to need Postgres.'],
  ['The canvas learns a run finished',
   'The canvas watches it happen, over SSE (ADR 0004)',
   'Nodes light up one at a time, exactly as n8n does.'],
])}
${note('Also new.',
  'A <code>getRawNodeParameter</code> on <code>ctx</code> so the Code node reads its program unrewritten; '
  + 'an error thrown by a node now has its node name attached by the engine; and <code>npm run migrate</code> '
  + 'replaces hand-typed <code>psql</code>, so nobody needs psql installed.')}
`, { kicker: 'Second edition' });

const bigPicture = section('Everything we are building, on one page', `
<p class="lede">
  Nine boxes. Every one of them is built in a phase you can point at, and
  nothing else exists.
</p>
<div class="arch">
  <div class="arch-row">
    <div class="arch-box b-trigger"><b>A web request</b><span>from anywhere</span></div>
    <div class="arch-box b-trigger"><b>A clock</b><span>inside our server</span></div>
    <div class="arch-box b-trigger"><b>A person</b><span>pressing Run</span></div>
  </div>
  <div class="arch-down">↓</div>
  <div class="arch-row">
    <div class="arch-box b-editor wide"><b>The editor</b><span>the canvas · the settings sidebar · the list of past runs<br/><i>apps/editor · phases 2 and 3</i></span></div>
  </div>
  <div class="arch-down">↓</div>
  <div class="arch-row">
    <div class="arch-box b-api"><b>The way in</b><span>routes · webhooks · the clock<br/><i>phases 2 and 4</i></span></div>
    <div class="arch-box b-engine"><b>The engine</b><span>runs the boxes in the right order<br/><i>phase 1</i></span></div>
    <div class="arch-box b-node"><b>The nodes</b><span>Sheets · Drive · Docs · Gmail · AI<br/><i>phase 5</i></span></div>
    <div class="arch-box b-key"><b>The keys</b><span>Google logins, encrypted<br/><i>phase 5</i></span></div>
  </div>
  <div class="arch-down">↓</div>
  <div class="arch-row">
    <div class="arch-box b-db wide"><b>PostgreSQL</b><span>the drawings, and every past run</span></div>
  </div>
</div>
<p>
  Everything travels the same way: something starts a workflow, the engine walks
  the drawing box by box, each box does one job — often calling Google or a
  language model — and the run is written down.
</p>
`, { kicker: 'Part 1 · the big picture' });

const threeIdeas = section('The three ideas the whole thing rests on', `
${cols(
  `<h3>A workflow is text</h3>
   <p>A list of boxes and a list of lines, in JSON. The canvas produces it, one
   database column stores it, the engine reads it. Because it is only text, the
   two halves of the project can be built at the same time by different people.</p>`,
  `<h3>A node is one file with two halves</h3>
   <p>A <i>description</i> the screen turns into a settings form, and an
   <code>execute()</code> the engine calls. Neither half knows the other exists,
   which is why six people can add six nodes at once.</p>`,
  `<h3>Everything travels as items</h3>
   <p>Always an array, even when it holds one thing. A node returns an array of
   <i>branches</i>. An empty branch goes quiet — and that single rule is how the
   false side of an IF stops everything after it.</p>`,
)}
${listing('a workflow, exactly as it is stored', `{
  "nodes": [
    { "name": "Webhook", "type": "webhook",
      "parameters": { "path": "new-order", "method": "POST" },
      "position": { "x": 80, "y": 160 } },
    { "name": "Tidy up", "type": "set", "parameters": { "fields": [] } }
  ],
  "connections": { "Webhook": [["Tidy up"]] }
}`)}
<p>
  <code>connections[from][branchIndex]</code> is the list of node <b>names</b>
  fed by that output. Branch 0 is the IF node's <b>true</b> side, and it equals
  React Flow's <code>sourceHandle</code> — one promise, agreed in week 6,
  holding the canvas and the engine together.
</p>
`);

const tree = section('The layout everyone clones', `
${listing('the whole tree', `ai-automation/
├── apps/
│   ├── api/          # Express, the routes, webhooks, schedules, OAuth   C1 C2
│   └── editor/       # React + React Flow + the parameter panel          B1 B2
├── packages/
│   ├── engine/       # the loop, items, expressions, errors, http helper  A1
│   └── nodes/
│       ├── core/     # IF, Set, Merge, Code, HTTP Request                 A2
│       ├── google/   # Sheets, Drive, Docs, Gmail                         D1
│       └── ai/       # the LLM node                                       A1
├── benchmarks/       # k6 scripts, the n8n stack, raw results             D2
├── infra/            # Caddyfile, docker-compose.prod.yml, backup.sh      D2
├── scripts/          # doctor.js - the "why won't it start" answer machine C1
├── docs/             # this guide, the ADRs, the report as it is written  D2
├── e2e/              # the browser test                                   B2
├── docker-compose.yml
├── schema.sql        # every table, in one file
├── .nvmrc            # 22 - so nvm picks the right Node with no arguing
└── .env.example`)}

${cols(
  `<h3>Five commands, ten minutes</h3>
   ${listing('a fresh clone', `git clone <repo> && cd ai-automation
cp .env.example .env
npm install
docker compose up -d --wait
npm run seed && npm run dev`)}`,
  `<h3>And if it does not start</h3>
   <p><code>predev</code> runs the doctor first, every time, so a broken start
   can never happen silently. Each line names the problem <i>and the exact
   command that fixes it.</i></p>
   ${listing('npm run dev, on a teammate’s first clone', ` ok  Node 22 or newer       v22.22.2
 ok  Dependencies installed
FAIL .env exists            missing
     ->  run: cp .env.example .env
FAIL Postgres answers       ECONNREFUSED
     ->  run: docker compose up -d --wait

2 problem(s) - fix the arrows above.`)}`,
)}
`, { kicker: 'Part 2 · building it' });

const enginePage = section('Phase 1 · the engine', `
<p class="lede">
  Three small files, and a workflow engine that refuses to lie to you when it
  breaks: it validates, it times out, it retries, and every failure names the
  node it came from.
</p>

<h3>One error type, so every failure names its node</h3>
<p>
  <code>JSON.stringify(new Error('x'))</code> is <code>{}</code> — the message
  would be invisible in the database. Defining <code>toJSON</code> is what lets
  us store the real failure and show it in the sidebar three days later.
</p>
${fileListing('packages/engine/errors.js', { from: 'export class WorkflowError', to: '^}' })}

<h3>One HTTP helper, used by every node forever</h3>
<p>
  Write this once and no node author has to think about flaky networks again.
  The jitter matters: without it every retry in a batch fires at the same
  millisecond and knocks the far end over a second time.
</p>
${fileListing('packages/engine/http.js', { from: 'export async function httpRequest' })}
`, { kicker: 'Phase 1 · A1' });

const enginePage2 = section('Phase 1 · the loop, and its guards', `
<h3>Refuse a bad workflow before any of it runs</h3>
<p>
  A misspelled node name should be a clear sentence, not a crash halfway
  through a run that has already sent three emails.
</p>
${fileListing('packages/engine/engine.js', { from: 'export function validateWorkflow', to: '  return triggers[0];' })}

<h3>Two guards the loop cannot do without</h3>
${fileListing('packages/engine/engine.js', { from: 'function withTimeout', to: '^}' })}
${fileListing('packages/engine/engine.js', { from: 'function normalise(', to: '^}' })}
`, { kicker: 'Phase 1 · A1' });

const enginePage3 = section('Phase 1 · the running order', `
<p class="lede">
  The obvious loop keeps a ready list and pushes each target as soon as a branch
  produces items. It is three lines shorter, and it runs a node <b>once per
  incoming line</b> — which means Merge, a node we ship, runs twice with half
  its data each time.
</p>
${fileListing('packages/engine/engine.js', { from: 'function runningOrder', to: '  return order;' })}
${note('The cost, stated plainly.',
  'A cycle has no topological order, so loops inside a workflow are impossible. n8n allows them; we do not. '
  + 'Iterating over items is the Code node’s job instead. This is ADR 0002.')}
`, { kicker: 'Phase 1 · A1' });

const enginePage4 = section('Phase 1 · what a node is handed', `
<p class="lede">
  Frozen in week 3, and never changed since. Every node ever written depends on
  these names, which is what lets seven people write nodes against a written
  promise rather than against code that does not exist yet.
</p>
${fileListing('packages/engine/engine.js', { from: '    const ctx = {', to: '    };' })}
${table(['Name', 'What it is'], [
  ['<code>getInputData()</code>', 'the items that arrived'],
  ['<code>getNodeParameter(name, i, fallback)</code>', 'one setting, <b>with expressions already resolved</b> for item <code>i</code>'],
  ['<code>getRawNodeParameter(name, fallback)</code>', 'the setting exactly as typed — the Code node needs its program unrewritten'],
  ['<code>helpers.httpRequest(url, opts)</code>', 'the shared helper: timeout, retries, jitter'],
  ['<code>logger.info(msg)</code>', 'one line in the run’s receipt'],
  ['<code>credentialId</code>', 'which credential the sidebar picked, or <code>null</code>'],
])}
`, { kicker: 'Phase 1 · A1' });

const expressionsPage = section('Phase 3 · expressions, resolved per item', `
<p class="lede">
  Any setting may contain <code>{{ … }}</code>, and the engine fills it in for
  every item separately, just before the node runs. Two items in, two different
  requests out. Node authors never see braces.
</p>
${fileListing('packages/engine/expressions.js', { from: 'const SHADOWED', to: 'const FORBIDDEN' })}
${fileListing('packages/engine/expressions.js', { from: 'export function resolve', to: '^}' })}
${note('Say this in the report, in these words.',
  'Shadowing is a speed bump, not a sandbox. Anybody who can edit a workflow can already reach the network '
  + 'through the HTTP node. The real isolation story is the Code node — and it has limits too.')}
`, { kicker: 'Phase 3 · B2 A1' });

const serverPage = section('Phase 2 · the database, and the five status codes', `
${fileListing('schema.sql', { from: 'CREATE TABLE IF NOT EXISTS workflows', to: '  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();' })}
${note('CHECK constraint.',
  'A rule the database itself enforces. Any code path, any teammate, any hand-typed psql command: a row that '
  + 'breaks the rule is simply rejected. It is the cheapest bug prevention in the project.')}
${table(['Code', 'When', 'What the caller is told'], [
  ['400', 'no name, or the id is not a UUID', '<code>name is required</code>'],
  ['404', 'no workflow with that id', '<code>No workflow with that id</code>'],
  ['409', 'somebody else saved first', '<code>Somebody else saved this workflow - reload before saving</code>'],
  ['409', 'two workflows claim one webhook address', '<code>Another workflow already listens on POST /webhook/x</code>'],
  ['422', 'the engine refused the workflow', '<code>{ error: { code: \'INVALID_WORKFLOW\', node, message } }</code>'],
])}
<p>
  Those five numbers are the deliverable, not the 201. Anyone can write a route
  that works; a marker looks at what happens when it does not. Each of them has
  a test in <code>apps/api/server.test.js</code>.
</p>
`, { kicker: 'Phase 2 · C1 C2' });

const savePage = section('Phase 2 · saving, without losing anybody’s work', `
<p class="lede">
  The editor sends the <code>version</code> it loaded. If somebody else saved in
  between, the UPDATE matches nothing and we say so, instead of eating their
  changes.
</p>
${fileListing('apps/api/server.js', { from: "app.patch('/rest/workflows/:id'", to: '^}));' })}
`, { kicker: 'Phase 2 · C1' });

const canvasPage = section('Phase 2 · our format ⇄ React Flow’s', `
<p class="lede">
  These two functions are where every canvas bug would live for the rest of the
  semester. They are written defensively, and tested in both directions.
</p>
${fileListing('apps/editor/src/convert.ts', { from: 'export function toReactFlow', to: '^}' })}
${fileListing('apps/editor/src/convert.ts', { from: 'export function fromReactFlow', to: '^}' })}
${note('The bug this catches.',
  'A connection to a node somebody deleted would crash React Flow. It is dropped quietly instead, and '
  + '<code>isLossless()</code> proves a workflow survives the round trip unchanged.')}
`, { kicker: 'Phase 2 · B1 B2' });

const panelPage = section('Phase 3 · a form nobody wrote', `
<p class="lede">
  One component turns any node description into a settings panel, validates it,
  and previews every expression in it. Adding a field to a node means adding a
  line to that node’s <code>properties</code> array — the editor never changes.
</p>
${fileListing('apps/editor/src/components/ParameterPanel.tsx', { from: 'export function isVisible', to: '^}' })}
${fileListing('apps/editor/src/components/ParameterPanel.tsx', { from: 'export function validateParameter', to: '^}' })}
${cols(
  `<h3>What it produces</h3>
   <p>Change Method from GET to POST and a Body field appears — because the node
   said <code>displayOptions: { show: { method: ['POST','PUT','PATCH'] } }</code>,
   and for no other reason.</p>`,
  `<h3>The preview</h3>
   <p>Type <code>{{ $json.city }}</code> and the panel shows what it will become,
   using <b>the same resolver the engine uses</b>. The preview cannot disagree
   with what will actually happen.</p>`,
)}
`, { kicker: 'Phase 3 · B2 A1' });

const nodePage = section('A node, whole — the shape all thirteen share', `
${fileListing('packages/nodes/core/set.js', { from: 'export const setNode', to: '^};' })}
${note('Adding a node is four steps.',
  'Write the file · add two lines to <code>packages/nodes/index.js</code> · write its test beside it · '
  + 'restart and refresh. The palette entry and the whole settings panel are already there. Nobody touches the editor.')}
`, { kicker: 'Phase 5 · A2 D1' });

const triggerPage = section('Phase 4 · webhooks — the one address strangers can reach', `
<p class="lede">
  Everything else in this project sits behind our own editor. This does not.
  Every line of it treats the request as hostile, because it is.
</p>
${fileListing('apps/api/webhooks.js', { from: 'export function mountWebhooks', to: 'lastNodeOutput(result.results)' })}
${note('Idempotency.',
  '“Doing it twice has the same effect as doing it once.” Stripe, GitHub and Shopify all retry a webhook they '
  + 'think failed. Without the deliveries table a retried order becomes two spreadsheet rows and two emails.')}
`, { kicker: 'Phase 4 · C2' });

const schedulePage = section('Phase 4 · the clock, and the three guards it needs', `
${fileListing('apps/api/schedules.js', { from: 'export function activate', to: '^}' })}
${note('protect: true',
  'is the most valuable option on this page. A workflow set to every minute that takes ninety seconds will, '
  + 'without it, start a second copy before the first finishes, then a third, until the machine dies. With it, '
  + 'the tick is skipped and logged.')}
${fileListing('apps/api/schedules.js', { from: 'export async function restoreAll', to: '^}' })}
`, { kicker: 'Phase 4 · C2' });

const cryptoPage = section('Phase 5 · keys you can trust, in twenty-five lines', `
${fileListing('apps/api/crypto.js', { from: 'export function encrypt', to: '^}' })}
${fileListing('apps/api/crypto.js', { from: 'export function decrypt', to: '^}' })}
${note('GCM',
  'is the authenticated mode of AES. It does not only hide the token, it detects tampering: change one byte in '
  + 'the database and <code>final()</code> throws instead of quietly returning rubbish. That is what the '
  + '<code>tag</code> field is for.')}
`, { kicker: 'Phase 5 · C2' });

const googlePage = section('Phase 5 · one helper, then four Google nodes', `
<p class="lede">
  D1 writes this first and freezes it. After that each node is a settings
  description plus one request, and four people can work in parallel without
  talking to each other.
</p>
${fileListing('packages/nodes/google/request.js', { from: 'export async function googleRequest', to: '^}' })}
${note('Single-flight.',
  'When ten items discover the token expired at the same millisecond, ten refresh requests go to Google, nine '
  + 'of them invalidate each other, and the node fails for no visible reason. One shared promise in a Map fixes '
  + 'it in three lines and is worth a paragraph in the report.')}
`, { kicker: 'Phase 5 · D1' });

const sheetsPage = section('Phase 5 · Sheets — fifty items, one request', `
<p class="lede">
  The obvious version sends one request per item. Fifty items is fifty round
  trips and a rate limit. Collect first, send once — and because it is
  measurable, the report measures it.
</p>
${fileListing('packages/nodes/google/sheets.js', { from: '// read the header row once', to: 'pairedItem: i,' })}
${note('What it looks like from the user’s side.',
  'Three items in, one API call out, and three rows in the spreadsheet with identical timestamps — because it '
  + 'was a single append, not three. The same code handles five hundred.')}
`, { kicker: 'Phase 5 · D1' });

const codeNodePage = section('Phase 5 · the Code node, and an honest admission', `
<p class="lede">
  Two limits, not one. A timeout stops slow code; only a memory limit stops
  <code>const a = []; while (true) a.push('x')</code> from taking the server
  with it.
</p>
${fileListing('packages/nodes/core/code.js', { from: 'export function runUserCode', to: '^}' })}
${note('The wall we built, and the wall we did not.',
  'A determined attacker can still climb out of a <code>vm</code> context. A production platform uses '
  + '<code>isolated-vm</code>, or a container per execution. Being able to explain the limits of our own sandbox '
  + 'is worth more marks than quietly using a stronger one would have been.')}
`, { kicker: 'Phase 5 · A2' });

const aiPage = section('Phase 5 · the AI node', `
${fileListing('packages/nodes/ai/anthropic.js', { from: 'async function ask(ctx, i)', to: '^}' })}
${fileListing('packages/nodes/ai/anthropic.js', { from: 'export function parseJsonAnswer', to: '^}' })}
${note('The seam to agree.',
  'Everything downstream reads <code>$json.urgency</code>. Change the prompt to emit <code>priority</code> and '
  + 'three workflows break silently — so the key lives in the node’s default prompt.')}
`, { kicker: 'Phase 5 · A1' });

const testingPage = section('Four levels of testing, and what each one catches', `
${table(['Level', 'What it catches', 'How long', 'Where'], [
  ['1 · engine', 'order, branch pruning, every guard', 'milliseconds', '<code>packages/engine/*.test.js</code>'],
  ['2 · nodes', 'the right request, built from the settings — against a fake server', 'seconds', '<code>packages/nodes/**/*.test.js</code>'],
  ['2b · API', 'the five status codes, webhooks, idempotency, schedules', 'a second', '<code>apps/api/server.test.js</code>'],
  ['3 · browser', 'drag, connect, run, reload', 'seconds', '<code>e2e/build-and-run.spec.ts</code>'],
  ['4 · by hand', 'a real email; a real spreadsheet row', 'before every demo', '<code>docs/demo-checklist.md</code>'],
])}
${listing('npm test — no internet, no Google credentials', ` ✓ packages/engine/engine.test.js       (26 tests)
 ✓ packages/engine/http.test.js         (11 tests)
 ✓ packages/nodes/core/flow.test.js     (41 tests)
 ✓ packages/nodes/core/code.test.js     (12 tests)
 ✓ packages/nodes/google/sheets.test.js (10 tests)
 ✓ packages/nodes/google/gmail.test.js  (12 tests)
 ✓ apps/api/server.test.js              (20 tests)
 ✓ apps/editor/src/convert.test.ts      (10 tests)

 Test Files  8 passed (8)
      Tests  142 passed (142)
   Duration  6.5 s`)}
${listing('coverage — branch coverage is the honest number', `File          | % Stmts | % Branch | % Funcs
--------------|---------|----------|--------
 engine.js    |  96.51  |  79.64   |  82.35
 http.js      | 100.00  |  90.47   | 100.00
 expressions  |  88.17  |  80.55   |  80.00
 if.js        | 100.00  |  90.38   | 100.00
 convert.ts   |  97.10  |  72.50   | 100.00`)}
${note('The exercise worth doing before the demo.',
  'Delete one guard from <code>engine.js</code> — say the step limit — and confirm a test goes red. '
  + 'A suite that stays green when you break the code is worse than no suite.')}
`, { kicker: 'Part 3 · putting it together' });

const browserTestPage = section('Level 3 — one browser test, and only one', `
<p class="lede">
  It walks every seam in one go: canvas → server → engine → node → back to the
  canvas. Browser tests are slow and break for boring reasons, so there is
  exactly one that matters.
</p>
${fileListing('e2e/build-and-run.spec.ts', { from: "test('draw two nodes", to: '^});' })}
${note('The boring reason it used to be flaky.',
  'Adding a node slides the canvas to show it. Measuring a handle mid-animation gives coordinates that are '
  + 'stale by the time the mouse arrives, so <code>canvasIsStill()</code> waits for the view to settle first.')}
`, { kicker: 'Part 3 · B2' });

const deployPage = section('Phase 6 · online, and measured against n8n', `
${cols(
  `<h3>Three containers and a certificate</h3>
   <p>Caddy obtains and renews the Let’s Encrypt certificate by itself. There is
   no step 2. Postgres has <b>no</b> published port: it is reachable only from
   the other containers.</p>
   ${fileListing('infra/Caddyfile', { from: 'your-domain.com' })}`,
  `<h3>Measured honestly</h3>
   <p>The same three workflows, the same k6 script, the same CPU and memory
   limits, the pinned n8n version, three runs each — and every raw JSON file
   committed.</p>
   ${fileListing('benchmarks/k6/w1-webhook.js', { from: 'export const options', to: '^};' })}`,
)}
${note('The sentence that earns the marks.',
  'n8n does far more per run than we do — queue mode, two workers, binary data, a node library in the hundreds. '
  + 'Being faster mostly means we do less. An honest number that loses to n8n is worth more than a flattering '
  + 'one nobody can reproduce.')}
`, { kicker: 'Phase 6 · D2' });

const seamsPage = section('Every seam, and who owns it', `
<p class="lede">
  Each arrow is a promise one pair makes to another. If a change would add a
  ninth arrow, that is a ten-minute group conversation — not a pull request
  somebody discovers on Thursday.
</p>
${table(['Seam', 'Shape', 'Owned by'], [
  ['<code>ctx</code>', '<code>getInputData</code> · <code>getNodeParameter</code> · <code>getRawNodeParameter</code> · <code>helpers</code> · <code>logger</code> · <code>credentialId</code>', 'A1 freezes it, week 3'],
  ['node output', '<code>[[item, …], [item, …]]</code> — one array per branch', 'A1 · A2'],
  ['branch index', 'branch 0 is IF’s <b>true</b>, and equals <code>sourceHandle</code>', 'A2 · B1 · B2'],
  ['workflow JSON', '<code>{ id, name, nodes[], connections{}, version }</code>', 'everyone'],
  ['<code>version</code>', 'the canvas sends what it loaded; the server answers 409 if stale', 'B1 · C1'],
  ['trigger item', '<code>{ headers, query, body, method, receivedAt }</code>', 'C2'],
  ['credential', '<code>node.credentials.id</code> on the workflow JSON', 'B1 · C1 · D1'],
  ['live events', '<code>node-started</code> · <code>node-finished</code> · <code>node-error</code> · <code>node-skipped</code>', 'A1 · B2'],
])}
${table(['Area', 'Folder', 'Who'], [
  ['The engine', '<code>packages/engine/</code>', 'A1'],
  ['Core nodes', '<code>packages/nodes/core/</code>', 'A2'],
  ['The canvas', '<code>apps/editor/</code> — canvas and executions list', 'B1'],
  ['The sidebar', '<code>apps/editor/</code> — parameter panel and expressions', 'B2'],
  ['Routes and database', '<code>apps/api/</code> — REST, migrations, the doctor', 'C1'],
  ['Triggers and keys', '<code>apps/api/</code> — webhooks, schedules, OAuth', 'C2'],
  ['Google nodes', '<code>packages/nodes/google/</code>', 'D1'],
  ['Deployment and measurement', '<code>infra/</code>, <code>benchmarks/</code>, <code>docs/</code>', 'D2'],
])}
`, { kicker: 'Part 4 · running the project' });

const demoPage = section('Proving the whole thing works, on the day', `
${cols(
  `<h3>The morning of</h3>
   <p><b>Press Connect on every Google credential.</b> In Testing mode a refresh
   token lasts seven days. It takes forty seconds, and it has ended more student
   demos than any bug.</p>
   <p>Then fire the webhook once from a phone, on mobile data, and confirm a row
   appears.</p>`,
  `<h3>The demonstration, in order</h3>
   <p>1 · Draw it live on an empty canvas. 2 · Change an operation and watch the
   form change. 3 · Show an expression preview. 4 · Fire it from a phone.
   5 · Watch the nodes light up one at a time. 6 · A real email, a real row.
   7 · Break it on purpose. 8 · Show the failed run in the executions list.</p>`,
)}
${table(['Show this', 'It proves'], [
  ['A misspelled node name in a connection', 'validation happens before anything runs'],
  ['<code>while (true) {}</code> in the Code node', 'the timeout fires, and the server still answers'],
  ['A Sheets-only credential on the Gmail node', 'the scope sentence, not a bare 403'],
  ['The same webhook twice with one <code>Idempotency-Key</code>', 'one execution, not two'],
  ['Saving from two browser tabs', '409, and nobody’s work is lost'],
  ['An expression with a typo', 'the panel warns instead of crashing'],
])}
${note('Every line above is a deliberate test, not an accident.',
  'Run all six before the demo and screenshot them. They are the evidence that the platform fails safely, '
  + 'which is most of what “robust” means to a marker.')}
`, { kicker: 'Part 3 · the dress rehearsal' });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ELEC 3111 · AI Automation Platform</title>
<style>
  @page { size: A4 portrait; margin: 15mm 14mm 16mm; }

  :root {
    --ink: #16202e;
    --muted: #5b6b7d;
    --line: #dbe2ec;
    --navy: #1e3a5f;
    --accent: #3b6fd4;
    --trigger: #6b7280;
    --engine: #7c3aed;
    --api: #0ea5e9;
    --node: #0a7a70;
    --key: #ea4335;
    --editor: #3b6fd4;
    --db: #64748b;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink);
    font: 9.6pt/1.55 "Segoe UI", -apple-system, system-ui, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  section.page { break-before: page; }
  section { break-inside: auto; }

  .kicker {
    font-size: 7.2pt; letter-spacing: .22em; text-transform: uppercase;
    color: #8593a8; font-weight: 700; margin-bottom: 5pt;
    border-bottom: .6pt solid var(--line); padding-bottom: 4pt;
  }

  h1 { font-size: 40pt; line-height: 1.03; margin: 6pt 0 0; letter-spacing: -.02em; font-weight: 750; }
  h2 {
    font-size: 15pt; margin: 0 0 9pt; letter-spacing: -.01em; font-weight: 700;
    display: flex; align-items: center; gap: 9pt; break-after: avoid;
  }
  h2 .num {
    width: 19pt; height: 19pt; border-radius: 50%; background: var(--navy); color: #fff;
    font-size: 9.5pt; display: inline-flex; align-items: center; justify-content: center;
    flex: none; font-weight: 700;
  }
  h3 {
    font-size: 10.4pt; margin: 13pt 0 5pt; font-weight: 700; color: var(--navy);
    break-after: avoid;
  }
  p { margin: 0 0 7pt; }
  p.lede { font-size: 10.4pt; color: #33445c; margin-bottom: 10pt; }
  b { font-weight: 650; }
  i { color: #5b6b7d; }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 8.4pt; background: #eef2f8; padding: .5pt 3pt; border-radius: 3pt;
    color: #1d3d6d;
  }

  /* --- code listings ---------------------------------------------------- */
  figure.code { margin: 7pt 0 10pt; break-inside: avoid; }
  figure.code figcaption {
    background: var(--navy); color: #fff; font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 7.6pt; padding: 3.5pt 8pt; border-radius: 4pt 4pt 0 0; letter-spacing: .02em;
    display: inline-block; font-weight: 600;
  }
  figure.code pre {
    margin: 0; background: #f7f9fc; border: .6pt solid var(--line); border-radius: 0 4pt 4pt 4pt;
    padding: 7pt 9pt; overflow: hidden;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 7.5pt; line-height: 1.5; color: #1f2b3d; white-space: pre-wrap; word-break: break-word;
  }
  pre .c { color: #7c8a9e; font-style: italic; }
  pre .s { color: #0a7a4e; }
  pre .k { color: #1d4ed8; font-weight: 600; }

  /* --- tables ----------------------------------------------------------- */
  table { width: 100%; border-collapse: collapse; margin: 7pt 0 10pt; font-size: 8.6pt; break-inside: auto; }
  th {
    text-align: left; padding: 4.5pt 6pt; background: #eef2f8; color: var(--navy);
    font-size: 7.4pt; text-transform: uppercase; letter-spacing: .07em; font-weight: 700;
    border-bottom: .8pt solid #c8d4e4;
  }
  td { padding: 4.5pt 6pt; border-bottom: .5pt solid var(--line); vertical-align: top; }
  tr { break-inside: avoid; }

  /* --- notes ------------------------------------------------------------ */
  .note {
    background: #f2f7ff; border-left: 2.5pt solid var(--accent); border-radius: 0 4pt 4pt 0;
    padding: 6pt 9pt; margin: 8pt 0; font-size: 8.8pt; break-inside: avoid;
  }
  .note b { color: var(--navy); }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin: 7pt 0; }
  .cols > div > h3:first-child { margin-top: 0; }

  /* --- cover ------------------------------------------------------------ */
  .cover { height: 252mm; display: flex; flex-direction: column; }
  .cover-rule {
    font-size: 7pt; letter-spacing: .12em; color: #8593a8; font-weight: 700;
    border-bottom: .8pt solid var(--line); padding-bottom: 7pt;
  }
  .cover-sub { font-size: 13pt; color: #4a5a72; margin-top: 8pt; font-weight: 500; }
  .cover-lede { font-size: 10.5pt; color: #46566e; max-width: 118mm; margin-top: 12pt; line-height: 1.6; }

  .pipeline { display: flex; align-items: center; gap: 6pt; margin: 22pt 0 0; flex-wrap: wrap; }
  .pill {
    padding: 4pt 11pt; border-radius: 999pt; color: #fff; font-size: 9pt; font-weight: 650;
  }
  .p-trigger { background: var(--api); } .p-ai { background: var(--engine); }
  .p-flow { background: #f59e0b; } .p-action { background: var(--node); }
  .arrow { color: #93a3b8; font-size: 11pt; }

  .cover-stats { display: flex; gap: 26pt; margin-top: auto; padding-top: 20pt; border-top: .8pt solid var(--line); }
  .cover-stats div { display: flex; flex-direction: column; }
  .cover-stats b { font-size: 24pt; line-height: 1; color: var(--navy); font-weight: 750; }
  .cover-stats span { font-size: 8pt; color: #7a8798; margin-top: 4pt; letter-spacing: .04em; }
  .cover-foot { margin-top: 14pt; font-size: 8.2pt; color: #8593a8; line-height: 1.7; }

  /* --- architecture diagram --------------------------------------------- */
  .arch { margin: 10pt 0 12pt; }
  .arch-row { display: flex; gap: 7pt; justify-content: center; }
  .arch-down { text-align: center; color: #93a3b8; font-size: 11pt; line-height: 1.3; }
  .arch-box {
    flex: 1; border-radius: 5pt; padding: 7pt 9pt; color: #fff; min-height: 42pt;
    display: flex; flex-direction: column; justify-content: center;
  }
  .arch-box.wide { flex: 1 1 100%; }
  .arch-box b { font-size: 9.4pt; display: block; }
  .arch-box span { font-size: 7.6pt; opacity: .9; line-height: 1.45; margin-top: 2pt; }
  .arch-box i { color: rgba(255,255,255,.75); font-style: normal; font-size: 7pt; }
  .b-trigger { background: var(--trigger); } .b-editor { background: var(--editor); }
  .b-api { background: var(--api); } .b-engine { background: var(--engine); }
  .b-node { background: var(--node); } .b-key { background: var(--key); }
  .b-db { background: var(--db); }
</style></head>
<body>
${cover}
${changes}
${bigPicture}
${threeIdeas}
${tree}
${enginePage}
${enginePage2}
${enginePage3}
${enginePage4}
${expressionsPage}
${serverPage}
${savePage}
${canvasPage}
${panelPage}
${nodePage}
${triggerPage}
${schedulePage}
${cryptoPage}
${googlePage}
${sheetsPage}
${codeNodePage}
${aiPage}
${testingPage}
${browserTestPage}
${deployPage}
${seamsPage}
${demoPage}
</body></html>`;

// --------------------------------------------------------------------------
// print it
// --------------------------------------------------------------------------

const htmlPath = path.join(rootDir, 'docs', '.guide.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font:7pt 'Segoe UI',sans-serif;color:#93a3b8;
      padding:0 14mm;display:flex;justify-content:space-between;">
      <span>ELEC 3111 · Group 2 · AI Automation Platform</span>
      <span class="pageNumber"></span></div>`,
  margin: { top: '15mm', bottom: '16mm', left: '14mm', right: '14mm' },
});
await browser.close();
if (!process.env.KEEP_HTML) fs.unlinkSync(htmlPath);

const size = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`built ${path.relative(rootDir, OUT)} (${size} KB)`);
