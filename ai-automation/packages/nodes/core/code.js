import { Worker } from 'node:worker_threads';

/**
 * The Code node - run your own JavaScript on the items.
 *
 * Three walls, and an honest admission:
 *   1. a separate worker thread, so we can stop it at any moment
 *   2. a memory limit, because a timeout alone does not stop
 *      `const a = []; while (true) a.push('x')`
 *   3. a fresh vm context, so user code cannot see our variables
 *
 * A determined attacker can still climb out of a vm context. We say so in the
 * report and explain what a production platform uses instead (isolated-vm, or
 * a container per execution). The weaker wall is a fair trade when the only
 * people who can edit a workflow are the eight of us.
 */

const WORKER = `
  const vm = require('node:vm');
  const { parentPort, workerData } = require('node:worker_threads');
  const logs = [];
  const sandbox = {
    items: structuredClone(workerData.items),      // a copy: user code cannot mutate ours
    $items: structuredClone(workerData.items),
    console: { log: (...a) => { if (logs.length < 100) logs.push(a.map(String).join(' ')); } },
    JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN,
    parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  };
  // The program is wrapped in a function so that a top-level \`return items;\` -
  // which is how everybody writes it - is legal, and so \`await\` works too.
  const wrapped = '(async function () {\\n' + workerData.code + '\\n})()';
  const fail = (e) => parentPort.postMessage({
    ok: false, error: e && e.message ? e.message : String(e), logs,
  });
  try {
    const value = vm.runInNewContext(wrapped, vm.createContext(sandbox),
                                     { timeout: workerData.timeoutMs, displayErrors: true });
    Promise.resolve(value).then(
      (result) => parentPort.postMessage({ ok: true, result, logs }),
      fail,
    );
  } catch (e) {
    fail(e);
  }
`;

/**
 * @returns {Promise<{items: Array, logs: string[]}>}
 */
export function runUserCode(code, items, { timeoutMs = 5000, memoryMb = 64 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof code !== 'string' || code.trim() === '') {
      return reject(new Error('The Code node is empty'));
    }

    const worker = new Worker(WORKER, {
      eval: true,
      workerData: { code, items, timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 16 },
      stdout: true, stderr: true,          // user code cannot spam our server log
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };

    // the vm timeout can be beaten by a tight async loop, so the thread gets a hard deadline too
    const timer = setTimeout(
      () => finish(reject, new Error(`Code node timed out after ${timeoutMs} ms`)),
      timeoutMs + 500,
    );

    worker.on('message', (m) => {
      if (!m.ok) {
        // V8's own wording for the vm timeout is "Script execution timed out",
        // which does not say which node or how long it was given.
        return finish(reject, /timed out/i.test(m.error)
          ? new Error(`Code node timed out after ${timeoutMs} ms`)
          : new Error(`Code node: ${m.error}`));
      }
      if (!Array.isArray(m.result)) {
        return finish(reject, new Error('Code must return an array of items, e.g. return items;'));
      }
      finish(resolve, {
        items: m.result.map((x) => (x && typeof x === 'object' && 'json' in x ? x : { json: x ?? {} })),
        logs: m.logs ?? [],
      });
    });

    worker.on('error', (e) => finish(reject,
      /heap out of memory|Worker terminated|Array buffer allocation failed/i.test(e.message)
        ? new Error(`Code node used more than ${memoryMb} MB and was stopped`)
        : e));

    worker.on('exit', (exitCode) => {
      if (!settled && exitCode !== 0) {
        finish(reject, exitCode === 1
          ? new Error(`Code node used more than ${memoryMb} MB and was stopped`)
          : new Error(`Code node exited unexpectedly (${exitCode})`));
      }
    });
  });
}

const DEFAULT_CODE = `// "items" is the input. Return an array of items.
return items.map((item) => ({
  json: { ...item.json, processedAt: new Date().toISOString() },
}));`;

export const codeNode = {
  description: {
    name: 'code',
    displayName: 'Code',
    group: 'transform',
    icon: 'code',
    colour: '#10b981',
    description: 'Run your own JavaScript over the items',
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      { displayName: 'JavaScript', name: 'jsCode', type: 'code', default: DEFAULT_CODE,
        hint: 'Runs in a worker thread with a timeout and a memory limit. Return an array of items.' },
      { displayName: 'Timeout (ms)', name: 'timeoutMs', type: 'number', default: 5000,
        validate: { min: 100, max: 30000 } },
      { displayName: 'Memory limit (MB)', name: 'memoryMb', type: 'number', default: 64,
        validate: { min: 16, max: 512 } },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();

    // The program is read RAW, on purpose. `{{` is ordinary JavaScript inside a
    // template literal, and silently rewriting somebody's code before running it
    // would be a genuinely nasty surprise.
    const jsCode = ctx.getRawNodeParameter('jsCode', DEFAULT_CODE);

    const { items: out, logs } = await runUserCode(jsCode, items, {
      timeoutMs: Number(ctx.getNodeParameter('timeoutMs', 0, 5000)),
      memoryMb: Number(ctx.getNodeParameter('memoryMb', 0, 64)),
    });
    for (const line of logs) ctx.logger.info(line);
    return [out.map((item, i) => ({ ...item, pairedItem: i }))];
  },
};
