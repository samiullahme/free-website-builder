const statusEl = document.getElementById('status');
const promptEl = document.getElementById('prompt');

async function request(url, body) {
  const res = await fetch(url, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

for (const chip of document.querySelectorAll('.chip')) {
  chip.onclick = () => { promptEl.value = chip.textContent; promptEl.focus(); };
}

function connectForm(id, url, getBody) {
  document.getElementById(id).onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    statusEl.className = 'status';
    const start = Date.now();
    const update = () => { statusEl.textContent = `${id === 'gen-form' ? 'Generating website' : 'Importing HTML'}… ${Math.floor((Date.now() - start) / 1000)}s`; };
    update();
    const timer = setInterval(update, 1000);
    try {
      const data = await request(url, getBody());
      location.href = `/editor?id=${encodeURIComponent(data.id)}`;
    } catch (error) {
      statusEl.className = 'status error';
      statusEl.textContent = error.message;
    } finally {
      clearInterval(timer);
      button.disabled = false;
    }
  };
}
connectForm('gen-form', '/api/generate', () => ({ prompt: promptEl.value.trim() }));
connectForm('import-form', '/api/import', () => ({ html: document.getElementById('html-input').value }));

async function loadHome() {
  const config = await request('/api/config');
  document.getElementById('mode').textContent = config.demo
    ? 'Demo mode — sample page only. Set API_KEY in .env and restart for AI generation.'
    : `AI provider: ${config.provider} · ${config.model}`;
  const projects = await request('/api/projects');
  const list = document.getElementById('projects');
  if (!projects.length) list.textContent = 'Your saved websites will appear here.';
  for (const project of projects) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/editor?id=${encodeURIComponent(project.id)}`;
    link.textContent = project.title;
    link.style.color = '#bfc2ff';
    item.append(link);
    list.append(item);
  }
}
loadHome().catch((error) => { statusEl.textContent = error.message; });
