import { WorkflowError } from '@ai-automation/engine/errors.js';

/**
 * HTTP Request - talk to anything with a URL.
 *
 * This one description is simultaneously the form in the sidebar, the
 * validation rules and the documentation. Every field added here appears in
 * the UI with no UI work at all.
 */
export const httpRequestNode = {
  description: {
    name: 'httpRequest',
    displayName: 'HTTP Request',
    group: 'action',
    icon: 'globe',
    colour: '#0d72b4',
    description: 'Call any REST or HTTP endpoint',
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      { displayName: 'Method', name: 'method', type: 'options', default: 'GET', required: true,
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => ({ name: v, value: v })) },
      { displayName: 'URL', name: 'url', type: 'string', default: '', required: true,
        placeholder: 'https://api.example.com/orders',
        validate: { pattern: '^https?://', message: 'must start with http:// or https://' } },
      { displayName: 'Send headers', name: 'sendHeaders', type: 'boolean', default: false },
      { displayName: 'Headers', name: 'headers', type: 'json', default: '{}',
        displayOptions: { show: { sendHeaders: [true] } } },
      { displayName: 'Body', name: 'body', type: 'json', default: '{}',
        displayOptions: { show: { method: ['POST', 'PUT', 'PATCH'] } } },   // hidden otherwise
      { displayName: 'Timeout (ms)', name: 'timeout', type: 'number', default: 30000,
        validate: { min: 100, max: 120000 } },
      { displayName: 'Retries', name: 'retries', type: 'number', default: 3,
        validate: { min: 0, max: 5 } },
      { displayName: 'Continue on failure', name: 'continueOnFail', type: 'boolean', default: false,
        hint: 'Send the error down the branch instead of stopping the workflow' },
    ],
  },

  async execute(ctx) {
    const out = [];
    const items = ctx.getInputData();

    for (let i = 0; i < items.length; i++) {
      const url = String(ctx.getNodeParameter('url', i));
      if (!/^https?:\/\//i.test(url)) {
        throw new WorkflowError(`URL must start with http:// or https:// - got "${url}"`,
                                { code: 'BAD_PARAMETER' });
      }

      const method = ctx.getNodeParameter('method', i, 'GET');
      const headers = ctx.getNodeParameter('sendHeaders', i, false)
        ? parseJsonParameter(ctx, 'headers', i)
        : {};
      const body = ['POST', 'PUT', 'PATCH'].includes(method)
        ? JSON.stringify(parseJsonParameter(ctx, 'body', i))
        : undefined;

      ctx.logger.info(`${method} ${url}`);
      try {
        const json = await ctx.helpers.httpRequest(url, {
          method,
          body,
          headers: { 'content-type': 'application/json', ...headers },
          timeoutMs: Number(ctx.getNodeParameter('timeout', i, 30000)),
          retries: Number(ctx.getNodeParameter('retries', i, 3)),
        });
        out.push({ json, pairedItem: i });        // remember which input made this output
      } catch (err) {
        if (!ctx.getNodeParameter('continueOnFail', i, false)) throw err;
        out.push({ json: { error: err.message }, pairedItem: i });
      }
    }
    return [out];
  },
};

// a JSON field the user typed is a string; a bad one must name the field,
// not throw "Unexpected token }" from somewhere inside JSON.parse
export function parseJsonParameter(ctx, name, i) {
  const raw = ctx.getNodeParameter(name, i, '{}');
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    throw new WorkflowError(`The "${name}" field is not valid JSON`, { code: 'BAD_PARAMETER' });
  }
}
