/**
 * The AI node - one request, and everything that can go wrong with it.
 *
 * It speaks two dialects:
 *
 *   anthropic  the hosted Claude API      POST {base}/v1/messages
 *   openai     anything OpenAI-shaped     POST {base}/chat/completions
 *
 * The second one is what makes a local model work: LM Studio, Ollama and vLLM
 * all serve the OpenAI chat format, so pointing the node at
 * http://localhost:1234/v1 runs the whole workflow on your own laptop with no
 * API key, no cost and no internet. Same node, same prompt, same downstream
 * IF - which is a good paragraph for the report.
 *
 * Because every setting runs through the expression resolver, somebody can type
 *
 *   Classify this: {{ $json.body.message }}
 *   Reply as JSON: {"urgency":"urgent|routine"}
 *
 * into the sidebar and feed the answer straight into an IF node.
 */

export const MODELS = [
  { name: 'Opus - the most capable', value: 'claude-opus-5' },
  { name: 'Sonnet - the everyday choice', value: 'claude-sonnet-5' },
  { name: 'Haiku - the fastest and cheapest', value: 'claude-haiku-4-5-20251001' },
];

const DEFAULT_PROMPT = `Classify this message.
Reply with JSON only: {"urgency":"urgent|routine","reason":"one short sentence"}

Message: {{ $json.body.message }}`;

const LOCAL_DEFAULT = 'http://localhost:1234/v1';

export const aiNode = {
  description: {
    name: 'ai',
    displayName: 'AI',
    group: 'action',
    icon: 'sparkles',
    colour: '#7c3aed',
    description: 'Ask a language model about the item, hosted or on your own machine',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'anthropicApi', required: false }],
    properties: [
      { displayName: 'Where the model runs', name: 'provider', type: 'options', default: 'anthropic',
        options: [
          { name: 'Anthropic - hosted', value: 'anthropic' },
          { name: 'On this machine - LM Studio, Ollama, vLLM', value: 'openai' },
        ] },

      { displayName: 'Model', name: 'model', type: 'options', default: 'claude-sonnet-5',
        options: MODELS,
        displayOptions: { show: { provider: ['anthropic'] } } },

      { displayName: 'Server address', name: 'baseUrl', type: 'string', default: LOCAL_DEFAULT,
        placeholder: LOCAL_DEFAULT,
        hint: 'LM Studio: Developer tab, Start Server. Ollama: http://localhost:11434/v1',
        displayOptions: { show: { provider: ['openai'] } } },

      { displayName: 'Model name', name: 'localModel', type: 'string', default: '',
        placeholder: 'leave empty to use whichever model is loaded',
        hint: 'The id shown next to the model in LM Studio, e.g. qwen2.5-7b-instruct',
        displayOptions: { show: { provider: ['openai'] } } },

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
  const provider = ctx.getNodeParameter('provider', i, 'anthropic');

  const prompt = String(ctx.getNodeParameter('userPrompt', i));
  if (prompt.length > 20_000) throw new Error('Prompt is too long - trim the data you send in');
  const system = ctx.getNodeParameter('systemPrompt', i, '');
  const maxTokens = Math.min(Math.max(Number(ctx.getNodeParameter('maxTokens', i, 512)), 1), 4096);

  return provider === 'openai'
    ? askOpenAiCompatible(ctx, i, { prompt, system, maxTokens })
    : askAnthropic(ctx, i, { prompt, system, maxTokens });
}

// --------------------------------------------------------------------------
// the hosted Claude API
// --------------------------------------------------------------------------

async function askAnthropic(ctx, i, { prompt, system, maxTokens }) {
  const apiKey = ctx.credentials?.anthropicApi?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = ctx.credentials?.anthropicApi?.baseUrl
    ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

  if (!apiKey || apiKey === 'replace-me') {
    throw new Error('No API key for the AI node - set ANTHROPIC_API_KEY in .env, '
                  + 'or switch "Where the model runs" to this machine and use LM Studio');
  }

  const body = {
    model: ctx.getNodeParameter('model', i, 'claude-sonnet-5'),
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;

  const data = await postWithRetries(ctx, `${trimSlash(baseUrl)}/v1/messages`, body, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });

  if (data.stop_reason === 'max_tokens') ctx.logger.warn('answer was cut off - raise Max tokens');

  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  ctx.logger.info(`in ${data.usage?.input_tokens ?? '?'} / out ${data.usage?.output_tokens ?? '?'} tokens`);
  return { text, usage: data.usage, model: data.model, stopReason: data.stop_reason };
}

// --------------------------------------------------------------------------
// anything OpenAI-shaped: LM Studio, Ollama, vLLM, llama.cpp
// --------------------------------------------------------------------------

async function askOpenAiCompatible(ctx, i, { prompt, system, maxTokens }) {
  const baseUrl = normaliseLocalUrl(ctx.getNodeParameter('baseUrl', i, LOCAL_DEFAULT));
  const model = String(ctx.getNodeParameter('localModel', i, '')).trim()
    || await firstLoadedModel(ctx, baseUrl);

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const data = await postWithRetries(ctx, `${baseUrl}/chat/completions`, {
    model, messages, max_tokens: maxTokens, stream: false,
  }, {
    // LM Studio ignores this, but Ollama and vLLM behind a proxy may want it
    authorization: `Bearer ${process.env.LOCAL_LLM_API_KEY ?? 'not-needed'}`,
  });

  const choice = data.choices?.[0];
  if (!choice) throw new Error(`${baseUrl} answered without any choices - is a model loaded?`);
  if (choice.finish_reason === 'length') ctx.logger.warn('answer was cut off - raise Max tokens');

  const usage = data.usage
    ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
    : undefined;
  ctx.logger.info(`${model}: in ${usage?.input_tokens ?? '?'} / out ${usage?.output_tokens ?? '?'} tokens`);

  return {
    text: choice.message?.content ?? '',
    usage,
    model: data.model ?? model,
    stopReason: choice.finish_reason,
  };
}

/** LM Studio users rarely know the model id, and it is one request to find out. */
async function firstLoadedModel(ctx, baseUrl) {
  const listed = await getJson(ctx, `${baseUrl}/models`);
  const id = listed.data?.[0]?.id;
  if (!id) {
    throw new Error(`No model is loaded at ${baseUrl}. In LM Studio, load a model first, `
                  + 'or type its name into "Model name".');
  }
  ctx.logger.info(`using the loaded model: ${id}`);
  return id;
}

// --------------------------------------------------------------------------
// shared plumbing
// --------------------------------------------------------------------------

const trimSlash = (url) => String(url).replace(/\/+$/, '');

/**
 * LM Studio shows you `http://localhost:1234/v1` but people paste
 * `localhost:1234`, with or without the /v1. Accept all of it.
 */
export function normaliseLocalUrl(raw) {
  let url = trimSlash(String(raw || LOCAL_DEFAULT).trim());
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/v\d+$/.test(url)) url = `${url}/v1`;
  return url;
}

async function postWithRetries(ctx, url, body, headers) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await send(ctx, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
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
    if (!res.ok) throw new Error(`AI ${res.status}: ${data.error?.message ?? data.error ?? 'unknown error'}`);
    return data;
  }
  throw new Error('The model stayed busy after four attempts');
}

async function getJson(ctx, url) {
  const res = await send(ctx, url, { method: 'GET' });
  if (!res.ok) throw new Error(`AI ${res.status} from ${url}`);
  return res.json();
}

/** One fetch, and one genuinely useful message when a local server is not there. */
async function send(ctx, url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    if (/fetch failed|ECONNREFUSED|other side closed|terminated/i.test(err.message)) {
      throw new Error(`Could not reach a model server at ${url}. `
                    + 'If you are using LM Studio: open it, go to the Developer tab and press '
                    + 'Start Server. Check the port matches "Server address".', { cause: err });
    }
    if (/timed out|aborted/i.test(err.message)) {
      throw new Error(`${url} did not answer within two minutes. A large local model on CPU can be `
                    + 'slower than that - try a smaller one, or lower Max tokens.', { cause: err });
    }
    throw err;
  }
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
