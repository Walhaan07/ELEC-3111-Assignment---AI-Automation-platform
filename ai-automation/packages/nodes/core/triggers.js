/**
 * The three ways a workflow starts.
 *
 * A trigger is an ordinary node with no input. The API hands it whatever
 * payload started the run through `options.triggerItems`, so a workflow
 * behaves identically whether a webhook, the clock, or the Run button
 * started it.
 */

export const manualTrigger = {
  description: {
    name: 'manualTrigger',
    displayName: 'Manual Trigger',
    group: 'trigger',
    icon: 'play',
    colour: '#6b7280',
    description: 'Starts the workflow when you press Run in the editor',
    inputs: [],
    outputs: ['main'],
    properties: [],
  },
  async execute(ctx) {
    const items = ctx.getInputData();
    return [items.length ? items : [{ json: {} }]];
  },
};

export const webhookTrigger = {
  description: {
    name: 'webhook',
    displayName: 'Webhook',
    group: 'trigger',
    icon: 'webhook',
    colour: '#0ea5e9',
    description: 'Starts the workflow when an HTTP request arrives',
    inputs: [],
    outputs: ['main'],
    properties: [
      { displayName: 'Path', name: 'path', type: 'string', default: '', required: true,
        placeholder: 'new-order',
        hint: 'The address becomes BASE_URL/webhook/<path>',
        validate: { pattern: '^[a-z0-9][a-z0-9-]{0,62}$',
                    message: 'lower-case letters, numbers and hyphens only' } },
      { displayName: 'Method', name: 'method', type: 'options', default: 'POST', required: true,
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => ({ name: v, value: v })) },
      { displayName: 'Respond', name: 'responseMode', type: 'options', default: 'lastNode',
        options: [
          { name: 'When the workflow finishes', value: 'lastNode' },
          { name: 'Immediately (202 Accepted)', value: 'immediately' },
        ],
        hint: 'Answer instantly for slow workflows, so the caller never times out' },
    ],
  },
  async execute(ctx) {
    // The request was turned into items by apps/api/webhooks.js before the run started.
    const items = ctx.getInputData();
    if (items.length && Object.keys(items[0].json ?? {}).length) return [items];

    // Pressing Run by hand on a webhook workflow is how you build one, so the
    // trigger emits an item of the RIGHT SHAPE rather than an empty object.
    // Without this, every {{ $json.body.… }} downstream fails with "cannot read
    // properties of undefined" before you have sent a single request.
    return [[{
      json: {
        headers: {},
        query: {},
        body: {},
        method: ctx.getNodeParameter('method', 0, 'POST'),
        receivedAt: new Date().toISOString(),
      },
    }]];
  },
};

export const scheduleTrigger = {
  description: {
    name: 'schedule',
    displayName: 'Schedule',
    group: 'trigger',
    icon: 'clock',
    colour: '#8b5cf6',
    description: 'Starts the workflow on a cron schedule while it is active',
    inputs: [],
    outputs: ['main'],
    properties: [
      { displayName: 'Cron expression', name: 'cron', type: 'string', default: '0 * * * *',
        required: true, placeholder: '*/15 * * * *',
        hint: 'Five fields: minute hour day month weekday. "*/15 * * * *" is every 15 minutes.' },
      { displayName: 'Timezone', name: 'timezone', type: 'string', default: 'Australia/Sydney',
        required: true },
    ],
  },
  async execute(ctx) {
    const items = ctx.getInputData();
    if (items.length && Object.keys(items[0].json ?? {}).length) return [items];
    return [[{ json: { timestamp: new Date().toISOString(), scheduledFor: null } }]];
  },
};
