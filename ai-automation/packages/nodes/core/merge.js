/**
 * Merge - bring two branches back together.
 *
 * The engine runs a node once its whole input has arrived, so Merge sees both
 * branches in a single call. `$node['Name']` is how it tells them apart when
 * the mode needs to.
 */
export const mergeNode = {
  description: {
    name: 'merge',
    displayName: 'Merge',
    group: 'flow',
    icon: 'merge',
    colour: '#f59e0b',
    description: 'Combine the items arriving from two branches',
    inputs: ['main', 'main'],
    outputs: ['main'],
    properties: [
      { displayName: 'Mode', name: 'mode', type: 'options', default: 'append',
        options: [
          { name: 'Append - one list after the other', value: 'append' },
          { name: 'Combine by matching field', value: 'combine' },
          { name: 'Combine by position', value: 'position' },
        ] },
      { displayName: 'First branch node', name: 'firstBranch', type: 'string', default: '',
        placeholder: 'IF',
        hint: 'The node feeding the first input - needed to tell the branches apart',
        displayOptions: { show: { mode: ['combine', 'position'] } } },
      { displayName: 'Second branch node', name: 'secondBranch', type: 'string', default: '',
        displayOptions: { show: { mode: ['combine', 'position'] } } },
      { displayName: 'Field to match on', name: 'joinField', type: 'string', default: 'id',
        displayOptions: { show: { mode: ['combine'] } } },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const mode = ctx.getNodeParameter('mode', 0, 'append');
    if (mode === 'append') return [items.map((item, i) => ({ ...item, pairedItem: i }))];

    const branchOf = (paramName) => {
      const name = ctx.getNodeParameter(paramName, 0, '');
      if (!name) return null;
      try {
        return ctx.getNodeParameter(`{{ $node['${name}'].all }}`, 0, []) ?? [];
      } catch {
        return null;
      }
    };

    const first = branchOf('firstBranch') ?? items;
    const second = branchOf('secondBranch') ?? [];

    if (mode === 'position') {
      const length = Math.max(first.length, second.length);
      const out = [];
      for (let i = 0; i < length; i++) {
        out.push({ json: { ...(first[i]?.json ?? {}), ...(second[i]?.json ?? {}) }, pairedItem: i });
      }
      return [out];
    }

    const joinField = ctx.getNodeParameter('joinField', 0, 'id');
    const lookup = new Map(second.map((item) => [String(item.json?.[joinField]), item.json]));
    return [first.map((item, i) => ({
      json: { ...(item.json ?? {}), ...(lookup.get(String(item.json?.[joinField])) ?? {}) },
      pairedItem: i,
    }))];
  },
};
