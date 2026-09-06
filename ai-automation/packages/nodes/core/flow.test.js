import { test, expect, describe } from 'vitest';
import { ifNode, compare } from './if.js';
import { mergeNode } from './merge.js';
import { setNode, setPath } from './set.js';
import { httpRequestNode, parseJsonParameter } from './httpRequest.js';

/**
 * The four nodes everybody uses. They have no network and no credentials, so
 * these are the cheapest tests in the project and they protect the pieces every
 * workflow in the group depends on.
 */

/** A ctx that resolves nothing - the engine has already done that by then. */
const ctxFor = (items, parameters, perItem = null) => ({
  getInputData: () => items,
  getNodeParameter: (name, i = 0, fallback) => {
    if (perItem?.[name]) return perItem[name](items[i], i);
    return parameters[name] ?? fallback;
  },
  getRawNodeParameter: (name, fallback) => parameters[name] ?? fallback,
  logger: { info() {}, warn() {} },
  helpers: { httpRequest: async () => ({}) },
});

describe('IF - every operation', () => {
  const cases = [
    ['equals', 'paid', 'paid', true], ['equals', 'paid', 'unpaid', false],
    ['notEquals', 'a', 'b', true],
    ['contains', 'hello world', 'world', true], ['notContains', 'hello', 'z', true],
    ['startsWith', 'invoice-1', 'invoice', true], ['endsWith', 'file.csv', '.csv', true],
    ['regex', 'AB-1234', '^[A-Z]{2}-\\d+$', true], ['regex', 'x', '([', false],
    ['gt', 10, 5, true], ['gt', 5, 10, false],
    ['gte', 5, 5, true], ['lt', 4, 5, true], ['lte', 5, 5, true],
    ['gt', 'not a number', 5, false],
    ['isEmpty', '', null, true], ['isEmpty', [], null, true], ['isEmpty', 'x', null, false],
    ['isNotEmpty', 'x', null, true],
    ['isTrue', true, null, true], ['isTrue', 'true', null, true],
    ['isFalse', false, null, true],
    ['nonsense', 'a', 'a', false],
  ];

  for (const [operation, left, right, expected] of cases) {
    test(`${JSON.stringify(left)} ${operation} ${JSON.stringify(right)} is ${expected}`, () => {
      expect(compare(left, operation, right)).toBe(expected);
    });
  }

  test('matches go to branch 0, the rest to branch 1', async () => {
    const items = [{ json: { status: 'paid' } }, { json: { status: 'open' } }, { json: { status: 'paid' } }];
    const [yes, no] = await ifNode.execute(ctxFor(items, { combinator: 'all' }, {
      conditions: (item) => [{ left: item.json.status, operation: 'equals', right: 'paid' }],
    }));
    expect(yes).toHaveLength(2);
    expect(no).toHaveLength(1);
    expect(no[0].json.status).toBe('open');
  });

  test('AND needs every condition; OR needs one', async () => {
    const items = [{ json: { a: 1, b: 9 } }];
    const conditions = () => ([
      { left: 1, operation: 'equals', right: '1' },
      { left: 9, operation: 'equals', right: '2' },
    ]);

    const [andYes, andNo] = await ifNode.execute(ctxFor(items, { combinator: 'all' }, { conditions }));
    expect(andYes).toHaveLength(0);
    expect(andNo).toHaveLength(1);

    const [orYes] = await ifNode.execute(ctxFor(items, { combinator: 'any' }, { conditions }));
    expect(orYes).toHaveLength(1);
  });

  test('no conditions at all sends everything down the true branch', async () => {
    const [yes, no] = await ifNode.execute(ctxFor([{ json: {} }], { combinator: 'all', conditions: [] }));
    expect(yes).toHaveLength(1);
    expect(no).toHaveLength(0);
  });

  test('branch 0 is the true output - the frozen promise the canvas draws', () => {
    expect(ifNode.description.outputs).toEqual(['true', 'false']);
  });
});

describe('Set', () => {
  test('adds fields and keeps what arrived', async () => {
    const [out] = await setNode.execute(ctxFor([{ json: { keep: 'me' } }], {
      keepOnlySet: false,
      fields: [{ name: 'added', type: 'string', value: 'yes' }],
    }));
    expect(out[0].json).toEqual({ keep: 'me', added: 'yes' });
  });

  test('keepOnlySet throws away everything else', async () => {
    const [out] = await setNode.execute(ctxFor([{ json: { drop: 'me' } }], {
      keepOnlySet: true,
      fields: [{ name: 'only', type: 'string', value: 'this' }],
    }));
    expect(out[0].json).toEqual({ only: 'this' });
  });

  test('each type is coerced properly', async () => {
    const [out] = await setNode.execute(ctxFor([{ json: {} }], {
      keepOnlySet: true,
      fields: [
        { name: 'n', type: 'number', value: '42' },
        { name: 'bad', type: 'number', value: 'not a number' },
        { name: 'b', type: 'boolean', value: 'true' },
        { name: 'j', type: 'json', value: '{"deep":[1,2]}' },
        { name: 'brokenJson', type: 'json', value: '{oops' },
        { name: 's', type: 'string', value: 7 },
      ],
    }));
    expect(out[0].json).toEqual({
      n: 42, bad: 0, b: true, j: { deep: [1, 2] }, brokenJson: '{oops', s: '7',
    });
  });

  test('a dotted name builds the nested object, not a key with a dot in it', () => {
    expect(setPath({}, 'customer.contact.email', 'a@b.c'))
      .toEqual({ customer: { contact: { email: 'a@b.c' } } });
  });

  test('a dotted name replaces a value that was in the way', () => {
    expect(setPath({ customer: 'Alice' }, 'customer.name', 'Alice'))
      .toEqual({ customer: { name: 'Alice' } });
  });

  test('a field with no name is ignored rather than making a blank key', async () => {
    const [out] = await setNode.execute(ctxFor([{ json: {} }], {
      keepOnlySet: true, fields: [{ name: '', type: 'string', value: 'x' }],
    }));
    expect(out[0].json).toEqual({});
  });

  test('the input is never mutated', async () => {
    const items = [{ json: { original: true } }];
    await setNode.execute(ctxFor(items, {
      keepOnlySet: false, fields: [{ name: 'original', type: 'boolean', value: 'false' }],
    }));
    expect(items[0].json.original).toBe(true);
  });
});

describe('Merge', () => {
  const left = [{ json: { id: 1, name: 'Alice' } }, { json: { id: 2, name: 'Bilal' } }];
  const right = [{ json: { id: 1, total: 42 } }, { json: { id: 2, total: 17 } }];

  test('append puts one list after the other', async () => {
    const [out] = await mergeNode.execute(ctxFor([...left, ...right], { mode: 'append' }));
    expect(out).toHaveLength(4);
    expect(out.map((i) => i.pairedItem)).toEqual([0, 1, 2, 3]);
  });

  test('combine joins on a matching field', async () => {
    const ctx = ctxFor(left, { mode: 'combine', joinField: 'id', firstBranch: 'A', secondBranch: 'B' });
    // the engine resolves $node[...] - here we stand in for it
    ctx.getNodeParameter = (name, _i, fallback) => ({
      mode: 'combine', joinField: 'id', firstBranch: 'A', secondBranch: 'B',
      "{{ $node['A'].all }}": left, "{{ $node['B'].all }}": right,
    }[name] ?? fallback);

    const [out] = await mergeNode.execute(ctx);
    expect(out.map((i) => i.json)).toEqual([
      { id: 1, name: 'Alice', total: 42 },
      { id: 2, name: 'Bilal', total: 17 },
    ]);
  });

  test('combine by position pairs them up regardless of key', async () => {
    const ctx = ctxFor(left, { mode: 'position' });
    ctx.getNodeParameter = (name, _i, fallback) => ({
      mode: 'position', firstBranch: 'A', secondBranch: 'B',
      "{{ $node['A'].all }}": left, "{{ $node['B'].all }}": [{ json: { extra: 'x' } }],
    }[name] ?? fallback);

    const [out] = await mergeNode.execute(ctx);
    expect(out).toHaveLength(2);
    expect(out[0].json).toEqual({ id: 1, name: 'Alice', extra: 'x' });
    expect(out[1].json).toEqual({ id: 2, name: 'Bilal' });
  });

  test('it declares two inputs, which is why the engine runs it once', () => {
    expect(mergeNode.description.inputs).toHaveLength(2);
  });
});

describe('HTTP Request - the checks before the request', () => {
  test('a URL that is not a URL is refused with the value in the message', async () => {
    await expect(httpRequestNode.execute(ctxFor([{ json: {} }], { url: 'ftp://x', method: 'GET' })))
      .rejects.toThrow(/must start with http:\/\/ or https:\/\/ - got "ftp:\/\/x"/);
  });

  test('a JSON field that is not JSON names the field, not the character', () => {
    const ctx = ctxFor([{ json: {} }], { headers: '{oops' });
    expect(() => parseJsonParameter(ctx, 'headers', 0)).toThrow(/The "headers" field is not valid JSON/);
  });

  test('a JSON field already parsed by the expression resolver passes through', () => {
    const ctx = ctxFor([{ json: {} }], { headers: { 'x-key': 'v' } });
    expect(parseJsonParameter(ctx, 'headers', 0)).toEqual({ 'x-key': 'v' });
  });
});
