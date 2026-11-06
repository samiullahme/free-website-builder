# SiteForge — AI website builder with a visual editor

Describe a website in plain English. An AI provider writes a complete, responsive HTML document. It opens straight inside a drag-and-drop editor (GrapesJS), where you can change text, layout, colors and spacing visually — then save it or download the final HTML.

This is a **local, single-user app**: one clone, one `npm start`, your own API key. No build step, no database, no cloud account.

```
prompt ──► AI provider ──► complete HTML ──► visual editor ──► save / download
```

- **AI generation** with DeepSeek, OpenAI, Anthropic, or any OpenAI-compatible endpoint (including local models).
- **Visual editing** with the full GrapesJS editor, three device previews (desktop/tablet/mobile) and reusable blocks.
- **AI refinement** — describe a change and the current canvas (including unsaved edits) is rewritten.
- **Your code** — every project is stored as plain HTML/JSON on your disk; export a single `website.html`.
- **Import existing HTML** — paste any complete HTML document to edit it visually.
- **Safe by default** — scripts and active embeds are stripped, the editor sandbox cannot run page JavaScript, and your API key never reaches the browser.

---

## Quick start

A `git clone` only downloads files — nothing on your machine can execute itself. The setup is still a **single command after cloning**.

### Requirements

| Tool | Version | Check |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | **22.16 or newer** (LTS recommended) | `node --version` |
| npm | 10 or newer (ships with Node) | `npm --version` |
| Git | any recent version | `git --version` |

### 1. Clone and start

**macOS / Linux**

```bash
git clone https://github.com/samiullahme/free-website-builder.git
cd free-website-builder
npm start
```

**Windows (PowerShell or Command Prompt)**

```powershell
git clone https://github.com/samiullahme/free-website-builder.git
cd free-website-builder
npm start
```

On the **first run**, `npm start` automatically:

1. creates `.env` from `.env.example` (it will never overwrite an existing `.env`),
2. installs the locked dependencies (`npm ci --ignore-scripts`) if they are missing,
3. starts the app on **http://127.0.0.1:3020**.

You can try everything immediately in **demo mode**: generation returns a sample page, and you can edit, save and download it. To use real AI, add your API key (next section) and restart.

### 2. Add an API key

Open `.env` in the project root, set `API_KEY`, then stop the server (`Ctrl+C`) and run `npm start` again.

**DeepSeek** (default)

```dotenv
AI_PROVIDER=deepseek
API_KEY=sk-your-deepseek-key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
```

**OpenAI**

```dotenv
AI_PROVIDER=openai
API_KEY=sk-your-openai-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
```

**Anthropic**

```dotenv
AI_PROVIDER=anthropic
API_KEY=sk-ant-your-anthropic-key
AI_BASE_URL=https://api.anthropic.com/v1
AI_MODEL=claude-sonnet-4-5
```

**Any OpenAI-compatible endpoint** (Groq, Together, OpenRouter, a local Ollama/LM Studio server, …)

```dotenv
AI_PROVIDER=openai
API_KEY=your-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-model-name
```

The base URL must end at the API version root (for example `/v1`), **not** at `/chat/completions` or `/messages` — the app appends the right path for the provider. HTTPS is required; plain HTTP is allowed only for `localhost`/`127.0.0.1` so you can use local models.

> Your key lives only in `.env` on this machine. `.env` is git-ignored and is never sent to the browser. Keep it private and rotate any key that has been shared in chat or committed anywhere.

### 3. Use it

1. Open **http://127.0.0.1:3020**.
2. Describe your website (or click a suggestion chip) and press **Generate website**.
3. The generated page opens in the editor. Click any element to select it; double-click text to edit it; drag blocks from the right panel; restyle from the left panel.
4. Use **Save** to persist to disk, **Download HTML** for a standalone file, or **Refine with AI** to describe a change.

---

## Configuration reference

All settings live in `.env` (created on first start). Restart after editing.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `deepseek` | `deepseek`, `openai`, or `anthropic`. Use `openai` for any OpenAI-compatible API. |
| `API_KEY` | *(empty)* | Provider key. Empty = demo mode (sample page, AI refinement disabled). |
| `AI_BASE_URL` | provider default | API root, e.g. `https://api.openai.com/v1`. HTTPS only (HTTP allowed on loopback). |
| `AI_MODEL` | provider default | Model name sent to the provider. |
| `AI_MAX_TOKENS` | `16000` | Maximum output tokens (256–64000). Raise it if pages get truncated. |
| `AI_TIMEOUT_MS` | `180000` | Provider request timeout in milliseconds (100–600000). |
| `HOST` | `127.0.0.1` | Loopback only. Public hosting requires authentication first (see *Taking it further*). |
| `PORT` | `3020` | Change it if the port is busy. |
| `DATA_DIR` | `./projects` | Absolute path to store projects elsewhere. |

Provider-specific parameters are scoped automatically: DeepSeek runs with thinking mode disabled (otherwise it can consume the whole output budget before writing HTML), while OpenAI-compatible and Anthropic requests use their native formats. Provider errors surface as short, safe messages — upstream response bodies and keys are never echoed back.

---

## How projects are stored

Each saved website is a single JSON file in `projects/`:

```
projects/<24-hex-id>.json   { id, title, html, projectData, updatedAt }
```

- Writes are atomic (temp file + rename) with owner-only permissions.
- The home page lists every project in that folder; open one with `/editor?id=<id>`.
- **Back up** by copying the `projects/` folder (or point `DATA_DIR` at a backed-up location).
- Deleting a project = deleting its JSON file. There is no recycle bin.
- Imported/generated HTML includes a snapshot of the GrapesJS editor state (`projectData`), so reopening a project restores layers and styles.

## Import and export

**Import** (home page → *Already have HTML?*): paste a complete HTML document (`<!doctype html>` … `</html>`). Inline CSS and HTTPS stylesheet links are preserved. Scripts, iframes, objects, embeds, `<base>`, inline event handlers and `javascript:` URLs are removed for safety. Local asset paths (`./img/hero.jpg`) will not resolve — host assets somewhere reachable over HTTPS.

**Export** (editor → *Download HTML*): produces one self-contained `website.html` with all editor CSS inlined. External fonts, images and stylesheets still load from the network. The same safety sanitation is applied on export, so no page scripts are shipped.

Limitations: one page per project, no multi-page routing, no form backend, no asset uploads. These are deliberate MVP boundaries.

## Security model

This is a **local single-user tool**, not a hosted SaaS.

- Binds to `127.0.0.1` only; rejects requests whose `Host`, `Origin` or `Sec-Fetch-Site` indicate another site.
- Strict CSP, `nosniff`, `no-referrer`, `X-Frame-Options: DENY` on every response.
- AI output is treated as untrusted: sanitized with DOMPurify in the browser before editing, stripped of scripts, and rendered in a sandboxed canvas with `script-src 'none'`.
- Request bodies are limited (2 MB) and HTML is validated server-side; project IDs are strict 24-hex strings (no path traversal).
- API keys stay server-side; the browser only learns the provider/model name.

> Anyone with access to this machine (and its user account) can read every project and the `.env` file. Don't run this on a shared server without adding auth.

## Taking it further (public SaaS)

Before exposing this to real users you need, at minimum:

1. **Authentication** — accounts, sessions, password hashing.
2. **Tenant isolation** — every project query scoped to the signed-in user; the current version has no ownership concept.
3. **Rate limits and spending caps** — per-user AI quotas; one shared `aiBusy` lock is not a quota.
4. **HTTPS reverse proxy** — Caddy/Nginx in front, plus a real host allowlist instead of loopback.
5. **A database and backups** — replace flat JSON files when you outgrow a single machine.
6. **Abuse controls** — prompt/instruction moderation, output review, and monitoring.

The current code is a clean foundation: a provider-agnostic `ai.js`, a small HTTP server in `server.js`, and a static front end in `public/`.

---

## Development and tests

```bash
npm test          # API + provider unit tests with a mock upstream (14 tests)
npm run check     # syntax-check server and browser scripts
npm run test:browser   # Playwright end-to-end tests (4 tests)
```

The browser tests start the app against a **mock AI upstream**, so no key or network access is required. Install the Chromium once:

```bash
npx playwright install chromium
npm run test:browser
```

What the suites cover: provider request formats/auth (DeepSeek/OpenAI/Anthropic), truncation and upstream-failure handling, validation and oversized requests, traversal/cross-origin rejection, save/reload round trips, import, script stripping, visual text editing, download, and AI refinement receiving unsaved canvas edits.

```
ai.js               provider config + request/response handling
server.js           HTTP server, routes, validation, storage
start.js            first-run bootstrap (.env + dependencies)
public/index.html   landing page (generate, import, project list)
public/editor.html  editor shell
public/editor.js    GrapesJS boot, sanitation, save/download/refine
test/               unit + browser tests
```

### Updating an existing clone

```bash
git pull
npm install --ignore-scripts   # only when dependencies changed
npm start
```

`npm start` bootstraps dependencies only when `node_modules` is missing or incomplete; after a pull that changes `package-lock.json`, run `npm install` yourself. Your `.env` and `projects/` are never touched.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Port 3020 is busy` | Another app is using it. Change `PORT` in `.env` and restart. |
| `Please start using npm start.` | Run the app through `npm start`, not `node start.js` directly. |
| Demo mode notice on the home page | `API_KEY` is empty. Add it to `.env`, restart. |
| `AI provider returned HTTP 401/402/403` | Wrong key, insufficient balance, or a model your key cannot use. |
| `AI provider returned HTTP 404` | Wrong `AI_BASE_URL`/model. The base must not include `/chat/completions`. |
| `Could not read the AI provider response` | Network/proxy problem, or the endpoint does not speak the selected provider's format. |
| `AI output was truncated…` | Ask for a simpler page or raise `AI_MAX_TOKENS` (DeepSeek thinking mode is already disabled). |
| Refine button is disabled | Demo mode. Set `API_KEY` and restart. |
| Browser tests fail to launch | Run `npx playwright install chromium` first. |
| Moving the app to another folder | Copy `.env`, `projects/` and the source; reinstall on the new machine with `npm install --ignore-scripts`. |

Logs: the server prints a one-line startup banner and errors to the terminal. It shuts down cleanly with `Ctrl+C`.

## License and credits

This project is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

- Visual editor: [GrapesJS](https://grapesjs.com) — BSD-3-Clause.
- HTML sanitization in the browser: [DOMPurify](https://github.com/cure53/DOMPurify) — Apache-2.0/MPL-2.0.

SiteForge is an independent project and is not affiliated with any AI provider.
