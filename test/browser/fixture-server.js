// Runs the website builder against a mock OpenAI-compatible upstream so the
// browser tests never need a real API key or network access.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../server');

const APP_PORT = Number(process.env.BROWSER_APP_PORT || 3131);
const MOCK_PORT = Number(process.env.BROWSER_MOCK_PORT || 3132);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-browser-'));

const mockSite = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock site</title>
<style>body{font-family:sans-serif;margin:0}header{padding:40px;background:#eef}.site-header h1{color:#234}</style>
<script>window.__pwned = 'generated'</script></head>
<body class="mock-body"><header class="site-header"><h1>Mock generated site</h1><p>Built by the mock provider</p></header>
<main><section><h2>Features</h2><p>First feature paragraph.</p></section></main>
<footer><p>Mock footer</p></footer></body></html>`;

let lastRequest = null;

const mock = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__last') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(lastRequest));
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    return res.end();
  }
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    lastRequest = body;
    const user = String(body.messages?.at(-1)?.content || '');
    let html = mockSite;
    if (user.startsWith('Website:\n')) {
      const request = user.split('Requested change:\n').pop() || 'change applied';
      html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>Refined</title>
<style>body{font-family:sans-serif}</style><script>window.__pwned = 'refined'</script></head>
<body><main><h1>Refined by mock</h1><p id="request">${request.replace(/[<>&]/g, '')}</p></main></body></html>`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: html }, finish_reason: 'stop' }] }));
  });
});

const app = createApp({
  ai: {
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    model: 'mock-model',
    key: 'mock-key',
    maxTokens: 16000,
    timeout: 60000,
  },
  dataDir,
});

function shutdown() {
  app.close();
  mock.close();
  app.closeAllConnections();
  mock.closeAllConnections();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

mock.listen(MOCK_PORT, '127.0.0.1', () => {
  app.listen(APP_PORT, '127.0.0.1', () => {
    console.log(`Fixture app http://127.0.0.1:${APP_PORT} (mock AI on ${MOCK_PORT})`);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
process.on('exit', () => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
