import { test, expect, describe } from 'vitest';
import { runUserCode, codeNode } from './code.js';

const ctxFor = (parameters, items = [{ json: { n: 1 } }]) => ({
  getInputData: () => items,
  getNodeParameter: (name, _i, fallback) => parameters[name] ?? fallback,
  getRawNodeParameter: (name, fallback) => parameters[name] ?? fallback,
  logger: { info() {}, warn() {} },
});

describe('the Code node sandbox', () => {
  test('runs the code and returns items', async () => {
    const { items } = await runUserCode('return items.map(i => ({ json: { n: i.json.n * 2 } }));',
                                        [{ json: { n: 21 } }]);
    expect(items).toEqual([{ json: { n: 42 } }]);
  });

  test('a bare object is wrapped into an item', async () => {
    const { items } = await runUserCode('return [{ hello: "world" }];', []);
    expect(items).toEqual([{ json: { hello: 'world' } }]);
  });

  test('console.log is captured, not printed on our server', async () => {
    const { logs } = await runUserCode('console.log("from user code"); return [];', []);
    expect(logs).toEqual(['from user code']);
  });

  test('an endless loop is stopped', async () => {
    await expect(runUserCode('while (true) {}', [], { timeoutMs: 300 }))
      .rejects.toThrow(/timed out after 300 ms/);
  });

  test('code that does not return an array is refused clearly', async () => {
    await expect(runUserCode('return "not an array";', []))
      .rejects.toThrow(/must return an array of items/);
  });

  test('empty code is refused', async () => {
    await expect(runUserCode('   ', [])).rejects.toThrow(/is empty/);
  });

  test('a thrown error names itself', async () => {
    await expect(runUserCode('throw new Error("my mistake");', []))
      .rejects.toThrow(/Code node: my mistake/);
  });

  test('the server is out of reach: no require, no process, no fetch', async () => {
    const { items } = await runUserCode(
      'return [{ json: { require: typeof require, process: typeof process, fetch: typeof fetch } }];', []);
    expect(items[0].json).toEqual({ require: 'undefined', process: 'undefined', fetch: 'undefined' });
  });

  test('user code cannot mutate the items we hold', async () => {
    const mine = [{ json: { keep: true } }];
    await runUserCode('items[0].json.keep = false; return items;', mine);
    expect(mine[0].json.keep).toBe(true);
  });

  // Whichever guard trips first - the memory limit or the deadline - the run
  // stops and the server is still answering afterwards. That is the promise.
  test('runaway memory is stopped', async () => {
    await expect(runUserCode('const a = []; while (true) a.push("x".repeat(10000)); return a;',
                             [], { timeoutMs: 3000, memoryMb: 16 }))
      .rejects.toThrow(/more than 16 MB|timed out/);
  }, 15_000);
});

describe('the node itself', () => {
  test('reads its program raw, so {{ }} inside a template literal survives', async () => {
    const code = 'return [{ json: { greeting: `hello {{ not an expression }}` } }];';
    const [out] = await codeNode.execute(ctxFor({ jsCode: code }));
    expect(out[0].json.greeting).toBe('hello {{ not an expression }}');
  });

  test('output items carry pairedItem', async () => {
    const [out] = await codeNode.execute(ctxFor({ jsCode: 'return items;' }, [{ json: { a: 1 } }]));
    expect(out[0].pairedItem).toBe(0);
  });
});
