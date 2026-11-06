const statusEl = document.getElementById('status');
const projectId = new URLSearchParams(location.search).get('id');
const saveButton = document.getElementById('save');
const downloadButton = document.getElementById('download');
const refineButton = document.getElementById('refine');

function sanitizeDocument(html) {
  const cleaned = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['link', 'meta'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'template'],
    FORBID_ATTR: ['srcdoc', 'http-equiv', 'formaction', 'action'],
  });
  const doc = new DOMParser().parseFromString(cleaned, 'text/html');
  for (const link of doc.querySelectorAll('link')) {
    if (link.rel !== 'stylesheet' || !/^https:\/\//i.test(link.getAttribute('href') || '')) link.remove();
  }
  for (const meta of doc.querySelectorAll('meta')) {
    if (!meta.hasAttribute('charset') && !['viewport', 'description', 'author'].includes(meta.name)) meta.remove();
  }
  return doc;
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function boot() {
  if (!/^[a-f0-9]{24}$/.test(projectId || '')) throw new Error('No valid project selected. Return to Projects.');
  const [project, config] = await Promise.all([api(`/api/projects/${projectId}`), api('/api/config')]);
  const source = sanitizeDocument(project.html);
  const css = [...source.querySelectorAll('style')].map((node) => node.textContent).join('\n');
  const styles = [...source.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href);
  source.querySelectorAll('style, body link, body meta').forEach((node) => node.remove());

  const editor = grapesjs.init({
    container: '#gjs', height: '100%', storageManager: false, noticeOnUnload: false,
    components: source.body.innerHTML, style: css,
    parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false } },
    canvas: {
      styles,
      frameContent: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; form-action 'none'; base-uri 'none'"></head><body></body></html>`,
    },
    deviceManager: { devices: [
      { id: 'desktop', name: 'Desktop', width: '' },
      { id: 'tablet', name: 'Tablet', width: '768px', widthMedia: '992px' },
      { id: 'mobile', name: 'Mobile', width: '390px', widthMedia: '480px' },
    ] },
    styleManager: { sectors: [
      { name: 'Layout', open: false, buildProps: ['display', 'position', 'top', 'right', 'bottom', 'left', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap'] },
      { name: 'Dimensions', open: false, buildProps: ['width', 'height', 'max-width', 'min-height', 'margin', 'padding'] },
      { name: 'Typography', open: false, buildProps: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'line-height', 'text-align'] },
      { name: 'Decoration', open: false, buildProps: ['background-color', 'border', 'border-radius', 'box-shadow', 'opacity'] },
    ] },
  });
  editor.getWrapper().addAttributes(Object.fromEntries([...source.body.attributes].map((attribute) => [attribute.name, attribute.value])));
  editor.on('canvas:frame:load:head', ({ window }) => {
    for (const attribute of source.documentElement.attributes) window.document.documentElement.setAttribute(attribute.name, attribute.value);
  });
  for (const [id, label, content] of [
    ['section', 'Section', '<section style="padding:48px 24px"><h2>New section</h2><p>Add your content here.</p></section>'],
    ['heading', 'Heading', '<h2>Your heading</h2>'],
    ['text', 'Text', '<p>Write something useful.</p>'],
    ['image', 'Image', { type: 'image' }],
    ['button', 'Link button', '<a href="#" style="display:inline-block;padding:12px 24px;background:#333;color:#fff">Learn more</a>'],
  ]) editor.BlockManager.add(id, { label, content, category: 'Basic' });

  function exportHtml() {
    const doc = source.cloneNode(true);
    const rendered = sanitizeDocument(editor.getHtml({ cleanId: false }));
    const body = doc.importNode(rendered.body, true);
    doc.body.replaceWith(body);
    doc.querySelectorAll('style').forEach((node) => node.remove());
    const style = doc.createElement('style');
    style.textContent = editor.getCss({ keepUnusedStyles: true });
    doc.head.append(style);
    return '<!doctype html>\n' + sanitizeDocument(doc.documentElement.outerHTML).documentElement.outerHTML;
  }

  let revision = 0;
  let savedRevision = 0;
  let timer;
  let saving = false;
  let refining = false;
  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(() => save(), 30000);
  }
  editor.on('update', () => {
    revision += 1;
    statusEl.textContent = 'Unsaved changes';
    if (!refining) scheduleSave();
  });
  async function save() {
    if (saving || refining) return;
    saving = true;
    saveButton.disabled = true;
    const snapshot = revision;
    clearTimeout(timer);
    try {
      await api(`/api/projects/${projectId}`, 'PUT', { html: exportHtml(), projectData: editor.getProjectData() });
      savedRevision = snapshot;
      statusEl.textContent = snapshot === revision ? 'Saved' : 'Unsaved changes';
      if (revision !== snapshot) scheduleSave();
    } catch (error) {
      statusEl.textContent = `Save failed: ${error.message}`;
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }
  saveButton.onclick = save;
  downloadButton.onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportHtml()], { type: 'text/html' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'website.html';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      statusEl.textContent = 'Downloaded HTML (external assets still require internet)';
    } catch (error) { statusEl.textContent = `Download failed: ${error.message}`; }
  };

  const dialog = document.getElementById('refine-dialog');
  const apply = document.getElementById('apply');
  const cancel = document.getElementById('cancel');
  refineButton.onclick = () => dialog.showModal();
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', (event) => { if (refining) event.preventDefault(); });
  document.getElementById('refine-form').onsubmit = async (event) => {
    event.preventDefault();
    if (saving) { document.getElementById('error').textContent = 'Wait for the current save to finish.'; return; }
    refining = true;
    clearTimeout(timer);
    apply.disabled = cancel.disabled = saveButton.disabled = true;
    apply.textContent = 'Generating…';
    document.getElementById('error').textContent = '';
    try {
      await api('/api/refine', 'POST', { id: projectId, instruction: document.getElementById('instruction').value, html: exportHtml() });
      savedRevision = revision;
      refining = false;
      location.reload();
    } catch (error) {
      document.getElementById('error').textContent = error.message;
      refining = false;
      apply.disabled = cancel.disabled = saveButton.disabled = false;
      apply.textContent = 'Apply change';
      if (revision !== savedRevision) scheduleSave();
    }
  };
  window.addEventListener('beforeunload', (event) => {
    if (revision !== savedRevision || refining) { event.preventDefault(); event.returnValue = ''; }
  });
  editor.onReady(() => {
    document.getElementById('boot').remove();
    saveButton.disabled = downloadButton.disabled = false;
    refineButton.disabled = config.demo;
    refineButton.title = config.demo ? 'Set API_KEY in .env and restart to enable AI refinement.' : 'Describe a change';
    statusEl.textContent = 'Ready · scripts and active embeds removed for safety';
  });
}
boot().catch((error) => {
  document.getElementById('boot').textContent = error.message;
  statusEl.textContent = 'Could not open project';
});
