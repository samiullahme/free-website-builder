const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { configFromEnv, completeHtml } = require('../ai');

const page = '<!doctype html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
const config = { provider: 'openai', baseUrl: 'https://invalid.example/v1', model: 'test', key: '', maxTokens: 1000, timeout: 5000 };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function request(port, route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let server; let port; let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-test-'));
  server = createApp({ ai: config, dataDir });
  port = await listen(server);
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves landing page with security headers', async () => {
  const res = await request(port, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('reports demo mode without a key', async () => {
  const res = await request(port, '/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.demo, true);
});

test('demo generation, save, reload round trip', async () => {
  const generated = await request(port, '/api/generate', { method: 'POST', body: { prompt: 'A bakery' } });
  assert.equal(generated.status, 201);
  assert.match(generated.body.id, /^[a-f0-9]{24}$/);
  const loaded = await request(port, `/api/projects/${generated.body.id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.title, 'A bakery');
  const edited = '<!doctype html><html><body><h1>Edited</h1></body></html>';
  const saved = await request(port, `/api/projects/${generated.body.id}`, { method: 'PUT', body: { html: edited, projectData: { pages: [] } } });
  assert.equal(saved.status, 200);
  const reloaded = await request(port, `/api/projects/${generated.body.id}`);
  assert.equal(reloaded.body.html, edited);
  assert.deepEqual(reloaded.body.projectData, { pages: [] });
});

test('import accepts complete HTML and rejects fragments', async () => {
  assert.equal((await request(port, '/api/import', { method: 'POST', body: { html: page } })).status, 201);
  assert.equal((await request(port, '/api/import', { method: 'POST', body: { html: '<h1>fragment</h1>' } })).status, 400);
});

test('rejects malformed, wrong-type and oversized input', async () => {
  assert.equal((await request(port, '/api/generate', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request(port, '/api/generate', { method: 'POST', body: { prompt: '' } })).status, 400);
  assert.equal((await request(port, '/api/generate', { method: 'POST', body: { prompt: 'x'.repeat(4001) } })).status, 400);
  assert.equal((await request(port, '/api/generate', { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('rejects traversal, unknown ids and cross-origin requests', async () => {
  assert.equal((await request(port, '/api/projects/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await request(port, '/api/projects/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
  const cross = await request(port, '/api/import', { method: 'POST', body: { html: page }, headers: { Origin: 'https://evil.test' } });
  assert.equal(cross.status, 403);
});

test('refinement requires a key and never echoes secrets', async () => {
  const generated = await request(port, '/api/generate', { method: 'POST', body: { prompt: 'A bakery' } });
  const res = await request(port, '/api/refine', { method: 'POST', body: { id: generated.body.id, instruction: 'Change it', html: page } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /API_KEY/);
});

test('html validator detects truncation and fences', () => {
  assert.throws(() => completeHtml(page.slice(0, -20)), /incomplete/i);
  assert.equal(completeHtml('```html\n' + page + '\n```'), page);
});

test('provider configuration validates URLs and limits', () => {
  assert.throws(() => configFromEnv({ AI_PROVIDER: 'unknown' }), /AI_PROVIDER/);
  assert.throws(() => configFromEnv({ AI_BASE_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => configFromEnv({ AI_TIMEOUT_MS: '0' }), /AI_TIMEOUT_MS/);
  assert.equal(configFromEnv({ AI_BASE_URL: 'http://localhost:11434/v1' }).provider, 'deepseek');
});
