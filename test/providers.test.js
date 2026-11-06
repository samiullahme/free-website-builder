const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { configFromEnv, generateHtml } = require('../ai');

const page = '<!doctype html><html><body><h1>AI made this</h1></body></html>';
let upstream; let port; let lastRequest;
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
test.before(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      const wantsAnthropic = req.url === '/v1/messages';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(wantsAnthropic
        ? { stop_reason: 'end_turn', content: [{ type: 'text', text: page }] }
        : { choices: [{ finish_reason: 'stop', message: { content: '```html\n' + page + '\n```' } }] }));
    });
  });
  port = await listen(upstream);
});
test.after(() => upstream.close());

const base = () => ({ key: 'secret-key', maxTokens: 4321, timeout: 5000, baseUrl: `http://127.0.0.1:${port}/v1` });

test('openai-compatible request uses bearer auth and chat completions', async () => {
  const html = await generateHtml({ ...base(), provider: 'openai', model: 'gpt-test' }, 'A bakery');
  assert.equal(html, page);
  assert.equal(lastRequest.url, '/v1/chat/completions');
  assert.equal(lastRequest.headers.authorization, 'Bearer secret-key');
  assert.equal(lastRequest.body.model, 'gpt-test');
  assert.equal(lastRequest.body.max_tokens, 4321);
});

test('deepseek request disables thinking', async () => {
  await generateHtml({ ...base(), provider: 'deepseek', model: 'deepseek-flash' }, 'A bakery');
  assert.deepEqual(lastRequest.body.thinking, { type: 'disabled' });
});

test('anthropic request uses messages API with version header', async () => {
  await generateHtml({ ...base(), provider: 'anthropic', model: 'claude-test' }, 'A bakery');
  assert.equal(lastRequest.url, '/v1/messages');
  assert.equal(lastRequest.headers['x-api-key'], 'secret-key');
  assert.equal(lastRequest.headers['anthropic-version'], '2023-06-01');
  assert.equal(lastRequest.body.system.includes('responsive HTML'), true);
});

test('provider config defaults and resolved endpoints', () => {
  assert.equal(configFromEnv({ AI_PROVIDER: 'deepseek' }).baseUrl, 'https://api.deepseek.com');
  assert.equal(configFromEnv({ AI_PROVIDER: 'anthropic' }).baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(configFromEnv({ AI_BASE_URL: `http://127.0.0.1:${port}/v1` }).baseUrl, `http://127.0.0.1:${port}/v1`);
});

test('upstream failures and truncation become safe client errors', async () => {
  const failing = http.createServer((req, res) => { res.statusCode = 401; res.end('upstream secret detail'); });
  const failPort = await listen(failing);
  try {
    await assert.rejects(
      () => generateHtml({ ...base(), baseUrl: `http://127.0.0.1:${failPort}/v1`, provider: 'openai' }, 'x'),
      (error) => error.status === 502 && !error.message.includes('upstream secret detail'));
  } finally { failing.close(); }

  const truncated = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: page.slice(0, 30) } }] }));
  });
  const truncPort = await listen(truncated);
  try {
    await assert.rejects(
      () => generateHtml({ ...base(), baseUrl: `http://127.0.0.1:${truncPort}/v1`, provider: 'openai' }, 'x'),
      /truncated/i);
  } finally { truncated.close(); }
});
