class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const defaults = {
  deepseek: ['https://api.deepseek.com', 'deepseek-flash'],
  openai: ['https://api.openai.com/v1', 'gpt-4.1-mini'],
  anthropic: ['https://api.anthropic.com/v1', 'claude-sonnet-4-5'],
};

function numberSetting(value, fallback, min, max, name) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${name}`);
  return number;
}

function configFromEnv(env = process.env) {
  const provider = env.AI_PROVIDER || 'deepseek';
  if (!defaults[provider]) throw new Error('AI_PROVIDER must be deepseek, openai or anthropic');
  const base = new URL(env.AI_BASE_URL || defaults[provider][0]);
  if (base.username || base.password || base.search || base.hash) throw new Error('AI_BASE_URL cannot contain credentials, query or fragment');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new Error('AI_BASE_URL must use HTTPS (HTTP allowed only on loopback for local models)');
  }
  return {
    provider,
    baseUrl: base.href.replace(/\/$/, ''),
    model: env.AI_MODEL || defaults[provider][1],
    key: env.API_KEY || '',
    maxTokens: numberSetting(env.AI_MAX_TOKENS, 16000, 256, 64000, 'AI_MAX_TOKENS'),
    timeout: numberSetting(env.AI_TIMEOUT_MS, 180000, 100, 600000, 'AI_TIMEOUT_MS'),
  };
}

function completeHtml(text) {
  if (typeof text !== 'string') throw new HttpError(502, 'Provider returned no HTML.');
  let html = text.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  const start = html.search(/<!doctype\s+html|<html[\s>]/i);
  if (start >= 0) html = html.slice(start);
  if (!/<html[\s>]/i.test(html) || !/<body[\s>][\s\S]*\S[\s\S]*<\/body\s*>/i.test(html) || !/<\/html\s*>\s*$/i.test(html)) {
    throw new HttpError(502, 'Provider returned incomplete HTML. Try a simpler prompt or increase AI_MAX_TOKENS.');
  }
  if (Buffer.byteLength(html) > 1000000) throw new HttpError(502, 'Generated HTML is too large.');
  return html;
}

const systemPrompt = `Create one complete, responsive HTML website. Output only <!doctype html> through </html>, no Markdown.
Use a head with title, viewport and one inline style element; include a body with navigation, hero, three relevant sections and footer.
Use semantic HTML, polished typography, coherent colors and specific believable copy. Make the layout work at 390px and 1280px.
No scripts, event handlers, iframes, embedded objects or JavaScript frameworks. Use regular CSS, not runtime Tailwind.
Use HTTPS images only when useful and write descriptive alt text. Prefer a coherent CSS layout over unrelated placeholder photos.
Keep the complete document concise enough to fit the output limit.`;

async function generateHtml(config, prompt, currentHtml) {
  const system = currentHtml ? `${systemPrompt}\nApply only the user's requested changes to the supplied website.` : systemPrompt;
  const user = currentHtml ? `Website:\n${currentHtml}\n\nRequested change:\n${prompt}` : prompt;
  const anthropic = config.provider === 'anthropic';
  const url = `${config.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`;
  const headers = { 'Content-Type': 'application/json' };
  const body = { model: config.model, max_tokens: config.maxTokens };
  if (anthropic) {
    headers['x-api-key'] = config.key;
    headers['anthropic-version'] = '2023-06-01';
    body.system = system;
    body.messages = [{ role: 'user', content: user }];
  } else {
    headers.Authorization = `Bearer ${config.key}`;
    body.messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    if (config.provider === 'deepseek') body.thinking = { type: 'disabled' };
  }
  let response;
  let data;
  try {
    response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(config.timeout),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(502, `AI provider returned HTTP ${response.status}. Check your key, balance, model and base URL.`);
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new HttpError(504, 'AI request timed out. Try a shorter prompt.');
    throw new HttpError(502, 'Could not read the AI provider response. Check your provider configuration and network.');
  }
  const finish = anthropic ? data.stop_reason : data.choices?.[0]?.finish_reason;
  if (finish !== (anthropic ? 'end_turn' : 'stop')) {
    throw new HttpError(502, 'AI output was truncated or did not finish normally. Try a simpler prompt or increase AI_MAX_TOKENS.');
  }
  const text = anthropic
    ? data.content?.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    : data.choices?.[0]?.message?.content;
  return completeHtml(text);
}

module.exports = { configFromEnv, generateHtml, completeHtml, HttpError, numberSetting };
