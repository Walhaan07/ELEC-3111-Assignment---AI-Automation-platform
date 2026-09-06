import { test, expect, describe } from 'vitest';
import { runWorkflow, validateWorkflow, lastNodeOutput } from './engine.js';
import { WorkflowError } from './errors.js';
import { resolve } from './expressions.js';

const fake = (name, out, group = 'action') => ({
  description: { name, group, properties: [] },
  async execute(ctx) { return typeof out === 'function' ? out(ctx) : out; },
});
const wf = (nodes, connections) => ({ nodes, connections });
const node = (name, type, extra = {}) => ({ name, type, parameters: {}, ...extra });

describe('the loop', () => {
  test('runs nodes in order and passes items along', async () => {
    const types = {
      start: fake('start', [[{ json: { a: 1 } }]], 'trigger'),
      next: fake('next', [[{ json: { b: 2 } }]]),
    };
    const { results, log } = await runWorkflow(
      wf([node('S', 'start'), node('N', 'next')], { S: [['N']] }), types);

    expect(results.N[0][0].json).toEqual({ b: 2 });
    expect(log.filter((l) => l.level === 'done')).toHaveLength(2);
  });

  test('an empty branch stops everything after it', async () => {
    const types = { start: fake('start', [[]], 'trigger'), never: fake('never', [[{ json: {} }]]) };
    const { results } = await runWorkflow(
      wf([node('S', 'start'), node('X', 'never')], { S: [['X']] }), types);

    expect(results.X).toBeUndefined();          // it never ran - and that is correct
  });

  test('a node with two inputs is run ONCE, with both branches', async () => {
    let calls = 0;
    const types = {
      start: fake('start', [[{ json: { n: 0 } }]], 'trigger'),
      split: fake('split', [[{ json: { side: 'left' } }], [{ json: { side: 'right' } }]]),
      join: {
        description: { name: 'join', group: 'action', properties: [] },
        async execute(ctx) { calls += 1; return [ctx.getInputData()]; },
      },
    };
    const { results } = await runWorkflow(
      wf([node('S', 'start'), node('Split', 'split'), node('Join', 'join')],
         { S: [['Split']], Split: [['Join'], ['Join']] }), types);

    expect(calls).toBe(1);
    expect(results.Join[0].map((i) => i.json.side)).toEqual(['left', 'right']);
  });

  test('a disconnected island never runs', async () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger'), other: fake('other', [[{ json: {} }]]) };
    const { results } = await runWorkflow(
      wf([node('S', 'start'), node('Lonely', 'other')], {}), types);

    expect(results.Lonely).toBeUndefined();
  });

  test('a disabled node passes its input straight through', async () => {
    const types = {
      start: fake('start', [[{ json: { a: 1 } }]], 'trigger'),
      change: fake('change', [[{ json: { a: 999 } }]]),
    };
    const { results } = await runWorkflow(
      wf([node('S', 'start'), node('D', 'change', { disabled: true })], { S: [['D']] }), types);

    expect(results.D[0][0].json).toEqual({ a: 1 });
  });
});

describe('the guards', () => {
  test('a misspelled target is refused before anything runs', () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger') };
    expect(() => validateWorkflow(wf([node('S', 'start')], { S: [['Wether']] }), types))
      .toThrow(/missing node "Wether"/);
  });

  test('an unknown node type is named', () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger') };
    expect(() => validateWorkflow(wf([node('S', 'start'), node('M', 'nope')], {}), types))
      .toThrow(/unknown type "nope"/);
  });

  test('two triggers, or none, is refused', () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger') };
    expect(() => validateWorkflow(wf([node('A', 'start'), node('B', 'start')], {}), types))
      .toThrow(/exactly one trigger/);
  });

  test('a loop is refused instead of running the laptop hot', async () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger'), echo: fake('echo', [[{ json: {} }]]) };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('E', 'echo')], { S: [['E']], E: [['E']] }), types))
      .rejects.toThrow(/loops/);
  });

  test('a hanging node is cut off and names itself', async () => {
    const types = {
      start: fake('start', [[{ json: {} }]], 'trigger'),
      slow: { description: { name: 'slow', group: 'action', properties: [] },
              execute: () => new Promise(() => {}) },              // never resolves
    };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('Slow', 'slow')], { S: [['Slow']] }), types, { nodeTimeoutMs: 40 }))
      .rejects.toThrow(/"Slow" ran longer than/);
  });

  test('a node that returns rubbish is caught, not passed on', async () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger'), bad: fake('bad', { nope: true }) };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('B', 'bad')], { S: [['B']] }), types))
      .rejects.toThrow(/must return an array of branches/);
  });

  test('too many items stops the run', async () => {
    const types = {
      start: fake('start', [[{ json: {} }]], 'trigger'),
      flood: fake('flood', [Array.from({ length: 50 }, (_, i) => ({ json: { i } }))]),
    };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('F', 'flood')], { S: [['F']] }), types, { maxItems: 10 }))
      .rejects.toThrow(/refusing to go on/);
  });

  test('continueOnFail carries the error downstream instead of stopping', async () => {
    const types = {
      start: fake('start', [[{ json: {} }]], 'trigger'),
      boom: { description: { name: 'boom', group: 'action', properties: [] },
              execute() { throw new Error('kaboom'); } },
      after: fake('after', [[{ json: { reached: true } }]]),
    };
    const { results } = await runWorkflow(
      wf([node('S', 'start'), node('B', 'boom', { continueOnFail: true }), node('A', 'after')],
         { S: [['B']], B: [['A']] }), types);

    expect(results.B[0][0].error).toMatch(/kaboom/);
    expect(results.A[0][0].json.reached).toBe(true);
  });

  test('a node that throws its own error still gets its name attached', async () => {
    const types = {
      start: fake('start', [[{ json: {} }]], 'trigger'),
      picky: {
        description: { name: 'picky', group: 'action', properties: [] },
        execute() {
          // a node's own message, thrown without knowing its name on the canvas
          throw new WorkflowError('URL must start with http://', { code: 'BAD_PARAMETER' });
        },
      },
    };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('Fetch', 'picky')], { S: [['Fetch']] }), types))
      .rejects.toMatchObject({ node: 'Fetch', code: 'BAD_PARAMETER' });
  });

  test('a missing required setting names the node and the setting', async () => {
    const types = {
      start: fake('start', [[{ json: {} }]], 'trigger'),
      needy: { description: { name: 'needy', group: 'action', properties: [] },
               execute: (ctx) => [[{ json: { url: ctx.getNodeParameter('url', 0) } }]] },
    };
    await expect(runWorkflow(
      wf([node('S', 'start'), node('N', 'needy')], { S: [['N']] }), types))
      .rejects.toThrow(/"N" needs its "url" setting filled in/);
  });
});

describe('live progress', () => {
  test('every node reports started and finished, in order', async () => {
    const events = [];
    const types = { start: fake('start', [[{ json: {} }]], 'trigger'), next: fake('next', [[{ json: {} }]]) };
    await runWorkflow(wf([node('S', 'start'), node('N', 'next')], { S: [['N']] }), types,
                      { onEvent: (e) => events.push(`${e.type}:${e.node}`) });

    expect(events).toEqual([
      'node-started:S', 'node-finished:S', 'node-started:N', 'node-finished:N',
    ]);
  });

  test('a listener that throws cannot break the run', async () => {
    const types = { start: fake('start', [[{ json: {} }]], 'trigger') };
    const { log } = await runWorkflow(wf([node('S', 'start')], {}), types,
                                      { onEvent: () => { throw new Error('ui exploded'); } });
    expect(log.some((l) => l.level === 'done')).toBe(true);
  });
});

describe('expressions', () => {
  test('a whole-field expression keeps its real type', () => {
    expect(resolve('{{ $json.n + 1 }}', { json: { n: 41 } })).toBe(42);
  });

  test('an expression inside text is interpolated', () => {
    expect(resolve('https://wttr.in/{{ $json.city }}', { json: { city: 'Sydney' } }))
      .toBe('https://wttr.in/Sydney');
  });

  test('expressions work inside a JSON parameter', () => {
    expect(resolve({ city: '{{ $json.city }}' }, { json: { city: 'Newcastle' } }))
      .toEqual({ city: 'Newcastle' });
  });

  test('an earlier node can be read by name', () => {
    const results = { Weather: [[{ json: { temp: 18 } }]] };
    expect(resolve('{{ $node.Weather.json.temp }}', { json: {} }, results)).toBe(18);
  });

  test('a node that has not run yet says so', () => {
    expect(() => resolve('{{ $node.Ghost.json.x }}', { json: {} }, {})).toThrow(/has not run yet/);
  });

  test('the server is out of reach from an expression', () => {
    expect(resolve('{{ typeof process }}', { json: {} })).toBe('undefined');
    expect(resolve('{{ typeof fetch }}', { json: {} })).toBe('undefined');
  });

  test('a broken expression names itself instead of crashing', () => {
    expect(() => resolve('{{ $json.a.b.c }}', { json: {} })).toThrow(/\{\{\$json\.a\.b\.c\}\}|Cannot read/);
  });

  test('a value with no braces is returned untouched', () => {
    expect(resolve(30000, { json: {} })).toBe(30000);
    expect(resolve('plain text', { json: {} })).toBe('plain text');
  });
});

test('lastNodeOutput picks the final node the run reached', () => {
  expect(lastNodeOutput({ A: [[{ json: { a: 1 } }]], B: [[{ json: { b: 2 } }]] })).toEqual({ b: 2 });
  expect(lastNodeOutput({})).toEqual({});
});
