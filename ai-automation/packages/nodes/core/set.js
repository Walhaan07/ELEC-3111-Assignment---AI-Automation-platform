/**
 * Set - build or edit the fields on every item.
 *
 * The node everybody reaches for second: rename a field, add a timestamp,
 * or throw away everything the API sent except the three fields you want.
 */
export const setNode = {
  description: {
    name: 'set',
    displayName: 'Set',
    group: 'transform',
    icon: 'pencil',
    colour: '#0ea5e9',
    description: 'Add, rename or overwrite fields on every item',
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      { displayName: 'Keep only set fields', name: 'keepOnlySet', type: 'boolean', default: false,
        hint: 'Drop everything that arrived and emit only the fields below' },
      { displayName: 'Fields', name: 'fields', type: 'fields', default: [],
        hint: 'Values may use expressions, e.g. {{ $json.first }} {{ $json.last }}' },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const keepOnlySet = ctx.getNodeParameter('keepOnlySet', i, false);
      const fields = ctx.getNodeParameter('fields', i, []) ?? [];
      const json = keepOnlySet ? {} : structuredClone(items[i].json ?? {});

      for (const field of fields) {
        if (!field?.name) continue;
        setPath(json, field.name, coerce(field.value, field.type));
      }
      out.push({ json, pairedItem: i });
    }
    return [out];
  },
};

function coerce(value, type) {
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? 0 : n;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'json':
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return value; }
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/** "customer.email" builds the nested object rather than a key with a dot in it. */
export function setPath(target, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = value;
  return target;
}
