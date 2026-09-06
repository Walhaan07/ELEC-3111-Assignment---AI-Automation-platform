/**
 * IF - split the stream in two.
 *
 * Branch 0 is the items that matched, branch 1 is the ones that did not.
 * A branch with no items goes quiet, so an empty false branch simply stops
 * there - the engine needs no special case for it.
 *
 * Branch 0 is the true output. That is a frozen promise: the canvas draws it
 * as the top handle and every workflow in the group relies on it.
 */
export const ifNode = {
  description: {
    name: 'if',
    displayName: 'IF',
    group: 'flow',
    icon: 'branch',
    colour: '#f59e0b',
    description: 'Send items down a true or a false branch',
    inputs: ['main'],
    outputs: ['true', 'false'],
    properties: [
      { displayName: 'Combine with', name: 'combinator', type: 'options', default: 'all',
        options: [
          { name: 'AND - every condition must pass', value: 'all' },
          { name: 'OR - any condition may pass', value: 'any' },
        ] },
      { displayName: 'Conditions', name: 'conditions', type: 'conditions',
        default: [{ left: '', operation: 'equals', right: '' }],
        hint: 'Value 1 is usually an expression, e.g. {{ $json.status }}' },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const matched = [];
    const unmatched = [];

    for (let i = 0; i < items.length; i++) {
      const combinator = ctx.getNodeParameter('combinator', i, 'all');
      const conditions = ctx.getNodeParameter('conditions', i, []) ?? [];
      const outcomes = conditions.map((c) => compare(c?.left, c?.operation, c?.right));
      const passed = conditions.length === 0
        ? true
        : combinator === 'any' ? outcomes.some(Boolean) : outcomes.every(Boolean);
      (passed ? matched : unmatched).push({ ...items[i], pairedItem: i });
    }

    ctx.logger.info(`${matched.length} true, ${unmatched.length} false`);
    return [matched, unmatched];
  },
};

const asNumber = (v) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : null);
const isBlank = (v) => v === null || v === undefined || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

export function compare(left, operation, right) {
  const l = left === null || left === undefined ? '' : String(left);
  const r = right === null || right === undefined ? '' : String(right);

  switch (operation) {
    case 'equals':      return l === r;
    case 'notEquals':   return l !== r;
    case 'contains':    return l.includes(r);
    case 'notContains': return !l.includes(r);
    case 'startsWith':  return l.startsWith(r);
    case 'endsWith':    return l.endsWith(r);
    case 'regex':
      try { return new RegExp(r).test(l); } catch { return false; }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = asNumber(left);
      const b = asNumber(right);
      if (a === null || b === null) return false;
      if (operation === 'gt') return a > b;
      if (operation === 'gte') return a >= b;
      if (operation === 'lt') return a < b;
      return a <= b;
    }
    case 'isEmpty':     return isBlank(left);
    case 'isNotEmpty':  return !isBlank(left);
    case 'isTrue':      return left === true || l === 'true';
    case 'isFalse':     return left === false || l === 'false';
    default:            return false;
  }
}

/** The list the sidebar draws, and the list this file implements - one source. */
export const OPERATIONS = [
  { name: 'is equal to', value: 'equals' },
  { name: 'is not equal to', value: 'notEquals' },
  { name: 'contains', value: 'contains' },
  { name: 'does not contain', value: 'notContains' },
  { name: 'starts with', value: 'startsWith' },
  { name: 'ends with', value: 'endsWith' },
  { name: 'matches regex', value: 'regex' },
  { name: 'is greater than', value: 'gt' },
  { name: 'is greater or equal', value: 'gte' },
  { name: 'is less than', value: 'lt' },
  { name: 'is less or equal', value: 'lte' },
  { name: 'is empty', value: 'isEmpty' },
  { name: 'is not empty', value: 'isNotEmpty' },
  { name: 'is true', value: 'isTrue' },
  { name: 'is false', value: 'isFalse' },
];
