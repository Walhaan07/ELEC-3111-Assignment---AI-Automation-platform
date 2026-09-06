/**
 * The AI node - one request, and everything that can go wrong with it.
 *
 * Because every setting runs through the expression resolver, somebody can type
 *
 *   Classify this: {{ $json.body.message }}
 *   Reply as JSON: {"urgency":"urgent|routine"}
 *
 * into the sidebar and feed the answer straight into an IF node. Point a second
 * credential's base URL at http://localhost:11434/v1 to use a local Ollama
 * model instead - same node, no code change.
 */

export const MODELS = [
  { name: 'Opus - the most capable', value: 'claude-opus-5' },
  { name: 'Sonnet - the everyday choice', value: 'claude-sonnet-5' },
  { name: 'Haiku - the fastest and cheapest', value: 'claude-haiku-4-5-20251001' },
];

const DEFAULT_PROMPT = `Classify this message.
Reply with JSON only: {"urgency":"urgent|routine","reason":"one short sentence"}

Message: {{ $json.body.message }}`;

export const aiNode = {
  description: {
    name: 'ai',
    displayName: 'AI',
    group: 'action',
    icon: 'sparkles',
    colour: '#7c3aed',
    description: 'Ask a language model about the item, and use its answer downstream',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'anthropicApi', required: false }],
    properties: [
      { displayName: 'Model', name: 'model', type: 'options', default: 'claude-sonnet-5',
        options: MODELS },
      { displayName: 'System prompt', name: 'systemPrompt', type: 'text', default: '',
        placeholder: 'You are a careful classifier. Answer with JSON only.' },
      { displayName: 'Prompt', name: 'userPrompt', type: 'text', default: DEFAULT_PROMPT,
        required: true },
      { displayName: 'Max tokens', name: 'maxTokens', type: 'number', default: 512,
        validate: { min: 1, max: 4096 } },
      { displayName: 'Expect JSON', name: 'expectJson', type: 'boolean', default: true,
        hint: 'Parse the answer as JSON and merge its keys into the item' },
      { displayName: 'Required keys', name: 'requiredKeys', type: 'string', default: 'urgency',
        placeholder: 'urgency, reason',
        hint: 'Comma separated. The run fails if the model leaves one out.',
        displayOptions: { show: { expectJson: [true] } } },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const answer = await ask(ctx, i);
      const expectJson = ctx.getNodeParameter('expectJson', i, true);

      if (!expectJson) {
        out.push({ json: { ...items[i].json, answer: answer.text, usage: answer.usage }, pairedItem: i });
        continue;
      }

      const keys = String(ctx.getNodeParameter('requiredKeys', i, ''))
        .split(',').map((k) => k.trim()).filter(Boolean);
      const parsed = parseJsonAnswer(answer.text, keys);
      out.push({ json: { ...items[i].json, ...parsed, usage: answer.usage }, pairedItem: i });
    }
    return [out];
  },
};

async function ask(ctx, i) {
  const apiKey = ctx.credentials?.anthropicApi?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = ctx.credentials?.anthropicApi?.baseUrl
    ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

  if (!apiKey || apiKey === 'replace-me') {
    throw new Error('No API key for the AI node - set ANTHROPIC_API_KEY in .env, or connect a credential');
  }

  const prompt = String(ctx.getNodeParameter('userPrompt', i));
  if (prompt.length > 20_000) throw new Error('Prompt is too long - trim the data you send in');

  const body = {
    model: ctx.getNodeParameter('model', i, 'claude-sonnet-5'),
    max_tokens: Math.min(Math.max(Number(ctx.getNodeParameter('maxTokens', i, 512)), 1), 4096),
    messages: [{ role: 'user', content: prompt }],
  };
  const system = ctx.getNodeParameter('systemPrompt', i, '');
  if (system) body.system = system;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 429 too fast, 529 overloaded, 5xx their fault - all worth waiting out
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
      ctx.logger.info(`model busy (${res.status}) - waiting ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`AI ${res.status}: ${data.error?.message ?? 'unknown error'}`);
    if (data.stop_reason === 'max_tokens') ctx.logger.warn('answer was cut off - raise Max tokens');

    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    ctx.logger.info(`in ${data.usage?.input_tokens ?? '?'} / out ${data.usage?.output_tokens ?? '?'} tokens`);
    return { text, usage: data.usage, model: data.model, stopReason: data.stop_reason };
  }
  throw new Error('The model stayed busy after four attempts');
}

/** Asking for JSON and getting prose is the classic failure. Ask, then check. */
export function parseJsonAnswer(text, expectedKeys = []) {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const slice = block.slice(block.indexOf('{'), block.lastIndexOf('}') + 1);

  let parsed;
  try {
    parsed = JSON.parse(slice);
  } catch {
    throw new Error(`The model did not return JSON. It said: ${text.slice(0, 120)}...`);
  }

  const missing = expectedKeys.filter((k) => !(k in parsed));
  if (missing.length) throw new Error(`The answer is missing: ${missing.join(', ')}`);
  return parsed;
}
