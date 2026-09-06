import { WorkflowError } from './errors.js';
import { httpRequest } from './http.js';
import { resolve } from './expressions.js';

/**
 * The engine.
 *
 * A workflow is a list of boxes and a list of lines. This file walks that
 * drawing box by box, hands each box the items that arrived, and writes down
 * what happened. It is the only file that decides what runs next.
 *
 * It refuses to lie when it breaks: it validates before running anything, it
 * times out, it limits how much data one node may produce, and every failure
 * names the node it came from.
 */

const DEFAULTS = { maxSteps: 1000, maxItems: 10000, nodeTimeoutMs: 60000 };

// --------------------------------------------------------------------------
// 1 - refuse a bad workflow before any of it runs
// --------------------------------------------------------------------------

/**
 * A misspelled node name should be a clear sentence, not a crash halfway
 * through a run that has already sent three emails.
 * @returns the single trigger node the run will start from
 */
export function validateWorkflow(workflow, nodeTypes) {
  const problems = [];
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  if (nodes.length === 0) problems.push('the workflow has no nodes');

  const names = new Set();
  for (const n of nodes) {
    if (!n?.name) problems.push('a node has no name');
    else if (names.has(n.name)) problems.push(`two nodes are both called "${n.name}"`);
    else names.add(n.name);
    if (n?.name && !nodeTypes[n.type]) problems.push(`"${n.name}" has unknown type "${n.type}"`);
  }

  for (const [from, branches] of Object.entries(workflow?.connections ?? {})) {
    if (!names.has(from)) problems.push(`a connection starts at missing node "${from}"`);
    for (const targets of branches ?? []) {
      for (const to of targets ?? []) {
        if (!names.has(to)) problems.push(`"${from}" points at missing node "${to}"`);
      }
    }
  }

  const triggers = nodes.filter((n) => nodeTypes[n.type]?.description?.group === 'trigger');
  if (triggers.length !== 1) {
    problems.push(`a workflow needs exactly one trigger - this one has ${triggers.length}`);
  }

  // A loop has no valid running order, so it can never be executed. Saying so here
  // costs nothing; discovering it at step 1000 costs a demo.
  if (problems.length === 0) {
    const cycle = findCycle(workflow);
    if (cycle) problems.push(`this workflow loops: ${cycle.join(' -> ')}`);
  }

  if (problems.length) {
    throw new WorkflowError('This workflow cannot run:\n  - ' + problems.join('\n  - '),
                            { code: 'INVALID_WORKFLOW' });
  }
  return triggers[0];
}

/** Depth-first search, returning the names on the loop it found, or null. */
function findCycle(workflow) {
  const targetsOf = (name) => (workflow.connections?.[name] ?? []).flatMap((t) => t ?? []);
  const state = new Map();       // name -> 'open' while on the current path, 'done' when finished
  const path = [];

  const walk = (name) => {
    if (state.get(name) === 'open') return [...path.slice(path.indexOf(name)), name];
    if (state.get(name) === 'done') return null;
    state.set(name, 'open');
    path.push(name);
    for (const next of targetsOf(name)) {
      const found = walk(next);
      if (found) return found;
    }
    path.pop();
    state.set(name, 'done');
    return null;
  };

  for (const node of workflow.nodes ?? []) {
    const found = walk(node.name);
    if (found) return found;
  }
  return null;
}

// --------------------------------------------------------------------------
// 2 - two guards the loop cannot do without
// --------------------------------------------------------------------------

/** Stop a hung node instead of hanging the whole server with it. */
function withTimeout(promise, ms, message) {
  let timer;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new WorkflowError(message, { code: 'NODE_TIMEOUT' })), ms);
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

/** A node may return sloppy data; the rest of the engine must never see it. */
function normalise(branches, nodeName, maxItems) {
  if (!Array.isArray(branches)) {
    throw new WorkflowError(`"${nodeName}" must return an array of branches`,
                            { node: nodeName, code: 'BAD_NODE_OUTPUT' });
  }
  let total = 0;
  return branches.map((branch, i) => {
    if (!Array.isArray(branch)) {
      throw new WorkflowError(`branch ${i} of "${nodeName}" is not an array`,
                              { node: nodeName, code: 'BAD_NODE_OUTPUT' });
    }
    total += branch.length;
    if (total > maxItems) {
      throw new WorkflowError(`"${nodeName}" produced more than ${maxItems} items - refusing to go on`,
                              { node: nodeName, code: 'TOO_MANY_ITEMS' });
    }
    return branch.map((item) =>
      item && typeof item === 'object' && 'json' in item ? item : { json: item ?? {} });
  });
}

// --------------------------------------------------------------------------
// 3 - the running order
// --------------------------------------------------------------------------

/**
 * Kahn's algorithm over the nodes the trigger can actually reach.
 *
 * Running in topological order is what lets a node with two inputs - Merge -
 * see BOTH branches in one call. A queue that pushed a node once per incoming
 * line would run Merge twice, each time with half the data.
 */
function runningOrder(workflow, triggerName) {
  const targetsOf = (name) => (workflow.connections?.[name] ?? []).flatMap((t) => t ?? []);

  // only what the trigger can reach: a second, disconnected island must not run
  const reachable = new Set([triggerName]);
  const stack = [triggerName];
  while (stack.length) {
    for (const next of targetsOf(stack.pop())) {
      if (!reachable.has(next)) { reachable.add(next); stack.push(next); }
    }
  }

  const indegree = new Map([...reachable].map((n) => [n, 0]));
  for (const name of reachable) {
    for (const to of targetsOf(name)) {
      if (reachable.has(to)) indegree.set(to, indegree.get(to) + 1);
    }
  }

  // seed in declaration order, so two runs of the same workflow choose the same order
  const queue = (workflow.nodes ?? []).map((n) => n.name).filter((n) => indegree.get(n) === 0);
  const order = [];
  while (queue.length) {
    const name = queue.shift();
    order.push(name);
    for (const to of targetsOf(name)) {
      if (!reachable.has(to)) continue;
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return order;
}

/** Every (source, branch) line that feeds this node. */
function inputLines(workflow, nodeName) {
  const lines = [];
  for (const [from, branches] of Object.entries(workflow.connections ?? {})) {
    (branches ?? []).forEach((targets, branch) => {
      if ((targets ?? []).includes(nodeName)) lines.push({ from, branch });
    });
  }
  return lines;
}

// --------------------------------------------------------------------------
// 4 - the loop
// --------------------------------------------------------------------------

/**
 * @param {object} workflow   { nodes: [...], connections: {...} }
 * @param {object} nodeTypes  every node type that exists, keyed by type name
 * @param {object} [options]
 * @param {Array}  [options.triggerItems]  what the trigger emits
 * @param {number} [options.maxSteps]
 * @param {number} [options.maxItems]
 * @param {number} [options.nodeTimeoutMs]
 * @param {object} [options.credentials]   { [credentialId]: decrypted secret }
 * @param {Function} [options.onEvent]     live progress, for the editor's canvas
 * @returns {Promise<{results: object, log: Array, steps: number}>}
 */
export async function runWorkflow(workflow, nodeTypes, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const trigger = validateWorkflow(workflow, nodeTypes);          // 1 - refuse bad input early
  const byName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

  const results = {};
  const log = [];
  const emit = (event) => { try { cfg.onEvent?.(event); } catch { /* the UI must never break a run */ } };
  let steps = 0;

  for (const nodeName of runningOrder(workflow, trigger.name)) {  // 2 - a valid order, once
    if (++steps > cfg.maxSteps) {
      throw new WorkflowError(`Stopped after ${cfg.maxSteps} steps - this workflow loops`,
                              { code: 'STEP_LIMIT' });
    }

    const node = byName[nodeName];
    const lines = inputLines(workflow, nodeName);

    // 3 - collect this node's input from every line that fed it
    let items;
    if (nodeName === trigger.name) {
      items = cfg.triggerItems ?? [{ json: {} }];
    } else {
      items = lines.flatMap(({ from, branch }) => results[from]?.[branch] ?? []);
      if (items.length === 0) {
        // an empty branch goes quiet: everything after it is skipped, which is
        // exactly how the false side of an IF stops without any special casing
        log.push({ node: nodeName, level: 'skipped', ms: 0, items: 0 });
        emit({ type: 'node-skipped', node: nodeName });
        continue;
      }
    }

    if (node.disabled) {                                          // a disabled node is a wire
      results[nodeName] = [items];
      log.push({ node: nodeName, level: 'disabled', ms: 0, items: items.length });
      emit({ type: 'node-skipped', node: nodeName });
      continue;
    }

    const type = nodeTypes[node.type];
    const startedAt = Date.now();
    emit({ type: 'node-started', node: nodeName });

    // 4 - what the node may ask for. Every node ever written depends on these names.
    const ctx = {
      getInputData: () => items,
      getNodeParameter(name, i = 0, fallback = undefined) {
        const raw = node.parameters?.[name] ?? fallback;
        if (raw === undefined) {
          throw new WorkflowError(`"${nodeName}" needs its "${name}" setting filled in`,
                                  { node: nodeName, code: 'MISSING_PARAMETER' });
        }
        return resolve(raw, items[i], results, i, items);         // expressions, for free
      },
      // The Code node needs its program exactly as typed - see packages/nodes/core/code.js.
      getRawNodeParameter(name, fallback = undefined) {
        return node.parameters?.[name] ?? fallback;
      },
      helpers: { httpRequest },
      logger: {
        info: (msg) => { log.push({ node: nodeName, level: 'info', msg }); emit({ type: 'node-log', node: nodeName, msg }); },
        warn: (msg) => { log.push({ node: nodeName, level: 'warn', msg }); emit({ type: 'node-log', node: nodeName, msg }); },
      },
      credentialId: node.credentials?.id ?? null,   // undefined settings become null, never crash
      credentials: options.credentials ?? {},
      workflow: { id: workflow.id, name: workflow.name },
      node: { name: nodeName, type: node.type },
    };

    let branches;
    try {                                                         // 5 - run it, safely
      branches = await withTimeout(Promise.resolve(type.execute(ctx)), cfg.nodeTimeoutMs,
                                   `"${nodeName}" ran longer than ${cfg.nodeTimeoutMs} ms`);
      branches = normalise(branches, nodeName, cfg.maxItems);
    } catch (err) {
      const ms = Date.now() - startedAt;
      log.push({ node: nodeName, level: 'error', ms, msg: err.message });
      emit({ type: 'node-error', node: nodeName, ms, message: err.message });

      if (!node.continueOnFail) {
        // A node may throw a WorkflowError of its own with a better message than
        // we could write - but it rarely knows its own name on the canvas, so we
        // fill that in. Without this the editor cannot highlight the failed box.
        if (err instanceof WorkflowError) {
          err.node ??= nodeName;
          throw err;
        }
        throw new WorkflowError(`"${nodeName}" failed: ${err.message}`,
                                { node: nodeName, code: 'NODE_FAILED', cause: err });
      }
      branches = [[{ json: {}, error: err.message }]];            // carry the failure downstream
    }

    results[nodeName] = branches;
    const itemCount = branches.reduce((n, b) => n + b.length, 0);
    log.push({ node: nodeName, level: 'done', ms: Date.now() - startedAt, items: itemCount });
    emit({
      type: 'node-finished',
      node: nodeName,
      ms: Date.now() - startedAt,
      items: itemCount,
      preview: branches.map((b) => b.slice(0, 5)),                // enough for the output panel
    });
  }

  return { results, log, steps };
}

/** The last node's output - the natural body for a webhook's reply. */
export function lastNodeOutput(results) {
  const names = Object.keys(results ?? {});
  if (names.length === 0) return {};
  const last = results[names[names.length - 1]];
  return last?.[0]?.[0]?.json ?? {};
}

export { WorkflowError } from './errors.js';
export { httpRequest } from './http.js';
export { resolve } from './expressions.js';
