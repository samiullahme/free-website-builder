const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { configFromEnv, generateHtml, completeHtml, HttpError, numberSetting } = require('./ai');

const ROOT = __dirname;
const JSON_TYPE = 'application/json; charset=utf-8';
const assets = {
  '/': ['public/index.html', 'text/html'],
  '/editor': ['public/editor.html', 'text/html'],
  '/home.js': ['public/home.js', 'text/javascript'],
  '/editor.js': ['public/editor.js', 'text/javascript'],
  '/vendor/grapes.min.js': ['node_modules/grapesjs/dist/grapes.min.js', 'text/javascript'],
  '/vendor/grapes.min.css': ['node_modules/grapesjs/dist/css/grapes.min.css', 'text/css'],
  '/vendor/purify.min.js': ['node_modules/dompurify/dist/purify.min.js', 'text/javascript'],
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': JSON_TYPE });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'Send application/json.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2000000) throw new HttpError(413, 'Request exceeds 2 MB.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON object.');
  }
}

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name} must contain 1–${max} characters.`);
  return value.trim();
}

function validatedHtml(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1000000) throw new HttpError(400, 'HTML must be a string under 1 MB.');
  try { return completeHtml(value); } catch { throw new HttpError(400, 'Supply a complete HTML document including html and body tags.'); }
}

function projectData(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 900000) {
    throw new HttpError(400, 'Invalid editor project data (maximum 900 KB).');
  }
  return value;
}

function createApp({ ai = configFromEnv(), dataDir = path.join(ROOT, 'projects') } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  let aiBusy = false;
  const fileFor = (id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new HttpError(404, 'Project not found.');
    return path.join(dataDir, `${id}.json`);
  };
  const read = (id) => {
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Project not found.');
      throw error;
    }
  };
  const save = (project) => {
    project.updatedAt = Date.now();
    const file = fileFor(project.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(project), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    return project;
  };
  const create = (html, title) => save({ id: crypto.randomBytes(12).toString('hex'), title, html, projectData: null });
  async function aiRequest(prompt, html) {
    if (aiBusy) throw new HttpError(429, 'Another AI request is running. Please wait.');
    aiBusy = true;
    try { return await generateHtml(ai, prompt, html); } finally { aiBusy = false; }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      const host = req.headers.host;
      const port = server.address()?.port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) throw new HttpError(403, 'This app accepts localhost requests only.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new HttpError(403, 'Origin not allowed.');
      const url = new URL(req.url, `http://${host}`);
      const p = url.pathname;
      if (req.method === 'GET' && p === '/api/config') return json(res, 200, { demo: !ai.key, provider: ai.provider, model: ai.model });
      if (req.method === 'GET' && p === '/api/projects') {
        const projects = fs.readdirSync(dataDir).filter((name) => /^[a-f0-9]{24}\.json$/.test(name)).map((name) => {
          const { id, title, updatedAt } = read(name.slice(0, -5));
          return { id, title, updatedAt };
        }).sort((a, b) => b.updatedAt - a.updatedAt);
        return json(res, 200, projects);
      }
      if (req.method === 'POST' && p === '/api/import') {
        const body = await readBody(req);
        const project = create(validatedHtml(body.html), 'Imported website');
        return json(res, 201, { id: project.id });
      }
      if (req.method === 'POST' && p === '/api/generate') {
        const body = await readBody(req);
        const prompt = text(body.prompt, 'Prompt', 4000);
        const html = ai.key ? await aiRequest(prompt) : fs.readFileSync(path.join(ROOT, 'public/demo.html'), 'utf8');
        const project = create(html, prompt.slice(0, 100));
        return json(res, 201, { id: project.id, demo: !ai.key });
      }
      if (req.method === 'POST' && p === '/api/refine') {
        const body = await readBody(req);
        const project = read(body.id);
        const instruction = text(body.instruction, 'Instruction', 4000);
        const currentHtml = validatedHtml(body.html);
        if (!ai.key) throw new HttpError(400, 'AI refinement requires API_KEY in .env.');
        const html = await aiRequest(instruction, currentHtml);
        // Refine uses the current canvas snapshot, never the potentially stale disk HTML.
        save({ ...project, html, projectData: null });
        return json(res, 200, { id: project.id });
      }
      const match = p.match(/^\/api\/projects\/([a-f0-9]{24})$/);
      if (match) {
        const project = read(match[1]);
        if (req.method === 'GET') return json(res, 200, project);
        if (req.method === 'PUT') {
          const body = await readBody(req);
          project.html = validatedHtml(body.html);
          project.projectData = projectData(body.projectData);
          save(project);
          return json(res, 200, { ok: true, updatedAt: project.updatedAt });
        }
      }
      if (req.method === 'GET' && assets[p]) {
        const [file, type] = assets[p];
        const data = fs.readFileSync(path.join(ROOT, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(data);
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Server error. Please retry.' });
    }
  });
  server.requestTimeout = 30000;
  return server;
}

function start() {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const ai = configFromEnv();
  const port = numberSetting(process.env.PORT, 3020, 1, 65535, 'PORT');
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('HOST must be a loopback address. Public hosting requires authentication first.');
  const server = createApp({ ai, dataDir: process.env.DATA_DIR || path.join(ROOT, 'projects') });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Change PORT in .env; do not kill unrelated processes.` : 'Server could not start.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Website builder: http://${host === '::1' ? '[::1]' : host}:${port}\n${ai.key ? `${ai.provider} / ${ai.model}` : 'Demo mode: set API_KEY in .env and restart for real generation.'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
  return server;
}

if (require.main === module) start();
module.exports = { createApp, start };
