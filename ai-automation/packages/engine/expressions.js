import { WorkflowError } from './errors.js';

/**
 * Expressions.
 *
 * Any setting may contain `{{ ... }}`, and the engine fills it in for every
 * item separately, just before the node runs. Node authors never see braces.
 *
 * Inside the braces you get:
 *   $json       the current item's json
 *   $node.Name  the first output item of an earlier node
 *   $now        a Date
 *   $itemIndex  which item is being resolved
 */

// Names an expression must never see. They are passed in as parameters with no
// arguments, so inside the expression each one is simply `undefined`.
//
// `eval` and `arguments` are deliberately absent: strict mode forbids binding
// either of them, so they are refused outright below instead.
const SHADOWED = [
  'process', 'require', 'module', 'exports', 'globalThis', 'global',
  'fetch', 'Function', 'setTimeout', 'setInterval',
  'XMLHttpRequest', 'WebSocket', 'constructor',
];

const FORBIDDEN = /\b(?:eval|arguments)\b/;

const cache = new Map();     // compiling is the slow part; do it once per string

function compile(expr) {
  if (cache.has(expr)) return cache.get(expr);
  if (expr.length > 2000) throw new WorkflowError('That expression is too long', { code: 'BAD_EXPRESSION' });
  if (FORBIDDEN.test(expr)) {
    throw new WorkflowError('eval and arguments are not allowed in an expression',
                            { code: 'BAD_EXPRESSION' });
  }

  let fn;
  try {
    fn = new Function('$json', '$node', '$now', '$itemIndex', '$items', ...SHADOWED,
                      `"use strict"; return (${expr});`);
  } catch (e) {
    throw new WorkflowError(`Expression will not compile: ${e.message}`, { code: 'BAD_EXPRESSION' });
  }
  if (cache.size > 500) cache.clear();
  cache.set(expr, fn);
  return fn;
}

/**
 * @param {*} value      the raw setting, which may be any type
 * @param {object} item  the item currently being processed
 * @param {object} results  every branch every finished node produced
 * @param {number} itemIndex
 * @param {Array}  items    the node's whole input, for {{ $items.length }}
 */
export function resolve(value, item, results = {}, itemIndex = 0, items = []) {
  // Expressions may be nested inside objects and arrays - a JSON parameter such as
  // { "name": "{{ $json.name }}" } has to work exactly like a plain text box does.
  if (Array.isArray(value)) return value.map((v) => resolve(v, item, results, itemIndex, items));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v, item, results, itemIndex, items);
    return out;
  }
  if (typeof value !== 'string' || !value.includes('{{')) return value;

  const evaluate = (expr) => {
    const $json = item?.json ?? {};
    const $node = new Proxy({}, {
      get: (_, name) => {
        const branches = results[name];
        if (!branches) {
          throw new WorkflowError(`$node["${String(name)}"] has not run yet`, { code: 'BAD_EXPRESSION' });
        }
        return { json: branches[0]?.[0]?.json ?? {}, all: branches.flat() };
      },
    });
    try {
      return compile(expr.trim())($json, $node, new Date(), itemIndex, items);
    } catch (e) {
      if (e instanceof WorkflowError) throw e;
      throw new WorkflowError(`{{${expr.trim()}}} -> ${e.message}`, { code: 'BAD_EXPRESSION' });
    }
  };

  const whole = value.match(/^\s*\{\{([\s\S]+)\}\}\s*$/);   // the field is ONE expression
  if (whole) return evaluate(whole[1]);                      // ...so keep the real type
  return value.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
    const out = evaluate(e);
    return out === null || out === undefined ? '' : typeof out === 'object' ? JSON.stringify(out) : String(out);
  });
}

/** Used by the editor's live preview, where a thrown error must not kill the panel. */
export function tryResolve(value, item, results = {}, itemIndex = 0) {
  try {
    return { ok: true, value: resolve(value, item, results, itemIndex) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
